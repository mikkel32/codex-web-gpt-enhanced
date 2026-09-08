import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { defaultBrokerEndpoint } from "../src/config";
import { verifyConnectionRoundTrip } from "../src/connection-verification";
import { TurnBroker } from "../src/adapters/chatgpt-web/turn-broker";

const socket = defaultBrokerEndpoint(join(tmpdir(), `cv-${randomUUID().slice(0, 8)}`));
const broker = TurnBroker.forSocket(socket);
const client = new Client({ name: "connection-verification-test", version: "1" });
let diagnostics = "";
beforeAll(async () => {
  await broker.listen();
  const transport = new StdioClientTransport({ command: process.execPath,
    args: ["src/cli.ts", "mcp", "--broker-socket", socket], cwd: process.cwd(), stderr: "pipe" });
  await client.connect(transport);
  transport.stderr?.on("data", chunk => { diagnostics = (diagnostics + String(chunk)).slice(-4000); });
});
afterAll(async () => { await client.close(); await broker.close(); });

// The tunnel keeps one MCP process for successive turn capabilities. Exercise that same
// lifecycle, including a failed proof followed by a fresh successful protocol response.
const call = async (args: Parameters<Client["callTool"]>[0]) => {
  try { return await client.callTool(args, undefined, { timeout: 8000 }); }
  catch (error) { throw new Error(`${error instanceof Error ? error.message : String(error)}\nMCP diagnostics: ${diagnostics}`); }
};

for (const scenario of ["success", "unacknowledged", "invented-proof", "browser-failure", "cancel", "success-after-failures"] as const) {
  test(`connection verification: ${scenario} retires only its own capability`, async () => {
    let token = "";
    const controller = new AbortController();
    const other = await broker.register({ cwd: tmpdir(), roots: [tmpdir()], writableRoots: [], tools: [], sandboxPolicy: { type: "readOnly", networkAccess: false } });
    const read = async (name: string, offset: number, receipt?: string) => {
      const response = await call({ name: "codex_context_read", arguments: { turn_token: token, name, offset, ...(receipt ? { receipt } : {}) } });
      if (response.isError) throw new Error(JSON.stringify(response.content));
      return JSON.parse((response.content as Array<{ text: string }>)[0]!.text);
    };
    try {
      const outcome = verifyConnectionRoundTrip({ broker, cwd: tmpdir(), signal: controller.signal, run: async turn => {
        expect(turn.reasoning).toBe("xhigh");
        expect(turn.modelId).toBe("gpt-5.6-sol");
        const prompt = await turn.prepare();
        token = prompt.text.match(/turn_token (turn_[A-Za-z0-9_-]+)/)![1]!;
        if (scenario === "browser-failure") throw new Error("Browser disconnected");
        if (scenario === "cancel") { controller.abort(new Error("User cancelled")); return "{}"; }
        if (scenario === "invented-proof") return JSON.stringify({ core: "guess", evidence: "guess", tool: "guess" });
        let receipt: string | undefined, core = "";
        for (const name of ["codex-context-1-of-2.json", "codex-context-2-of-2.json"]) {
          let offset = 0, text = "";
          while (true) {
            const page = await read(name, offset, receipt);
            text += page.text;
            receipt = page.receipt;
            if (page.next_offset === null) {
              if (name === "codex-context-1-of-2.json") core = JSON.parse(text).core;
              if (scenario !== "unacknowledged") await read(name, page.total_chars, receipt);
              break;
            }
            offset = page.next_offset;
          }
        }
        const search = await call({ name: "codex_context_search", arguments: { turn_token: token, query: "connection_evidence" } });
        if (scenario === "unacknowledged") {
          expect(search.isError).toBe(true);
          await expect(turn.completionFence!.commit((await turn.completionFence!.begin())!)).rejects.toThrow("Required context delivery incomplete");
          throw new Error("Required context delivery incomplete");
        }
        expect(search.isError).not.toBe(true);
        const found = JSON.parse((search.content as Array<{ text: string }>)[0]!.text).matches[0];
        const evidence = (await read(found.name, found.offset)).text.split("=")[1];
        const inventory = await call({ name: "codex_tool_inventory", arguments: { turn_token: token } });
        const catalog = JSON.parse((inventory.content as Array<{ text: string }>)[0]!.text);
        expect(catalog.tools).toHaveLength(1);
        const invoked = await call({ name: "codex_tool_call", arguments: { turn_token: token, wire_name: catalog.tools[0].wire_name, arguments: {} } });
        expect(invoked.isError).not.toBe(true);
        const value = JSON.parse((invoked.content as Array<{ text: string }>)[0]!.text);
        expect(await turn.completionFence!.commit((await turn.completionFence!.begin())!)).toBe(true);
        return JSON.stringify({ core, evidence, tool: value.tool });
      } });
      if (scenario === "success" || scenario === "success-after-failures") expect(await outcome).toMatchObject({ ok: true, scope: ["required-context-receipts", "evidence-retrieval", "native-tool-round-trip"] });
      else await expect(outcome).rejects.toThrow(scenario === "unacknowledged" ? "Required context delivery incomplete"
        : scenario === "browser-failure" ? "Browser disconnected" : scenario === "cancel" ? "User cancelled" : "proof did not match");
      expect((await call({ name: "codex_context_read", arguments: { turn_token: token, name: "codex-context-1-of-2.json", offset: 0 } })).isError).toBe(true);
      expect(broker.beginCompletionFence(other)).toBeDefined();
    } finally { broker.revoke(other); }
  }, 20_000);
}

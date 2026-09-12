import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { defaultBrokerEndpoint } from "../src/config";
import { TurnBroker } from "../src/adapters/chatgpt-web/turn-broker";

test("native desktop gateway preserves screenshots and approval failures within the advertised task", async () => {
  const home = mkdtempSync(join(tmpdir(), "maria-desktop-"));
  const socket = defaultBrokerEndpoint(home);
  const broker = TurnBroker.forSocket(socket);
  const environment = { cwd: home, roots: [home], writableRoots: [],
    sandboxPolicy: { type: "readOnly" as const, networkAccess: false },
    tools: [{ name: "js", namespace: "mcp__cua_repl", description: "Native Computer Use",
      parameters: { type: "object", properties: { code: { type: "string" } }, required: ["code"], additionalProperties: false } }],
  };
  const token = await broker.register(environment, 30000);
  const other = await broker.register({ ...environment, tools: [] }, 30000);
  const client = new Client({ name: "native-desktop-bridge-test", version: "1" });
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath,
      args: ["src/cli.ts", "mcp", "--broker-socket", socket], cwd: process.cwd(), stderr: "pipe" }));
    const inventory = await client.callTool({ name: "codex_tool_inventory",
      arguments: { turn_token: token, query: "@advertised cua" } });
    const catalog = inventory.structuredContent as { tools: Array<{ wire_name: string }> };
    expect(catalog.tools.map(tool => tool.wire_name)).toEqual(["mcp__cua_repl__js"]);
    const invoke = (turnToken: string) => client.callTool({ name: "codex_tool_call", arguments: {
      turn_token: turnToken, wire_name: catalog.tools[0]!.wire_name,
      arguments: { code: "await desktop.getScreenshot();" },
    } });

    const deniedOther = await invoke(other);
    expect(deniedOther.isError).toBe(true);
    const screenshot = invoke(token);
    const [request] = await broker.nextToolBatch(token);
    expect(request).toMatchObject({ wireName: "mcp__cua_repl__js", freeform: false,
      arguments: { code: "await desktop.getScreenshot();" } });
    const content = [
      { type: "text", text: "Fixture desktop capture" },
      { type: "image", mimeType: "image/png", data: readFileSync(join(process.cwd(), "launcher/assets/browser-chrome.png")).toString("base64") },
    ];
    broker.completeTool(token, request!.callId, { content });
    const returned = await screenshot;
    expect(returned.isError).not.toBe(true);
    expect(returned.content).toEqual(content);

    const rejected = invoke(token);
    const [rejectedRequest] = await broker.nextToolBatch(token);
    const failure = { isError: true, content: [{ type: "text", text: "Computer Use was not approved to use the requested app" }] };
    broker.completeTool(token, rejectedRequest!.callId, failure);
    const returnedFailure = await rejected;
    expect(returnedFailure.isError).toBe(true);
    expect(returnedFailure.content).toEqual(failure.content);
    expect((returnedFailure.content as Array<{ type: string }>).some(part => part.type === "image")).toBe(false);

    broker.revoke(token);
    expect((await invoke(token)).isError).toBe(true);
  } finally {
    await client.close();
    broker.revoke(token); broker.revoke(other); await broker.close();
    rmSync(home, { recursive: true, force: true });
  }
}, 20000);

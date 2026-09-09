import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defaultBrokerEndpoint } from "../src/config";
import { TurnBroker, type BrokerToolResult } from "../src/adapters/chatgpt-web/turn-broker";

test("nested plugin results retain structured data, screenshots, resources and error status over MCP", async () => {
  const root = join(tmpdir(), `cgw-gateway-${randomUUID().slice(0, 8)}`);
  const broker = TurnBroker.forSocket(process.platform === "win32" ? defaultBrokerEndpoint(root, "win32") : `${root}.sock`);
  const token = await broker.register({ cwd: "/fixture", roots: ["/fixture"], writableRoots: [],
    sandboxPolicy: { type: "readOnly", networkAccess: false },
    tools: [{ name: "exec", freeform: true, parameters: {}, description: "Native execution gateway" }],
  }, 60_000);
  const client = new Client({ name: "gateway-results", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: ["src/cli.ts", "mcp", "--broker-socket", broker.socketPath], cwd: process.cwd(), stderr: "pipe" });
  const screenshot = { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png", _meta: { "codex/imageDetail": "original" } };
  const resource = { type: "resource_link", name: "report", uri: "https://example.test/report", mimeType: "text/plain" };
  const metadata = { _meta: { clientOnlySecret: "must-not-reach-model" } };
  try {
    await client.connect(transport);
    for (const fixture of [
      { content: [{ type: "text", text: "Action completed." }], structuredContent: { records: [{ id: 7, status: "edited" }] }, ...metadata },
      { content: [], structuredContent: { records: ["only-structured"] } },
      { content: [screenshot, resource], structuredContent: { screen: "fixture" }, ...metadata },
      { content: [{ type: "text", text: "Evidence unavailable" }], structuredContent: { code: "lookup_failed" }, isError: true },
      { content: [{ type: "text", text: '{"records":[1,2]}' }], structuredContent: { records: [1, 2] } },
    ]) {
      const pending = client.callTool({ name: "codex_tool_call", arguments: { turn_token: token,
        wire_name: "mcp__fixture__inspect", arguments: { target: "fixture" } } });
      const [request] = await broker.nextToolBatch(token);
      const content: BrokerToolResult["content"] = [];
      const text = (value: unknown) => content.push({ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) });
      const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
      let invocations = 0;
      await new AsyncFunction("tools", "ALL_TOOLS", "text", "image", "audio", "generatedImage", request!.input)(
        { mcp__fixture__inspect: async (args: unknown) => { invocations++; expect(args).toEqual({ target: "fixture" }); return fixture; } },
        [{ name: "mcp__fixture__inspect", description: "Inspect UI and plugin data" }], text,
        (value: any) => content.push(value), (value: any) => content.push(value), text,
      );
      broker.completeTool(token, request!.callId, { content });
      const result = await pending;
      expect(invocations).toBe(1);
      expect(result.isError === true).toBe("isError" in fixture && fixture.isError === true);
      expect(JSON.stringify(result)).not.toContain("must-not-reach-model");
      expect(JSON.stringify(result)).toContain(JSON.stringify(fixture.structuredContent).replaceAll('"', '\\"'));
      if (fixture.content.includes(screenshot as never)) {
        expect(result.content).toContainEqual(screenshot);
        expect(JSON.stringify(result)).toContain("https://example.test/report");
      }
      if (fixture.structuredContent.records?.[0] === 1) expect(result.content).toHaveLength(1);
    }
  } finally { await client.close().catch(() => {}); broker.revoke(token); await broker.close(); }
}, 30_000);

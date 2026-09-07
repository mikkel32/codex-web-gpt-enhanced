import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defaultBrokerEndpoint } from "../src/config";
import { TurnBroker } from "../src/adapters/chatgpt-web/turn-broker";
import type { ChatGptTurnEnvironment } from "../src/adapters/chatgpt-web/environment";

test("MCP inventory exposes only the claimed turn's workspace, with no read aliases or cross-host fallback", async () => {
  const root = join(tmpdir(), `cgw-inventory-${randomUUID().slice(0, 8)}`);
  const socket = process.platform === "win32" ? defaultBrokerEndpoint(root, "win32") : `${root}.sock`;
  const broker = TurnBroker.forSocket(socket);
  const mac: ChatGptTurnEnvironment = {
    cwd: "/Users/fixture/project", roots: ["/Users/fixture/project"], writableRoots: [],
    sandboxPolicy: { type: "readOnly", networkAccess: false },
    tools: [{ name: "read_file", parameters: { type: "object", properties: { path: { type: "string" } } }, description: "Read a project file" }],
  };
  const windows: ChatGptTurnEnvironment = {
    cwd: "C:\\fixture\\project", roots: ["C:\\fixture\\project"], writableRoots: ["C:\\fixture\\project"],
    sandboxPolicy: { type: "workspaceWrite", writableRoots: ["C:\\fixture\\project"], networkAccess: false }, tools: [],
  };
  const token = await broker.register(mac, 60_000);
  const otherToken = await broker.register(windows, 60_000);
  const client = new Client({ name: "workspace-inventory-test", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: ["src/cli.ts", "mcp", "--broker-socket", socket], cwd: process.cwd(), stderr: "pipe" });
  try {
    await client.connect(transport);
    const inventory = await client.callTool({ name: "codex_tool_inventory", arguments: { turn_token: token } });
    expect(inventory.structuredContent).toMatchObject({
      contract: "native", environment: { cwd: mac.cwd, roots: mac.roots, writable_roots: [], sandbox: "readOnly" },
      tools: [{ wire_name: "read_file" }], total: 1, next_offset: null,
    });
    expect(JSON.stringify(inventory)).not.toContain(token);
    expect(JSON.stringify(inventory)).not.toContain("C:\\fixture");
    const other = await client.callTool({ name: "codex_tool_inventory", arguments: { turn_token: otherToken, include_schema: false } });
    expect(other.structuredContent).toMatchObject({ environment: { cwd: windows.cwd, roots: windows.roots, writable_roots: windows.writableRoots, sandbox: "workspaceWrite" }, tools: [] });
    expect(JSON.stringify(other)).not.toContain(mac.cwd);
    const unavailable = await client.callTool({ name: "codex_tool_call", arguments: { turn_token: token, wire_name: "read", arguments: { path: "/Users/fixture/project/file" } } });
    expect(unavailable.isError).toBe(true);
    const names = (await client.listTools()).tools.map(tool => tool.name);
    expect(names).not.toContain("read"); expect(names).not.toContain("exec_command");
    broker.revoke(token);
    const revoked = await client.callTool({ name: "codex_tool_inventory", arguments: { turn_token: token } });
    expect(revoked.isError).toBe(true);
    expect(JSON.stringify(revoked)).not.toContain(mac.cwd);
  } finally {
    await client.close().catch(() => {});
    broker.revoke(token); broker.revoke(otherToken); await broker.close();
  }
}, 30_000);

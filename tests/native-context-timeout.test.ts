import { expect, test } from "bun:test";
import { createServer, createConnection, type Socket } from "node:net";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { defaultBrokerEndpoint } from "../src/config";
import { TurnBroker } from "../src/adapters/chatgpt-web/turn-broker";
import type { NativeContextPage } from "../src/adapters/chatgpt-web/native-context";

test("a lost response at offset 48000 times out and the identical read safely recovers", async () => {
  const root = join(tmpdir(), `cgw-loss-${randomUUID().slice(0, 8)}`);
  const address = (suffix: string) => process.platform === "win32" ? defaultBrokerEndpoint(root + suffix, "win32") : root + suffix + ".sock";
  const broker = TurnBroker.forSocket(address("broker"));
  await broker.listen();
  const token = await broker.register({ cwd: "/fixture", roots: ["/fixture"], writableRoots: [],
    sandboxPolicy: { type: "readOnly", networkAccess: false }, tools: [] }, 60000);
  const files = [{ name: "codex-context-1-of-2.json", text: JSON.stringify({ data: "x".repeat(80000) }) },
    { name: "codex-context-2-of-2.json", text: '{"end":true}' }];
  broker.setContextFiles(token, files);
  const sockets = new Set<Socket>();
  let dropped = false;
  const proxy = createServer(downstream => {
    sockets.add(downstream);
    let buffer = "", connected = false;
    downstream.on("error", () => {});
    downstream.on("close", () => sockets.delete(downstream));
    downstream.on("data", data => {
      if (connected) return;
      buffer += data.toString();
      if (!buffer.includes("\n")) return;
      connected = true;
      const request = JSON.parse(buffer.split("\n")[0]!);
      const drop = !dropped && request.method === "read_context" && request.contextOffset === 48000;
      if (drop) dropped = true;
      const upstream = createConnection(address("broker"), () => upstream.write(buffer));
      sockets.add(upstream);
      upstream.on("error", () => downstream.destroy());
      upstream.on("close", () => sockets.delete(upstream));
      upstream.on("end", () => { if (!drop) downstream.end(); });
      downstream.on("close", () => upstream.destroy());
      upstream.on("data", response => {
        // The broker has processed the read, but the caller never receives this one response.
        if (!drop) downstream.write(response);
      });
    });
  });
  await new Promise<void>(resolve => proxy.listen(address("proxy"), resolve));
  const client = new Client({ name: "context-loss-test", version: "1" });
  await client.connect(new StdioClientTransport({ command: process.execPath,
    args: ["src/cli.ts", "mcp", "--broker-socket", address("proxy")], cwd: process.cwd(), stderr: "pipe" }));
  const read = (name: string, offset: number) => client.callTool({ name: "codex_context_read", arguments: { turn_token: token, name, offset } });
  const page = (response: unknown) => JSON.parse((response as { content: Array<{ text: string }> }).content[0]!.text) as NativeContextPage;
  try {
    let reconstructed = "";
    for (const offset of [0, 12000, 24000, 36000]) reconstructed += page(await read(files[0]!.name, offset)).text;
    const failed = await read(files[0]!.name, 48000);
    expect(failed.isError).toBe(true);
    expect(JSON.stringify(failed)).toMatch(/timeout|timed out/i);
    const recovered = await read(files[0]!.name, 48000);
    expect(recovered.isError).not.toBe(true);
    let current = page(recovered);
    reconstructed += current.text;
    while (current.next_offset !== null) {
      current = page(await read(files[0]!.name, current.next_offset));
      reconstructed += current.text;
    }
    expect(reconstructed).toBe(files[0]!.text);
    expect(page(await read(files[1]!.name, 0)).text).toBe(files[1]!.text);
    const revision = broker.beginCompletionFence(token);
    expect(broker.commitCompletionFence(token, revision!)).toBe(true);
    expect(dropped).toBe(true);
  } finally {
    await client.close();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => proxy.close(() => resolve()));
    broker.revoke(token); await broker.close();
  }
}, 30000);

import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { defaultBrokerEndpoint } from "../src/config";
import { TurnBroker } from "../src/adapters/chatgpt-web/turn-broker";
import { nativeContextPrompt, type NativeContextPage, type NativeContextReadError } from "../src/adapters/chatgpt-web/native-context";

function payload<T>(response: unknown): T {
  const parts = (response as { content: Array<{ type: string; text?: string }> }).content;
  expect(parts[0]?.type).toBe("text");
  return JSON.parse(parts[0]!.text!);
}

test("the real MCP path recovers a third-page receipt typo, retains the work gate and reads the latest request", async () => {
  const home = mkdtempSync(join(tmpdir(), "cgr-"));
  const socket = process.platform === "win32" ? defaultBrokerEndpoint(home, "win32") : join(home, "broker.sock");
  const broker = TurnBroker.forSocket(socket);
  const files = [
    { name: "codex-context-1-of-2.json", text: JSON.stringify({ history: "abc ".repeat(8000) }) },
    { name: "codex-context-2-of-2.json", text: JSON.stringify({ latestRequest: "verify-receipt-recovery", marker: "latest-request-is-present" }) },
    { name: "codex-input-image-1", kind: "image" as const, text: "", imageData: "AQID", mimeType: "image/png" },
    { name: "codex-evidence-0123456789abcdef.txt", kind: "evidence" as const, required: false, text: "over-budget evidence" },
  ];
  const token = await broker.register({ cwd: home, roots: [home], writableRoots: [],
    sandboxPolicy: { type: "readOnly", networkAccess: false },
    tools: [{ name: "connection_probe", description: "Return a fixture value", parameters: { type: "object", properties: {}, additionalProperties: false } }],
  }, 30000, "receipt-recovery-fixture");
  broker.setContextFiles(token, files, { requireReceipts: true, optionalTokenBudget: 0 });
  const client = new Client({ name: "receipt-recovery-test", version: "1" });
  const transport = new StdioClientTransport({ command: process.execPath, args: ["src/cli.ts", "mcp", "--broker-socket", socket],
    cwd: process.cwd(), stderr: "pipe", env: { ...process.env, CODEX_CHATGPT_WEB_HOME: home } as Record<string, string> });
  try {
    await client.connect(transport);
    const read = (args: { name: string; offset: number; receipt?: string }) => client.callTool({
      name: "codex_context_read", arguments: { turn_token: token, ...args },
    }, undefined, { timeout: 3000 });
    const first = payload<NativeContextPage>(await read({ name: files[0]!.name, offset: 0 }));
    const second = payload<NativeContextPage>(await read(first.next_read!));
    const bad = await read({ ...second.next_read!, receipt: "z".repeat(43) });
    expect(bad.isError).toBe(true);
    const failure = payload<NativeContextReadError>(bad);
    expect(failure).toMatchObject({ code: "context_receipt_invalid", retryable: false,
      recovery: { action: "reread_context_page", read: { name: second.name, offset: second.offset } } });
    expect(JSON.stringify(failure)).not.toContain("z".repeat(43));
    const incompleteRevision = await broker.beginCompletionFence(token);
    expect(incompleteRevision).toBeDefined();
    expect(() => broker.commitCompletionFence(token, incompleteRevision!)).toThrow("Required context delivery incomplete");
    const guarded = await client.callTool({ name: "codex_tool_call", arguments: {
      turn_token: token, wire_name: "connection_probe", arguments: {},
    } });
    expect(guarded.isError).toBe(true);
    expect(JSON.stringify(guarded.content)).toContain("no work was executed");
    const replay = payload<NativeContextPage>(await read(failure.recovery!.read));
    expect(replay).toEqual(second);
    let page = payload<NativeContextPage>(await read(replay.next_read!));
    let history = first.text + second.text + page.text;
    while (page.next_offset !== null) {
      page = payload<NativeContextPage>(await read(page.next_read!)); history += page.text;
    }
    expect(history).toBe(files[0]!.text);
    expect(payload<NativeContextPage>(await read(page.next_read!)).acknowledged).toBe(true);
    const latest = payload<NativeContextPage>(await read({ name: files[1]!.name, offset: 0 }));
    expect(latest.text).toContain("latest-request-is-present");
    expect(payload<NativeContextPage>(await read(latest.next_read!)).acknowledged).toBe(true);
    const image = await read({ name: files[2]!.name, offset: 0 });
    expect((image.content as any[])[1]).toMatchObject({ type: "image", data: "AQID" });
    const imagePage = payload<NativeContextPage>(image);
    const imageError = payload<NativeContextReadError>(await read({ ...imagePage.next_read!, receipt: "y".repeat(43) }));
    const imageReplay = await read(imageError.recovery!.read);
    expect(imageReplay.content).toEqual(image.content);
    const budgetError = await read({ name: files[3]!.name, offset: 0, receipt: imagePage.receipt });
    expect(budgetError.isError).toBe(true);
    expect(JSON.stringify(budgetError.content)).toContain("budget");
    const rejectedReadRevision = await broker.beginCompletionFence(token);
    expect(() => broker.commitCompletionFence(token, rejectedReadRevision!)).toThrow("Required context delivery incomplete");
    const stillGuarded = await client.callTool({ name: "codex_tool_call", arguments: {
      turn_token: token, wire_name: "connection_probe", arguments: {},
    } });
    expect(stillGuarded.isError).toBe(true);
    expect(JSON.stringify(stillGuarded.content)).toContain("no work was executed");
    expect(payload<NativeContextPage>(await read(payload<NativeContextPage>(imageReplay).next_read!)).acknowledged).toBe(true);
    const invocation = client.callTool({ name: "codex_tool_call", arguments: {
      turn_token: token, wire_name: "connection_probe", arguments: {},
    } });
    const [call] = await broker.nextToolBatch(token);
    expect(call!.wireName).toBe("connection_probe");
    broker.completeTool(token, call!.callId, { content: [{ type: "text", text: "RECOVERED_CONTEXT_TOOL_OK" }] });
    expect(JSON.stringify((await invocation).content)).toContain("RECOVERED_CONTEXT_TOOL_OK");
    const revision = await broker.beginCompletionFence(token);
    expect(revision).toBeDefined();
    expect(await broker.commitCompletionFence(token, revision!)).toBe(true);
    broker.revoke(token);
    expect((await read({ name: files[0]!.name, offset: 0 })).isError).toBe(true);
  } finally {
    await client.close(); broker.revoke(token); await broker.close(); rmSync(home, { recursive: true, force: true });
  }
}, 20000);

test("the context prompt distinguishes bounded input correction from access rejection", () => {
  const prompt = nativeContextPrompt({ text: "", images: [], conversationState: "fresh",
    multipart: { parts: ["{}", "{}"], commit: "fixture commit" },
  }).text;
  expect(prompt).toContain("recovery.action=reread_context_page");
  expect(prompt).toContain("Copy the returned next_read exactly");
  expect(prompt).toContain("safety rejection and invalid-offset errors are terminal");
  expect(prompt).not.toContain("invalid-offset and invalid-receipt errors are terminal");
});

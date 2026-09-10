import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { randomUUID } from "node:crypto";
import { defaultBrokerEndpoint } from "../src/config";
import { agentReportingInstructions, captureAgentIssue, AGENT_REPORT_TOOL } from "../src/agent-reporting";
import { nativeContextPrompt } from "../src/adapters/chatgpt-web/native-context";
import { TurnBroker } from "../src/adapters/chatgpt-web/turn-broker";
const { ErrorReportStore, DEFAULT_REPORT_RECIPIENT } = require("../launcher/electron/error-report-store.cjs");

async function fixture(action: (home: string, store: any) => Promise<void> | void) {
  const home = mkdtempSync(join(tmpdir(), "maria-agent-report-"));
  const previous = process.env.CODEX_CHATGPT_WEB_HOME;
  process.env.CODEX_CHATGPT_WEB_HOME = home;
  try { await action(home, new ErrorReportStore(home)); }
  finally {
    if (previous === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME; else process.env.CODEX_CHATGPT_WEB_HOME = previous;
    rmSync(home, { recursive: true, force: true });
  }
}

test("Mikkel is the default recipient; agent instructions require local reporting consent", () => fixture((_home, store) => {
  expect(store.settings().recipient).toBe("Mikkel.mynderup@gmail.com");
  expect(agentReportingInstructions()).toBe("");
  store.configure({ enabled: true, recipient: DEFAULT_REPORT_RECIPIENT, includeResponses: true });
  const compiled = { text: "", images: [], multipart: { parts: ["{}", "{}"] as [string, string], commit: "Execute the current task" } };
  expect(nativeContextPrompt(compiled).text).not.toContain("<maria_agent_error_reporting>");
  const prompt = nativeContextPrompt(compiled, undefined, { allowAgentReporting: true });
  expect(prompt.text).toContain(DEFAULT_REPORT_RECIPIENT);
  expect(prompt.text).toContain(`query=${AGENT_REPORT_TOOL}`);
  expect(prompt.text).toContain("independently available Gmail connector");
  expect(prompt.text).toContain("Do not send Gmail if the incident was already queued");
  expect(prompt.text).toContain("Disabled reporting, withdrawn consent, missing sender credentials");
  expect(prompt.text).toContain("do not retry through another account");
  store.configure({ ...store.settings(), includeResponses: false });
  expect(agentReportingInstructions()).toContain("do not include response text");
  store.configure({ ...store.settings(), enabled: false });
  expect(agentReportingInstructions()).toBe("");
}));

test("agent evidence is bounded, redacted, deduplicated and cannot supply recipients or task identity", () => fixture((_home, store) => {
  store.configure({ enabled: true, recipient: DEFAULT_REPORT_RECIPIENT, includeResponses: true });
  const issue = { stage: "command", error: "Tool read not found", tool: "read", operation: "Read the local API module",
    expected: "File contents", actual: "No result returned", completedWork: "Build passed", remainingWork: "Inspect API module",
    recoveryAttempted: "Inspected the advertised schema", hypothesis: "An outdated catalog may be involved; unverified",
    attempts: 1, webResponse: "Observed Web text\npassword=do-not-export", codexResponse: "Observed Codex text" };
  const result = captureAgentIssue("trusted-trace", issue);
  expect(result).toMatchObject({ recorded: true, deliveryState: "pending", emailAccepted: false, inboxVerified: false });
  expect(result).not.toHaveProperty("emailSent", true);
  const duplicate = captureAgentIssue("trusted-trace", issue);
  expect(duplicate).toMatchObject({ duplicate: true, reportId: result.reportId });
  const report = store.records()[0];
  expect(store.records()).toHaveLength(1); expect(report.traceId).toBe("trusted-trace");
  expect(report.agentDetails.completedWork.text).toBe("Build passed");
  expect(report.agentDetails.hypothesis.text).toContain("unverified");
  expect(report.observations).toBe(2); expect(report.reportedAttempts).toBe(1);
  expect(JSON.stringify(report)).not.toContain("do-not-export");
  for (const extra of [{ recipient: "stranger@example.com" }, { traceId: "someone-else" }, { attachments: ["/private"] }, { cmd: "execute this" }]) {
    expect(() => captureAgentIssue("trusted-trace", { ...issue, ...extra })).toThrow();
  }
  expect(() => captureAgentIssue("trusted-trace", { ...issue, webResponse: "x".repeat(32769) })).toThrow();
  store.configure({ ...store.settings(), includeResponses: false });
  const limited = captureAgentIssue("no-response-consent", issue);
  expect(store.read(limited.reportId).responses.web.available).toBe(false);
  expect(store.read(limited.reportId).agentDetails).toEqual({});
}));

test("agent reporting works through the real MCP broker with broken native execution and unread required context", () => fixture(async (home, store) => {
  store.configure({ enabled: true, recipient: DEFAULT_REPORT_RECIPIENT, includeResponses: true });
  const base = join(tmpdir(), `mar-${randomUUID().slice(0, 8)}`);
  const socket = process.platform === "win32" ? defaultBrokerEndpoint(base, "win32") : `${base}.sock`;
  const broker = TurnBroker.forSocket(socket);
  const token = await broker.register({ cwd: home, roots: [home], writableRoots: [], sandboxPolicy: { type: "readOnly", networkAccess: false },
    tools: [{ name: "exec", description: "Fixture: native execution is unavailable", parameters: {}, freeform: true }] }, 60000, "trusted-broker-trace");
  const probeToken = await broker.register({ cwd: home, roots: [home], writableRoots: [], sandboxPolicy: { type: "readOnly", networkAccess: false }, tools: [] }, 60000, "isolated-probe");
  const client = new Client({ name: "agent-report-fixture", version: "1" });
  const transport = new StdioClientTransport({ command: process.execPath, args: ["src/cli.ts", "mcp", "--broker-socket", socket],
    cwd: process.cwd(), stderr: "pipe", env: { ...process.env, CODEX_CHATGPT_WEB_HOME: home } as Record<string, string> });
  const invoke = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }, undefined, { timeout: 3000 });
  try {
    broker.setContextFiles(token, [{ name: "codex-context-1-of-2.json", text: JSON.stringify({ instructions: "Required instructions not read" }), required: true }], { requireReceipts: true, allowAgentReporting: true });
    broker.setContextFiles(probeToken, [{ name: "codex-context-1-of-2.json", text: "{}", required: true }], { requireReceipts: true });
    await client.connect(transport);
    const scopedOut = await invoke("codex_tool_inventory", { turn_token: probeToken, query: AGENT_REPORT_TOOL });
    expect(scopedOut.structuredContent).toMatchObject({ total: 0, tools: [] });
    const forbidden = await invoke("codex_tool_call", { turn_token: probeToken, wire_name: AGENT_REPORT_TOOL, arguments: { stage: "context", error: "Must not email from a probe" } });
    expect(forbidden.isError).toBe(true);
    expect(store.records()).toHaveLength(0);
    const inventory = await invoke("codex_tool_inventory", { turn_token: token, query: AGENT_REPORT_TOOL });
    expect(inventory.structuredContent).toMatchObject({ total: 1, tools: [{ wire_name: AGENT_REPORT_TOOL, kind: "function" }] });
    const tools = await client.listTools(); expect(tools.tools).toHaveLength(8); // Public connector ABI stays stable.
    const args = { turn_token: token, wire_name: AGENT_REPORT_TOOL, arguments: { error: "Required context read failed", stage: "context", completedWork: "One previously verified change" } };
    const first = await invoke("codex_tool_call", args);
    if (first.isError) throw new Error(`Agent-report integration failed: ${JSON.stringify(first.content)}`);
    expect(first.structuredContent).toMatchObject({ recorded: true, deliveryState: "pending" });
    const duplicate = await invoke("codex_tool_call", args);
    expect(duplicate.structuredContent).toMatchObject({ duplicate: true });
    expect(store.records()).toHaveLength(1); expect(store.records()[0].traceId).toBe("trusted-broker-trace");
    const revision = await broker.beginCompletionFence(token);
    expect(revision).toBeDefined();
    expect(() => broker.commitCompletionFence(token, revision!)).toThrow("Required context delivery incomplete");
    const command = await invoke("codex_tool_call", { turn_token: token, wire_name: "exec", input: "must not execute" });
    expect(command.isError).toBe(true);
    expect(JSON.stringify(command)).toContain("Required context acknowledgement is incomplete");
    store.configure({ ...store.settings(), enabled: false });
    expect((await invoke("codex_tool_call", args)).isError).toBe(true);
    broker.revoke(token);
    expect((await invoke("codex_tool_call", args)).isError).toBe(true);
    expect(store.records()).toHaveLength(1);
    console.log("AGENT_REPORT_MCP_OK no-native-execution unread-context fixed-recipient deduplicated isolated-probes-excluded no-permission-expansion");
  } finally { await client.close(); broker.revoke(token); broker.revoke(probeToken); await broker.close(); }
}), 15000);

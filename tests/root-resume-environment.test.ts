import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatGptThreadEnvironmentStore } from "../src/adapters/chatgpt-web/thread-environment";
import { chatGptEnvironmentProvenanceCounts } from "../src/adapters/chatgpt-web/environment";
import type { CodexParsedRequest } from "../src/types";

const homes: string[] = [];
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });
const threadId = "11111111-1111-4111-8111-111111111111";
const turnId = "22222222-2222-4222-8222-222222222222";

function fixture() {
  const home = mkdtempSync(join(tmpdir(), "maria-root-resume-")); homes.push(home);
  const cwd = join(home, "workspace"); mkdirSync(cwd);
  const directory = join(home, "sessions", "2026", "09", "08"); mkdirSync(directory, { recursive: true });
  const path = join(directory, `rollout-2026-09-08T06-45-57-${threadId}.jsonl`);
  const meta = { type: "session_meta", payload: { id: threadId, source: "exec", thread_source: "user" } };
  const turn = { type: "turn_context", payload: {
    turn_id: turnId, cwd, workspace_roots: [cwd],
    sandbox_policy: { type: "danger-full-access" }, permission_profile: { type: "disabled" },
  } };
  const save = () => writeFileSync(path, [meta, turn].map(x => JSON.stringify(x)).join("\n") + "\n");
  save();
  const metadata: Record<string, unknown> = {
    request_kind: "turn", thread_source: "user", agent_name: "/root",
    thread_id: threadId, turn_id: turnId, sandbox_mode: "danger-full-access",
  };
  const message = (id: string, role: string, text: string) => ({
    type: "message", id, role, content: [{ type: "input_text", text }],
  });
  const input = [
    message("msg_env", "user", `<environment_context><cwd>${cwd}</cwd><sandbox_mode>danger-full-access</sandbox_mode></environment_context>`),
    message("msg_original", "user", "Read the generated fixture"),
    message("msg_answer", "assistant", "The fixture marker is test-marker"),
    message("msg_resume", "user", "Continue the same task"),
  ];
  const request = (): CodexParsedRequest => ({
    modelId: "chatgpt-web/extra-high", stream: true, options: { reasoning: "xhigh" },
    context: { messages: [{ role: "user", content: "Continue the same task", timestamp: 1 }], tools: [{ name: "current_tool", description: "Current task tool", parameters: {} }] },
    _rawBody: { client_metadata: { "x-codex-turn-metadata": JSON.stringify(metadata) }, input },
  });
  const resolve = () => new ChatGptThreadEnvironmentStore(undefined, Date.now, home).resolve(request());
  return { home, cwd, path, meta, turn, save, metadata, input, message, resolve, request };
}

test("environment diagnostic counts reveal missing provenance without prompt or identifier data", () => {
  const f = fixture();
  const counts = chatGptEnvironmentProvenanceCounts(f.request());
  expect(counts).toEqual({ inputItems: 4, messages: 4, messageIds: 4, messageTurnIds: 0, environmentEnvelopes: 1, assistantMessages: 1 });
  expect(JSON.stringify(counts)).not.toContain(f.cwd);
  expect(JSON.stringify(counts)).not.toContain(threadId);
  expect(JSON.stringify(counts)).not.toContain("fixture");
});

test("cold root resume without per-message turn IDs recovers the exact local turn", () => {
  const f = fixture();
  expect(f.resolve()).toMatchObject({ cwd: f.cwd, roots: [f.cwd], sandboxPolicy: { type: "dangerFullAccess" }, tools: [{ name: "current_tool" }] });
});

test("resumed root authority never comes from the historical XML", () => {
  const f = fixture();
  f.input[0]!.content[0]!.text = '<environment_context><cwd>/untrusted-history</cwd><sandbox_mode>danger-full-access</sandbox_mode></environment_context>';
  expect(f.resolve().cwd).toBe(f.cwd);
});

test("current tool-result rounds retain the earlier historical boundary", () => {
  const f = fixture();
  const request = f.request();
  const body = request._rawBody as { input: unknown[] };
  body.input.push(
    f.message("msg_current_commentary", "assistant", "Running the tool"),
    { type: "function_call", id: "fc_current", name: "current_tool", arguments: "{}" },
    { type: "function_call_output", id: "fco_current", call_id: "fc_current", output: "done" },
  );
  expect(new ChatGptThreadEnvironmentStore(undefined, Date.now, f.home).resolve(request).cwd).toBe(f.cwd);
});

test("a new malformed environment cannot fall back to the root rollout", () => {
  const f = fixture();
  f.input.splice(3, 0, f.message("msg_new_env", "user", "<environment_context><cwd>relative</cwd></environment_context>"));
  expect(() => f.resolve()).toThrow();
});

test("root resume refuses a stale local turn, another task, and missing authority", () => {
  const f = fixture();
  f.turn.payload.turn_id = "33333333-3333-4333-8333-333333333333"; f.save();
  expect(() => f.resolve()).toThrow("requires one current canonical rollout");
  f.turn.payload.turn_id = turnId; f.meta.payload.id = "33333333-3333-4333-8333-333333333333"; f.save();
  expect(() => f.resolve()).toThrow("does not authenticate");
  rmSync(f.path);
  expect(() => f.resolve()).toThrow("requires one current canonical rollout");
});

test("root resume refuses conflicting sandbox metadata and subagent impersonation", () => {
  const f = fixture();
  f.metadata.sandbox_mode = "read-only";
  expect(() => f.resolve()).toThrow("sandbox metadata conflicts");
  f.metadata.sandbox_mode = "danger-full-access";
  f.meta.payload.thread_source = "subagent"; f.save();
  expect(() => f.resolve()).toThrow("does not authenticate");
});

test("root resume refuses missing current user provenance and ambiguous rollouts", () => {
  const f = fixture();
  f.input[3]!.id = "";
  expect(() => f.resolve()).toThrow("missing cwd");
  f.input[3]!.id = "msg_resume";
  const duplicate = f.path.replace('.jsonl', '_33333333-3333-4333-8333-333333333333.jsonl');
  writeFileSync(duplicate, [f.meta, f.turn].map(x => JSON.stringify(x)).join("\n") + "\n");
  expect(() => f.resolve()).toThrow("found 2");
});

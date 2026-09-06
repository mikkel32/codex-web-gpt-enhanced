import { test, expect } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ChatGptConversationCursors } from "../src/adapters/chatgpt-web/conversation-key";
import { parseRequest } from "../src/responses/parser";
import { nativeMessageTurnId } from "../src/responses/message-provenance";
import { expandPreviousResponseInput, flushResponseState, rememberResponseState } from "../src/responses/state";
import { ResponseHistoryStore } from "../src/responses/history-store";
import type { CodexParsedRequest } from "../src/types";

const key = "a".repeat(64);
const item = (role: "user" | "assistant", text: string, turnId: string, phase?: "commentary" | "final_answer") => ({
  type: "message", role, content: text, ...(role === "assistant" ? { id: `msg_${turnId}` } : {}), ...(phase ? { phase } : {}),
  internal_chat_message_metadata_passthrough: { turn_id: turnId },
});
function wire(items: unknown[], turnId: string): CodexParsedRequest {
  const parsed = parseRequest({ model: "gpt-5.6-sol", stream: true, input: items,
    client_metadata: { "x-codex-turn-metadata": JSON.stringify({ thread_id: "thread_cursor", turn_id: turnId }) },
  });
  parsed.context.messages.forEach((message, index) => { message.timestamp = index + 1; });
  return parsed;
}
const sourceItem = () => item("user", "Fix the widget", "turn_web");
const answerItem = () => item("assistant", "Widget fixed", "turn_web", "final_answer");
const followupItem = () => item("user", "Now test it", "turn_next");
const input = () => wire([sourceItem()], "turn_web");
const next = () => wire([sourceItem(), answerItem(), followupItem()], "turn_next");
function commit(store: ChatGptConversationCursors, source = input()): void {
  store.commit(key, source, "Widget fixed");
  store.recordOutput(key, source, { status: "completed", output: [answerItem()] });
}

test("retained context omits only a proven prefix, with no extra stored transcript", () => {
  const root = mkdtempSync(join(tmpdir(), "maria-cursors-"));
  const file = join(root, "cursors.json");
  try {
    commit(new ChatGptConversationCursors(file));
    const restored = new ChatGptConversationCursors(file);
    const plan = restored.resume(key, next());
    expect(plan.mode).toBe("delta");
    expect(plan.omitted).toBe(2);
    expect(plan.parsed.context.messages).toEqual(next().context.messages.slice(2));
    expect(readFileSync(file, "utf8")).not.toContain("Widget");
    const native = next();
    native.context.messages.push(
      { role: "assistant", content: [{ type: "text", text: "Native Codex ran the tests" }], timestamp: 4 },
      { role: "user", content: "Continue on Web", timestamp: 5 },
    );
    expect(restored.resume(key, native).parsed.context.messages).toEqual(native.context.messages.slice(2));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("compaction, edited ancestors, ambiguous answers, and missing cursors preserve canonical context", () => {
  const store = new ChatGptConversationCursors();
  commit(store);
  const changed = next();
  changed.context.messages[0] = { role: "user", content: "New checkpoint: Widget fixed, tests pending", timestamp: 1 };
  expect(store.resume(key, changed).mode).toBe("snapshot");
  const ambiguous = next();
  ambiguous.context.messages.splice(2, 0, next().context.messages[1]!);
  expect(store.resume(key, ambiguous).mode).toBe("snapshot");
  expect(store.resume("b".repeat(64), next()).mode).toBe("snapshot");
  const missingParent = next();
  missingParent.context.messages.splice(1, 1);
  expect(store.resume(key, missingParent).mode).toBe("snapshot");
});

test("same wording from a different native turn cannot erase intervening work", () => {
  const store = new ChatGptConversationCursors();
  commit(store);
  const unrelated = wire([sourceItem(), item("user", "Native work that Web has not seen", "turn_native"),
    item("assistant", "Widget fixed", "turn_native", "final_answer"), followupItem()], "turn_next");
  expect(store.resume(key, unrelated).mode).toBe("snapshot");
  expect(store.resume(key, unrelated).parsed).toBe(unrelated);
});

test("native provenance disambiguates repeated short answers and preserves later native turns", () => {
  const store = new ChatGptConversationCursors();
  commit(store);
  const repeated = wire([sourceItem(), answerItem(), item("user", "Native follow-up", "turn_native"),
    item("assistant", "Widget fixed", "turn_native", "final_answer"), followupItem()], "turn_next");
  const plan = store.resume(key, repeated);
  expect(plan.mode).toBe("delta");
  expect(plan.omitted).toBe(2);
  expect(plan.parsed.context.messages).toEqual(repeated.context.messages.slice(2));
  expect(nativeMessageTurnId(repeated.context.messages[1]!)).toBe("turn_web");
  expect(JSON.stringify(repeated.context.messages)).not.toContain("turn_web");
});

test("commentary, missing provenance, and new instructions before the answer require complete context", () => {
  const store = new ChatGptConversationCursors();
  commit(store);
  for (const answer of [item("assistant", "Widget fixed", "turn_web", "commentary"),
    { type: "message", role: "assistant", content: "Widget fixed", phase: "final_answer" },
    { ...answerItem(), internal_chat_message_metadata_passthrough: { turn_id: 42 } }]) {
    expect(store.resume(key, wire([sourceItem(), answer, followupItem()], "turn_next")).mode).toBe("snapshot");
  }
  const steering = wire([sourceItem(), item("user", "New constraints during execution", "turn_web"), answerItem(), followupItem()], "turn_next");
  expect(store.resume(key, steering).mode).toBe("snapshot");
  const tools = wire([sourceItem(), { type: "function_call", name: "exec", call_id: "call_test", arguments: "{}" },
    { type: "function_call_output", call_id: "call_test", output: "test passed" }, answerItem(), followupItem()], "turn_next");
  expect(store.resume(key, tools).mode).toBe("delta");
  expect(store.resume(key, tools).parsed.context.messages).toEqual(tools.context.messages.slice(-1));
});

test("legacy cursors retain the conversation but require one full snapshot to establish turn provenance", () => {
  const root = mkdtempSync(join(tmpdir(), "maria-cursor-migrate-"));
  const file = join(root, "cursor.json");
  try {
    const store = new ChatGptConversationCursors(file);
    commit(store);
    const legacy = JSON.parse(readFileSync(file, "utf8"));
    delete legacy.cursors[key].sourceTurnId;
    writeFileSync(file, JSON.stringify(legacy));
    expect(store.hasCompletedConversation(key)).toBe(true);
    expect(store.resume(key, next()).mode).toBe("snapshot");
    commit(store);
    expect(new ChatGptConversationCursors(file).resume(key, next()).mode).toBe("delta");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("previous-response expansion and restart retain locally generated answer provenance without mutating output", () => {
  const root = mkdtempSync(join(tmpdir(), "maria-cursor-chain-"));
  const previousHome = process.env.CODEX_CHATGPT_WEB_HOME;
  process.env.CODEX_CHATGPT_WEB_HOME = root;
  try {
    const source = input();
    const output = { id: "msg_turn_web", type: "message", role: "assistant", phase: "final_answer", content: "Widget fixed" };
    rememberResponseState(source._rawBody, { id: "response_web", status: "completed", output: [output] }, { nativeTurnId: "turn_web" });
    expect(output).not.toHaveProperty("internal_chat_message_metadata_passthrough");
    const cursorPath = join(root, "cursors.json");
    const cursors = new ChatGptConversationCursors(cursorPath);
    commit(cursors, source);
    const followup = { ...(next()._rawBody as Record<string, unknown>), previous_response_id: "response_web", input: [followupItem()] };
    const expanded = parseRequest(expandPreviousResponseInput(followup));
    expect(cursors.resume(key, expanded).mode).toBe("delta");
    expect(cursors.resume(key, expanded).parsed.context.messages).toEqual(expanded.context.messages.slice(-1));
    flushResponseState();
    const restoredInput = new ResponseHistoryStore({ path: join(root, "responses-state.json") }).expand("response_web")!;
    const restored = parseRequest({ ...followup, input: [...restoredInput, followupItem()] });
    expect(new ChatGptConversationCursors(cursorPath).resume(key, restored).mode).toBe("delta");
  } finally {
    flushResponseState();
    if (previousHome === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME; else process.env.CODEX_CHATGPT_WEB_HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
});

test("a native turn alone is insufficient: trimming requires an emitted answer item receipt", () => {
  const store = new ChatGptConversationCursors();
  store.commit(key, input(), "Widget fixed");
  expect(store.resume(key, next()).mode).toBe("snapshot");
  store.recordOutput(key, input(), { status: "completed", output: [answerItem()] });
  const impostor = wire([sourceItem(), { ...answerItem(), id: "msg_another_model_same_turn" }, followupItem()], "turn_next");
  expect(store.resume(key, impostor).mode).toBe("snapshot");
  expect(store.resume(key, next()).mode).toBe("delta");
});

test("wire receipt aliases support completed-round replay and reject partial or unrelated output", () => {
  const store = new ChatGptConversationCursors();
  commit(store);
  const replayItem = { ...answerItem(), id: "msg_reobserved" };
  for (const response of [{ status: "incomplete", output: [replayItem] },
    { status: "completed", output: [{ ...replayItem, content: "Different answer" }] },
    { status: "completed", output: [{ ...replayItem, phase: "commentary" }] }]) {
    store.recordOutput(key, input(), response);
    expect(store.resume(key, wire([sourceItem(), replayItem, followupItem()], "turn_next")).mode).toBe("snapshot");
  }
  store.recordOutput(key, input(), { status: "completed", output: [replayItem] });
  expect(store.resume(key, wire([sourceItem(), replayItem, followupItem()], "turn_next")).mode).toBe("delta");
  expect(store.resume(key, next()).mode).toBe("delta");
});

test("timestamp regeneration is harmless and corrupt cursor data falls back to complete Codex history", () => {
  const root = mkdtempSync(join(tmpdir(), "maria-cursor-corrupt-"));
  try {
    const file = join(root, "cursor.json");
    const store = new ChatGptConversationCursors(file);
    commit(store);
    const parsed = next(); parsed.context.messages[0]!.timestamp = 999;
    expect(store.resume(key, parsed).mode).toBe("delta");
    writeFileSync(file, "broken");
    expect(store.resume(key, parsed).parsed).toBe(parsed);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

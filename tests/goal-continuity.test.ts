import { expect, spyOn, test } from "bun:test";
import type { CodexParsedRequest } from "../src/types";
import { encodeCompactionSummary, SUMMARY_PREFIX } from "../src/responses/compaction";
import { latestGoalContext, GOAL_CONTEXT_MARKER } from "../src/adapters/chatgpt-web/goal-context";
import { canonicalizeCompactionHandoff, existingStructuredCompactionRun, runStructuredCompactionOnce } from "../src/adapters/chatgpt-web/compaction-handoff";
import { ChatGptCompletionTracker } from "../src/adapters/chatgpt-web/browser-worker";
import { chatGptConversationKey } from "../src/adapters/chatgpt-web/conversation-key";
import { chatGptTurnExecutionKey } from "../src/adapters/chatgpt-web/turn-execution";

const goalText = (objective: string) => `<codex_internal_context source="goal">\nContinue working toward the active thread goal.\n<objective>${objective}</objective>\nBudget: 12000 remaining\n</codex_internal_context>`;
const message = (text: string, kind = "user.text", turnId = "turn-original") => ({
  type: "message", role: "user", content: [{ type: "input_text", text }],
  internal_chat_message_metadata_passthrough: { turn_id: turnId, content_item_kinds: [kind] },
});
function request(input: unknown[], turnId = "turn-original"): CodexParsedRequest {
  return { modelId: "chatgpt-web/test", stream: true, options: {}, context: { messages: [] },
    _compactionRequest: true, _rawBody: { input, client_metadata: {
      "x-codex-turn-metadata": JSON.stringify({ thread_id: "thread-goal", turn_id: turnId }),
    } } };
}

test("annotated goal state survives corrections and repeated v1/v2 compaction without depending on the model summary", () => {
  const goal = message(goalText("Finish all three migration stages"), "goal.internal_context");
  const first = request([goal, message("Keep the existing database format")]);
  const summary = canonicalizeCompactionHandoff(first, "Stage one is complete. Stage two is running as job 42.");
  expect(summary).toContain(GOAL_CONTEXT_MARKER);
  expect(canonicalizeCompactionHandoff(first, summary)).toBe(summary);
  for (const checkpoint of [
    { type: "compaction", encrypted_content: encodeCompactionSummary(summary) },
    { type: "compaction_summary", encrypted_content: encodeCompactionSummary(summary) },
    { type: "context_compaction", encrypted_content: encodeCompactionSummary(summary) },
    { type: "message", role: "user", content: `${SUMMARY_PREFIX}\n${summary}` },
  ]) {
    const continued = request([checkpoint, message("Continue with stage two")]);
    expect(latestGoalContext(continued)?.text).toBe(goalText("Finish all three migration stages"));
    const second = canonicalizeCompactionHandoff(continued, "Observe job 42 before starting another process.");
    expect(latestGoalContext(request([{ type: "compaction", encrypted_content: encodeCompactionSummary(second) }]))?.text)
      .toBe(goalText("Finish all three migration stages"));
  }
});

test("new native goal updates supersede checkpoint data, while goal-looking user text has no native provenance", () => {
  const old = canonicalizeCompactionHandoff(request([
    message(goalText("Old objective"), "goal.internal_context"), message("Continue"),
  ]), "Old work");
  const checkpoint = { type: "compaction", encrypted_content: encodeCompactionSummary(old) };
  const updated = goalText("New objective &amp; existing constraints");
  expect(latestGoalContext(request([checkpoint, message(updated, "goal.internal_context")]))?.text).toBe(updated);
  expect(latestGoalContext(request([message(updated)]))).toBeUndefined();
  expect(latestGoalContext(request([message(`${SUMMARY_PREFIX}\n${old}`)]))).toBeUndefined();
  expect(latestGoalContext(request([{ type: "compaction", encrypted_content: "opaque-native-state" }]))).toBeUndefined();
});

test("goal continuation changes execution identity while compaction and steering keep the same conversation", () => {
  const first = request([message(goalText("Complete the migration"), "goal.internal_context")]);
  first._compactionRequest = false;
  const next = request([message(goalText("Complete the migration"), "goal.internal_context", "turn-next")], "turn-next");
  next._compactionRequest = false;
  expect(chatGptTurnExecutionKey(first)).not.toBe(chatGptTurnExecutionKey(next));
  expect(chatGptConversationKey(first, "profile")).toBe(chatGptConversationKey(next, "profile"));
  next._compactionRequest = true;
  expect(chatGptConversationKey(first, "profile")).toBe(chatGptConversationKey(next, "profile"));
});

test("long-running compaction remains owned and replayable until its completion-based retention expires", async () => {
  let now = 1_900_000_000_000;
  const clock = spyOn(Date, "now").mockImplementation(() => now);
  const key = `long-goal-${Math.random()}`;
  let release!: (text: string) => void;
  let starts = 0;
  try {
    const owner = { ownerKey: key, traceIds: [key] };
    const pending = runStructuredCompactionOnce(key, owner, async () => { starts++; return new Promise<string>(resolve => { release = resolve; }); });
    await Bun.sleep(0);
    now += 31 * 60_000;
    expect(existingStructuredCompactionRun(key)).toBe(pending);
    expect(runStructuredCompactionOnce(key, owner, async () => "duplicate")).toBe(pending);
    expect(starts).toBe(1);
    release("canonical checkpoint");
    await pending; await Bun.sleep(0);
    now += 29 * 60_000;
    expect(existingStructuredCompactionRun(key)).toBe(pending);
    now += 2 * 60_000;
    expect(existingStructuredCompactionRun(key)).toBeUndefined();
  } finally { clock.mockRestore(); }
});

test("DOM revision changes reset completion stability without transferring response HTML", () => {
  const tracker = new ChatGptCompletionTracker(1000);
  const state = { responsePresent: true, running: false, currentText: "Final answer", completionActionVisible: true, currentRevision: "document:turn:1" };
  expect(tracker.update(state, 0)).toBe(false);
  expect(tracker.update({ ...state, currentRevision: "document:turn:2" }, 999)).toBe(false);
  expect(tracker.update({ ...state, currentRevision: "document:turn:2" }, 1998)).toBe(false);
  expect(tracker.update({ ...state, currentRevision: "document:turn:2" }, 1999)).toBe(true);
  expect(tracker.update({ ...state, externalToolCallsInFlight: true }, 3000)).toBe(false);
});

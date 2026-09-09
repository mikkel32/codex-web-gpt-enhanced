import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ChatGptCompletionTracker, ChatGptTurnDomHealthTracker } from "../src/adapters/chatgpt-web/browser-worker";
import { chatGptResponseObservationError } from "../src/adapters/chatgpt-web/adapter-error";

const partial = { responsePresent: true, running: false, currentText: "partial answer", completionActionVisible: false, progressKey: "reasoning-1" };

test("reasoning progress resets missing-completion health even when final text is unchanged", () => {
  const tracker = new ChatGptTurnDomHealthTracker(1_000, 500, 1_000);
  expect(tracker.update(partial, 1_000)).toBeUndefined();
  expect(tracker.update(partial, 1_900)).toBeUndefined();
  const progressed = { ...partial, progressKey: "reasoning-2" };
  expect(tracker.update(progressed, 2_000)).toBeUndefined();
  expect(tracker.update(progressed, 2_999)).toBeUndefined();
  expect(tracker.update(progressed, 3_000)).toContain("completed-turn action");
});

test("observation gaps and backward clocks cannot count as continuous DOM failure evidence", () => {
  for (const nextAt of [20_000, 500]) {
    const tracker = new ChatGptTurnDomHealthTracker(1_000, 500, 1_000);
    expect(tracker.update(partial, 1_000)).toBeUndefined();
    expect(tracker.update(partial, nextAt)).toBeUndefined();
    expect(tracker.update(partial, nextAt + 999)).toBeUndefined();
    expect(tracker.update(partial, nextAt + 1_000)).toContain("completed-turn action");
  }
});

test("an observation fault clears terminal timers without erasing response history", () => {
  const tracker = new ChatGptTurnDomHealthTracker(1_000, 500, 1_000);
  tracker.update(partial, 1_000);
  const absent = { ...partial, responsePresent: false, currentText: "" };
  tracker.update(absent, 1_200);
  tracker.clear();
  expect(tracker.update(absent, 2_200)).toBeUndefined();
  expect(tracker.update(absent, 3_200)).toContain("response DOM disappeared");
});

test("post-tool final-answer validation starts fresh after reasoning progress or observer faults", () => {
  const tracker = new ChatGptCompletionTracker(100, 1_000);
  tracker.observeToolBatch(1, partial.currentText);
  const terminal = { ...partial, completionActionVisible: true };
  expect(tracker.update(terminal, 1_000)).toBe(false);
  expect(tracker.update({ ...terminal, progressKey: "reasoning-2" }, 2_000)).toBe(false);
  tracker.clearObservation();
  expect(tracker.update(terminal, 3_000)).toBe(false);
  expect(() => tracker.update(terminal, 4_000)).toThrow("after its last Codex tool call");
});

test("DOM failures retain their actual reason as a non-retryable typed error", () => {
  const cause = new Error("observer failure");
  const error = chatGptResponseObservationError("The response DOM disappeared", cause);
  expect(error.code).toBe("chatgpt_response_observation_failed");
  expect(error.retryable).toBe(false);
  expect(error.cause).toBe(cause);
  expect(error.message).toContain("The response DOM disappeared");
  expect(error.message).toContain("No prompt was resent");
});

test("reviewed chats select a connector again without treating them as new conversations", () => {
  const source = readFileSync("src/adapters/chatgpt-web/browser-worker.ts", "utf8");
  expect(source).toContain("surfaceId, undefined, reused, lease.connectorBound === true");
  expect(source).toContain("reuseConnector = reuseConversation");
  expect(source).toMatch(/connectorAttemptBudget,\s+reuseConnector,\s+turn\.retainConversation/);
  expect(source).toContain("error instanceof LauncherTurnReviewRequiredError");
});

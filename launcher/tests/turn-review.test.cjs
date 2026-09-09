const test = require("node:test");
const assert = require("node:assert/strict");
const { confirmTurnReviewed, openSavedTurnForReview, retainTurnForReview, turnReviewRequiredError } = require("../electron/turn-review.cjs");

const key = "a".repeat(64);
const url = "https://chatgpt.com/c/12345678-1234-4321-abcd-123456789012";
const idle = { ready: true, idle: true, draft: false };

function fixture() {
  const entries = new Map([[key, { status: "in-flight", url, connectorIdentity: "Codex Native2", connectorBound: false }]]);
  const events = [];
  const navigations = [];
  const tab = {
    id: "review-tab", traceId: "old_trace", helperPid: 123, conversationKey: key,
    connectorIdentity: "Codex Native2", interactionMode: "automatic", status: "error",
    view: { webContents: {
      getURL: () => url, isDestroyed: () => false,
      executeJavaScript: async () => ({ ...idle }),
      loadURL: async value => { navigations.push(value); },
    } },
  };
  const host = {
    savedConversations: { get: k => entries.get(k), set: (k, value) => entries.set(k, { ...value }) },
    turnTabs: new Map([[tab.id, tab]]), selectedTabId: tab.id, visible: true, surfaceActive: true,
    accessGate: { revision: 1, assertAvailable() {} },
    snapshot: () => ({ status: tab.status }), publishState() {}, writeDescriptor() {}, syncViewVisibility() {},
    logger: { info: event => events.push(event) },
    markTurnTabSurface: async () => {},
    createTurnTab: async () => { host.turnTabs.set(tab.id, tab); return tab; },
    removeTurnTab: removed => host.turnTabs.delete(removed.id),
  };
  retainTurnForReview(host, tab);
  return { host, tab, entries, events, navigations };
}

test("failed submissions retain their uncertain record and expose a distinct review conflict", () => {
  const { host, tab, entries } = fixture();
  assert.match(tab.recoveryId, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(tab.status, "error");
  assert.equal(entries.get(key).status, "in-flight");
  assert.equal(host.turnTabs.get(tab.id), tab);
  assert.equal(turnReviewRequiredError().code, "previous_turn_needs_attention");
});

test("explicit review enables only a fresh request in the same chat with connector re-verification", async () => {
  const { host, tab, entries, events, navigations } = fixture();
  await confirmTurnReviewed(host, tab.id, tab.recoveryId);
  assert.equal(entries.get(key).url, url);
  assert.equal(entries.get(key).status, "ready");
  assert.equal(entries.get(key).connectorBound, false);
  assert.equal(entries.get(key).reviewedInterruption, true);
  assert.equal(tab.status, "ready");
  assert.equal(tab.submissionActivated, false);
  assert.equal(tab.reviewedTraceId, "old_trace");
  assert.equal(tab.recoveryId, undefined);
  assert.deepEqual(navigations, []);
  assert.deepEqual(events, ["browser.interrupted_turn_reviewed"]);
});

test("duplicate review clicks share one observation and do not unlock before it settles", async () => {
  const { host, tab, entries } = fixture();
  let finish;
  let observations = 0;
  tab.view.webContents.executeJavaScript = () => {
    observations += 1;
    return new Promise(resolve => { finish = resolve; });
  };
  const first = confirmTurnReviewed(host, tab.id, tab.recoveryId);
  const second = confirmTurnReviewed(host, tab.id, tab.recoveryId);
  assert.equal(first, second);
  assert.equal(entries.get(key).status, "in-flight");
  assert.equal(observations, 1);
  finish(idle);
  await first;
  assert.equal(entries.get(key).status, "ready");
});

test("a stale review cannot acknowledge a newer failure", async () => {
  const { host, tab, entries } = fixture();
  const oldReview = tab.recoveryId;
  await confirmTurnReviewed(host, tab.id, oldReview);
  entries.set(key, { ...entries.get(key), status: "in-flight" });
  tab.status = "error";
  tab.traceId = "new_trace";
  retainTurnForReview(host, tab);
  assert.notEqual(tab.recoveryId, oldReview);
  await assert.rejects(confirmTurnReviewed(host, tab.id, oldReview), /changed|not open/);
  assert.equal(entries.get(key).status, "in-flight");
});

for (const state of [undefined, {}, { ...idle, idle: false }, { ...idle, ready: false }, { ...idle, draft: true }]) {
  test(`unknown, busy or drafted browser state cannot unlock a chat: ${JSON.stringify(state)}`, async () => {
    const { host, tab, entries } = fixture();
    tab.view.webContents.executeJavaScript = async () => state;
    await assert.rejects(confirmTurnReviewed(host, tab.id, tab.recoveryId), /still working|draft|attention/);
    assert.equal(entries.get(key).status, "in-flight");
  });
}

for (const change of [
  ({ tab }) => { tab.view.webContents.getURL = () => "https://chatgpt.com/c/unrelated-chat"; },
  ({ tab }) => { tab.recoveryId = "b".repeat(32); },
  ({ host, tab }) => { host.turnTabs.delete(tab.id); },
  ({ entries }) => { entries.set(key, { ...entries.get(key) }); },
  ({ host }) => { host.accessGate.revision += 1; },
  ({ host }) => { host.turnTabs.set("other", { conversationKey: key, status: "running" }); },
]) {
  test("review revalidates identity, ownership, saved state and access after asynchronous observation", async () => {
    const f = fixture();
    f.tab.view.webContents.executeJavaScript = async () => { change(f); return idle; };
    await assert.rejects(confirmTurnReviewed(f.host, f.tab.id, f.tab.recoveryId), /changed|not open/);
    assert.equal(f.entries.get(key).status, "in-flight");
  });
}

test("an unseen chat or paused Web access cannot be acknowledged", async () => {
  const { host, tab, entries } = fixture();
  host.visible = false;
  await assert.rejects(confirmTurnReviewed(host, tab.id, tab.recoveryId), /not open/);
  host.visible = true;
  host.accessGate.assertAvailable = () => { throw new Error("Web access paused"); };
  await assert.rejects(confirmTurnReviewed(host, tab.id, tab.recoveryId), /paused/);
  assert.equal(entries.get(key).status, "in-flight");
});

test("restart opens only the exact saved chat for review without leasing it or repeating navigation", async () => {
  const { host, tab, entries, navigations } = fixture();
  let marked = 0;
  host.markTurnTabSurface = async () => { marked += 1; };
  host.turnTabs.clear();
  tab.status = "running";
  const args = [host, "new_trace", 123, key, "Codex Native2", entries.get(key)];
  await Promise.all([openSavedTurnForReview(...args), openSavedTurnForReview(...args)]);
  await openSavedTurnForReview(...args);
  assert.deepEqual(navigations, [url]);
  assert.equal(tab.status, "error");
  assert.equal(entries.get(key).status, "in-flight");
  assert.equal(host.turnTabs.size, 1);
  assert.equal(marked, 1);
});

test("review restoration rejects redirects and preserves the original uncertain record", async () => {
  const { host, tab, entries } = fixture();
  host.turnTabs.clear();
  tab.view.webContents.getURL = () => "https://chatgpt.com/";
  await assert.rejects(openSavedTurnForReview(host, "new_trace", 123, key, "Codex Native2", entries.get(key)), /exact saved conversation/);
  assert.equal(host.turnTabs.size, 0);
  assert.equal(entries.get(key).url, url);
  assert.equal(entries.get(key).status, "in-flight");
});

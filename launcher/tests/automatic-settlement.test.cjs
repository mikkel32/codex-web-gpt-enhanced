const test = require("node:test");
const assert = require("node:assert/strict");
const { BrowserHost } = require("../electron/browser-host.cjs");

function fixture() {
  const url = "https://chatgpt.com/c/retained-fixture-12345678";
  const key = "a".repeat(64);
  const entries = new Map([[key, { url, status: "in-flight", connectorIdentity: "test-connector", connectorBound: true }]]);
  const events = [];
  const tab = { id: "tab", traceId: "trace_000001", helperPid: 123, status: "running",
    conversationKey: key, connectorIdentity: "test-connector", connectorBound: true,
    interactionMode: "automatic", submissionActivated: true,
    view: { webContents: { getURL: () => url, isDestroyed: () => false,
      setBackgroundThrottling: value => events.push(["throttle", value]) } } };
  const host = Object.assign(Object.create(BrowserHost.prototype), {
    turnTabs: new Map([[tab.id, tab]]), selectedTabId: tab.id,
    closedTurnOwners: new Map(), userCancelledTurnOwners: new Map(),
    savedConversations: { get: k => entries.get(k), set: (k, v) => entries.set(k, v) },
    logger: { info: e => events.push(e), warn() {} }, syncPowerSaveBlocker() {},
    syncViewVisibility() {}, snapshot: () => ({}), publishState() {}, writeDescriptor() {},
    removeTurnTab: t => { host.turnTabs.delete(t.id); events.push("removed"); },
  });
  return { host, tab, entries, key, events };
}

test("a failed durable completion write cannot advertise a ready chat", async () => {
  const { host, tab, entries, key, events } = fixture();
  host.savedConversations.set = () => { throw new Error("fixture storage failure"); };
  await assert.rejects(host.endTurn(tab.traceId, 123, "completed", false, undefined, true, true), /storage failure/);
  assert.equal(entries.get(key).status, "in-flight");
  assert.equal(tab.status, "running");
  assert(!events.includes("browser.tab_completed"));
  assert(!events.some(e => Array.isArray(e) && e[0] === "throttle"));
});

test("a late helper failure cannot downgrade an acknowledged retained completion", async () => {
  const { host, tab, entries, key, events } = fixture();
  await host.endTurn(tab.traceId, 123, "completed", false, undefined, true, true);
  const saved = entries.get(key);
  await host.endTurn(tab.traceId, 123, "failed", false, "late helper teardown");
  assert.equal(tab.status, "ready");
  assert.equal(host.turnTabs.get(tab.id), tab);
  assert.equal(entries.get(key), saved);
  assert(!events.includes("removed"));
});

test("uncertain submitted failures still require review and cannot be upgraded by a late completion", async () => {
  const { host, tab, entries, key } = fixture();
  await host.endTurn(tab.traceId, 123, "failed", false, "fixture interrupted");
  const recovery = tab.recoveryId;
  await assert.rejects(host.endTurn(tab.traceId, 123, "completed", false, undefined, true, true), /already ended/);
  assert.equal(tab.status, "error");
  assert.equal(tab.recoveryId, recovery);
  assert.equal(entries.get(key).status, "in-flight");
});

test("a presentation error after the durable commit cannot replace the completed result", async () => {
  const { host, tab, entries, key } = fixture();
  const warnings = [];
  host.logger.warn = event => warnings.push(event);
  host.publishState = () => { throw new Error("fixture renderer unavailable"); };
  assert.deepEqual(await host.endTurn(tab.traceId, 123, "completed", false, undefined, true, true), { cancelledByUser: false });
  assert.equal(tab.status, "ready");
  assert.equal(entries.get(key).status, "ready");
  assert.deepEqual(warnings, ["browser.completed_turn_presentation_failed"]);
});

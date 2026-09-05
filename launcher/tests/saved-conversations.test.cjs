const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { SavedConversations, savedConversationUrl } = require("../electron/saved-conversations.cjs");
const { BrowserHost } = require("../electron/browser-host.cjs");
const { releaseRetainedConversation } = require("../electron/retained-turn-release.cjs");
const key = "a".repeat(64);
const url = "https://chatgpt.com/c/12345678-1234-4321-abcd-123456789012";
const entry = () => ({ url, status: "ready", connectorIdentity: "Codex Native2", connectorBound: true });

function fixture(store, redirect) {
  const navigations = [];
  let currentUrl;
  const host = Object.assign(Object.create(BrowserHost.prototype), {
    savedConversations: store, turnTabs: new Map(), userCancelledTurnOwners: new Map(), manualOperation: null,
    syncViewVisibility() {}, publishState() {}, snapshot() { return {}; }, writeDescriptor() {},
    logger: { info() {}, warn() {} }, markTurnTabSurface: async () => {},
    createTurnTab: async function(traceId, helperPid, conversationKey, connectorIdentity) {
      const tab = { id: "saved-tab", surfaceId: "saved-surface", traceId, helperPid, conversationKey, connectorIdentity,
        status: "running", interactionMode: "automatic", view: { webContents: {
          loadURL: async value => { navigations.push(value); currentUrl = redirect || value; },
          getURL: () => currentUrl, isDestroyed: () => false, setBackgroundThrottling() {},
        } } };
      this.turnTabs.set(tab.id, tab); return tab;
    },
    removeTurnTab(tab) { this.turnTabs.delete(tab.id); },
  });
  return { host, navigations };
}

function withStore(run) {
  return async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "maria-saved-"));
    const file = path.join(root, "saved.json");
    try { await run(new SavedConversations(file), file); }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
  };
}

test("restart restores only the exact saved chat, then locks it against replay until completion", withStore(async (store, file) => {
  store.set(key, entry());
  const restarted = new SavedConversations(file);
  const { host, navigations } = fixture(restarted);
  const lease = await host.beginTurn("trace_restored", false, process.pid, key, "Codex Native2");
  assert.equal(lease.reused, true);
  assert.deepEqual(navigations, [url]);
  assert.equal(restarted.get(key).status, "ready");
  host.rememberConversationSubmission("trace_restored", process.pid);
  assert.equal(restarted.get(key).status, "in-flight");
  await assert.rejects(host.beginTurn("trace_parallel", false, process.pid, key, "Codex Native2"), /already has an active turn/);
  await host.endTurn("trace_restored", process.pid, "completed", false, undefined, true, true);
  assert.equal(new SavedConversations(file).get(key).status, "ready");
  if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  host.removeTurnTab(host.turnTabs.get(lease.tabId));
  const reopened = await host.beginTurn("trace_reopened", false, process.pid, key, "Codex Native2");
  assert.equal(reopened.reused, true);
  assert.deepEqual(navigations, [url, url]);
}));

test("interrupted turns, wrong connectors and redirects never start replacement chats", withStore(async (store, file) => {
  for (const overrides of [{ status: "in-flight" }, { connectorIdentity: "Unrelated" }, { connectorBound: false }, { url: null }]) {
    store.set(key, { ...entry(), ...overrides });
    const { host, navigations } = fixture(new SavedConversations(file));
    await assert.rejects(host.beginTurn("trace_failed", false, process.pid, key, "Codex Native2"), /needs attention/);
    assert.deepEqual(navigations, []);
  }
  store.set(key, entry());
  const { host, navigations } = fixture(store, "https://chatgpt.com/");
  await assert.rejects(host.beginTurn("trace_redirect", false, process.pid, key, "Codex Native2"), /exact saved conversation/);
  assert.deepEqual(navigations, [url]);
  assert.equal(store.get(key).url, url);
}));

test("exact URL validation and explicit release protect durable ownership", withStore(async (store, file) => {
  assert.equal(savedConversationUrl(url), url);
  for (const invalid of [url + "?q=1", url + "#x", url + "/extra", url.replace("chatgpt.com", "chatgpt.com.evil"), url.replace("https:", "http:"), url.replace("chatgpt.com", "user@chatgpt.com")]) assert.equal(savedConversationUrl(invalid), null);
  store.set(key, entry());
  releaseRetainedConversation({ savedConversations: store, turnTabs: new Map() }, key);
  assert.equal(new SavedConversations(file).get(key), undefined);
  fs.writeFileSync(file, "broken");
  assert.throws(() => new SavedConversations(file).get(key), /needs recovery/);
}));

test("existing installed conversation links migrate without changing their keys or URLs", withStore(async (_store, file) => {
  const old = entry(); delete old.status; old.lastUsedAt = Date.now();
  fs.writeFileSync(file, JSON.stringify({ version: 1, conversations: { [key]: old } }));
  const migrated = new SavedConversations(file);
  assert.equal(migrated.get(key).status, "ready");
  assert.equal(migrated.get(key).url, url);
  const { host } = fixture(migrated);
  assert.equal((await host.beginTurn("trace_migrated", false, process.pid, key, "Codex Native2")).reused, true);
  host.rememberConversationSubmission("trace_migrated", process.pid);
  assert.equal(JSON.parse(fs.readFileSync(file)).version, 2);
}));

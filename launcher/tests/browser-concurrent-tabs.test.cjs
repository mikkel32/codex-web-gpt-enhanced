const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { BrowserHost } = require("../electron/browser-host.cjs");

function navigationFixture() {
  const contents = new EventEmitter();
  contents.setWindowOpenHandler = () => {};
  contents.isLoadingMainFrame = () => false;
  contents.getURL = () => "https://chatgpt.com/c/fixture";
  const tab = { id: "tab", interactionMode: "automatic", loading: false, rendererReady: true,
    view: { webContents: contents } };
  let presentations = 0;
  const host = { snapshot: () => ({}), publishState() {}, rememberSubmittedConversationUrl() {},
    syncViewVisibility() { presentations++; } };
  BrowserHost.prototype.bindTurnContents.call(host, tab);
  return { contents, tab, presentations: () => presentations };
}

test("in-page navigation settles without requiring a document load event", () => {
  const { contents, tab } = navigationFixture();
  contents.emit("did-start-navigation", {}, "https://chatgpt.com/c/fixture", true, true);
  assert.equal(tab.loading, false);
  assert.equal(tab.rendererReady, true);
  tab.loading = true;
  contents.emit("did-navigate-in-page", {}, "https://chatgpt.com/c/fixture", true);
  assert.equal(tab.loading, false);
});

test("the document can present before slow subresources finish loading", () => {
  const { contents, tab, presentations } = navigationFixture();
  contents.emit("did-start-navigation", {}, "https://chatgpt.com/c/fixture", false, true);
  assert.equal(tab.rendererReady, false);
  assert.equal(tab.loading, true);
  contents.emit("dom-ready");
  assert.equal(tab.rendererReady, true);
  assert.equal(tab.loading, true);
  assert.equal(presentations(), 1);
});

test("five hidden chats retain small stable viewports through monitor-sized resizes", () => {
  let size = [1120, 720];
  let emulations = 0;
  const host = Object.assign(Object.create(BrowserHost.prototype), { window: { getContentSize: () => size } });
  const tabs = Array.from({ length: 5 }, () => ({ status: "running", rendererReady: true, deviceEmulationDirty: true,
    view: { setBounds() {}, setVisible() {}, webContents: { enableDeviceEmulation() { emulations++; } } } }));
  for (const next of [[1120,720], [1920,1080], [3840,2160], [800,600]]) {
    size = next;
    const bounds = host.hiddenTurnBounds();
    assert.deepEqual([bounds.width, bounds.height], [800,600]);
    assert(bounds.x > size[0] && bounds.y > size[1]);
    tabs.forEach(tab => host.presentTurnView(tab, false));
  }
  assert.equal(emulations, 5, "one emulation per chat, not per window resize");
});

test("restoring a working page only reapplies its native presentation", () => {
  const events = [];
  const view = { webContents: { focus: () => events.push("focus"),
    reload: () => assert.fail("view restoration must not reload"),
    loadURL: () => assert.fail("view restoration must not navigate") } };
  const tab = { id: "current", status: "running", traceId: "same-trace", view };
  const host = Object.assign(Object.create(BrowserHost.prototype), {
    turnTabs: new Map([[tab.id, tab]]), selectedTabId: tab.id,
    visible: true, surfaceActive: true, boundsReady: true,
    window: { contentView: { addChildView: selected => { assert.equal(selected, view); events.push("reattach"); } } },
    syncViewVisibility: () => events.push("present"), snapshot: () => ({}), publishState() {}, writeDescriptor() {},
  });
  host.selectTab(tab.id);
  assert.deepEqual(events, ["present", "reattach", "focus"]);
  assert.equal(tab.status, "running");
  assert.equal(tab.traceId, "same-trace");
  assert.throws(() => host.selectTab("missing"), /does not exist/);
});

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { WebContentsView } = require("electron");
const { BrowserHost } = require("../electron/browser-host.cjs");

module.exports = async function verifyConcurrentViews(window, home) {
  const host = Object.assign(Object.create(BrowserHost.prototype), {
    window, turnTabs: new Map(), bounds: { x: 0, y: 0, width: 800, height: 600 },
    boundsReady: true, surfaceActive: true, visible: false, selectedTabId: "view-0",
    snapshot: () => ({}), publishState() {}, writeDescriptor() {},
    syncViewVisibility() {
      for (const tab of this.turnTabs.values()) this.presentTurnView(tab, false);
    },
  });
  for (let index = 0; index < 5; index++) {
    const view = new WebContentsView({ webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
    window.contentView.addChildView(view);
    await view.webContents.loadFile(path.resolve(__dirname, "../../tests/fixtures/astra-picker.html"));
    const tab = { id: `view-${index}`, traceId: `trace-${index}`, view, status: "running", interactionMode: "automatic", rendererReady: true, deviceEmulationDirty: true };
    host.turnTabs.set(tab.id, tab);
    host.presentTurnView(tab, false);
  }
  for (const [width, height] of [[900,700], [1920,1080], [1100,800]]) {
    window.setContentSize(width, height);
    host.syncViewVisibility();
    for (const tab of host.turnTabs.values()) {
      const viewport = await tab.view.webContents.executeJavaScript("({ width: innerWidth, height: innerHeight })");
      assert.deepEqual(viewport, { width: 800, height: 600 });
    }
  }
  const selected = host.turnTabs.get("view-0");
  let navigations = 0;
  selected.view.webContents.on("did-start-navigation", () => navigations++);
  host.visible = true;
  host.selectTab(selected.id);
  assert.equal(window.contentView.children.at(-1), selected.view);
  assert.equal(navigations, 0);
  assert.equal(selected.status, "running");
  assert.equal(selected.traceId, "trace-0");
  host.visible = false;
  host.syncViewVisibility();
  fs.writeFileSync(path.join(home, "concurrent-views-ready.json"), JSON.stringify({ views: 5, resizeChecks: 15, restorationNavigations: 0 }));
  window.on("closed", () => {
    for (const tab of host.turnTabs.values()) if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
  });
  return host;
};

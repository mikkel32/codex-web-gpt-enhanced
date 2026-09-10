// Offline Electron acceptance fixture. It never opens a ChatGPT account or production profile.
const { app, BrowserWindow, WebContentsView, Menu, session } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../../node_modules/playwright-core");
const { BrowserHost } = require("../electron/browser-host.cjs");
const { removePageInspection } = require("../electron/page-inspection.cjs");

const home = process.env.MARIA_INSPECTION_TEST_HOME;
if (!home || !path.isAbsolute(home)) throw new Error("An isolated inspection test home is required");
app.setPath("userData", home);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("remote-debugging-address", "127.0.0.1");
app.commandLine.appendSwitch("remote-debugging-port", "0");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(predicate, label, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await predicate()) return; await sleep(25); }
  throw new Error(`Inspection fixture timed out: ${label}`);
}

let window;
const views = [];
let observer;
async function inspectorReady(contents, label) {
  await waitFor(() => contents.isDevToolsOpened() && contents.devToolsWebContents
    && !contents.devToolsWebContents.isLoading(), label);
  const tools = contents.devToolsWebContents;
  await waitFor(async () => !tools.isDestroyed()
    && await tools.executeJavaScript("document.readyState === 'complete'"), `${label} frontend`);
}
async function closeInspector(contents) {
  const tools = contents.devToolsWebContents;
  contents.closeDevTools();
  await waitFor(() => !contents.isDevToolsOpened() && (!tools || tools.isDestroyed()), "inspector destruction");
}
app.whenReady().then(async () => {
  // DevTools and fixture assets are local. No account endpoints may be contacted.
  session.defaultSession.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*"] }, (_details, callback) => callback({ cancel: true }));
  window = new BrowserWindow({ show: true, width: 1080, height: 760, title: "Maria inspection test",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
  const errors = [];
  const host = Object.assign(Object.create(BrowserHost.prototype), {
    window, getLanguage: () => "en", shellZoomShortcutBindings: new Map(),
    logger: { warn: event => errors.push(event), error: event => errors.push(event) },
  });
  const fixtureHtml = id => `<!doctype html><meta charset="utf-8"><title>${id}</title>
    <style>body{font:18px system-ui;margin:30px}#inspection-target{padding:30px;border:2px solid}textarea{width:80%;height:80px}</style>
    <h1>${id}</h1><div id="inspection-target" data-fixture="${id}">Inspect this exact element: ${id}</div>
    <textarea>Preserved draft ${id}</textarea><p id="progress">0</p>
    <script>window.fixtureId=${JSON.stringify(id)};window.ticks=0;setInterval(()=>{document.querySelector('#progress').textContent=String(++window.ticks)},100)</script>`;
  const contentsList = [window.webContents];
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(fixtureHtml("Maria interface"))}`);
  for (let index = 0; index < 5; index++) {
    const view = new WebContentsView({ webPreferences: {
      contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false,
    } });
    views.push(view);
    window.contentView.addChildView(view);
    view.setBounds({ x: 1400, y: 900, width: 800, height: 600 });
    await view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(fixtureHtml(`Chat ${index + 1}`))}`);
    contentsList.push(view.webContents);
  }
  for (const contents of contentsList) host.bindShellZoomShortcuts(contents);
  const marker = path.join(home, "DevToolsActivePort");
  await waitFor(() => fs.existsSync(marker), "debugger marker");
  const [port, browserPath] = fs.readFileSync(marker, "utf8").trim().split(/\r?\n/);
  assert.match(port, /^\d{1,5}$/);
  assert.match(browserPath, /^\/devtools\/browser\/[a-z0-9-]+$/i);
  observer = await chromium.connectOverCDP(`ws://127.0.0.1:${port}${browserPath}`, { noDefaults: true });
  let observerDisconnected = false;
  observer.on("disconnected", () => { observerDisconnected = true; });
  const context = observer.contexts()[0];
  let lastMenu;
  const build = Menu.buildFromTemplate;
  Menu.buildFromTemplate = function (template) {
    const menu = build.call(this, template);
    if (template.some(item => item.label === "Inspect element")) lastMenu = menu;
    return menu;
  };
  let inspections = 0;
  try {
    for (const [index, contents] of contentsList.entries()) {
      console.log(`INSPECTION_STAGE surface=${index} context-menu`);
      for (const view of views) view.setBounds({ x: 1400, y: 900, width: 800, height: 600 });
      const view = views[index - 1];
      if (view) view.setBounds({ x: 180, y: 80, width: 800, height: 600 });
      const bounds = view?.getBounds();
      const page = context.pages().find(page => page.url() === contents.getURL());
      assert(page, "the observer must retain this exact fixture page");
      const identity = await page.evaluate(() => ({ id: window.fixtureId, origin: performance.timeOrigin,
        draft: document.querySelector("textarea").value, ticks: window.ticks }));
      let navigations = 0;
      const onNavigation = () => navigations++;
      contents.on("did-start-navigation", onNavigation);
      // Three zooms exercise coordinates local to the embedded page, not the shell.
      contents.setZoomFactor(index % 3 === 0 ? 1 : index % 3 === 1 ? 1.25 : 0.8);
      const rect = await page.locator("#inspection-target").boundingBox();
      assert(rect);
      const zoom = contents.getZoomFactor();
      const point = { x: Math.round((rect.x + rect.width / 2) * zoom), y: Math.round((rect.y + rect.height / 2) * zoom) };
      let contextParams;
      contents.once("context-menu", (_event, params) => { contextParams = params; });
      lastMenu = undefined;
      window.show(); window.focus(); contents.focus();
      contents.sendInputEvent({ type: "mouseDown", button: "right", clickCount: 1, ...point });
      contents.sendInputEvent({ type: "mouseUp", button: "right", clickCount: 1, ...point });
      await waitFor(() => lastMenu && contextParams, `native context menu ${identity.id}`);
      assert.equal(contents.isDevToolsOpened(), false);
      const item = lastMenu.items.find(item => item.label === "Inspect element");
      assert(item?.enabled);
      // Invoke the actual native MenuItem callback after a real right-click created the menu.
      // OS-specific pointer selection is left to manual acceptance, not claimed by this fixture.
      lastMenu.closePopup(window);
      // Let the native popup finish dismissal before opening another native window.
      await new Promise(resolve => setImmediate(resolve));
      item.click(item, window, {});
      await inspectorReady(contents, `developer tools ${identity.id}`);
      for (const other of contentsList) if (other !== contents) assert.equal(other.isDevToolsOpened(), false);
      assert.equal(observerDisconnected, false);
      await waitFor(async () => (await page.evaluate(() => window.ticks)) > identity.ticks, "observer progress after inspection");
      const after = await page.evaluate(() => ({ id: window.fixtureId, origin: performance.timeOrigin,
        draft: document.querySelector("textarea").value }));
      assert.deepEqual(after, { id: identity.id, origin: identity.origin, draft: identity.draft });
      assert.equal(navigations, 0);
      if (view) assert.deepEqual(view.getBounds(), bounds);
      assert.match(contents.devToolsWebContents.getURL(), /^devtools:\/\//);
      if (index === 1 && process.env.MARIA_INSPECTION_OUTPUT) {
        await sleep(700);
        fs.mkdirSync(process.env.MARIA_INSPECTION_OUTPUT, { recursive: true });
        const screenshot = await contents.devToolsWebContents.capturePage();
        fs.writeFileSync(path.join(process.env.MARIA_INSPECTION_OUTPUT, "inspection-devtools.png"), screenshot.toPNG());
      }
      await closeInspector(contents);
      console.log(`INSPECTION_STAGE surface=${index} F12`);
      window.focus(); contents.focus();
      contents.sendInputEvent({ type: "keyDown", keyCode: "F12" });
      contents.sendInputEvent({ type: "keyUp", keyCode: "F12" });
      await inspectorReady(contents, "F12 inspector");
      await closeInspector(contents);
      console.log(`INSPECTION_STAGE surface=${index} platform-shortcut`);
      window.focus(); contents.focus();
      const modifiers = process.platform === "darwin" ? ["meta", "alt"] : ["control", "shift"];
      contents.sendInputEvent({ type: "keyDown", keyCode: "I", modifiers });
      contents.sendInputEvent({ type: "keyUp", keyCode: "I", modifiers });
      await inspectorReady(contents, "platform inspector shortcut");
      await closeInspector(contents);
      contents.off("did-start-navigation", onNavigation);
      inspections++;
    }
    assert.deepEqual(errors, []);
    console.log(`PAGE_INSPECTION_ELECTRON_OK surfaces=${inspections} native-context-menus=${inspections} f12=${inspections} platform-shortcuts=${inspections} concurrent-pages=5 zooms=0.8,1,1.25 preserved-cdp preserved-drafts no-navigation stable-bounds`);
  } finally {
    Menu.buildFromTemplate = build;
    for (const contents of contentsList) {
      removePageInspection(contents);
      if (!contents.isDestroyed()) contents.closeDevTools();
    }
  }
}).then(() => app.exit(0)).catch(error => {
  console.error(error.stack || error.message);
  app.exit(1);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const { installPageInspection, removePageInspection, isInspectionShortcut } = require("../electron/page-inspection.cjs");

function fixture() {
  const contents = new EventEmitter();
  const ownerWindow = new EventEmitter();
  const calls = [], errors = [], menus = [];
  let language = "en";
  contents.isDestroyed = () => false;
  ownerWindow.isDestroyed = () => false;
  for (const name of ["focus", "copy", "cut", "paste", "selectAll", "openDevTools", "inspectElement"]) {
    contents[name] = (...args) => calls.push([name, ...args]);
  }
  const options = { ownerWindow, title: "ChatGPT page", getLanguage: () => language,
    onError: action => errors.push(action), menuApi: { buildFromTemplate(items) {
      const menu = { items, popup: args => { menu.popupArgs = args; }, closePopup: () => { menu.closed = true; } };
      menus.push(menu); return menu;
    } } };
  const dispose = installPageInspection(contents, options);
  const show = (params = {}) => {
    let prevented = false;
    contents.emit("context-menu", { preventDefault: () => { prevented = true; } }, { x: 47, y: 83, ...params });
    return { menu: menus.at(-1), prevented };
  };
  return { contents, ownerWindow, calls, errors, options, menus, dispose, show, language: value => { language = value; } };
}

test("right-click inspection targets the clicked page and unscaled renderer coordinates", () => {
  const f = fixture();
  assert.deepEqual(f.calls, []);
  const { menu, prevented } = f.show();
  assert.equal(prevented, true);
  assert.equal(menu.popupArgs.window, f.ownerWindow);
  assert.equal(menu.popupArgs.x, undefined);
  menu.items.find(item => item.label === "Inspect element").click();
  assert.deepEqual(f.calls, [["openDevTools", { mode: "detach", activate: true, title: "ChatGPT page" }], ["inspectElement", 47, 83]]);
  f.dispose();
});

test("selection and editing actions operate on their originating page even when focus changes", () => {
  const f = fixture();
  const { menu } = f.show({ isEditable: true, editFlags: { canCopy: true, canCut: false, canPaste: true, canSelectAll: true } });
  assert.equal(menu.items.find(item => item.label === "Cut").enabled, false);
  menu.items.find(item => item.label === "Copy").click();
  menu.items.find(item => item.label === "Paste").click();
  assert.deepEqual(f.calls, [["focus"], ["copy"], ["focus"], ["paste"]]);
  f.dispose();
});

test("menus cannot inspect a different document after navigation or a destroyed page", () => {
  for (const change of [f => f.contents.emit("did-start-navigation", {}, "about:blank", false, true),
    f => f.contents.emit("destroyed"), f => f.ownerWindow.emit("closed")]) {
    const f = fixture();
    const { menu } = f.show();
    change(f);
    assert.equal(menu.closed, true);
    menu.items.find(item => item.label === "Inspect element").click();
    assert.deepEqual(f.calls, []);
    f.dispose();
  }
});

test("installation is idempotent and closing contents removes only its own listeners", () => {
  const f = fixture();
  const unrelated = () => {};
  f.contents.on("before-input-event", unrelated);
  assert.equal(installPageInspection(f.contents, f.options), f.dispose);
  assert.equal(f.contents.listenerCount("context-menu"), 1);
  removePageInspection(f.contents);
  f.dispose();
  assert.deepEqual(f.contents.listeners("before-input-event"), [unrelated]);
  assert.equal(f.contents.listenerCount("context-menu"), 0);
  assert.equal(f.ownerWindow.listenerCount("closed"), 0);
});

test("menus use the current app language and do not open DevTools automatically", () => {
  const f = fixture();
  for (const [language, label] of [["en", "Inspect element"], ["ja", "要素を検証"], ["zh-CN", "检查元素"], ["unknown", "Inspect element"]]) {
    f.language(language);
    assert(f.show().menu.items.some(item => item.label === label));
  }
  assert.deepEqual(f.calls, []);
  f.dispose();
});

test("invalid coordinates still allow opening tools but never guess an inspected element", () => {
  const f = fixture();
  for (const x of [-1, undefined, NaN, 1.5, "4"]) {
    const { menu } = f.show({ x });
    assert.equal(menu.items.find(item => item.label === "Inspect element").enabled, false);
    menu.items.find(item => item.label === "Developer tools").click();
  }
  assert.equal(f.calls.length, 5);
  assert(f.calls.every(call => call[0] === "openDevTools"));
  f.dispose();
});

test("inspector failures stay contained and never log selected page content", () => {
  const f = fixture();
  f.contents.openDevTools = () => { throw new Error("sensitive page data"); };
  f.show({ selectionText: "private selection" }).menu.items.find(item => item.label === "Developer tools").click();
  assert.deepEqual(f.errors, ["inspect"]);
  f.dispose();
});

test("F12 and platform inspector shortcuts do not steal typing, navigation or repeat events", () => {
  const event = { type: "keyDown", key: "F12" };
  for (const platform of ["darwin", "win32", "linux"]) {
    assert.equal(isInspectionShortcut(event, platform), true);
    const open = { type: "keyDown", key: "i", ...(platform === "darwin" ? { meta: true, alt: true } : { control: true, shift: true }) };
    assert.equal(isInspectionShortcut(open, platform), true);
    for (const input of [{ ...event, shift: true }, { ...open, type: "keyUp" }, { ...open, isAutoRepeat: true },
      { ...open, isComposing: true }, { ...open, key: "k" }, { ...open, meta: true, control: true }]) {
      assert.equal(isInspectionShortcut(input, platform), false);
    }
  }
  const f = fixture();
  let prevented = 0;
  f.contents.emit("before-input-event", { preventDefault: () => prevented++ }, event);
  assert.equal(prevented, 1);
  assert.equal(f.calls[0][0], "openDevTools");
  f.dispose();
});

test("the shell and every browser input binding install inspection without a development-only gate", () => {
  const main = fs.readFileSync(path.join(__dirname, "../electron/main.cjs"), "utf8");
  const host = fs.readFileSync(path.join(__dirname, "../electron/browser-host.cjs"), "utf8");
  assert(main.includes("installPageInspection(window.webContents"), "the app shell needs its own inspection handler");
  const binding = host.slice(host.indexOf("  bindShellZoomShortcuts(contents)"), host.indexOf("  bindTurnContents(tab)"));
  assert.match(binding, /installPageInspection\(contents/);
  assert.doesNotMatch(binding, /isDev|isPackaged|profile === "development"/);
  assert(host.includes("removePageInspection(contents)"), "host teardown must remove inspection listeners");
});

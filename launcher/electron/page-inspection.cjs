const bindings = new WeakMap();

const labels = {
  en: { inspect: "Inspect element", tools: "Developer tools", cut: "Cut", copy: "Copy", paste: "Paste", selectAll: "Select all" },
  ja: { inspect: "要素を検証", tools: "開発者ツール", cut: "切り取り", copy: "コピー", paste: "貼り付け", selectAll: "すべて選択" },
  "zh-CN": { inspect: "检查元素", tools: "开发者工具", cut: "剪切", copy: "复制", paste: "粘贴", selectAll: "全选" },
};

function isInspectionShortcut(input, platform = process.platform) {
  if (!input || input.type !== "keyDown" || input.isAutoRepeat || input.isComposing) return false;
  const key = String(input.key ?? "").toLowerCase();
  if (key === "f12") return !input.control && !input.meta && !input.alt && !input.shift;
  if (key !== "i" && input.code !== "KeyI") return false;
  return platform === "darwin"
    ? input.meta === true && input.alt === true && !input.control && !input.shift
    : input.control === true && input.shift === true && !input.meta && !input.alt;
}

/** User-operated inspection of this exact WebContents, with no renderer IPC or page script. */
function installPageInspection(contents, {
  ownerWindow,
  title = "Maria WebGPT",
  getLanguage = () => "en",
  menuApi,
  onError = () => {},
} = {}) {
  if (!contents || contents.isDestroyed()) return () => {};
  const existing = bindings.get(contents);
  if (existing) return existing;
  let disposed = false;
  let documentRevision = 0;
  let currentMenu;
  const usable = () => !disposed && !contents.isDestroyed() && ownerWindow?.isDestroyed?.() !== true;
  const report = action => {
    // Page text, selected text, console output and error objects never enter diagnostics.
    try { onError(action); } catch {}
  };
  const open = point => {
    if (!usable()) return;
    try {
      // Docking would resize the renderer that an active helper is observing.
      contents.openDevTools({ mode: "detach", activate: true, title });
      if (point) contents.inspectElement(point.x, point.y);
    } catch { report("inspect"); }
  };
  const onInput = (event, input) => {
    if (!usable() || !isInspectionShortcut(input)) return;
    event.preventDefault();
    open();
  };
  const closeMenu = () => {
    const menu = currentMenu;
    currentMenu = undefined;
    try { menu?.closePopup(ownerWindow); } catch {}
  };
  const onNavigation = (_event, _url, _inPlace, isMainFrame) => {
    if (isMainFrame !== false) { documentRevision++; closeMenu(); }
  };
  const onContextMenu = (event, params) => {
    if (!usable()) return;
    try {
      const copy = labels[getLanguage()] ?? labels.en;
      const revision = documentRevision;
      const point = Number.isSafeInteger(params.x) && params.x >= 0
        && Number.isSafeInteger(params.y) && params.y >= 0 ? { x: params.x, y: params.y } : undefined;
      const guarded = action => () => {
        if (!usable() || documentRevision !== revision) return;
        try { action(); } catch { report("context-menu-action"); }
      };
      const edit = name => guarded(() => { contents.focus(); contents[name](); });
      const flags = params.editFlags ?? {};
      const items = [];
      if (params.isEditable) items.push({ label: copy.cut, enabled: flags.canCut === true, click: edit("cut") });
      if (params.isEditable || flags.canCopy) items.push({ label: copy.copy, enabled: flags.canCopy === true, click: edit("copy") });
      if (params.isEditable) items.push({ label: copy.paste, enabled: flags.canPaste === true, click: edit("paste") });
      items.push({ label: copy.selectAll, enabled: flags.canSelectAll === true, click: edit("selectAll") });
      items.push({ type: "separator" });
      items.push({ label: copy.inspect, enabled: Boolean(point), click: guarded(() => open(point)) });
      items.push({ label: copy.tools, click: guarded(() => open()) });
      const reporting = require("./error-reporting-app.cjs");
      if (reporting.errorReportSettingsAvailable()) items.push({ type: "separator" }, {
        label: getLanguage() === "ja" ? "自動エラーレポート…" : getLanguage() === "zh-CN" ? "自动错误报告…" : "Automatic error reports…",
        click: guarded(() => reporting.openErrorReportSettings()),
      });
      closeMenu();
      const menu = (menuApi ?? require("electron").Menu).buildFromTemplate(items);
      currentMenu = menu;
      event.preventDefault();
      // Context coordinates are relative to the clicked renderer, not the parent window.
      // Let the native menu choose its screen position; pass unscaled coordinates to Inspect.
      menu.popup({ ...(ownerWindow ? { window: ownerWindow } : {}), callback: () => {
        if (currentMenu === menu) currentMenu = undefined;
      } });
    } catch { report("context-menu"); }
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    closeMenu();
    contents.off("context-menu", onContextMenu);
    contents.off("before-input-event", onInput);
    contents.off("did-start-navigation", onNavigation);
    contents.off("destroyed", dispose);
    ownerWindow?.off?.("closed", dispose);
    bindings.delete(contents);
  };
  bindings.set(contents, dispose);
  contents.on("context-menu", onContextMenu);
  contents.on("before-input-event", onInput);
  contents.on("did-start-navigation", onNavigation);
  contents.once("destroyed", dispose);
  ownerWindow?.once?.("closed", dispose);
  return dispose;
}

function removePageInspection(contents) { bindings.get(contents)?.(); }

module.exports = { installPageInspection, removePageInspection, isInspectionShortcut };

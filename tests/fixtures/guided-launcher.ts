import type { BrowserState, LauncherApi, LauncherSnapshot, LauncherState } from "../../launcher/src/types";

export interface GuidedFixture {
  snapshot: LauncherSnapshot;
  calls: string[];
  listeners: Record<string, Set<(value: any) => void>>;
  nativeReady: boolean;
  failInstall: string;
  emit(name: string, value: unknown): void;
  signIn(authenticated: boolean): void;
  catalog(): void;
}
export type GuidedFixtureWindow = Window & { guidedFixture: GuidedFixture };

/** Serialized into the isolated offline renderer before the application loads.
 * No production account, credentials, filesystem, or Electron IPC is involved. */
export function installGuidedFixture() {
  const win = window as unknown as GuidedFixtureWindow;
  const params = new URL(location.href).searchParams;
  const scenario = params.get("scenario") ?? "ready";
  const language = params.get("lang") === "ja" ? "ja" : params.get("lang") === "zh-CN" ? "zh-CN" : "en";
  const fresh = ["onboarding", "clean", "signed-out"].includes(scenario);
  const manual = scenario === "manual";
  const state: LauncherState = {
    version: 1, language, onboardingComplete: scenario !== "onboarding", autoStart: false,
    keepRunningOnClose: true, showBrowserDuringTurns: true, browserInteractionMode: manual ? "manual" : "automatic",
    experimentalBiggerContext: false, zeroRiskProEnabled: false, sidebarOpen: true, sidebarWidth: 252,
    coreSetupComplete: !fresh, codexCatalogVerified: !fresh, codexRestartRequired: false,
    mcpSetupComplete: !fresh, mcpRuntimeInstalled: !fresh, mcpGuideStep: !fresh ? 2 : 0,
    sessionRefreshReminderAt: null,
  };
  const browser: BrowserState = {
    status: "ready", message: "Fixture", url: "", title: "ChatGPT", authenticated: !["onboarding", "signed-out", "manual"].includes(scenario),
    visible: false, surfaceActive: false, loading: false, canGoBack: false, canGoForward: false,
    zoomFactor: 1, activeTabId: "home", maxTabs: 5, webAccess: { status: "ready" },
    tabs: [{ id: "home", traceId: null, title: "ChatGPT", status: "ready", loading: false, active: true, closable: false }],
  };
  if (scenario === "tasks") browser.tabs.push({ id: "task", traceId: "fixture-task", title: "Build a better workspace", status: "running", loading: false, active: false, closable: true });
  if (manual) {
    browser.activeTabId = "manual-task"; browser.tabs[0]!.active = false;
    browser.tabs.push({ id: "manual-task", traceId: "fixture-manual", title: "My manual task", status: "ready", loading: false, active: true, closable: true,
      interactionMode: "manual", manualState: "awaiting-user", manualDeadlineAt: new Date(Date.now() + 120_000).toISOString(), canCopyPrompt: true, canConfirmSent: true });
  }
  if (scenario === "paused") browser.webAccess = { status: "paused", reason: "rate-limit", detectedAt: new Date().toISOString(), retryAt: new Date(Date.now() + 60_000).toISOString(), incidents: 1, canResume: false };
  const snapshot: LauncherSnapshot = {
    profile: "production", profilePaths: { coreHome: "fixture", codexHome: "fixture", userData: "fixture" }, state, browser,
    connectorName: manual ? "Codex Zero Risk" : "Codex Native2", connectorNames: { automatic: "Codex Native2", manual: "Codex Zero Risk" },
    mcpCredentialsConfigured: !fresh, logs: [], urls: { github: "https://github.com/mikkel32/codex-web-gpt-enhanced", connectors: "https://chatgpt.com/#settings/Plugins", tunnels: "https://platform.openai.com/settings/organization/tunnels", keys: "https://platform.openai.com/settings/organization/api-keys" },
    platform: "darwin", packaged: true, version: params.get("version") ?? "fixture", operation: null,
    update: scenario === "update-error" ? { status: "error", version: "99.0.0", message: "The fixture update check did not succeed." } : { status: "up-to-date", latestVersion: params.get("version") ?? "fixture" },
  };
  const clone = <T>(value: T): T => structuredClone(value);
  const fixture: GuidedFixture = {
    snapshot, calls: [], listeners: {}, nativeReady: !fresh, failInstall: "",
    emit(name, value) { for (const listener of fixture.listeners[name] ?? []) listener(clone(value)); },
    signIn(authenticated) { browser.authenticated = authenticated; fixture.emit("onBrowserState", browser); },
    catalog() { state.codexCatalogVerified = true; state.codexRestartRequired = false; fixture.emit("onStateChanged", state); },
  };
  win.guidedFixture = fixture;
  const wait = () => new Promise(resolve => setTimeout(resolve, 35));
  const save = (patch: Partial<LauncherState>) => { Object.assign(state, patch); fixture.emit("onStateChanged", state); return clone(state); };
  const install = async (tools: boolean, input: Record<string, unknown> = {}) => {
    fixture.calls.push(tools ? "setupMcp" : "setupCore");
    const name = tools ? "mcp-setup" : "core-setup";
    snapshot.operation = { name, status: "running", message: "Checking the fixture runtime" }; fixture.emit("onOperation", snapshot.operation);
    await wait();
    if (fixture.failInstall || (tools && !snapshot.mcpCredentialsConfigured && !input.runtimeKey)) {
      const message = fixture.failInstall || "Tool credentials are required";
      snapshot.operation = { name, status: "failed", message }; fixture.emit("onOperation", snapshot.operation); throw new Error(message);
    }
    fixture.nativeReady = true;
    if (tools) snapshot.mcpCredentialsConfigured = true;
    save({ coreSetupComplete: true, codexCatalogVerified: false, codexRestartRequired: true,
      ...(tools ? { mcpRuntimeInstalled: true, mcpSetupComplete: false, mcpGuideStep: 2 } : {}) });
    snapshot.operation = { name, status: "completed", message: "Fixture runtime checked" }; fixture.emit("onOperation", snapshot.operation);
    return { ok: true, stdout: "", restartRequired: true };
  };
  const api: Record<string, unknown> = {
    snapshot: async () => clone(snapshot),
    completeOnboarding: async (lang: LauncherState["language"], mode: LauncherState["browserInteractionMode"]) => {
      fixture.calls.push("onboard"); save({ language: lang, browserInteractionMode: mode, onboardingComplete: true });
      // Reproduce the real IPC ordering: event before the Promise reply.
      await wait(); return clone(state);
    },
    openLogin: async () => { fixture.calls.push("openLogin"); return clone(browser); },
    setupCore: () => install(false), setupMcp: (input: Record<string, unknown>) => install(true, input),
    verifyMcp: async () => { fixture.calls.push("verifyMcp"); save({ mcpSetupComplete: true }); return { ok: true, checks: [] }; },
    doctor: async () => { fixture.calls.push("doctor"); return { ok: true, checks: [{ id: "fixture", status: "ok", message: "Offline renderer fixture" }] }; },
    connectionStatus: async () => { fixture.calls.push("connectionStatus"); return { phase: fixture.nativeReady ? "online" : "unconfigured", nativeAvailable: fixture.nativeReady, browserConnected: browser.authenticated, activeBrowserTurns: scenario === "tasks" ? 1 : 0 }; },
    setBrowserBounds: async () => true, setBrowserSurfaceActive: async () => clone(browser),
    showBrowser: async () => { fixture.calls.push("showBrowser"); return clone(browser); }, hideBrowser: async () => clone(browser),
    selectBrowserTab: async (id: string) => { fixture.calls.push("selectBrowserTab"); browser.activeTabId = id; browser.tabs.forEach(tab => { tab.active = tab.id === id; }); fixture.emit("onBrowserState", browser); return clone(browser); },
    closeBrowserTab: async (id: string) => { browser.tabs = browser.tabs.filter(tab => tab.id !== id); fixture.emit("onBrowserState", browser); return clone(browser); },
    copyManualPrompt: async () => { fixture.calls.push("copyManualPrompt"); return clone(browser); },
    confirmManualSent: async () => { fixture.calls.push("confirmManualSent"); return clone(browser); },
    reviewWebAccess: async () => clone(browser), resumeWebAccess: async () => { fixture.calls.push("resumeWebAccess"); browser.webAccess = { status: "ready" }; fixture.emit("onBrowserState", browser); return clone(browser); },
    setSidebarState: async (input: { open: boolean; width: number }) => { state.sidebarOpen = input.open; state.sidebarWidth = input.width; return clone(state); },
    setLanguage: async (lang: LauncherState["language"]) => save({ language: lang }),
    setPreference: async (key: "keepRunningOnClose" | "showBrowserDuringTurns", value: boolean) => save({ [key]: value }),
    setAutostart: async (enabled: boolean) => ({ state: save({ autoStart: enabled }), supported: true, enabled }),
    setMcpStep: async (step: number) => save({ mcpGuideStep: step }),
    logs: async () => [], exportLogs: async () => { fixture.calls.push("exportLogs"); return null; },
    checkUpdates: async () => clone(snapshot.update), openReleases: async () => { fixture.calls.push("openReleases"); },
    installUpdate: async () => { fixture.calls.push("installUpdate"); return true; },
    openExternal: async () => { fixture.calls.push("openExternal"); return true; },
    signInBrowsers: async () => [{ id: "chrome", name: "Chrome", available: true }],
    windowState: async () => ({ fullScreen: false, maximized: false }), windowControl: () => {},
  };
  win.codexWebLauncher = new Proxy(api, {
    get(target, key) {
      if (key in target) return target[String(key)];
      if (String(key).startsWith("on")) return (listener: (value: unknown) => void) => {
        const listeners = fixture.listeners[String(key)] ??= new Set(); listeners.add(listener);
        return () => listeners.delete(listener);
      };
      return async () => { throw new Error(`Unimplemented fixture action: ${String(key)}`); };
    },
  }) as unknown as LauncherApi;
}

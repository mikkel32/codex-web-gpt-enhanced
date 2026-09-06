import { expect, test } from "bun:test";
import { homeState } from "../launcher/src/home-state";
import { createBootstrapOverlay } from "../launcher/src/bootstrap-overlay";
import type { LauncherSnapshot, BrowserTabState } from "../launcher/src/types";

function fixture(): LauncherSnapshot {
  return { version: "test", profile: "production", state: {
    version: 1, language: "en", onboardingComplete: true, browserInteractionMode: "automatic",
    autoStart: true, keepRunningOnClose: true, showBrowserDuringTurns: true,
    experimentalBiggerContext: false, zeroRiskProEnabled: false, sidebarOpen: true,
    sidebarWidth: 252, mcpGuideStep: 0, sessionRefreshReminderAt: null,
    codexCatalogVerified: true, mcpSetupComplete: false,
  }, browser: { authenticated: true, activeTabId: "home", tabs: [], status: "ready",
    message: "Ready", url: "", title: "ChatGPT", visible: false, surfaceActive: false,
    loading: false, canGoBack: false, canGoForward: false, zoomFactor: 1, maxTabs: 5 },
    profilePaths: { coreHome: "/fixture", codexHome: "/fixture/codex", userData: "/fixture/user" },
    connectorName: "Codex Native2", connectorNames: { automatic: "Codex Native2", manual: "Codex Zero Risk" },
    logs: [], urls: { github: "", connectors: "", tunnels: "", keys: "" }, platform: "darwin", packaged: false,
    operation: null, mcpCredentialsConfigured: false, update: { status: "idle" } };
}

test("browser-only setup does not require optional MCP tools or count the home tab as a task", () => {
  const snapshot = fixture();
  snapshot.browser!.tabs = [{ id: "home" }] as BrowserTabState[];
  const home = homeState(snapshot);
  expect(home.tabs).toHaveLength(0);
  expect(home.next).toBeUndefined();
  expect(home.action).toBe("open");
  expect(home.complete).toBe(home.steps.length);
  snapshot.mcpCredentialsConfigured = true;
  expect(homeState(snapshot).action).toBe("tools");
});

test("Home routes sign-in, model setup and manual tool setup in the correct order", () => {
  const snapshot = fixture();
  snapshot.browser!.authenticated = false;
  snapshot.state.codexCatalogVerified = false;
  expect(homeState(snapshot).action).toBe("account");
  snapshot.browser!.authenticated = true;
  expect(homeState(snapshot).surface).toBe("setup");
  snapshot.state.browserInteractionMode = "manual";
  expect(homeState(snapshot).action).toBe("tools");
  snapshot.state.mcpSetupComplete = true;
  expect(homeState(snapshot).action).toBe("models");
  snapshot.profile = "development";
  expect(homeState(snapshot).next).toBeUndefined();
});

test("Home keeps the selected task, falls back to running work, and prioritizes access review", () => {
  const snapshot = fixture();
  snapshot.browser!.tabs = [
    { id: "home" }, { id: "running", status: "running" }, { id: "selected", status: "ready" },
  ] as BrowserTabState[];
  snapshot.browser!.activeTabId = "selected";
  expect(homeState(snapshot).resume?.id).toBe("selected");
  expect(homeState(snapshot).action).toBe("resume");
  snapshot.browser!.activeTabId = "home";
  expect(homeState(snapshot).resume?.id).toBe("running");
  snapshot.browser!.webAccess = { status: "paused", reason: "verification", detectedAt: "now", retryAt: null, incidents: 1, canResume: true };
  expect(homeState(snapshot).action).toBe("review");
});

test("a late bootstrap snapshot cannot replace newer events with stale state", () => {
  const initial = fixture();
  const overlay = createBootstrapOverlay();
  const first = { ...initial.state, sidebarWidth: 280 };
  const latest = { ...first, sidebarWidth: 320, language: "ja" as const };
  overlay.record("state", first);
  overlay.record("state", latest);
  overlay.record("browser", null);
  overlay.record("operation", { name: "connect", status: "failed", message: "Connection stopped" });
  overlay.record("update", { status: "available", version: "next" });
  const result = overlay.merge(initial);
  expect(result.state).toBe(latest);
  expect(result.browser).toBeNull();
  expect(result.operation?.status).toBe("failed");
  expect(result.update).toEqual({ status: "available", version: "next" });
  expect(result.version).toBe(initial.version);
  expect(initial.state.sidebarWidth).toBe(252);
  expect(createBootstrapOverlay().merge(initial)).toEqual(initial);
});

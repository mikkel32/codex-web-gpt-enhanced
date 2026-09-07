import { test, expect } from "bun:test";
import { guidedCopy } from "../launcher/src/guided-copy";
import { guidedSetupSteps, setupEvidenceKey } from "../launcher/src/guided-setup-view";
import { updatePresentation } from "../launcher/src/update-view";
import type { LauncherSnapshot, UpdateState } from "../launcher/src/types";

function snapshot(): LauncherSnapshot {
  return { profile: "production", state: { browserInteractionMode: "automatic", coreSetupComplete: true, codexCatalogVerified: true, codexRestartRequired: false, mcpRuntimeInstalled: true, mcpSetupComplete: true }, browser: { authenticated: true, tabs: [], status: "ready", webAccess: { status: "ready" } }, mcpCredentialsConfigured: true, operation: null, update: { status: "up-to-date" } } as unknown as LauncherSnapshot;
}

test("progress is observed evidence, never merely a ready label", () => {
  const current = snapshot();
  expect(guidedSetupSteps(current, "ready").every(step => step.done)).toBe(true);
  for (const field of ["coreSetupComplete", "codexCatalogVerified", "mcpRuntimeInstalled", "mcpSetupComplete"] as const) {
    const incomplete = snapshot(); incomplete.state[field] = false;
    expect(guidedSetupSteps(incomplete, "ready").at(-1)?.done).toBe(false);
  }
  current.mcpCredentialsConfigured = false;
  expect(guidedSetupSteps(current, "ready").find(step => step.id === "tools")?.done).toBe(false);
  expect(guidedSetupSteps(current, "ready").at(-1)?.done).toBe(false);
});

test("manual and DEV setup show only steps they can actually verify", () => {
  const current = snapshot(); current.state.browserInteractionMode = "manual";
  expect(guidedSetupSteps(current, "ready").some(step => step.id === "account")).toBe(false);
  expect(guidedSetupSteps(current, "ready").some(step => step.id === "tools")).toBe(true);
  current.profile = "development";
  expect(guidedSetupSteps(current, "ready").some(step => step.id === "codex")).toBe(false);
});

test("optional tools add a real unmet prerequisite and access pauses clear ready progress", () => {
  const current = snapshot(); current.mcpCredentialsConfigured = false;
  current.state.mcpRuntimeInstalled = false; current.state.mcpSetupComplete = false;
  expect(guidedSetupSteps(current, "ready")).toHaveLength(4);
  expect(guidedSetupSteps(current, "ready", true)).toHaveLength(5);
  expect(guidedSetupSteps(current, "ready", true).at(-1)?.done).toBe(false);
  current.browser!.webAccess = { status: "paused", reason: "rate-limit", detectedAt: "2026-09-07", retryAt: null, incidents: 1, canResume: false };
  expect(guidedSetupSteps(current, "ready").at(-1)?.done).toBe(false);
});

test("readiness evidence ignores navigation and logs, not authentication or runtime changes", () => {
  const current = snapshot(), key = setupEvidenceKey(current);
  current.state.sidebarOpen = true; current.logs = []; current.state.language = "ja";
  expect(setupEvidenceKey(current)).toBe(key);
  current.browser!.authenticated = false;
  expect(setupEvidenceKey(current)).not.toBe(key);
});

test.each(["en", "ja", "zh-CN"] as const)("guided copy is complete and populated for %s", language => {
  const translated = guidedCopy(language), english = guidedCopy("en");
  expect(Object.keys(translated).sort()).toEqual(Object.keys(english).sort());
  for (const [key, value] of Object.entries(translated)) {
    if (Array.isArray(value)) {
      expect(value.length).toBe((english[key as keyof typeof english] as string[][]).length);
      for (const row of value) expect(row.every(text => text.trim().length > 0)).toBe(true);
    } else expect(value.trim().length > 0).toBe(true);
  }
});

test.each(["error", "access-required", "idle", "checking", "disabled"] as const)("a remembered update version is not installable in %s", status => {
  const current = snapshot(); current.update = { status, version: "99.0.0", message: "Offline" } as UpdateState;
  expect(updatePresentation(current).candidate).toBeNull();
  expect(updatePresentation(current).canInstall).toBe(false);
});

test("updates cannot interrupt a background tab or a launcher operation", () => {
  const current = snapshot(); current.update = { status: "available", version: "5.14.0" };
  expect(updatePresentation(current).canInstall).toBe(true);
  current.browser!.tabs = [{ status: "running", active: false }] as NonNullable<LauncherSnapshot["browser"]>["tabs"];
  expect(updatePresentation(current).canInstall).toBe(false);
  current.browser!.tabs = []; current.operation = { name: "setup", status: "running", message: "Installing" };
  expect(updatePresentation(current).canInstall).toBe(false);
  current.operation = null; current.profile = "development";
  expect(updatePresentation(current).canInstall).toBe(false);
});

import { expect, test } from "bun:test";
import { workspaceSteps, setupActionSurface, launcherComputer } from "../launcher/src/workspace-state";
import { workspaceCopy } from "../launcher/src/workspace-copy";
import type { LauncherSnapshot } from "../launcher/src/types";
const snapshot = () => ({ profile: "production", state: { browserInteractionMode: "automatic" },
  browser: { authenticated: true }, mcpCredentialsConfigured: false } as LauncherSnapshot);

test("browser-only milestones do not ask for tool credentials", () => {
  expect(workspaceSteps(snapshot()).map(step => step.id)).toEqual(["account", "runtime", "models"]);
});
test("a catalog flag alone cannot mark installation complete", () => {
  const s = snapshot(); s.state.codexCatalogVerified = true;
  expect(workspaceSteps(s).filter(step => step.id !== "account").every(step => !step.done)).toBe(true);
  s.state.coreSetupComplete = true; s.state.codexRestartRequired = true;
  expect(workspaceSteps(s).find(step => step.id === "models")!.done).toBe(false);
});
test("manual and DEV milestones match their different setup requirements", () => {
  const s = snapshot(); s.state.browserInteractionMode = "manual";
  expect(workspaceSteps(s).map(step => step.id)).toEqual(["runtime", "models", "tools"]);
  s.profile = "development";
  expect(workspaceSteps(s).map(step => step.id)).toEqual(["runtime", "tools"]);
});
test("tool milestones require credentials, installed runtime and a completed check", () => {
  const s = snapshot(); s.mcpCredentialsConfigured = true; s.state.mcpSetupComplete = true;
  expect(workspaceSteps(s).at(-1)!.done).toBe(false);
  s.state.mcpRuntimeInstalled = true;
  expect(workspaceSteps(s).at(-1)!.done).toBe(true);
});
test("paused browser authentication is not complete", () => {
  const s = snapshot(); s.browser!.webAccess = { status: "paused" } as NonNullable<LauncherSnapshot["browser"]>["webAccess"];
  expect(workspaceSteps(s)[0]!.done).toBe(false);
});
test("contextual setup navigation is explicit and cannot change modes", () => {
  expect(setupActionSurface("credentials")).toBe("mcp");
  expect(setupActionSurface("review")).toBe("browser");
  expect(setupActionSurface("codex")).toBe("setup");
  expect(setupActionSurface("installing")).toBeNull();
});
test("computer labels preserve unknown platforms rather than guessing a host", () => {
  expect(launcherComputer("darwin")).toBe("macOS");
  expect(launcherComputer("win32")).toBe("Windows");
  expect(launcherComputer("custom")).toBe("custom");
});
test("workspace copy is complete in all supported languages", () => {
  const en = workspaceCopy("en");
  for (const locale of ["zh-CN", "ja"] as const) {
    const localized = workspaceCopy(locale);
    expect(Object.keys(localized).sort()).toEqual(Object.keys(en).sort());
    expect(Object.values(localized).every(value => value.length > 0)).toBe(true);
  }
});

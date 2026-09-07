import type { LauncherSnapshot, Surface } from "./types";
import { setupToolsRequired, type SetupPhase } from "./automatic-setup";

export type WorkspaceStep = { id: "account" | "runtime" | "models" | "tools"; done: boolean; surface: Surface };

/** Saved milestones only. A completed list must never be presented as live health. */
export function workspaceSteps(snapshot: LauncherSnapshot): WorkspaceStep[] {
  const { state } = snapshot;
  const steps: WorkspaceStep[] = [];
  if (state.browserInteractionMode !== "manual") {
    steps.push({ id: "account", done: snapshot.browser?.authenticated === true
      && snapshot.browser?.webAccess?.status !== "paused", surface: "browser" });
  }
  steps.push({ id: "runtime", done: state.coreSetupComplete === true, surface: "setup" });
  if (snapshot.profile !== "development") {
    steps.push({ id: "models", done: state.coreSetupComplete === true
      && state.codexCatalogVerified === true && state.codexRestartRequired !== true, surface: "setup" });
  }
  if (setupToolsRequired(snapshot)) {
    steps.push({ id: "tools", done: snapshot.mcpCredentialsConfigured === true
      && state.mcpRuntimeInstalled === true && state.mcpSetupComplete === true, surface: "mcp" });
  }
  return steps;
}

export function setupActionSurface(phase: SetupPhase): Surface | null {
  if (phase === "sign-in" || phase === "review") return "browser";
  if (phase === "credentials" || phase === "connector") return "mcp";
  if (phase === "codex") return "setup";
  if (phase === "error") return "activity";
  return null;
}

/** Configuration folders are not approved project roots and must not be relabelled as such. */
export function launcherComputer(platform: string): string {
  return ({ darwin: "macOS", win32: "Windows", linux: "Linux" } as Record<string, string>)[platform] ?? platform;
}

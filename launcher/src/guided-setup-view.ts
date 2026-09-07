import type { LauncherSnapshot } from "./types";
import type { SetupPhase } from "./automatic-setup";

export type SetupStepId = "account" | "runtime" | "codex" | "tools" | "check";
export interface SetupStep { id: SetupStepId; done: boolean; current: boolean; }
/** Progress is based on observed setup flags, never a cosmetic timer or click count. */
export function guidedSetupSteps(snapshot: LauncherSnapshot, phase: SetupPhase, requestTools = false): SetupStep[] {
  const manual = snapshot.state.browserInteractionMode === "manual";
  const dev = snapshot.profile === "development";
  const tools = requestTools || manual || dev || snapshot.mcpCredentialsConfigured || snapshot.state.mcpRuntimeInstalled === true;
  const accessPaused = snapshot.browser?.webAccess?.status === "paused";
  const steps: SetupStep[] = [];
  if (!manual) steps.push({ id: "account", done: snapshot.browser?.authenticated === true && !accessPaused, current: phase === "sign-in" || phase === "review" });
  steps.push({ id: "runtime", done: snapshot.state.coreSetupComplete === true, current: phase === "installing" });
  if (!dev) steps.push({ id: "codex", done: snapshot.state.codexCatalogVerified === true && !snapshot.state.codexRestartRequired, current: phase === "codex" });
  if (tools) steps.push({ id: "tools", done: snapshot.mcpCredentialsConfigured && snapshot.state.mcpRuntimeInstalled === true && snapshot.state.mcpSetupComplete === true, current: phase === "credentials" || phase === "connector" });
  const prerequisites = !accessPaused && steps.every(step => step.done);
  steps.push({ id: "check", done: prerequisites && phase === "ready", current: phase === "checking" || phase === "verifying" });
  if (!steps.some(step => step.current) && !["paused", "error", "busy"].includes(phase)) {
    const next = steps.find(step => !step.done);
    if (next) next.current = true;
  }
  return steps;
}

/** Terminal status is invalidated by real state changes, not by unrelated log events. */
export function setupEvidenceKey(snapshot: LauncherSnapshot): string {
  return JSON.stringify([snapshot.profile, snapshot.state.browserInteractionMode,
    snapshot.state.coreSetupComplete, snapshot.state.codexCatalogVerified, snapshot.state.codexRestartRequired,
    snapshot.state.mcpRuntimeInstalled, snapshot.state.mcpSetupComplete, snapshot.mcpCredentialsConfigured,
    snapshot.browser?.authenticated, snapshot.browser?.webAccess?.status]);
}

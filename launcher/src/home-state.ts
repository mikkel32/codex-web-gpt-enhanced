import type { LauncherSnapshot, Surface } from "./types";

export function homeState(snapshot: Pick<LauncherSnapshot, "state" | "browser" | "profile" | "mcpCredentialsConfigured">) {
  const manual = snapshot.state.browserInteractionMode === "manual";
  const steps: { id: "account" | "models" | "tools"; done: boolean; surface: Surface }[] = [];
  if (!manual) steps.push({ id: "account", done: snapshot.browser?.authenticated === true, surface: "browser" });
  const toolsRequired = manual || snapshot.profile === "development" || snapshot.mcpCredentialsConfigured || snapshot.state.mcpRuntimeInstalled;
  if (manual || snapshot.profile === "development") steps.push({ id: "tools", done: snapshot.state.mcpSetupComplete === true, surface: "mcp" });
  if (snapshot.profile !== "development") steps.push({ id: "models", done: snapshot.state.codexCatalogVerified === true, surface: "setup" });
  if (toolsRequired && !manual && snapshot.profile !== "development") steps.push({ id: "tools", done: snapshot.state.mcpSetupComplete === true, surface: "mcp" });
  const next = steps.find(step => !step.done);
  const tabs = (snapshot.browser?.tabs ?? []).filter(tab => tab.id !== "home");
  const resume = tabs.find(tab => tab.id === snapshot.browser?.activeTabId)
    ?? tabs.find(tab => tab.status === "running") ?? tabs.at(-1);
  const paused = snapshot.browser?.webAccess?.status === "paused";
  return { steps, next, tabs, resume, paused, complete: steps.filter(step => step.done).length,
    action: paused ? "review" as const : next?.id ?? (resume ? "resume" as const : "open" as const),
    surface: paused ? "browser" as const : next?.surface ?? "browser" as const };
}

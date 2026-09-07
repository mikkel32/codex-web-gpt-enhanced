import type { LauncherApi, LauncherSnapshot, OperationState, Surface } from "./types";

export type SetupPhase = "idle" | "checking" | "busy" | "sign-in" | "review" | "credentials"
  | "installing" | "codex" | "connector" | "verifying" | "ready" | "paused" | "error";
export interface AutomaticSetupState {
  phase: SetupPhase;
  active: boolean;
  error?: string;
  snapshot?: LauncherSnapshot;
  toolsRequested?: boolean;
}
type SetupApi = Pick<LauncherApi, "snapshot" | "openLogin" | "setupCore" | "setupMcp"
  | "verifyMcp" | "doctor" | "connectionStatus">;

/** User-initiated, event-driven setup. Never stores credentials or retries a mutating step blindly. */
export function createAutomaticSetup({ api, publish, navigate }: {
  api: SetupApi;
  publish: (state: AutomaticSetupState) => void;
  navigate: (surface: Surface) => void;
}) {
  let state: AutomaticSetupState = { phase: "idle", active: false };
  let flight: Promise<void> | null = null;
  let replay = false;
  let disposed = false;
  let loginOpened = false;
  const installationAttempts = new Set<"core" | "tools">();
  let toolsRequested = false;
  let verificationAttempted = false;
  let generation = 0;
  const emit = (phase: SetupPhase, extra: Partial<AutomaticSetupState> = {}) => {
    state = { ...state, phase, ...extra };
    if (!disposed) publish(state);
  };
  const run = async (ticket: number) => {
    const active = () => !disposed && state.active && generation === ticket;
    const snapshot = async () => {
      const next = await api.snapshot();
      if (active()) state = { ...state, snapshot: next };
      return next;
    };
    try {
      if (!active()) return;
      emit("checking", { error: undefined });
      let current = await snapshot();
      if (!active()) return;
      if (current.operation?.status === "running"
        || current.browser?.status === "running" || current.browser?.status === "testing"
        || current.browser?.tabs.some(tab => tab.status === "running" || tab.status === "testing")) {
        emit("busy"); return;
      }
      if (current.browser?.webAccess?.status === "paused") {
        emit("review"); navigate("browser"); return;
      }
      const manual = current.state.browserInteractionMode === "manual";
      const development = current.profile === "development";
      const existingTools = current.state.mcpRuntimeInstalled === true || current.mcpCredentialsConfigured;
      const toolsRequired = toolsRequested || manual || development || existingTools;
      // A clean Automatic install needs its Codex catalog before the tool form
      // can install MCP. Establish that prerequisite first; never downgrade an
      // existing Full installation or a manual/DEV profile to Browser-only.
      const collectToolsAfterCore = toolsRequired && !current.mcpCredentialsConfigured
        && !manual && !development && !existingTools;
      if (!manual && current.browser?.authenticated !== true) {
        emit("sign-in"); navigate("browser");
        if (!loginOpened) {
          loginOpened = true;
          await api.openLogin();
        }
        return;
      }
      if (toolsRequired && !current.mcpCredentialsConfigured && !collectToolsAfterCore) {
        emit("credentials"); navigate("mcp"); return;
      }
      let transportNeedsRepair = false;
      if (current.state.coreSetupComplete && !development && installationAttempts.size === 0) {
        const connection = await api.connectionStatus();
        if (!active()) return;
        if (connection.phase === "recovering" || connection.activeBrowserTurns > 0) { emit("busy"); return; }
        transportNeedsRepair = !connection.nativeAvailable;
      }
      const installTools = toolsRequired && !collectToolsAfterCore;
      if (transportNeedsRepair || !current.state.coreSetupComplete || (installTools && !current.state.mcpRuntimeInstalled)) {
        const target = installTools ? "tools" : "core";
        if (installationAttempts.has(target)) throw new Error("Setup did not persist its installed state. Review Activity before retrying.");
        installationAttempts.add(target);
        emit("installing");
        const result = installTools ? await api.setupMcp({}) : await api.setupCore();
        if (!active()) return;
        if (result.ok !== true) throw new Error("Setup did not confirm that installation succeeded.");
        current = await snapshot();
        if (!active()) return;
        if (!current.state.coreSetupComplete) throw new Error("Setup did not persist its installed state.");
      }
      if (!development && (!current.state.codexCatalogVerified || current.state.codexRestartRequired)) {
        emit("codex"); navigate("setup"); return;
      }
      if (toolsRequired && !current.mcpCredentialsConfigured) {
        emit("credentials"); navigate("mcp"); return;
      }
      if (toolsRequired && !current.state.mcpSetupComplete) {
        if (verificationAttempted) { emit("connector"); return; }
        verificationAttempted = true;
        emit("verifying");
        const report = await api.verifyMcp();
        if (!active()) return;
        if (!report.ok) { emit("connector"); navigate("mcp"); return; }
        current = await snapshot();
        if (!active()) return;
        if (!current.state.mcpSetupComplete) throw new Error("The tool connection has not been verified yet.");
      }
      emit("verifying");
      const report = await api.doctor();
      if (!active()) return;
      if (!report.ok) {
        throw new Error(report.checks.filter(check => check.status === "error")
          .map(check => check.message).join("; ") || "Connection checks did not pass. Review Activity.");
      }
      if (!development) {
        const connection = await api.connectionStatus();
        if (!active()) return;
        if (!connection.nativeAvailable) throw new Error("The native Codex connection is not ready yet.");
      }
      const finalSnapshot = await snapshot();
      if (!active()) return;
      if (finalSnapshot.state.browserInteractionMode !== current.state.browserInteractionMode
        || finalSnapshot.profile !== current.profile
        || finalSnapshot.browser?.webAccess?.status === "paused"
        || (!manual && finalSnapshot.browser?.authenticated !== true)
        || !finalSnapshot.state.coreSetupComplete
        || (!development && (!finalSnapshot.state.codexCatalogVerified || finalSnapshot.state.codexRestartRequired))
        || (toolsRequired && (!finalSnapshot.mcpCredentialsConfigured || !finalSnapshot.state.mcpRuntimeInstalled || !finalSnapshot.state.mcpSetupComplete))) {
        throw new Error("Connection evidence changed during verification. Review the connection before continuing.");
      }
      emit("ready", { active: false });
    } catch (error) {
      if (active()) emit("error", { active: false, error: error instanceof Error ? error.message : String(error) });
    }
  };
  const resume = (): Promise<void> => {
    if (disposed || !state.active) return Promise.resolve();
    if (flight) { replay = true; return flight; }
    const ticket = generation;
    // Assign the single-flight guard before any observer can re-enter.
    flight = Promise.resolve().then(() => run(ticket)).finally(() => {
      flight = null;
      const queued = replay;
      replay = false;
      if (queued && state.active && ["busy", "sign-in", "review", "credentials", "codex"].includes(state.phase)) {
        void resume();
      }
    });
    return flight;
  };
  return {
    getState: () => state,
    inspect(): Promise<void> {
      // Returning users get a read-only health check, not another installation.
      if (disposed || state.active || flight) return flight ?? Promise.resolve();
      const ticket = ++generation;
      const alive = () => !disposed && ticket === generation;
      flight = Promise.resolve().then(async () => {
        if (!alive()) return;
        emit("checking", { active: false, error: undefined });
        try {
          const current = await api.snapshot();
          if (!alive()) return;
          const manual = current.state.browserInteractionMode === "manual";
          const dev = current.profile === "development";
          const tools = toolsRequested || manual || dev || current.mcpCredentialsConfigured || current.state.mcpRuntimeInstalled;
          const eligible = current.state.coreSetupComplete
            && (manual || current.browser?.authenticated === true)
            && current.browser?.webAccess?.status !== "paused"
            && (dev || current.state.codexCatalogVerified && !current.state.codexRestartRequired)
            && (!tools || current.mcpCredentialsConfigured && current.state.mcpRuntimeInstalled && current.state.mcpSetupComplete)
            && current.operation?.status !== "running"
            && current.browser?.status !== "running" && current.browser?.status !== "testing"
            && !current.browser?.tabs.some(tab => tab.status === "running" || tab.status === "testing");
          if (!eligible) { emit("idle", { snapshot: current }); return; }
          const report = await api.doctor();
          if (!alive()) return;
          const connected = dev || (await api.connectionStatus()).nativeAvailable;
          if (!alive()) return;
          const latest = await api.snapshot();
          if (!alive()) return;
          // Observe again after asynchronous checks; sign-out or changed setup
          // must not be overwritten by an older successful doctor response.
          const unchanged = JSON.stringify([current.state, current.mcpCredentialsConfigured, current.browser?.authenticated, current.browser?.webAccess])
            === JSON.stringify([latest.state, latest.mcpCredentialsConfigured, latest.browser?.authenticated, latest.browser?.webAccess]);
          emit(report.ok && connected && unchanged ? "ready" : "idle", { snapshot: latest });
        } catch {
          if (alive()) emit("idle", { snapshot: undefined });
        }
      }).finally(() => { flight = null; });
      return flight;
    },
    start(options: { toolsRequested?: boolean } = {}): Promise<void> {
      if (disposed || flight) return flight ?? Promise.resolve();
      generation += 1;
      loginOpened = false;
      installationAttempts.clear();
      if (options.toolsRequested !== undefined) toolsRequested = options.toolsRequested === true;
      verificationAttempted = false;
      state = { ...state, active: true, error: undefined, toolsRequested };
      return resume();
    },
    resume,
    continue(): Promise<void> {
      if (flight) return flight;
      verificationAttempted = false;
      return state.active ? resume() : this.start();
    },
    observeOperation(operation: OperationState) {
      // Credential setup can be initiated by its form while this controller is
      // waiting. A failure there is not permission to retry that mutation.
      if (state.active && operation.status === "failed"
        && ["core-setup", "mcp-setup", "dev-profile-setup", "dev-mcp-setup", "runtime-upgrade"].includes(operation.name)
        && !["installing", "verifying"].includes(state.phase)) {
        generation += 1;
        emit("error", { active: false, error: operation.message });
      }
    },
    invalidate() {
      // Connection evidence is a snapshot, not a permanent "all clear". Real
      // account/config/transport changes clear readiness without starting work.
      if (!disposed && (state.phase === "ready" || (!state.active && state.phase === "checking"))) {
        generation += 1;
        emit("idle", { active: false, snapshot: undefined });
      }
    },
    pause() {
      generation += 1;
      // An IPC transaction already in progress is allowed to finish safely.
      emit("paused", { active: false });
    },
    dispose() { disposed = true; generation += 1; state = { ...state, active: false }; },
  };
}

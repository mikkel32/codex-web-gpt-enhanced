import type { LauncherApi, LauncherSnapshot, Surface } from "./types";

export type SetupPhase = "idle" | "checking" | "busy" | "sign-in" | "review" | "credentials"
  | "installing" | "codex" | "connector" | "verifying" | "ready" | "paused" | "error";
export interface AutomaticSetupState {
  phase: SetupPhase;
  active: boolean;
  error?: string;
  snapshot?: LauncherSnapshot;
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
  let installAttempted = false;
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
        || current.browser?.tabs.some(tab => tab.status === "running")) {
        emit("busy"); return;
      }
      if (current.browser?.webAccess?.status === "paused") {
        emit("review"); navigate("browser"); return;
      }
      const manual = current.state.browserInteractionMode === "manual";
      const development = current.profile === "development";
      const toolsRequired = manual || development || current.state.mcpRuntimeInstalled === true
        || current.mcpCredentialsConfigured;
      if (!manual && current.browser?.authenticated !== true) {
        emit("sign-in"); navigate("browser");
        if (!loginOpened) {
          loginOpened = true;
          await api.openLogin();
        }
        return;
      }
      if (toolsRequired && !current.mcpCredentialsConfigured) {
        emit("credentials"); navigate("mcp"); return;
      }
      let transportNeedsRepair = false;
      if (current.state.coreSetupComplete && !development && !installAttempted) {
        const connection = await api.connectionStatus();
        if (!active()) return;
        if (connection.phase === "recovering") { emit("busy"); return; }
        transportNeedsRepair = !connection.nativeAvailable;
      }
      if (transportNeedsRepair || !current.state.coreSetupComplete || (toolsRequired && !current.state.mcpRuntimeInstalled)) {
        if (installAttempted) throw new Error("Setup did not persist its installed state. Review Activity before retrying.");
        installAttempted = true;
        emit("installing");
        const result = toolsRequired ? await api.setupMcp({}) : await api.setupCore();
        if (!active()) return;
        if (result.ok !== true) throw new Error("Setup did not confirm that installation succeeded.");
        current = await snapshot();
        if (!active()) return;
        if (!current.state.coreSetupComplete) throw new Error("Setup did not persist its installed state.");
      }
      if (!development && (!current.state.codexCatalogVerified || current.state.codexRestartRequired)) {
        emit("codex"); navigate("setup"); return;
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
    start(): Promise<void> {
      if (disposed || flight) return flight ?? Promise.resolve();
      generation += 1;
      loginOpened = false;
      installAttempted = false;
      verificationAttempted = false;
      state = { ...state, active: true, error: undefined };
      return resume();
    },
    resume,
    continue(): Promise<void> {
      if (flight) return flight;
      verificationAttempted = false;
      return state.active ? resume() : this.start();
    },
    pause() {
      generation += 1;
      // An IPC transaction already in progress is allowed to finish safely.
      emit("paused", { active: false });
    },
    dispose() { disposed = true; generation += 1; state = { ...state, active: false }; },
  };
}

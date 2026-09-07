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
export function setupToolsRequired(current: LauncherSnapshot): boolean {
  return current.state.browserInteractionMode === "manual" || current.profile === "development"
    || current.state.mcpRuntimeInstalled === true || current.mcpCredentialsConfigured;
}

/** Manual prompts are active work too: installing beneath them invalidates their capability. */
export function setupHasActiveWork(current: LauncherSnapshot): boolean {
  return current.operation?.status === "running" || (current.browser?.tabs ?? []).some(tab =>
    tab.status === "running" || tab.status === "testing"
    || ["awaiting-user", "sent", "running"].includes(tab.manualState ?? ""));
}

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
      if (setupHasActiveWork(current)) {
        emit("busy"); return;
      }
      if (current.browser?.webAccess?.status === "paused") {
        emit("review"); navigate("browser"); return;
      }
      const manual = current.state.browserInteractionMode === "manual";
      const development = current.profile === "development";
      const toolsRequired = setupToolsRequired(current);
      const mode = current.state.browserInteractionMode;
      const installationIdentity = (value: LauncherSnapshot) => JSON.stringify([
        value.profile, value.version, value.profilePaths?.coreHome, value.profilePaths?.codexHome, value.profilePaths?.userData,
      ]);
      const identity = installationIdentity(current);
      // Every yielded phase can race with user changes. Check again before beginning
      // another step, not only at the end when damage or unwanted work could be done.
      const canContinue = (value: LauncherSnapshot): boolean => {
        if (setupHasActiveWork(value)) { emit("busy"); return false; }
        if (installationIdentity(value) !== identity || value.state.browserInteractionMode !== mode
          || setupToolsRequired(value) !== toolsRequired) {
          throw new Error("Setup options changed during verification. Continue setup to check the new configuration.");
        }
        if (value.browser?.webAccess?.status === "paused") { emit("review"); navigate("browser"); return false; }
        if (!manual && value.browser?.authenticated !== true) { emit("sign-in"); navigate("browser"); return false; }
        if (toolsRequired && !value.mcpCredentialsConfigured) { emit("credentials"); navigate("mcp"); return false; }
        return true;
      };
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
      if (!development) {
        const connection = await api.connectionStatus();
        if (!active()) return;
        if (connection.phase === "recovering" || connection.activeBrowserTurns > 0) { emit("busy"); return; }
        transportNeedsRepair = current.state.coreSetupComplete === true && !installAttempted && !connection.nativeAvailable;
        // The connection probe yielded. Recheck user intent and work before any installation.
        current = await snapshot();
        if (!active()) return;
        if (!canContinue(current)) return;
      }
      if (transportNeedsRepair || !current.state.coreSetupComplete || (toolsRequired && !current.state.mcpRuntimeInstalled)) {
        if (installAttempted) throw new Error("Setup did not persist its installed state. Review Activity before retrying.");
        installAttempted = true;
        emit("installing");
        const result = toolsRequired ? await api.setupMcp({}) : await api.setupCore();
        if (!active()) return;
        if (result.ok !== true) throw new Error("Setup did not confirm that installation succeeded.");
        current = await snapshot();
        if (!active() || !canContinue(current)) return;
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
        if (!report.ok) {
          emit("connector", { error: report.checks.filter(check => check.status === "error")
            .map(check => [check.message, check.detail].filter(Boolean).join(": ")).join("; ") || undefined });
          navigate("mcp"); return;
        }
        current = await snapshot();
        if (!active() || !canContinue(current)) return;
        if (!current.state.mcpSetupComplete) throw new Error("The tool connection has not been verified yet.");
      }
      emit("verifying");
      const report = await api.doctor();
      if (!active()) return;
      if (!report.ok) {
        throw new Error(report.checks.filter(check => check.status === "error")
          .map(check => [check.message, check.detail].filter(Boolean).join(": ")).join("; ") || "Connection checks did not pass. Review Activity.");
      }
      if (!development) {
        const connection = await api.connectionStatus();
        if (!active()) return;
        if (connection.activeBrowserTurns > 0 || connection.phase === "recovering") { emit("busy"); return; }
        if (!connection.nativeAvailable) throw new Error("The native Codex connection is not ready yet.");
      }
      // Persisted completion is not live readiness. Never publish success from an old snapshot.
      current = await snapshot();
      if (!active() || !canContinue(current)) return;
      if (!current.state.coreSetupComplete) throw new Error("Setup did not persist its installed state.");
      if (!development && (!current.state.codexCatalogVerified || current.state.codexRestartRequired)) {
        emit("codex"); navigate("setup"); return;
      }
      if (toolsRequired && (!current.mcpCredentialsConfigured || !current.state.mcpRuntimeInstalled || !current.state.mcpSetupComplete)) {
        emit(current.mcpCredentialsConfigured ? "connector" : "credentials"); navigate("mcp"); return;
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

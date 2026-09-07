import { useState } from "react";
import { Icon } from "./icons";
import type { LauncherSnapshot, Surface } from "./types";
import { useConnectionStatus } from "./useConnectionStatus";
import { WebAccessNotice } from "./WebAccessNotice";
import { studioCopy } from "./studio-copy";
import { Reveal, CinematicMark, KineticHeading } from "./motion-system";
import { homeState } from "./home-state";
import { ConnectionDiagnostics } from "./ConnectionDiagnostics";
import { workspaceCopy } from "./workspace-copy";
import { setupToolsRequired } from "./automatic-setup";

export const MADE_WITH_LOVE = "Mikkel & Maria";

export function MariaHome({ snapshot, navigate }: {
  snapshot: LauncherSnapshot;
  navigate: (surface: Surface) => void;
}) {
  const s = studioCopy(snapshot.state.language);
  const w = workspaceCopy(snapshot.state.language);
  const toolsRequired = setupToolsRequired(snapshot);
  const toolsConfigured = snapshot.mcpCredentialsConfigured && snapshot.state.mcpRuntimeInstalled && snapshot.state.mcpSetupComplete;
  const { status, checking, error, refresh } = useConnectionStatus();
  const [copied, setCopied] = useState(false);
  const [actionError, setActionError] = useState("");
  const nativeReady = !error && status?.nativeAvailable === true;
  const development = snapshot.profile === "development";
  const manual = snapshot.state.browserInteractionMode === "manual";
  const { tabs, paused, steps, next, complete, action, surface, resume } = homeState(snapshot);
  const accountReady = !paused && !manual && snapshot.browser?.authenticated === true;
  const connectionSummary = paused || error ? s.attention : !status && checking ? s.checking
    : !accountReady ? manual ? s.connect : s.signIn : nativeReady ? s.connected : s.attention;
  const stepTitles = { account: s.web, models: s.manageModels, tools: s.tools };
  const stepBodies = { account: s.accountStepBody, models: s.modelStepBody, tools: s.toolsStepBody };
  const actionTitle = { review: s.reviewBrowser, account: s.signIn, models: s.finishSetup,
    tools: s.connectTools, resume: s.continueTask, open: s.emptyAction }[action];
  const selectTab = async (id: string) => {
    setActionError("");
    try { await window.codexWebLauncher!.selectBrowserTab(id); navigate("browser"); }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const copyCommand = async () => {
    setActionError("");
    try { await window.codexWebLauncher!.copyNativeCodexCommand(); setCopied(true); }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const primaryAction = async () => {
    if (action === "resume" && resume) return selectTab(resume.id);
    if (action === "review") {
      setActionError("");
      try { await window.codexWebLauncher!.reviewWebAccess(); }
      catch (cause) { setActionError(cause instanceof Error ? cause.message : String(cause)); return; }
    }
    navigate(surface);
  };
  return <div className="studio-home maria-page">
    <Reveal className="studio-page-heading" delay={.03}>
      <div><span className="maria-eyebrow">MARIA / {s.workspace}</span><KineticHeading text={s.greeting} /><p>{s.intro}</p></div>
      {!next || paused ? <button className="button-primary" onClick={() => void primaryAction()}>{actionTitle}<Icon name="forward" /></button> : null}
    </Reveal>
    <WebAccessNotice access={snapshot.browser?.webAccess} openBrowser={() => navigate("browser")} />
    <section className="workspace-status-grid" aria-label={w.status}>
      <button className="workspace-status-card" onClick={() => navigate("setup")}>
        <Icon name="setup" /><span><small>{s.native}</small><strong>{development ? "DEV" : nativeReady ? s.connected : checking ? s.checking : s.attention}</strong></span>
        <span className={`studio-indicator ${nativeReady && !development ? "is-ready" : "needs-attention"}`} />
      </button>
      <button className="workspace-status-card" onClick={() => navigate("browser")}>
        <Icon name="browser" /><span><small>{s.web}</small><strong>{paused ? s.attention : manual ? s.manual : accountReady ? s.connected : s.signIn}</strong></span>
        <span className={`studio-indicator ${manual ? "" : accountReady ? "is-ready" : "needs-attention"}`} />
      </button>
      <button className="workspace-status-card" onClick={() => navigate("mcp")}>
        <Icon name="mcp" /><span><small>{s.tools}</small><strong>{!toolsRequired ? w.optional : toolsConfigured ? w.configured : s.connect}</strong></span>
        <Icon name="forward" />
      </button>
    </section>
    <div className="studio-dashboard">
      <div className="studio-main-column">
        <Reveal className="studio-conversations" delay={.1}>
          <div className="studio-section-heading"><h2>{s.conversations}<span className="studio-count">{tabs.length}</span></h2></div>
          {tabs.length ? <div className="studio-session-list">{tabs.map(tab =>
            <button className="studio-session" key={tab.id} onClick={() => void selectTab(tab.id)}>
              <span className={`studio-session-icon ${tab.status === "running" ? "is-working" : ""}`}><Icon name="browser" /></span>
              <span className="studio-session-copy"><strong>{tab.title || "ChatGPT"}</strong><small>{tab.interactionMode === "manual" ? s.manual : s.automatic}</small></span>
              <span className={`studio-status ${tab.status === "running" ? "is-running" : tab.status === "error" ? "is-error" : ""}`}><i />{tab.status === "running" ? s.working : tab.status === "error" ? s.attention : s.retained}</span><Icon name="forward" />
          </button>)}</div> : <div className={`studio-empty-conversations${next ? " is-setup" : ""}`}>
            <CinematicMark active={(status?.activeBrowserTurns ?? 0) > 0} />
            <h3>{next ? stepTitles[next.id] : s.emptyTitle}</h3><p>{next ? stepBodies[next.id] : s.emptyBody}</p>
          </div>}
        </Reveal>
        <div className="studio-home-shortcuts">
          <button className="text-button" onClick={() => navigate("setup")}><Icon name="setup" />{s.manageModels}</button>
          <button className="text-button" onClick={() => navigate("guide")}><Icon name="logs" />{s.guideAction}</button>
        </div>
      </div>
      <Reveal className="studio-context-column" delay={.18}>
        <details className="studio-connection-panel studio-connection-details">
          <summary><span>{s.connectionDetails}<small className="studio-connection-summary">{connectionSummary}</small></span><Icon name="chevron" /></summary>
          <div className="studio-section-heading"><h2>{s.connections}</h2><button className="icon-button" aria-label={s.refreshStatus} disabled={checking} onClick={refresh}><Icon name="reload" /></button></div>
          <button className="studio-connection-row" onClick={() => navigate("setup")}><Icon name="setup" /><span><strong>{s.native}</strong><small>{development ? "DEV" : nativeReady ? s.connected : checking ? s.checking : s.attention}</small></span><span className={`studio-indicator ${nativeReady ? "is-ready" : "needs-attention"}`} title={nativeReady ? s.ready : s.attention} /><span className="sr-only">{nativeReady ? s.ready : checking ? s.checking : s.attention}</span></button>
          <button className="studio-connection-row" onClick={() => navigate("browser")}><Icon name="browser" /><span><strong>{s.web}</strong><small>{paused ? s.attention : manual ? s.manual : accountReady ? s.connected : s.signIn}</small></span><span className={`studio-indicator ${manual ? "" : accountReady ? "is-ready" : "needs-attention"}`} /></button>
          <button className="studio-connection-row" onClick={() => navigate("mcp")}><Icon name="mcp" /><span><strong>{s.tools}</strong><small>{!toolsRequired ? w.optional : toolsConfigured ? w.configured : s.connect}</small></span><span className={`studio-indicator ${!toolsRequired ? "" : toolsConfigured ? "is-ready" : "needs-attention"}`} /></button>
          <div className="studio-mode"><span>{s.mode}</span><button onClick={() => navigate("settings")}>{manual ? s.manual : s.automatic}<Icon name="chevron" /></button></div>
          <button className="text-button studio-native-command" onClick={() => void copyCommand()}>{copied ? s.copied : s.copyNative}<Icon name={copied ? "check" : "external"} /></button>
          {error ? <p role="status" className="studio-inline-error">{s.attention}: {error}</p> : null}
        </details>
        {complete < steps.length ? <section className="studio-setup-panel">
          <div className="studio-section-heading"><h2>{s.setup}</h2><span>{complete}/{steps.length}</span></div>
          <p>{s.setupHint}</p><progress max={steps.length} value={complete} aria-label={s.setup} />
          {next ? <div className="studio-next-step"><span>{s.nextStep}</span><strong>{stepTitles[next.id]}</strong></div> : null}
        </section> : <section className="studio-ready-panel"><Icon name="check" /><h3>{w.saved}</h3><p>{w.savedBody}</p></section>}
        <ConnectionDiagnostics snapshot={snapshot} navigate={navigate} />
        <div className="studio-build-note"><span>MARIA</span><span>{development ? "DEV / " : ""}{snapshot.version}</span></div>
      </Reveal>
    </div>
    {actionError ? <p role="alert" className="studio-inline-error">{actionError}</p> : null}
  </div>;
}

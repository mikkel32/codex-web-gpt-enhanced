import { useState } from "react";
import { Icon } from "./icons";
import type { LauncherSnapshot, Surface } from "./types";
import { useConnectionStatus } from "./useConnectionStatus";
import { WebAccessNotice } from "./WebAccessNotice";
import { studioCopy } from "./studio-copy";
import { Reveal, CinematicMark, KineticHeading } from "./motion-system";
import { homeState } from "./home-state";

export const MADE_WITH_LOVE = "Mikkel & Maria";

export function MariaHome({ snapshot, navigate }: {
  snapshot: LauncherSnapshot;
  navigate: (surface: Surface) => void;
}) {
  const s = studioCopy(snapshot.state.language);
  const { status, checking, error, refresh } = useConnectionStatus();
  const [copied, setCopied] = useState(false);
  const [actionError, setActionError] = useState("");
  const nativeReady = !error && status?.nativeAvailable === true;
  const development = snapshot.profile === "development";
  const manual = snapshot.state.browserInteractionMode === "manual";
  const { tabs, paused, steps, next, complete, action, surface, resume } = homeState(snapshot);
  const accountReady = !paused && (manual ? snapshot.state.mcpSetupComplete : snapshot.browser?.authenticated);
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
      <button className="button-primary" onClick={() => void primaryAction()}>{actionTitle}<Icon name="forward" /></button>
    </Reveal>
    <WebAccessNotice access={snapshot.browser?.webAccess} openBrowser={() => navigate("browser")} />
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
          <button className="studio-connection-row" onClick={() => navigate("browser")}><Icon name="browser" /><span><strong>{s.web}</strong><small>{paused ? s.attention : accountReady ? s.connected : manual ? s.manual : s.signIn}</small></span><span className={`studio-indicator ${accountReady ? "is-ready" : "needs-attention"}`} /></button>
          <button className="studio-connection-row" onClick={() => navigate("mcp")}><Icon name="mcp" /><span><strong>{s.tools}</strong><small>{snapshot.state.mcpSetupComplete ? s.connected : s.connect}</small></span><span className={`studio-indicator ${snapshot.state.mcpSetupComplete ? "is-ready" : "needs-attention"}`} /></button>
          <div className="studio-mode"><span>{s.mode}</span><button onClick={() => navigate("settings")}>{manual ? s.manual : s.automatic}<Icon name="chevron" /></button></div>
          <button className="text-button studio-native-command" onClick={() => void copyCommand()}>{copied ? s.copied : s.copyNative}<Icon name={copied ? "check" : "external"} /></button>
          {error ? <p role="status" className="studio-inline-error">{s.attention}: {error}</p> : null}
        </details>
        {complete < steps.length ? <section className="studio-setup-panel">
          <div className="studio-section-heading"><h2>{s.setup}</h2><span>{complete}/{steps.length}</span></div>
          <p>{s.setupHint}</p><progress max={steps.length} value={complete} aria-label={s.setup} />
          {next ? <div className="studio-next-step"><span>{s.nextStep}</span><strong>{stepTitles[next.id]}</strong></div> : null}
        </section> : <section className="studio-ready-panel"><Icon name="check" /><h3>{s.setupComplete}</h3><p>{s.nativeAvailable}</p></section>}
        <div className="studio-build-note"><span>MARIA</span><span>{development ? "DEV / " : ""}{snapshot.version}</span></div>
      </Reveal>
    </div>
    {actionError ? <p role="alert" className="studio-inline-error">{actionError}</p> : null}
  </div>;
}

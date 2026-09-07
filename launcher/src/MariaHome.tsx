import { useState } from "react";
import { Icon } from "./icons";
import type { LauncherSnapshot, Surface } from "./types";
import { useConnectionStatus } from "./useConnectionStatus";
import { WebAccessNotice } from "./WebAccessNotice";
import { guidedCopy } from "./guided-copy";
import { setupErrorDetail } from "./setup-errors";
import { homeState } from "./home-state";
import { ConnectionDiagnostics } from "./ConnectionDiagnostics";
import { workspaceCopy } from "./workspace-copy";
import { setupToolsRequired } from "./automatic-setup";

export const MADE_WITH_LOVE = "Mikkel & Maria";

export function MariaHome({ snapshot, navigate }: {
  snapshot: LauncherSnapshot; navigate: (surface: Surface) => void;
}) {
  const text = guidedCopy(snapshot.state.language);
  const w = workspaceCopy(snapshot.state.language);
  const toolsRequired = setupToolsRequired(snapshot);
  const toolsConfigured = snapshot.mcpCredentialsConfigured && snapshot.state.mcpRuntimeInstalled === true
    && snapshot.state.mcpSetupComplete === true;
  const { status, checking, stale, error, refresh } = useConnectionStatus();
  const [actionError, setActionError] = useState("");
  const nativeReady = !stale && !error && status?.nativeAvailable === true;
  const development = snapshot.profile === "development";
  const manual = snapshot.state.browserInteractionMode === "manual";
  const { tabs, paused } = homeState(snapshot);
  const accountReady = !paused && !manual && snapshot.browser?.authenticated === true;
  const selectTab = async (id: string) => {
    setActionError("");
    try { await window.codexWebLauncher!.selectBrowserTab(id); navigate("browser"); }
    catch (cause) { setActionError(setupErrorDetail(cause instanceof Error ? cause.message : String(cause))); }
  };
  const rows = [
    { icon: "setup" as const, label: text.native, surface: "setup" as const,
      value: development ? "DEV" : status?.phase === "recovering" ? text.recovering : nativeReady ? text.connected : checking && !status ? text.unknown : text.offline,
      ready: !development && nativeReady },
    { icon: "browser" as const, label: text.account, surface: "browser" as const,
      value: paused ? text.attention : manual ? text.manualSession : accountReady ? text.connected : text.signIn,
      ready: accountReady && !manual },
    { icon: "mcp" as const, label: text.tools, surface: "mcp" as const,
      value: !toolsRequired ? w.optional : !toolsConfigured ? text.attention
        : paused || error || (!nativeReady && !development) ? text.attention : w.configured,
      ready: false }, // Saved configuration does not prove a live project-tool call.
  ];
  return <div className="studio-home maria-page guided-home">
    <WebAccessNotice access={snapshot.browser?.webAccess} openBrowser={() => navigate("browser")} />
    <header className="guided-section-heading"><div><h2>{text.workTitle}</h2><p>{text.workBody}</p></div>
      <span className="guided-count">{tabs.length}</span></header>
    <div className="guided-home-grid"><section className="guided-conversations">
      {tabs.length ? <div className="guided-session-list">{tabs.map(tab => <button className="guided-session" key={tab.id} type="button" onClick={() => void selectTab(tab.id)}>
        <span className="guided-session-icon"><Icon name="browser" /></span>
        <span className="guided-session-copy"><strong>{tab.title || text.task}</strong><small>{tab.interactionMode === "manual" ? text.manual : text.automatic}</small></span>
        <span className={`guided-session-state ${tab.status === "running" ? "is-running" : tab.status === "error" || tab.status === "aborted" ? "is-error" : ""}`}>
          {tab.status === "running" ? text.running : tab.status === "error" || tab.status === "aborted" ? text.attention : text.retained}</span>
        <Icon name="forward" />
      </button>)}</div> : <div className="guided-empty">
        <span className="guided-empty-mark" aria-hidden="true"><Icon name="browser" /></span>
        <h3>{text.empty}</h3><p>{snapshot.state.coreSetupComplete ? text.emptyBody : text.noWorkYet}</p>
        <button className="text-button" type="button" onClick={() => navigate("guide")}>{text.help}<Icon name="forward" /></button>
      </div>}
      {actionError ? <p role="alert" className="studio-inline-error">{actionError}</p> : null}
    </section><aside className="guided-health">
      <div className="guided-section-heading"><h3>{text.liveStatus}</h3><button className="icon-button" type="button" aria-label={text.check} disabled={checking} onClick={refresh}><Icon name="reload" /></button></div>
      {rows.map(row => <button type="button" className="guided-health-row" key={row.surface} onClick={() => navigate(row.surface)}>
        <Icon name={row.icon} /><span><strong>{row.label}</strong><small>{row.value}</small></span><i className={row.ready ? "is-ready" : ""} aria-hidden="true" />
      </button>)}
      {error ? <p role="status" className="studio-inline-error">{text.attention}: {text.offline}</p> : null}
      <footer><span>MARIA</span><span>{development ? "DEV / " : ""}{snapshot.version}</span></footer>
    </aside></div>
    <ConnectionDiagnostics snapshot={snapshot} navigate={navigate} />
  </div>;
}

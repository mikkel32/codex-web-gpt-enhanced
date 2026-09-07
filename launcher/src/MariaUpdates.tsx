import { useRef, useState } from "react";
import { Icon } from "./icons";
import type { LauncherSnapshot } from "./types";
import { updatePresentation } from "./update-view";
import { updatesCopy } from "./updates-copy";
import { setupErrorDetail } from "./setup-errors";

export function MariaUpdates({ snapshot, install }: { snapshot: LauncherSnapshot; install: () => Promise<void> }) {
  const api = window.codexWebLauncher!;
  const update = snapshot.update;
  const text = updatesCopy(snapshot.state.language);
  const [token, setToken] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const flight = useRef(false);
  const { candidate, active, canInstall, busy: updateBusy } = updatePresentation(snapshot);
  const busy = working || updateBusy;
  const run = async (action: () => Promise<unknown>) => {
    if (flight.current) return;
    flight.current = true; setWorking(true); setError("");
    try { await action(); }
    catch (cause) { setError(setupErrorDetail(cause instanceof Error ? cause.message : String(cause))); }
    finally { flight.current = false; setWorking(false); }
  };
  const checkedTime = update.checkedAt ? Date.parse(update.checkedAt) : NaN;
  return <div className="maria-page maria-updates">
    <header className="maria-update-heading"><span className="maria-eyebrow">MARIA / {text.title}</span><h1>{text.title}</h1><p>{text.body}</p></header>
    <section className={`maria-update-card ${candidate ? "has-update" : ""}`} aria-label={text.releaseStatus}>
      <div className="studio-release-status" role="status"><span className={`studio-indicator ${update.status === "up-to-date" ? "is-ready" : ""}`} />{text.status[update.status]}</div>
      <div className="maria-update-version"><span className="maria-card-icon"><Icon name="update" /></span><div><span>{text.installed}</span><strong>Maria {snapshot.version}</strong></div>
        <span className="maria-pill">{snapshot.profile === "development" ? "DEV" : snapshot.version.includes("-") ? text.preview : text.stable}</span></div>
      <div role="status" aria-live="polite">
        {candidate ? <p className="maria-update-new">{text.candidate} <strong>v{candidate}</strong></p> : null}
        {"latestVersion" in update && update.latestVersion ? <p>{text.latest}: v{update.latestVersion}</p> : null}
        {"message" in update ? <p>{setupErrorDetail(update.message)}</p> : null}
        {update.status === "disabled" ? <p>{text.source}</p> : null}
        {update.status === "available" ? <p>{text.verified}</p> : null}
        {active && candidate ? <p>{text.finish}</p> : null}
      </div>
      <div className="maria-update-actions">
        {candidate ? <button type="button" className="button-primary" disabled={busy || !canInstall} onClick={() => void run(install)}><Icon name="update" />{update.status === "downloading" ? text.downloading : update.status === "installing" ? text.installing : `${text.update} · ${candidate}`}</button> : null}
        <button type="button" className="button-secondary" disabled={busy || update.status === "disabled"} onClick={() => void run(() => api.checkUpdates())}>{update.status === "checking" ? text.checking : text.check}</button>
        <button type="button" className="text-button" disabled={working} onClick={() => void run(() => api.openReleases())}>{text.notes} <Icon name="github" /></button>
      </div>
      <p className="maria-update-checked">{update.status === "disabled" ? text.source : <>{Number.isFinite(checkedTime) ? `${text.last}: ${new Date(checkedTime).toLocaleString(snapshot.state.language ?? "en")}` : text.none} · {text.automatic}</>}</p>
    </section>
    {update.status !== "disabled" ? <details className="maria-update-access" open={update.status === "access-required" ? true : undefined}>
      <summary>{text.access} · {update.authenticated ? text.connected : text.optional}</summary>
      <p>{text.accessBody}</p>
      <form onSubmit={event => { event.preventDefault(); if (busy || !token.trim()) return; const value = token.trim(); setToken(""); void run(() => api.setUpdateToken(value)); }}>
        <label htmlFor="update-token">{text.token}</label>
        <div className="maria-update-token"><input id="update-token" type="password" autoComplete="off" spellCheck={false} value={token} onChange={event => setToken(event.target.value)} placeholder="github_pat_…" disabled={busy} /><button className="button-secondary" type="submit" disabled={busy || !token.trim()}>{text.connect}</button></div>
      </form>
      {update.authenticated ? <button type="button" className="text-button" disabled={busy} onClick={() => void run(() => api.setUpdateToken(null))}>{text.remove}</button> : null}
    </details> : null}
    {error ? <p role="alert" className="maria-update-error">{error}</p> : null}
    <footer className="maria-update-source"><Icon name="github" /><span>mikkel32 / codex-web-gpt-enhanced</span></footer>
  </div>;
}

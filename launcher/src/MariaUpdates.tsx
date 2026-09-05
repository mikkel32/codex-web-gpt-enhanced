import { useState } from "react";
import { Icon } from "./icons";
import type { LauncherSnapshot } from "./types";

export function MariaUpdates({ snapshot, install }: { snapshot: LauncherSnapshot; install: () => Promise<void> }) {
  const api = window.codexWebLauncher!;
  const update = snapshot.update;
  const [token, setToken] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const version = "version" in update ? update.version : undefined;
  const busy = working || ["checking", "downloading", "installing"].includes(update.status);
  const active = snapshot.browser?.status === "running" || snapshot.operation?.status === "running";
  const title = {
    disabled: "Your development workspace", idle: "Keep Maria close to the latest",
    checking: "Checking our releases", "up-to-date": "You're up to date", ahead: "You're ahead of the release",
    available: "A better Maria is ready", downloading: "Preparing your update", installing: "Installing Maria",
    error: "Couldn't check right now", "access-required": "Connect to our private releases",
  }[update.status];
  const run = async (action: () => Promise<unknown>) => {
    setWorking(true); setError("");
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setWorking(false); }
  };
  return <div className="maria-page maria-updates">
    <header className="maria-update-heading"><span className="maria-eyebrow">MARIA / RELEASES</span><h1>{title}</h1><p>Improvements from our GitHub repository, delivered at your pace.</p></header>
    <section className={`maria-update-card ${version ? "has-update" : ""}`} aria-label="Release status">
      <div className="maria-update-version"><span className="maria-card-icon"><Icon name="update" /></span><div><span>Installed on this computer</span><strong>Maria {snapshot.version}</strong></div><span className="maria-pill">{snapshot.profile === "development" ? "DEV" : "Stable channel"}</span></div>
      <div role="status" aria-live="polite">
        {version ? <p className="maria-update-new">Update available <strong>v{version}</strong></p> : null}
        {"latestVersion" in update && update.latestVersion ? <p>Latest published release: v{update.latestVersion}</p> : null}
        {"message" in update ? <p>{update.message}</p> : null}
        {update.status === "disabled" ? <p>Source and DEV installations stay isolated. Update your checkout to get the latest code.</p> : null}
        {update.status === "available" ? <p>Maria verifies the download before installing and reopening. Your settings and ChatGPT session stay in place.</p> : null}
        {active && version ? <p>Finish the active operation before installing.</p> : null}
      </div>
      <div className="maria-update-actions">
        {version ? <button className="button-primary" disabled={busy || active || update.status === "access-required"} onClick={() => void run(install)}><Icon name="update" />{update.status === "downloading" ? "Downloading…" : update.status === "installing" ? "Installing…" : `Update to ${version}`}</button> : null}
        <button className="button-secondary" disabled={busy || update.status === "disabled"} onClick={() => void run(() => api.checkUpdates())}>{update.status === "checking" ? "Checking…" : "Check for updates"}</button>
        <button className="text-button" onClick={() => void run(() => api.openReleases())}>Release notes & downloads <Icon name="github" /></button>
      </div>
      <p className="maria-update-checked">{update.status === "disabled" ? "Source builds are updated from your checkout." : <>{update.checkedAt ? `Last successful check: ${new Date(update.checkedAt).toLocaleString()}` : "No successful release check yet"} · Checks automatically every four hours.</>}</p>
    </section>
    {update.status !== "disabled" ? <details className="maria-update-access" open={update.status === "access-required" ? true : undefined}>
      <summary>Private GitHub access {update.authenticated ? "· Connected" : "· Optional"}</summary>
      <p>You can download releases using your existing GitHub browser sign-in. For automatic checks and in-app updates, use a fine-grained GitHub token limited to <strong>mikkel32/codex-web-gpt-enhanced</strong> with <strong>Contents: Read-only</strong>. Maria encrypts it with your operating system and sends it only to our repository's GitHub release API.</p>
      <form onSubmit={event => { event.preventDefault(); const value = token; setToken(""); void run(() => api.setUpdateToken(value)); }}>
        <label htmlFor="update-token">GitHub access token</label>
        <div className="maria-update-token"><input id="update-token" type="password" autoComplete="off" spellCheck={false} value={token} onChange={event => setToken(event.target.value)} placeholder="github_pat_…" disabled={busy} /><button className="button-secondary" type="submit" disabled={busy || !token.trim()}>Connect & check</button></div>
      </form>
      {update.authenticated ? <button className="text-button" disabled={busy} onClick={() => void run(() => api.setUpdateToken(null))}>Remove saved access</button> : null}
    </details> : null}
    {error ? <p role="alert" className="maria-update-error">{error}</p> : null}
    <footer className="maria-update-source"><Icon name="github" /><span>mikkel32 / codex-web-gpt-enhanced</span></footer>
  </div>;
}

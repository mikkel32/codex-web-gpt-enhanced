import { useEffect, useState } from "react";
import { Icon } from "./icons";
import type { WebAccessState } from "./types";

export function WebAccessNotice({ access, openBrowser }: { access?: WebAccessState; openBrowser?: () => void }) {
  const [now, setNow] = useState(Date.now);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const until = access?.status === "paused" && access.retryAt ? Date.parse(access.retryAt) : 0;
  useEffect(() => {
    if (!until || until <= Date.now()) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(2_147_000_000, until - Date.now() + 50));
    return () => clearTimeout(timer);
  }, [until, now]);
  if (!access || access.status !== "paused") return null;
  const title = { verification: "ChatGPT needs you", "rate-limit": "Giving ChatGPT a moment", "sign-in": "Sign in to continue", service: "ChatGPT is temporarily unavailable", "local-state": "WebGPT paused locally" }[access.reason];
  const waiting = until > Math.max(now, Date.now());
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError("");
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  return <aside className="web-access-notice" aria-label="Web sending paused">
    <Icon name="info" />
    <div className="web-access-copy" role="status"><strong>{title}</strong>
      <p>{access.reason === "verification" ? "Complete the verification in ChatGPT, then resume here." : access.reason === "sign-in" ? "Finish signing in to ChatGPT, then resume here." : access.reason === "local-state" ? "Maria could not read its pause record. Review the current task, then resume." : "Web sending is paused to respect the service's request."} Native Codex remains available.</p>
      {until ? <p>{waiting ? "Wait until" : "Cooldown ended at"} {new Date(until).toLocaleString()}.</p> : null}
      <small>Resume enables your next request. Stopped turns are never replayed automatically.</small>
      {error ? <p className="web-access-error" role="alert">{error}</p> : null}
    </div>
    <div className="web-access-actions">
      <button className="button-secondary" disabled={busy} onClick={() => { openBrowser?.(); void run(() => window.codexWebLauncher!.reviewWebAccess()); }}>View ChatGPT</button>
      <button className="button-primary" disabled={busy || waiting} onClick={() => void run(() => window.codexWebLauncher!.resumeWebAccess())}>{waiting ? "Waiting for cooldown" : "Resume WebGPT"}</button>
    </div>
  </aside>;
}

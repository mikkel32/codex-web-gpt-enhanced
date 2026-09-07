import { useEffect, useId, useRef, useState } from "react";
import type { DoctorReport, LauncherSnapshot, Surface } from "./types";
import { Icon } from "./icons";
import { describeSetupError, setupErrorDetail } from "./setup-errors";
import { workspaceCopy } from "./workspace-copy";
import { launcherComputer } from "./workspace-state";

/** User-triggered and read-only. No polling, credentials, filesystem remapping, or automatic retry. */
export function ConnectionDiagnostics({ snapshot, navigate }: {
  snapshot: LauncherSnapshot; navigate: (surface: Surface) => void;
}) {
  const t = workspaceCopy(snapshot.state.language);
  const id = useId();
  const [report, setReport] = useState<DoctorReport | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [input, setInput] = useState("");
  const generation = useRef(0);
  const flight = useRef(false);
  // Never retain a green diagnostic across a changed installation or unmount.
  useEffect(() => {
    generation.current += 1; setReport(null); setError(""); setPending(false); flight.current = false;
    return () => { generation.current += 1; };
  }, [snapshot.profile, snapshot.platform, snapshot.version, snapshot.profilePaths.codexHome, snapshot.connectorName, snapshot.state.browserInteractionMode,
    snapshot.mcpCredentialsConfigured, snapshot.state.coreSetupComplete, snapshot.state.mcpSetupComplete]);
  const check = async () => {
    if (flight.current || snapshot.operation?.status === "running") return;
    flight.current = true;
    const ticket = generation.current;
    setPending(true); setError(""); setReport(null);
    try {
      const next = await window.codexWebLauncher!.doctor();
      if (ticket === generation.current) setReport(next);
    } catch (cause) {
      if (ticket === generation.current) setError(setupErrorDetail(cause));
    } finally {
      if (ticket === generation.current) { setPending(false); flight.current = false; }
    }
  };
  const issueText = input.trim() || error || report?.checks.filter(item => item.status === "error")
    .map(item => [item.message, item.detail].filter(Boolean).join(": ")).join("; ");
  const issue = issueText ? describeSetupError(issueText, snapshot.state.language) : null;
  return <details className="connection-diagnostics">
    <summary><span><Icon name="activity" />{t.diagnostics}</span><Icon name="chevron" /></summary>
    <div className="connection-diagnostics-body">
      <p>{t.diagnosticsBody}</p>
      <dl className="connection-facts">
        <div><dt>{t.computer}</dt><dd>{launcherComputer(snapshot.platform)} · {snapshot.version}</dd></div>
        <div><dt>{t.connector}</dt><dd>{snapshot.connectorName}</dd></div>
      </dl>
      <button className="button-secondary" disabled={pending || snapshot.operation?.status === "running"} onClick={() => void check()}>
        <Icon name="reload" />{pending ? t.checking : t.check}
      </button>
      <p className="connection-boundary">{t.boundary}</p>
      {report ? <div className="connection-check-results">
        <strong role="status">{report.ok ? t.checked : t.failed}</strong>
        {report.checks.map((item, index) => <div className={`connection-check is-${item.status}`} key={`${item.id}-${index}`}>
          <Icon name={item.status === "ok" ? "check" : "alert"} /><div><p>{setupErrorDetail(item.message)}</p>
            {item.detail ? <details><summary>{t.details}</summary><pre>{setupErrorDetail(item.detail)}</pre></details> : null}
          </div>
        </div>)}
      </div> : null}
      <label className="connection-error-label" htmlFor={id}>{t.explain}</label>
      <textarea id={id} rows={2} maxLength={4000} value={input} placeholder={t.placeholder}
        autoComplete="off" spellCheck={false} onChange={event => setInput(event.target.value)} />
      <small>{t.private}</small>
      {issue ? <div className="connection-issue" role="status"><strong>{issue.title}</strong><p>{issue.message}</p>
        <button className="text-button" onClick={() => navigate(issue.kind === "workspace" || issue.kind === "toolContract" || issue.kind === "credentials" ? "mcp" : "activity")}>
          {issue.kind === "workspace" || issue.kind === "toolContract" || issue.kind === "credentials" ? t.toolsAction : t.activity}<Icon name="forward" />
        </button>
      </div> : null}
      <details className="connection-technical"><summary>{t.details}</summary>
        <dl className="connection-facts"><div><dt>{t.configuration}</dt><dd>{snapshot.profilePaths.codexHome}</dd></div></dl>
        <p>{t.scope}</p>
        <code>codex_tool_inventory → codex_tool_call</code>
      </details>
    </div>
  </details>;
}

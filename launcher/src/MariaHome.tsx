import { useState, type ReactNode } from "react";
import { Icon } from "./icons";
import type { LauncherSnapshot, Surface } from "./types";
import { useConnectionStatus } from "./useConnectionStatus";
import { WebAccessNotice } from "./WebAccessNotice";
import readme from "../../README.md?raw";
import { BrandMark } from "./BrandMark";
import { studioCopy } from "./studio-copy";

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
  const tabs = snapshot.browser?.tabs ?? [];
  const paused = snapshot.browser?.webAccess?.status === "paused";
  const accountReady = !paused && (manual ? snapshot.state.mcpSetupComplete : snapshot.browser?.authenticated);
  const webReady = !paused && (manual ? snapshot.state.mcpSetupComplete : snapshot.browser?.authenticated && snapshot.state.codexCatalogVerified);
  const steps = [
    { id: "account", title: s.web, done: manual ? snapshot.state.mcpSetupComplete : snapshot.browser?.authenticated, surface: manual ? "mcp" : "browser" },
    { id: "models", title: s.manageModels, done: snapshot.state.codexCatalogVerified, surface: "setup" },
    { id: "tools", title: s.tools, done: snapshot.state.mcpSetupComplete, surface: "mcp" },
  ] as const;
  const complete = steps.filter(step => step.done).length;
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
  return <div className="studio-home maria-page">
    <header className="studio-page-heading">
      <div><span className="maria-eyebrow">MARIA / {s.workspace}</span><h1>{s.greeting}</h1><p>{s.intro}</p></div>
      <button className="button-primary" onClick={() => navigate("browser")}>{s.emptyAction}<Icon name="forward" /></button>
    </header>
    <WebAccessNotice access={snapshot.browser?.webAccess} openBrowser={() => navigate("browser")} />
    <div className="studio-dashboard">
      <div className="studio-main-column">
        <section className="studio-conversations" aria-label={s.conversations}>
          <div className="studio-section-heading"><h2>{s.conversations}<span className="studio-count">{tabs.length}</span></h2>
            {tabs.length ? <button className="text-button" onClick={() => navigate("browser")}>{s.openWorkspace}<Icon name="forward" /></button> : null}
          </div>
          {tabs.length ? <div className="studio-session-list">{tabs.map(tab =>
            <button className="studio-session" key={tab.id} onClick={() => void selectTab(tab.id)}>
              <span className={`studio-session-icon ${tab.status === "running" ? "is-working" : ""}`}><Icon name="browser" /></span>
              <span className="studio-session-copy"><strong>{tab.title || "ChatGPT"}</strong><small>{tab.interactionMode === "manual" ? s.manual : s.automatic}</small></span>
              <span className={`studio-status ${tab.status === "running" ? "is-running" : tab.status === "error" ? "is-error" : ""}`}><i />{tab.status === "running" ? s.working : tab.status === "error" ? s.attention : s.retained}</span><Icon name="forward" />
            </button>)}</div> : <div className="studio-empty-conversations">
            <BrandMark />
            <h3>{s.emptyTitle}</h3><p>{s.emptyBody}</p>
            <button className="button-secondary" onClick={() => navigate("setup")}>{s.manageModels}<Icon name="forward" /></button>
          </div>}
        </section>
        <section className="studio-models" aria-label={s.modelTitle}>
          <div className="studio-section-heading"><h2>{s.modelTitle}</h2></div>
          <div className="studio-model-grid">
            <article className="studio-model-card"><span className="studio-model-icon"><Icon name="setup" /></span><span className="studio-model-kind">NATIVE</span>
              <h3>Codex</h3><p>{s.nativeBody}</p>
              <button className="text-button" onClick={() => void copyCommand()}>{copied ? s.copied : s.copyNative}<Icon name={copied ? "check" : "external"} /></button>
            </article>
            <article className="studio-model-card is-web"><span className="studio-model-icon"><Icon name="globe" /></span><span className="studio-model-kind">WEB</span>
              <h3>ChatGPT</h3><p>{s.webBody}</p>
              <button className="text-button" onClick={() => navigate("setup")}>{webReady ? s.manageModels : s.finishSetup}<Icon name="forward" /></button>
            </article>
          </div>
        </section>
        <button className="studio-guide-card" onClick={() => navigate("guide")}><span className="studio-guide-icon"><Icon name="logs" /></span><span><strong>{s.guide}</strong><small>{s.guideBody}</small></span><Icon name="forward" /></button>
      </div>
      <aside className="studio-context-column">
        <section className="studio-connection-panel" aria-label={s.connections}>
          <div className="studio-section-heading"><h2>{s.connections}</h2><button className="icon-button" aria-label="Refresh connection status" disabled={checking} onClick={refresh}><Icon name="reload" /></button></div>
          <button className="studio-connection-row" onClick={() => navigate("setup")}><Icon name="setup" /><span><strong>{s.native}</strong><small>{development ? "DEV" : nativeReady ? s.connected : checking ? s.checking : s.attention}</small></span><span className={`studio-indicator ${nativeReady ? "is-ready" : "needs-attention"}`} title={nativeReady ? s.ready : s.attention} /><span className="sr-only">{nativeReady ? s.ready : checking ? s.checking : s.attention}</span></button>
          <button className="studio-connection-row" onClick={() => navigate("browser")}><Icon name="browser" /><span><strong>{s.web}</strong><small>{paused ? s.attention : accountReady ? s.connected : manual ? s.manual : s.signIn}</small></span><span className={`studio-indicator ${accountReady ? "is-ready" : "needs-attention"}`} /></button>
          <button className="studio-connection-row" onClick={() => navigate("mcp")}><Icon name="mcp" /><span><strong>{s.tools}</strong><small>{snapshot.state.mcpSetupComplete ? s.connected : s.connect}</small></span><span className={`studio-indicator ${snapshot.state.mcpSetupComplete ? "is-ready" : "needs-attention"}`} /></button>
          <div className="studio-mode"><span>{s.mode}</span><button onClick={() => navigate("settings")}>{manual ? s.manual : s.automatic}<Icon name="chevron" /></button></div>
          {error ? <p role="status" className="studio-inline-error">{s.attention}: {error}</p> : null}
        </section>
        {complete < steps.length ? <section className="studio-setup-panel">
          <div className="studio-section-heading"><h2>{s.setup}</h2><span>{complete}/{steps.length}</span></div>
          <p>{s.setupHint}</p><progress max={steps.length} value={complete} aria-label={s.setup} />
          {steps.map((step, index) => <button className={`studio-setup-step ${step.done ? "is-done" : ""}`} key={step.id} onClick={() => navigate(step.surface)}>
            <span>{step.done ? <Icon name="check" /> : index + 1}</span><strong>{step.title}</strong><Icon name="chevron" />
          </button>)}
        </section> : <section className="studio-ready-panel"><Icon name="check" /><h3>{s.modelReady}</h3><p>{s.nativeAvailable}</p><button className="text-button" onClick={() => navigate("settings")}>{s.edit}<Icon name="forward" /></button></section>}
        <div className="studio-build-note"><span>MARIA</span><span>{development ? "DEV / " : ""}{snapshot.version}</span></div>
      </aside>
    </div>
    {actionError ? <p role="alert" className="studio-inline-error">{actionError}</p> : null}
  </div>;
}

function inline(text: string, openLink?: (url: string) => void): ReactNode[] {
  return text.split(/(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (link) {
      const url = link[2]!.startsWith("docs/") ? `https://github.com/mikkel32/codex-web-gpt-enhanced/blob/main/${link[2]}` : link[2]!;
      return <button className="text-button maria-guide-link" key={i} onClick={() => openLink?.(url)}>{link[1]}</button>;
    }
    return part.startsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong>
      : part.startsWith("`") ? <code key={i}>{part.slice(1, -1)}</code> : part;
  });
}

// Render the shipped README as React text; no raw HTML or remotely loaded content.
export function MariaGuide({ openRepository }: { openRepository: () => void }) {
  const [linkError, setLinkError] = useState("");
  const renderInline = (value: string) => inline(value, url => {
    setLinkError("");
    void window.codexWebLauncher!.openExternal(url).catch(() => setLinkError("Couldn't open the link. Open our repository to find this page."));
  });
  const nodes: ReactNode[] = [];
  const lines = readme.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("[![CI]")) continue;
    if (line.startsWith("```")) {
      const code: string[] = [];
      while (++i < lines.length && !lines[i]!.startsWith("```")) code.push(lines[i]!);
      nodes.push(<pre key={i}><code>{code.join("\n")}</code></pre>);
    } else if (line.startsWith("### ")) nodes.push(<h3 key={i}>{renderInline(line.slice(4))}</h3>);
    else if (line.startsWith("## ")) nodes.push(<h2 key={i}>{renderInline(line.slice(3))}</h2>);
    else if (line.startsWith("# ")) nodes.push(<h1 key={i}>{renderInline(line.slice(2))}</h1>);
    else if (/^[-*] /.test(line)) {
      const items = [line.slice(2)];
      while (/^[-*] /.test(lines[i + 1] ?? "")) items.push(lines[++i]!.slice(2));
      nodes.push(<ul key={i}>{items.map((t, n) => <li key={n}>{renderInline(t)}</li>)}</ul>);
    } else if (line.trim()) {
      const paragraph = [line];
      while (lines[i + 1]?.trim() && !/^(#|[-*] |```)/.test(lines[i + 1]!)) paragraph.push(lines[++i]!);
      nodes.push(<p key={i}>{renderInline(paragraph.join(" "))}</p>);
    }
  }
  return <div className="maria-page maria-guide"><div className="maria-guide-heading"><span className="maria-eyebrow">THE MARIA HANDBOOK</span><button className="button-secondary" onClick={openRepository}><Icon name="github" /> Our source code</button></div><article>{linkError ? <p role="alert">{linkError}</p> : null}{nodes}</article></div>;
}

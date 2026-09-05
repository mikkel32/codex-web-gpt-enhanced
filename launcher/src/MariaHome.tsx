import { useState, type ReactNode } from "react";
import { Icon } from "./icons";
import type { LauncherSnapshot, Surface } from "./types";
import { useConnectionStatus } from "./useConnectionStatus";
import readme from "../../README.md?raw";

export const MADE_WITH_LOVE = "Made with love -- Maria GPT 6 Astra 👀";

export function MariaHome({ snapshot, navigate }: {
  snapshot: LauncherSnapshot;
  navigate: (surface: Surface) => void;
}) {
  const { status, checking, error, refresh } = useConnectionStatus();
  const [nativeCommandCopied, setNativeCommandCopied] = useState(false);
  const nativeReady = !error && status?.nativeAvailable === true;
  const development = snapshot.profile === "development";
  const manual = snapshot.state.browserInteractionMode === "manual";
  const tabs = snapshot.browser?.tabs ?? [];
  const activeTurns = status?.activeBrowserTurns ?? tabs.filter(tab => tab.status === "running").length;
  const steps = [
    { id: "signin", title: manual ? "Connect your manual harness" : "Sign in to ChatGPT", done: manual ? snapshot.state.mcpSetupComplete : snapshot.browser?.authenticated, surface: manual ? "mcp" : "browser", body: manual ? "Link the connector for manual turns." : "Use a session from your existing browser." },
    { id: "models", title: "Add your Web models", done: snapshot.state.codexCatalogVerified, surface: "setup", body: "Native and Web models, in the same Codex picker." },
    { id: "tools", title: "Connect your workspace tools", done: snapshot.state.mcpSetupComplete, surface: "mcp", body: "Files, commands, and results in the same task." },
  ] as const;
  const readyCount = steps.filter(step => step.done).length;
  return <div className="maria-page moon-home">
    <div className="moon-topline"><span className="maria-eyebrow">MARIA / MOONLIGHT</span><span className="moon-edition">{development ? "ISOLATED DEV" : "CODEX + CHATGPT"}</span></div>
    <header className="maria-hero moon-hero">
      <div className="moon-hero-copy"><h1>Your workspace,<br /><span>in a different light.</span></h1>
        <p>A focused home for your models and conversations.<br />Keep building. Maria keeps the connection.</p>
        <div className="maria-hero-actions">
          <button className="button-primary" onClick={() => navigate("browser")}>Open ChatGPT <Icon name="forward" /></button>
          <button className="button-secondary" onClick={() => navigate("guide")}>Explore the guide <Icon name="logs" /></button>
        </div>
      </div>
      <div className="moon-art" aria-hidden="true"><div className="moon-halo" /><div className="moon-disc" /><span className="moon-orbit-label">A SPACE FOR YOUR NEXT IDEA</span></div>
    </header>
    <section className="moon-pulse" aria-label="Workspace status">
      <div><span className="moon-metric-label">NATIVE CODEX</span><strong><i className={nativeReady ? "moon-status is-ready" : "moon-status"} />{development ? "Separate" : nativeReady ? "Connected" : checking && !status ? "Checking" : error ? "Unavailable" : "Needs setup"}</strong></div>
      <div><span className="moon-metric-label">WEB ACTIVITY</span><strong>{activeTurns ? `${activeTurns} running` : "Ready when you are"}</strong></div>
      <div><span className="moon-metric-label">BROWSER WORKSPACE</span><strong>{tabs.length} / {snapshot.browser?.maxTabs ?? 5} tabs</strong></div>
      <button className="icon-button" aria-label="Refresh connection status" disabled={checking} onClick={refresh}><Icon name="reload" /></button>
    </section>
    <div className="moon-section-heading"><h2>Choose your route</h2><span>ONE WORKSPACE. YOUR CHOICE.</span></div>
    <section className="maria-connections" aria-label="Connections">
      <article className={`maria-connection ${nativeReady ? "is-ready" : ""}`}>
        <div className="maria-card-top"><span className="moon-route-number">01 / NATIVE</span><span className="maria-pill">{development ? "Production stays separate" : status?.recoveryAvailable ? "Recovery enabled" : "Codex account"}</span></div>
        <h2>Native Codex <Icon name="activity" /></h2>
        <p>{development ? "This checkout has its own state, browser, and port. Your installed connection stays independent." : "Your regular models, reasoning controls, and tools. Keep working even when Maria's window closes."}</p>
        <button className="text-button" onClick={() => nativeReady ? navigate("guide") : navigate("setup")}>{nativeReady ? "How it works" : "Set up connection"} <Icon name="forward" /></button>
      </article>
      <article className="maria-connection maria-web-connection">
        <div className="maria-card-top"><span className="moon-route-number">02 / WEB</span><span className="maria-pill">{manual ? "Manual mode" : "Automatic mode"}</span></div>
        <h2>ChatGPT Web <Icon name="browser" /></h2>
        <p>{manual ? "Choose your model and send in ChatGPT. Maria connects the tools and brings the results back to your Codex task." : "Your ChatGPT session, with your Codex workspace. Continue the same task with less repeated context."}</p>
        <button className="text-button" onClick={() => navigate("settings")}>Choose how you work <Icon name="forward" /></button>
      </article>
    </section>
    {tabs.length ? <section className="moon-sessions" aria-label="Current browser sessions">
      <div className="moon-section-heading"><h2>Your conversations</h2><button className="text-button" onClick={() => navigate("browser")}>Open workspace <Icon name="forward" /></button></div>
      {tabs.map(tab => <button key={tab.id} className="moon-session-row" onClick={() => navigate("browser")}><Icon name="browser" /><span>{tab.title || "ChatGPT conversation"}</span><small>{tab.status === "running" ? "Working" : tab.status === "ready" ? "Retained" : "Needs attention"}</small><Icon name="chevron" /></button>)}
    </section> : null}
    <details className="moon-setup" open={readyCount < 3}>
      <summary><span>Connection setup</span><span>{readyCount} / 3 ready</span></summary>
      {steps.map((step, index) => <button key={step.id} className="maria-checklist-row" onClick={() => navigate(step.surface)}>
        <span className={`maria-step-number ${step.done ? "is-done" : ""}`}>{step.done ? <Icon name="check" /> : index + 1}</span><span><strong>{step.title}</strong><small>{step.body}</small></span><Icon name="chevron" />
      </button>)}
    </details>
    {error ? <p className="moon-inline-error" role="status">Connection status is unavailable. Check Activity for details.</p> : null}
    <aside className="moon-native-access"><span className="maria-card-icon"><Icon name="setup" /></span><div><strong>Keep Codex independent.</strong><p>Open a native session from your terminal, even when Maria is stopped.</p></div><button className="text-button" onClick={() => void window.codexWebLauncher!.copyNativeCodexCommand().then(() => setNativeCommandCopied(true)).catch(() => setNativeCommandCopied(false))}>{nativeCommandCopied ? "Copied" : "Copy native command"} <Icon name={nativeCommandCopied ? "check" : "external"} /></button></aside>
    <footer className="maria-signature"><span>{MADE_WITH_LOVE}</span><span>MOONLIGHT EDITION · {snapshot.version}</span></footer>
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

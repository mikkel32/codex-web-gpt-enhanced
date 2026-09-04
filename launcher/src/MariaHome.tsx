import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "./icons";
import type { LauncherSnapshot, Surface } from "./types";
import readme from "../../README.md?raw";

export const MADE_WITH_LOVE = "Made with love -- Maria GPT 6 Astra 👀";

export function MariaHome({ snapshot, navigate }: {
  snapshot: LauncherSnapshot;
  navigate: (surface: Surface) => void;
}) {
  const [status, setStatus] = useState<{ nativeAvailable: boolean; browserConnected: boolean; activeBrowserTurns: number; recoveryAvailable?: boolean } | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [nativeCommandCopied, setNativeCommandCopied] = useState(false);
  useEffect(() => {
    let alive = true;
    let pending = false;
    const check = async () => {
      if (pending) return;
      pending = true;
      if (alive) setChecking(true);
      try {
        const next = await window.codexWebLauncher!.connectionStatus();
        if (alive) { setStatus(next); setError(false); }
      } catch { if (alive) setError(true); }
      finally { pending = false; if (alive) setChecking(false); }
    };
    void check();
    const timer = window.setInterval(() => void check(), 10_000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [refresh]);
  const nativeReady = !error && status?.nativeAvailable === true;
  const development = snapshot.profile === "development";
  const manual = snapshot.state.browserInteractionMode === "manual";
  const steps = [
    { title: manual ? "Connect your manual harness" : "Sign in to ChatGPT", done: manual ? snapshot.state.mcpSetupComplete : snapshot.browser?.authenticated, surface: manual ? "mcp" : "browser", body: manual ? "Link the connector for manual turns." : "Use your own ChatGPT session." },
    { title: "Add your Web models", done: snapshot.state.codexCatalogVerified, surface: "setup", body: "Keep Codex models in the same picker." },
    { title: "Give ChatGPT your Codex tools", done: snapshot.state.mcpSetupComplete, surface: "mcp", body: "Connect files, commands, and app tools." },
  ] as const;
  return (
    <div className="maria-page">
      <header className="maria-hero">
        <div className="maria-eyebrow"><span className="maria-spark">✦</span> {development ? "ISOLATED DEVELOPMENT WORKSPACE" : "YOUR MODELS. YOUR WORKSPACE."}</div>
        <h1>A little more <span>possibility.</span></h1>
        <p>Codex when you want it. ChatGPT when you need it.<br />One calm place to keep everything connected.</p>
        <div className="maria-hero-actions">
          <button className="button-primary" onClick={() => navigate("browser")}>Open ChatGPT <Icon name="forward" /></button>
          <button className="button-secondary" onClick={() => navigate("guide")}>Explore the guide <Icon name="logs" /></button>
        </div>
        <div className="maria-orbit" aria-hidden="true"><i /><i /><b>M</b><span>✦</span></div>
      </header>

      <section className="maria-connections" aria-label="Connections">
        <article className={`maria-connection ${nativeReady ? "is-ready" : ""}`}>
          <div className="maria-card-top"><span className="maria-card-icon"><Icon name="activity" /></span><span className="maria-pill">{development ? "Separate production environment" : nativeReady ? status?.recoveryAvailable ? "Protected" : "Connected" : checking && !status ? "Checking" : "Needs setup"}</span></div>
          <h2>Native Codex</h2>
          <p>{development ? "This development window has its own browser, files, and port. Your installed Maria and native Codex settings stay separate." : status?.recoveryAvailable ? "Your native connection has independent recovery. It stays available after the window closes and restarts if the transport exits." : "Your regular models, reasoning controls, and tools. The connection stays available when Maria's window closes."}</p>
          <button className="text-button" onClick={() => nativeReady ? navigate("guide") : navigate("setup")}>{nativeReady ? "How it works" : "Set up connection"} <Icon name="chevron" /></button>
        </article>
        <article className="maria-connection maria-web-connection">
          <div className="maria-card-top"><span className="maria-card-icon"><Icon name="browser" /></span><span className="maria-pill">{manual ? "Manual mode" : "Automatic mode"}</span></div>
          <h2>ChatGPT Web</h2>
          <p>{manual ? "Choose your model, paste your prompt, and send. Maria brings the tools and results back to your Codex task." : "Your ChatGPT session, connected to your Codex workspace. Select a Maria Web model in Codex to get started."}</p>
          <button className="text-button" onClick={() => navigate("settings")}>Choose how you work <Icon name="chevron" /></button>
        </article>
      </section>

      <section className="maria-checklist" aria-label="Getting started">
        <div className="maria-section-title"><div><span className="maria-eyebrow">MAKE YOURSELF AT HOME</span><h2>Your next steps</h2></div><span>{steps.filter(s => s.done).length} / 3 ready</span></div>
        {steps.map((step, i) => <button key={step.title} className="maria-checklist-row" onClick={() => navigate(step.surface)}>
          <span className={`maria-step-number ${step.done ? "is-done" : ""}`}>{step.done ? <Icon name="check" /> : i + 1}</span>
          <span><strong>{step.title}</strong><small>{step.body}</small></span><Icon name="chevron" />
        </button>)}
      </section>

      <div className="maria-connection-note" role="status"><Icon name={error ? "alert" : "info"} /><span>{error ? "Connection status is unavailable. Check Activity for details." : status?.activeBrowserTurns ? `${status.activeBrowserTurns} ChatGPT turn${status.activeBrowserTurns === 1 ? "" : "s"} running. Closing the window keeps your work going.` : "Close the window, keep your flow. Native Codex stays connected in the background."}</span><button className="text-button" disabled={checking} onClick={() => setRefresh(n => n + 1)}>{checking ? "Checking…" : "Refresh"}</button></div>
      <div className="maria-connection-note"><Icon name="setup" /><span>Developing Maria? Open a direct native Codex session from your project terminal, even if Maria is completely stopped.</span><button className="text-button" onClick={() => void window.codexWebLauncher!.copyNativeCodexCommand().then(() => setNativeCommandCopied(true)).catch(() => setNativeCommandCopied(false))}>{nativeCommandCopied ? "Copied" : "Copy native command"}</button></div>
      <footer className="maria-signature"><span>{MADE_WITH_LOVE}</span><span>v{snapshot.version}</span></footer>
    </div>
  );
}

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => part.startsWith("**")
    ? <strong key={i}>{part.slice(2, -2)}</strong>
    : part.startsWith("`") ? <code key={i}>{part.slice(1, -1)}</code> : part);
}

// Render the shipped README as React text; no raw HTML or remotely loaded content.
export function MariaGuide({ openRepository }: { openRepository: () => void }) {
  const nodes: ReactNode[] = [];
  const lines = readme.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("```")) {
      const code: string[] = [];
      while (++i < lines.length && !lines[i]!.startsWith("```")) code.push(lines[i]!);
      nodes.push(<pre key={i}><code>{code.join("\n")}</code></pre>);
    } else if (line.startsWith("### ")) nodes.push(<h3 key={i}>{inline(line.slice(4))}</h3>);
    else if (line.startsWith("## ")) nodes.push(<h2 key={i}>{inline(line.slice(3))}</h2>);
    else if (line.startsWith("# ")) nodes.push(<h1 key={i}>{inline(line.slice(2))}</h1>);
    else if (/^[-*] /.test(line)) {
      const items = [line.slice(2)];
      while (/^[-*] /.test(lines[i + 1] ?? "")) items.push(lines[++i]!.slice(2));
      nodes.push(<ul key={i}>{items.map((t, n) => <li key={n}>{inline(t)}</li>)}</ul>);
    } else if (line.trim()) {
      const paragraph = [line];
      while (lines[i + 1]?.trim() && !/^(#|[-*] |```)/.test(lines[i + 1]!)) paragraph.push(lines[++i]!);
      nodes.push(<p key={i}>{inline(paragraph.join(" "))}</p>);
    }
  }
  return <div className="maria-page maria-guide"><div className="maria-guide-heading"><span className="maria-eyebrow">THE MARIA HANDBOOK</span><button className="button-secondary" onClick={openRepository}><Icon name="github" /> Our source code</button></div><article>{nodes}</article></div>;
}

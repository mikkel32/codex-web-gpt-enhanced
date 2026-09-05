import { useEffect, useState } from "react";
import { Icon } from "./icons";
import chromeIcon from "../assets/browser-chrome.png";
import edgeIcon from "../assets/browser-edge.png";
import safariIcon from "../assets/browser-safari.png";
const browserIcons = { chrome: chromeIcon, edge: edgeIcon, safari: safariIcon };

type BrowserChoice = { id: "chrome" | "edge" | "safari"; name: string; available: boolean };

export function BrowserSignIn({ onBack, setError }: { onBack: () => void; setError: (message: string | null) => void }) {
  const api = window.codexWebLauncher!;
  const [browsers, setBrowsers] = useState<BrowserChoice[]>([]);
  const [selected, setSelected] = useState<BrowserChoice | null>(null);
  const [phase, setPhase] = useState("choose");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { let alive = true; void api.signInBrowsers().then(next => { if (alive) setBrowsers(next); }).catch(error => setError(error.message)); return () => { alive = false; }; }, []);
  useEffect(() => {
    if (!selected || ["choose", "connected", "expired", "error"].includes(phase)) return;
    let alive = true; let pending = false;
    const check = async () => {
      if (pending) return; pending = true;
      try { const next = await api.browserSignInStatus(); if (alive) { setPhase(next.phase); setMessage(next.message ?? ""); } }
      catch (error) { if (alive) setError(error instanceof Error ? error.message : String(error)); }
      finally { pending = false; }
    };
    const timer = window.setInterval(() => void check(), 1000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [selected, phase]);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await action(); } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const choose = async (browser: BrowserChoice) => run(async () => {
    const flow = await api.beginBrowserSignIn(browser.id); setSelected(browser); setPhase(flow.phase); setCopied(false); setMessage("");
  });
  return <section className="browser-signin-card" aria-label="Connect an existing browser login">
    <div className="maria-eyebrow">YOUR EXISTING CHATGPT LOGIN</div>
    <h1>{phase === "verifying" ? "Checking your connection…" : phase === "connected" ? "You're connected." : selected ? `Connect ${selected.name}` : "Already signed in elsewhere?"}</h1>
    <p>Bring your ChatGPT session into Maria. Your saved passwords, other sites, and browser history stay where they are.</p>
    {!selected ? <div className="signin-browser-choices">{browsers.map(browser => <button key={browser.id} className="signin-browser-choice" disabled={!browser.available || busy} onClick={() => void choose(browser)}>
      <img className="signin-browser-icon" src={browserIcons[browser.id]} alt="" aria-hidden="true" />
      <span><strong>{browser.name}</strong><small>{browser.available ? "Use the account in this browser" : "Not installed"}</small></span><Icon name="chevron" />
    </button>)}</div> : <>
      {phase === "waiting" ? <div className="signin-steps">
        <div><span>1</span><section><strong>Enable the connector once</strong><p>{selected.id === "safari" ? "Open the Safari companion and enable Maria Browser Sign-in in Safari's extension settings." : "Open your browser's extensions page, enable Developer mode, choose Load unpacked, and select the connector folder."}</p><div className="signin-actions">
          {selected.id === "safari" ? <button className="button-secondary" disabled={busy} onClick={() => void run(() => api.enableSafariConnector())}>Enable Safari connector</button> : <>
            <button className="button-secondary" disabled={busy} onClick={() => void run(() => api.openSignInBrowser(selected.id, "setup"))}>Open extensions</button>
            <button className="button-secondary" disabled={busy} onClick={() => void run(() => api.showBrowserConnector())}>Show connector folder</button>
          </>}
        </div></section></div>
        <div><span>2</span><section><strong>Connect the account you want</strong><p>{selected.id === "safari" ? "Copy the connection code, open Maria Browser Sign-in from Safari's toolbar, paste the code, and connect." : "Open the connector in the browser profile where ChatGPT is signed in, then choose Connect this browser."}</p><div className="signin-actions">
          <button className="button-primary" disabled={busy} onClick={() => void run(() => api.openSignInBrowser(selected.id, "connect"))}>{selected.id === "safari" ? "Open Safari" : "Open connector"}<Icon name="external" /></button>
          <button className="button-secondary" disabled={busy} onClick={() => void run(async () => { await api.copyBrowserConnectionCode(); setCopied(true); })}>{copied ? "Code copied" : "Copy connection code"}</button>
        </div></section></div>
      </div> : <div className="signin-progress" role="status"><Icon name={phase === "connected" ? "check" : phase === "verifying" ? "reload" : "alert"} /><span>{phase === "verifying" ? "Maria is verifying the session. Complete any browser confirmation in its ChatGPT view." : phase === "connected" ? "ChatGPT is ready inside Maria." : message || "This connection expired. Choose the browser again to get a fresh code."}</span></div>}
    </>}
    <div className="signin-footer"><button className="text-button" disabled={busy || phase === "verifying"} onClick={() => void run(async () => { await api.cancelBrowserSignIn(); setSelected(null); setPhase("choose"); onBack(); })}>Back to other sign-in options</button>
      {selected && ["expired", "error"].includes(phase) ? <button className="button-secondary" onClick={() => void choose(selected)}>Try again</button> : null}
    </div>
  </section>;
}

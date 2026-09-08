import { useEffect, useRef, useState } from "react";
import type { LauncherSnapshot, Surface } from "./types";
import { createAutomaticSetup, type AutomaticSetupState, type SetupPhase } from "./automatic-setup";
import { describeSetupError } from "./setup-errors";
import { setupRecoveryKind } from "./setup-recovery";
import { guidedCopy } from "./guided-copy";
import { guidedSetupSteps, setupEvidenceKey } from "./guided-setup-view";
import { Icon } from "./icons";
import "./automatic-setup.css";
import { setupHasActiveWork } from "./automatic-setup";
import { useConnectionStatus } from "./useConnectionStatus";

/** One controller for the entire shell. Navigation never abandons a setup transaction. */
export function AutomaticSetup({ snapshot, surface, navigate, clearError, startOnMount = false }: {
  snapshot: LauncherSnapshot; surface: Surface; navigate: (surface: Surface) => void;
  clearError: () => void; startOnMount?: boolean;
}) {
  const [state, setState] = useState<AutomaticSetupState>({ phase: "idle", active: false });
  const [wantTools, setWantTools] = useState(false);
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const controller = useRef<ReturnType<typeof createAutomaticSetup> | null>(null);
  const initialIntentConsumed = useRef(false);
  const { status, stale, error: connectionError } = useConnectionStatus();
  const text = guidedCopy(snapshot.state.language);
  const evidence = setupEvidenceKey(snapshot);
  const lastEvidence = useRef(evidence);
  const expanded = surface === "home";

  useEffect(() => {
    const api = window.codexWebLauncher;
    if (!api) return;
    const setup = createAutomaticSetup({ api, publish: setState,
      navigate: next => navigateRef.current(next === "setup" ? "home" : next) });
    controller.current = setup;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const changed = () => {
      if (!setup.getState().active || timer !== undefined) return;
      // Coalesce the state/browser/operation events from a single commit.
      timer = setTimeout(() => { timer = undefined; void setup.resume(); }, 100);
    };
    const subscriptions = [api.onStateChanged(changed), api.onBrowserState(changed), api.onOperation(operation => { setup.observeOperation(operation); changed(); })];
    return () => {
      clearTimeout(timer);
      subscriptions.forEach(unsubscribe => unsubscribe());
      setup.dispose(); controller.current = null; initialIntentConsumed.current = false;
    };
  }, []);

  useEffect(() => {
    // The main-process state event can arrive before completeOnboarding's IPC
    // reply. Observe the explicit start intent even if this shell is mounted.
    if (startOnMount && !initialIntentConsumed.current && controller.current) {
      initialIntentConsumed.current = true;
      void controller.current.start();
    }
  }, [startOnMount]);

  useEffect(() => {
    const setup = controller.current;
    if (lastEvidence.current !== evidence) {
      lastEvidence.current = evidence;
      const proven = setup?.getState().snapshot;
      if (!proven || setupEvidenceKey(proven) !== evidence) setup?.invalidate();
    }
    if ((!startOnMount || initialIntentConsumed.current) && snapshot.state.coreSetupComplete && setup?.getState().phase === "idle") {
      void setup.inspect();
    }
  }, [evidence, startOnMount, snapshot.state.coreSetupComplete]);

  useEffect(() => {
    if (stale || connectionError || (status && (!status.nativeAvailable || status.activeBrowserTurns > 0) && snapshot.profile !== "development")) {
      controller.current?.invalidate();
    } else if (status && snapshot.state.coreSetupComplete
      && (!startOnMount || initialIntentConsumed.current)
      && controller.current?.getState().phase === "idle") {
      void controller.current.inspect();
    }
  }, [status, stale, connectionError, snapshot.profile, snapshot.state.coreSetupComplete, startOnMount]);

  // Recovery may finish without a browser event. Never resume a paused controller.
  useEffect(() => {
    const setup = controller.current;
    if (!stale && !connectionError && status && setup?.getState().active
      && setup.getState().phase === "busy") void setup.resume();
  }, [status, stale, connectionError]);

  const pending = ["checking", "installing", "verifying"].includes(state.phase);
  const locked = state.active || pending || setupHasActiveWork(snapshot);
  const savedTools = snapshot.mcpCredentialsConfigured || snapshot.state.mcpRuntimeInstalled === true;
  const manual = snapshot.state.browserInteractionMode === "manual";
  const canChoose = !savedTools && !manual && snapshot.profile !== "development";
  const steps = guidedSetupSteps(snapshot, state.phase, canChoose ? wantTools : state.toolsRequested);
  const done = steps.filter(step => step.done).length;
  const failure = state.error ? describeSetupError(state.error, snapshot.state.language) : null;
  const retryable = state.error ? setupRecoveryKind(state.error) !== null : false;
  const phaseCopy: Record<SetupPhase, [string, string]> = {
    idle: [snapshot.state.coreSetupComplete ? text.check : text.setup, text.setupBody],
    checking: [text.checking, text.checkingBody], busy: [text.busy, text.busyBody],
    "sign-in": [text.signIn, text.signInBody], review: [text.review, text.reviewBody],
    credentials: [text.credentials, text.credentialsBody], installing: [text.installing, text.installingBody],
    codex: [text.codex, text.codexBody], connector: [text.connector, text.connectorBody],
    verifying: [text.verifying, text.verifyingBody], ready: [text.ready, text.readyBody],
    paused: [text.paused, text.pausedBody], error: [failure?.title ?? text.attention, failure?.message ?? text.reviewDetails],
  };
  const [title, body] = phaseCopy[state.phase];
  const stepNames = { account: text.stepAccount, runtime: text.stepRuntime, codex: text.stepCodex, tools: text.stepTools, check: text.stepCheck };
  const continueSetup = () => {
    clearError();
    if (state.active) void controller.current?.continue();
    else void controller.current?.start({ toolsRequested: canChoose ? wantTools : state.toolsRequested });
  };
  const action = () => {
    if (!expanded) { navigate("home"); return; }
    if (state.phase === "sign-in" || state.phase === "review") { navigate("browser"); return; }
    if (state.phase === "credentials" || state.phase === "connector") { navigate("mcp"); return; }
    if (state.phase === "ready") { navigate("browser"); return; }
    if (state.phase === "error" && !retryable) {
      navigate(failure?.kind === "signIn" ? "browser"
        : ["credentials", "toolContract", "workspace"].includes(failure?.kind ?? "") ? "mcp" : "activity");
      return;
    }
    continueSetup();
  };
  const actionLabel = !expanded ? text.backHome : state.phase === "sign-in" ? text.openSignIn
    : state.phase === "review" ? text.openReview : state.phase === "credentials" ? text.openTools
    : state.phase === "connector" ? text.openTools : state.phase === "ready" ? text.openChat
    : state.phase === "error" && !retryable ? text.reviewDetails
    : state.phase === "codex" ? text.reopened : state.phase === "idle" ? snapshot.state.coreSetupComplete ? text.check : text.start : text.continue;
  if (!expanded && state.phase === "idle") return null;
  return <section className={`automatic-setup guided-setup is-${state.phase}${expanded ? " is-expanded" : " is-compact"}`}
    aria-label={text.setup} aria-busy={pending}>
    <div className="guided-setup-topline"><span className="guided-wordmark"><Icon name="setup" /> MARIA CONNECT</span>
      <span className={`guided-status is-${state.phase}`}><i />{state.phase === "ready" ? text.done : state.active ? text.automaticStep : manual ? text.manual : text.automatic}</span></div>
    <div className="guided-setup-intro"><div><h1 role="status" aria-live="polite">{title}</h1><p>{body}</p></div>
      {expanded ? <div className={`guided-connection-symbol ${pending ? "is-busy" : ""}`} aria-hidden="true"><Icon name={state.phase === "ready" ? "check" : "globe"} /></div> : null}</div>
    {expanded ? <>
      {canChoose && ["idle", "paused"].includes(state.phase) ? <fieldset className="guided-targets" disabled={locked}>
        <legend>{text.target}</legend><div>
          <label className={!wantTools ? "is-selected" : ""}><input type="radio" name="setup-target" value="chat" checked={!wantTools} onChange={() => setWantTools(false)} />
            <span><strong>{text.basic}</strong><small>{text.basicBody}</small></span></label>
          <label className={wantTools ? "is-selected" : ""}><input type="radio" name="setup-target" value="tools" checked={wantTools} onChange={() => setWantTools(true)} />
            <span><strong>{text.full}</strong><small>{text.fullBody}</small></span></label>
        </div></fieldset> : null}
      {savedTools ? <p className="guided-preserved"><Icon name="check" />{text.saved}<span>{text.preserved}</span></p> : null}
      <div className="guided-progress-heading"><strong>{text.progress}</strong><span>{done}/{steps.length} {text.stepsComplete}</span></div>
      <ol className="guided-steps" aria-label={text.progress}>{steps.map((step, index) => <li key={step.id} className={step.current ? "is-current" : step.done ? "is-done" : ""} aria-current={step.current ? "step" : undefined}>
        <span className="guided-step-marker" aria-hidden="true">{step.done && !step.current ? <Icon name="check" /> : String(index + 1).padStart(2, "0")}</span>
        <span><strong>{stepNames[step.id]}</strong><small>{step.current ? text.current : step.done ? text.done : text.upcoming}</small></span>
      </li>)}</ol>
      {failure ? <details className="guided-error-details"><summary>{text.details}</summary><pre>{failure.detail}</pre></details> : null}
    </> : null}
    <div className="guided-setup-footer"><div className="automatic-setup-actions">
      <button className="button-primary" type="button" disabled={expanded && (pending || (snapshot.operation?.status === "running" && !state.active))} onClick={action}>
        {actionLabel}<Icon name={pending ? "reload" : "forward"} /></button>
      {state.active ? <button className="text-button" type="button" onClick={() => controller.current?.pause()}>{text.pause}</button>
        : state.phase === "ready" && expanded ? <>
          <button className="text-button" type="button" onClick={continueSetup}>{text.check}</button>
          {canChoose ? <button className="text-button" type="button" onClick={() => {
            clearError(); setWantTools(true); void controller.current?.start({ toolsRequested: true });
          }}>{text.optionalTools}</button> : null}
        </> : null}
    </div>{expanded ? <small className="guided-privacy"><Icon name="check" />{text.privacy}</small> : null}</div>
  </section>;
}

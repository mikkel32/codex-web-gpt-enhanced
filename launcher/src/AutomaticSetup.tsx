import { useEffect, useRef, useState } from "react";
import type { LauncherSnapshot, Surface } from "./types";
import { createAutomaticSetup, type AutomaticSetupState } from "./automatic-setup";
import { describeSetupError } from "./setup-errors";
import { Icon } from "./icons";
import "./automatic-setup.css";

const labels = {
  en: {
    title: "Automatic setup", check: "Check again", start: "Set up automatically", resume: "Continue setup", pause: "Pause setup", details: "Technical details",
    hint: "Maria handles installation and connection checks. Only sign-in, account permissions, and reopening Codex may need you.",
    phases: { idle: "Ready when you are", checking: "Checking your existing setup", busy: "Waiting for the current operation or task to finish", "sign-in": "Sign in to ChatGPT; setup continues afterwards", review: "Complete the browser verification before continuing", credentials: "Add your tool credentials once in Tools", installing: "Installing and checking the runtime", codex: "Finish active work, reopen Codex, and open its model picker", connector: "Check the ChatGPT connector in Tools, then continue", verifying: "Verifying the connection", ready: "Setup verified and ready", paused: "Paused; any running installation finishes safely", error: "Setup needs attention" },
  },
  "zh-CN": {
    title: "自动设置", check: "再次检查", start: "自动完成设置", resume: "继续设置", pause: "暂停设置", details: "技术详情",
    hint: "Maria 自动安装并检查连接。登录、账户权限以及重新打开 Codex 可能需要你操作。",
    phases: { idle: "准备就绪", checking: "正在检查已有设置", busy: "等待当前操作或任务完成", "sign-in": "请登录 ChatGPT，随后自动继续", review: "请先完成浏览器验证", credentials: "请在工具中添加一次凭据", installing: "正在安装并检查运行时", codex: "完成当前工作后重新打开 Codex 并打开模型选择器", connector: "请在工具中检查 ChatGPT 连接器后继续", verifying: "正在验证连接", ready: "设置已验证并就绪", paused: "已暂停，正在进行的安装将安全完成", error: "设置需要处理" },
  },
  ja: {
    title: "自動セットアップ", check: "再確認", start: "自動でセットアップ", resume: "セットアップを続ける", pause: "一時停止", details: "技術的な詳細",
    hint: "Maria がインストールと接続確認を行います。ログイン、アカウント権限、Codex の再起動のみ操作が必要な場合があります。",
    phases: { idle: "準備完了", checking: "既存の設定を確認中", busy: "現在の操作またはタスクの完了待ち", "sign-in": "ChatGPT にログインすると続行します", review: "ブラウザーの認証を完了してください", credentials: "ツールで認証情報を一度登録してください", installing: "ランタイムのインストールと確認中", codex: "作業完了後に Codex を開き直しモデル選択を開いてください", connector: "ツールで ChatGPT コネクターを確認して続行してください", verifying: "接続を検証中", ready: "セットアップの検証完了", paused: "一時停止中。進行中のインストールは安全に完了します", error: "セットアップの確認が必要です" },
  },
};

/** Stays mounted across navigation so signing in never loses the setup intent. */
export function AutomaticSetup({ snapshot, surface, navigate, clearError }: {
  snapshot: LauncherSnapshot; surface: Surface; navigate: (surface: Surface) => void; clearError: () => void;
}) {
  const [state, setState] = useState<AutomaticSetupState>({ phase: "idle", active: false });
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const controller = useRef<ReturnType<typeof createAutomaticSetup> | null>(null);
  const text = labels[snapshot.state.language ?? "en"];
  useEffect(() => {
    const api = window.codexWebLauncher;
    if (!api) return;
    const setup = createAutomaticSetup({ api, publish: setState, navigate: next => navigateRef.current(next) });
    controller.current = setup;
    const changed = () => {
      if (setup.getState().active) void setup.resume();
    };
    const subscriptions = [api.onStateChanged(changed), api.onBrowserState(changed), api.onOperation(changed)];
    return () => { subscriptions.forEach(unsubscribe => unsubscribe()); setup.dispose(); controller.current = null; };
  }, []);
  const visible = state.phase !== "idle" || surface === "home" || surface === "setup";
  if (!visible) return null;
  const pending = ["checking", "installing", "verifying"].includes(state.phase);
  const failure = state.error ? describeSetupError(state.error, snapshot.state.language) : null;
  return <section className={`automatic-setup is-${state.phase}`} aria-label={text.title}>
    <Icon name={state.phase === "ready" ? "check" : "setup"} />
    <div className="automatic-setup-copy">
      <strong>{text.title}</strong>
      <p role="status" aria-live="polite">{text.phases[state.phase]}</p>
      {state.phase === "idle" ? <small>{text.hint}</small> : null}
      {failure ? <div role="alert"><p><strong>{failure.title}</strong> — {failure.message}</p><details><summary>{text.details}</summary><pre>{failure.detail}</pre></details></div> : null}
    </div>
    <div className="automatic-setup-actions">
      <button className="button-primary" disabled={pending || snapshot.operation?.status === "running"}
        onClick={() => { clearError(); void controller.current?.continue(); }}>{state.phase === "ready" ? text.check : state.phase === "idle" ? text.start : text.resume}</button>
      {state.active ? <button className="text-button" onClick={() => controller.current?.pause()}>{text.pause}</button> : null}
    </div>
  </section>;
}

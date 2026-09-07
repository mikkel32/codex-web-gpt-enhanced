import type { Language } from "./types";

export function setupErrorDetail(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value);
  return message.replace(/^Error invoking remote method ['"][^'"\n]+['"]:\s*(?:Error:\s*)?/, "")
    .replace(/\bsk-[A-Za-z0-9_-]+/g, "[redacted key]")
    .replace(/\bBearer\s+[A-Za-z0-9_.-]+/gi, "Bearer [redacted]")
    .slice(0, 4_000);
}

export function describeSetupError(value: unknown, language: Language | null = "en") {
  const detail = setupErrorDetail(value);
  const kind = /stopping the incomplete runtime failed|checkpoint restoration failed|rollback failed/i.test(detail) ? "recovery"
    : /CDP endpoint|CDP metadata|local browser transport|connect Playwright/i.test(detail) ? "browser"
    : /Config requires|previous settings were restored|runtime.*version|upgrad/i.test(detail) ? "version"
    : /sign in|signed.out|authenticated|verification required/i.test(detail) ? "signIn"
    : /runtime key|Tunnel ID|unauthorized|authorization|HTTP (401|403)/i.test(detail) ? "credentials"
    : "other";
  const copy = {
    en: {
      recovery: ["Setup needs a recovery check", "Open Activity and export the privacy-safe log. A process could not stop or a checkpoint could not be restored; do not edit the configuration manually."],
      browser: ["The local browser connection is not ready", "Keep Maria open and retry setup. If this continues, restart Maria. Your ChatGPT password does not need to be re-entered unless sign-in is requested."],
      version: ["The saved setup needs an upgrade", "Run automatic setup with this launcher to align the runtime and configuration. Do not change version numbers in config.json by hand."],
      signIn: ["ChatGPT needs your attention", "Open ChatGPT in Maria and complete sign-in or the verification request. Setup can continue afterwards."],
      credentials: ["Check the tool connection", "Open Tools and check the correct workspace, tunnel, and restricted runtime key. Saved credentials are reused when valid."],
      other: ["Setup could not finish", "Review the details or open Activity for the privacy-safe diagnostic log before retrying."],
    },
    "zh-CN": {
      recovery: ["设置需要恢复检查", "打开活动并导出隐私安全日志。进程无法停止或检查点无法恢复，请勿手动编辑配置。"],
      browser: ["本地浏览器连接尚未就绪", "保持 Maria 运行并重试设置。如问题持续，请重启 Maria。仅在系统要求时重新登录。"],
      version: ["已保存的设置需要升级", "使用此启动器运行自动设置以匹配运行时与配置。请勿手动修改 config.json 中的版本号。"],
      signIn: ["ChatGPT 需要你处理", "在 Maria 中打开 ChatGPT 并完成登录或验证，然后继续设置。"],
      credentials: ["检查工具连接", "打开工具并检查工作区、隧道和受限运行时密钥。有效的已保存凭据会被重复使用。"],
      other: ["设置未能完成", "重试前请查看详情或在活动中导出隐私安全诊断日志。"],
    },
    ja: {
      recovery: ["セットアップの復旧確認が必要です", "アクティビティからプライバシー保護済みログを出力してください。プロセス停止または設定復元に失敗したため、設定を手動編集しないでください。"],
      browser: ["ローカルブラウザー接続の準備ができていません", "Maria を開いたまま再試行してください。続く場合は Maria を再起動し、要求された場合のみ再度ログインしてください。"],
      version: ["保存済み設定の更新が必要です", "このランチャーで自動セットアップを実行してください。config.json のバージョン番号を手動変更しないでください。"],
      signIn: ["ChatGPT で確認が必要です", "Maria で ChatGPT を開き、ログインまたは認証を完了してからセットアップを続けてください。"],
      credentials: ["ツール接続を確認してください", "ツールでワークスペース、トンネル、制限付きランタイムキーを確認してください。有効な保存済み認証情報は再利用されます。"],
      other: ["セットアップを完了できませんでした", "再試行の前に詳細を確認するか、アクティビティからプライバシー保護済みログを出力してください。"],
    },
  }[language ?? "en"][kind];
  return { kind, title: copy[0], message: copy[1], detail };
}

import type { Language } from "./types";

export function setupErrorDetail(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value);
  return message.replace(/^Error invoking remote method ['"][^'"\n]+['"]:\s*(?:Error:\s*)?/, "")
    .replace(/\bsk-[A-Za-z0-9_-]+/g, "[redacted key]")
    .replace(/\bBearer\s+[A-Za-z0-9_.~+\/=-]+/gi, "Bearer [redacted]")
    .slice(0, 4_000);
}

export function describeSetupError(value: unknown, language: Language | null = "en") {
  const detail = setupErrorDetail(value);
  const kind = /stopping the incomplete runtime failed|checkpoint restoration failed|rollback failed/i.test(detail) ? "recovery"
    : /Unknown root|outside (?:the )?(?:approved|allowed)|not (?:an )?approved (?:path|root)|workspace.*(?:mismatch|not found)/i.test(detail) ? "workspace"
    : /Tool\s+[^\n]+?\s+not found|unknown tool|Codex tool is not available in this turn|tool.*contract.*mismatch/i.test(detail) ? "toolContract"
    : /CDP endpoint|CDP metadata|local browser transport|connect Playwright/i.test(detail) ? "browser"
    : /Config requires|previous settings were restored|runtime.*version|upgrad/i.test(detail) ? "version"
    : /sign in|signed.out|authenticated|verification required/i.test(detail) ? "signIn"
    : /runtime key|Tunnel ID|unauthorized|authorization|HTTP (401|403)/i.test(detail) ? "credentials"
    : "other";
  const copy = {
    en: {
      workspace: ["This is not the connected workspace", "A Mac path cannot be used by a connector on another computer. Open the intended project in Codex on that computer, use its attached connector, and discover the current task’s approved roots. Do not rewrite /Users to /codex or broaden folder access to hide the error."],
      toolContract: ["The connector’s tools do not match", "The installed connector may advertise an old tool list or point to a different server. Open Tools and check its name and tunnel. Use the current Codex tool inventory, not cached read or exec_command aliases. Reconnect the correct plugin in ChatGPT and use a new conversation; this does not require changing folder permissions."],
      recovery: ["Setup needs a recovery check", "Open Activity and export the privacy-safe log. A process could not stop or a checkpoint could not be restored; do not edit the configuration manually."],
      browser: ["The local browser connection is not ready", "Keep Maria open and retry setup. If this continues, restart Maria. Your ChatGPT password does not need to be re-entered unless sign-in is requested."],
      version: ["The saved setup needs an upgrade", "Run automatic setup with this launcher to align the runtime and configuration. Do not change version numbers in config.json by hand."],
      signIn: ["ChatGPT needs your attention", "Open ChatGPT in Maria and complete sign-in or the verification request. Setup can continue afterwards."],
      credentials: ["Check the tool connection", "Open Tools and check the correct workspace, tunnel, and restricted runtime key. Saved credentials are reused when valid."],
      other: ["Setup could not finish", "Review the details or open Activity for the privacy-safe diagnostic log before retrying."],
    },
    "zh-CN": {
      workspace: ["当前连接的工作区不匹配", "另一台电脑的连接器无法访问 Mac 路径。请在目标电脑的 Codex 中打开项目，使用该电脑的连接器并查看当前任务允许的根目录。不要把 /Users 改为 /codex，也不要为隐藏错误而扩大目录权限。"],
      toolContract: ["连接器工具不匹配", "连接器可能提供旧工具列表或指向另一台服务器。请在工具页面检查名称和隧道，使用当前 Codex 工具清单，而非缓存的 read 或 exec_command 别名。在 ChatGPT 中重新连接正确插件并新建对话；无需更改文件夹权限。"],
      recovery: ["设置需要恢复检查", "打开活动并导出隐私安全日志。进程无法停止或检查点无法恢复，请勿手动编辑配置。"],
      browser: ["本地浏览器连接尚未就绪", "保持 Maria 运行并重试设置。如问题持续，请重启 Maria。仅在系统要求时重新登录。"],
      version: ["已保存的设置需要升级", "使用此启动器运行自动设置以匹配运行时与配置。请勿手动修改 config.json 中的版本号。"],
      signIn: ["ChatGPT 需要你处理", "在 Maria 中打开 ChatGPT 并完成登录或验证，然后继续设置。"],
      credentials: ["检查工具连接", "打开工具并检查工作区、隧道和受限运行时密钥。有效的已保存凭据会被重复使用。"],
      other: ["设置未能完成", "重试前请查看详情或在活动中导出隐私安全诊断日志。"],
    },
    ja: {
      workspace: ["接続先のワークスペースが違います", "別のコンピューターのコネクターでは Mac のパスを開けません。対象のコンピューターの Codex でプロジェクトを開き、そのコネクターで現在のタスクの許可ルートを確認してください。/Users を /codex に書き換えたり、権限を広げたりしないでください。"],
      toolContract: ["コネクターのツールが一致しません", "古いツール一覧または別のサーバーに接続している可能性があります。ツール画面で名前とトンネルを確認し、read や exec_command の別名ではなく現在の Codex ツール一覧を使ってください。ChatGPT で正しいプラグインを再接続し、新しい会話を開いてください。フォルダー権限の変更は不要です。"],
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

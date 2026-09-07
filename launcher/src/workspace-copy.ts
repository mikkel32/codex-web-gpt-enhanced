import type { Language } from "./types";

const en = {
  setup: "Let Maria handle the setup", subtitle: "One guided flow. Your existing settings stay with you.",
  account: "Account", runtime: "Installation", models: "Codex models", tools: "Tool connection",
  milestones: "Saved setup progress", openStep: "Open this step", completed: "Completed", pending: "Not yet complete",
  consent: "Starts only when you choose. Sign-in and account approvals remain yours.",
  ready: "Local setup verified", readyBody: "Local checks passed. Project access is still scoped to the active Codex task.",
  saved: "Settings saved", savedBody: "Saved settings are not a live connection check. Use the guided check above to verify this installation.",
  diagnostics: "Connection check", diagnosticsBody: "See what is connected, and what needs your attention.",
  check: "Run local checks", checking: "Checking this installation…", checked: "Local checks passed", failed: "A connection check needs attention",
  computer: "This launcher computer", connector: "Expected connector", configuration: "Codex configuration folder",
  scope: "Project folders come from the active Codex task, not this configuration folder. A connector on another computer cannot use this computer’s paths.",
  boundary: "These checks do not call a project tool or prove that ChatGPT attached the correct server. The live task’s tool inventory is the final authority.",
  explain: "Explain a connector error", placeholder: 'For example: Tool read not found or Unknown root "/Users"',
  private: "This text stays in this view. It is not sent to the server or saved.",
  details: "Technical details", toolsAction: "Open tool connection", activity: "Open Activity", local: "Local installation", optional: "Optional · browser-only", configured: "Configured · task-scoped",
  noCheck: "Not checked in this view", status: "Connection status", manual: "Manual workflow", automatic: "Automatic workflow",
};
const zh: typeof en = {
  setup: "让 Maria 完成设置", subtitle: "一个引导流程，保留已有设置。", account: "账户", runtime: "安装", models: "Codex 模型", tools: "工具连接",
  milestones: "已保存的设置进度", openStep: "打开此步骤", completed: "已完成", pending: "尚未完成", consent: "仅在你选择后开始。登录和账户授权仍由你操作。",
  ready: "本地设置已验证", readyBody: "本地检查已通过。项目访问仍受当前 Codex 任务范围限制。", saved: "设置已保存", savedBody: "已保存的设置不代表实时连接状态。请使用上方引导检查来验证此安装。",
  diagnostics: "连接检查", diagnosticsBody: "查看连接状态及需要处理的事项。", check: "运行本地检查", checking: "正在检查此安装…", checked: "本地检查已通过", failed: "连接检查需要处理",
  computer: "此启动器所在电脑", connector: "预期连接器", configuration: "Codex 配置文件夹", scope: "项目文件夹由当前 Codex 任务提供，而非此配置文件夹。另一台电脑的连接器无法使用此电脑的路径。",
  boundary: "这些检查不会调用项目工具，也无法证明 ChatGPT 已连接正确服务器。请以当前任务的工具清单为准。",
  explain: "解释连接器错误", placeholder: '例如：Tool read not found 或 Unknown root "/Users"', private: "文本仅保留在当前视图，不会发送到服务器或保存。",
  details: "技术详情", toolsAction: "打开工具连接", activity: "打开活动", local: "本地安装", optional: "可选 · 仅浏览器", configured: "已配置 · 受任务限制",
  noCheck: "尚未在此视图检查", status: "连接状态", manual: "手动工作流程", automatic: "自动工作流程",
};
const ja: typeof en = {
  setup: "セットアップは Maria に", subtitle: "一つのガイドで、既存の設定を保ったまま接続。", account: "アカウント", runtime: "インストール", models: "Codex モデル", tools: "ツール接続",
  milestones: "保存済みセットアップの進捗", openStep: "この手順を開く", completed: "完了", pending: "未完了", consent: "選択したときだけ開始します。ログインとアカウント承認はご自身で行います。",
  ready: "ローカル設定を検証済み", readyBody: "ローカル確認が完了しました。プロジェクトへのアクセスは現在の Codex タスクの範囲に限られます。", saved: "設定は保存済み", savedBody: "保存済み設定は現在の接続状態ではありません。上のガイドでこのインストールを確認してください。",
  diagnostics: "接続を確認", diagnosticsBody: "接続先と、対応が必要な項目を確認できます。", check: "ローカル確認を実行", checking: "このインストールを確認中…", checked: "ローカル確認が完了", failed: "接続の確認が必要です",
  computer: "このランチャーのコンピューター", connector: "想定するコネクター", configuration: "Codex 設定フォルダー", scope: "プロジェクトのフォルダーは現在の Codex タスクが提供します。この設定フォルダーとは別です。別のコンピューターのコネクターはこのパスを使えません。",
  boundary: "この確認はプロジェクトツールを呼ばず、ChatGPT の接続先サーバーも保証しません。現在のタスクのツール一覧が最終的な根拠です。",
  explain: "コネクターのエラーを確認", placeholder: '例：Tool read not found または Unknown root "/Users"', private: "このテキストは画面内だけで使用し、サーバーへ送信・保存しません。",
  details: "技術的な詳細", toolsAction: "ツール接続を開く", activity: "アクティビティを開く", local: "ローカルインストール", optional: "任意 · ブラウザーのみ", configured: "設定済み · タスク範囲内",
  noCheck: "この画面では未確認", status: "接続状態", manual: "手動ワークフロー", automatic: "自動ワークフロー",
};
export const workspaceCopy = (language: Language | null) => language === "zh-CN" ? zh : language === "ja" ? ja : en;

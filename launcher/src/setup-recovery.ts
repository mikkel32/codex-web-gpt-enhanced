export type SetupRecoveryKind = "browser" | "version";
export function setupRecoveryKind(message: string): SetupRecoveryKind | null {
  if (/stopping the incomplete runtime failed|checkpoint restoration failed|rollback failed/i.test(message)) return null;
  const primary = message.split(/;\s*(?:restoring the previous|Previous settings|first-time setup)/i)[0] ?? message;
  if (/sign in|logged out|unauthorized|forbidden|HTTP (?:3\d\d|4\d\d)|access (denied|paused)|CDP metadata|unsafe permissions|unexpected.*(?:partition|surface)|different launcher browser host/i.test(primary)) return null;
  if (/Launcher browser CDP endpoint|Could not connect Playwright to the launcher browser|Launcher browser host process is not running/i.test(primary)) return "browser";
  const versions = /Config requires (\d+)\.(\d+)\.(\d+); launcher is (\d+)\.(\d+)\.(\d+)(?:\s|;|$)/.exec(primary);
  if (!versions) return null;
  for (let index = 1; index <= 3; index++) {
    const configured = Number(versions[index]);
    const installed = Number(versions[index + 3]);
    if (configured !== installed) return configured < installed ? "version" : null;
  }
  return null;
}
const translations = {
  en: {
    browser: { title: "The browser connection needs another try", body: "Keep Maria open and retry setup. The launcher will recheck the connection and reuse any saved settings." },
    version: { title: "Complete the runtime upgrade", body: "The launcher is newer than the saved runtime. Retry setup to update the runtime using your existing settings." },
    retry: "Retry setup", details: "Technical details",
  },
  "zh-CN": {
    browser: { title: "请重试浏览器连接", body: "保持 Maria 打开并重试设置。启动器会重新检查连接，并复用已保存的设置。" },
    version: { title: "完成运行时升级", body: "启动器比已保存的运行时更新。重试设置以使用现有设置更新运行时。" },
    retry: "重试设置", details: "技术详情",
  },
  ja: {
    browser: { title: "ブラウザー接続を再試行してください", body: "Maria を開いたまま設定を再試行してください。接続を確認し、保存済みの設定を再利用します。" },
    version: { title: "ランタイムの更新を完了する", body: "ランチャーが保存済みのランタイムより新しくなっています。設定を再試行して、既存の設定で更新してください。" },
    retry: "設定を再試行", details: "技術的な詳細",
  },
};
export function setupRecoveryCopy(kind: SetupRecoveryKind, language: string) {
  const copy = translations[language === "ja" || language === "zh-CN" ? language : "en"];
  return { ...copy[kind], retry: copy.retry, details: copy.details };
}

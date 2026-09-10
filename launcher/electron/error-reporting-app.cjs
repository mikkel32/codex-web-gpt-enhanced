const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { randomUUID } = require("node:crypto");
const { ErrorReportStore, emailAddress } = require("./error-report-store.cjs");
const { GmailReportSender, ReportDeliveryQueue } = require("./error-report-delivery.cjs");
const { ReportLogObserver } = require("./error-report-log-observer.cjs");
const { formatIncidentEmail } = require("./error-report-email.cjs");

const CHANNEL = "maria:error-reporting:settings";
let current;
const installations = new WeakMap();

function installErrorReporting({ app, launcherWindow, coreHome, getBrowserHost = () => null, electron = require("electron"), senderFactory, now = Date.now }) {
  if (installations.has(launcherWindow)) return installations.get(launcherWindow);
  const store = new ErrorReportStore(coreHome, { now });
  const sender = senderFactory ? senderFactory() : new GmailReportSender(coreHome, electron.safeStorage);
  const queue = new ReportDeliveryQueue(store, sender, { now });
  const connectedQueue = new ReportDeliveryQueue(store, { deliveryMethod: "gmail", configured: () => true }, { now });
  const url = pathToFileURL(path.join(__dirname, "error-report-settings.html")).href;
  let settingsWindow;
  let lastFailure = "";
  let stopped = false;
  const safe = action => {
    try { return action(); } catch { lastFailure = "Reporting could not access its local configuration or queue. Your task is unaffected."; }
  };
  const capture = incident => safe(() => store.capture({ ...incident, appVersion: app.getVersion() }));
  safe(() => queue.recover());
  const log = new ReportLogObserver(path.join(app.getPath("logs"), "launcher.jsonl"), capture);
  const snapshot = () => {
    const settings = store.settings();
    let account = "";
    if (sender.configured()) { try { account = sender.account(); } catch { lastFailure = "Email credentials need to be saved again using the operating-system secure store."; } }
    const records = store.records();
    const connected = settings.deliveryMethod === "gmail";
    const selectedQueue = connected ? connectedQueue : queue;
    const paused = selectedQueue.paused(records, settings);
    const deliveryReady = settings.enabled && (connected || Boolean(account)) && !paused;
    return { ...settings, sender: account || settings.recipient, senderConfigured: Boolean(account), deliveryReady, lastFailure,
      deliveryStatus: !settings.enabled ? "Reporting is disabled."
        : connected ? paused ? "Connected Gmail delivery is paused. Reconnect Gmail, then choose Resume Gmail delivery."
          : "Connected Gmail selected. Active Codex tasks send reports from your connected Gmail account to that same address. No app password is needed. Reports recorded while no task is active wait for the next task."
        : !account ? "Action required: no Gmail sender is ready. Reports are saved locally and cannot be emailed. Enter the Gmail sender and Google app password, then save. ChatGPT's Gmail connection does not configure this sender."
          : paused ? "Email delivery is paused after a sender error. Save corrected Gmail sender credentials to resume."
          : "Automatic email delivery is enabled. Inspect each report for its delivery status.",
      reports: records.sort((a, b) => b.createdAt - a.createdAt).map(report => ({ id: report.id, createdAt: report.createdAt,
        source: report.source, ...selectedQueue.reportStatus(report, settings, paused),
        currentConsent: report.consentId === settings.consentId && report.recipient === settings.recipient,
        code: report.code, observations: report.observations || 1 })) };
  };
  const open = () => {
    if (stopped || launcherWindow.isDestroyed()) return;
    if (settingsWindow && !settingsWindow.isDestroyed()) { settingsWindow.show(); settingsWindow.focus(); return; }
    settingsWindow = new electron.BrowserWindow({ parent: launcherWindow, width: 760, height: 800, minWidth: 560, minHeight: 620,
      title: "Automatic error reports", backgroundColor: "#121815", show: false,
      webPreferences: { preload: path.join(__dirname, "error-report-preload.cjs"), sandbox: true, contextIsolation: true, nodeIntegration: false } });
    settingsWindow.setMenuBarVisibility(false);
    settingsWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    settingsWindow.webContents.on("will-navigate", event => event.preventDefault());
    settingsWindow.webContents.on("will-redirect", event => event.preventDefault());
    settingsWindow.once("ready-to-show", () => settingsWindow?.show());
    settingsWindow.once("closed", () => { settingsWindow = undefined; });
    void settingsWindow.loadURL(url).catch(() => { lastFailure = "Error-report settings could not open"; });
  };
  const handler = async (event, request) => {
    // The email credential path is available only to this dedicated local settings document.
    if (!settingsWindow || event.sender !== settingsWindow.webContents || event.senderFrame !== settingsWindow.webContents.mainFrame
      || event.sender.getURL() !== url) throw new Error("Email settings require the local settings window");
    if (!request || typeof request !== "object") throw new Error("Invalid settings request");
    if (request.action === "status") return snapshot();
    if (request.action === "save") {
      const value = request.value;
      if (!value || typeof value.enabled !== "boolean" || typeof value.includeResponses !== "boolean"
        || typeof value.recipient !== "string" || typeof value.sender !== "string") throw new Error("Invalid report settings");
      if (value.recipient || value.enabled) emailAddress(value.recipient.trim());
      if (value.deliveryMethod !== "gmail" && value.password) sender.save(value.sender.trim(), value.password);
      else if (value.deliveryMethod !== "gmail" && value.sender && sender.configured() && value.sender.trim() !== sender.account()) throw new Error("A new sender requires its Google app password");
      // Capture consent and sender authentication are separate. Preserve diagnostic
      // evidence while sender setup is pending, but never describe it as sent.
      const previous = store.settings();
      store.configure({ enabled: value.enabled, includeResponses: value.includeResponses, recipient: value.recipient, deliveryMethod: value.deliveryMethod });
      // A credential correction is explicit permission to retry a known rejected email.
      if (value.password && value.deliveryMethod !== "gmail") {
        queue.senderUpdated();
        for (const report of store.records()) if (report.delivery.state === "blocked" && report.consentId === previous.consentId) {
          store.update(report, { state: "pending", attempts: 0, nextAttemptAt: now(), reason: "Sender credentials updated" });
        }
      }
      lastFailure = "";
      void queue.drain().catch(() => { lastFailure = "Email queue needs attention; local reports were retained."; });
      return snapshot();
    }
    if (request.action === "forget") {
      const settings = store.settings();
      store.configure({ ...settings, enabled: false }); sender.forget(); return snapshot();
    }
    if (request.action === "resume-gmail") {
      const settings = store.settings();
      if (settings.deliveryMethod !== "gmail" || !settings.enabled) throw new Error("Select and enable connected Gmail first");
      connectedQueue.senderUpdated();
      for (const report of store.records()) if (report.delivery.state === "blocked" && report.consentId === settings.consentId) {
        store.update(report, { state: "pending", nextAttemptAt: now(), reason: "Connected Gmail delivery resumed" });
      }
      return snapshot();
    }
    if (request.action === "preview") return store.read(request.id);
    if (request.action === "preview-email") {
      const message = formatIncidentEmail(store.read(request.id));
      return { subject: message.subject, text: message.text };
    }
    if (request.action === "delete") { const report = store.read(request.id); if (report.delivery.state === "sending") throw new Error("Wait for the current email operation to settle"); store.remove(request.id); return snapshot(); }
    if (request.action === "test") {
      const settings = store.settings();
      if (!settings.enabled || (settings.deliveryMethod !== "gmail" && !sender.configured())) throw new Error("Save and enable report delivery first");
      if ((settings.deliveryMethod === "gmail" ? connectedQueue : queue).paused()) throw new Error("Resume the selected sender before queueing a test email");
      capture({ source: "launcher", traceId: `email-test-${randomUUID()}`, code: "email_test", error: "Test email requested in Maria settings. No conversation content is attached." });
      return snapshot();
    }
    throw new Error("Unknown report settings action");
  };
  electron.ipcMain.handle(CHANNEL, handler);
  const crashed = (_event, contents, details) => {
    const host = getBrowserHost();
    const tab = [...(host?.turnTabs?.values() || [])].find(tab => tab.view?.webContents === contents);
    if (contents !== launcherWindow.webContents && contents !== host?.view?.webContents && !tab) return;
    if (details.reason === "clean-exit") return;
    capture({ source: contents === launcherWindow.webContents ? "launcher" : "browser", traceId: tab?.traceId,
      code: "renderer_process_gone", error: `Renderer stopped: ${details.reason}; exit code ${details.exitCode}`,
      notes: "A crashed renderer cannot provide a fresh page response. The runtime may separately contribute its observed text." });
  };
  const fatal = error => capture({ source: "launcher", code: "uncaught_exception", error: error instanceof Error ? error.message : String(error) });
  app.on("render-process-gone", crashed);
  process.on("uncaughtExceptionMonitor", fatal);
  const timer = setInterval(() => {
    safe(() => log.poll(store.settings().enabled));
    void queue.drain().catch(() => { lastFailure = "Email delivery is unavailable; inspect the local report queue."; });
  }, 15_000);
  timer.unref?.();
  void queue.drain().catch(() => { lastFailure = "Email queue needs attention; local reports were retained."; });
  const dispose = () => {
    if (stopped) return; stopped = true; clearInterval(timer);
    app.off("render-process-gone", crashed); app.off("will-quit", dispose);
    launcherWindow.off("closed", dispose);
    process.off("uncaughtExceptionMonitor", fatal); electron.ipcMain.removeHandler(CHANNEL);
    if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close();
    if (current === api) current = undefined;
    installations.delete(launcherWindow);
  };
  app.once("will-quit", dispose);
  launcherWindow.once("closed", dispose);
  const api = { open, snapshot, capture, dispose, handler, flush: () => queue.drain() };
  current = api; installations.set(launcherWindow, api);
  return api;
}

function openErrorReportSettings() { current?.open(); }
function errorReportSettingsAvailable() { return Boolean(current); }
module.exports = { installErrorReporting, openErrorReportSettings, errorReportSettingsAvailable };

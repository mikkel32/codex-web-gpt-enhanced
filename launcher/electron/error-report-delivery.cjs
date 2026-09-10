const fs = require("node:fs");
const path = require("node:path");
const { ErrorReportStore, emailAddress, atomicJson, privateDirectory, readPrivateJson } = require("./error-report-store.cjs");
const { formatIncidentEmail } = require("./error-report-email.cjs");
const lockfile = require("proper-lockfile");

function secureStorage(storage) {
  if (!storage?.isEncryptionAvailable() || storage.getSelectedStorageBackend?.() === "basic_text") {
    throw new Error("A secure operating-system credential store is required for automatic email");
  }
}

class GmailReportSender {
  constructor(coreHome, storage, createTransport = options => require("nodemailer").createTransport(options)) {
    this.file = path.join(coreHome, "error-reports", "sender.json");
    this.storage = storage;
    this.createTransport = createTransport;
  }
  configured() { return fs.existsSync(this.file); }
  save(account, appPassword) {
    emailAddress(account);
    const password = typeof appPassword === "string" ? appPassword.replace(/\s/g, "") : "";
    if (!/^[a-zA-Z0-9]{16}$/.test(password)) throw new Error("Enter a 16-character Google app password, not your account password");
    secureStorage(this.storage);
    const encrypted = this.storage.encryptString(JSON.stringify({ account, password })).toString("base64");
    privateDirectory(path.dirname(this.file));
    atomicJson(this.file, { version: 1, encrypted });
  }
  account() { return this.credentials().account; }
  credentials() {
    secureStorage(this.storage);
    const value = readPrivateJson(this.file, 16 * 1024);
    if (value.version !== 1 || typeof value.encrypted !== "string") throw new Error("Invalid email credentials");
    const credentials = JSON.parse(this.storage.decryptString(Buffer.from(value.encrypted, "base64")));
    emailAddress(credentials.account);
    if (typeof credentials.password !== "string" || !/^[A-Za-z0-9]{16}$/.test(credentials.password)) throw new Error("Invalid email credentials");
    return credentials;
  }
  forget() { if (this.configured()) fs.unlinkSync(this.file); }
  async send(report) {
    let credentials;
    try { credentials = this.credentials(); }
    catch { throw Object.assign(new Error("Email sender credentials are unavailable"), { code: "EREPORTCONFIG" }); }
    const { account, password } = credentials;
    const recipient = emailAddress(report.recipient);
    const transport = this.createTransport({ host: "smtp.gmail.com", port: 465, secure: true,
      auth: { user: account, pass: password }, tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000, dnsTimeout: 5_000,
      logger: false, debug: false, pool: false, disableFileAccess: true, disableUrlAccess: true });
    let timer;
    try {
      const result = await Promise.race([
        transport.sendMail({ from: { name: "Maria WebGPT", address: account }, to: recipient,
          envelope: { from: account, to: [recipient] }, messageId: `<${report.id}@maria-webgpt.local>`,
          ...formatIncidentEmail(report),
          disableFileAccess: true, disableUrlAccess: true }),
        new Promise((_, reject) => { timer = setTimeout(() => { try { transport.close(); } catch {} reject(Object.assign(new Error("Email delivery acknowledgement timed out"), { code: "EDELIVERYUNKNOWN" })); }, 30_000); }),
      ]);
      if (!result.accepted?.some(address => String(address).toLowerCase() === recipient.toLowerCase())) {
        throw Object.assign(new Error("Email server did not acknowledge the recipient"), { code: "EDELIVERYUNKNOWN" });
      }
      return { accepted: true };
    } finally { clearTimeout(timer); try { transport.close(); } catch {} }
  }
}

function failureDisposition(error) {
  if (["EAUTH", "EREPORTCONFIG"].includes(error?.code) || [530, 534, 535].includes(error?.responseCode)) return "blocked";
  if (Number.isInteger(error?.responseCode) && error.responseCode >= 500) return "failed";
  if (Number.isInteger(error?.responseCode) && error.responseCode >= 400) return "retry";
  // Once message data may have reached Gmail, a generic connection error is
  // ambiguous too. Only an explicit SMTP rejection above permits a retry.
  if (error?.command === "DATA" || error?.code === "EDELIVERYUNKNOWN") return "uncertain";
  if (["EDNS", "ECONNECTION", "ECONNREFUSED"].includes(error?.code)) return "retry";
  if (["CONN", "EHLO", "HELO", "AUTH", "MAIL FROM", "RCPT TO"].includes(error?.command)) return "retry";
  // A broken connection after DATA may mean Gmail accepted the message. Never send it again automatically.
  return "uncertain";
}

class ReportDeliveryQueue {
  constructor(store, sender, { now = Date.now, onChange = () => {} } = {}) {
    this.store = store; this.sender = sender; this.now = now; this.onChange = onChange; this.inFlight = null;
    this.method = sender.deliveryMethod || "smtp";
    this.pauseFile = path.join(store.directory, this.method === "gmail" ? "gmail-paused.json" : "sender-paused.json");
  }
  senderUpdated() {
    try { fs.unlinkSync(this.pauseFile); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  paused(records = this.store.records(), settings = this.store.settings()) {
    return fs.existsSync(this.pauseFile) || records.some(report =>
      report.consentId === settings.consentId && report.delivery.state === "blocked");
  }
  reportStatus(report, settings = this.store.settings(), paused = this.paused(undefined, settings)) {
    if (!["pending", "needs_sender"].includes(report.delivery.state)) return report.delivery;
    if (report.consentId !== settings.consentId || report.recipient !== settings.recipient) {
      return { ...report.delivery, state: "held", reason: "Held under earlier reporting settings; no delivery is scheduled" };
    }
    if (!settings.enabled) return { ...report.delivery, state: "held", reason: "Reporting is disabled" };
    if (this.method === "gmail") return { ...report.delivery, state: paused ? "blocked" : "pending", reason: paused
      ? "Reconnect Gmail and resume delivery in Automatic error reports"
      : "Waiting for an active Codex task to deliver through connected Gmail" };
    if (!this.sender.configured()) return { ...report.delivery, state: "needs_sender",
      reason: "Not sent: set up the Gmail sender and Google app password in Automatic error reports" };
    if (paused) return { ...report.delivery, state: "blocked", reason: "Delivery is paused; update the Gmail sender credentials" };
    return { ...report.delivery, state: "pending", reason: report.delivery.nextAttemptAt > this.now()
      ? "Waiting for the scheduled delivery attempt" : "Ready for the next delivery attempt" };
  }
  recover() {
    if (fs.existsSync(this.store.directory) && lockfile.checkSync(this.store.directory, { realpath: false, stale: 120_000 })) return;
    for (const report of this.store.records()) if (report.delivery.state === "sending") {
      this.store.update(report, { state: "uncertain", reason: "App restarted before email acknowledgement was recorded" });
    }
  }
  drain(options = {}) {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.runLocked(options).finally(() => { this.inFlight = null; try { this.onChange(); } catch {} });
    return this.inFlight;
  }
  async runLocked(options) {
    const settings = this.store.settings();
    if (!settings.enabled || settings.deliveryMethod !== this.method) return;
    privateDirectory(this.store.directory);
    let release, lost = false;
    try { release = await lockfile.lock(this.store.directory, { realpath: false, retries: 0, stale: 120_000, update: 30_000,
      onCompromised: () => { lost = true; } }); }
    catch (error) { if (error.code === "ELOCKED") return; throw error; }
    try {
      // Acquiring an abandoned lock never permits replaying its uncertain send.
      for (const report of this.store.records()) if (report.delivery.state === "sending") {
        this.store.update(report, { state: "uncertain", reason: "The previous delivery owner stopped before acknowledgement was recorded" });
      }
      await this.run(options, () => { if (lost) throw Object.assign(new Error("Delivery lock was lost"), { code: "EDELIVERYUNKNOWN" }); });
    } finally { await release().catch(error => { if (error.code !== "ERELEASED") throw error; }); }
  }
  async run({ immediate = false } = {}, assertOwned = () => {}) {
    this.store.prune();
    const settings = this.store.settings();
    let records = this.store.records();
    if (!settings.enabled || settings.deliveryMethod !== this.method) return;
    if (!this.sender.configured()) {
      for (const report of records) if (report.delivery.state === "pending"
        && report.consentId === settings.consentId && report.recipient === settings.recipient) {
        this.store.update(report, { state: "needs_sender", reason: "Gmail sender setup is required; no email was attempted" });
      }
      return;
    }
    records = records.map(report => report.delivery.state === "needs_sender" && report.consentId === settings.consentId
      && report.recipient === settings.recipient
      ? this.store.update(report, { state: "pending", reason: "Sender configured; waiting for delivery" }) : report);
    // An authentication failure pauses the installation until explicit configuration succeeds.
    if (this.paused(records, settings)) return;
    const budgetFile = path.join(this.store.directory, "delivery-budget.json");
    let attempts = [];
    try {
      const saved = readPrivateJson(budgetFile, 4096);
      if (!Array.isArray(saved.attempts) || saved.attempts.length > 20 || saved.attempts.some(value => !Number.isFinite(value))) throw new Error("Invalid email delivery budget");
      attempts = saved.attempts.filter(at => this.now() - at < 86_400_000);
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    const hourly = attempts.filter(at => this.now() - at < 3_600_000);
    if (hourly.length >= 5 || attempts.length >= 20) {
      const nextAttemptAt = Math.max(hourly.length >= 5 ? Math.min(...hourly) + 3_600_000 : 0,
        attempts.length >= 20 ? Math.min(...attempts) + 86_400_000 : 0);
      for (const report of records) if (["pending", "needs_sender"].includes(report.delivery.state)
        && report.consentId === settings.consentId && report.recipient === settings.recipient
        && (report.delivery.nextAttemptAt < nextAttemptAt || report.delivery.reason !== "Delivery limit reached; retry scheduled")) {
        this.store.update(report, { nextAttemptAt: Math.max(report.delivery.nextAttemptAt, nextAttemptAt),
          reason: "Delivery limit reached; retry scheduled" });
      }
      return;
    }
    const report = records.filter(report => ["pending", "needs_sender"].includes(report.delivery.state)
      && (report.delivery.nextAttemptAt <= this.now() || (immediate && report.delivery.attempts === 0))
      && report.consentId === settings.consentId && report.recipient === settings.recipient)
      .sort((a, b) => a.createdAt - b.createdAt)[0];
    if (!report) return;
    // Persist before the external effect. A failed write must prevent email transmission.
    const attempt = report.delivery.attempts + 1;
    assertOwned();
    atomicJson(budgetFile, { attempts: [...attempts, this.now()] });
    const sending = this.store.update(report, { state: "sending", attempts: attempt, attemptedAt: this.now() });
    try {
      const receipt = await this.sender.send(sending);
      assertOwned();
      this.store.update(this.store.read(report.id), { state: "sent", sentAt: this.now(), transport: this.method,
        ...(typeof receipt?.messageId === "string" ? { messageId: receipt.messageId.slice(0, 256) } : {}),
        reason: "Accepted by the email server; inbox delivery is not independently verified" });
    } catch (error) {
      const disposition = failureDisposition(error);
      const retry = disposition === "retry" && attempt < 5;
      // Keep authentication pauses independent of report deletion and changed capture settings.
      if (disposition === "blocked") atomicJson(this.pauseFile, { version: 1, pausedAt: this.now() });
      this.store.update(this.store.read(report.id), { state: retry ? "pending" : disposition === "retry" ? "failed" : disposition,
        nextAttemptAt: this.now() + Math.min(3_600_000, 60_000 * 2 ** (attempt - 1)),
        reason: retry ? "Email connection failed before confirmed delivery; retry scheduled" : disposition === "blocked"
          ? "Sender credentials are unavailable or sign-in was rejected; update the sender" : disposition === "failed" || disposition === "retry"
            ? "Email server rejected delivery or the retry budget was exhausted" : "Email delivery is uncertain; check your inbox before a manual resend" });
    }
  }
}

module.exports = { GmailReportSender, ReportDeliveryQueue, failureDisposition, secureStorage };

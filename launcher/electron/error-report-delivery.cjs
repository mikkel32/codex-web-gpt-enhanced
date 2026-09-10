const fs = require("node:fs");
const path = require("node:path");
const { ErrorReportStore, emailAddress, atomicJson, privateDirectory, readPrivateJson } = require("./error-report-store.cjs");
const { formatIncidentEmail } = require("./error-report-email.cjs");

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
  }
  recover() {
    for (const report of this.store.records()) if (report.delivery.state === "sending") {
      this.store.update(report, { state: "uncertain", reason: "App restarted before email acknowledgement was recorded" });
    }
  }
  drain() {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.run().finally(() => { this.inFlight = null; try { this.onChange(); } catch {} });
    return this.inFlight;
  }
  async run() {
    this.store.prune();
    const settings = this.store.settings();
    if (!settings.enabled || !this.sender.configured()) return;
    const records = this.store.records();
    // An authentication failure pauses the installation until explicit configuration succeeds.
    if (records.some(report => report.consentId === settings.consentId && report.delivery.state === "blocked")) return;
    const budgetFile = path.join(this.store.directory, "delivery-budget.json");
    let attempts = [];
    try {
      const saved = readPrivateJson(budgetFile, 4096);
      if (!Array.isArray(saved.attempts) || saved.attempts.length > 20 || saved.attempts.some(value => !Number.isFinite(value))) throw new Error("Invalid email delivery budget");
      attempts = saved.attempts.filter(at => this.now() - at < 86_400_000);
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (attempts.filter(at => this.now() - at < 3_600_000).length >= 5 || attempts.length >= 20) return;
    const report = records.filter(report => report.delivery.state === "pending" && report.delivery.nextAttemptAt <= this.now()
      && report.consentId === settings.consentId && report.recipient === settings.recipient)
      .sort((a, b) => a.createdAt - b.createdAt)[0];
    if (!report) return;
    // Persist before the external effect. A failed write must prevent email transmission.
    const attempt = report.delivery.attempts + 1;
    atomicJson(budgetFile, { attempts: [...attempts, this.now()] });
    const sending = this.store.update(report, { state: "sending", attempts: attempt, attemptedAt: this.now() });
    try {
      await this.sender.send(sending);
      this.store.update(this.store.read(report.id), { state: "sent", sentAt: this.now(), reason: "Accepted by the email server; inbox delivery is not independently verified" });
    } catch (error) {
      const disposition = failureDisposition(error);
      const retry = disposition === "retry" && attempt < 5;
      this.store.update(this.store.read(report.id), { state: retry ? "pending" : disposition === "retry" ? "failed" : disposition,
        nextAttemptAt: this.now() + Math.min(3_600_000, 60_000 * 2 ** (attempt - 1)),
        reason: retry ? "Email connection failed before confirmed delivery; retry scheduled" : disposition === "blocked"
          ? "Sender credentials are unavailable or sign-in was rejected; update the sender" : disposition === "failed" || disposition === "retry"
            ? "Email server rejected delivery or the retry budget was exhausted" : "Email delivery is uncertain; check your inbox before a manual resend" });
    }
  }
}

module.exports = { GmailReportSender, ReportDeliveryQueue, failureDisposition, secureStorage };

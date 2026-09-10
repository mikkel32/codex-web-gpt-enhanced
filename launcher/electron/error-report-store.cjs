const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");

const MAX_REPORT_BYTES = 768 * 1024;
const MAX_REPORTS = 80;
const MAX_QUEUE_BYTES = 20 * 1024 * 1024;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const REPORT_GRACE_MS = 30_000;
const REPORT_NAME = /^[a-f0-9]{64}\.json$/;
const DEFAULT_REPORT_RECIPIENT = "Mikkel.mynderup@gmail.com";
const defaults = () => ({ version: 1, enabled: false, recipient: DEFAULT_REPORT_RECIPIENT, includeResponses: false, consentId: "", deliveryMethod: "smtp" });
const AGENT_DETAIL_FIELDS = ["tool", "stage", "operation", "expected", "actual", "recoveryAttempted", "completedWork", "remainingWork", "hypothesis"];

function agentDetails(input, includeResponses) {
  if (!includeResponses || !input || typeof input !== "object") return {};
  return Object.fromEntries(AGENT_DETAIL_FIELDS.map(name => [name, section(input[name], 4096)]));
}

function emailAddress(value) {
  if (typeof value !== "string" || value.length > 254 || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/.test(value)
    || value.includes("..")) throw new Error("Enter one email address without a display name");
  return value;
}

function privateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const info = fs.lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Report directory must be a real local directory");
  if (process.platform !== "win32") fs.chmodSync(directory, 0o700);
}

function readPrivateJson(file, limit = MAX_REPORT_BYTES) {
  const info = fs.lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > limit) throw new Error("Invalid report file");
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const actual = fs.fstatSync(fd);
    if (!actual.isFile() || actual.size > limit) throw new Error("Invalid report file");
    return JSON.parse(fs.readFileSync(fd, "utf8"));
  } finally { fs.closeSync(fd); }
}

function atomicJson(file, value, exclusive = false) {
  const encoded = JSON.stringify(value, null, 2) + "\n";
  if (Buffer.byteLength(encoded) > MAX_REPORT_BYTES) throw new Error("Report exceeds its storage budget");
  const temporary = path.join(path.dirname(file), `.report-${randomUUID()}.tmp`);
  const fd = fs.openSync(temporary, "wx", 0o600);
  try { fs.writeFileSync(fd, encoded); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  try {
    // Hard-link publication is atomic and cannot replace a concurrent identical incident.
    if (exclusive) fs.linkSync(temporary, file);
    else fs.renameSync(temporary, file);
  } finally { try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== "ENOENT") throw error; } }
}

function redact(value) {
  const text = typeof value === "string" ? value : "";
  return text
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, "[REDACTED PRIVATE KEY]")
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,}|AIza[A-Za-z0-9_-]{20,}|(?:turn|binding|request|activity)_[A-Za-z0-9_-]{20,})\b/g, "[REDACTED TOKEN]")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[REDACTED JWT]")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9+/=_\-.]+/gi, "$1 [REDACTED]")
    .replace(/(^|\n)\s*(?:set-cookie|cookie|authorization|proxy-authorization)\s*:[^\r\n]*/gi, "$1[REDACTED HEADER]")
    .replace(/(["']?(?:password|passwd|app[_ -]?password|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|receipt|secret)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;&}\]]+)/gi, "$1[REDACTED]")
    .replace(/https?:\/\/[^\s"'<>]+/gi, match => {
      try { const url = new URL(match); url.username = ""; url.password = ""; url.search = ""; url.hash = ""; return url.toString(); }
      catch { return "[REDACTED URL]"; }
    })
    .replace(/data:[^,\s]+,[A-Za-z0-9+/=]+/g, "[OMITTED INLINE DATA]");
}

function section(value, limit = 128 * 1024) {
  if (typeof value !== "string" || !value) return { available: false, text: "", truncated: false, redacted: false };
  // Retain a bounded tail before running expressions against potentially enormous output.
  const bounded = value.slice(-limit);
  const text = redact(bounded);
  return { available: true, text, originalChars: value.length, truncated: bounded.length !== value.length, redacted: text !== bounded };
}

function fitReport(report) {
  const sections = [report.error, ...Object.values(report.responses), ...Object.values(report.agentDetails || {}), ...(report.relatedErrors || []).map(value => value.error)];
  while (Buffer.byteLength(JSON.stringify(report, null, 2) + "\n") > MAX_REPORT_BYTES) {
    const longest = sections.filter(value => value && typeof value.text === "string").sort((a, b) => b.text.length - a.text.length)[0];
    if (!longest || longest.text.length < 16) throw new Error("Report metadata exceeds its storage budget");
    let tail = longest.text.slice(Math.floor(longest.text.length / 2));
    if (/^[\uDC00-\uDFFF]/.test(tail)) tail = tail.slice(1);
    longest.text = tail; longest.truncated = true;
  }
  return report;
}

class ErrorReportStore {
  constructor(coreHome, { now = Date.now } = {}) {
    this.directory = path.join(coreHome, "error-reports");
    this.settingsFile = path.join(this.directory, "settings.json");
    this.now = now;
  }
  settings() {
    try {
      const value = readPrivateJson(this.settingsFile, 4096);
      if (value.version !== 1 || typeof value.enabled !== "boolean" || typeof value.includeResponses !== "boolean"
        || typeof value.consentId !== "string" || (value.enabled && !/^[a-f0-9-]{36}$/.test(value.consentId))) throw new Error("Invalid report settings");
      if (value.recipient) emailAddress(value.recipient);
      if (value.enabled && !value.recipient) throw new Error("Missing report recipient");
      if (value.deliveryMethod !== undefined && !["smtp", "gmail"].includes(value.deliveryMethod)) throw new Error("Invalid delivery method");
      return { version: 1, enabled: value.enabled, includeResponses: value.includeResponses, recipient: value.recipient || DEFAULT_REPORT_RECIPIENT, consentId: value.consentId, deliveryMethod: value.deliveryMethod || "smtp" };
    } catch (error) { if (error.code === "ENOENT") return defaults(); throw error; }
  }
  configure({ enabled, recipient, includeResponses, deliveryMethod }) {
    if (typeof enabled !== "boolean" || typeof includeResponses !== "boolean") throw new Error("Explicit reporting consent is required");
    const address = recipient ? emailAddress(recipient.trim()) : enabled ? "" : DEFAULT_REPORT_RECIPIENT;
    if (enabled && !address) throw new Error("A report recipient is required");
    const old = this.settings();
    const method = deliveryMethod ?? old.deliveryMethod;
    if (!["smtp", "gmail"].includes(method)) throw new Error("Invalid delivery method");
    const unchanged = old.enabled === enabled && old.recipient === address && old.includeResponses === includeResponses;
    const next = { version: 1, enabled, recipient: address, includeResponses, deliveryMethod: method,
      consentId: unchanged && old.consentId ? old.consentId : randomUUID() };
    privateDirectory(this.directory);
    atomicJson(this.settingsFile, next);
    return next;
  }
  files() {
    try { return fs.readdirSync(this.directory).filter(name => REPORT_NAME.test(name)).sort(); }
    catch (error) { if (error.code === "ENOENT") return []; throw error; }
  }
  read(id) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Invalid report ID");
    const value = readPrivateJson(path.join(this.directory, `${id}.json`));
    if (value.version !== 1 || value.id !== id || !Number.isFinite(value.createdAt)
      || !value.delivery || !["pending", "needs_sender", "sending", "sent", "blocked", "failed", "uncertain"].includes(value.delivery.state)) throw new Error("Invalid report record");
    emailAddress(value.recipient);
    return value;
  }
  records() {
    return this.files().flatMap(name => { try { return [this.read(name.slice(0, -5))]; } catch { return []; } });
  }
  prune() {
    for (const name of this.files()) {
      const file = path.join(this.directory, name);
      const info = fs.lstatSync(file);
      if (info.isFile() && !info.isSymbolicLink()) {
        let createdAt = info.mtimeMs;
        try { createdAt = this.read(name.slice(0, -5)).createdAt; } catch {}
        if (this.now() - createdAt > RETENTION_MS) fs.unlinkSync(file);
      }
    }
  }
  capture(input) {
    const settings = this.settings();
    if (!settings.enabled) return { captured: false, reason: "disabled" };
    if (["client_cancelled", "manual_turn_cancelled", "native_interrupt"].includes(input.code)) return { captured: false, reason: "cancelled" };
    privateDirectory(this.directory);
    this.prune();
    const source = ["web-runtime", "launcher", "browser", "native-runtime", "agent"].includes(input.source) ? input.source : "launcher";
    const error = section(input.error, 16 * 1024);
    const code = section(input.code, 120).text;
    const identity = section(input.traceId || input.turnId, 200).text;
    const key = JSON.stringify([settings.consentId, identity || Math.floor(this.now() / 1_800_000),
      identity ? "turn" : source, identity ? "" : code, identity ? "" : error.text]);
    const id = createHash("sha256").update(key).digest("hex");
    const file = path.join(this.directory, `${id}.json`);
    if (fs.existsSync(file)) {
      // The helper and Responses server contribute to one incident, before delivery begins.
      const existing = this.read(id);
      if (["pending", "needs_sender"].includes(existing.delivery.state)) {
        const responses = { ...existing.responses };
        const details = { ...existing.agentDetails };
        for (const [name, value] of Object.entries(agentDetails(input.agentDetails, settings.includeResponses))) {
          if (value.available && !details[name]?.available) details[name] = value;
        }
        for (const [name, value] of [["web", input.webResponse], ["codex", input.codexResponse], ["toolFailure", input.toolFailure]]) {
          if (settings.includeResponses && typeof value === "string" && value && !responses[name]?.available) responses[name] = section(value, name === "toolFailure" ? 32 * 1024 : 128 * 1024);
        }
        const relatedErrors = [...(existing.relatedErrors || [])];
        if (error.text !== existing.error.text && !relatedErrors.some(item => item.error.text === error.text) && relatedErrors.length < 5) relatedErrors.push({ source, code, error });
        atomicJson(file, fitReport({ ...existing, responses, relatedErrors, agentDetails: details,
          observations: Math.min(1_000_000, (existing.observations || 1) + 1), lastSeenAt: this.now(),
          reportedAttempts: Math.max(existing.reportedAttempts || 0, Number.isSafeInteger(input.attempts) ? Math.min(1000, Math.max(0, input.attempts)) : 0),
          threadId: existing.threadId || section(input.threadId, 200).text,
          turnId: existing.turnId || section(input.turnId, 200).text,
          notes: section([...new Set([existing.notes, input.notes].filter(Boolean))].join("\n"), 8192).text }));
      }
      return { captured: false, reason: "duplicate", id };
    }
    const files = this.files();
    const bytes = files.reduce((sum, name) => sum + fs.lstatSync(path.join(this.directory, name)).size, 0);
    if (files.length >= MAX_REPORTS || bytes + MAX_REPORT_BYTES > MAX_QUEUE_BYTES) return { captured: false, reason: "queue-full" };
    const report = { version: 1, id, createdAt: this.now(), recipient: settings.recipient, consentId: settings.consentId,
      source, code, error, observations: 1, lastSeenAt: this.now(),
      reportedAttempts: Number.isSafeInteger(input.attempts) ? Math.min(1000, Math.max(0, input.attempts)) : 0,
      agentDetails: agentDetails(input.agentDetails, settings.includeResponses),
      model: section(input.model, 160).text, appVersion: section(input.appVersion, 80).text,
      platform: `${process.platform}/${process.arch}`, traceId: section(input.traceId, 200).text,
      threadId: section(input.threadId, 200).text, turnId: section(input.turnId, 200).text,
      responsesIncluded: settings.includeResponses,
      responses: { web: section(settings.includeResponses ? input.webResponse : undefined),
        codex: section(settings.includeResponses ? input.codexResponse : undefined),
        toolFailure: section(settings.includeResponses ? input.toolFailure : undefined, 32 * 1024) },
      notes: section(input.notes, 4096).text,
      delivery: { state: settings.deliveryMethod === "gmail" || fs.existsSync(path.join(this.directory, "sender.json")) ? "pending" : "needs_sender",
        attempts: 0, nextAttemptAt: this.now() + REPORT_GRACE_MS } };
    try { atomicJson(file, fitReport(report), true); }
    catch (error) { if (error.code === "EEXIST") return { captured: false, reason: "duplicate", id }; throw error; }
    return { captured: true, id };
  }
  update(report, delivery) {
    const latest = this.read(report.id);
    atomicJson(path.join(this.directory, `${report.id}.json`), { ...latest, delivery: { ...latest.delivery, ...delivery } });
    return this.read(report.id);
  }
  remove(id) { this.read(id); fs.unlinkSync(path.join(this.directory, `${id}.json`)); }
}

module.exports = { ErrorReportStore, emailAddress, redact, section, readPrivateJson, atomicJson, privateDirectory, MAX_REPORTS, RETENTION_MS, REPORT_GRACE_MS, DEFAULT_REPORT_RECIPIENT };

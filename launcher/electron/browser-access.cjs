const fs = require("node:fs");
const { writePrivateFileAtomic } = require("./atomic-file.cjs");

const REASONS = new Set(["verification", "rate-limit", "sign-in", "service", "local-state"]);
const DEFAULT_COOLDOWN_MS = 60_000;
const SEND_INTERVAL_MS = 2_000;

function retryAfterTime(value, now = Date.now()) {
  if (typeof value !== "string" || !value.trim()) return null;
  const text = value.trim();
  const time = /^\d+$/.test(text) ? now + Number(text) * 1000 : Date.parse(text);
  return Number.isFinite(time) && time >= now && time <= 8.64e15 ? time : null;
}

class BrowserAccessPausedError extends Error {
  constructor(message) { super(message); this.name = "BrowserAccessPausedError"; this.code = "browser_access_paused"; }
}

class BrowserAccessGate {
  constructor({ filePath, now = Date.now, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), sendIntervalMs = SEND_INTERVAL_MS } = {}) {
    this.filePath = filePath; this.now = now; this.wait = wait; this.sendIntervalMs = sendIntervalMs;
    this.record = null; this.lastSendAt = null; this.tail = Promise.resolve(); this.revision = 0;
    try {
      if (!filePath || !fs.existsSync(filePath)) return;
      if (fs.statSync(filePath).size > 16_384) throw new Error("Pause record exceeded its size limit");
      const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (value.version !== 1 || !REASONS.has(value.reason) || !Number.isFinite(value.detectedAt) || Math.abs(value.detectedAt) > 8.64e15
        || (value.retryAt !== null && (!Number.isFinite(value.retryAt) || Math.abs(value.retryAt) > 8.64e15))
        || (["rate-limit", "service"].includes(value.reason) && value.retryAt === null)
        || !Number.isSafeInteger(value.incidents) || value.incidents < 1) throw new Error("Invalid pause record");
      this.record = value;
    } catch {
      this.record = { version: 1, reason: "local-state", detectedAt: now(), retryAt: null, incidents: 1 };
    }
  }

  snapshot() {
    const record = this.record;
    if (!record) return { status: "ready" };
    return { status: "paused", reason: record.reason, detectedAt: new Date(record.detectedAt).toISOString(),
      retryAt: record.retryAt === null ? null : new Date(record.retryAt).toISOString(),
      incidents: record.incidents, canResume: record.retryAt === null || this.now() >= record.retryAt };
  }

  message() {
    const state = this.snapshot();
    if (state.reason === "rate-limit") return "ChatGPT asked Maria to slow down. Web sending is paused; wait for the cooldown and resume in Maria. Native Codex remains available.";
    if (state.reason === "sign-in") return "ChatGPT needs a fresh sign-in. Web sending is paused. Sign in and resume in Maria; native Codex remains available.";
    if (state.reason === "service") return "ChatGPT is temporarily unavailable. Web sending is paused; wait and resume in Maria. Native Codex remains available.";
    if (state.reason === "local-state") return "Maria could not read its local pause record. Review the current task and resume in Maria. Native Codex remains available.";
    return "ChatGPT needs a user verification check. Complete it in the browser, then resume in Maria. No prompt was resent; native Codex remains available.";
  }

  pause(reason, retryAfter) {
    if (!REASONS.has(reason)) throw new Error("Unknown browser pause reason");
    const now = this.now();
    const previous = this.record;
    // A burst of failed subrequests represents one incident, not an exponential retry loop.
    const sameIncident = previous?.reason === reason && now - previous.detectedAt < 30_000;
    const incidents = sameIncident ? previous.incidents : (previous?.incidents ?? 0) + 1;
    const timed = reason === "rate-limit" || reason === "service";
    const retryAt = timed ? Math.max(previous?.retryAt ?? 0, retryAfterTime(retryAfter, now)
      ?? (sameIncident && previous.retryAt > now ? previous.retryAt : now + Math.min(15 * 60_000, DEFAULT_COOLDOWN_MS * 2 ** Math.min(incidents - 1, 4)))) : previous?.retryAt ?? null;
    // Verification and sign-in require an explicit human acknowledgement, even if a later asset loads.
    const effectiveReason = previous && ["verification", "sign-in"].includes(previous.reason) && timed ? previous.reason : reason;
    const next = { version: 1, reason: effectiveReason, detectedAt: sameIncident ? previous.detectedAt : now, retryAt: retryAt === null ? null : Math.ceil(retryAt / 1000) * 1000, incidents };
    if (JSON.stringify(next) === JSON.stringify(previous)) return this.snapshot();
    this.record = next;
    this.revision++;
    if (this.filePath) writePrivateFileAtomic(this.filePath, JSON.stringify(this.record));
    return this.snapshot();
  }

  assertAvailable() { if (this.record) throw new BrowserAccessPausedError(this.message()); }

  resume() {
    if (this.record?.retryAt && this.now() < this.record.retryAt) throw new BrowserAccessPausedError("ChatGPT's cooldown has not ended. Keep using native Codex while you wait.");
    if (this.filePath) fs.rmSync(this.filePath, { force: true });
    this.record = null; this.revision++;
    // Never replay queued work when a user resumes; old reservations observe a changed revision.
    return this.snapshot();
  }

  beforeSend(stillOwned = () => true) {
    const revision = this.revision;
    const send = this.tail.then(async () => {
      this.assertAvailable();
      if (this.lastSendAt !== null) {
        const remaining = this.sendIntervalMs - (this.now() - this.lastSendAt);
        if (remaining > 0) await this.wait(remaining);
      }
      this.assertAvailable();
      if (revision !== this.revision || !stillOwned()) throw new BrowserAccessPausedError("This pending Web send was stopped. Return to the original Codex task to continue; no prompt was sent.");
      this.lastSendAt = this.now();
    });
    this.tail = send.catch(() => {});
    return send;
  }
}

module.exports = { BrowserAccessGate, BrowserAccessPausedError, retryAfterTime, SEND_INTERVAL_MS };

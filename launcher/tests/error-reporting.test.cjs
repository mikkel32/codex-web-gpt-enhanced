const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { EventEmitter } = require("node:events");
const { ErrorReportStore, redact, emailAddress, RETENTION_MS } = require("../electron/error-report-store.cjs");
const { GmailReportSender, ReportDeliveryQueue, failureDisposition } = require("../electron/error-report-delivery.cjs");
const { ReportLogObserver } = require("../electron/error-report-log-observer.cjs");
const { installErrorReporting } = require("../electron/error-reporting-app.cjs");

function fixture(t, enabled = true) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "maria-reports-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  let time = Date.now(); const now = () => time;
  const store = new ErrorReportStore(home, { now });
  if (enabled) store.configure({ enabled: true, recipient: "owner@example.com", includeResponses: true });
  const sent = [];
  const sender = { configured: () => true, send: async report => { sent.push(report); return { accepted: true }; } };
  const queue = new ReportDeliveryQueue(store, sender, { now });
  const incident = (traceId = "trace_one", data = {}) => store.capture({ source: "web-runtime", traceId,
    error: "Stream disconnected before completion", code: "stream_interrupted", webResponse: "First line\nSecond line: æøå 🪙", ...data });
  return { home, store, sent, sender, queue, now, incident, advance: ms => { time += ms; } };
}

test("reporting is disabled by default and creates no report directory", t => {
  const f = fixture(t, false);
  assert.deepEqual(f.incident(), { captured: false, reason: "disabled" });
  assert.equal(fs.existsSync(f.store.directory), false);
});

test("configuration requires explicit consent and one valid destination", t => {
  const { store } = fixture(t, false);
  for (const recipient of ["owner@example.com\r\nBcc: attacker@example.com", "a@example.com,b@example.com", "Name <a@example.com>"]) {
    assert.throws(() => emailAddress(recipient));
  }
  assert.throws(() => store.configure({ enabled: true, recipient: "", includeResponses: true }));
  assert.throws(() => store.configure({ enabled: true, recipient: "owner@example.com" }));
});

test("recorded text is preserved with explicit redaction and truncation markers", t => {
  const f = fixture(t);
  const plain = "First line\nSecond line: æøå 🪙";
  const result = f.incident(); const report = f.store.read(result.id);
  assert.equal(report.responses.web.text, plain);
  assert.equal(report.responses.web.redacted, false);
  assert.equal(report.responses.codex.available, false);
  const large = f.incident("trace_large", { webResponse: "x".repeat(200000) });
  assert.equal(f.store.read(large.id).responses.web.truncated, true);
  assert.equal(f.store.read(large.id).responses.web.originalChars, 200000);
  const secret = "sk-" + "s".repeat(30);
  const confidential = f.incident("trace_secret", { webResponse: `Useful answer ${secret}\npassword=not-for-email\nCookie: session=secret` });
  const saved = f.store.read(confidential.id);
  assert.equal(saved.responses.web.redacted, true);
  assert.equal(JSON.stringify(saved).includes(secret), false);
  assert.equal(JSON.stringify(saved).includes("not-for-email"), false);
  assert.equal(JSON.stringify(saved).includes("session=secret"), false);
  if (process.platform !== "win32") assert.equal(fs.statSync(path.join(f.store.directory, `${result.id}.json`)).mode & 0o777, 0o600);
});

test("redaction removes bearer tokens, private keys, JWTs, query strings, and receipts", () => {
  const value = redact('Bearer abc123\napi_key="keyvalue"\nreceipt="secret-proof"\nhttps://user:pass@example.com/path?token=sensitive#fragment\n-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----');
  for (const secret of ["abc123", "keyvalue", "secret-proof", "user:pass", "sensitive", "fragment", "\nsecret\n"]) assert.equal(value.includes(secret), false);
  assert(value.includes("https://example.com/path"));
});

test("a hundred retries produce one report and two layers contribute separate recorded responses", t => {
  const f = fixture(t); const first = f.incident();
  for (let i = 0; i < 100; i++) assert.equal(f.incident().id, first.id);
  f.incident("trace_one", { source: "launcher", error: "Previous turn needs review", webResponse: undefined, codexResponse: "Codex received this exact text" });
  assert.equal(f.store.records().length, 1);
  const report = f.store.read(first.id);
  assert.equal(report.responses.codex.text, "Codex received this exact text");
  assert.equal(report.responses.web.available, true);
  assert.equal(report.relatedErrors.length, 1);
});

test("response content and user cancellations are excluded without matching consent", t => {
  const f = fixture(t); f.store.configure({ ...f.store.settings(), includeResponses: false });
  const report = f.store.read(f.incident().id);
  assert.equal(report.responses.web.available, false);
  assert.equal(f.incident("cancel", { code: "client_cancelled" }).reason, "cancelled");
});

test("durable queued reports send once and a restart cannot resend acknowledged delivery", async t => {
  const f = fixture(t); const { id } = f.incident(); f.advance(30001);
  await Promise.all([f.queue.drain(), f.queue.drain(), f.queue.drain()]);
  assert.equal(f.sent.length, 1); assert.equal(f.store.read(id).delivery.state, "sent");
  const restart = new ReportDeliveryQueue(f.store, f.sender, { now: f.now }); restart.recover(); await restart.drain();
  assert.equal(f.sent.length, 1);
});

test("a crash during sending becomes uncertain and is never automatically replayed", async t => {
  const f = fixture(t); const report = f.store.read(f.incident().id);
  f.store.update(report, { state: "sending", attemptedAt: f.now() });
  f.queue.recover(); f.advance(100000); await f.queue.drain();
  assert.equal(f.sent.length, 0); assert.equal(f.store.read(report.id).delivery.state, "uncertain");
});

test("an ambiguous SMTP disconnection cannot become success or trigger another email", async t => {
  const f = fixture(t); const { id } = f.incident(); let calls = 0;
  f.sender.send = async () => { calls++; throw { code: "ETIMEDOUT", command: "DATA" }; };
  f.advance(30001); await f.queue.drain(); f.advance(3600000); await f.queue.drain();
  assert.equal(f.store.read(id).delivery.state, "uncertain"); assert.equal(calls, 1);
});

test("authentication rejection pauses the queue without hammering the sender", async t => {
  const f = fixture(t); const { id } = f.incident(); f.advance(1); f.incident("another"); let calls = 0;
  f.sender.send = async () => { calls++; throw { code: "EAUTH" }; };
  f.advance(30001); await f.queue.drain(); f.advance(3600000); await f.queue.drain();
  assert.equal(f.store.read(id).delivery.state, "blocked"); assert.equal(calls, 1);
});

test("safe connection failures retry with bounded backoff and stop at five attempts", async t => {
  const f = fixture(t); const { id } = f.incident(); let calls = 0;
  f.sender.send = async () => { calls++; throw { code: "ECONNECTION" }; };
  f.advance(30001); await f.queue.drain(); await f.queue.drain(); assert.equal(calls, 1);
  for (let i = 1; i < 5; i++) { f.advance(3600001); await f.queue.drain(); }
  assert.equal(calls, 5); assert.equal(f.store.read(id).delivery.state, "failed");
});

test("delivery budgets survive restarts and deletion of sent reports", async t => {
  const f = fixture(t);
  for (let i = 0; i < 6; i++) f.incident(`rate_${i}`);
  f.advance(30001);
  for (let i = 0; i < 6; i++) await f.queue.drain();
  assert.equal(f.sent.length, 5);
  for (const report of f.store.records()) if (report.delivery.state === "sent") f.store.remove(report.id);
  const queue = new ReportDeliveryQueue(f.store, f.sender, { now: f.now }); await queue.drain();
  assert.equal(f.sent.length, 5); f.advance(3600001); await queue.drain(); assert.equal(f.sent.length, 6);
});

test("changing destination or disabling reporting holds earlier reports under their original consent", async t => {
  const f = fixture(t); f.incident(); f.advance(30001);
  f.store.configure({ enabled: false, recipient: "owner@example.com", includeResponses: true }); await f.queue.drain();
  f.store.configure({ enabled: true, recipient: "other@example.com", includeResponses: true }); await f.queue.drain();
  assert.equal(f.sent.length, 0); assert.equal(f.store.records()[0].recipient, "owner@example.com");
});

test("a persistence failure prevents delivery and cannot break another task", async t => {
  const f = fixture(t); f.incident(); f.advance(30001);
  f.store.update = () => { throw new Error("synthetic disk failure"); };
  await assert.rejects(f.queue.drain(), /disk failure/); assert.equal(f.sent.length, 0);
});

test("queue storage is bounded and expires after seven days", t => {
  const f = fixture(t);
  for (let i = 0; i < 80; i++) assert.equal(f.incident(`bounded_${i}`).captured, true);
  assert.equal(f.incident("overflow").reason, "queue-full");
  f.advance(RETENTION_MS + 1); f.store.prune(); assert.equal(f.store.records().length, 0);
});

test("report IDs cannot read arbitrary files", t => {
  const f = fixture(t);
  for (const id of ["../sender", "/etc/passwd", "sender", "a".repeat(65)]) assert.throws(() => f.store.read(id));
});

test("the daily cap also applies when earlier reports were deleted", async t => {
  const f = fixture(t);
  for (let hour = 0; hour < 4; hour++) {
    for (let n = 0; n < 5; n++) f.incident(`daily_${hour}_${n}`);
    f.advance(30001);
    for (let n = 0; n < 5; n++) await f.queue.drain();
    f.advance(3600001);
    for (const report of f.store.records()) f.store.remove(report.id);
  }
  assert.equal(f.sent.length, 20);
  f.incident("daily_overflow"); f.advance(30001); await f.queue.drain(); assert.equal(f.sent.length, 20);
  f.advance(86400001); await f.queue.drain(); assert.equal(f.sent.length, 21);
});

test("escaped control characters cannot exceed the serialized report budget", t => {
  const f = fixture(t); const text = "\u0001".repeat(128 * 1024);
  const { id } = f.incident("escaped_report", { webResponse: text, codexResponse: text, toolFailure: text });
  const report = f.store.read(id);
  assert(fs.statSync(path.join(f.store.directory, `${id}.json`)).size <= 768 * 1024);
  assert(report.responses.web.truncated || report.responses.codex.truncated);
});

const fakeStorage = {
  isEncryptionAvailable: () => true, getSelectedStorageBackend: () => "keychain",
  encryptString: text => Buffer.from(text).map(value => value ^ 0x91),
  decryptString: bytes => Buffer.from(bytes).map(value => value ^ 0x91).toString("utf8"),
};

test("SMTP requires verified TLS, a fixed recipient, and in-memory attachments", async t => {
  const f = fixture(t); const report = f.store.read(f.incident().id); let options, message;
  const sender = new GmailReportSender(f.home, fakeStorage, value => { options = value; return { close() {}, sendMail: async value => { message = value; return { accepted: [report.recipient] }; } }; });
  sender.save("sender@gmail.com", "abcdefghijklmnop");
  assert.equal(fs.readFileSync(sender.file, "utf8").includes("abcdefghijklmnop"), false);
  assert.equal(sender.account(), "sender@gmail.com");
  await sender.send(report);
  assert.equal(options.secure, true); assert.equal(options.tls.rejectUnauthorized, true);
  assert.equal(options.host, "smtp.gmail.com"); assert.equal(options.port, 465);
  assert.equal(options.disableFileAccess, true); assert.equal(options.disableUrlAccess, true);
  assert.deepEqual(message.envelope.to, ["owner@example.com"]);
  assert(Buffer.isBuffer(message.attachments[0].content)); assert.equal(message.attachments[0].path, undefined);
  assert.equal(message.messageId, `<${report.id}@maria-webgpt.local>`);
});

test("plaintext credential fallback and regular passwords are rejected", t => {
  const f = fixture(t);
  const insecure = new GmailReportSender(f.home, { ...fakeStorage, getSelectedStorageBackend: () => "basic_text" });
  assert.throws(() => insecure.save("sender@gmail.com", "abcdefghijklmnop"), /secure operating-system/);
  const secure = new GmailReportSender(f.home, fakeStorage);
  assert.throws(() => secure.save("sender@gmail.com", "ordinary-password"), /16-character/);
  assert.equal(secure.configured(), false);
});

test("the installed mail library composes the real JSON attachment entirely offline", async t => {
  const f = fixture(t); const report = f.store.read(f.incident().id); let mime = "";
  const sender = new GmailReportSender(f.home, fakeStorage, () => {
    const transport = require("nodemailer").createTransport({ streamTransport: true, buffer: true });
    return { close() { transport.close(); }, async sendMail(message) {
      const result = await transport.sendMail(message); mime = result.message.toString("utf8");
      return { accepted: [report.recipient] };
    } };
  });
  sender.save("sender@gmail.com", "abcdefghijklmnop"); await sender.send(report);
  assert(mime.includes("To: owner@example.com"));
  assert(mime.includes("Content-Type: application/json"));
  assert(mime.includes(`maria-incident-${report.id.slice(0, 10)}.json`));
  assert.equal(mime.includes("abcdefghijklmnop"), false);
});

test("SMTP errors distinguish explicit rejection from ambiguous delivery", () => {
  assert.equal(failureDisposition({ responseCode: 421 }), "retry");
  assert.equal(failureDisposition({ responseCode: 550 }), "failed");
  assert.equal(failureDisposition({ command: "CONN", code: "ETIMEDOUT" }), "retry");
  assert.equal(failureDisposition({ command: "DATA", code: "ETIMEDOUT" }), "uncertain");
});

test("log observation ignores old history, routine events, raw stderr and reporting failures", t => {
  const f = fixture(t); const file = path.join(f.home, "launcher.jsonl"), seen = [];
  const event = (level, name, message) => JSON.stringify({ level, event: name, detail: { message, credential: "never-copy" } }) + "\n";
  fs.writeFileSync(file, event("error", "old", "prior startup"));
  const observer = new ReportLogObserver(file, value => seen.push(value));
  fs.appendFileSync(file, event("info", "routine", "fine") + event("error", "runtime.stderr", "unrelated content") + event("error", "error-report.failure", "report failed") + event("error", "launcher.failed", "Exact failure æøå"));
  observer.poll(true); assert.equal(seen.length, 1); assert.equal(seen[0].error, "Exact failure æøå");
  assert.equal(JSON.stringify(seen).includes("never-copy"), false);
  fs.appendFileSync(file, event("error", "disabled", "do not capture")); observer.poll(false); observer.poll(true);
  assert.equal(seen.length, 1);
});

test("untrusted renderers cannot configure the sender or read queued task responses", async t => {
  const f = fixture(t, false), app = new EventEmitter(); app.getVersion = () => "test"; app.getPath = () => f.home;
  const window = new EventEmitter(); window.isDestroyed = () => false; window.webContents = {};
  const ipcMain = { handle() {}, removeHandler() {} };
  const api = installErrorReporting({ app, launcherWindow: window, coreHome: f.home, electron: { ipcMain, safeStorage: fakeStorage } });
  t.after(() => api.dispose());
  await assert.rejects(api.handler({ sender: {} }, { action: "save", value: { enabled: true } }), /local settings window/);
  await assert.rejects(api.handler({ sender: {} }, { action: "preview", id: "a".repeat(64) }), /local settings window/);
  assert.equal(f.store.settings().enabled, false);
});

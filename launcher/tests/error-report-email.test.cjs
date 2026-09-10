const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { ErrorReportStore, DEFAULT_REPORT_RECIPIENT } = require("../electron/error-report-store.cjs");
const { formatIncidentEmail } = require("../electron/error-report-email.cjs");
const { ReportDeliveryQueue, failureDisposition } = require("../electron/error-report-delivery.cjs");

function fixture(t, overrides = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "maria-email-layout-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const store = new ErrorReportStore(home, { now: () => 1_789_056_000_000 });
  store.configure({ enabled: true, recipient: DEFAULT_REPORT_RECIPIENT, includeResponses: true });
  const result = store.capture({ source: "agent", traceId: "local-trace", code: "command_failed", error: "Tool read not found",
    attempts: 2, appVersion: "fixture-version", agentDetails: { operation: "Read the API module", completedWork: "Tests passed", remainingWork: "Inspect the API module", hypothesis: "Unverified catalog mismatch" },
    webResponse: "Exact Web response æøå 🪙", ...overrides });
  return { store, report: store.read(result.id) };
}

test("email includes detailed readable evidence, plain text and HTML with a full JSON attachment", t => {
  const { report } = fixture(t); const message = formatIncidentEmail(report);
  for (const value of ["Tool read not found", "Read the API module", "Tests passed", "Inspect the API module", "Exact Web response æøå 🪙", "Agent hypothesis (unverified)"]) {
    assert(message.text.toLowerCase().includes(value.toLowerCase())); assert(message.html.includes(value));
  }
  assert(message.text.includes("Not observed or not included"));
  assert(message.text.includes("First recorded (UTC):"));
  assert(message.subject.includes(report.id.slice(0, 10))); assert(message.subject.includes("command_failed"));
  const evidence = JSON.parse(message.attachments[0].content.toString());
  assert.equal(evidence.responses.web.text, report.responses.web.text);
  assert.equal(evidence.consentId, undefined); assert.equal(evidence.delivery, undefined);
  assert.equal(evidence.recipient, undefined);
  assert.equal(message.attachments[0].path, undefined);
});

test("email rendering treats every diagnostic field as text and contains no remote tracking resources", t => {
  const { report } = fixture(t, { error: '<img src="https://evil.test" onerror="alert(1)"><script>bad()</script>',
    agentDetails: { operation: '</pre><iframe src="https://evil.test"></iframe>', hypothesis: "Bearer not-for-email" } });
  const message = formatIncidentEmail(report);
  assert(!/<(?:img|script|iframe|link)\b/i.test(message.html));
  assert(!/<[^>]+\son\w+=/i.test(message.html)); // Escaped diagnostic strings are not element attributes.
  assert(message.html.includes("&lt;img")); assert(!message.html.includes("Bearer not-for-email"));
});

test("long response previews point to the retained attachment and never pretend to contain omitted text", t => {
  const { report } = fixture(t, { webResponse: "x".repeat(150000) });
  const message = formatIncidentEmail(report);
  assert(message.text.includes("Capture truncated")); assert(message.text.includes("Email excerpt"));
  assert(message.html.length < 60000);
  assert(JSON.parse(message.attachments[0].content.toString()).responses.web.truncated);
});

test("subject headers cannot acquire additional recipients or control characters from an error code", t => {
  const { report } = fixture(t);
  report.code = "failure\r\nBcc: someone@example.com";
  const message = formatIncidentEmail(report);
  assert(!/[\r\n]/.test(message.subject)); assert(message.subject.length < 130);
  assert.throws(() => formatIncidentEmail({ ...report, id: "../private" }), /identity/);
});

test("Unicode and HTML escaping cannot exceed the email body byte budget", t => {
  const value = '<&"🪙'.repeat(10000);
  const { report } = fixture(t, { error: value, webResponse: value, codexResponse: value, toolFailure: value,
    agentDetails: { operation: value, expected: value, actual: value, recoveryAttempted: value, completedWork: value, remainingWork: value, hypothesis: value } });
  const message = formatIncidentEmail(report);
  assert(Buffer.byteLength(message.html, "utf8") <= 80000);
  assert(message.html.includes("Email excerpt"));
  assert.equal(JSON.parse(message.attachments[0].content.toString()).responses.codex.text, report.responses.codex.text);
});

test("agent details merge into the same pending runtime incident and honor response-content consent", t => {
  const { store, report } = fixture(t);
  store.capture({ source: "web-runtime", traceId: "local-trace", error: "Stream closed", codexResponse: "Exact Codex text" });
  const updated = store.read(report.id);
  assert.equal(store.records().length, 1); assert.equal(updated.observations, 2);
  assert.equal(updated.responses.codex.text, "Exact Codex text");
  assert.equal(updated.agentDetails.operation.text, "Read the API module");
  store.configure({ ...store.settings(), includeResponses: false });
  const next = store.capture({ source: "agent", traceId: "limited", error: "Failed", agentDetails: { operation: "private detail" } });
  assert.deepEqual(store.read(next.id).agentDetails, {});
});

test("a generic connection failure after SMTP DATA is uncertain and cannot produce a duplicate email", async t => {
  const { store, report } = fixture(t); let sends = 0;
  const error = Object.assign(new Error("Connection closed after message data"), { code: "ECONNECTION", command: "DATA" });
  assert.equal(failureDisposition(error), "uncertain");
  assert.equal(failureDisposition({ ...error, responseCode: 450 }), "retry");
  const queue = new ReportDeliveryQueue(store, { configured: () => true, send: async () => { sends++; throw error; } },
    { now: () => report.createdAt + 31000 });
  await queue.drain(); await queue.drain();
  assert.equal(sends, 1); assert.equal(store.read(report.id).delivery.state, "uncertain");
});

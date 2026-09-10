const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { ErrorReportStore } = require("../electron/error-report-store.cjs");
const { deliverConnectedGmailReport, GMAIL_PROFILE_TOOL, GMAIL_SEND_TOOL } = require("../electron/connected-gmail-delivery.cjs");

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "maria-connected-mail-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const store = new ErrorReportStore(home);
  store.configure({ enabled: true, recipient: "owner@gmail.com", includeResponses: true, deliveryMethod: "gmail" });
  const { id } = store.capture({ source: "agent", traceId: "existing-incident", code: "test_failure", error: "Observed failure", webResponse: "password=never-export" });
  return { home, store, id };
}

test("connected Gmail sends the existing incident to the same account without a password and records the actual receipt", async t => {
  const f = fixture(t); const calls = [];
  const invoke = async (name, args) => {
    calls.push({ name, args });
    return { structuredContent: name === GMAIL_PROFILE_TOOL ? { email: "OWNER@gmail.com" } : { result: { id: "gmail_receipt_1", label_ids: ["SENT"] } } };
  };
  const delivered = await deliverConnectedGmailReport(f.home, invoke);
  assert.equal(delivered.delivered, true); assert.equal(delivered.messageId, "gmail_receipt_1");
  assert.deepEqual(calls.map(call => call.name), [GMAIL_PROFILE_TOOL, GMAIL_SEND_TOOL]);
  assert.equal(calls[1].args.to, "owner@gmail.com"); assert.equal(calls[1].args.cc, undefined);
  assert(!JSON.stringify(calls[1].args).includes("never-export"));
  const evidence = JSON.parse(Buffer.from(calls[1].args.payload.parts[1].body.base64_url_content, "base64url"));
  assert.equal(evidence.id, f.id); assert.equal(evidence.delivery, undefined);
  assert.equal(f.store.read(f.id).delivery.transport, "gmail");
  await deliverConnectedGmailReport(f.home, invoke); assert.equal(calls.length, 2);
  assert.equal(fs.existsSync(path.join(f.home, "error-reports", "sender.json")), false);
});

test("missing permission or a different connected account does not consume a delivery attempt", async t => {
  for (const response of [{ isError: true, content: [{ type: "text", text: "Access denied" }] }, { structuredContent: { email: "different@gmail.com" } }]) {
    const f = fixture(t);
    const result = await deliverConnectedGmailReport(f.home, async name => {
      assert.equal(name, GMAIL_PROFILE_TOOL); return response;
    });
    assert.equal(result.actionRequired, "connect_gmail");
    assert.equal(f.store.read(f.id).delivery.attempts, 0);
    assert.equal(f.store.read(f.id).delivery.state, "blocked");
    const paused = await deliverConnectedGmailReport(f.home, async () => { throw new Error("A paused connection must not be called again"); });
    assert.equal(paused.actionRequired, "resume_connected_gmail");
  }
});

test("Gmail uncertainty is never resent and a generic tool success is not a mail receipt", async t => {
  const f = fixture(t); let sends = 0;
  const invoke = async name => {
    if (name === GMAIL_PROFILE_TOOL) return { structuredContent: { email: "owner@gmail.com" } };
    sends++; return { content: [{ type: "text", text: "Action completed." }] };
  };
  await deliverConnectedGmailReport(f.home, invoke);
  assert.equal(f.store.read(f.id).delivery.state, "uncertain");
  await deliverConnectedGmailReport(f.home, invoke); assert.equal(sends, 1);
});

test("an unread task context cannot be misclassified as a broken Gmail connection", async t => {
  const f = fixture(t);
  const result = await deliverConnectedGmailReport(f.home, async () => ({ isError: true,
    content: [{ type: "text", text: JSON.stringify({ error: "Required context acknowledgement is incomplete; no work was executed." }) }] }));
  assert.equal(result.actionRequired, "read_required_context");
  assert.equal(f.store.read(f.id).delivery.state, "pending");
  assert.equal(fs.existsSync(path.join(f.store.directory, "gmail-paused.json")), false);
});

test("independent queue owners cannot deliver the same report twice", async t => {
  const f = fixture(t); let sends = 0;
  const invoke = async name => {
    if (name === GMAIL_PROFILE_TOOL) return { structuredContent: { email: "owner@gmail.com" } };
    sends++;
    await new Promise(resolve => setTimeout(resolve, 50));
    return { structuredContent: { id: "one_receipt", label_ids: ["SENT"] } };
  };
  await Promise.all([deliverConnectedGmailReport(f.home, invoke), deliverConnectedGmailReport(f.home, invoke)]);
  assert.equal(sends, 1); assert.equal(f.store.read(f.id).delivery.state, "sent");
});

test("choosing connected Gmail keeps existing reporting consent but disabling prevents all tool calls", async t => {
  const f = fixture(t); const before = f.store.settings().consentId;
  f.store.configure({ ...f.store.settings(), deliveryMethod: "smtp" });
  f.store.configure({ ...f.store.settings(), deliveryMethod: "gmail" });
  assert.equal(f.store.settings().consentId, before);
  f.store.configure({ ...f.store.settings(), enabled: false });
  await deliverConnectedGmailReport(f.home, async () => { throw new Error("must not be called"); });
  assert.equal(f.store.read(f.id).delivery.attempts, 0);
});

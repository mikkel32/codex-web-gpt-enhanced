const { ErrorReportStore, atomicJson, redact } = require("./error-report-store.cjs");
const { ReportDeliveryQueue } = require("./error-report-delivery.cjs");
const { formatIncidentEmail } = require("./error-report-email.cjs");

const { externalToolAccessCode } = require("./tool-access-error.cjs");

const GMAIL_PROFILE_TOOL = "mcp__codex_apps__gmail_get_profile";
const GMAIL_SEND_TOOL = "mcp__codex_apps__gmail_send_email";

function gmailObjects(value, depth = 0) {
  if (!value || typeof value !== "object" || depth > 6) return [];
  const nested = [value.structuredContent, value.result];
  for (const part of value.content || []) if (part.type === "text" && typeof part.text === "string") {
    try { nested.push(JSON.parse(part.text)); } catch {}
  }
  return [value, ...nested.flatMap(item => gmailObjects(item, depth + 1))];
}

function gmailAccessFailure(values) {
  if (!values.some(value => value.isError || value.error)) return undefined;
  for (const value of values) {
    const messages = [value.message, value.error, value.error?.message,
      ...(Array.isArray(value.content) ? value.content.filter(part => part.type === "text").map(part => part.text) : [])];
    for (const message of messages) {
      const code = externalToolAccessCode(message);
      if (code) return Object.assign(new Error(redact(message).slice(0, 4096)), { code });
    }
  }
  return undefined;
}

class ConnectedGmailReportSender {
  constructor(invoke, recipient) { this.invoke = invoke; this.recipient = recipient; this.deliveryMethod = "gmail"; this.ready = false; }
  configured() { return this.ready; }
  async prepare() {
    const values = gmailObjects(await this.invoke(GMAIL_PROFILE_TOOL, {}));
    if (values.some(item => typeof item.error === "string" && item.error.startsWith("Required context acknowledgement is incomplete"))) {
      throw Object.assign(new Error("Required task context must be acknowledged before Gmail delivery"), { code: "EREPORTCONTEXT" });
    }
    const accessFailure = gmailAccessFailure(values);
    if (accessFailure) throw accessFailure;
    const profile = values.find(item => typeof item.email === "string");
    if (values.some(item => item.isError) || !profile || profile.email.toLowerCase() !== this.recipient.toLowerCase()) {
      throw Object.assign(new Error("Connect Gmail using the same account as the report recipient; no email was attempted"), { code: "EREPORTCONFIG" });
    }
    this.ready = true;
  }
  async send(report) {
    if (!this.ready || report.recipient.toLowerCase() !== this.recipient.toLowerCase()) {
      throw Object.assign(new Error("Gmail account does not match the recipient"), { code: "EREPORTCONFIG" });
    }
    const message = formatIncidentEmail(report);
    const response = await this.invoke(GMAIL_SEND_TOOL, {
      to: report.recipient, subject: message.subject, response_fields: ["id", "label_ids"],
      payload: { mime_type: "multipart/mixed", parts: [
        { mime_type: "multipart/alternative", parts: [
          { mime_type: "text/plain", charset: "UTF-8", body: { content: message.text } },
          { mime_type: "text/html", charset: "UTF-8", body: { content: message.html } },
        ] },
        { mime_type: "application/json", filename: message.attachments[0].filename, content_disposition: "attachment",
          body: { base64_url_content: message.attachments[0].content.toString("base64url") } },
      ] },
    });
    const values = gmailObjects(response);
    const receipt = values.find(item => typeof item.id === "string" && item.id.length > 0
      && Array.isArray(item.label_ids) && item.label_ids.includes("SENT"));
    // A conflicting receipt remains uncertain; it is never eligible for an automatic resend.
    const accessFailure = !receipt && gmailAccessFailure(values);
    if (accessFailure) throw accessFailure;
    if (values.some(item => item.isError) || !receipt) {
      // A connector response without a message receipt is never an acknowledgement,
      // even if an outer exec cell itself completed successfully.
      throw Object.assign(new Error("Gmail did not provide a delivery receipt; do not resend automatically"), { code: "EDELIVERYUNKNOWN" });
    }
    return { accepted: true, messageId: receipt.id };
  }
}

async function deliverConnectedGmailReport(coreHome, invoke) {
  const store = new ErrorReportStore(coreHome);
  const settings = store.settings();
  if (!settings.enabled || settings.deliveryMethod !== "gmail") return { delivered: false, actionRequired: "select_connected_gmail" };
  const sender = new ConnectedGmailReportSender(invoke, settings.recipient);
  const queue = new ReportDeliveryQueue(store, sender);
  const eligible = report => report.consentId === settings.consentId && report.recipient === settings.recipient;
  if (queue.paused()) return { delivered: false, actionRequired: "resume_connected_gmail", message: "Gmail delivery is paused in Automatic error reports" };
  if (!store.records().some(report => eligible(report) && ["pending", "needs_sender"].includes(report.delivery.state))) {
    return { delivered: false, remaining: 0, message: "No eligible unsent reports" };
  }
  // Capability/account verification happens before claiming an incident or consuming a send attempt.
  try { await sender.prepare(); }
  catch (error) {
    if (error.code === "EREPORTCONTEXT") return { delivered: false, actionRequired: "read_required_context", message: error.message };
    const accessCode = externalToolAccessCode(error.message);
    const accessMessage = accessCode
      ? `Tool access was rejected (${accessCode}). No email was attempted. ${redact(error.message).slice(0, 4096)} Stop this attempt; a catalog refresh or account reconnection does not establish that the rejection has cleared.`
      : undefined;
    atomicJson(queue.pauseFile, { version: 1, pausedAt: Date.now(), ...(accessCode ? { accessCode } : {}) });
    for (const report of store.records()) if (eligible(report) && ["pending", "needs_sender"].includes(report.delivery.state)) {
      store.update(report, { state: "blocked", ...(accessCode ? { accessCode } : {}),
        reason: accessMessage || "Connected Gmail access requires attention; reconnect Gmail and resume delivery. No email was attempted." });
    }
    if (accessCode) return { delivered: false, emailAccepted: false, actionRequired: "review_tool_access",
      code: accessCode, retryable: false, message: accessMessage };
    return { delivered: false, actionRequired: "connect_gmail", message: "The matching Gmail connection is unavailable or rejected access. Reconnect Gmail and resume delivery in Automatic error reports. No email was attempted. Do not retry through a different tool or browser." };
  }
  const before = new Set(store.records().filter(report => report.delivery.state === "sent").map(report => report.id));
  await queue.drain({ immediate: true });
  const reports = store.records().filter(eligible);
  const pending = reports.filter(report => ["pending", "needs_sender"].includes(report.delivery.state));
  const sent = reports.find(report => report.delivery.state === "sent" && !before.has(report.id));
  return { delivered: Boolean(sent), ...(sent ? { reportId: sent.id, messageId: sent.delivery.messageId } : {}),
    remaining: pending.length,
    nextAttemptAt: pending.length ? Math.min(...pending.map(report => report.delivery.nextAttemptAt)) : null,
    needsAttention: reports.some(report => ["blocked", "uncertain", "failed"].includes(report.delivery.state)), inboxVerified: false };
}

module.exports = { GMAIL_PROFILE_TOOL, GMAIL_SEND_TOOL, ConnectedGmailReportSender, deliverConnectedGmailReport, gmailObjects };

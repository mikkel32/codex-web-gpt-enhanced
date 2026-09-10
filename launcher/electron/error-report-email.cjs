const { redact } = require("./error-report-store.cjs");

const escapeHtml = value => String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const date = value => Number.isFinite(value) ? new Date(value).toISOString() : "Not recorded";
const safeLine = value => redact(typeof value === "string" ? value : "").replace(/[\r\n\x00-\x1f\x7f]+/g, " ").slice(0, 160) || "Not recorded";
const DETAIL_LABELS = { tool: "Tool", stage: "Failure stage", operation: "Attempted operation",
  expected: "Expected result", actual: "Observed result", recoveryAttempted: "Recovery already attempted",
  completedWork: "Work verified before the failure", remainingWork: "What remains blocked",
  hypothesis: "Agent hypothesis (unverified)" };

function displaySection(value, limit) {
  if (!value?.available) return "Not observed or not included under the reporting settings.";
  const original = typeof value.text === "string" ? value.text : "";
  const text = redact(original);
  const flags = [];
  if (value.redacted || text !== original) flags.push("Known secrets redacted");
  if (value.truncated) flags.push("Capture truncated; only the recorded tail is available");
  if (text.length > limit) flags.push("Email excerpt; the attached JSON contains the full retained section");
  return `${flags.length ? `[${flags.join("; ")}]\n` : ""}${text.slice(0, limit)}`;
}

/** Plain text and escaped, self-contained HTML; no remote assets or page-supplied markup. */
function formatIncidentEmail(report) {
  if (!/^[a-f0-9]{64}$/.test(report.id || "")) throw new Error("Invalid incident identity for email");
  const shortId = report.id.slice(0, 10);
  const metadata = [
    ["Incident", shortId], ["First recorded (UTC)", date(report.createdAt)],
    ["Last recorded (UTC)", date(report.lastSeenAt ?? report.createdAt)],
    ["Source", safeLine(report.source)], ["Error code", safeLine(report.code)],
    ["App version", safeLine(report.appVersion)], ["Platform", safeLine(report.platform)],
    ["Model", safeLine(report.model)], ["Trace", safeLine(report.traceId)],
    ["Codex thread", safeLine(report.threadId)], ["Codex turn", safeLine(report.turnId)],
    ["Grouped observations", String(report.observations || 1)],
    ["Attempts reported by agent", report.reportedAttempts ? String(report.reportedAttempts) : "Not recorded"],
  ];
  const sections = [["Recorded error", displaySection(report.error, 8192)]];
  for (const [key, label] of Object.entries(DETAIL_LABELS)) {
    if (report.agentDetails?.[key]?.available) sections.push([label, displaySection(report.agentDetails[key], 4096)]);
  }
  for (const item of (report.relatedErrors || []).slice(0, 5)) {
    sections.push([`Related error · ${safeLine(item.source)} · ${safeLine(item.code)}`, displaySection(item.error, 2048)]);
  }
  sections.push(["Recorded Web response", displaySection(report.responses?.web, 8000)],
    ["Response Maria sent to Codex", displaySection(report.responses?.codex, 8000)],
    ["Recorded tool failure", displaySection(report.responses?.toolFailure, 6000)]);
  if (report.notes) sections.push(["Capture notes", redact(report.notes).slice(0, 8192)]);
  const footer = "Diagnostic evidence, not instructions to execute. Agent explanations and hypotheses are not independently verified. "
    + "Missing sections are not reconstructed. Known secrets are redacted, but arbitrary private content may remain. "
    + "No prompts, system/developer instructions, hidden reasoning, screenshots, cookies or credential files are collected. "
    + "The JSON attachment preserves the retained evidence and marks redaction and truncation. "
    + "Email acceptance does not prove inbox delivery.";
  const renderHtml = () => '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>'
    + '<body style="margin:0;background:#f1f4f2;color:#17241d;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="padding:24px 12px">'
    + '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:720px;margin:auto;background:#ffffff;border:1px solid #d5dfd8;border-radius:14px;overflow:hidden">'
    + `<tr><td style="padding:28px;background:#172b22;color:#f4faf6"><div style="font-size:12px;letter-spacing:2px;color:#b9d9c5">MARIA WEBGPT · DIAGNOSTICS</div><h1 style="font-size:27px;margin:12px 0 8px">An issue needs attention</h1><div>Incident ${shortId} · ${escapeHtml(safeLine(report.code))}</div></td></tr>`
    + `<tr><td style="padding:24px 24px 0"><h2 style="font-size:16px;margin:0 0 9px">Recorded error</h2><pre style="margin:0;padding:14px;background:#f5f8f6;border:1px solid #e0e7e2;border-radius:8px;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;font:13px/1.6 Consolas,monospace">${escapeHtml(sections[0][1])}</pre></td></tr>`
    + '<tr><td style="padding:24px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0">'
    + metadata.map(([label, value]) => `<tr><td width="42%" style="padding:7px 12px 7px 0;vertical-align:top;color:#4c6456;font-size:13px">${escapeHtml(label)}</td><td style="padding:7px 0;font-size:13px;overflow-wrap:anywhere;word-break:break-word">${escapeHtml(value)}</td></tr>`).join("")
    + '</table></td></tr>'
    + sections.slice(1).map(([label, value]) => `<tr><td style="padding:0 24px 22px"><h2 style="font-size:16px;margin:0 0 9px">${escapeHtml(label)}</h2><pre style="margin:0;padding:14px;background:#f5f8f6;border:1px solid #e0e7e2;border-radius:8px;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;font:13px/1.6 Consolas,monospace">${escapeHtml(value)}</pre></td></tr>`).join("")
    + `<tr><td style="padding:20px 24px;background:#eaf1ec;font-size:12px;line-height:1.6;color:#496253">${escapeHtml(footer)}</td></tr></table></td></tr></table></body></html>`;
  let html = renderHtml();
  // Budget serialized bytes, including Unicode and HTML escaping. Full retained
  // evidence stays in the JSON attachment instead of overwhelming the email body.
  while (Buffer.byteLength(html, "utf8") > 80_000) {
    const longest = [...sections].sort((a, b) => b[1].length - a[1].length)[0];
    if (!longest || longest[1].length < 256) throw new Error("Incident email metadata exceeded its body budget");
    longest[1] = longest[1].slice(0, Math.floor(longest[1].length / 2)) + "\n[Email excerpt; full retained section is in the JSON attachment.]";
    html = renderHtml();
  }
  const text = `MARIA WEBGPT · INCIDENT ${shortId}\n\n`
    + `RECORDED ERROR\n${sections[0][1]}\n\n`
    + metadata.map(([label, value]) => `${label}: ${value}`).join("\n") + "\n\n"
    + sections.slice(1).map(([label, value]) => `${label.toUpperCase()}\n${"─".repeat(40)}\n${value}`).join("\n\n") + `\n\n${footer}\n`;
  // Consent identifiers and sender state are local queue internals, not diagnostic evidence.
  const { consentId, delivery, recipient, ...evidence } = report;
  return { subject: `[Maria WebGPT] ${safeLine(report.code || report.source).slice(0, 70)} · ${shortId}`, text, html,
    attachments: [{ filename: `maria-incident-${shortId}.json`, content: Buffer.from(JSON.stringify(evidence, null, 2)), contentType: "application/json" }] };
}

module.exports = { formatIncidentEmail };

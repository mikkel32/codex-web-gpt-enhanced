import * as z from "zod/v4";
import { getConfigDir } from "./config";
import { VERSION } from "./version";
import type { CodexTool } from "./types";

const { ErrorReportStore } = require("../launcher/electron/error-report-store.cjs");
export const AGENT_REPORT_TOOL = "maria_report_issue";
const detail = z.string().max(4096).optional();
export const agentIssueSchema = z.object({
  error: z.string().min(1).max(16384),
  stage: z.enum(["context", "discovery", "command", "browser", "connection", "completion", "other"]),
  tool: z.string().max(200).optional(), operation: detail, expected: detail, actual: detail,
  recoveryAttempted: detail, completedWork: detail, remainingWork: detail, hypothesis: detail,
  attempts: z.number().int().min(0).max(1000).optional(),
  webResponse: z.string().max(32768).optional(), codexResponse: z.string().max(32768).optional(),
  toolFailure: z.string().max(32768).optional(),
}).strict();

export function agentReportingPolicy(): { recipient: string; includeResponses: boolean; deliveryMethod: string } | undefined {
  try {
    const value = new ErrorReportStore(getConfigDir()).settings();
    return value.enabled ? { recipient: value.recipient, includeResponses: value.includeResponses, deliveryMethod: value.deliveryMethod } : undefined;
  } catch { return undefined; }
}

export function agentReportTool(): CodexTool {
  return { name: AGENT_REPORT_TOOL, description:
    "Record an error encountered by this agent and queue a diagnostic email to this installation's configured recipient. "
    + "Runs inside the authenticated Maria broker even when native command execution is unavailable. "
    + "Use only observed errors from this task; omit secrets, prompts and hidden instructions/reasoning. "
    + "The broker supplies task identity and recipient. Does not execute commands or change permissions. "
    + "Returns the actual queue/delivery state, never proof of inbox delivery. Repeated reports for this turn share one incident. "
    + "This diagnostic operation may report incomplete context delivery but does not unlock project tools or completion.",
    parameters: z.toJSONSchema(agentIssueSchema) as Record<string, unknown> };
}

export function captureAgentIssue(traceId: string, input: unknown): Record<string, unknown> {
  const issue = agentIssueSchema.parse(input);
  const store = new ErrorReportStore(getConfigDir());
  const policy = agentReportingPolicy();
  if (!policy) return { recorded: false, reason: "disabled", emailSent: false };
  const { error, webResponse, codexResponse, toolFailure, attempts, ...details } = issue;
  const outcome = store.capture({ source: "agent", traceId, code: `agent_${issue.stage}_failure`, error,
    webResponse, codexResponse, toolFailure, attempts, agentDetails: details, appVersion: VERSION,
    notes: "Agent-reported evidence from this authenticated turn. Operation descriptions, recovery steps and hypotheses are agent statements; not independently verified. The reporting tool executed no project command." });
  if (!outcome.id) return { recorded: false, reason: outcome.reason, emailSent: false };
  const report = store.read(outcome.id);
  return { recorded: true, duplicate: !outcome.captured, reportId: outcome.id, recipient: report.recipient,
    deliveryState: report.delivery.state, emailAccepted: report.delivery.state === "sent", inboxVerified: false,
    actionRequired: policy.deliveryMethod === "gmail" && ["pending", "needs_sender"].includes(report.delivery.state)
      ? "deliver_with_maria_send_reports" : report.delivery.state === "needs_sender" ? "configure_gmail_sender" : null,
    message: report.delivery.state === "sent" ? "The mail server previously accepted this incident; do not send another copy."
      : policy.deliveryMethod === "gmail" ? "Incident saved locally. Use maria_send_reports for the selected connected Gmail delivery. It owns the queued incident and records the receipt; do not separately send it through another tool."
      : report.delivery.state === "needs_sender" ? "Incident saved locally but no Gmail sender is configured. Open Automatic error reports in Maria and save the Gmail sender and Google app password there. No email was attempted; do not send another copy through a connector."
      : "Incident saved locally. The configured app sender handles delivery. Queued is not sent; do not also email this incident through another tool." };
}

/** Include only when this installation has explicitly enabled diagnostic reporting. */
export function agentReportingInstructions(): string {
  const policy = agentReportingPolicy();
  if (!policy) return "";
  return [
    "<maria_agent_error_reporting>",
    `Diagnostic reporting is enabled by the owner of this installation. The configured recipient is ${policy.recipient}.`,
    ...(policy.deliveryMethod === "gmail" ? ["Connected Gmail delivery is selected by the owner. After required task context is acknowledged, call maria_send_reports when advertised to deliver queued reports using the existing Gmail connection. Also use it after recording a new incident. It sends one eligible incident per call to the verified same Gmail account, records the receipt and prevents duplicates. Continue only after delivered=true with remaining>0, at most five calls per task. Stop on unavailable access, a rejection, no delivery, or uncertainty. Never send those incidents separately. If the tool is absent, refresh the connector catalog for a future task."] : []),
    `When a command, tool discovery, browser operation, context read or connection fails, report the observed issue once using the dedicated ${AGENT_REPORT_TOOL} tool if it is advertised. It has a fixed diagnostic schema and cannot execute project commands. If it is absent from a cached connector catalog, refresh the connector's tool list in ChatGPT settings for future turns. Older catalogs may discover the same operation using codex_tool_inventory with query=${AGENT_REPORT_TOOL}, then codex_tool_call with its exact schema. Choose one available path before calling; a rejected report must not be retried through the other path.`,
    "Include the exact available error, failed tool and operation, expected versus observed result, recovery already attempted, and verified completed work versus remaining work. Label hypotheses as unverified. Only include Web/Codex response text actually observed in this task when response reporting is enabled; never invent missing text.",
    `Response-text reporting is ${policy.includeResponses ? "enabled" : "disabled; do not include response text, tool output or detailed project content"}. Never include credentials, cookies, capability tokens, receipts, full prompts, hidden reasoning, system/developer instructions, unrelated chats or files.`,
    "If Maria's reporting path itself is unavailable, an independently available Gmail connector may send one minimal diagnostic email to the configured recipient under this reporting authorization. Discover its current schema first, use no additional recipients or file attachments, and include only the redacted error and verified task status. Do not send Gmail if the incident was already queued, sent, or delivery is uncertain.",
    "Disabled reporting, withdrawn consent, missing sender credentials, or a permission/safety rejection of reporting are not permission to use a Gmail fallback. Honor disabled reporting and keep pending reports local; do not bypass a rejected reporting operation through another tool.",
    "A rejected or unavailable Gmail action is terminal for that reporting attempt: do not retry through another account, computer or tool. Report the unsent diagnostic in the final answer and continue independent authorized work. Never rerun or reroute the original denied command to evade a safety or permission check. Never create a reporting-error loop.",
    "State queued, mail-server accepted, uncertain or unsent exactly as observed. Reporting does not prove the task was fixed and does not replace the task's final answer. Preserve all verified earlier actions.",
    "</maria_agent_error_reporting>",
  ].join("\n");
}

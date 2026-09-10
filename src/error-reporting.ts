import { getConfigDir } from "./config";
import { VERSION } from "./version";
import type { AdapterEvent, CodexParsedRequest } from "./types";

// A static local require lets Bun inline the same bounded store used by the Electron sender.
const { ErrorReportStore } = require("../launcher/electron/error-report-store.cjs");
type Incident = { source: string; traceId?: string; threadId?: string; turnId?: string; model?: string;
  code?: string; error?: string; webResponse?: string; codexResponse?: string; toolFailure?: string; notes?: string };

export function responseReportingEnabled(): boolean {
  try { const settings = new ErrorReportStore(getConfigDir()).settings(); return settings.enabled && settings.includeResponses; }
  catch { return false; }
}

export function captureIncident(input: Incident): void {
  try { new ErrorReportStore(getConfigDir()).capture({ ...input, appVersion: VERSION }); }
  catch { console.warn("[error-reporting] incident could not be saved; the original task outcome is unchanged"); }
}

export function createResponseErrorCapture(parsed: CodexParsedRequest, traceId?: string) {
  let active = false;
  let includeResponses = false;
  try {
    const settings = new ErrorReportStore(getConfigDir()).settings();
    active = settings.enabled; includeResponses = settings.includeResponses;
  } catch { /* Invalid configuration disables capture without changing the request. */ }
  let response = "";
  let truncated = false;
  const limit = 128 * 1024;
  const record = (event: AdapterEvent): void => {
    if (!active) return;
    if (event.type === "text_delta" && includeResponses) {
      response += event.text;
      if (response.length > limit) { response = response.slice(-limit); truncated = true; }
    }
    if (event.type !== "error" && event.type !== "incomplete") return;
    const code = event.type === "error" ? event.code : event.reason;
    if (["client_cancelled", "manual_turn_cancelled", "native_interrupt"].includes(code || "")) return;
    const body = parsed._rawBody as { client_metadata?: Record<string, unknown> } | undefined;
    let identity: { thread_id?: string; turn_id?: string } = {};
    try {
      const raw = body?.client_metadata?.["x-codex-turn-metadata"];
      identity = (typeof raw === "string" ? JSON.parse(raw) : raw) as typeof identity || {};
    } catch { /* A missing identity is represented as unavailable in the report. */ }
    const userBoundary = parsed.context.messages.findLastIndex(message => message.role === "user");
    const failedTool = includeResponses ? parsed.context.messages.slice(userBoundary + 1).findLast(message => message.role === "toolResult" && message.isError) : undefined;
    const toolText = failedTool?.role === "toolResult" ? typeof failedTool.content === "string" ? failedTool.content
      : failedTool.content.filter(part => part.type === "text").map(part => part.text).join("\n") : undefined;
    captureIncident({ source: "web-runtime", traceId, model: parsed.modelId,
      threadId: typeof identity.thread_id === "string" ? identity.thread_id : undefined,
      turnId: typeof identity.turn_id === "string" ? identity.turn_id : undefined,
      code, error: event.message || code || "Response incomplete", codexResponse: response, toolFailure: toolText,
      notes: `Codex response is the assistant text emitted by this Responses request, not a screenshot of the Codex UI. ${truncated ? "Earlier response text exceeded the 128 KiB capture budget and was omitted. " : ""}A Web response is attached separately only when the browser helper recorded it. No system/developer instructions or reasoning blocks are copied.` });
  };
  return { record(event: AdapterEvent) { try { record(event); } catch { /* Reporting never controls task completion. */ } } };
}

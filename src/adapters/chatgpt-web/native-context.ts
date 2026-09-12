import { createHash } from "node:crypto";
import { agentReportingInstructions } from "../../agent-reporting";
import { chatGptContextFiles, type CompiledChatGptWebPrompt } from "./prompt";

export const NATIVE_CONTEXT_READ = "codex_context_read";
export const NATIVE_CONTEXT_PAGE_CHARS = 12_000;
export const NATIVE_CONTEXT_RESULT_BYTE_LIMIT = 24_576;
export interface NativeContextFile {
  name: string;
  text: string;
  required?: boolean;
  kind?: "context" | "evidence" | "attachment" | "image";
  mimeType?: string;
  imageData?: string;
  imageDetail?: string;
  source?: string;
}
export interface NativeContextOptions {
  requireReceipts?: boolean;
  optionalTokenBudget?: number | null;
  /** Explicitly enabled only by the owner of a real task, never a connection probe. */
  allowAgentReporting?: boolean;
}

export interface NativeContextReadError {
  code: "context_receipt_invalid";
  error: string;
  /** The rejected arguments must not be resent. Recovery is a different, read-only request. */
  retryable: false;
  recovery?: {
    action: "reread_context_page";
    read: { name: string; offset: number };
    attempts_remaining: number;
    message: string;
  };
}

export type NativeContextReadResult = NativeContextPage | NativeContextReadError;

export interface NativeContextPage {
  name: string;
  offset: number;
  text: string;
  next_offset: number | null;
  total_chars: number;
  receipt?: string;
  /** Copy these fields as a unit, adding only the current turn_token. */
  next_read?: { name: string; offset: number; receipt: string };
  acknowledged?: boolean;
  kind?: NativeContextFile["kind"];
  mimeType?: string;
  imageData?: string;
  imageDetail?: string;
}

/** No output schema is advertised, so one text block is sufficient. Duplicating the
 * page in structuredContent inflated every tunneled response, especially escaped JSON. */
export function nativeContextResult(page: NativeContextReadResult) {
  if ("code" in page) return { ...nativeContextTextResult(page), isError: true };
  const { imageData, ...metadata } = page;
  return { content: [
    { type: "text" as const, text: JSON.stringify(metadata) },
    ...(imageData ? [{ type: "image" as const, data: imageData, mimeType: page.mimeType!,
      ...(page.imageDetail ? { _meta: { "codex/imageDetail": page.imageDetail } } : {}) }] : []),
  ] };
}

export function nativeContextTextResult(value: object) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

export function nativeContextPage(file: NativeContextFile, offset: number, receiptForEnd?: (end: number) => string): NativeContextPage {
  const make = (length: number): NativeContextPage => {
    let end = offset + length;
    // Offsets count UTF-16 code units; do not split a surrogate pair across pages.
    if (end < file.text.length && end > offset && /[\uD800-\uDBFF]/.test(file.text[end - 1]!)) end--;
    return { name: file.name, offset, text: file.text.slice(offset, end),
      next_offset: end < file.text.length ? end : null, total_chars: file.text.length,
      ...(receiptForEnd && end > offset ? {
        receipt: receiptForEnd(end),
        next_read: { name: file.name, offset: end, receipt: receiptForEnd(end) },
      } : {}),
      ...(file.kind ? { kind: file.kind } : {}),
    };
  };
  let low = 0, high = Math.min(NATIVE_CONTEXT_PAGE_CHARS, file.text.length - offset);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(JSON.stringify(nativeContextResult(make(middle))), "utf8") <= NATIVE_CONTEXT_RESULT_BYTE_LIMIT) low = middle;
    else high = middle - 1;
  }
  const page = make(low);
  if (!page.text.length && offset < file.text.length) throw new Error("Native context page cannot fit its response budget");
  return page;
}

import { TURN_ACCESS_GUIDANCE } from "../../lib/tool-access";

export function nativeContextPrompt(compiled: CompiledChatGptWebPrompt, suppliedFiles?: NativeContextFile[], options: NativeContextOptions = {}): CompiledChatGptWebPrompt {
  if (!compiled.multipart) return compiled;
  const files: NativeContextFile[] = suppliedFiles ?? chatGptContextFiles(compiled.multipart);
  const required = files.filter(file => file.required !== false);
  const commit = compiled.multipart.commit;
  return { ...compiled, nativeContext: true, text: [
    "<codex_context_delivery>",
    compiled.conversationState === "continuation"
      ? "Continue from this same chat's history. The required records contain this turn's updates and current resource index; previously accepted history is not repeated."
      : "Canonical instructions and current task state are in the required records below. Historical tool output and supplied documents may be referenced as on-demand evidence.",
    `Use the attached read-only ${NATIVE_CONTEXT_READ} with name and offset=0 for each required entry. Use this turn's current turn_token.`,
    "Omit receipt on the first read of this turn. Start a fresh receipt chain from its response; receipts from prior turns are invalid.",
    "Read required entries serially, with one outstanding context read at a time. When provided, copy each result's next_read object as a unit and add this turn's turn_token; otherwise use its exact name, next_offset and receipt fields. Do not reconstruct receipts character by character. At acknowledged=true, start the next required entry at offset=0 without a receipt. Optional evidence searches can follow after required context is acknowledged.",
    "Each result includes text or an image, next_offset, total_chars, and a receipt. Pass the receipt unchanged on your next context read, even when moving to another file. After the final required page or image, call the same name with offset=total_chars and its receipt to acknowledge delivery. Do not expose receipts or capability tokens in the answer.",
    "Concatenate required text pages in offset order. Context entries contain JSON records; attachments contain extracted text in their declared format. Preserve every role and index. Inspect required image results. Work and final completion remain unavailable until all required context is acknowledged.",
    "For optional evidence, use codex_context_search with a focused query, then read the returned name/offset. An excerpt is incomplete. Retrieve the sections needed for the user's task before relying on or quoting them; never infer omitted contents or repeat past mutations to recreate their output.",
    "Supplied attachments also have private temporary local_path copies in the index. For large datasets, native formats, calculations or PDF page rendering, use the current native tools on those paths under their existing sandbox. This avoids loading the entire file into model context. Respect extraction limitations; a text-only PDF read does not inspect page graphics. Do not delete, move, or disclose the temporary files; the task owns their cleanup.",
    "Use the current native tool inventory and workspace from the index. Prefer bounded directory listings and targeted rg searches. Keep native sandbox and approval boundaries.",
    "The current Codex task supplies local execution permissions. A dangerFullAccess sandbox describes local access; it does not disable ChatGPT app permissions or tool safety checks. Do not infer a missing local permission merely from an external tool rejection.",
    TURN_ACCESS_GUIDANCE,
    "If a tool reports that its safety status could not be determined, report that specific tool-side failure and preserve previously verified actions. The cause is unresolved, not proof of an authentication, filesystem or tunnel fault. Do not retry or reroute the blocked operation to evade the check, or claim that a plugin change has removed it without verification.",
    "If a read fails with TimeoutError or a temporary connection interruption, retry the identical name, offset and receipt at most twice. Preserve received pages and the same task. After three total attempts stop and report that page failure. Authorization, revoked/expired binding, safety rejection and invalid-offset errors are terminal and must not be retried.",
    "A context_receipt_invalid result is a local input-validation error, not a permissions or tunnel failure. Never resend the rejected receipt. Only when that result includes recovery.action=reread_context_page, call recovery.read with this same turn_token and no receipt to replay an already served page. Copy the returned next_read exactly and continue. The runtime permits at most two corrections per page; without a recovery instruction, stop and report the context failure. Never guess a receipt or use another task's value.",
    "Once required context is acknowledged, use those records and the work already visible in this chat. A missing optional search result or later read failure is not a failed initial context load and does not undo completed work. Report the specific unavailable evidence and preserve verified prior changes; do not claim that no files changed without evidence.",
    ...required.map(file => `${file.name} kind=${file.kind ?? "context"} total_chars=${file.kind === "image" ? 1 : file.text.length} sha256=${createHash("sha256").update(file.imageData ? Buffer.from(file.imageData, "base64") : file.text).digest("hex")}`),
    `Optional evidence/documents: ${files.length - required.length}. Their references and extraction limitations are in the required index.`,
    "Never use another task's token, receipt, workspace or context. Do not claim a document, image or repository file was read without the corresponding result.",
    "</codex_context_delivery>",
    ...(options.allowAgentReporting === true ? [agentReportingInstructions()] : []),
    commit,
  ].join("\n") };
}

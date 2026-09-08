import { createHash } from "node:crypto";
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
export interface NativeContextOptions { requireReceipts?: boolean; optionalTokenBudget?: number }

export interface NativeContextPage {
  name: string;
  offset: number;
  text: string;
  next_offset: number | null;
  total_chars: number;
  receipt?: string;
  acknowledged?: boolean;
  kind?: NativeContextFile["kind"];
  mimeType?: string;
  imageData?: string;
  imageDetail?: string;
}

/** No output schema is advertised, so one text block is sufficient. Duplicating the
 * page in structuredContent inflated every tunneled response, especially escaped JSON. */
export function nativeContextResult(page: NativeContextPage) {
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
      ...(receiptForEnd && end > offset ? { receipt: receiptForEnd(end) } : {}),
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

export function nativeContextPrompt(compiled: CompiledChatGptWebPrompt, suppliedFiles?: NativeContextFile[]): CompiledChatGptWebPrompt {
  if (!compiled.multipart) return compiled;
  const files: NativeContextFile[] = suppliedFiles ?? chatGptContextFiles(compiled.multipart);
  const required = files.filter(file => file.required !== false);
  const commit = compiled.multipart.commit;
  return { ...compiled, nativeContext: true, text: [
    "<codex_context_delivery>",
    "Canonical instructions and task state are in the required records below. Historical tool output and supplied documents may be referenced as on-demand evidence. No context document uploads are needed.",
    `Use the attached read-only ${NATIVE_CONTEXT_READ} with name and offset=0 for each required entry. Use this turn's current turn_token.`,
    "Omit receipt on the first read of this turn. Start a fresh receipt chain from its response; receipts from prior turns are invalid.",
    "Read required entries serially, with one outstanding context read at a time, so receipts form one chain. Optional evidence searches can follow after required context is acknowledged.",
    "Each result includes text or an image, next_offset, total_chars, and a receipt. Pass the receipt unchanged on your next context read, even when moving to another file. After the final required page or image, call the same name with offset=total_chars and its receipt to acknowledge delivery. Do not expose receipts or capability tokens in the answer.",
    "Concatenate required text pages in offset order. Context entries contain JSON records; attachments contain extracted text in their declared format. Preserve every role and index. Inspect required image results. Work and final completion remain unavailable until all required context is acknowledged.",
    "For optional evidence, use codex_context_search with a focused query, then read the returned name/offset. An excerpt is incomplete. Retrieve the sections needed for the user's task before relying on or quoting them; never infer omitted contents or repeat past mutations to recreate their output.",
    "Supplied attachments also have private temporary local_path copies in the index. For large datasets, native formats, calculations or PDF page rendering, use the current native tools on those paths under their existing sandbox. This avoids loading the entire file into model context. Respect extraction limitations; a text-only PDF read does not inspect page graphics. Do not delete, move, or disclose the temporary files; the task owns their cleanup.",
    "For repository work, use the current native tool inventory and workspace from the index. Inspect applicable AGENTS.md, relevant README/build files and requested paths when not already known. Prefer bounded directory listings and targeted rg searches over reading the entire tree. Keep native sandbox and approval boundaries.",
    "If a read fails with TimeoutError or a temporary connection interruption, retry the identical name, offset and receipt at most twice. Preserve received pages and the same task. After three total attempts stop and report that page failure. Authorization, revoked/expired binding, safety rejection, invalid-offset and invalid-receipt errors are terminal and must not be retried.",
    ...required.map(file => `${file.name} kind=${file.kind ?? "context"} total_chars=${file.kind === "image" ? 1 : file.text.length} sha256=${createHash("sha256").update(file.imageData ? Buffer.from(file.imageData, "base64") : file.text).digest("hex")}`),
    `Optional evidence/documents: ${files.length - required.length}. Their references and extraction limitations are in the required index.`,
    "Never use another task's token, receipt, workspace or context. Do not claim a document, image or repository file was read without the corresponding result.",
    "</codex_context_delivery>",
    commit,
  ].join("\n") };
}

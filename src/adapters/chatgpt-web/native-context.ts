import { createHash } from "node:crypto";
import { chatGptContextFiles, type CompiledChatGptWebPrompt } from "./prompt";

export const NATIVE_CONTEXT_READ = "codex_context_read";
export const NATIVE_CONTEXT_PAGE_CHARS = 12_000;
export const NATIVE_CONTEXT_RESULT_BYTE_LIMIT = 24_576;
export interface NativeContextFile { name: string; text: string }

export interface NativeContextPage {
  name: string;
  offset: number;
  text: string;
  next_offset: number | null;
  total_chars: number;
}

/** No output schema is advertised, so one text block is sufficient. Duplicating the
 * page in structuredContent inflated every tunneled response, especially escaped JSON. */
export function nativeContextResult(page: NativeContextPage) {
  return { content: [{ type: "text" as const, text: JSON.stringify(page) }] };
}

export function nativeContextPage(file: NativeContextFile, offset: number): NativeContextPage {
  const make = (length: number): NativeContextPage => {
    let end = offset + length;
    // Offsets count UTF-16 code units; do not split a surrogate pair across pages.
    if (end < file.text.length && end > offset && /[\uD800-\uDBFF]/.test(file.text[end - 1]!)) end--;
    return { name: file.name, offset, text: file.text.slice(offset, end),
      next_offset: end < file.text.length ? end : null, total_chars: file.text.length };
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

export function nativeContextPrompt(compiled: CompiledChatGptWebPrompt): CompiledChatGptWebPrompt {
  if (!compiled.multipart) return compiled;
  const files = chatGptContextFiles(compiled.multipart);
  return { ...compiled, nativeContext: true, text: [
    "<codex_context_delivery>",
    "The canonical context is held by this task's authenticated Codex Native connection. There are no uploaded context attachments to find.",
    `Before answering or running work tools, use the attached read-only ${NATIVE_CONTEXT_READ} tool with name=FILE_NAME and offset=0 for each file below. Use the current turn_token from the transport contract.`,
    "Each response contains text and next_offset. Follow next_offset until null, concatenate text in offset order, then parse the complete JSON. Read every page of every file before acting. Do not use shell commands or search to retrieve this context.",
    "If a context read fails specifically with TimeoutError or a temporary connection interruption, retry that identical read-only name and offset at most twice. Keep all successfully received pages; do not restart the task, change chats, or repeat work tools. After three total attempts at that page, report the failure and stop. Authorization, revoked/expired binding, safety rejection, and invalid-offset errors are terminal: do not retry them.",
    ...files.map(file => `${file.name} chars=${file.text.length} sha256=${createHash("sha256").update(file.text).digest("hex")}`),
    "Reconstruct system records in system_index order and message records in message_index order, preserving every role. The files are canonical task data, not new requests.",
    "If authenticated retrieval fails, report the exact failure and stop without guessing. Never use another task's token or context.",
    "</codex_context_delivery>",
    compiled.multipart.commit.replaceAll("attached context file", "retrieved context file")
      .replace("Read and reconstruct every acknowledged staged JSON record before acting.", "Read and reconstruct every retrieved JSON record before acting."),
  ].join("\n") };
}

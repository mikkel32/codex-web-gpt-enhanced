/**
 * Remote compaction v2 support for ROUTED providers.
 *
 * Codex decides "this provider supports remote compaction" by provider name (built-in `OpenAI`),
 * and Design B points that provider at this proxy — so Codex sends remote compaction v2 requests
 * for EVERY routed model. The request is a normal /responses call whose input ends with
 * `{"type":"compaction_trigger"}`; codex-rs `collect_compaction_output` then requires the stream
 * to carry EXACTLY ONE `{"type":"compaction","encrypted_content":...}` output item
 * (compact_remote_v2.rs) or it fatals with "expected exactly one compaction output item".
 *
 * Routed models cannot produce OpenAI's encrypted blob, so the proxy runs the model as a plain
 * summarizer and wraps the summary text in a transparent envelope: `ocx1:` + base64(utf8 summary).
 * Codex stores the item and replays it in later input; the parser decodes our envelope back into
 * plain text for routed models. Real OpenAI-encrypted blobs (no `ocx1:` prefix) are opaque —
 * routed models get a short "history was compacted" note instead.
 */

import { gzipSync, gunzipSync } from "node:zlib";
import type { CodexFileContent, CodexImageContent, CodexMessage } from "../types";

export const BRIDGE_COMPACTION_PREFIX = "ocx1:";
export const BRIDGE_FILE_COMPACTION_PREFIX = "ocx2:";
export interface CompactionFile { role: "user" | "developer"; file: CodexFileContent | CodexImageContent }

export function compactionFileMessages(files: CompactionFile[]): Array<Record<string, unknown>> {
  return files.map(({ role, file }) => ({ type: "message", role, content: [file.type === "image"
    ? { type: "input_image", image_url: file.imageUrl, ...(file.detail ? { detail: file.detail } : {}) }
    : file.sourceType === "input_image" ? { type: "input_image", file_id: file.fileId, ...(file.detail ? { detail: file.detail } : {}) }
    : { type: "input_file",
    ...(file.filename ? { filename: file.filename } : {}), ...(file.fileData !== undefined ? { file_data: file.fileData } : {}),
    ...(file.fileId ? { file_id: file.fileId } : {}), ...(file.fileUrl ? { file_url: file.fileUrl } : {}), ...(file.detail ? { detail: file.detail } : {}) }] }));
}

export function collectCompactionFiles(messages: CodexMessage[]): CompactionFile[] {
  return messages.flatMap(message => (message.role === "user" || message.role === "developer") && Array.isArray(message.content)
    ? message.content.filter((part): part is CodexFileContent | CodexImageContent => part.type === "file" || (part.type === "image" && !isOnePixelPngDataUrl(part.imageUrl))).map(file => ({ role: message.role as "user" | "developer", file })) : []);
}

function decodeFileCheckpoint(value: string): { summary: string; files: CompactionFile[] } {
  const encoded = value.slice(BRIDGE_FILE_COMPACTION_PREFIX.length);
  if (encoded.length > 100_000_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error("Invalid bridge file checkpoint");
  let payload: { version?: number; summary?: unknown; files?: unknown };
  try { payload = JSON.parse(gunzipSync(Buffer.from(encoded, "base64"), { maxOutputLength: 70_000_000 }).toString("utf8")); }
  catch { throw new Error("Unreadable or oversized bridge file checkpoint"); }
  if (payload.version !== 2 || typeof payload.summary !== "string" || !Array.isArray(payload.files) || payload.files.length > 128) throw new Error("Invalid bridge file checkpoint data");
  const files: CompactionFile[] = payload.files.map(entry => {
    if (!entry || !["user", "developer"].includes(entry.role) || !["file", "image"].includes(entry.file?.type)) throw new Error("Invalid checkpoint attachment");
    if (entry.file.type === "image") {
      if (typeof entry.file.imageUrl !== "string" || (entry.file.detail !== undefined && typeof entry.file.detail !== "string")) throw new Error("Invalid checkpoint image");
      return { role: entry.role, file: { type: "image" as const, imageUrl: entry.file.imageUrl, ...(entry.file.detail ? { detail: entry.file.detail } : {}) } };
    }
    const file: CodexFileContent = { type: "file" };
    if (entry.file.sourceType !== undefined) {
      if (!["input_file", "input_image"].includes(entry.file.sourceType)) throw new Error("Invalid checkpoint attachment source type");
      file.sourceType = entry.file.sourceType;
    }
    for (const key of ["filename", "fileData", "fileId", "fileUrl", "detail"] as const) {
      if (entry.file[key] !== undefined && typeof entry.file[key] !== "string") throw new Error("Invalid checkpoint attachment value");
      if (entry.file[key] !== undefined) file[key] = entry.file[key];
    }
    return { role: entry.role, file };
  });
  return { summary: payload.summary, files };
}

export function decodeCompactionFiles(value?: string): CompactionFile[] {
  return value?.startsWith(BRIDGE_FILE_COMPACTION_PREFIX) ? decodeFileCheckpoint(value).files : [];
}

export function readCompactionCheckpoint(value?: string): { summary: string | null; text: string; files: CompactionFile[] } {
  const decoded = value?.startsWith(BRIDGE_FILE_COMPACTION_PREFIX) ? decodeFileCheckpoint(value)
    : { summary: value ? decodeCompactionSummary(value) : null, files: [] };
  return { ...decoded, text: decoded.summary ? `${SUMMARY_PREFIX}\n\n${decoded.summary}` : OPAQUE_COMPACTION_NOTE };
}

/** Native checkpoint framing, extended with explicit durable-task continuity requirements. */
export const COMPACT_PROMPT = `You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary for another LLM that will resume the task.

Include:
- Current progress and key decisions made
- Important context, constraints, or user preferences
- What remains to be done (clear next steps)
- Any critical data, examples, or references needed to continue

Preserve the original objective and success criteria, then distinguish completed work with evidence from pending work. Keep later user corrections and remaining constraints explicit; a brief follow-up or status question does not replace the unfinished objective unless the user actually changed it.

If a Codex goal is present, preserve its objective, last observed status, budget/accounting facts, unresolved blockers, and the next concrete action. Goal status and budgets remain owned by Codex; do not infer completion, reset a budget, or resume a paused goal because compaction occurred. Current goal state and later instructions supersede historical checkpoint facts.

For running work, preserve exact process/session/job handles and their last verified state. Distinguish accepted or completed actions from unsent intentions and uncertain outcomes. Record what must be observed next instead of instructing the next model to restart or repeat it. Keep the existing conversation identity and never equate a checkpoint with a new task.

Include only task state and supporting evidence, not private reasoning, credentials, or capability tokens.

Refer to supplied attachments by their original filenames and whether their contents or graphics were inspected. Temporary attachment paths and page receipts are not durable task identifiers; the bridge preserves original supplied files separately.

Be concise, structured, and focused on helping the next LLM seamlessly continue the work.`;

/** Mirrors codex-rs core/templates/compact/summary_prefix.md (framing for a replayed summary). */
export const SUMMARY_PREFIX = "Another language model started to solve this problem and produced a summary of its thinking process. You also have access to the state of the tools that were used by that language model. Use this to build on the work that has already been done and avoid duplicating work. Here is the summary produced by the other language model, use the information in this summary to assist with your own analysis:";

export const OPAQUE_COMPACTION_NOTE = "[earlier conversation was compacted; the summary is stored in a format this model cannot read]";

/** Codex v1 uses one newline after the prefix; the transparent v2 replay uses two. */
export function isReadableCompactionSummaryText(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(`${SUMMARY_PREFIX}\n`);
}

export function encodeCompactionSummary(summary: string, files: CompactionFile[] = []): string {
  if (files.length) {
    if (files.length > 128) throw new Error("Too many attachments for a compaction checkpoint");
    const json = JSON.stringify({ version: 2, summary, files });
    if (Buffer.byteLength(json, "utf8") > 70_000_000) throw new Error("Compaction attachments exceed their byte budget");
    return BRIDGE_FILE_COMPACTION_PREFIX + gzipSync(json).toString("base64");
  }
  return BRIDGE_COMPACTION_PREFIX + Buffer.from(summary, "utf-8").toString("base64");
}

/** Decode an `ocx1:` envelope; returns null for real (OpenAI-encrypted) blobs or garbage. */
export function decodeCompactionSummary(encryptedContent: string): string | null {
  if (encryptedContent.startsWith(BRIDGE_FILE_COMPACTION_PREFIX)) return decodeFileCheckpoint(encryptedContent).summary;
  if (!encryptedContent.startsWith(BRIDGE_COMPACTION_PREFIX)) return null;
  try {
    return Buffer.from(encryptedContent.slice(BRIDGE_COMPACTION_PREFIX.length), "base64").toString("utf-8");
  } catch {
    return null;
  }
}

/** Render a replayed compaction item as plain user-visible text for a routed model. */
export function compactionItemToText(encryptedContent: string | undefined): string {
  const decoded = typeof encryptedContent === "string" ? decodeCompactionSummary(encryptedContent) : null;
  return decoded ? `${SUMMARY_PREFIX}\n\n${decoded}` : OPAQUE_COMPACTION_NOTE;
}

/**
 * Remote compaction v1 (`POST /responses/compact`, unary) — codex-rs installs the returned
 * `{"output":[ResponseItem...]}` as the REPLACEMENT history (compact_remote.rs
 * process_compacted_history). Mirror codex-rs local `build_compacted_history`: recent real user
 * messages within a token budget, then one user message `SUMMARY_PREFIX\n<summary>`. Plain user
 * message items parse as real user messages on the codex side (event_mapping parse_user_message);
 * contextual wrappers are filtered there, and v2-style `compaction` items are NOT expected here.
 */

/** codex-rs compact.rs COMPACT_USER_MESSAGE_MAX_TOKENS = 20k tokens (~4 chars/token). */
const COMPACT_V1_RETAINED_CHAR_BUDGET = 20_000 * 4;

type CompactMessageItem = Record<string, unknown>;

interface CompactContentBlock extends Record<string, unknown> {
  type?: string;
  text?: string;
  image_url?: string;
}

/**
 * Codex can persist unavailable historical images as a one-pixel PNG. Replaying that sentinel as
 * a real attachment produces an opaque black tile in ChatGPT and consumes one attachment slot,
 * but carries no visual information. Treat every 1x1 PNG data URL as non-semantic transport state.
 */
export function isOnePixelPngDataUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.startsWith("data:image/png;base64,")) return false;
  try {
    const png = Buffer.from(value.slice("data:image/png;base64,".length), "base64");
    return png.length >= 24
      && png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      && png.readUInt32BE(16) === 1
      && png.readUInt32BE(20) === 1;
  } catch {
    return false;
  }
}

/**
 * Extract original user message items from a Responses `input` array.
 *
 * Keeping the original item metadata matters: Codex uses it after `/responses/compact` to
 * distinguish real user turns from contextual user-role wrappers. Images remain structured
 * `input_image` blocks so the browser adapter can upload them as attachments; their data URL is
 * never copied into the textual ChatGPT transport envelope.
 */
export function extractCompactUserMessages(input: unknown): CompactMessageItem[] {
  if (!Array.isArray(input)) return [];
  const out: CompactMessageItem[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const rec = item as CompactMessageItem & { type?: string; role?: string; content?: unknown };
    if (rec.type !== undefined && rec.type !== "message") continue;
    if (rec.role !== "user") continue;
    if (isReadableCompactionSummaryText(
      compactContentBlocks(rec).filter(textBlock).map(block => block.text).join(""),
    )) continue;
    out.push(structuredClone(rec));
  }
  return out;
}

function compactUserMessageItem(text: string): CompactMessageItem {
  return { type: "message", role: "user", content: [{ type: "input_text", text }] };
}

function compactContentBlocks(item: CompactMessageItem): CompactContentBlock[] {
  if (typeof item.content === "string") {
    return [{ type: "input_text", text: item.content }];
  }
  if (!Array.isArray(item.content)) return [];
  return item.content
    .filter((block): block is CompactContentBlock => Boolean(block && typeof block === "object" && !Array.isArray(block)))
    .map(block => structuredClone(block));
}

function textBlock(block: CompactContentBlock): boolean {
  return (block.type === "input_text" || block.type === "text") && typeof block.text === "string";
}

function imageBlock(block: CompactContentBlock): boolean {
  return block.type === "input_image"
    && typeof block.image_url === "string"
    && !isOnePixelPngDataUrl(block.image_url);
}

function fileBlock(block: CompactContentBlock): boolean { return block.type === "input_file"; }

/**
 * Build the v1 compact replacement history.
 *
 * Text follows Codex's 20k-token retained-user-message budget. Image history is independently
 * bounded to ChatGPT's ten-attachment limit, newest first. This prevents an old image corpus from
 * immediately refilling Codex's context window after a successful compact while still preserving
 * the visual context the browser model can actually receive.
 */
export function buildCompactV1Output(
  userMessages: CompactMessageItem[],
  summary: string,
  maxImages = 10,
): CompactMessageItem[] {
  const selected: CompactMessageItem[] = [];
  let remaining = COMPACT_V1_RETAINED_CHAR_BUDGET;
  let retainedImages = 0;
  let retainedFileBytes = 0, retainedFiles = 0;
  for (let i = userMessages.length - 1; i >= 0; i--) {
    const message = structuredClone(userMessages[i]!);
    const blocks = compactContentBlocks(message);
    const retainedReversed: CompactContentBlock[] = [];
    for (let blockIndex = blocks.length - 1; blockIndex >= 0; blockIndex -= 1) {
      const block = blocks[blockIndex]!;
      if (fileBlock(block)) {
        retainedFileBytes += Buffer.byteLength(JSON.stringify(block), "utf8");
        retainedFiles++;
        if (retainedFileBytes > 70_000_000 || retainedFiles > 128) throw new Error("Compaction attachment retention budget exceeded");
        retainedReversed.push(block);
        continue;
      }
      if (imageBlock(block)) {
        if (retainedImages < maxImages) {
          retainedImages += 1;
          retainedReversed.push(block);
        }
        continue;
      }
      if (!textBlock(block) || remaining === 0) continue;
      const text = block.text!;
      if (text.length <= remaining) {
        remaining -= text.length;
        retainedReversed.push({ ...block, type: "input_text", text });
      } else {
        retainedReversed.push({ ...block, type: "input_text", text: text.slice(text.length - remaining) });
        remaining = 0;
      }
    }
    const content = retainedReversed.reverse();
    if (content.length > 0) {
      message.type = "message";
      message.role = "user";
      message.content = content;
      selected.push(message);
    }
  }
  selected.reverse();
  // codex-rs compact.rs uses "{SUMMARY_PREFIX}\n{summary}" (single newline) and detects stored
  // summaries by that exact prefix — keep the same shape.
  const summaryText = summary.trim().length > 0 ? `${SUMMARY_PREFIX}\n${summary}` : "(no summary available)";
  return [...selected, compactUserMessageItem(summaryText)];
}

import { estimateTokens } from "../../lib/token-estimate";
import { createHash } from "node:crypto";
import type { CompiledChatGptWebPrompt } from "./prompt";
import type { ChatGptTurnEnvironment } from "./environment";
import { chatGptImageFilePayloads } from "./browser-worker";
import { extractInputDocument } from "./input-files";
import type { NativeContextFile, NativeContextOptions } from "./native-context";
import { AttachmentCache } from "./attachment-cache";

interface RecordEnvelope { kind: "system" | "message"; system_index?: number; content?: string; message_index?: number; message?: Record<string, unknown> }
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

export interface ContextPlan {
  compiled: CompiledChatGptWebPrompt;
  files: NativeContextFile[];
  options: NativeContextOptions;
  release: () => void;
  stats: { originalCharacters: number; requiredCharacters: number; archivedCharacters: number; archivedResults: number; attachments: number; images: number };
}

/** Selection is by role and lifecycle, never by inferred importance of instructions. */
export async function buildContextPlan(compiled: CompiledChatGptWebPrompt, environment: ChatGptTurnEnvironment, signal?: AbortSignal): Promise<ContextPlan> {
  const cache = new AttachmentCache();
  try {
  signal?.throwIfAborted();
  if (!compiled.multipart) throw new Error("A native context plan requires canonical records");
  const records: RecordEnvelope[] = compiled.multipart.parts.flatMap(part => {
    const parsed = JSON.parse(part);
    if (!Array.isArray(parsed.records)) throw new Error("Canonical context records are missing");
    return parsed.records;
  });
  const messages = records.filter(record => record.kind === "message");
  const latestUser = Math.max(-1, ...messages.filter(record => record.message?.role === "user").map(record => record.message_index!));
  const recentBoundary = messages.slice(-8)[0]?.message_index ?? 0;
  const instructionReads = new Set(messages.flatMap(record => {
    if (record.message?.role !== "assistant" || !Array.isArray(record.message.content)) return [];
    return record.message.content.filter(part => part?.type === "tool_call"
      && /(?:AGENTS|SKILL)\.md|skill:\/\//i.test(JSON.stringify(part.arguments))).map(part => part.id);
  }));
  const archives = new Map<string, NativeContextFile>();
  let archivedResults = 0;
  const core = records.map(record => {
    const message = record.message;
    if (record.kind !== "message" || message?.role !== "tool_result" || message.is_error !== false
      || typeof message.content !== "string" || message.content.length < 16_384
      || record.message_index! >= latestUser || record.message_index! >= recentBoundary
      || instructionReads.has(message.tool_call_id) || /skill|instruction/i.test(String(message.tool_name))
      || /\b(?:AGENTS|SKILL)\.md\b/i.test(message.content)) return record;
    const body = message.content;
    const name = `codex-evidence-${hash(body).slice(0, 16)}.txt`;
    if (archives.has(name) && archives.get(name)!.text !== body) throw new Error("Evidence identity collision");
    if (!archives.has(name)) archives.set(name, { name, text: body, kind: "evidence", required: false,
      source: `${String(message.tool_name)} result ${String(message.tool_call_id)}` });
    archivedResults++;
    return { ...record, message: { ...message,
      content: `[Historical tool output is archived; the preview is incomplete.]\n${body.slice(0, 512)}\n[... archived ...]\n${body.slice(-512)}`,
      content_reference: { name, chars: body.length, sha256: hash(body), status: "available_on_demand" },
    } };
  });
  const attachments: Array<Record<string, unknown>> = [];
  let attachmentBytes = 0;
  for (const file of compiled.files ?? []) {
    const extracted = await extractInputDocument(file, signal);
    attachmentBytes += extracted.originalBytes.length;
    if (attachmentBytes > 50_000_000) throw new Error("Supplied attachments exceed the 50 MB total byte budget");
    if (file.required && extracted.originalBytes.length && !extracted.text.length) throw new Error(`Higher-priority attachment ${extracted.filename} requires readable text before work`);
    const localPath = cache.write(extracted.filename, extracted.originalBytes);
    const name = `codex-attachment-${hash(JSON.stringify([file.ref, extracted.text])).slice(0, 16)}.txt`;
    archives.set(name, { name, text: extracted.text, kind: "attachment", required: file.required === true, source: extracted.filename });
    attachments.push({ ref: file.ref, name, filename: extracted.filename, required: file.required === true, local_path: localPath, chars: extracted.text.length,
      extraction: extracted.extraction, ...(file.detail ? { requested_detail: file.detail } : {}), ...(extracted.pages ? { pages: extracted.pages } : {}) });
  }
  const imagePayloads = chatGptImageFilePayloads(compiled.images, "native");
  signal?.throwIfAborted();
  if (attachmentBytes + imagePayloads.reduce((n, image) => n + image.buffer.length, 0) > 50_000_000) throw new Error("Supplied attachments exceed the 50 MB total byte budget");
  const images: NativeContextFile[] = imagePayloads.map((payload, index) => ({
    name: compiled.images[index]!.ref, text: "", kind: "image", required: compiled.images[index]!.required !== false,
    mimeType: payload.mimeType, imageData: payload.buffer.toString("base64"),
    imageDetail: compiled.images[index]!.detail,
    source: cache.write(payload.name, payload.buffer),
  }));
  const optional = [...archives.values()];
  const index = { version: 2, records: [], index: {
    workspace: { cwd: environment.cwd, roots: environment.roots, writable_roots: environment.writableRoots, sandbox: environment.sandboxPolicy.type },
    attachments, images: images.map(file => ({ ref: file.name, mime_type: file.mimeType, local_path: file.source, required: file.required !== false })),
    archived_results: archivedResults,
    evidence: optional.filter(file => file.kind === "evidence").slice(0, 20).map(file => ({ name: file.name, chars: file.text.length, source: file.source })),
    evidence_index_partial: optional.filter(file => file.kind === "evidence").length > 20,
    search: "Use codex_context_search for optional historical evidence and supplied documents. Read relevant returned names/offsets; don't infer omitted content or replay old actions.",
    workspace_guidance: "Use the current native tool inventory and this workspace. For repository work, inspect applicable AGENTS.md, README/build files and requested paths; use a bounded directory listing and targeted searches when that context is not already available. Do not read the entire repository or another computer by default.",
  } };
  const parts = [JSON.stringify({ version: 2, records: core }), JSON.stringify(index)] as const;
  const coreFiles: NativeContextFile[] = parts.map((text, index) => ({ name: `codex-context-${index + 1}-of-2.json`, text, kind: "context", required: true }));
  const result: CompiledChatGptWebPrompt = { ...compiled, nativeImages: true,
    multipart: { parts, commit: compiled.multipart.commit }, contextReserveTokens: 0,
    contextRequiredTokens: optional.filter(file => file.required !== false).reduce((n, file) => n + estimateTokens(file.text, "gpt-5.6-sol"), 0) };
  return { compiled: result, files: [...coreFiles, ...optional, ...images], release: cache.dispose,
    options: { requireReceipts: true, optionalTokenBudget: null },
    stats: { originalCharacters: compiled.multipart.parts.reduce((n, part) => n + part.length, 0),
      requiredCharacters: parts[0].length + parts[1].length, archivedCharacters: optional.reduce((n, file) => n + file.text.length, 0),
      archivedResults, attachments: attachments.length, images: images.length } };
  } catch (error) { cache.dispose(); throw error; }
}

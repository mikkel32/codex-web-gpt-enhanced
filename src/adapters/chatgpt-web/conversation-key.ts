import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { atomicWriteFile } from "../../config";
import type { CodexMessage, CodexParsedRequest } from "../../types";
import { nativeMessageItemId, nativeMessageTurnId } from "../../responses/message-provenance";
import { extractChatGptTurnIdentity } from "./environment";

export function chatGptConversationKey(parsed: CodexParsedRequest, namespace: string): string | undefined {
  const identity = extractChatGptTurnIdentity(parsed);
  if (!identity.threadId) return undefined;
  // Compaction changes the local representation of history, never the browser task identity.
  return digest(JSON.stringify({ namespace, threadId: identity.threadId, modelId: parsed.modelId, reasoning: parsed.options.reasoning }));
}

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
function historyDigest(messages: CodexMessage[]): string {
  // Preserve the existing JSON-array digest without allocating another complete transcript.
  const hash = createHash("sha256").update("[");
  for (let index = 0; index < messages.length; index++) {
    const { timestamp: _timestamp, ...message } = messages[index]!;
    if (index) hash.update(",");
    hash.update(JSON.stringify(message));
  }
  return hash.update("]").digest("hex");
}
const answerText = (message: CodexMessage) => message.role === "assistant"
  ? message.content.filter(part => part.type === "text").map(part => part.text).join("").trim()
  : "";

export interface ConversationCursor { count: number; prefix: string; answer: string; updatedAt: number; sourceTurnId?: string; answerItemIds?: string[] }
const validItemId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 256;

/** Trim only a proven accepted prefix and its unique final answer. Native turns after it survive. */
export function retainedConversationResumeRequest(parsed: CodexParsedRequest, cursor?: ConversationCursor): CodexParsedRequest | undefined {
  const messages = parsed.context.messages;
  if (!cursor?.sourceTurnId || !cursor.answerItemIds?.length || cursor.count > messages.length || historyDigest(messages.slice(0, cursor.count)) !== cursor.prefix) return undefined;
  let match = -1;
  for (let index = cursor.count; index < messages.length; index++) {
    const message = messages[index]!;
    const text = answerText(message);
    if (message.role !== "assistant" || message.phase === "commentary" || nativeMessageTurnId(message) !== cursor.sourceTurnId) continue;
    const itemId = nativeMessageItemId(message);
    if (!itemId || !cursor.answerItemIds.includes(itemId)) continue;
    if (!text || digest(text) !== cursor.answer) continue;
    if (match !== -1) return undefined;
    match = index;
  }
  if (match === -1 || match === messages.length - 1) return undefined;
  // A new instruction or notification may not have reached the running Web turn.
  // Never discard that gap merely because a later answer matches the cursor.
  if (messages.slice(cursor.count, match).some(message => message.role !== "assistant" && message.role !== "toolResult")) return undefined;
  return { ...parsed, context: { ...parsed.context, messages: messages.slice(match + 1) } };
}

/** Metadata only: Codex owns the history; ChatGPT owns its saved document. No third transcript. */
export class ChatGptConversationCursors {
  private cursors: Record<string, ConversationCursor> = {};
  constructor(private readonly path?: string) {}

  private read(): void {
    if (!this.path) return;
    if (!existsSync(this.path)) { this.cursors = {}; return; }
    try {
      if (statSync(this.path).size > 1024 * 1024) throw new Error("Cursor index exceeds its size limit");
      const file = JSON.parse(readFileSync(this.path, "utf8"));
      if (file.version !== 1 || !file.cursors || typeof file.cursors !== "object") throw new Error("Invalid cursor file");
      this.cursors = Object.fromEntries(Object.entries(file.cursors).flatMap(([key, value]) => {
        const cursor = value as ConversationCursor;
        const valid = /^[a-f0-9]{64}$/.test(key) && cursor && Number.isSafeInteger(cursor.count) && cursor.count >= 0
          && /^[a-f0-9]{64}$/.test(cursor.prefix) && /^[a-f0-9]{64}$/.test(cursor.answer)
          && Number.isFinite(cursor.updatedAt);
        if (!valid) return [];
        const sourceTurnId = typeof cursor.sourceTurnId === "string" && cursor.sourceTurnId.trim() ? cursor.sourceTurnId : undefined;
        const answerItemIds = Array.isArray(cursor.answerItemIds) && cursor.answerItemIds.length <= 8 && cursor.answerItemIds.every(validItemId)
          ? cursor.answerItemIds : undefined;
        return [[key, { count: cursor.count, prefix: cursor.prefix, answer: cursor.answer, updatedAt: cursor.updatedAt,
          ...(sourceTurnId ? { sourceTurnId } : {}), ...(answerItemIds ? { answerItemIds } : {}) }]];
      })) as Record<string, ConversationCursor>;
    } catch { this.cursors = {}; }
  }

  hasCompletedConversation(key: string): boolean {
    this.read();
    return this.cursors[key] !== undefined;
  }

  resume(key: string, parsed: CodexParsedRequest): { parsed: CodexParsedRequest; mode: "delta" | "snapshot"; omitted: number } {
    this.read();
    const resumed = retainedConversationResumeRequest(parsed, this.cursors[key]);
    return { parsed: resumed ?? parsed, mode: resumed ? "delta" : "snapshot", omitted: parsed.context.messages.length - (resumed ?? parsed).context.messages.length };
  }

  commit(key: string, parsed: CodexParsedRequest, answer: string): void {
    if (!answer.trim()) return;
    this.read();
    const sourceTurnId = extractChatGptTurnIdentity(parsed).turnId;
    this.cursors[key] = { count: parsed.context.messages.length, prefix: historyDigest(parsed.context.messages), answer: digest(answer.trim()), updatedAt: Date.now(), ...(sourceTurnId ? { sourceTurnId } : {}) };
    this.cursors = Object.fromEntries(Object.entries(this.cursors).sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, 256));
    this.write(key);
  }

  /** Bind the Web answer to message IDs actually emitted by the Responses bridge. */
  recordOutput(key: string, parsed: CodexParsedRequest, response: Record<string, unknown>): void {
    if (response.status !== "completed" || !Array.isArray(response.output)) return;
    this.read();
    const cursor = this.cursors[key];
    if (!cursor?.sourceTurnId || cursor.sourceTurnId !== extractChatGptTurnIdentity(parsed).turnId
      || cursor.count > parsed.context.messages.length
      || historyDigest(parsed.context.messages.slice(0, cursor.count)) !== cursor.prefix) return;
    const matching = response.output.filter(item => {
      if (!item || item.type !== "message" || item.role !== "assistant" || item.phase !== "final_answer" || !validItemId(item.id)) return false;
      const text = typeof item.content === "string" ? item.content : Array.isArray(item.content)
        ? item.content.filter((part: { type?: unknown; text?: unknown }) => part && (part.type === "output_text" || part.type === "text") && typeof part.text === "string")
          .map((part: { text: string }) => part.text).join("") : "";
      return digest(text.trim()) === cursor.answer;
    });
    if (matching.length !== 1) return;
    const id = matching[0]!.id as string;
    if (cursor.answerItemIds?.includes(id)) return;
    // Re-observing a completed round can produce a fresh wire message ID without another Send.
    cursor.answerItemIds = [...(cursor.answerItemIds ?? []), id].slice(-8);
    this.write(key);
  }

  private write(key: string): void {
    if (this.path) {
      try { atomicWriteFile(this.path, JSON.stringify({ version: 1, cursors: this.cursors })); }
      catch (error) { delete this.cursors[key]; throw error; }
    }
  }
}

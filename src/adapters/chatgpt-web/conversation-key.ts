import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { atomicWriteFile } from "../../config";
import type { CodexMessage, CodexParsedRequest } from "../../types";
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

export interface ConversationCursor { count: number; prefix: string; answer: string; updatedAt: number }

/** Trim only a proven accepted prefix and its unique final answer. Native turns after it survive. */
export function retainedConversationResumeRequest(parsed: CodexParsedRequest, cursor?: ConversationCursor): CodexParsedRequest | undefined {
  const messages = parsed.context.messages;
  if (!cursor || cursor.count > messages.length || historyDigest(messages.slice(0, cursor.count)) !== cursor.prefix) return undefined;
  let match = -1;
  for (let index = cursor.count; index < messages.length; index++) {
    const text = answerText(messages[index]!);
    if (!text || digest(text) !== cursor.answer) continue;
    if (match !== -1) return undefined;
    match = index;
  }
  if (match === -1 || match === messages.length - 1) return undefined;
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
      this.cursors = Object.fromEntries(Object.entries(file.cursors).filter(([key, value]) => {
        const cursor = value as ConversationCursor;
        return /^[a-f0-9]{64}$/.test(key) && cursor && Number.isSafeInteger(cursor.count) && cursor.count >= 0
          && /^[a-f0-9]{64}$/.test(cursor.prefix) && /^[a-f0-9]{64}$/.test(cursor.answer)
          && Number.isFinite(cursor.updatedAt);
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
    this.cursors[key] = { count: parsed.context.messages.length, prefix: historyDigest(parsed.context.messages), answer: digest(answer.trim()), updatedAt: Date.now() };
    this.cursors = Object.fromEntries(Object.entries(this.cursors).sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, 256));
    if (this.path) {
      try { atomicWriteFile(this.path, JSON.stringify({ version: 1, cursors: this.cursors })); }
      catch (error) { delete this.cursors[key]; throw error; }
    }
  }
}

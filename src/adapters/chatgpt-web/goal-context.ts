import { decodeCompactionSummary, isReadableCompactionSummaryText } from "../../responses/compaction";
import type { CodexParsedRequest } from "../../types";

export const GOAL_CONTEXT_MARKER = "CODEX_GOAL_CONTEXT_JSON";
export interface GoalContextSnapshot { text: string; turnId?: string }
const record = (value: unknown): Record<string, unknown> | undefined => value !== null
  && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

function textContent(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!Array.isArray(value) || value.some(part => {
    const item = record(part);
    return !item || !["input_text", "text"].includes(String(item.type)) || typeof item.text !== "string";
  })) return undefined;
  return value.map(part => record(part)!.text as string).join("\n");
}

function goalEnvelope(text: string): boolean {
  const value = text.trim();
  return /^<codex_internal_context source="goal">[\s\S]*<\/codex_internal_context>$/.test(value)
    || /^<goal_context>[\s\S]*<\/goal_context>$/.test(value);
}

function checkpointGoal(summary: string): GoalContextSnapshot | undefined {
  const marker = `\n${GOAL_CONTEXT_MARKER}\n`;
  const offset = summary.lastIndexOf(marker);
  if (offset < 0) return undefined;
  try {
    const value = record(JSON.parse(summary.slice(offset + marker.length)));
    if (value?.version !== 1 || typeof value.text !== "string" || !goalEnvelope(value.text)
      || (value.turnId !== undefined && typeof value.turnId !== "string")) return undefined;
    return { text: value.text, ...(typeof value.turnId === "string" ? { turnId: value.turnId } : {}) };
  } catch { return undefined; }
}

/** Last observed goal data, not permission to create/resume a goal or override current state. */
export function latestGoalContext(parsed: CodexParsedRequest): GoalContextSnapshot | undefined {
  const input = record(parsed._rawBody)?.input;
  if (!Array.isArray(input)) return undefined;
  for (let index = input.length - 1; index >= 0; index--) {
    const item = record(input[index]);
    if (!item) continue;
    if (["compaction", "compaction_summary", "context_compaction"].includes(String(item.type)) && typeof item.encrypted_content === "string") {
      const summary = decodeCompactionSummary(item.encrypted_content);
      const goal = summary ? checkpointGoal(summary) : undefined;
      if (goal) return goal;
      continue;
    }
    if (item.role !== "user" || (item.type !== undefined && item.type !== "message")) continue;
    const text = textContent(item.content);
    if (!text) continue;
    const metadata = record(item.internal_chat_message_metadata_passthrough);
    const kinds = metadata?.content_item_kinds;
    if (isReadableCompactionSummaryText(text)
      && (kinds === undefined || (Array.isArray(kinds) && kinds.length > 0 && kinds.every(kind => kind === "compaction.summary")))) {
      const goal = checkpointGoal(text);
      if (goal) return goal;
      continue;
    }
    const parts = typeof item.content === "string" ? 1 : (item.content as unknown[]).length;
    // Match native provenance as well as markup. Quoted goal-looking user text
    // must not become runtime-owned goal state merely because of its spelling.
    if (!Array.isArray(kinds) || kinds.length !== parts || !kinds.length
      || !kinds.every(kind => kind === "goal.internal_context") || !goalEnvelope(text)) continue;
    return { text, ...(typeof metadata?.turn_id === "string" ? { turnId: metadata.turn_id } : {}) };
  }
  return undefined;
}

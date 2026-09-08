import { COMPACT_PROMPT } from "../../responses/compaction";
import type { CompactionTransactionHandle } from "./compaction-transaction";

export const CODEX_COMPACTION_CONTROL_WIRE_NAME = "codex.control.compaction_handoff";
export const CODEX_ACTIVE_COMPACTION_REQUEST_MARKER = "CODEX_ACTIVE_COMPACTION_REQUEST";
export const COMPACTION_HANDOFF_BEGIN = "CODEX_COMPACTION_HANDOFF_BEGIN";
export const COMPACTION_HANDOFF_END = "CODEX_COMPACTION_HANDOFF_END";

/** Only the final answer of this exact checkpoint request can use the text return channel. */
export function parseCompactionFinalHandoff(text: string, handoffId: string): string | undefined {
  const trimmed = text.trim();
  const fenced = /^```(?:json|text|markdown)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed);
  const content = (fenced?.[1] ?? trimmed).replace(/\r\n/g, "\n");
  const lines = content.trim().split("\n");
  // The DOM-to-Markdown renderer escapes literal underscores in paragraph text.
  // Normalize only the two protocol lines; the summary remains byte-for-byte Markdown.
  const boundary = (line: string | undefined) => line?.replaceAll("\\_", "_");
  if (boundary(lines[0]) === `${COMPACTION_HANDOFF_BEGIN} ${handoffId}`
    && boundary(lines.at(-1)) === `${COMPACTION_HANDOFF_END} ${handoffId}`) {
    const summary = lines.slice(1, -1).join("\n").trim();
    // Reject duplicate/nested envelopes and unrelated surrounding text. Do not repair JSON,
    // strip Markdown inside the summary, or accept an answer from a different transaction.
    if (!summary || summary === "<complete checkpoint summary>"
      || summary.split("\n").some(line => /^CODEX_COMPACTION_HANDOFF_(?:BEGIN|END)\b/.test(boundary(line.trim())!))) return undefined;
    return summary;
  }
  try {
    // Older retained conversations may still emit the original valid JSON envelope.
    const value: unknown = JSON.parse(content);
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    if (record.type !== "codex_compaction_handoff" || record.handoff_id !== handoffId
      || typeof record.summary !== "string" || Object.keys(record).length !== 3) return undefined;
    const summary = record.summary.trim();
    return summary && summary !== "<complete checkpoint summary>" ? summary : undefined;
  } catch { return undefined; }
}

function compactionControlBinding(transaction: CompactionTransactionHandle): string[] {
  return [
    "Submit the complete checkpoint through the attached Codex Native control plane by calling codex_tool_call exactly once with the binding below.",
    "This one-shot control token is valid only for the reserved compaction operation; do not use it with codex_exec, codex_tool_inventory, or any outer Codex tool.",
    "<codex_compaction_control>",
    `turn_token ${transaction.token}`,
    `wire_name ${CODEX_COMPACTION_CONTROL_WIRE_NAME}`,
    `handoff_id ${transaction.handoffId}`,
    "</codex_compaction_control>",
    `Call codex_tool_call exactly once with ${JSON.stringify({
      turn_token: transaction.token,
      wire_name: CODEX_COMPACTION_CONTROL_WIRE_NAME,
      arguments: {
        handoff_id: transaction.handoffId,
        summary: "<complete checkpoint summary>",
      },
    })}.`,
  ];
}

/**
 * Stop an active browser response only if it asks for another tool after Codex requested
 * compaction. Results for calls already handed to Codex remain byte-for-byte canonical: when they
 * are enough to finish the task, that ordinary final answer remains publishable. A later tool call
 * is intercepted before execution and receives this instruction; the retained conversation then
 * receives the sole structured checkpoint request on a clean message boundary.
 */
export function activeCompactionToolResultInstruction(): string {
  return [
    `<${CODEX_ACTIVE_COMPACTION_REQUEST_MARKER}>`,
    "Codex reached its context limit before this newly requested tool could be sent for execution. The tool was not executed.",
    "Stop ordinary task work now, call no more tools, and end this Web response normally.",
    "Do not create or submit a checkpoint in this response. After it settles, the retained conversation will receive exactly one separate structured compaction handoff request.",
    `</${CODEX_ACTIVE_COMPACTION_REQUEST_MARKER}>`,
  ].join("\n");
}

/**
 * Zero Risk cannot submit a second browser message automatically. When Codex compacts at an
 * already-visible native tool boundary, the same manually submitted response returns the
 * checkpoint through the same Zero Risk request instead.
 */
export function zeroRiskActiveCompactionToolResultInstruction(toolExecuted: boolean): string {
  return [
    `<${CODEX_ACTIVE_COMPACTION_REQUEST_MARKER}>`,
    toolExecuted
      ? "Codex reached its context limit while this Web response was waiting for the tool result above."
      : "Codex reached its context limit before the requested tool could be sent for execution. The tool was not executed.",
    toolExecuted
      ? "Consume that canonical result, stop ordinary task work now, and do not call any more work tools."
      : "Stop ordinary task work now and do not call any more work tools.",
    COMPACT_PROMPT,
    "Call no more work tools. Return only the complete checkpoint summary to Codex with codex_turn_complete.",
    `</${CODEX_ACTIVE_COMPACTION_REQUEST_MARKER}>`,
  ].join("\n");
}

export function structuredCompactionHandoffInstruction(
  transaction: CompactionTransactionHandle,
): string {
  return [
    "Automatic Codex context compaction has started. Stop ordinary task work and do not call any more work tools.",
    "This response is private checkpoint control. Preserve earlier user-facing answer-format requirements inside the summary; they do not change this handoff's format.",
    COMPACT_PROMPT,
    ...compactionControlBinding(transaction),
    "If the attached control tool is unavailable or cannot submit the checkpoint, return the complete summary between these exact boundary lines. Write ordinary text or Markdown inside; do not encode the summary as a JSON string. Include no text outside the boundaries:",
    `${COMPACTION_HANDOFF_BEGIN} ${transaction.handoffId}`,
    "<complete checkpoint summary>",
    `${COMPACTION_HANDOFF_END} ${transaction.handoffId}`,
    "The handoff_id must match this request exactly. Do not return an acknowledgment, ordinary task answer, or a checkpoint from an earlier request.",
    "After the control call returns submitted=true, call no more tools. The bridge will close this one-purpose Web response after accepting the checkpoint.",
    "The outer bridge accepts compaction only after the structured checkpoint is valid and its owned browser turn has physically settled.",
  ].join("\n");
}

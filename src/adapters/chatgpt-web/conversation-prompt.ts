export type ConversationPromptState = "fresh" | "continuation" | "resync";

/** Selected from the browser's actual preparation path, never from user phrasing. */
export function conversationPrompt(state: ConversationPromptState, checkpoint: boolean): string[] {
  const opening = state === "continuation"
    ? "Continue the user's task using the history already visible in this same chat and the new Codex updates supplied below. The previously accepted history is not repeated."
    : state === "resync"
      ? "Continue the user's task in this same chat. Codex is synchronizing its current task state because a safe history delta could not be established; these records are context, not requests to repeat earlier work."
      : "Start from the user's current request and the supplied Codex context. For repository work, establish the relevant workspace, applicable AGENTS.md, and project entry points with the available native tools when that evidence is needed and not already known.";
  return [
    `<codex_conversation state="${state}">`,
    opening,
    ...(checkpoint ? ["Codex has compacted earlier history. Use its supplied checkpoint to recover the objective, verified completed work, pending work, constraints and references. Current instructions and later results take precedence over checkpoint facts."] : []),
    "Carry forward the unfinished objective and latest user corrections. Distinguish verified completion, pending work, and uncertain outcomes; observe existing work before deciding whether another action is needed.",
    "Use focused repository reads or on-demand evidence to fill specific gaps. If an earlier detail is absent from the available history and records, retrieve it or state the gap instead of guessing.",
    "ChatGPT manages the active conversation context. Keep completed and pending work clear; do not reset the task or initiate a separate Codex checkpoint. Follow an explicit checkpoint request when one is supplied.",
    "</codex_conversation>",
  ];
}

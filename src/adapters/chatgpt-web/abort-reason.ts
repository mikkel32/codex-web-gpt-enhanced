// Only fixed diagnostic categories cross the helper boundary. Never serialize arbitrary
// native errors, stack traces, paths, tokens or task text into an abort frame or log.
const messages = {
  unknown: "ChatGPT web turn aborted",
  native_interrupt: "Codex turn interrupted",
  launcher_cancel: "Active turn cancelled by launcher",
  browser_closed: "Browser tab was closed by the user",
  binding_retired: "Codex Native retired the turn binding before its tool work completed",
  retirement_observation_failed: "ChatGPT could not observe Codex Native turn retirement",
  helper_protocol_failed: "Launcher browser helper stopped after a local protocol failure",
  compaction_accepted: "Structured compaction handoff accepted",
} as const;
export type ChatGptBrowserAbortReason = keyof typeof messages;

export function chatGptBrowserAbortReason(reason: unknown): ChatGptBrowserAbortReason {
  if (!(reason instanceof Error)) return "unknown";
  for (const [key, message] of Object.entries(messages)) {
    if (reason.message === message) return key as ChatGptBrowserAbortReason;
  }
  if ("code" in reason && reason.code === "client_cancelled") return "browser_closed";
  return "unknown";
}

export function chatGptBrowserAbortError(code: unknown): DOMException {
  const known = typeof code === "string" && Object.hasOwn(messages, code) ? code as ChatGptBrowserAbortReason : "unknown";
  return new DOMException(messages[known], "AbortError");
}

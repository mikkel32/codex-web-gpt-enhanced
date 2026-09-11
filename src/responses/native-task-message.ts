export interface NativeTaskMessage {
  id: string;
  turnId: string;
  text: string;
}

/** Codex's injected task-to-task message is an unpaired, named function output.
 * Ordinary tool output and XML-looking text never establish this provenance. */
export function nativeTaskMessage(value: unknown): NativeTaskMessage | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  if (item.type !== "function_call_output" || item.namespace !== "codex_app"
    || item.name !== "send_message_to_thread" || item.call_id !== undefined
    || typeof item.id !== "string" || !/^fco_[A-Za-z0-9_-]+$/.test(item.id)
    || typeof item.output !== "string") return undefined;
  const metadata = item.internal_chat_message_metadata_passthrough;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
  const turnId = (metadata as Record<string, unknown>).turn_id;
  if (typeof turnId !== "string" || !turnId.trim()) return undefined;
  if (!/^<codex_delegation>\s*<source_thread_id>[A-Za-z0-9_-]{1,128}<\/source_thread_id>\s*<input>[\s\S]+<\/input>\s*<\/codex_delegation>$/.test(item.output.trim())) return undefined;
  return { id: item.id, turnId, text: item.output };
}

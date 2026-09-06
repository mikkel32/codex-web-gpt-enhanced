import type { CodexMessage } from "../types";

const nativeTurns = new WeakMap<CodexMessage, string>();
const nativeItems = new WeakMap<CodexMessage, string>();

/** Keep native item provenance out of model-visible message text and history hashes. */
export function recordNativeMessageTurn<T extends CodexMessage>(message: T, raw: unknown): T {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const itemId = (raw as Record<string, unknown>).id;
    if (typeof itemId === "string" && itemId.trim()) nativeItems.set(message, itemId);
    const metadata = (raw as Record<string, unknown>).internal_chat_message_metadata_passthrough;
    if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
      const turnId = (metadata as Record<string, unknown>).turn_id;
      if (typeof turnId === "string" && turnId.trim()) nativeTurns.set(message, turnId);
    }
  }
  return message;
}

export function nativeMessageTurnId(message: CodexMessage): string | undefined {
  return nativeTurns.get(message);
}

export function nativeMessageItemId(message: CodexMessage): string | undefined {
  return nativeItems.get(message);
}

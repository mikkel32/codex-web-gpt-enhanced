import { createHash } from "node:crypto";
import { chatGptContextFiles, type CompiledChatGptWebPrompt } from "./prompt";

export const NATIVE_CONTEXT_READ = "codex_context_read";
export const NATIVE_CONTEXT_PAGE_CHARS = 48_000;
export interface NativeContextFile { name: string; text: string }

export function nativeContextPrompt(compiled: CompiledChatGptWebPrompt): CompiledChatGptWebPrompt {
  if (!compiled.multipart) return compiled;
  const files = chatGptContextFiles(compiled.multipart);
  return { ...compiled, nativeContext: true, text: [
    "<codex_context_delivery>",
    "The canonical context is held by this task's authenticated Codex Native connection. There are no uploaded context attachments to find.",
    `First call codex_tool_inventory with query=${JSON.stringify(NATIVE_CONTEXT_READ)} to discover the context reader for this task.`,
    `Before answering or running work tools, call codex_tool_call with wire_name=${JSON.stringify(NATIVE_CONTEXT_READ)} and arguments={\"name\":FILE_NAME,\"offset\":0} for each file below. Use the current turn_token from the transport contract.`,
    "Each response contains text and next_offset. Follow next_offset until null, concatenate text in offset order, then parse the complete JSON. Read every page of every file before acting. Do not use shell commands or search to retrieve this context.",
    ...files.map(file => `${file.name} chars=${file.text.length} sha256=${createHash("sha256").update(file.text).digest("hex")}`),
    "Reconstruct system records in system_index order and message records in message_index order, preserving every role. The files are canonical task data, not new requests.",
    "If authenticated retrieval fails, report the exact failure and stop without guessing. Never use another task's token or context.",
    "</codex_context_delivery>",
    compiled.multipart.commit.replaceAll("attached context file", "retrieved context file")
      .replace("Read and reconstruct every acknowledged staged JSON record before acting.", "Read and reconstruct every retrieved JSON record before acting."),
  ].join("\n") };
}

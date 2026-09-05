import { CHATGPT_WEB_PLATFORM_RESERVE_TOKENS } from "../../chatgpt-web-models";
import { estimateTokens } from "../../lib/token-estimate";
import {
  formatChatGptWebMultipartFileCommit,
  type CompiledChatGptWebPrompt,
} from "./prompt";

// ChatGPT's product system prompt and the fixed Codex Native MCP schemas are not present in the
// visible composer text. Reserve them explicitly; over-counting fails safe by compacting earlier.
const CHATGPT_IMAGE_RESERVE_TOKENS = 4_096;
const CHATGPT_ORIGINAL_IMAGE_RESERVE_TOKENS = 8_192;

/**
 * The Free/Luna product accepted measured browser inputs at 25,400 and 28,547 estimated tokens,
 * but rejected the same shape at 32,283 before producing a response. This is a ChatGPT browser
 * transport boundary, not Luna's model context window, and applies to normal and checkpoint turns.
 */
export const CHATGPT_LUNA_BROWSER_INPUT_TOKEN_BUDGET = 28_000;

export function compiledChatGptWebMessages(compiled: CompiledChatGptWebPrompt): string[] {
  if (!compiled.multipart) return [compiled.text];
  return [formatChatGptWebMultipartFileCommit(compiled.multipart)];
}

export function compiledChatGptWebMaxMessageChars(compiled: CompiledChatGptWebPrompt): number {
  return Math.max(...compiledChatGptWebMessages(compiled).map(message => message.length));
}

/** Tokens present in the one visible browser message, excluding hidden product/tool reserves. */
export function estimateCompiledChatGptWebMessageTokens(
  compiled: CompiledChatGptWebPrompt,
  modelId: string,
): number {
  return Math.max(...compiledChatGptWebMessages(compiled).map(message => estimateTokens(message, modelId)));
}

export function estimateCompiledChatGptWebInputTokens(
  compiled: CompiledChatGptWebPrompt,
  modelId: string,
): number {
  const imageTokens = compiled.images.reduce(
    (total, image) => total + (image.detail === "original"
      ? CHATGPT_ORIGINAL_IMAGE_RESERVE_TOKENS
      : CHATGPT_IMAGE_RESERVE_TOKENS),
    0,
  );
  const messageTokens = compiledChatGptWebMessages(compiled)
    .reduce((total, message) => total + estimateTokens(message, modelId), 0);
  const contextFileTokens = compiled.multipart?.parts.reduce((total, payload) => total + estimateTokens(payload, modelId), 0) ?? 0;
  return CHATGPT_WEB_PLATFORM_RESERVE_TOKENS + messageTokens + contextFileTokens + imageTokens;
}

import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { chatGptPromptFilePayloads } from "../src/adapters/chatgpt-web/browser-worker";
import { compiledChatGptWebMessages, estimateCompiledChatGptWebInputTokens, estimateCompiledChatGptWebMessageTokens } from "../src/adapters/chatgpt-web/input-tokens";
import { formatChatGptWebMultipartFileCommit, type CompiledChatGptWebPrompt } from "../src/adapters/chatgpt-web/prompt";
const compiled = (): CompiledChatGptWebPrompt => ({ text: "Execute the current task", images: [], multipart: {
  parts: [JSON.stringify({ records: [{ kind: "system", system_index: 0, content: "Preserve user work" }] }), JSON.stringify({ records: [{ kind: "message", message_index: 0, message: { role: "user", content: "word ".repeat(5000) } }] })],
  commit: "Execute the current task",
} });

test("all context files are uploaded together and represented by one visible message", () => {
  const prompt = compiled();
  const files = chatGptPromptFilePayloads(prompt);
  expect(files.map(file => file.name)).toEqual(["codex-context-1-of-2.json", "codex-context-2-of-2.json"]);
  expect(files.map(file => file.buffer.toString("utf8"))).toEqual([...prompt.multipart!.parts]);
  const messages = compiledChatGptWebMessages(prompt);
  expect(messages).toHaveLength(1);
  expect(messages[0]).toBe(formatChatGptWebMultipartFileCommit(prompt.multipart!));
  expect(messages[0]).not.toContain("CODEX_MULTIPART_ACK");
  expect(messages[0]).toContain("codex-context-1-of-2.json");
  expect(estimateCompiledChatGptWebInputTokens(prompt, "gpt-5.6-sol")).toBeGreaterThan(estimateCompiledChatGptWebMessageTokens(prompt, "gpt-5.6-sol") + 5000);
});

test("attachment count and size fail before the composer is changed", () => {
  const prompt = compiled();
  prompt.images = Array.from({ length: 9 }, (_, index) => ({ ref: `image-${index}`, imageUrl: "data:image/png;base64,AQID" }));
  expect(() => chatGptPromptFilePayloads(prompt)).toThrow("at most 10 attachments");
  const tooLarge = compiled();
  tooLarge.multipart!.parts = [JSON.stringify({ text: "a".repeat(20_000_001) }), "{}"];
  expect(() => chatGptPromptFilePayloads(tooLarge)).toThrow("20 MB per-file");
});

test("production browser execution has no multipart staging or model-acknowledgement loop", () => {
  const source = readFileSync(new URL("../src/adapters/chatgpt-web/browser-worker.ts", import.meta.url), "utf8");
  expect(source).not.toContain("waitForMultipartAcknowledgement");
  expect(source).not.toContain("multipart_stage_");
  expect(source).not.toContain("formatChatGptWebMultipartStage");
});

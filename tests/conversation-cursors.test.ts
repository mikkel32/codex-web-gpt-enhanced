import { test, expect } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ChatGptConversationCursors } from "../src/adapters/chatgpt-web/conversation-key";
import type { CodexParsedRequest } from "../src/types";

const key = "a".repeat(64);
const input = (): CodexParsedRequest => ({ modelId: "gpt-5.6-sol", stream: true, options: {}, context: { messages: [{ role: "user", content: "Fix the widget", timestamp: 1 }] } });
const next = (): CodexParsedRequest => ({ ...input(), context: { messages: [
  ...input().context.messages,
  { role: "assistant", content: [{ type: "text", text: "Widget fixed" }], timestamp: 2 },
  { role: "user", content: "Now test it", timestamp: 3 },
] } });

test("retained context omits only a proven prefix, with no extra stored transcript", () => {
  const root = mkdtempSync(join(tmpdir(), "maria-cursors-"));
  const file = join(root, "cursors.json");
  try {
    new ChatGptConversationCursors(file).commit(key, input(), "Widget fixed");
    const restored = new ChatGptConversationCursors(file);
    const plan = restored.resume(key, next());
    expect(plan.mode).toBe("delta");
    expect(plan.omitted).toBe(2);
    expect(plan.parsed.context.messages).toEqual(next().context.messages.slice(2));
    expect(readFileSync(file, "utf8")).not.toContain("Widget");
    const native = next();
    native.context.messages.push(
      { role: "assistant", content: [{ type: "text", text: "Native Codex ran the tests" }], timestamp: 4 },
      { role: "user", content: "Continue on Web", timestamp: 5 },
    );
    expect(restored.resume(key, native).parsed.context.messages).toEqual(native.context.messages.slice(2));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("compaction, edited ancestors, ambiguous answers, and missing cursors preserve canonical context", () => {
  const store = new ChatGptConversationCursors();
  store.commit(key, input(), "Widget fixed");
  const changed = next();
  changed.context.messages[0] = { role: "user", content: "New checkpoint: Widget fixed, tests pending", timestamp: 1 };
  expect(store.resume(key, changed).mode).toBe("snapshot");
  const ambiguous = next();
  ambiguous.context.messages.splice(2, 0, { role: "assistant", content: [{ type: "text", text: "Widget fixed" }], timestamp: 3 });
  expect(store.resume(key, ambiguous).mode).toBe("snapshot");
  expect(store.resume("b".repeat(64), next()).mode).toBe("snapshot");
  const missingParent = next();
  missingParent.context.messages.splice(1, 1);
  expect(store.resume(key, missingParent).mode).toBe("snapshot");
});

test("timestamp regeneration is harmless and corrupt cursor data falls back to complete Codex history", () => {
  const root = mkdtempSync(join(tmpdir(), "maria-cursor-corrupt-"));
  try {
    const file = join(root, "cursor.json");
    const store = new ChatGptConversationCursors(file);
    store.commit(key, input(), "Widget fixed");
    const parsed = next(); parsed.context.messages[0]!.timestamp = 999;
    expect(store.resume(key, parsed).mode).toBe("delta");
    writeFileSync(file, "broken");
    expect(store.resume(key, parsed).parsed).toBe(parsed);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

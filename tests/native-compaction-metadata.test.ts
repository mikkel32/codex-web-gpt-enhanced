import { expect, test } from "bun:test";
import { parseRequest } from "../src/responses/parser";

test("native pre-sampling compaction metadata activates the compaction path without a trigger item", () => {
  const metadata = { request_kind: "compaction", thread_id: "thread_native", turn_id: "turn_native" };
  for (const value of [metadata, JSON.stringify(metadata)]) {
    const body = { model: "chatgpt-web/extra-high", stream: true,
      client_metadata: { "x-codex-turn-metadata": value },
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "Compact the current context" }] }] };
    const parsed = parseRequest(body);
    expect(parsed._compactionRequest).toBeTrue();
    expect(parsed._plainTextCompactionResponse).toBeTrue();
    expect(parsed._rawBody).toBe(body);
  }
});

test("an explicit remote trigger retains the encoded compaction response contract", () => {
  const parsed = parseRequest({ model: "chatgpt-web/extra-high",
    client_metadata: { "x-codex-turn-metadata": JSON.stringify({ request_kind: "compaction", thread_id: "thread_native", turn_id: "turn_native" }) },
    input: [{ type: "compaction_trigger" }] });
  expect(parsed._compactionRequest).toBeTrue();
  expect(parsed._plainTextCompactionResponse).toBeUndefined();
});

test("historical summaries, quoted metadata, and malformed metadata do not trigger compaction", () => {
  for (const metadata of [undefined, "bad JSON", { request_kind: "compaction" },
    { request_kind: "turn", thread_id: "thread_native", turn_id: "turn_native" }]) {
    const parsed = parseRequest({ model: "chatgpt-web/extra-high",
      client_metadata: { "x-codex-turn-metadata": metadata },
      input: [{ type: "context_compaction" }, { type: "message", role: "user", content: 'Quoted {"request_kind":"compaction"}' }] });
    expect(parsed._compactionRequest).toBeUndefined();
  }
});

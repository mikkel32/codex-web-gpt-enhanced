import { expect, test } from "bun:test";
import { buildCompactV1Output, encodeCompactionSummary, decodeCompactionSummary, decodeCompactionFiles, readCompactionCheckpoint, type CompactionFile } from "../src/responses/compaction";
import { parseRequest } from "../src/responses/parser";
import { scrubBridgeArtifactsForNative } from "../src/native-passthrough";
import { buildResponseJSON } from "../src/bridge";
import type { AdapterEvent } from "../src/types";

const attachments: CompactionFile[] = [
  { role: "user", file: { type: "file", filename: "data.csv", fileData: Buffer.from("needle,17\n").toString("base64") } },
  { role: "developer", file: { type: "file", filename: "rules.md", fileData: Buffer.from("Do not change protected files.").toString("base64") } },
  { role: "user", file: { type: "image", imageUrl: "data:image/png;base64,AQID", detail: "original" } },
];
test("bridge-owned file checkpoints retain original data and role across replay", () => {
  const encoded = encodeCompactionSummary("Continue the same task; one edit already completed.", attachments);
  expect(encoded).toStartWith("ocx2:");
  expect(decodeCompactionSummary(encoded)).toContain("one edit already completed");
  expect(decodeCompactionFiles(encoded)).toEqual(attachments);
  const parsed = parseRequest({ model: "gpt-5.6-sol", input: [{ type: "compaction", encrypted_content: encoded }] });
  expect(parsed.context.messages.slice(1).map(message => ({ role: message.role, file: Array.isArray(message.content) ? message.content[0] : null }))).toEqual(attachments);
  const native = scrubBridgeArtifactsForNative({ model: "gpt-6-astra", input: [{ type: "compaction", encrypted_content: encoded }] }).value as { input: Array<{ role: string; content: unknown[] }> };
  expect(native.input.map(item => item.role)).toEqual(["user", "user", "developer", "user"]);
  expect(native.input[1]!.content[0]).toMatchObject({ type: "input_file", filename: "data.csv" });
  expect(native.input[3]!.content[0]).toMatchObject({ type: "input_image", image_url: "data:image/png;base64,AQID", detail: "original" });
});
test("plain legacy and foreign encrypted checkpoints retain their existing behavior", () => {
  const encoded = encodeCompactionSummary("legacy summary");
  expect(encoded).toStartWith("ocx1:"); expect(decodeCompactionFiles(encoded)).toEqual([]);
  expect(readCompactionCheckpoint("foreign-ciphertext").summary).toBeNull();
  expect(() => readCompactionCheckpoint("ocx2:invalid-data")).toThrow("checkpoint");
});
test("v1 keeps document bytes independently from the retained text budget", () => {
  const file = { type: "input_file", filename: "older.csv", file_data: "YWJj" };
  const output = buildCompactV1Output([
    { role: "user", content: [file] },
    { role: "user", content: [{ type: "input_text", text: "x".repeat(90000) }] },
  ], "summary");
  expect(JSON.stringify(output)).toContain('"file_data":"YWJj"');
});
test("completed bridge responses include attachments in the checkpoint; incomplete ones never do", () => {
  const events: AdapterEvent[] = [{ type: "text_delta", text: "Summary" }, { type: "done", usage: { inputTokens: 1, outputTokens: 1 } }];
  const output = buildResponseJSON(events, "gpt-5.6-sol", { compaction: true, compactionFiles: attachments }).output as Array<{ type: string; encrypted_content?: string }>;
  expect(decodeCompactionFiles(output.find(item => item.type === "compaction")!.encrypted_content)).toEqual(attachments);
  const failed = buildResponseJSON([{ type: "error", message: "interrupted" }], "gpt-5.6-sol", { compaction: true, compactionFiles: attachments }).output as Array<{ type: string }>;
  expect(failed.some(item => item.type === "compaction")).toBe(false);
});

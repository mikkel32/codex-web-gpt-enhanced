import { expect, test } from "bun:test";
import { buildContextPlan } from "../src/adapters/chatgpt-web/context-plan";
import { nativeContextPrompt } from "../src/adapters/chatgpt-web/native-context";
import { compiledChatGptWebMessages, estimateCompiledChatGptWebInputTokens } from "../src/adapters/chatgpt-web/input-tokens";
import { parseRequest } from "../src/responses/parser";
import { compileChatGptWebPrompt } from "../src/adapters/chatgpt-web/prompt";
import { estimateChatGptWebInputTokens } from "../src/adapters/chatgpt-web/usage";
import type { ChatGptTurnEnvironment } from "../src/adapters/chatgpt-web/environment";

const environment: ChatGptTurnEnvironment = { cwd: "/fixture/project", roots: ["/fixture/project"], writableRoots: [], sandboxPolicy: { type: "readOnly", networkAccess: false }, tools: [] };
test("large historical evidence is deferred while every instruction and action record is preserved", async () => {
  const body = "unimportant log line\n".repeat(25000) + "old-fact-only-in-archive\n" + "tail\n".repeat(1000);
  const messages = [
    { role: "assistant", content: [{ type: "tool_call", id: "edit-once", name: "apply_patch", arguments: "exact patch" }] },
    { role: "tool_result", tool_call_id: "old-log", tool_name: "exec_command", is_error: false, content: body },
    { role: "tool_result", tool_call_id: "old-log-copy", tool_name: "exec_command", is_error: false, content: body },
    { role: "tool_result", tool_call_id: "failed-command", tool_name: "exec_command", is_error: true, content: "failure-details".repeat(2000) },
    { role: "assistant", content: [{ type: "tool_call", id: "rules", name: "exec_command", arguments: { cmd: "cat AGENTS.md" } }] },
    { role: "tool_result", tool_call_id: "rules", tool_name: "exec_command", is_error: false, content: "mandatory repository rule\n".repeat(1000) },
    ...Array.from({ length: 10 }, (_, i) => ({ role: "assistant", content: [{ type: "text", text: `progress ${i}` }] })),
    { role: "developer", content: "Late restriction: do not change protected files." },
    { role: "user", content: "Implement the requested fix, preserving completed edits." },
  ];
  const records = [{ kind: "system", system_index: 0, content: "Original system rules." }, ...messages.map((message, message_index) => ({ kind: "message", message_index, message }))];
  const compiled = { text: "commit", images: [], multipart: { parts: [JSON.stringify({ records }), '{"records":[]}'] as const, commit: "commit" } };
  const plan = await buildContextPlan(compiled, environment);
  expect(plan.stats.archivedResults).toBe(2);
  expect(plan.files.filter(file => file.kind === "evidence")).toHaveLength(1);
  expect(plan.stats.requiredCharacters).toBeLessThan(plan.stats.originalCharacters / 4);
  const core = JSON.parse(plan.compiled.multipart!.parts[0]!).records;
  expect(core).toHaveLength(records.length);
  for (const index of [0, 1, 4, 5, 6, records.length - 2, records.length - 1]) expect(core[index]).toEqual(records[index]);
  expect(core[2].message.tool_call_id).toBe("old-log");
  expect(core[2].message.content_reference).toEqual(core[3].message.content_reference);
  expect(plan.files.find(file => file.kind === "evidence")!.text).toBe(body);
  expect(JSON.stringify(core)).not.toContain("old-fact-only-in-archive");
  const prompt = nativeContextPrompt(plan.compiled, plan.files);
  expect(prompt.text).toContain("receipt");
  expect(prompt.text).toContain("codex_context_search");
  expect(compiledChatGptWebMessages(prompt)).toEqual([prompt.text]);
  expect(estimateCompiledChatGptWebInputTokens(prompt, "gpt-5.6-sol")).toBeGreaterThan(0);
  expect(plan.options.optionalTokenBudget).toBeNull();
});

test("inline attachment bytes survive parsing without being pasted as base64 into context", async () => {
  const data = Buffer.from("name,value\nunique-file-marker,17\n").toString("base64");
  const request = parseRequest({ model: "gpt-5.6-sol", reasoning: { effort: "xhigh" }, input: [{ role: "user", content: [
    { type: "input_text", text: "Analyze this CSV." }, { type: "input_file", filename: "sample.csv", file_data: data },
  ] }] });
  const compiled = compileChatGptWebPrompt(request, { localToolsEnabled: true, solAvailable: true, proAvailable: true }, "turn_abcdefghijklmnopqrstuvwx", { nativeRetrieval: true, experimentalMultipartParts: 2 });
  expect(compiled.files?.[0]?.fileData).toBe(data);
  expect(compiled.multipart!.parts.join("")).not.toContain(data);
  const plan = await buildContextPlan(compiled, environment);
  expect(plan.files.find(file => file.kind === "attachment")?.text).toBe("name,value\nunique-file-marker,17\n");
  expect(plan.compiled.multipart!.parts[1]).toContain("sample.csv");
});

test("unavailable file IDs produce an explicit preparation failure rather than an empty placeholder", async () => {
  const request = parseRequest({ model: "gpt-5.6-sol", input: [{ role: "user", content: [{ type: "input_file", file_id: "file-unavailable", filename: "report.pdf" }] }] });
  const compiled = compileChatGptWebPrompt(request, { localToolsEnabled: true, solAvailable: true, proAvailable: true }, "turn_abcdefghijklmnopqrstuvwx", { nativeRetrieval: true, experimentalMultipartParts: 2 });
  await expect(buildContextPlan(compiled, environment)).rejects.toThrow("no supplied bytes");
});

test("usage estimation accepts Full-mode documents without expanding their base64 into tokens", () => {
  const request = parseRequest({ model: "gpt-5.6-sol", input: [{ role: "user", content: [{ type: "input_file", filename: "large.csv", file_data: Buffer.from("row,1\n".repeat(50000)).toString("base64") }] }] });
  const tokens = estimateChatGptWebInputTokens(request, { localToolsEnabled: true, solAvailable: true, proAvailable: true });
  expect(tokens).toBeGreaterThan(0);
  expect(tokens).toBeLessThan(32000);
});

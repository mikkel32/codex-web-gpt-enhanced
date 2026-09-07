import { expect, test } from "bun:test";
import { defaultConfig } from "../src/config";
import { compactRequest, responseRequest } from "../src/server";
import { assertWebRequestCompatibility } from "../src/web-request-compatibility";
import { encodeCompactionSummary } from "../src/responses/compaction";

const unsupported = [
  { service_tier: "fast" }, { service_tier: "priority" }, { service_tier: "flex" },
  { background: true },
  { input: [{ type: "configuration_update", reasoning: { effort: "high" } }] },
  { tools: [{ type: "function", name: "slow_tool", async: true }] },
  { input: [{ type: "additional_tools", tools: [{ type: "namespace", name: "work", tools: [{ type: "function", name: "slow_tool", async: true }] }] }] },
];

test("unsupported native settings fail before creating a Web adapter", async () => {
  for (const fields of unsupported) {
    let starts = 0, activity = 0;
    const result = await responseRequest(new Request("http://localhost/v1/responses", {
      method: "POST", body: JSON.stringify({ model: "chatgpt-web/astra-pro", input: "Synthetic request", ...fields }),
    }), { ...defaultConfig("full"), proAvailable: true }, () => { starts++; throw new Error("must not start"); }, { onWebRequest: () => { activity++; } });
    expect(result.status).toBe(400);
    expect(starts).toBe(0);
    expect(activity).toBe(0);
    expect(JSON.stringify(await result.json())).toContain("ChatGPT Web");
  }
});

test("unary Web compaction also rejects unsupported configuration updates before adapter creation", async () => {
  let starts = 0;
  const result = await compactRequest(new Request("http://localhost/v1/responses/compact", {
    method: "POST", body: JSON.stringify({ model: "chatgpt-web/astra-pro", input: [{ type: "configuration_update", reasoning: { effort: "high" } }] }),
  }), { ...defaultConfig("full"), proAvailable: true }, () => { starts++; throw new Error("must not start"); });
  expect(result.status).toBe(400); expect(starts).toBe(0);
});

test("ordinary Web requests retain supported synchronous and host-tool settings", () => {
  for (const service_tier of [undefined, "auto", "default"]) {
    expect(() => assertWebRequestCompatibility({ service_tier, background: false,
      tools: [{ type: "namespace", name: "notes", tools: [{ type: "function", name: "read", async: false }] }],
      input: [{ type: "function_call_output", call_id: "notes_1", output: "Saved checkpoint" }],
    })).not.toThrow();
  }
});

test("native routes forward native settings unchanged", async () => {
  for (const fields of unsupported) {
    const body = { model: "gpt-6-astra", input: "Synthetic native request", ...fields };
    let forwarded: unknown;
    const result = await responseRequest(new Request("http://localhost/v1/responses", {
      method: "POST", headers: { authorization: "Bearer synthetic-native-token", originator: "codex_cli_rs" }, body: JSON.stringify(body),
    }), defaultConfig("full"), undefined, { fetchUpstream: async request => { forwarded = await request.json(); return Response.json({ ok: true }); } });
    expect(result.status).toBe(200);
    expect(forwarded).toEqual(body);
  }
});

test("notes and history tools and their results survive a checkpointed Web continuation", async () => {
  let inspected = false;
  const result = await responseRequest(new Request("http://localhost/v1/responses", {
    method: "POST", body: JSON.stringify({ model: "chatgpt-web/astra-pro", stream: false,
      metadata: { thread_id: "compat_notes_history", turn_id: "compat_continue" },
      tools: ["notes", "history"].map(name => ({ type: "namespace", name, tools: [{ type: "function", name: "read", parameters: { type: "object" } }] })),
      input: [
        { type: "compaction", encrypted_content: encodeCompactionSummary("Keep the original objective. The durable note is checkpoint.md.") },
        { role: "user", content: "Continue the original task using the saved note and history result." },
        { type: "function_call", call_id: "note_read", name: "read", namespace: "notes", arguments: '{"path":"checkpoint.md"}' },
        { type: "function_call_output", call_id: "note_read", output: "NOTE_SENTINEL: job 42 is already running." },
        { type: "function_call", call_id: "history_read", name: "read", namespace: "history", arguments: "{}" },
        { type: "function_call_output", call_id: "history_read", output: "HISTORY_SENTINEL: do not restart job 42." },
      ],
    }),
  }), { ...defaultConfig("full"), proAvailable: true }, () => ({ name: "compatibility-fixture", async runTurn(parsed, _request, emit) {
    inspected = true;
    expect(parsed.context.tools?.map(tool => tool.namespace)).toEqual(["notes", "history"]);
    const context = JSON.stringify(parsed.context.messages);
    for (const marker of ["original objective", "NOTE_SENTINEL", "HISTORY_SENTINEL"]) expect(context).toContain(marker);
    expect(context).not.toContain("earlier conversation was compacted");
    emit({ type: "text_delta", text: "CONTEXT_TOOLS_OK", phase: "final_answer" });
    emit({ type: "done", stopReason: "stop", endTurn: true });
  } }));
  expect(result.status).toBe(200);
  expect(inspected).toBeTrue();
});

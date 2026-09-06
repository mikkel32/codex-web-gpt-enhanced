import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ResponseHistoryStore } from "../src/responses/history-store";
import { expandPreviousResponseInput, flushResponseState, previousResponseReplayPrefixLength, rememberResponseState } from "../src/responses/state";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "maria-history-"));
  return { root, path: join(root, "responses-state.json"), dispose: () => rmSync(root, { recursive: true, force: true }) };
}

test("two hundred responses share their prefix and survive restart without flattened snapshot duplication", () => {
  const f = fixture();
  try {
    const store = new ResponseHistoryStore({ path: f.path });
    const history: unknown[] = [{ role: "user", content: "context:" + "x".repeat(100000) }];
    let flattenedBytes = 0;
    for (let index = 0; index < 200; index++) {
      history.push({ type: "function_call_output", call_id: `call-${index}`, output: `result-${index}` });
      expect(store.remember(`resp-${index}`, history)).toBe(true);
      flattenedBytes += Buffer.byteLength(JSON.stringify(history));
    }
    expect(store.stats().nodes).toBe(201);
    expect(store.stats().responses).toBe(200);
    expect(store.stats().uniquePayloadBytes).toBeLessThan(130000);
    expect(store.expand("resp-199")).toEqual(history);
    expect(store.flush()).toBe(true);
    const snapshotBytes = statSync(f.path).size;
    expect(flattenedBytes / snapshotBytes).toBeGreaterThan(50);
    const restored = new ResponseHistoryStore({ path: f.path });
    expect(restored.expand("resp-199")).toEqual(history);
    expect(restored.expand("resp-0")).toEqual(history.slice(0, 2));
    console.info(`[history-cache] responses=200 nodes=${store.stats().nodes} flatPayloadBytes=${flattenedBytes} snapshotBytes=${snapshotBytes}`);
  } finally { f.dispose(); }
});

test("evicting an ancestor response ID does not discard history still needed by a child", () => {
  const f = fixture(); let at = 0;
  try {
    const options = { path: f.path, now: () => at, ttlMs: 100, maxResponses: 2 };
    const store = new ResponseHistoryStore(options);
    store.remember("parent", ["parent"]);
    at = 80; store.remember("child", ["parent", "child"]);
    at = 101;
    expect(store.expand("parent")).toBeUndefined();
    expect(store.expand("child")).toEqual(["parent", "child"]);
    store.flush();
    expect(new ResponseHistoryStore(options).expand("child")).toEqual(["parent", "child"]);
    at = 181;
    expect(store.expand("child")).toBeUndefined();
    expect(store.stats()).toEqual({ responses: 0, nodes: 0, uniquePayloadBytes: 0, accountedBytes: 0 });
  } finally { f.dispose(); }
});

test("branches share only equal prefixes and caller mutation cannot corrupt cached history", () => {
  const store = new ResponseHistoryStore({ maxResponses: 2 });
  const source = [{ role: "user", content: { text: "original" } }];
  store.remember("root", source);
  source[0]!.content.text = "edited by caller";
  const parent = store.expand("root")!;
  store.remember("left", [...parent, "left"]);
  store.remember("right", [...parent, "right"]);
  expect(store.expand("root")).toBeUndefined();
  expect(store.stats().nodes).toBe(3);
  (parent[0] as { content: { text: string } }).content.text = "mutated expansion";
  expect(store.expand("left")).toEqual([{ role: "user", content: { text: "original" } }, "left"]);
  expect(store.expand("right")).toEqual([{ role: "user", content: { text: "original" } }, "right"]);
  store.remember("right", store.expand("right")!);
  expect(store.stats().nodes).toBe(3);
});

test("legacy snapshots migrate with exact native goal and tool metadata", () => {
  const f = fixture();
  try {
    const items = [
      { type: "message", role: "user", content: [{ type: "input_text", text: "<goal_context>Finish migration</goal_context>" }],
        internal_chat_message_metadata_passthrough: { turn_id: "goal-turn", content_item_kinds: ["goal.internal_context"] } },
      { type: "function_call_output", call_id: "call-1", output: { state: "running", session_id: 42 } },
    ];
    writeFileSync(f.path, JSON.stringify({ version: 1, states: [["legacy", { createdAt: 10, items, sizeBytes: 0 }]] }));
    const store = new ResponseHistoryStore({ path: f.path, now: () => 20 });
    expect(store.expand("legacy")).toEqual(items);
    store.remember("continued", [...items, { type: "message", role: "user", content: "Observe session 42" }]);
    expect(store.flush()).toBe(true);
    expect(JSON.parse(readFileSync(f.path, "utf8")).version).toBe(2);
    expect(new ResponseHistoryStore({ path: f.path, now: () => 30 }).expand("continued")).toEqual([
      ...items, { type: "message", role: "user", content: "Observe session 42" },
    ]);
    if (process.platform !== "win32") expect(statSync(f.path).mode & 0o777).toBe(0o600);
  } finally { f.dispose(); }
});

test("missing or corrupted prefix nodes invalidate dependent responses rather than returning partial context", () => {
  const f = fixture();
  try {
    const store = new ResponseHistoryStore({ path: f.path });
    store.remember("chain", ["required prefix", "last tool result"]);
    store.remember("independent", ["another task"]); store.flush();
    const original = JSON.parse(readFileSync(f.path, "utf8"));
    for (const corrupt of [false, true]) {
      const snapshot = structuredClone(original);
      if (corrupt) snapshot.nodes[0][1].itemJson = JSON.stringify("forged prefix");
      else snapshot.nodes.shift();
      writeFileSync(f.path, JSON.stringify(snapshot));
      const restored = new ResponseHistoryStore({ path: f.path });
      expect(restored.expand("chain")).toBeUndefined();
      expect(restored.expand("independent")).toEqual(["another task"]);
    }
  } finally { f.dispose(); }
});

test("UTF-8 budgets are enforced and oversized dependencies are never partially persisted", () => {
  const limited = new ResponseHistoryStore({ maxBytes: 700 });
  limited.remember("small", ["ok"]);
  expect(limited.remember("too-large", ["界".repeat(200)])).toBe(false);
  expect(limited.expand("too-large")).toBeUndefined();
  expect(limited.expand("small")).toEqual(["ok"]);
  expect(limited.stats().accountedBytes).toBeLessThanOrEqual(700);
  const f = fixture();
  try {
    const options = { path: f.path, snapshotNodeMaxBytes: 300, snapshotMaxBytes: 2000 };
    const store = new ResponseHistoryStore(options);
    store.remember("large-parent", ["界".repeat(200)]);
    store.remember("child", ["界".repeat(200), "small tail"]);
    store.remember("independent", ["ok"]);
    expect(store.flush()).toBe(true);
    expect(statSync(f.path).size).toBeLessThanOrEqual(2000);
    const restored = new ResponseHistoryStore(options);
    expect(restored.expand("child")).toBeUndefined();
    expect(restored.expand("independent")).toEqual(["ok"]);
  } finally { f.dispose(); }
});

test("a chain exceeding the old per-response disk limit remains restorable when its individual items fit", () => {
  const f = fixture();
  try {
    const store = new ResponseHistoryStore({ path: f.path });
    const history: unknown[] = [];
    for (let index = 0; index < 40; index++) {
      history.push({ content: `${index}:` + "x".repeat(70000) });
      store.remember(`response-${index}`, history);
    }
    expect(Buffer.byteLength(JSON.stringify(history))).toBeGreaterThan(2 * 1024 * 1024);
    expect(store.flush()).toBe(true);
    expect(new ResponseHistoryStore({ path: f.path }).expand("response-39")).toEqual(history);
    expect(statSync(f.path).size).toBeLessThan(3 * 1024 * 1024);
  } finally { f.dispose(); }
});

test("the compatibility API preserves private expansion provenance and completed-response admission rules", () => {
  const f = fixture(); const prior = process.env.CODEX_CHATGPT_WEB_HOME;
  process.env.CODEX_CHATGPT_WEB_HOME = f.root;
  try {
    const input = { input: [{ role: "user", content: "Goal" }], store: false };
    rememberResponseState(input, { id: "skipped", output: [] });
    const miss = { previous_response_id: "skipped", input: [] };
    expect(expandPreviousResponseInput(miss)).toBe(miss);
    rememberResponseState(input, { id: "done", status: "completed", output: [{ role: "assistant", content: "Working" }] }, { force: true });
    const expanded = expandPreviousResponseInput({ previous_response_id: "done", input: "Continue" }) as { input: unknown[] };
    expect(expanded.input).toHaveLength(3);
    expect(previousResponseReplayPrefixLength(expanded)).toBe(2);
    expect(expandPreviousResponseInput(expanded)).toBe(expanded);
    expect(previousResponseReplayPrefixLength({ ...expanded })).toBe(0);
    for (const status of ["failed", "cancelled"]) rememberResponseState(input, { id: status, status, output: [] }, { force: true });
    rememberResponseState(input, { id: "filtered", status: "incomplete", incomplete_details: { reason: "content_filter" }, output: [] }, { force: true });
    for (const id of ["failed", "cancelled", "filtered"]) {
      const request = { previous_response_id: id, input: [] };
      expect(expandPreviousResponseInput(request)).toBe(request);
    }
    rememberResponseState(input, { id: "partial", status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [] }, { force: true });
    const partial = { previous_response_id: "partial", input: [] };
    expect(expandPreviousResponseInput(partial)).not.toBe(partial);
  } finally {
    flushResponseState();
    if (prior === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME; else process.env.CODEX_CHATGPT_WEB_HOME = prior;
    f.dispose();
  }
});

test("in-flight writes and lookups stay with the runtime home that owned their request", () => {
  const a = fixture(), b = fixture(), prior = process.env.CODEX_CHATGPT_WEB_HOME;
  try {
    process.env.CODEX_CHATGPT_WEB_HOME = a.root;
    const startedInA = expandPreviousResponseInput({ input: ["scope-a"] });
    process.env.CODEX_CHATGPT_WEB_HOME = b.root;
    rememberResponseState({ input: ["scope-b"] }, { id: "same-id", output: [] });
    rememberResponseState(startedInA, { id: "same-id", output: [] });
    expect((expandPreviousResponseInput({ previous_response_id: "same-id" }) as { input: unknown[] }).input).toEqual(["scope-b"]);
    process.env.CODEX_CHATGPT_WEB_HOME = a.root;
    expect((expandPreviousResponseInput({ previous_response_id: "same-id" }) as { input: unknown[] }).input).toEqual(["scope-a"]);
    flushResponseState();
    expect(new ResponseHistoryStore({ path: a.path }).expand("same-id")).toEqual(["scope-a"]);
    expect(new ResponseHistoryStore({ path: b.path }).expand("same-id")).toEqual(["scope-b"]);
  } finally {
    flushResponseState();
    if (prior === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME; else process.env.CODEX_CHATGPT_WEB_HOME = prior;
    a.dispose(); b.dispose();
  }
});

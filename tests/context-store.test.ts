import { expect, test } from "bun:test";
import { NativeContextStore } from "../src/adapters/chatgpt-web/context-store";
import { nativeContextResult, NATIVE_CONTEXT_RESULT_BYTE_LIMIT, type NativeContextFile } from "../src/adapters/chatgpt-web/native-context";

const core: NativeContextFile[] = [
  { name: "codex-context-1-of-2.json", text: JSON.stringify({ instructions: "x".repeat(24000) }), required: true },
  { name: "codex-context-2-of-2.json", text: "{}", required: true },
];
function acknowledge(store: NativeContextStore, file: NativeContextFile) {
  let page = store.read(file.name, 0);
  let text = page.text;
  while (page.next_offset !== null) { page = store.read(file.name, page.next_offset, page.receipt); text += page.text; }
  expect(store.read(file.name, page.total_chars, page.receipt).acknowledged).toBe(true);
  return text;
}

test("served pages cannot unlock work until their receipts are acknowledged", () => {
  const store = new NativeContextStore(core, { requireReceipts: true });
  const first = store.read(core[0]!.name, 0);
  expect(store.missingRequired()).toEqual(core.map(file => file.name));
  expect(() => store.read(core[0]!.name, first.next_offset!)).toThrow("receipt");
  expect(store.read(core[0]!.name, 0)).toEqual(first);
  expect(acknowledge(store, core[0]!)).toBe(core[0]!.text);
  expect(store.missingRequired()).toEqual([core[1]!.name]);
  acknowledge(store, core[1]!);
  expect(store.missingRequired()).toEqual([]);
  expect(store.read(core[0]!.name, first.next_offset!, first.receipt).offset).toBe(first.next_offset!);
});

test("receipts cannot cross tasks or authorize unseen pages", () => {
  const first = new NativeContextStore(core, { requireReceipts: true });
  const other = new NativeContextStore(core, { requireReceipts: true });
  const page = first.read(core[0]!.name, 0);
  expect(() => other.read(core[0]!.name, page.next_offset!, page.receipt)).toThrow("receipt is invalid");
  expect(() => first.read(core[0]!.name, core[0]!.text.length, page.receipt)).toThrow("offset");
  expect(() => first.read(core[0]!.name, 0, "forged")).toThrow("receipt");
});

test("a rejected offset does not consume the accompanying valid receipt", () => {
  const store = new NativeContextStore(core, { requireReceipts: true });
  const first = store.read(core[0]!.name, 0);
  const before = store.pendingRequired();
  expect(() => store.read(first.name, first.total_chars, first.receipt)).toThrow("offset");
  expect(store.pendingRequired()).toEqual(before);
  expect(() => store.read(first.name, first.next_offset!)).toThrow("receipt");
  expect(store.read(first.name, first.next_offset!, first.receipt).offset).toBe(first.next_offset!);
});

test("an over-budget evidence read cannot acknowledge the last required page", () => {
  const required = { name: core[0]!.name, text: "{}" };
  const evidence: NativeContextFile = { name: "codex-evidence-0123456789abcdef.txt",
    text: "evidence that exceeds the budget", kind: "evidence", required: false };
  const store = new NativeContextStore([required, evidence], { requireReceipts: true, optionalTokenBudget: 0 });
  const page = store.read(required.name, 0);
  const before = store.pendingRequired();
  expect(() => store.read(evidence.name, 0, page.receipt)).toThrow("budget");
  expect(store.pendingRequired()).toEqual(before);
  expect(() => store.search("evidence")).toThrow("required context");
  expect(store.read(required.name, page.total_chars, page.receipt).acknowledged).toBe(true);
});

test("optional evidence is searchable without becoming a mandatory full-history read", () => {
  const evidence: NativeContextFile = { name: "codex-evidence-0123456789abcdef.txt", text: "noise ".repeat(10000) + "rare-target-value", kind: "evidence", required: false };
  const store = new NativeContextStore([...core, evidence], { requireReceipts: true });
  expect(() => store.search("rare-target")).toThrow("required context");
  core.forEach(file => acknowledge(store, file));
  expect(store.missingRequired()).toEqual([]);
  const found = store.search("rare-target");
  expect(found.matches).toHaveLength(1);
  expect(found.matches[0]!.offset).toBeGreaterThan(0);
  const page = store.read(evidence.name, found.matches[0]!.offset);
  expect(page.text).toContain("rare-target-value");
  expect(store.read(evidence.name, page.offset)).toEqual(page);
  expect(store.search("rare-target").remaining_retrieval_tokens!).toBeLessThan(found.remaining_retrieval_tokens!);
});

test("ChatGPT-managed retrieval reads beyond the old token allowance while retaining receipt gates", () => {
  const evidence: NativeContextFile = { name: "codex-evidence-0123456789abcdef.txt",
    text: "alpha beta gamma delta\n".repeat(40_000), required: false, kind: "evidence" };
  const store = new NativeContextStore([...core, evidence], { requireReceipts: true, optionalTokenBudget: null });
  expect(() => store.search("delta")).toThrow("required context");
  core.forEach(file => acknowledge(store, file));
  let offset = 0, restored = "";
  for (;;) {
    const page = store.read(evidence.name, offset);
    restored += page.text;
    if (page.next_offset === null) break;
    offset = page.next_offset;
  }
  expect(restored).toBe(evidence.text);
  expect(store.search("delta").remaining_retrieval_tokens).toBeNull();
});

test("optional retrieval respects a finite budget while identical retries are free", () => {
  const evidence: NativeContextFile = { name: "codex-evidence-0123456789abcdef.txt", text: "alpha beta ".repeat(5000), kind: "evidence", required: false };
  const store = new NativeContextStore([...core, evidence], { optionalTokenBudget: 3000 });
  core.forEach(file => {
    let page = store.read(file.name, 0);
    while (page.next_offset !== null) page = store.read(file.name, page.next_offset);
  });
  const first = store.read(evidence.name, 0);
  const remaining = store.search("alpha").remaining_retrieval_tokens;
  expect(store.read(evidence.name, 0)).toEqual(first);
  expect(store.search("alpha").remaining_retrieval_tokens).toBe(remaining);
  expect(() => store.read(evidence.name, first.next_offset!)).toThrow("budget");
});

test("images return a multimodal result and require their own acknowledgement", () => {
  const file: NativeContextFile = { name: "codex-input-image-1", text: "", kind: "image", mimeType: "image/png", imageData: "AQID", required: true };
  const store = new NativeContextStore([file], { requireReceipts: true });
  const page = store.read(file.name, 0);
  const result = nativeContextResult(page);
  expect(result.content[1]).toEqual({ type: "image", mimeType: "image/png", data: "AQID" });
  expect(JSON.stringify(result.content[0])).not.toContain("AQID");
  expect(store.missingRequired()).toEqual([file.name]);
  expect(store.read(file.name, 1, page.receipt).acknowledged).toBe(true);
  expect(store.missingRequired()).toEqual([]);
});

test("receipt-bearing Unicode pages remain under the encoded byte cap", () => {
  const file = { name: core[0]!.name, text: JSON.stringify({ value: "\u{1F680}\u00e6\"\\".repeat(20000) }) };
  const store = new NativeContextStore([file], { requireReceipts: true });
  let page = store.read(file.name, 0), text = page.text;
  for (;;) {
    expect(Buffer.byteLength(JSON.stringify(nativeContextResult(page)), "utf8")).toBeLessThanOrEqual(NATIVE_CONTEXT_RESULT_BYTE_LIMIT);
    if (page.next_offset === null) break;
    page = store.read(file.name, page.next_offset, page.receipt); text += page.text;
  }
  expect(text).toBe(file.text);
  store.read(file.name, page.total_chars, page.receipt);
  expect(store.missingRequired()).toEqual([]);
});


test("a mistyped receipt offers bounded replay of an already served page without advancing acknowledgement", () => {
  const store = new NativeContextStore(core, { requireReceipts: true });
  const first = store.read(core[0]!.name, 0);
  const second = store.read(first.name, first.next_offset!, first.receipt);
  const pending = store.pendingRequired();
  let failure: any;
  try { store.read(second.name, second.next_offset!, "x".repeat(43)); } catch (error) { failure = error; }
  expect(failure.result).toMatchObject({ code: "context_receipt_invalid", retryable: false,
    recovery: { action: "reread_context_page", read: { name: second.name, offset: second.offset } } });
  expect(failure.result.recovery.read).not.toHaveProperty("receipt");
  expect(store.pendingRequired()).toEqual(pending);
  expect(() => store.search("task")).toThrow("required context");
  const replay = store.read(failure.result.recovery.read.name, failure.result.recovery.read.offset);
  expect(replay).toEqual(second);
  expect(replay.next_read).toEqual({ name: second.name, offset: second.next_offset!, receipt: second.receipt! });
  const third = store.read(replay.next_read!.name, replay.next_read!.offset, replay.next_read!.receipt);
  expect(first.text + second.text + third.text).toBe(core[0]!.text);
  store.read(third.name, third.total_chars, third.receipt);
  acknowledge(store, core[1]!);
  expect(store.missingRequired()).toEqual([]);
});

test("invalid receipts never unlock another task and repeated corrections have a finite budget", () => {
  const owner = new NativeContextStore(core, { requireReceipts: true });
  const other = new NativeContextStore(core, { requireReceipts: true });
  const first = owner.read(core[0]!.name, 0);
  let failure: any;
  try { other.read(first.name, 0, first.receipt); } catch (error) { failure = error; }
  expect(failure.result.code).toBe("context_receipt_invalid");
  expect(failure.result.recovery).toBeUndefined();
  expect(other.pendingRequired().every(page => page.offset === 0 && page.served_to === 0)).toBe(true);
  for (let attempt = 0; attempt < 3; attempt++) {
    try { owner.read(first.name, first.next_offset!, "wrong".padEnd(43, "x")); } catch (error) { failure = error; }
    expect(Boolean(failure.result.recovery)).toBe(attempt < 2);
    expect(owner.pendingRequired()[0]!.offset).toBe(0);
    expect(owner.read(first.name, 0)).toEqual(first);
  }
  expect(owner.read(first.name, first.next_offset!, first.receipt).offset).toBe(first.next_offset!);
});

import { expect, test } from "bun:test";
import { ChatGptBrowserWorker } from "../src/adapters/chatgpt-web/browser-worker";

const methods = ChatGptBrowserWorker.prototype as any;
const names = ["codex-context-1-of-2.json", "codex-context-2-of-2.json"];
const prompt = { text: "read both files", images: [], multipart: { parts: ["{}", "{}"], commit: "read both" } };

function fixture() {
  const present = new Set(names);
  const busy = new Set<string>();
  let sends = 0, activated = 0;
  let uploaded: string[] = [];
  const button = { waitFor: async () => {}, isEnabled: async () => true, press: async () => { sends++; } };
  const input = { first() { return this; }, waitFor: async () => {}, setInputFiles: async (files: { name: string }[]) => { uploaded = files.map(f => f.name); } };
  const form = {
    locator: (selector: string) => {
      expect(selector).toBe('input[type="file"]:not([accept]), input[type="file"][accept=""]');
      return input;
    },
    getByTestId: () => button,
    getByRole: (_role: string, options: { name: string }) => ({
      waitFor: async () => {}, // Filename cards existed initially, but may disappear later.
      isVisible: async () => present.has(options.name),
      getAttribute: async () => busy.has(options.name) ? "true" : null,
      locator: () => ({ count: async () => 0 }),
      getByRole: () => ({ last: () => ({ click: async () => { present.delete(options.name); } }) }),
    }),
  };
  const hidden = { filter() { return this; }, last() { return this; }, isVisible: async () => false };
  const page = { isClosed: () => false, locator: () => hidden };
  const worker = { activeComposer: async () => ({ locator: () => form }),
    assertPromptFilesReady: methods.assertPromptFilesReady,
    waitForSubmissionAcceptedWithRecovery: async () => "user_turn" };
  return { page, worker, present, busy, uploaded: () => uploaded, sends: () => sends, activated: () => activated,
    send: (capture?: (checkpoint: string) => Promise<void>) => methods.sendAttachedPrompt.call(worker, page, {}, capture,
      undefined, undefined, { onSendActivated: async () => { activated++; } }, undefined, undefined, names) };
}

test("context JSON uses the active form's document picker in one atomic upload", async () => {
  const f = fixture();
  await methods.attachFiles.call(f.worker, f.page, prompt);
  expect(f.uploaded()).toEqual(names);
});

test("enabled Send cannot hide attachments discarded after their cards appeared", async () => {
  const f = fixture(); f.present.clear();
  await expect(methods.attachFiles.call(f.worker, f.page, prompt)).rejects.toThrow("No prompt was sent");
  expect(f.sends()).toBe(0);
});

test("the final Send boundary rejects a file removed after successful preparation", async () => {
  const f = fixture();
  await methods.attachFiles.call(f.worker, f.page, prompt);
  await expect(f.send(async () => { f.present.delete(names[1]!); })).rejects.toThrow(names[1]!);
  expect(f.activated()).toBe(0); expect(f.sends()).toBe(0);
});

test("a busy attachment cannot authorize Send even if its filename is visible", async () => {
  const f = fixture(); f.busy.add(names[0]!);
  await expect(f.send()).rejects.toThrow("still uploading");
  expect(f.activated()).toBe(0); expect(f.sends()).toBe(0);
});

test("two complete files permit exactly one Send", async () => {
  const f = fixture();
  await expect(f.send()).resolves.toBe("user_turn");
  expect(f.activated()).toBe(1); expect(f.sends()).toBe(1);
});

test("cancellation before upload preserves the composer", async () => {
  const f = fixture(); const controller = new AbortController(); controller.abort();
  await expect(methods.attachFiles.call(f.worker, f.page, prompt, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(f.uploaded()).toEqual([]);
});

test("native context removes only the prior transport cards without uploading documents", async () => {
  const f = fixture();
  f.present.add("user-document.pdf");
  await methods.attachFiles.call(f.worker, f.page, { ...prompt, nativeContext: true });
  expect([...f.present]).toEqual(["user-document.pdf"]);
  expect(f.uploaded()).toEqual([]);
});

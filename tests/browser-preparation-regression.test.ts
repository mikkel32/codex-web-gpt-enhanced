import { expect, test } from "bun:test";
import { ChatGptBrowserWorker } from "../src/adapters/chatgpt-web/browser-worker";

test("restored chat baseline waits for the old answer after composer hydration", async () => {
  const events: string[] = [];
  const capture = (ChatGptBrowserWorker.prototype as unknown as {
    captureSubmissionBaseline(page: unknown, retained: boolean): Promise<{ initialResponseTurnIdentities: string[] }>;
  }).captureSubmissionBaseline;
  const page = { locator: () => ({ last: () => ({ waitFor: async () => { events.push("history-ready"); } }) }) };
  const result = await capture.call({
    activeComposer: async () => { events.push("composer-ready"); },
    submissionDomState: async () => {
      expect(events).toEqual(["composer-ready", "history-ready"]);
      return { userTurnCount: 1, assistantTurnCount: 1, visibleStopButtonCount: 0, userIdentities: ["old-user"], responseIdentities: ["old-answer"] };
    },
  }, page, true);
  expect(result.initialResponseTurnIdentities).toEqual(["old-answer"]);
});

test("restored chat cannot take a baseline while the previous answer is running", async () => {
  const capture = (ChatGptBrowserWorker.prototype as unknown as {
    captureSubmissionBaseline(page: unknown, retained: boolean, signal?: AbortSignal, timeout?: number): Promise<unknown>;
  }).captureSubmissionBaseline;
  await expect(capture.call({
    activeComposer: async () => {},
    submissionDomState: async () => ({ assistantTurnCount: 1, visibleStopButtonCount: 1 }),
  }, { locator: () => ({ last: () => ({ waitFor: async () => {} }) }) }, true, undefined, 5)).rejects.toThrow("no prompt was sent");
});

test("an immediate post-compaction follow-up waits for the old response to finish", async () => {
  const capture = (ChatGptBrowserWorker.prototype as any).captureSubmissionBaseline;
  let observations = 0;
  const result = await capture.call({ activeComposer: async () => {}, submissionDomState: async () => ({
    assistantTurnCount: 1, userTurnCount: 1, visibleStopButtonCount: observations++ === 0 ? 1 : 0,
    responseIdentities: ["previous-answer"], userIdentities: ["previous-user"],
  }) }, { locator: () => ({ last: () => ({ waitFor: async () => {} }) }) }, true, undefined, 1000);
  expect(observations).toBe(2);
  expect(result.initialResponseTurnIdentities).toEqual(["previous-answer"]);
});

test("saved chats select their connector without attempting a Temporary Chat personalization toggle", async () => {
  let selected = false;
  const composer = { fill: async () => {}, focus: async () => {}, pressSequentially: async () => {}, press: async () => { selected = true; } };
  const row = { count: async () => 1, waitFor: async () => {}, getAttribute: async () => "" };
  const select = (ChatGptBrowserWorker.prototype as unknown as {
    selectConnector(page: unknown, capture: unknown, refresh: boolean, budget: { triggerAttempts: number }, signal: undefined, saved: boolean): Promise<unknown>;
  }).selectConnector;
  const result = await select.call({
    config: { appName: "Codex Native2 Mac" },
    activeComposer: async () => composer,
    connectorIsSelected: async () => selected,
    connectorActivationSnapshot: async () => ({ generating: false, composerTexts: [""] }),
    selectedConnectorControl: () => ({ waitFor: async () => {} }),
  }, {
    locator: () => ({ filter: () => row }),
    getByText: () => ({}),
    getByRole: () => { throw new Error("Saved chat has no Temporary Chat personalization control"); },
  }, undefined, false, { triggerAttempts: 0 }, undefined, true);
  expect(result).toBe(composer);
  expect(selected).toBeTrue();
});

test("a persisted failed context draft is cleared before the next connector prompt", async () => {
  let text = "<codex_context_files>old unsent transport</codex_context_files>";
  let selected = true;
  const keys: string[] = [];
  const composer = { fill: async () => {}, focus: async () => {}, pressSequentially: async () => {},
    press: async (key: string) => { keys.push(key); if (key === "Backspace") { text = ""; selected = false; } if (key === "Enter") selected = true; } };
  const row = { count: async () => 1, waitFor: async () => {}, getAttribute: async () => "" };
  const select = (ChatGptBrowserWorker.prototype as any).selectConnector;
  await select.call({config:{appName:"Codex Native2 Mac"},activeComposer:async () => composer,
    connectorIsSelected:async () => selected,
    connectorActivationSnapshot:async () => ({generating:false,composerTexts:[text]}),
    selectedConnectorControl:() => ({waitFor:async () => {}})},
    {locator:() => ({filter:() => row}),getByText:() => ({})},undefined,false,{triggerAttempts:0},undefined,true);
  expect(keys).toEqual(["ControlOrMeta+A","Backspace","Enter"]);
  expect(text).toBe(""); expect(selected).toBe(true);
});


test("short connector mention insertion works when individual native key events are dropped", async () => {
  let text = "";
  let selected = false;
  let keyTyping = 0;
  const composer = {
    fill: async (value: string) => { text = value; },
    focus: async () => {},
    pressSequentially: async () => { keyTyping += 1; },
    press: async (key: string) => {
      expect(key).toBe("Enter"); expect(text).toBe("@codex");
      selected = true;
    },
  };
  const row = {
    count: async () => 1,
    waitFor: async () => {
      if (text !== "@codex") throw new Error("The connector mention never reached the composer");
    },
    getAttribute: async () => "",
  };
  const result = await (ChatGptBrowserWorker.prototype as any).selectConnector.call({
    config: { appName: "Codex Native2 Mac" }, activeComposer: async () => composer,
    connectorIsSelected: async () => selected,
    connectorActivationSnapshot: async () => ({ generating: false, composerTexts: [""] }),
    selectedConnectorControl: () => ({ waitFor: async () => { expect(selected).toBeTrue(); } }),
  }, { locator: () => ({ filter: () => row }), getByText: () => ({}) },
  undefined, false, { triggerAttempts: 0 }, undefined, true);
  expect(result).toBe(composer); expect(selected).toBeTrue(); expect(keyTyping).toBe(0);
});

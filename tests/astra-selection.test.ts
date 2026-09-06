import { expect, test } from "bun:test";
import type { Locator, Page } from "playwright-core";
import { assertChatGptAstraProReady, isChatGptAstraProBadge, selectChatGptAstraPro } from "../src/adapters/chatgpt-web/astra-selection";
import { activateChatGptEffortMenu } from "../src/chatgpt-session";
import { ChatGptBrowserWorker } from "../src/adapters/chatgpt-web/browser-worker";
import { resolveChatGptWebModelMode } from "../src/adapters/chatgpt-web/model";
import { availableChatGptWebModelRoutes, CHATGPT_WEB_ASTRA_BACKEND_MODEL, requireChatGptWebModelRoute } from "../src/chatgpt-web-models";

function picker(options: { badge?: string; closedBadge?: string; maximum?: number; jump?: number; powerDisabled?: boolean; onLatest?: () => void } = {}) {
  let position = 2, selected = false, submenu = false;
  const actions: string[] = [];
  const slider = { getAttribute: async (name: string) => String(name === "aria-valuemin" ? 0 : name === "aria-valuemax" ? options.maximum ?? 4 : position) };
  const model = { press: async () => { submenu = true; }, innerText: async () => selected ? options.badge ?? "6\nPro" : "5.6 Pro" };
  const latest = { waitFor: async () => { expect(submenu).toBe(true); }, getAttribute: async () => "false",
    press: async () => { selected = true; submenu = false; actions.push("Latest"); options.onLatest?.(); } };
  const power = { waitFor: async () => { expect(submenu).toBe(false); }, locator: () => slider,
    getAttribute: async () => options.powerDisabled ? "true" : "false",
    press: async (key: string) => { actions.push(key); position += options.jump ?? 1; } };
  const menu = { isVisible: async () => true, filter() { return this; }, last() { return this; },
    getByRole: (_role: string, query: { name: string }) => query.name === "Select model" ? model : query.name === "Latest" ? latest : power };
  const control = { getAttribute: async () => "owned-menu", innerText: async () => options.closedBadge ?? options.badge ?? "6 Pro" };
  const page = { locator: () => menu, keyboard: { press: async (key: string) => { actions.push(key); } } };
  return { page: page as unknown as Page, control: control as unknown as Locator, actions };
}

test("Astra Pro selects Latest, reaches Pro in verified steps, and confirms the actual generation", async () => {
  const fixture = picker();
  await selectChatGptAstraPro(fixture.page, fixture.control);
  expect(fixture.actions).toEqual(["Latest", "ArrowRight", "ArrowRight", "Escape"]);
});

test("old Pro generations, changed badges, missing Pro, and unexpected power movement fail terminally", async () => {
  for (const options of [{ badge: "5.6 Pro" }, { badge: "Latest" }, { closedBadge: "5.6 Pro" }, { maximum: 3 }, { jump: 2 }, { powerDisabled: true }]) {
    const fixture = picker(options);
    await expect(selectChatGptAstraPro(fixture.page, fixture.control)).rejects.toMatchObject({ code: "astra_pro_unavailable", retryable: false });
  }
  expect(isChatGptAstraProBadge("GPT-6 Pro")).toBe(true);
  expect(isChatGptAstraProBadge("GPT-6 Extra High")).toBe(false);
  expect(isChatGptAstraProBadge("16 Pro")).toBe(false);
});

test("cancelling selection preserves cancellation and prevents further picker mutations", async () => {
  const controller = new AbortController();
  const reason = new DOMException("User stopped this turn", "AbortError");
  const fixture = picker({ onLatest: () => controller.abort(reason) });
  await expect(selectChatGptAstraPro(fixture.page, fixture.control, controller.signal)).rejects.toBe(reason);
  expect(fixture.actions).toEqual(["Latest"]);
  const alreadyCancelled = picker();
  await expect(selectChatGptAstraPro(alreadyCancelled.page, alreadyCancelled.control, controller.signal)).rejects.toBe(reason);
  expect(alreadyCancelled.actions).toEqual([]);
});

test("cancellation during menu activation prevents pointer fallback", async () => {
  const controller = new AbortController();
  const actions: string[] = [];
  const hidden = { filter() { return this; }, last() { return this; }, isVisible: async () => false };
  const page = { locator: () => hidden, keyboard: { press: async () => { actions.push("Escape"); } } } as unknown as Page;
  const control = { getAttribute: async () => null,
    click: async () => { actions.push("click"); controller.abort(); },
    dispatchEvent: async () => { actions.push("pointerdown"); },
  } as unknown as Locator;
  await expect(activateChatGptEffortMenu(page, control, { signal: controller.signal, settleMs: 5 })).rejects.toMatchObject({ name: "AbortError" });
  expect(actions).toEqual(["click"]);
});

test("a cancelled final badge read cannot authorize submission", async () => {
  const controller = new AbortController();
  const control = { innerText: async () => { controller.abort(); return "6 Pro"; } } as unknown as Locator;
  await expect(assertChatGptAstraProReady(control, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
});

test("the real Send boundary rechecks Astra after preparation, including reused conversations", async () => {
  const send = (ChatGptBrowserWorker.prototype as unknown as {
    sendAttachedPrompt(page: Page, baseline: unknown, capture: (checkpoint: string) => Promise<void>, signal: AbortSignal,
      progress: undefined, lifecycle: { modelId: string; onSendActivated(): Promise<void> }): Promise<string>;
  }).sendAttachedPrompt;
  for (const badgeAtSend of ["6 Pro", "5.6 Pro", "High", "missing"]) {
    let badge = "6 Pro", sends = 0, activated = 0;
    const hidden = { filter() { return this; }, last() { return this; }, isVisible: async () => false };
    const page = { isClosed: () => false, locator: () => hidden } as unknown as Page;
    const control = { filter() { return this; }, last() { return this; }, innerText: async () => {
      if (badge === "missing") throw new Error("Control detached");
      return badge;
    } };
    const button = { waitFor: async () => {}, isEnabled: async () => true, press: async () => { sends++; } };
    const worker = { activeComposer: async () => ({ locator: () => ({ getByTestId: () => button, locator: () => control }) }),
      waitForSubmissionAcceptedWithRecovery: async () => "user_turn" };
    const result = send.call(worker, page, {}, async checkpoint => { if (checkpoint === "send-ready") badge = badgeAtSend; },
      new AbortController().signal, undefined, { modelId: CHATGPT_WEB_ASTRA_BACKEND_MODEL, onSendActivated: async () => { activated++; } });
    if (badgeAtSend === "6 Pro") {
      await expect(result).resolves.toBe("user_turn"); expect(sends).toBe(1); expect(activated).toBe(1);
    } else {
      await expect(result).rejects.toMatchObject({ code: "astra_pro_unavailable", retryable: false });
      expect(sends).toBe(0); expect(activated).toBe(0);
    }
  }
});

test("only the verified Astra Pro route is offered and cannot be downgraded to unverified reasoning", () => {
  const capabilities = { localToolsEnabled: true, solAvailable: true, proAvailable: true };
  expect(requireChatGptWebModelRoute("chatgpt-web/astra-pro", capabilities)).toMatchObject({ backendModel: CHATGPT_WEB_ASTRA_BACKEND_MODEL, adapterEffort: "max", codexEffort: "ultra" });
  expect(resolveChatGptWebModelMode(CHATGPT_WEB_ASTRA_BACKEND_MODEL, "max", capabilities)).toMatchObject({ displayLabel: "Astra Pro", localTools: true });
  for (const effort of ["low", "medium", "high", "xhigh"]) expect(() => resolveChatGptWebModelMode(CHATGPT_WEB_ASTRA_BACKEND_MODEL, effort, capabilities)).toThrow("only verified at Pro");
  expect(availableChatGptWebModelRoutes({ ...capabilities, proAvailable: false }).some(route => route.backendModel === CHATGPT_WEB_ASTRA_BACKEND_MODEL)).toBe(false);
});

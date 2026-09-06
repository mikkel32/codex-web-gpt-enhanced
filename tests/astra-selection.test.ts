import { expect, test } from "bun:test";
import type { Locator, Page } from "playwright-core";
import { assertChatGptAstraProReady, selectChatGptAstraPro } from "../src/adapters/chatgpt-web/astra-selection";
import { activateChatGptEffortMenu } from "../src/chatgpt-session";
import { ChatGptBrowserWorker } from "../src/adapters/chatgpt-web/browser-worker";
import { resolveChatGptWebModelMode } from "../src/adapters/chatgpt-web/model";
import { availableChatGptWebModelRoutes, CHATGPT_WEB_ASTRA_BACKEND_MODEL, requireChatGptWebModelRoute } from "../src/chatgpt-web-models";

function picker(options: { badge?: string; closedBadge?: string; maximum?: number; jump?: number; powerDisabled?: boolean; onLatest?: () => void; initialLatest?: boolean; initialPosition?: number; ignoreLatest?: boolean; latestLabel?: string } = {}) {
  let position = options.initialPosition ?? 2, selected = options.initialLatest ?? false, submenu = false, open = true;
  const actions: string[] = [];
  const raw = (visible: string) => ({ visible, content: visible, label: null, title: null, expanded: "false" });
  const slider = { getAttribute: async (name: string) => String(name === "aria-valuemin" ? 0 : name === "aria-valuemax" ? options.maximum ?? 4 : position) };
  const model = { filter() { return this; }, press: async () => { submenu = true; }, isVisible: async () => !submenu,
    evaluate: async () => raw(selected ? options.badge ?? "6 Pro" : "5.6 Pro") };
  const latest = { isVisible: async () => submenu, getAttribute: async (name: string) => name === "aria-checked" ? String(selected) : "false",
    press: async () => { if (!options.ignoreLatest) selected = true; submenu = false; actions.push("Latest"); options.onLatest?.(); } };
  const power = { isVisible: async () => true, locator: () => slider,
    getAttribute: async () => options.powerDisabled || submenu ? "true" : "false",
    press: async (key: string) => { actions.push(key); position += options.jump ?? 1; } };
  const menu = { isVisible: async () => open, filter() { return this; }, last() { return this; },
    locator: (selector: string) => selector.includes("data-model-reasoning-effort-slider") ? power : selector.includes(":not(:has") ? model : ({ isVisible: async () => submenu }),
    getByRole: (_role: string, query: { name: RegExp }) => query.name.test(options.latestLabel ?? "Latest") ? latest : ({ isVisible: async () => false }) };
  const control = { getAttribute: async (name: string) => name === "aria-controls" ? "owned-menu" : "false",
    evaluate: async () => raw(options.closedBadge ?? options.badge ?? "6 Pro"), click: async () => { open = true; } };
  const page = { locator: () => menu, keyboard: { press: async (key: string) => { actions.push(key); open = false; } } };
  return { page: page as unknown as Page, control: control as unknown as Locator, actions,
    setState: (latest: boolean, power: number) => { selected = latest; position = power; } };
}

test("Astra Pro selects Latest, reaches Pro in verified steps, and reads back Latest", async () => {
  const fixture = picker();
  await selectChatGptAstraPro(fixture.page, fixture.control);
  expect(fixture.actions).toEqual(["Latest", "ArrowRight", "ArrowRight", "Latest", "Escape"]);
});

test("Latest plus Pro is accepted without a numeric label, including already-selected state", async () => {
  for (const badge of ["Pro", "Latest", "5.6 Pro", "6 Pro"]) {
    const fixture = picker({ badge, closedBadge: "Pro", initialLatest: true, initialPosition: 4 });
    await assertChatGptAstraProReady(fixture.control, undefined, fixture.page);
    expect(fixture.actions).toEqual(["Latest", "Escape"]);
    await selectChatGptAstraPro(fixture.page, fixture.control);
    expect(fixture.actions).not.toContain("ArrowRight");
  }
});

test("Danish Seneste and Nyeste use the same selected-state verification", async () => {
  for (const latestLabel of ["Seneste", "Nyeste"]) {
    const fixture = picker({ latestLabel, closedBadge: "Thinking-indsats" });
    await selectChatGptAstraPro(fixture.page, fixture.control);
    await assertChatGptAstraProReady(fixture.control, undefined, fixture.page);
    const wrong = picker({ latestLabel, initialPosition: 4, initialLatest: false });
    await expect(assertChatGptAstraProReady(wrong.control, undefined, wrong.page)).rejects.toMatchObject({ code: "astra_pro_unavailable" });
  }
});

test("a numbered Pro badge never bypasses the Latest radio check", async () => {
  const fixture = picker({ badge: "6 Pro", initialLatest: false, initialPosition: 4 });
  await expect(assertChatGptAstraProReady(fixture.control, undefined, fixture.page)).rejects.toMatchObject({ code: "astra_pro_unavailable" });
  expect(fixture.actions).toEqual([]);
});

test("an ignored Latest click, missing Pro, and unexpected power movement fail terminally", async () => {
  for (const options of [{ ignoreLatest: true }, { maximum: 3 }, { jump: 2 }]) {
    const fixture = picker(options);
    await expect(selectChatGptAstraPro(fixture.page, fixture.control)).rejects.toMatchObject({ code: "astra_pro_unavailable", retryable: false });
  }
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

test("cancellation while checking Latest cannot authorize submission", async () => {
  const controller = new AbortController();
  const fixture = picker({ initialLatest: true, initialPosition: 4, onLatest: () => controller.abort() });
  await expect(assertChatGptAstraProReady(fixture.control, controller.signal, fixture.page)).rejects.toMatchObject({ name: "AbortError" });
});

test("the real Send boundary rechecks Astra after preparation, including reused conversations", async () => {
  const send = (ChatGptBrowserWorker.prototype as unknown as {
    sendAttachedPrompt(page: Page, baseline: unknown, capture: (checkpoint: string) => Promise<void>, signal: AbortSignal,
      progress: undefined, lifecycle: { modelId: string; onSendActivated(): Promise<void> }): Promise<string>;
  }).sendAttachedPrompt;
  for (const latestLabel of ["Latest", "Seneste"]) for (const state of [{ initialLatest: true, initialPosition: 4 }, { initialLatest: false, initialPosition: 4 }, { initialLatest: true, initialPosition: 2 }]) {
    let sends = 0, activated = 0;
    const fixture = picker({ latestLabel, initialLatest: true, initialPosition: 4, badge: "Pro", closedBadge: "Pro" });
    const hidden = { filter() { return this; }, last() { return this; }, isVisible: async () => false };
    const page = { ...fixture.page, isClosed: () => false, locator: (selector: string) => selector === '[id="owned-menu"]' ? fixture.page.locator(selector) : hidden } as unknown as Page;
    const control = { ...fixture.control, filter() { return this; }, last() { return this; } };
    const button = { waitFor: async () => {}, isEnabled: async () => true, press: async () => { sends++; } };
    const worker = { activeComposer: async () => ({ locator: () => ({ getByTestId: () => button, locator: () => control }) }),
      waitForSubmissionAcceptedWithRecovery: async () => "user_turn" };
    const result = send.call(worker, page, {}, async checkpoint => {
      if (checkpoint === "send-ready") fixture.setState(state.initialLatest, state.initialPosition);
    },
      new AbortController().signal, undefined, { modelId: CHATGPT_WEB_ASTRA_BACKEND_MODEL, onSendActivated: async () => { activated++; } });
    if (state.initialLatest && state.initialPosition === 4) {
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

import { expect, test } from "bun:test";
import type { Locator, Page } from "playwright-core";
import { isChatGptAstraProBadge, selectChatGptAstraPro } from "../src/adapters/chatgpt-web/astra-selection";
import { resolveChatGptWebModelMode } from "../src/adapters/chatgpt-web/model";
import { availableChatGptWebModelRoutes, CHATGPT_WEB_ASTRA_BACKEND_MODEL, requireChatGptWebModelRoute } from "../src/chatgpt-web-models";

function picker(options: { badge?: string; closedBadge?: string; maximum?: number; jump?: number } = {}) {
  let position = 2, selected = false, submenu = false;
  const actions: string[] = [];
  const slider = { getAttribute: async (name: string) => String(name === "aria-valuemin" ? 0 : name === "aria-valuemax" ? options.maximum ?? 4 : position) };
  const model = { press: async () => { submenu = true; }, innerText: async () => selected ? options.badge ?? "6\nPro" : "5.6 Pro" };
  const latest = { waitFor: async () => { expect(submenu).toBe(true); }, getAttribute: async () => "false",
    press: async () => { selected = true; submenu = false; actions.push("Latest"); } };
  const power = { waitFor: async () => { expect(submenu).toBe(false); }, locator: () => slider,
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
  for (const options of [{ badge: "5.6 Pro" }, { badge: "Latest" }, { closedBadge: "5.6 Pro" }, { maximum: 3 }, { jump: 2 }]) {
    const fixture = picker(options);
    await expect(selectChatGptAstraPro(fixture.page, fixture.control)).rejects.toMatchObject({ code: "astra_pro_unavailable", retryable: false });
  }
  expect(isChatGptAstraProBadge("GPT-6 Pro")).toBe(true);
  expect(isChatGptAstraProBadge("GPT-6 Extra High")).toBe(false);
  expect(isChatGptAstraProBadge("16 Pro")).toBe(false);
});

test("only the verified Astra Pro route is offered and cannot be downgraded to unverified reasoning", () => {
  const capabilities = { localToolsEnabled: true, solAvailable: true, proAvailable: true };
  expect(requireChatGptWebModelRoute("chatgpt-web/astra-pro", capabilities)).toMatchObject({ backendModel: CHATGPT_WEB_ASTRA_BACKEND_MODEL, adapterEffort: "max", codexEffort: "ultra" });
  expect(resolveChatGptWebModelMode(CHATGPT_WEB_ASTRA_BACKEND_MODEL, "max", capabilities)).toMatchObject({ displayLabel: "Astra Pro", localTools: true });
  for (const effort of ["low", "medium", "high", "xhigh"]) expect(() => resolveChatGptWebModelMode(CHATGPT_WEB_ASTRA_BACKEND_MODEL, effort, capabilities)).toThrow("only verified at Pro");
  expect(availableChatGptWebModelRoutes({ ...capabilities, proAvailable: false }).some(route => route.backendModel === CHATGPT_WEB_ASTRA_BACKEND_MODEL)).toBe(false);
});

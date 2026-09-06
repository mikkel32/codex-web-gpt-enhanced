import type { Locator, Page } from "playwright-core";
import { activateChatGptEffortMenu, parseChatGptEffortSliderState } from "../../chatgpt-session";
import { ChatGptWebAdapterError } from "./adapter-error";

export function isChatGptAstraProBadge(text: string): boolean {
  return /^(?:GPT[- ]?)?6(?:\.0)?\s*Pro$/i.test(text.replace(/\s+/g, " ").trim());
}

const unavailable = () => new ChatGptWebAdapterError(
  "ChatGPT did not confirm GPT-6 Pro. Astra Pro requires regular Chat, Latest, and the Pro power level on this account.",
  { status: 400, errorType: "invalid_request_error", code: "astra_pro_unavailable", retryable: false },
);

/** Read-only last admission check, including retained conversations that skip the picker. */
export async function assertChatGptAstraProReady(control: Locator, signal?: AbortSignal): Promise<void> {
  try {
    signal?.throwIfAborted();
    const badge = await control.innerText({ timeout: 5_000 });
    signal?.throwIfAborted();
    if (!isChatGptAstraProBadge(badge)) throw unavailable();
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof Error && error.name === "AbortError") throw error;
    if (error instanceof ChatGptWebAdapterError) throw error;
    throw unavailable();
  }
}

/** Resolve Latest through its visible generation badge, never through a guessed backend alias. */
export async function selectChatGptAstraPro(page: Page, control: Locator, signal?: AbortSignal): Promise<void> {
  const checked = async <T>(operation: () => Promise<T>): Promise<T> => {
    signal?.throwIfAborted();
    const result = await operation();
    signal?.throwIfAborted();
    return result;
  };
  try {
    const { menu } = await checked(() => activateChatGptEffortMenu(page, control, { signal }));
    const model = menu.getByRole("menuitem", { name: "Select model", exact: true });
    await checked(() => model.press("Enter", { timeout: 5_000 }));
    const latest = menu.getByRole("menuitemradio", { name: "Latest", exact: true });
    await checked(() => latest.waitFor({ state: "visible", timeout: 5_000 }));
    if (await checked(() => latest.getAttribute("aria-disabled")) === "true") throw unavailable();
    await checked(() => latest.press("Enter", { timeout: 5_000 }));
    const power = menu.getByRole("menuitem", { name: "Power", exact: true });
    await checked(() => power.waitFor({ state: "visible", timeout: 5_000 }));
    if (await checked(() => power.getAttribute("aria-disabled")) === "true") throw unavailable();
    const slider = power.locator('[role="slider"]');
    const read = async () => checked(async () => parseChatGptEffortSliderState(
      await slider.getAttribute("aria-valuemin"), await slider.getAttribute("aria-valuemax"), await slider.getAttribute("aria-valuenow"),
    ));
    let state = await read();
    if (!state || state.min !== 0 || state.max !== 4) throw unavailable();
    while (state.value < 4) {
      const before = state.value;
      await checked(() => power.press("ArrowRight"));
      const deadline = Date.now() + 3_000;
      do {
        state = await read();
        if (!state || state.min !== 0 || state.max !== 4) throw unavailable();
        if (state.value !== before) break;
        await checked(() => new Promise(resolve => setTimeout(resolve, 50)));
      } while (Date.now() < deadline);
      if (state.value !== before + 1) throw unavailable();
    }
    if (!isChatGptAstraProBadge(await checked(() => model.innerText()))) throw unavailable();
    await checked(() => page.keyboard.press("Escape"));
    await assertChatGptAstraProReady(control, signal);
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof Error && error.name === "AbortError") throw error;
    if (error instanceof ChatGptWebAdapterError) throw error;
    throw unavailable();
  }
}

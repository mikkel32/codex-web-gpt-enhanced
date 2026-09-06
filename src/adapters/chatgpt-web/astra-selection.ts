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

/** Resolve Latest through its visible generation badge, never through a guessed backend alias. */
export async function selectChatGptAstraPro(page: Page, control: Locator): Promise<void> {
  try {
    const { menu } = await activateChatGptEffortMenu(page, control);
    const model = menu.getByRole("menuitem", { name: "Select model", exact: true });
    await model.press("Enter", { timeout: 5_000 });
    const latest = menu.getByRole("menuitemradio", { name: "Latest", exact: true });
    await latest.waitFor({ state: "visible", timeout: 5_000 });
    if (await latest.getAttribute("aria-disabled") === "true") throw unavailable();
    await latest.press("Enter", { timeout: 5_000 });
    const power = menu.getByRole("menuitem", { name: "Power", exact: true });
    await power.waitFor({ state: "visible", timeout: 5_000 });
    const slider = power.locator('[role="slider"]');
    const read = async () => parseChatGptEffortSliderState(
      await slider.getAttribute("aria-valuemin"), await slider.getAttribute("aria-valuemax"), await slider.getAttribute("aria-valuenow"),
    );
    let state = await read();
    if (!state || state.min !== 0 || state.max !== 4) throw unavailable();
    while (state.value < 4) {
      const before = state.value;
      await power.press("ArrowRight");
      const deadline = Date.now() + 3_000;
      do {
        state = await read();
        if (!state || state.min !== 0 || state.max !== 4) throw unavailable();
        if (state.value !== before) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      } while (Date.now() < deadline);
      if (state.value !== before + 1) throw unavailable();
    }
    if (!isChatGptAstraProBadge(await model.innerText())) throw unavailable();
    await page.keyboard.press("Escape");
    if (!isChatGptAstraProBadge(await control.innerText())) throw unavailable();
  } catch (error) {
    if (error instanceof ChatGptWebAdapterError) throw error;
    throw unavailable();
  }
}

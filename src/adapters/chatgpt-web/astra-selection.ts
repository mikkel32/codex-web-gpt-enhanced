import type { Locator, Page } from "playwright-core";
import { activateChatGptEffortMenu, parseChatGptEffortSliderState } from "../../chatgpt-session";
import { ChatGptWebAdapterError } from "./adapter-error";

const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
export function isChatGptAstraProBadge(text: string): boolean {
  return /^(?:GPT[- ]?)?6(?:\.0)?(?:[- ]?Astra)?\s*Pro$/i.test(normalize(text));
}
function unavailable(phase: string, observed = ""): ChatGptWebAdapterError {
  // Only picker labels are included, never a page dump or conversation text.
  const label = normalize(observed).replace(/[^a-zA-Z0-9 ._-]/g, "").slice(0, 80);
  return new ChatGptWebAdapterError(
    `Astra selection could not confirm ${phase}${label ? ` (picker: ${label})` : ""}. Regular Chat must expose Latest + GPT-6 Pro in this browser session.`,
    { status: 400, errorType: "invalid_request_error", code: "astra_pro_unavailable", retryable: false },
  );
}
function preserveCancellation(error: unknown, signal?: AbortSignal): void {
  signal?.throwIfAborted();
  if (error instanceof Error && error.name === "AbortError") throw error;
}
async function until<T>(read: () => Promise<T | undefined>, phase: string, signal?: AbortSignal): Promise<T> {
  const deadline = Date.now() + 5_000;
  do {
    signal?.throwIfAborted();
    const value = await read();
    signal?.throwIfAborted();
    if (value !== undefined) return value;
    await new Promise(resolve => setTimeout(resolve, 40));
  } while (Date.now() < deadline);
  throw unavailable(phase);
}
async function badge(control: Locator): Promise<{ astra: boolean; label: string; expanded: boolean }> {
  // Read one DOM revision, rather than mixing labels from successive transitions.
  const raw = await control.evaluate(element => ({
    visible: (element as HTMLElement).innerText ?? element.textContent ?? "",
    content: element.textContent,
    label: element.getAttribute("aria-label"),
    title: element.getAttribute("title"),
    expanded: element.getAttribute("aria-expanded"),
  }), undefined, { timeout: 2_000 });
  const visible = normalize(raw.visible);
  const candidates = [visible, raw.label, raw.title, raw.content]
    .filter((value): value is string => typeof value === "string").map(normalize);
  const compact = !visible || /^(?:Pro|Thinking effort|Select effort|Select model)$/i.test(visible);
  return { astra: isChatGptAstraProBadge(visible) || (compact && candidates.some(isChatGptAstraProBadge)), label: visible || candidates.find(Boolean) || "", expanded: raw.expanded === "true" };
}
const placeholder = (label: string) => !label || /^(?:Thinking effort|Select effort|Select model)$/i.test(label);
const closedBadge = (control: Locator, signal?: AbortSignal) => until(async () => {
  const value = await badge(control);
  return value.expanded || placeholder(value.label) ? undefined : value;
}, "the closed model control", signal);
const powerControl = (menu: Locator) => menu.getByRole("menuitem", { name: "Power", exact: true });
async function modelListVisible(menu: Locator): Promise<boolean> {
  if (!await menu.getByRole("menuitemradio", { name: "Latest", exact: true }).isVisible()) return false;
  const power = powerControl(menu);
  return await menu.locator('[role="menuitem"][aria-expanded="true"]').isVisible()
    || !await power.isVisible() || await power.getAttribute("aria-disabled") === "true";
}
async function readyPower(menu: Locator, signal?: AbortSignal) {
  const power = powerControl(menu), slider = power.locator('[role="slider"]');
  return until(async () => {
    if (await menu.locator('[role="menuitem"][aria-expanded="true"]').isVisible()
      || !await power.isVisible() || await power.getAttribute("aria-disabled") === "true") return undefined;
    const state = parseChatGptEffortSliderState(await slider.getAttribute("aria-valuemin"), await slider.getAttribute("aria-valuemax"), await slider.getAttribute("aria-valuenow"));
    if (!state) return undefined;
    if (state.min !== 0 || state.max !== 4) throw unavailable("the regular-Chat Pro power range");
    return state;
  }, "the enabled Power control", signal);
}
async function confirmMenu(menu: Locator, signal?: AbortSignal): Promise<void> {
  const state = await readyPower(menu, signal);
  if (state.value !== 4) throw unavailable("Pro power");
  const model = menu.getByRole("menuitem", { name: "Select model", exact: true });
  const evidence = await until(async () => {
    if (!await model.isVisible()) return undefined;
    const value = await badge(model);
    return placeholder(value.label) ? undefined : value;
  }, "the model badge", signal);
  if (!evidence.astra) throw unavailable("GPT-6 Pro", evidence.label);
}
/** A compact Pro trigger needs fresh proof from its owned model menu. */
export async function assertChatGptAstraProReady(control: Locator, signal?: AbortSignal, page?: Page): Promise<void> {
  try {
    const evidence = await closedBadge(control, signal);
    if (evidence.astra) return;
    if (!page || !/^Pro$/i.test(evidence.label)) throw unavailable("GPT-6 Pro", evidence.label);
    const { menu } = await activateChatGptEffortMenu(page, control, { signal });
    if (await modelListVisible(menu)) {
      const selected = menu.locator('[role="menuitemradio"][aria-checked="true"]');
      if (await selected.count() !== 1) throw unavailable("the current model choice");
      signal?.throwIfAborted();
      // Return from the submenu using its already-selected row; do not switch models.
      await selected.press("Enter", { timeout: 2_000 });
    }
    await confirmMenu(menu, signal);
    signal?.throwIfAborted();
    await page.keyboard.press("Escape");
    const closed = await closedBadge(control, signal);
    signal?.throwIfAborted();
    if (!closed.astra && !/^Pro$/i.test(closed.label)) throw unavailable("the final Pro control", closed.label);
  } catch (error) {
    preserveCancellation(error, signal);
    if (error instanceof ChatGptWebAdapterError) throw error;
    throw unavailable("the final model control");
  }
}
/** Power stays mounted but disabled while the model submenu transitions. */
export async function selectChatGptAstraPro(page: Page, control: Locator, signal?: AbortSignal): Promise<void> {
  let phase = "the picker";
  const checked = async <T>(operation: () => Promise<T>) => {
    signal?.throwIfAborted(); const result = await operation(); signal?.throwIfAborted(); return result;
  };
  try {
    const { menu } = await checked(() => activateChatGptEffortMenu(page, control, { signal }));
    const latest = menu.getByRole("menuitemradio", { name: "Latest", exact: true });
    phase = "the model list";
    const opening = await until(async () => {
      if (await modelListVisible(menu)) return "list";
      if (await menu.getByRole("menuitem", { name: "Select model", exact: true }).isVisible()) return "toggle";
      return undefined;
    }, phase, signal);
    if (opening === "toggle") {
      await checked(() => menu.getByRole("menuitem", { name: "Select model", exact: true }).press("Enter", { timeout: 5_000 }));
    }
    await until(async () => await modelListVisible(menu) ? true : undefined, phase, signal);
    if (await checked(() => latest.getAttribute("aria-disabled")) === "true") throw unavailable("Latest access");
    await checked(() => latest.press("Enter", { timeout: 5_000 }));
    phase = "Latest selection";
    // Some ChatGPT versions unmount the radio rows after selection. The restored
    // Power state and numeric generation badge are the acknowledgment, not stale rows.
    let state = await readyPower(menu, signal);
    phase = "Pro power";
    while (state.value < 4) {
      const before = state.value;
      await checked(() => powerControl(menu).press("ArrowRight"));
      state = await until(async () => {
        const next = await readyPower(menu, signal);
        if (next.value === before) return undefined;
        if (next.value !== before + 1) throw unavailable("one-step Power movement");
        return next;
      }, phase, signal);
    }
    await confirmMenu(menu, signal);
    await checked(() => page.keyboard.press("Escape"));
    const closed = await closedBadge(control, signal);
    if (!closed.astra && !/^Pro$/i.test(closed.label)) throw unavailable("the closed Pro label", closed.label);
  } catch (error) {
    preserveCancellation(error, signal);
    if (error instanceof ChatGptWebAdapterError) throw error;
    throw unavailable(phase);
  }
}

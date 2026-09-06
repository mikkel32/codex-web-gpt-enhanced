import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright-core";
import { selectChatGptAstraPro, assertChatGptAstraProReady } from "../src/adapters/chatgpt-web/astra-selection";

const browser = await chromium.connectOverCDP(process.argv[2]!);
try {
  const deadline = Date.now() + 15_000;
  let page = browser.contexts()[0]?.pages()[0];
  while ((!page || !page.url().startsWith("file:")) && Date.now() < deadline) {
    await sleep(50); page = browser.contexts()[0]?.pages()[0];
  }
  assert(page, "Missing fixture page");
  await page.waitForFunction(() => typeof (window as unknown as { setCase?: unknown }).setCase === "function");
  for (const options of [{ noGeneration: true, latest: true, position: 4, verifyOnly: true },
    {}, { compact: true }, { hiddenGeneration: true }, { expanded: true, compact: true },
    { compact: true, expanded: true, latest: true, position: 4, verifyOnly: true },
    { compact: true, expanded: true, modelsOnly: true },
    { compact: true, expanded: true, modelsOnly: true, latest: true, position: 4, verifyOnly: true },
    { noGeneration: true, compact: true },
    { noGeneration: true, compact: true, expanded: true, modelsOnly: true, latest: true, position: 4, verifyOnly: true },
    { generation: "5.6", compact: true },
    { noGeneration: true, latest: false, position: 4, verifyOnly: true, reject: true },
    { noGeneration: true, latest: true, position: 2, verifyOnly: true, reject: true }]) {
    await page.evaluate(value => (window as unknown as { setCase(v: unknown): void }).setCase(value), options);
    const control = page.getByTestId("model-switcher-dropdown-button");
    if (options.reject) {
      await assert.rejects(assertChatGptAstraProReady(control, undefined, page), { code: "astra_pro_unavailable" });
    } else {
      if (!options.verifyOnly) await selectChatGptAstraPro(page, control);
      await assertChatGptAstraProReady(control, undefined, page);
      assert.equal(await page.getByRole("menu").isVisible(), false, "Picker must release focus before Send");
    }
    const events = await page.evaluate(() => (window as unknown as { events: string[] }).events);
    assert(!events.includes("disabled-power"), "Pressed Power during a disabled transition");
  }
  console.log(`ASTRA_ELECTRON_PICKER_OK ${process.platform}/${process.arch} electron=${process.versions.electron} normal compact hidden-label expanded-menu model-list-only retained-compact latest-pro-no-generation already-selected rejects-nonlatest rejects-nonpro`);
} finally { await browser.close(); }

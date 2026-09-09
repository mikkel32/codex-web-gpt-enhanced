import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright-core";
import { installGuidedFixture, type GuidedFixtureWindow } from "../tests/fixtures/guided-launcher";
import { guidedCopy } from "../launcher/src/guided-copy";
import { copyFor } from "../launcher/src/i18n";
import type { Language } from "../launcher/src/types";

const browser = await chromium.connectOverCDP(process.argv[2]!);
const url = process.argv[3]!;
const images = process.env.GUIDED_UI_ARTIFACT_DIR;
const version = JSON.parse(readFileSync(resolve("package.json"), "utf8")).version;
if (images) mkdirSync(images, { recursive: true });
const errors: string[] = [];
let scenarios = 0;
try {
  let page = browser.contexts()[0]?.pages()[0];
  const deadline = Date.now() + 15_000;
  while (!page && Date.now() < deadline) { await sleep(50); page = browser.contexts()[0]?.pages()[0]; }
  assert(page, "Missing isolated renderer window");
  page.setDefaultTimeout(10_000);
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(installGuidedFixture);
  const open = async (scenario: string, width = 1180, lang: Language = "en") => {
    await page!.setViewportSize({ width, height: width < 500 ? 844 : 1000 });
    console.log(`RENDER_CASE ${scenario} ${lang} ${width}`);
    await page!.goto(`${url}/?scenario=${scenario}&lang=${lang}&version=${encodeURIComponent(version)}`);
    // A pending Manual task opens its guide directly; its idle compact setup card
    // is intentionally hidden and must not claim live readiness for active work.
    await page!.waitForSelector(scenario === "onboarding" ? ".guided-welcome"
      : scenario === "manual" ? ".manual-turn-guide" : ".guided-setup");
    await page!.waitForTimeout(500);
    scenarios += 1;
  };
  const screenshot = async (name: string) => { if (images) await page!.screenshot({ timeout: 20_000, path: join(images, `${name}.png`), animations: "disabled" }); };
  const navigation = async (index: number) => { await page!.keyboard.press(`Meta+${index}`); await page!.waitForTimeout(450); };
  const assertLayout = async (label: string) => {
    const result = await page!.evaluate(() => {
      const viewport = innerWidth;
      const clipping = [...document.querySelectorAll<HTMLElement>(".guided-setup, .guided-welcome-layout, .content-scroll, .maria-page")]
        .filter(element => element.getBoundingClientRect().width > 0 && element.scrollWidth > element.clientWidth + 2)
        .map(element => element.className);
      return { pageOverflow: document.documentElement.scrollWidth > viewport, clipping };
    });
    assert.equal(result.pageOverflow, false, `${label}: page overflow`);
    assert.deepEqual(result.clipping, [], `${label}: content overflow`);
  };
  // English, Japanese and Chinese at desktop, compact and narrow widths.
  for (const language of ["en", "ja", "zh-CN"] as const) for (const width of [1180, 700, 390]) {
    await open("onboarding", width, language);
    await assertLayout(`onboarding ${language}/${width}`);
    if (language === "en") await screenshot(`welcome-${width}`);
    await open("ready", width, language);
    await assertLayout(`overview ${language}/${width}`);
    if (language === "en" || width === 1180) await screenshot(`overview-${language}-${width}`);
    assert.equal(await page.evaluate(() => (window as unknown as GuidedFixtureWindow).guidedFixture.listeners.onLog?.size ?? 0), 0, "Hidden Activity must not subscribe");
  }
  await open("onboarding");
  await page.getByRole("button", { name: "Connect my workspace", exact: true }).click();
  await page.waitForFunction(() => (window as unknown as GuidedFixtureWindow).guidedFixture.calls.includes("openLogin"));
  assert.equal(await page.evaluate(() => (window as unknown as GuidedFixtureWindow).guidedFixture.calls.filter(x => x === "openLogin").length), 1, "Onboarding event-before-reply must start exactly once");
  await page.evaluate(() => (window as unknown as GuidedFixtureWindow).guidedFixture.signIn(true));
  await page.locator(".guided-setup.is-codex").waitFor();
  assert.equal(await page.evaluate(() => (window as unknown as GuidedFixtureWindow).guidedFixture.calls.filter(x => x === "setupCore").length), 1);
  await screenshot("setup-codex-handoff");
  await page.evaluate(() => (window as unknown as GuidedFixtureWindow).guidedFixture.catalog());
  await page.locator(".guided-setup.is-ready").waitFor();
  await screenshot("setup-verified");
  await page.evaluate(() => (window as unknown as GuidedFixtureWindow).guidedFixture.signIn(false));
  await page.locator(".guided-setup.is-idle").waitFor();
  assert.equal(await page.evaluate(() => (window as unknown as GuidedFixtureWindow).guidedFixture.calls.filter(x => x === "setupCore").length), 1, "Invalidating evidence must not reinstall");

  for (let repetition = 0; repetition < 5; repetition += 1) {
    await open("onboarding");
    await page.getByRole("button", { name: "Connect my workspace", exact: true }).click();
    await page.waitForFunction(() => (window as unknown as GuidedFixtureWindow).guidedFixture.calls.includes("openLogin"));
    await page.evaluate(() => (window as unknown as GuidedFixtureWindow).guidedFixture.signIn(true));
    await page.locator(".guided-setup.is-codex").waitFor();
    await page.evaluate(() => (window as unknown as GuidedFixtureWindow).guidedFixture.catalog());
    await page.locator(".guided-setup.is-ready").waitFor();
    assert.equal(await page.evaluate(() => (window as unknown as GuidedFixtureWindow).guidedFixture.calls.filter(x => x === "setupCore").length), 1);
  }

  await open("clean");
  await page.getByRole("radio", { name: /^ChatGPT \+ local tools/ }).check();
  await page.getByRole("button", { name: "Set up my workspace", exact: true }).dblclick();
  await page.locator(".guided-setup.is-codex").waitFor();
  await page.evaluate(() => (window as unknown as GuidedFixtureWindow).guidedFixture.catalog());
  await page.locator('input[placeholder="tunnel_…"]').waitFor();
  assert.equal(await page.locator(".wizard-stepper button").count(), 2, "Tools should have two meaningful steps");
  await screenshot("tools-one-time-credentials");
  await page.locator('input[placeholder="tunnel_…"]').fill("invalid");
  await page.locator('input[placeholder="sk-…"]').fill("fixture-runtime-key-not-a-secret");
  const connect = page.getByRole("button", { name: copyFor("en").connect, exact: true });
  assert.equal(await connect.isEnabled(), false, "Invalid credentials must not start setup");
  await page.locator('input[placeholder="tunnel_…"]').fill(`tunnel_${"a".repeat(32)}`);
  await connect.click();
  await page.locator(".guided-setup.is-codex").waitFor();
  await page.evaluate(() => (window as unknown as GuidedFixtureWindow).guidedFixture.catalog());
  await page.locator(".guided-setup.is-ready").waitFor();
  const calls = await page.evaluate(() => (window as unknown as GuidedFixtureWindow).guidedFixture.calls);
  assert.equal(calls.filter(x => x === "setupCore").length, 1);
  assert.equal(calls.filter(x => x === "setupMcp").length, 1);
  assert.equal(calls.filter(x => x === "verifyMcp").length, 1);

  // Every navigation surface remains accessible, including keyboard routes.
  for (const width of [1180, 700, 390]) {
    await open("ready", width);
    for (const [index, selector, name] of [[2, ".browser-surface", "browser"], [3, ".setup-list", "connection"], [4, ".wizard-stepper", "tools"], [5, ".activity-table", "activity"], [6, ".guided-help", "help"], [7, ".maria-updates", "updates"], [8, ".studio-settings-section:visible", "settings"]] as const) {
      await navigation(index); await page.locator(selector).first().waitFor(); await assertLayout(`${name}/${width}`);
      if (width !== 700) await screenshot(`${name}-${width}`);
    }
  }
  // The interrupted-turn action is bound to its current tab and is unavailable when hidden.
  for (const width of [1180, 390]) {
    await open("review", width);
    await navigation(2);
    const review = page.getByRole("button", { name: "I reviewed this chat", exact: true });
    assert.equal(await review.isEnabled(), true);
    await assertLayout(`turn review/${width}`);
    assert.equal(await page.evaluate(() => {
      const toolbar = document.querySelector(".browser-toolbar")!;
      const bottom = toolbar.getBoundingClientRect().bottom;
      return [...toolbar.children].every(child => child.getBoundingClientRect().bottom <= bottom + 1)
        && document.querySelector(".manual-turn-guide")!.getBoundingClientRect().top >= bottom - 1;
    }), true, `Wrapped browser controls must not overlap review/${width}`);
    await screenshot(`turn-review-${width}`);
    await page.getByRole("button", { name: "Restore view", exact: true }).click();
    assert.equal(await page.evaluate(() => (window as unknown as GuidedFixtureWindow).guidedFixture.snapshot.browser?.activeTabId), "review-task");
    assert.equal(await page.evaluate(() => (window as unknown as GuidedFixtureWindow).guidedFixture.calls.filter(action => action === "selectBrowserTab").length), 1);
    await page.evaluate(() => {
      const fixture = (window as unknown as GuidedFixtureWindow).guidedFixture;
      if (!fixture.snapshot.browser) throw new Error("Missing review browser fixture");
      fixture.snapshot.browser.visible = false;
      fixture.emit("onBrowserState", fixture.snapshot.browser);
    });
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLButtonElement>("button")]
      .some(button => button.textContent === "I reviewed this chat" && button.disabled));
    await page.evaluate(() => {
      const fixture = (window as unknown as GuidedFixtureWindow).guidedFixture;
      if (!fixture.snapshot.browser) throw new Error("Missing review browser fixture");
      fixture.snapshot.browser.visible = true;
      fixture.emit("onBrowserState", fixture.snapshot.browser);
    });
    await review.click();
    await page.waitForFunction(() => !(window as unknown as GuidedFixtureWindow).guidedFixture.snapshot.browser?.tabs[0]?.recoveryId);
    assert.equal(await page.evaluate(() => (window as unknown as GuidedFixtureWindow).guidedFixture.calls
      .filter(action => action === "confirmBrowserTurnReviewed").length), 1);
  }
  // Verify idle and high-volume Activity behavior in the same actual Electron renderer.
  await open("ready");
  await page.locator(".guided-setup.is-ready").waitFor();
  await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== "running"), undefined, { timeout: 5000 });
  assert.equal(await page.evaluate(() => document.getAnimations().filter(animation => animation.playState === "running").length), 0, "Idle workspace must have no continuous animations");
  await page.evaluate(() => {
    const fixture = (window as unknown as GuidedFixtureWindow).guidedFixture;
    for (let index = 0; index < 800; index++) fixture.emit("onLog", { at: new Date().toISOString(), level: "info", event: "runtime.progress", detail: { message: `fixture-${index}` } });
  });
  assert.equal(await page.evaluate(() => (window as unknown as GuidedFixtureWindow).guidedFixture.listeners.onLog?.size ?? 0), 0, "Inactive Activity should not process logs");
  await navigation(5);
  await page.waitForFunction(() => (window as unknown as GuidedFixtureWindow).guidedFixture.listeners.onLog?.size === 1);
  await page.evaluate(() => {
    const fixture = (window as unknown as GuidedFixtureWindow).guidedFixture;
    for (let index = 0; index < 500; index++) fixture.emit("onLog", { at: new Date().toISOString(), level: "info", event: "runtime.progress", detail: { message: `visible-${index}` } });
  });
  await page.waitForFunction(() => document.querySelectorAll(".activity-row").length === 300);
  await navigation(1);
  await page.waitForFunction(() => (window as unknown as GuidedFixtureWindow).guidedFixture.listeners.onLog?.size === 0);
  await open("update-error"); await navigation(7);
  assert.equal(await page.getByRole("button", { name: /Install update/ }).count(), 0, "A failed update check must not expose an installer action");
  await open("tasks");
  await page.getByRole("button", { name: "Check connection", exact: true }).first().click();
  await page.locator(".guided-setup.is-busy").waitFor();
  assert.equal(await page.evaluate(() => (window as unknown as GuidedFixtureWindow).guidedFixture.calls.some(x => x === "setupCore" || x === "setupMcp")), false, "Setup may not interrupt active work");
  await screenshot("setup-active-work");
  await open("manual");
  await page.waitForSelector(".manual-turn-guide");
  assert.equal(await page.evaluate(() => (window as unknown as GuidedFixtureWindow).guidedFixture.calls.includes("openLogin")), false);
  assert.equal(await page.locator(".guided-setup.is-ready").count(), 0, "A pending Manual prompt must not produce a ready setup card");
  await screenshot("manual-mode");
  await navigation(1);
  await page.locator(".guided-setup").getByRole("button", { name: "Check connection", exact: true }).click();
  await page.locator(".guided-setup.is-busy").waitFor();
  assert.equal(await page.evaluate(() => (window as unknown as GuidedFixtureWindow).guidedFixture.calls
    .some(action => ["setupCore", "setupMcp", "verifyMcp", "openLogin"].includes(action))), false,
    "The waiting Manual task must not be interrupted by installation or sign-in");
  await open("paused");
  await page.getByRole("button", { name: "Check connection", exact: true }).first().click();
  await page.locator(".guided-setup.is-review").waitFor();
  assert.equal(await page.evaluate(() => (window as unknown as GuidedFixtureWindow).guidedFixture.calls.includes("resumeWebAccess")), false);
  await screenshot("access-review");
  await open("clean");
  await page.evaluate(() => { (window as unknown as GuidedFixtureWindow).guidedFixture.failInstall = "Launcher browser CDP endpoint is not ready: CDP metadata did not identify the expected loopback browser endpoint"; });
  await page.getByRole("button", { name: "Set up my workspace", exact: true }).click();
  await page.locator(".guided-setup.is-error").waitFor();
  assert.equal(await page.locator(".guided-setup").getByRole("button", { name: guidedCopy("en").reviewDetails }).count(), 1, "Integrity failures require review, not blind retry");
  await screenshot("setup-error");
  assert.deepEqual(errors, [], "Renderer JavaScript errors");
  console.log(`GUIDED_RENDERER_OK ${process.platform}/${process.arch} electron=${process.versions.electron} scenarios=${scenarios} locales=en,ja,zh-CN widths=1180,700,390 onboarding-event-race core-before-tools single-flight safe-errors no-false-update idle-animations-zero bounded-activity-300 hidden-activity-detached native-manual-boundaries`);
} catch (error) {
  const page = browser.contexts()[0]?.pages()[0];
  if (page) {
    const diagnostic = await page.evaluate(() => {
      const fixture = (window as unknown as GuidedFixtureWindow).guidedFixture;
      return { phase: document.querySelector(".guided-setup")?.className,
        calls: fixture?.calls, nativeReady: fixture?.nativeReady,
        coreComplete: fixture?.snapshot.state.coreSetupComplete,
        catalogVerified: fixture?.snapshot.state.codexCatalogVerified,
        restartRequired: fixture?.snapshot.state.codexRestartRequired };
    }).catch(() => ({ unavailable: true }));
    console.error("GUIDED_UI_FAILURE", JSON.stringify(diagnostic));
  }
  throw error;
} finally { await browser.close(); }

import { expect, test } from "bun:test";
import type { Browser, BrowserContext, Locator, Page } from "playwright-core";
import { selectLauncherPage, type LauncherBrowserHostDescriptor } from "../src/launcher-browser-host";
import { ChatGptBrowserWorker, ChatGptBrowserObservationReadError, ChatGptBrowserObservationTimeoutError } from "../src/adapters/chatgpt-web/browser-worker";

const descriptor = { surfaceId: "owned" } as LauncherBrowserHostDescriptor;
function browserFixture(pages: Array<{ evaluate: () => Promise<unknown> }>) {
  const context = { pages: () => pages } as unknown as BrowserContext;
  return { context, browser: { contexts: () => [context] } as unknown as Browser };
}

test("five concurrent ownership lookups survive an unrelated renderer that never answers", async () => {
  const pages = Array.from({ length: 5 }, (_, i) => ({ evaluate: async () => `surface-${i}` }));
  const stalled = { evaluate: () => new Promise<never>(() => {}) };
  const { browser, context } = browserFixture([stalled, ...pages]);
  const results = await Promise.all(pages.map((_page, i) => selectLauncherPage(browser, descriptor, 40, `surface-${i}`)));
  results.forEach((result, i) => {
    expect(result.context).toBe(context);
    expect(result.page).toBe(pages[i] as unknown as Page);
  });
});

test("an unresponsive owned surface respects the deadline without accumulating probes", async () => {
  let reads = 0;
  const { browser } = browserFixture([{ evaluate: () => { reads++; return new Promise<never>(() => {}); } }]);
  const start = performance.now();
  await expect(selectLauncherPage(browser, descriptor, 650)).rejects.toThrow("did not expose its owned browser surface");
  expect(reads).toBe(1);
  expect(performance.now() - start).toBeLessThan(1500);
});

test("cancellation promptly interrupts ownership reads while preserving duplicate detection", async () => {
  const controller = new AbortController();
  const stalled = browserFixture([{ evaluate: () => new Promise<never>(() => {}) }]);
  const pending = selectLauncherPage(stalled.browser, descriptor, 10000, undefined, controller.signal);
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  const duplicate = browserFixture([{ evaluate: async () => "owned" }, { evaluate: async () => "owned" }]);
  await expect(selectLauncherPage(duplicate.browser, descriptor, 100)).rejects.toThrow("2 surfaces with the same ownership id");
});

const readSnapshot = (ChatGptBrowserWorker.prototype as unknown as {
  responseDomSnapshot(locator: Locator, cache?: Record<string, unknown>): Promise<{ responsePresent: boolean }>;
}).responseDomSnapshot;
function locator(evaluateAll: () => Promise<unknown>, closed = false): Locator {
  return { evaluateAll, page: () => ({ isClosed: () => closed }) } as unknown as Locator;
}

test("a missing response never reuses a cached final answer", async () => {
  const result = await readSnapshot.call({}, locator(async () => ({ key: "" })), {
    key: "old", snapshot: { responsePresent: true, visibleText: "old final", completionActionVisible: true },
  });
  expect(result.responsePresent).toBe(false);
});

test("a failed DOM read preserves uncertainty and its cause instead of fabricating absence", async () => {
  const cause = new Error("Execution context was destroyed");
  const error = await readSnapshot.call({}, locator(async () => { throw cause; })).catch(error => error);
  expect(error).toBeInstanceOf(ChatGptBrowserObservationReadError);
  expect(error.cause).toBe(cause);
  const bug = new TypeError("internal reader defect");
  await expect(readSnapshot.call({}, locator(async () => { throw bug; }))).rejects.toBe(bug);
});

test("a hung renderer has a bounded response read rather than an endless evaluation", async () => {
  await expect(readSnapshot.call({}, locator(() => new Promise<never>(() => {}))))
    .rejects.toBeInstanceOf(ChatGptBrowserObservationTimeoutError);
}, 10000);

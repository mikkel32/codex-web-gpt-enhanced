import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser } from "playwright-core";
import { connectLauncherBrowserHost, LAUNCHER_BROWSER_HOST_KIND, LAUNCHER_BROWSER_IDLE_URL } from "../src/launcher-browser-host";
import { verifyResponseStateFixture } from "./response-state-fixture";

/** Real Electron/CDP concurrency, entirely offline and isolated from the user's account. */
export async function verifyConcurrentBrowserFixture(browser: Browser, websocket: string, home: string, pid: number) {
  assert(Number.isSafeInteger(pid) && pid > 0);
  const context = browser.contexts()[0]!;
  const deadline = Date.now() + 20_000;
  const viewResult = join(home, "concurrent-views-ready.json");
  while ((!existsSync(viewResult) || context.pages().length < 6) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
  assert(existsSync(viewResult), "Native embedded-view checks did not complete");
  assert.deepEqual(JSON.parse(readFileSync(viewResult, "utf8")), { views: 5, resizeChecks: 15, restorationNavigations: 0 });
  assert.equal(context.pages().length, 6, "five working pages and one unrelated page");
  const pages = context.pages().slice(0, 5);
  const sentinel = context.pages()[5]!;
  const ids = pages.map((_page, index) => `fixture_surface_${index}`.padEnd(32, "x"));
  await Promise.all(pages.map((page, index) => page.evaluate(id => {
    Object.defineProperty(globalThis, "__CODEX_WEB_GPT_SURFACE_ID__", { value: id, configurable: true });
  }, ids[index]!)));
  // A stuck ownership read in another real renderer used to hang all five helpers.
  await sentinel.evaluate(() => {
    Object.defineProperty(globalThis, "__CODEX_WEB_GPT_SURFACE_ID__", { get: () => new Promise(() => {}), configurable: true });
  });
  const sentinelSession = await context.newCDPSession(sentinel);
  // Fix both emulated properties so OS window activation cannot change the
  // baseline while the five independent renderer scenarios are running.
  await sentinelSession.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await sentinelSession.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
  const sentinelState = () => sentinel.evaluate(() => ({ focus: document.hasFocus(), dark: matchMedia("(prefers-color-scheme: dark)").matches }));
  const before = await sentinelState();
  assert.equal(before.focus, true);
  assert.equal(before.dark, true);
  const endpoint = new URL(websocket);
  const descriptor = join(home, "concurrent-descriptor.json");
  writeFileSync(descriptor, JSON.stringify({ version: 2, kind: LAUNCHER_BROWSER_HOST_KIND, profile: "development", pid,
    endpoint: `http://127.0.0.1:${endpoint.port}`, control: { endpoint: "http://127.0.0.1:1", token: "offline-fixture-control-not-used".padEnd(48, "x") },
    helper: { executable: process.execPath, script: process.argv[1] }, partition: "persist:codex-web-gpt-dev-chatgpt",
    idleUrl: LAUNCHER_BROWSER_IDLE_URL, surfaceId: ids[0], createdAt: new Date().toISOString() }), { mode: 0o600 });
  const connections = await Promise.allSettled(ids.map(id => connectLauncherBrowserHost(descriptor, 20_000, id)));
  const opened = connections.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
  try {
    for (const result of connections) if (result.status === "rejected") throw result.reason;
    assert.equal(opened.length, 5);
    assert.deepEqual(await sentinelState(), before, "helper attachments must preserve unrelated page focus/media");
    await Promise.all(opened.map(connection => verifyResponseStateFixture(connection.page)));
    await opened[0]!.browser.close();
    for (const connection of opened.slice(1)) {
      assert.equal(connection.page.isClosed(), false);
      assert(await connection.page.locator("#response").count());
    }
    assert.deepEqual(await sentinelState(), before, "one helper disconnect must preserve unrelated browser state");
    console.log("CONCURRENT_BROWSER_ELECTRON_OK helpers=5 native-views=5 resize-checks=15 restore-without-navigation hung-unrelated-lookup large-responses=5 cached-reads=100 isolated-focus-media independent-disconnect");
  } finally {
    await Promise.allSettled(opened.map(connection => connection.browser.close()));
    await sentinelSession.detach();
  }
}

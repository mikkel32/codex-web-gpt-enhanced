import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { verifyResponseStateFixture } from "./response-state-fixture";
import { verifyConcurrentBrowserFixture } from "./concurrent-browser-fixture";

const browser = await chromium.connectOverCDP(process.argv[2]!, { noDefaults: true });
try {
  const page = browser.contexts()[0]?.pages()[0];
  assert(page, "Missing isolated response fixture page");
  await verifyResponseStateFixture(page);
  await verifyConcurrentBrowserFixture(browser, process.argv[2]!, process.argv[3]!, Number(process.argv[4]));
} finally { await browser.close(); }

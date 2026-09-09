import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { verifyResponseStateFixture } from "./response-state-fixture";

const browser = await chromium.connectOverCDP(process.argv[2]!);
try {
  const page = browser.contexts()[0]?.pages()[0];
  assert(page, "Missing isolated response fixture page");
  await verifyResponseStateFixture(page);
} finally { await browser.close(); }

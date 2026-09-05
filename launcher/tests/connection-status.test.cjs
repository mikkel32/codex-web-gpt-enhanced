const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createConnectionSampler } = require("../electron/connection-status.cjs");
test("connection samples share health work and never trust an unrelated listener", async () => {
  let reads = 0, now = 0;
  const sample = createConnectionSampler({
    readConfig: () => ({ host: "127.0.0.1", port: 17841 }),
    readHealth: async () => { reads += 1; return { service: "unrelated", status: "ok", accepting_turns: true, active_browser_turns: 50 }; },
    recoveryStatus: () => ({ running: false }), browserState: () => ({}), now: () => now,
  });
  const values = await Promise.all([sample(), sample(), sample()]);
  assert.equal(reads, 1);
  assert.equal(values[0].nativeAvailable, false);
  assert.equal(values[0].browserConnected, false);
  assert.equal(values[0].activeBrowserTurns, 0);
  await sample(); assert.equal(reads, 1);
  now = 751; await sample(); assert.equal(reads, 2);
});
test("development samples do not read production configuration or recovery state", async () => {
  const unexpected = () => { throw new Error("production accessed"); };
  const sample = createConnectionSampler({ development: true, readConfig: unexpected, readHealth: unexpected,
    recoveryStatus: unexpected, browserState: () => ({ authenticated: true }) });
  const result = await sample();
  assert.equal(result.phase, "development"); assert.equal(result.nativeAvailable, false); assert.equal(result.browserConnected, true);
});

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

function fixture() {
  let time = 0;
  const config = { host: "127.0.0.1", port: 17841, releaseVersion: "5.13.10-alpha.2", mode: "full" };
  let health = { service: "codex-chatgpt-web", status: "ok", version: config.releaseVersion,
    mode: config.mode, accepting_turns: true, browser_connected: true, active_browser_turns: 0 };
  const sampler = createConnectionSampler({ readConfig: () => config, readHealth: async () => health,
    recoveryStatus: () => ({ running: true }), browserState: () => ({}),
    expectedReleaseVersion: "5.13.10-alpha.2", now: () => time });
  return { config, sampler, setHealth: value => { health = value; }, health: () => health,
    advance: ms => { time += ms; } };
}

test("a previous-version runtime never looks ready and its active turns still block upgrade", async () => {
  const f = fixture(); f.config.releaseVersion = "5.13.5";
  f.setHealth({ ...f.health(), version: "5.13.5", active_browser_turns: 2 });
  const status = await f.sampler();
  assert.equal(status.nativeAvailable, false); assert.equal(status.phase, "needs-setup");
  assert.equal(status.recoveryAvailable, true); assert.equal(status.activeBrowserTurns, 2);
});

for (const field of ["version", "mode"]) {
  test(`a listener with the wrong ${field} cannot produce a green connection`, async () => {
    const f = fixture(); f.setHealth({ ...f.health(), [field]: "other", active_browser_turns: 25 });
    const status = await f.sampler();
    assert.equal(status.nativeAvailable, false); assert.equal(status.browserConnected, false);
    assert.equal(status.activeBrowserTurns, 0);
  });
}

test("a guardian does not trap failed recovery forever or reset its grace on each poll", async () => {
  const f = fixture(); f.setHealth(null);
  assert.equal((await f.sampler()).phase, "recovering");
  for (let index = 0; index < 9; index++) {
    f.advance(3000); assert.equal((await f.sampler()).phase, "recovering");
  }
  f.advance(3000); assert.equal((await f.sampler()).phase, "offline");
  f.advance(3000); assert.equal((await f.sampler()).phase, "offline");
});

test("a successful recovery clears the grace window for a later independent outage", async () => {
  const f = fixture(), healthy = f.health(); f.setHealth(null);
  await f.sampler(); f.advance(30_001); assert.equal((await f.sampler()).phase, "offline");
  f.setHealth(healthy); f.advance(751); assert.equal((await f.sampler()).phase, "online");
  f.setHealth(null); f.advance(751); assert.equal((await f.sampler()).phase, "recovering");
});

test("missing browser evidence is not an authenticated browser connection", async () => {
  const f = fixture(); f.setHealth({ ...f.health(), browser_connected: undefined });
  const status = await f.sampler();
  assert.equal(status.nativeAvailable, true); assert.equal(status.browserConnected, false);
});

test("an unconfigured installation is never held busy by an old guardian", async () => {
  const unexpected = () => { throw new Error("health should not run"); };
  const sample = createConnectionSampler({ readConfig: () => null, readHealth: unexpected,
    recoveryStatus: () => ({ running: true }), browserState: () => ({}) });
  assert.equal((await sample()).phase, "unconfigured");
});

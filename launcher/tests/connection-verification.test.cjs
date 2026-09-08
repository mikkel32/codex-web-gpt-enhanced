const test = require("node:test");
const assert = require("node:assert/strict");
const { connectionVerificationIdentity, connectionVerificationStale } = require("../electron/connection-verification.cjs");

test("setup proof expires for changed runtime, connector, tunnel or browser, preserving manual mode", () => {
  const config = { mode: "full", browserInteractionMode: "automatic", releaseVersion: "5.15.0",
    automaticAppName: "Codex Native2 Mac", tunnel: { tunnelId: "dedicated-mac", runtimeKeyFile: "/private/key" },
    brokerSocketPath: "/private/broker", browserHostDescriptorPath: "/private/browser" };
  const state = { mcpSetupComplete: true, mcpVerificationIdentity: connectionVerificationIdentity(config) };
  assert.equal(connectionVerificationStale({}, config), true);
  assert.equal(connectionVerificationStale(state, config), false);
  for (const patch of [{ releaseVersion: "next" }, { automaticAppName: "Other" }, { tunnel: { tunnelId: "shared" } },
    { brokerSocketPath: "/other/broker" }, { browserHostDescriptorPath: "/other/browser" }]) {
    assert.equal(connectionVerificationStale(state, { ...config, ...patch }), true);
  }
  assert.equal(connectionVerificationStale(state, { ...config, browserInteractionMode: "manual" }), false);
  assert.equal(connectionVerificationStale(state, { ...config, mode: "browser-only" }), false);
  assert.equal(connectionVerificationIdentity({ ...config, tunnel: null }), null);
});

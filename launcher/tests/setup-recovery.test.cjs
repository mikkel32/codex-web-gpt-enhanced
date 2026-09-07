const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { RuntimeHost } = require("../electron/runtime.cjs");

function fixture(t, version = "5.13.5") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "maria-recovery-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let config = { browserHost: "launcher", mode: "browser-only", releaseVersion: version };
  const events = [];
  const supervisor = {
    readSetupConfig: () => config, readConfig: () => config,
    stopForSetup: async () => { events.push("stop"); },
    startIfConfigured: async () => ({ status: config.releaseVersion === "5.13.8" ? "ready" : "needs-setup" }),
  };
  const host = new RuntimeHost({
    app: { getPath: () => root, getVersion: () => "5.13.8" },
    logger: { info() {}, warn() {}, error() {} }, sourceRoot: root,
    browserDescriptorPath: path.join(root, "browser.json"),
    supervisor, publishOperation: event => events.push(event),
  });
  host.captureSetupCheckpoint = () => structuredClone(config);
  host.setupCheckpointChanged = checkpoint => JSON.stringify(checkpoint) !== JSON.stringify(config);
  host.restoreSetupCheckpoint = checkpoint => { config = structuredClone(checkpoint); events.push("restore"); };
  return { host, supervisor, events };
}

test("old-version rollback preserves upgrade-required status without inventing a recovery failure", async t => {
  const { host, events } = fixture(t);
  host.run = async (_name, args) => {
    if (args.includes("--preflight-only")) return { code: 0 };
    throw new Error("Launcher browser CDP endpoint is not ready: fetch failed");
  };
  await assert.rejects(host.runSetup("core-setup", ["setup"], {}), error => {
    assert.match(error.message, /CDP endpoint is not ready/);
    assert.match(error.message, /Previous settings were preserved/);
    assert.doesNotMatch(error.message, /restoring the previous launcher runtime failed/);
    return true;
  });
  assert.equal(host.currentOperation(), null);
  assert.equal(events.some(event => event.status === "completed"), false);
  assert.equal(host.runtimeConfigSnapshot().config.releaseVersion, "5.13.5");
});

test("same-version rollback still requires verified readiness", async t => {
  const { host, supervisor } = fixture(t, "5.13.8");
  supervisor.startIfConfigured = async () => ({ status: "needs-setup" });
  await assert.rejects(host.restorePreviousRuntime(host.runtimeConfigSnapshot(), "setup"), /expected ready/);
});

test("old-version rollback rejects unrelated degraded states", async t => {
  const { host, supervisor } = fixture(t);
  supervisor.startIfConfigured = async () => ({ status: "degraded" });
  await assert.rejects(host.restorePreviousRuntime(host.runtimeConfigSnapshot(), "setup"), /expected needs-setup/);
});

test("setup completion follows both readiness and final verification", async t => {
  const { host, events } = fixture(t, "5.13.8");
  host.run = async (_name, _args, options) => { assert.equal(options.deferCompletion, true); return { code: 0 }; };
  await host.runSetup("core-setup", ["setup"], {
    afterRuntimeReady: async () => { assert.equal(events.some(event => event.status === "completed"), false); },
  });
  assert.equal(events.filter(event => event.status === "completed").length, 1);
});

test("failed preflight leaves the previous installation untouched", async t => {
  const { host, events } = fixture(t);
  host.run = async () => { throw new Error("preflight failed"); };
  await assert.rejects(host.runSetup("core-setup", ["setup"], {}), /preflight failed/);
  assert.equal(events.includes("stop"), false);
  assert.equal(events.includes("restore"), false);
});

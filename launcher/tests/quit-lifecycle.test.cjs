const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../electron/main.cjs"), "utf8");
const quitSource = source.slice(source.indexOf("async function requestQuit()"), source.indexOf("async function start()"));

function fixture({ busyWeb = false, setup = () => null, now = Date.now } = {}) {
  const events = [];
  const context = {
    shutdownInProgress: false, exitCommitted: false, quitting: false,
    runtimeHost: { currentOperation: setup },
    runtimeSupervisor: {
      leaveNativeTransportRunning: async () => { events.push("handoff"); return { status: busyWeb ? "browser-busy" : "background" }; },
      logger: { info: event => events.push(event) },
    },
    browserHost: { currentOperation: () => null, persistSession: async () => events.push("persist"), destroy: () => events.push("destroy") },
    browserControl: { close: async () => events.push("close") },
    browserSignIn: null,
    mainWindow: { hide: () => events.push("hide") },
    app: { quit: () => events.push("quit") },
    stopCatalogVerificationMonitor() {}, showMainWindow() {},
    publishOperation: operation => events.push(operation.message),
    Date: { now }, setTimeout,
  };
  return { context, events, quit: vm.runInNewContext(`${quitSource}\nrequestQuit;`, context) };
}

test("quitting preserves browser state after handing off native transport", async () => {
  const f = fixture();
  assert.equal((await f.quit()).ok, true);
  assert.deepEqual(f.events, ["handoff", "persist", "destroy", "close", "quit"]);
  assert.equal(f.context.shutdownInProgress, false);
});

test("quitting with active Web work hides the UI without a logging or cancellation error", async () => {
  const f = fixture({ busyWeb: true });
  const result = await f.quit();
  assert.equal(result.ok, true); assert.equal(result.background, true);
  assert.deepEqual(f.events, ["handoff", "hide", "launcher.background_for_active_web_turn"]);
});

test("a quit during brief connection setup completes automatically when setup settles", async () => {
  let pending = 1;
  const f = fixture({ setup: () => pending-- > 0 ? "bridge-connect" : null });
  assert.equal((await f.quit()).ok, true);
  assert.equal(f.events.at(-1), "quit");
});

test("long setup is kept in the background without tearing down its connection", async () => {
  let calls = 0;
  const f = fixture({ setup: () => "setup", now: () => calls++ === 0 ? 0 : 10000 });
  assert.equal((await f.quit()).background, true);
  assert.deepEqual(f.events, ["hide", "launcher.background_for_setup"]);
});

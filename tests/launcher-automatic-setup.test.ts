import { test } from "node:test";
import assert from "node:assert/strict";
import { createAutomaticSetup, type SetupPhase } from "../launcher/src/automatic-setup";
import { describeSetupError, setupErrorDetail } from "../launcher/src/setup-errors";
import type { LauncherApi, LauncherSnapshot, Surface } from "../launcher/src/types";

function fixture() {
  const current = {
    profile: "production", state: { browserInteractionMode: "automatic", coreSetupComplete: false, codexCatalogVerified: false },
    browser: { authenticated: true, tabs: [] }, mcpCredentialsConfigured: false, operation: null,
  } as unknown as LauncherSnapshot;
  const calls: string[] = [];
  const phases: SetupPhase[] = [];
  const surfaces: Surface[] = [];
  const api: Pick<LauncherApi, "snapshot" | "openLogin" | "setupCore" | "setupMcp" | "verifyMcp" | "doctor" | "connectionStatus"> = {
    snapshot: async () => structuredClone(current),
    openLogin: async () => { calls.push("login"); return current.browser!; },
    setupCore: async () => { calls.push("core"); current.state.coreSetupComplete = true; return { ok: true, stdout: "", restartRequired: true }; },
    setupMcp: async (input: object) => { assert.deepEqual(input, {}); calls.push("mcp"); current.state.coreSetupComplete = true; current.state.mcpRuntimeInstalled = true; return { ok: true, stdout: "" }; },
    verifyMcp: async () => { calls.push("verify-mcp"); current.state.mcpSetupComplete = true; return { ok: true, checks: [] }; },
    doctor: async () => { calls.push("doctor"); return { ok: true, checks: [] }; },
    connectionStatus: async () => ({ nativeAvailable: true, browserConnected: true, activeBrowserTurns: 0 }),
  };
  const setup = createAutomaticSetup({ api, publish: state => phases.push(state.phase), navigate: next => surfaces.push(next) });
  return { current, calls, phases, surfaces, api, setup };
}

test("automatic setup installs once, waits for Codex evidence, then verifies readiness", async () => {
  const f = fixture();
  await f.setup.start();
  assert.equal(f.setup.getState().phase, "codex");
  assert.deepEqual(f.calls, ["core"]);
  await f.setup.resume();
  assert.deepEqual(f.calls, ["core"]);
  f.current.state.codexCatalogVerified = true;
  await f.setup.resume();
  assert.equal(f.setup.getState().phase, "ready");
  assert.deepEqual(f.calls, ["core", "doctor"]);
});

test("sign-in is opened once and setup resumes after authentication", async () => {
  const f = fixture(); f.current.browser!.authenticated = false;
  await f.setup.start(); await f.setup.resume();
  assert.deepEqual(f.calls, ["login"]);
  assert.equal(f.setup.getState().phase, "sign-in");
  f.current.browser!.authenticated = true;
  await f.setup.resume();
  assert.deepEqual(f.calls, ["login", "core"]);
});

test("events received while opening login are replayed rather than lost", async () => {
  const f = fixture(); f.current.browser!.authenticated = false;
  f.api.openLogin = async () => {
    f.current.browser!.authenticated = true;
    void f.setup.resume();
    return f.current.browser!;
  };
  await f.setup.start();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(f.calls, ["core"]);
  assert.equal(f.setup.getState().phase, "codex");
});

test("double clicks and event bursts never duplicate installation", async () => {
  const f = fixture();
  await Promise.all([f.setup.start(), f.setup.start(), f.setup.resume(), f.setup.continue()]);
  await f.setup.resume();
  assert.equal(f.calls.filter(call => call === "core").length, 1);
});

test("existing saved tool credentials are reused without collecting a key again", async () => {
  const f = fixture(); f.current.mcpCredentialsConfigured = true;
  await f.setup.start();
  assert.deepEqual(f.calls, ["mcp"]);
  f.current.state.codexCatalogVerified = true;
  await f.setup.resume();
  assert.deepEqual(f.calls, ["mcp", "verify-mcp", "doctor"]);
  assert.equal(f.setup.getState().phase, "ready");
});

test("manual mode without credentials opens Tools without switching mode or logging in", async () => {
  const f = fixture(); f.current.state.browserInteractionMode = "manual";
  f.current.browser!.authenticated = false;
  await f.setup.start();
  assert.equal(f.setup.getState().phase, "credentials");
  assert.deepEqual(f.surfaces, ["mcp"]);
  assert.deepEqual(f.calls, []);
});

test("paused browser access is never automatically resumed", async () => {
  const f = fixture();
  f.current.browser!.webAccess = { status: "paused", reason: "authorization", detectedAt: "2026-09-07", retryAt: null, incidents: 1, canResume: false };
  await f.setup.start();
  assert.equal(f.setup.getState().phase, "review");
  assert.deepEqual(f.calls, []);
});

test("setup waits for another operation and does not steal its lock", async () => {
  const f = fixture(); f.current.operation = { name: "runtime-upgrade", status: "running", message: "Updating" };
  await f.setup.start();
  assert.equal(f.setup.getState().phase, "busy"); assert.deepEqual(f.calls, []);
});

test("failed installation requires an explicit retry", async () => {
  const f = fixture(); f.api.setupCore = async () => { f.calls.push("core"); throw new Error("CDP endpoint is not ready"); };
  await f.setup.start(); await f.setup.resume(); await f.setup.resume();
  assert.equal(f.setup.getState().phase, "error"); assert.deepEqual(f.calls, ["core"]);
});

test("pausing during installation lets the transaction finish but starts no further step", async () => {
  const f = fixture();
  f.api.setupCore = async () => {
    f.calls.push("core"); f.setup.pause(); f.current.state.coreSetupComplete = true;
    return { ok: true, stdout: "", restartRequired: true };
  };
  await f.setup.start();
  assert.equal(f.setup.getState().phase, "paused"); assert.deepEqual(f.calls, ["core"]);
});

test("saved completion flags cannot mask an offline runtime", async () => {
  const f = fixture(); f.current.state.coreSetupComplete = true;
  f.api.connectionStatus = async () => ({ nativeAvailable: false, browserConnected: true, activeBrowserTurns: 0 });
  await f.setup.start(); assert.deepEqual(f.calls, ["core"]);
});

test("failed final health checks never produce a green ready state", async () => {
  const f = fixture(); f.current.state.coreSetupComplete = true; f.current.state.codexCatalogVerified = true;
  f.api.doctor = async () => ({ ok: false, checks: [] });
  await f.setup.start(); assert.equal(f.setup.getState().phase, "error"); assert.ok(!f.phases.includes("ready"));
});

test("disposal prevents a queued setup from performing work", async () => {
  const f = fixture(); const started = f.setup.start(); f.setup.dispose(); await started;
  assert.deepEqual(f.calls, []);
});

test("setup errors separate browser failure from version recovery and redact keys", () => {
  const failure = describeSetupError("Error invoking remote method 'launcher:setup-core': Error: Launcher browser CDP endpoint is not ready: fetch failed; Config requires 5.13.5; launcher is 5.13.8");
  assert.equal(failure.kind, "browser"); assert.ok(!failure.detail.startsWith("Error invoking"));
  assert.equal(describeSetupError("previous settings were restored; retry setup").kind, "version");
  assert.equal(describeSetupError("CDP endpoint failed; stopping the incomplete runtime failed").kind, "recovery");
  assert.ok(!setupErrorDetail("key sk-proj-SECRET Bearer SECRET-TOKEN").includes("SECRET"));
  assert.ok(describeSetupError("Config requires 5.13.5", "ja").title.length > 0);
});

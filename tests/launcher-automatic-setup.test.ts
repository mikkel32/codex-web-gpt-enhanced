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

function configuredFixture() {
  const f = fixture();
  f.current.state.coreSetupComplete = true;
  f.current.state.codexCatalogVerified = true;
  f.current.state.codexRestartRequired = false;
  return f;
}

test("a clean Automatic tools request establishes the Codex prerequisite before collecting credentials", async () => {
  const f = fixture();
  await f.setup.start({ toolsRequested: true });
  assert.deepEqual(f.calls, ["core"]);
  assert.equal(f.setup.getState().phase, "codex");
  f.current.state.codexCatalogVerified = true;
  await f.setup.resume();
  assert.equal(f.setup.getState().phase, "credentials");
  assert.deepEqual(f.calls, ["core"]);
  // The credential form owns the external install, then emits its committed state.
  f.current.mcpCredentialsConfigured = true;
  f.current.state.mcpRuntimeInstalled = true;
  await f.setup.resume();
  assert.deepEqual(f.calls, ["core", "verify-mcp", "doctor"]);
  assert.equal(f.setup.getState().phase, "ready");
});

test("existing Full, manual and DEV profiles never install Browser-only to work around missing credentials", async () => {
  for (const kind of ["full", "manual", "dev"] as const) {
    const f = fixture();
    if (kind === "full") f.current.state.mcpRuntimeInstalled = true;
    if (kind === "manual") f.current.state.browserInteractionMode = "manual";
    if (kind === "dev") f.current.profile = "development";
    await f.setup.start({ toolsRequested: true });
    assert.equal(f.setup.getState().phase, "credentials", kind);
    assert.deepEqual(f.calls, [], kind);
  }
});

test("the optional tool target can be deselected after pausing without changing saved Full configuration", async () => {
  const f = configuredFixture();
  await f.setup.start({ toolsRequested: true });
  assert.equal(f.setup.getState().phase, "credentials");
  f.setup.pause();
  await f.setup.start({ toolsRequested: false });
  assert.equal(f.setup.getState().phase, "ready");
  assert.deepEqual(f.calls, ["doctor"]);
  assert.equal(f.setup.getState().toolsRequested, false);
});

test("a credential form failure halts automatic setup without retrying the external mutation", async () => {
  const f = configuredFixture();
  await f.setup.start({ toolsRequested: true });
  f.setup.observeOperation({ name: "mcp-setup", status: "failed", message: "Authorization denied" });
  f.current.mcpCredentialsConfigured = true;
  await f.setup.resume();
  assert.equal(f.setup.getState().phase, "error");
  assert.equal(f.setup.getState().active, false);
  assert.deepEqual(f.calls, []);
});

test("an unrelated operation failure does not abandon a waiting setup", async () => {
  const f = configuredFixture();
  await f.setup.start({ toolsRequested: true });
  f.setup.observeOperation({ name: "update-check", status: "failed", message: "Offline" });
  assert.equal(f.setup.getState().phase, "credentials");
  assert.equal(f.setup.getState().active, true);
});

test("returning users are verified read-only without login, navigation or setup writes", async () => {
  const f = configuredFixture();
  await f.setup.inspect();
  assert.equal(f.setup.getState().phase, "ready");
  assert.deepEqual(f.calls, ["doctor"]);
  assert.deepEqual(f.surfaces, []);
  assert.equal(f.setup.getState().active, false);
});

test("read-only checking never repairs an unhealthy, signed-out or incomplete installation", async () => {
  for (const mode of ["offline", "doctor", "signed-out", "restart", "tools", "busy"] as const) {
    const f = configuredFixture();
    if (mode === "offline") f.api.connectionStatus = async () => ({ nativeAvailable: false, browserConnected: true, activeBrowserTurns: 0 });
    if (mode === "doctor") f.api.doctor = async () => ({ ok: false, checks: [] });
    if (mode === "signed-out") f.current.browser!.authenticated = false;
    if (mode === "restart") f.current.state.codexRestartRequired = true;
    if (mode === "tools") f.current.mcpCredentialsConfigured = true;
    if (mode === "busy") f.current.operation = { name: "core-setup", status: "running", message: "Installing" };
    await f.setup.inspect();
    assert.equal(f.setup.getState().phase, "idle", mode);
    assert.equal(f.calls.some(call => ["core", "mcp", "login", "verify-mcp"].includes(call)), false, mode);
    assert.deepEqual(f.surfaces, [], mode);
  }
});

test("a sign-out during read-only checking cannot be overwritten by a successful old report", async () => {
  const f = configuredFixture();
  f.api.doctor = async () => { f.current.browser!.authenticated = false; return { ok: true, checks: [] }; };
  await f.setup.inspect();
  assert.equal(f.setup.getState().phase, "idle");
  assert.ok(!f.phases.includes("ready"));
});

test("invalidating an in-flight read-only check discards its late result", async () => {
  const f = configuredFixture();
  f.api.doctor = async () => { f.setup.invalidate(); return { ok: true, checks: [] }; };
  await f.setup.inspect();
  assert.equal(f.setup.getState().phase, "idle");
  assert.ok(!f.phases.includes("ready"));
});

for (const paused of [false, true]) test(`invalidated inspection rechecks once and respects pause=${paused}`, async () => {
  const f = configuredFixture();
  let release!: () => void;
  let entered!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  f.api.doctor = async () => {
    calls += 1;
    if (calls === 1) { entered(); await gate; }
    return { ok: true, checks: [] };
  };
  const first = f.setup.inspect(); await waiting;
  f.setup.invalidate();
  const second = f.setup.inspect();
  const duplicate = f.setup.inspect();
  if (paused) f.setup.pause();
  release();
  await Promise.all([first, second, duplicate]);
  assert.equal(f.setup.getState().phase, paused ? "paused" : "ready");
  assert.equal(calls, paused ? 1 : 2);
  assert.equal(f.calls.some(call => ["core", "mcp", "login", "verify-mcp"].includes(call)), false);
});

test("readiness invalidation never starts work", async () => {
  const f = configuredFixture(); await f.setup.inspect();
  f.setup.invalidate(); await f.setup.resume();
  assert.equal(f.setup.getState().phase, "idle");
  assert.deepEqual(f.calls, ["doctor"]);
});

test("active final verification rejects changed authentication, permissions, mode and catalog", async () => {
  for (const change of ["auth", "access", "mode", "catalog", "profile"] as const) {
    const f = configuredFixture();
    f.api.doctor = async () => {
      if (change === "auth") f.current.browser!.authenticated = false;
      if (change === "access") f.current.browser!.webAccess = { status: "paused", reason: "authorization", detectedAt: "2026-09-07", retryAt: null, incidents: 1, canResume: false };
      if (change === "mode") f.current.state.browserInteractionMode = "manual";
      if (change === "catalog") f.current.state.codexCatalogVerified = false;
      if (change === "profile") f.current.profile = "development";
      return { ok: true, checks: [] };
    };
    await f.setup.start();
    const expected: Record<typeof change, SetupPhase> = { auth: "sign-in", access: "review", mode: "error", catalog: "codex", profile: "error" };
    assert.equal(f.setup.getState().phase, expected[change], change);
    assert.ok(!f.phases.includes("ready"), change);
  }
});

test("browser testing and live transport turns block automatic mutations", async () => {
  for (const mode of ["browser-testing", "tab-testing", "transport-active"] as const) {
    const f = configuredFixture();
    if (mode === "browser-testing") f.current.browser!.status = "testing";
    if (mode === "tab-testing") f.current.browser!.tabs = [{ status: "testing" }] as NonNullable<LauncherSnapshot["browser"]>["tabs"];
    if (mode === "transport-active") f.api.connectionStatus = async () => ({ nativeAvailable: false, browserConnected: true, activeBrowserTurns: 1 });
    await f.setup.start();
    assert.equal(f.setup.getState().phase, "busy", mode);
    assert.deepEqual(f.calls, [], mode);
  }
});

test("concurrent read-only checks share one flight and disposal discards completion", async () => {
  const f = configuredFixture();
  await Promise.all([f.setup.inspect(), f.setup.inspect(), f.setup.inspect()]);
  assert.deepEqual(f.calls, ["doctor"]);
  f.api.doctor = async () => { f.setup.dispose(); return { ok: true, checks: [] }; };
  f.phases.length = 0;
  await f.setup.inspect();
  assert.ok(!f.phases.includes("ready"));
});

test("a live broker turn blocks repair even when the tab snapshot is stale", async () => {
  const f = fixture(); f.current.state.coreSetupComplete = true;
  f.api.connectionStatus = async () => ({ nativeAvailable: false, browserConnected: true, activeBrowserTurns: 1 });
  await f.setup.start();
  assert.equal(f.setup.getState().phase, "busy"); assert.deepEqual(f.calls, []);
});

test("manual prompts waiting for the user are not interrupted by setup", async () => {
  const f = fixture();
  f.current.browser!.tabs = [{ status: "ready", manualState: "awaiting-user" }] as NonNullable<LauncherSnapshot["browser"]>["tabs"];
  await f.setup.start();
  assert.equal(f.setup.getState().phase, "busy"); assert.deepEqual(f.calls, []);
});

test("a pause arriving during the connection probe prevents installation", async () => {
  const f = fixture();
  f.api.connectionStatus = async () => {
    f.current.browser!.webAccess = { status: "paused", reason: "verification", detectedAt: "now", retryAt: null, incidents: 1, canResume: true };
    return { nativeAvailable: true, browserConnected: true, activeBrowserTurns: 0 };
  };
  await f.setup.start();
  assert.equal(f.setup.getState().phase, "review"); assert.deepEqual(f.calls, []);
});

test("changing workflow during a probe cannot install using the old mode", async () => {
  const f = fixture();
  f.api.connectionStatus = async () => {
    f.current.state.browserInteractionMode = "manual";
    return { nativeAvailable: true, browserConnected: true, activeBrowserTurns: 0 };
  };
  await f.setup.start();
  assert.equal(f.setup.getState().phase, "error"); assert.deepEqual(f.calls, []);
});

test("work starting during the probe prevents installation", async () => {
  const f = fixture();
  f.api.connectionStatus = async () => {
    f.current.operation = { name: "update", status: "running", message: "Updating" };
    return { nativeAvailable: true, browserConnected: true, activeBrowserTurns: 0 };
  };
  await f.setup.start();
  assert.equal(f.setup.getState().phase, "busy"); assert.deepEqual(f.calls, []);
});

for (const change of ["sign-out", "restart", "uninstall", "tools", "mode", "pause"] as const) {
  test(`final verification cannot publish ready after ${change}`, async () => {
    const f = fixture(); f.current.state.coreSetupComplete = true; f.current.state.codexCatalogVerified = true;
    f.api.doctor = async () => {
      if (change === "sign-out") f.current.browser!.authenticated = false;
      if (change === "restart") f.current.state.codexRestartRequired = true;
      if (change === "uninstall") f.current.state.coreSetupComplete = false;
      if (change === "tools") f.current.mcpCredentialsConfigured = true;
      if (change === "mode") f.current.state.browserInteractionMode = "manual";
      if (change === "pause") f.current.browser!.webAccess = { status: "paused", reason: "verification", detectedAt: "now", retryAt: null, incidents: 1, canResume: true };
      return { ok: true, checks: [] };
    };
    await f.setup.start();
    assert.notEqual(f.setup.getState().phase, "ready"); assert.ok(!f.phases.includes("ready"));
  });
}

test("connector diagnostic details survive the automatic setup flow", async () => {
  const f = fixture(); f.current.state.coreSetupComplete = true; f.current.state.codexCatalogVerified = true;
  f.current.state.mcpRuntimeInstalled = true; f.current.mcpCredentialsConfigured = true;
  f.api.verifyMcp = async () => ({ ok: false, checks: [{ id: "connector", status: "error", message: "Connection failed", detail: "Tool read not found" }] });
  await f.setup.start();
  assert.equal(f.setup.getState().phase, "connector");
  assert.equal(describeSetupError(f.setup.getState().error).kind, "toolContract");
  assert.deepEqual(f.surfaces, ["mcp"]);
});

test("reported tool and host errors have distinct localized recovery guidance", () => {
  for (const language of ["en", "zh-CN", "ja"] as const) {
    assert.equal(describeSetupError("MCP error -32602: Tool read not found", language).kind, "toolContract");
    assert.equal(describeSetupError('Unknown root "/Users". Approved roots: /codex', language).kind, "workspace");
    assert.equal(describeSetupError('Tool read not found; Unknown root "/Users"', language).kind, "workspace");
  }
  assert.ok(!setupErrorDetail("Bearer secret+/with==").includes("with"));
  assert.equal(describeSetupError("Unknown root \"/Users\"").message.includes("Do not rewrite /Users to /codex"), true);
});

for (const change of ["sign-out", "mode", "pause", "credentials", "work", "profile", "workspace"] as const) {
  for (const stage of ["installation", "connector"] as const) {
    test(`setup rechecks ${change} after ${stage} before starting another step`, async () => {
      const f = fixture(); f.current.mcpCredentialsConfigured = true;
      f.current.state.codexCatalogVerified = true;
      if (stage === "connector") { f.current.state.coreSetupComplete = true; f.current.state.mcpRuntimeInstalled = true; }
      const changeState = () => {
        if (change === "sign-out") f.current.browser!.authenticated = false;
        if (change === "mode") f.current.state.browserInteractionMode = "manual";
        if (change === "pause") f.current.browser!.webAccess = { status: "paused" } as NonNullable<LauncherSnapshot["browser"]>["webAccess"];
        if (change === "credentials") f.current.mcpCredentialsConfigured = false;
        if (change === "work") f.current.operation = { name: "task", status: "running", message: "Running" };
        if (change === "profile") f.current.profile = "development";
        if (change === "workspace") f.current.profilePaths = { coreHome: "/different/core", codexHome: "/different/codex", userData: "/different/launcher" };
      };
      if (stage === "installation") {
        f.api.setupMcp = async () => {
          f.calls.push("mcp"); f.current.state.coreSetupComplete = true; f.current.state.mcpRuntimeInstalled = true;
          changeState(); return { ok: true, stdout: "" };
        };
      } else {
        f.api.verifyMcp = async () => { f.calls.push("verify-mcp"); f.current.state.mcpSetupComplete = true; changeState(); return { ok: true, checks: [] }; };
      }
      await f.setup.start();
      assert.notEqual(f.setup.getState().phase, "ready");
      assert.deepEqual(f.calls, stage === "installation" ? ["mcp"] : ["verify-mcp"]);
    });
  }
}

test("an upgrade-required connection can be repaired while its recovery helper is running", async () => {
  const f = fixture(); f.current.state.coreSetupComplete = true;
  f.api.connectionStatus = async () => ({ nativeAvailable: false, browserConnected: false,
    activeBrowserTurns: 0, phase: "needs-setup", recoveryAvailable: true });
  await f.setup.start();
  assert.deepEqual(f.calls, ["core"]); assert.equal(f.setup.getState().phase, "codex");
});

test("an old-version active turn still blocks automatic repair", async () => {
  const f = fixture(); f.current.state.coreSetupComplete = true;
  f.api.connectionStatus = async () => ({ nativeAvailable: false, browserConnected: false,
    activeBrowserTurns: 1, phase: "needs-setup", recoveryAvailable: true });
  await f.setup.start();
  assert.deepEqual(f.calls, []); assert.equal(f.setup.getState().phase, "busy");
});

for (const ending of ["continue", "pause", "dispose"] as const) {
  test(`explicit setup requested during inspection is single-flight and respects ${ending}`, async () => {
    const f = configuredFixture();
    let entered!: () => void;
    let release!: () => void;
    const inspecting = new Promise<void>(resolve => { entered = resolve; });
    const completed = new Promise<void>(resolve => { release = resolve; });
    f.api.doctor = async () => {
      f.calls.push("doctor"); entered(); await completed; return { ok: true, checks: [] };
    };
    const check = f.setup.inspect();
    await inspecting;
    const start = f.setup.start({ toolsRequested: true });
    assert.equal(f.setup.start({ toolsRequested: true }), start);
    if (ending === "pause") f.setup.pause();
    if (ending === "dispose") f.setup.dispose();
    release();
    await Promise.all([check, start]);
    assert.deepEqual(f.calls, ["doctor"]);
    if (ending === "continue") {
      assert.equal(f.setup.getState().phase, "credentials");
      assert.equal(f.setup.getState().toolsRequested, true);
      assert.deepEqual(f.surfaces, ["mcp"]);
    } else {
      assert.equal(f.setup.getState().active, false);
      assert.deepEqual(f.surfaces, []);
      if (ending === "pause") assert.equal(f.setup.getState().phase, "paused");
    }
  });
}

for (const change of ["profile", "workspace", "version", "manual-prompt", "broker-turn"] as const) {
  test(`inspection cannot publish stale success after ${change}`, async () => {
    const f = configuredFixture();
    f.api.doctor = async () => {
      if (change === "profile") f.current.profile = "development";
      if (change === "version") f.current.version = "different-version";
      if (change === "workspace") f.current.profilePaths = { coreHome: "/changed/core", codexHome: "/changed/codex", userData: "/changed/ui" };
      if (change === "manual-prompt") f.current.browser!.tabs = [{ status: "ready", manualState: "awaiting-user" }] as NonNullable<LauncherSnapshot["browser"]>["tabs"];
      return { ok: true, checks: [] };
    };
    if (change === "broker-turn") f.api.connectionStatus = async () => ({ nativeAvailable: true, browserConnected: true, activeBrowserTurns: 1 });
    await f.setup.inspect();
    assert.equal(f.setup.getState().phase, "idle");
    assert.ok(!f.phases.includes("ready"));
    assert.deepEqual(f.surfaces, []);
  });
}

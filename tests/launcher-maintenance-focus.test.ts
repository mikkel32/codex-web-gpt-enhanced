import { expect, test } from "bun:test";

test("default maintenance and explicit turn connections focus only their verified owned page", async () => {
  // Module doubles stay in a child process so they cannot replace transports in other tests.
  const program = `
    const { mock } = await import("bun:test");
    const assert = (await import("node:assert/strict")).default;
    const home = { name: "home", evaluate: async () => "home-owned" };
    const turn = { name: "turn", evaluate: async () => "turn-owned" };
    const unrelated = { name: "unrelated", evaluate: async () => "other-owned" };
    const focused = []; let closed = 0; let failFocus = false;
    const context = {
      pages: () => [unrelated, turn, home],
      newCDPSession: async page => ({ send: async (method, args) => {
        assert.equal(method, "Emulation.setFocusEmulationEnabled");
        assert.deepEqual(args, { enabled: true });
        if (failFocus) throw new Error("fixture focus failure");
        focused.push(page.name);
      } }),
    };
    const browser = { contexts: () => [context], close: async () => { closed++; } };
    mock.module("playwright-core", () => ({ chromium: { connectOverCDP: async () => browser } }));
    mock.module("./src/launcher-cdp-readiness.ts", () => ({
      waitForLauncherCdp: async () => {},
      waitForLauncherCdpConnection: async () => ({ descriptor: { surfaceId: "home-owned" }, webSocketDebuggerUrl: "ws://127.0.0.1:1/fixture" }),
    }));
    const { connectLauncherBrowserHost } = await import("./src/launcher-browser-host.ts");
    assert.equal((await connectLauncherBrowserHost("fixture", 1000)).page, home);
    assert.deepEqual(focused, ["home"]);
    assert.equal((await connectLauncherBrowserHost("fixture", 1000, "turn-owned")).page, turn);
    assert.deepEqual(focused, ["home", "turn"]);
    failFocus = true;
    await assert.rejects(connectLauncherBrowserHost("fixture", 1000), /fixture focus failure/);
    assert.equal(closed, 1);
    assert.deepEqual(focused, ["home", "turn"]);
    console.log("OWNED_MAINTENANCE_FOCUS_OK");
  `;
  const child = Bun.spawn([process.execPath, "-e", program], { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
  expect(stdout).toContain("OWNED_MAINTENANCE_FOCUS_OK");
}, 15000);

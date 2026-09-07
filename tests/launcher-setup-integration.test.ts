import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { waitForLauncherCdpConnection } from "../src/launcher-cdp-readiness";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the merged launcher retains automatic setup and redacted actionable errors", () => {
  const app = source("launcher/src/App.tsx");
  expect(app).toContain("<AutomaticSetup snapshot=");
  expect(app).toContain("const failure = describeSetupError(message, language)");
  expect(app).toContain("setupRecoveryKind(failure.detail)");
  expect(app).toContain("<pre>{failure.detail}</pre>");
  expect(app).toContain('role="alert"');
  expect(app).toContain("repairSetupPending.current");
});

test("production CDP uses the verified socket without a second discovery request", async () => {
  const descriptor = { endpoint: "http://127.0.0.1:19222", profile: "production" as const };
  const webSocketDebuggerUrl = "ws://127.0.0.1:19222/devtools/browser/owned";
  let calls = 0;
  expect(await waitForLauncherCdpConnection(() => descriptor, {
    fetchImpl: async () => { calls++; return Response.json({ webSocketDebuggerUrl }); },
  })).toEqual({ descriptor, webSocketDebuggerUrl });
  expect(calls).toBe(1);
  expect(source("src/launcher-browser-host.ts")).toContain("chromium.connectOverCDP(webSocketDebuggerUrl");
});

test("CLI awaits the shared preflight and never duplicates the liveness probe", () => {
  const cli = source("src/cli.ts");
  const preflight = cli.slice(cli.indexOf("  if (preflightOnly) {"), cli.indexOf("  const existing = existsSync(getConfigPath())"));
  expect(preflight).toContain("await preflightSetup(options)");
  expect(preflight).not.toContain("inspectLauncherBrowserHostLiveness");
  expect(source("src/setup.ts")).toContain('config.browserInteractionMode !== "manual"');
});

"""One-off, exact-source merge reproduction. Removed before release; no account state is accessed."""
from pathlib import Path
import re

ROOT = Path.cwd()
PATTERN = re.compile(r'^<<<<<<< HEAD\n(.*?)^=======\n(.*?)^>>>>>>>[^\n]*\n', re.M | re.S)

def resolve(name, choices):
    path = ROOT / name
    index = 0
    def change(match):
        nonlocal index
        choice = choices[index]
        index += 1
        return match[1] if choice == 'ours' else match[2] if choice == 'theirs' else choice
    value = PATTERN.sub(change, path.read_text())
    assert index == len(choices), (name, index)
    path.write_text(value)

def replace(name, old, new):
    path = ROOT / name
    value = path.read_text()
    assert value.count(old) == 1, (name, old[:80], value.count(old))
    path.write_text(value.replace(old, new))

resolve('launcher/electron/runtime.cjs', ['ours', 'theirs', '          deferCompletion: true,\n          message: "Checking saved settings and the local browser connection before changing the runtime",\n', 'theirs'])
replace('launcher/electron/runtime.cjs', 'const needsUpgrade = this.launcherProfile === "production"', 'const needsUpgrade = snapshot.owner === "launcher"\n      && this.launcherProfile === "production"')
path = ROOT / 'launcher/electron/runtime.cjs'
value = path.read_text().replace('''          if (restored?.status === "needs-setup") {
            recoveryNotice = "Previous settings were preserved; setup must still complete the runtime upgrade";
          }
''', '').replace('        ...(recoveryNotice ? [recoveryNotice] : []),\n', '').replace('previous settings were restored; retry setup to finish upgrading them for this launcher', 'Previous settings were preserved; setup must still complete the runtime upgrade')
path.write_text(value)
resolve('launcher/src/App.tsx', ['ours', '''function ErrorToast({ copy, language, message, busy, onRetry, onDismiss }: {
  copy: Copy; language: Language; message: string; busy: boolean;
  onRetry?: () => void; onDismiss: () => void;
}) {
  const failure = describeSetupError(message, language);
  const kind = setupRecoveryKind(failure.detail);
  const recovery = kind ? setupRecoveryCopy(kind, language) : null;
''', 'theirs'])
resolve('src/cli.ts', ['theirs'])
resolve('src/launcher-browser-host.ts', ['theirs', 'theirs', 'theirs'])
resolve('tests/cli.test.ts', ['theirs'])
replace('src/launcher-browser-host.ts', 'import { waitForLauncherCdp } from "./launcher-cdp-readiness";', 'import { waitForLauncherCdp, waitForLauncherCdpConnection } from "./launcher-cdp-readiness";')
replace('src/launcher-browser-host.ts', 'return waitForLauncherCdp(() => readLauncherBrowserHostDescriptor(descriptorPath), options);', '''return waitForLauncherCdp(() => readLauncherBrowserHostDescriptor(descriptorPath), {
    ...options, isOwnerRunning: descriptor => processRunning(descriptor.pid),
  });''')
replace('src/launcher-browser-host.ts', '''  const remaining = () => {
    const ms = Math.ceil(deadline - performance.now());''', '''  const remaining = () => {
    if (abortSignal?.aborted) throw new DOMException("Launcher browser connection aborted", "AbortError");
    const ms = Math.ceil(deadline - performance.now());''')
replace('src/launcher-browser-host.ts', '''  const descriptor = await inspectLauncherBrowserHostLiveness(descriptorPath, {
    timeoutMs: Math.min(remaining(), 5_000), signal: abortSignal,
  });''', '''  const { descriptor, webSocketDebuggerUrl } = await waitForLauncherCdpConnection(
    () => readLauncherBrowserHostDescriptor(descriptorPath), {
      timeoutMs: Math.min(remaining(), 5_000), signal: abortSignal,
      isOwnerRunning: candidate => processRunning(candidate.pid),
    },
  );''')
replace('src/launcher-browser-host.ts', 'chromium.connectOverCDP(descriptor.endpoint, { timeout: remaining() })', 'chromium.connectOverCDP(webSocketDebuggerUrl, { timeout: remaining() })')
replace('src/launcher-cdp-readiness.ts', 'function validateMetadata(body: unknown, endpoint: URL): void {', 'function validateMetadata(body: unknown, endpoint: URL): string {')
replace('src/launcher-cdp-readiness.ts', 'CDP metadata did not expose a loopback WebSocket endpoint', 'CDP metadata did not expose a valid browser WebSocket')
replace('src/launcher-cdp-readiness.ts', 'CDP metadata must identify a browser on the same loopback port', 'CDP metadata did not identify the expected loopback browser endpoint on the same loopback port')
replace('src/launcher-cdp-readiness.ts', '''  }
}

function transportDetail''', '''  }
  return socket.href;
}

function transportDetail''')
replace('src/launcher-cdp-readiness.ts', '''export async function waitForLauncherCdp<T extends CdpHostDescriptor>(
  readDescriptor: () => T,
  options: { timeoutMs?: number; signal?: AbortSignal; expectedProfile?: T["profile"] } = {},
): Promise<T> {''', '''export interface CdpReadinessOptions<T extends CdpHostDescriptor> {
  timeoutMs?: number;
  signal?: AbortSignal;
  expectedProfile?: T["profile"];
  isOwnerRunning?: (descriptor: T) => boolean;
  fetchImpl?: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;
}

export async function waitForLauncherCdpConnection<T extends CdpHostDescriptor>(
  readDescriptor: () => T,
  options: CdpReadinessOptions<T> = {},
): Promise<{ descriptor: T; webSocketDebuggerUrl: string }> {''')
replace('src/launcher-cdp-readiness.ts', '''    const descriptor = readDescriptor();
    expectedProfile''', '''    const descriptor = readDescriptor();
    if (options.isOwnerRunning && !options.isOwnerRunning(descriptor)) {
      throw new Error("Launcher browser host exited before its CDP endpoint became ready");
    }
    expectedProfile''')
replace('src/launcher-cdp-readiness.ts', 'const response = await fetch(`${endpoint.origin}/json/version`, {', 'const response = await (options.fetchImpl ?? fetch)(`${endpoint.origin}/json/version`, {')
replace('src/launcher-cdp-readiness.ts', 'redirect: "manual",', 'redirect: "manual",\n        cache: "no-store",')
replace('src/launcher-cdp-readiness.ts', 'Launcher CDP endpoint returned invalid JSON', 'CDP metadata is not valid JSON')
replace('src/launcher-cdp-readiness.ts', '        validateMetadata(body, endpoint);', '        const webSocketDebuggerUrl = validateMetadata(body, endpoint);')
replace('src/launcher-cdp-readiness.ts', '''        aborted(options.signal);
        return descriptor;''', '''        aborted(options.signal);
        if (options.isOwnerRunning && !options.isOwnerRunning(descriptor)) {
          throw new InvalidCdpMetadataError("Launcher browser host exited during CDP readiness verification");
        }
        return { descriptor, webSocketDebuggerUrl };''')
with (ROOT / 'src/launcher-cdp-readiness.ts').open('a') as file:
    file.write('''
/** Metadata-only callers share the exact same ownership, deadline and retry checks. */
export async function waitForLauncherCdp<T extends CdpHostDescriptor>(
  readDescriptor: () => T,
  options: CdpReadinessOptions<T> = {},
): Promise<T> {
  return (await waitForLauncherCdpConnection(readDescriptor, options)).descriptor;
}
''')
(ROOT / 'src/lib/launcher-cdp.ts').write_text('''import { waitForLauncherCdpConnection } from "../launcher-cdp-readiness";

type CdpReadinessOptions = {
  timeoutMs: number;
  signal?: AbortSignal;
  isOwnerRunning: () => boolean;
  fetchImpl?: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;
};

/** Compatibility facade: all callers use the same validated CDP readiness implementation. */
export async function waitForLauncherCdp(endpoint: string, options: CdpReadinessOptions): Promise<string> {
  const connection = await waitForLauncherCdpConnection(
    () => ({ endpoint, profile: "production" as const }), options,
  );
  return connection.webSocketDebuggerUrl;
}
''')
replace('tests/launcher-cdp.test.ts', 'expect(options?.redirect).toBe("error");', 'expect(options?.redirect).toBe("manual");')
replace('launcher/src/setup-recovery.ts', '  const primary = message.split', '  if (/stopping the incomplete runtime failed|checkpoint restoration failed|rollback failed/i.test(message)) return null;\n  const primary = message.split')
replace('launcher/src/setup-recovery.ts', 'if (/sign in|logged out|unauthorized|forbidden|HTTP (401|403)|access (denied|paused)/i.test(primary)) return null;', r'if (/sign in|logged out|unauthorized|forbidden|HTTP (?:3\d\d|4\d\d)|access (denied|paused)|CDP metadata|unsafe permissions|unexpected.*(?:partition|surface)|different launcher browser host/i.test(primary)) return null;')
with (ROOT / 'tests/launcher-cdp.test.ts').open('a') as file:
    file.write('''
test("CDP shared readiness rechecks ownership after receiving metadata", async () => {
  let ownerChecks = 0;
  await expect(waitForLauncherCdp(endpoint, {
    timeoutMs: 100, isOwnerRunning: () => ++ownerChecks === 1, fetchImpl: async () => ready(),
  })).rejects.toThrow("host exited during CDP readiness verification");
  expect(ownerChecks).toBe(2);
});

test.each([301, 302, 307, 308])("CDP compatibility facade rejects redirect HTTP %i once", async status => {
  let calls = 0;
  await expect(run(async () => { calls++; return new Response(null, { status }); })).rejects.toThrow(`HTTP ${status}`);
  expect(calls).toBe(1);
});

test("CDP diagnostics do not repeat arbitrary exception data", async () => {
  await expect(run(async () => { throw new Error("private-cookie-value sk-proj-example-secret"); }, 10))
    .rejects.toThrow("local browser transport unavailable");
  try { await run(async () => { throw new Error("private-cookie-value sk-proj-example-secret"); }, 10); }
  catch (error) { expect(String(error)).not.toContain("private-cookie-value"); expect(String(error)).not.toContain("sk-proj-"); }
});
''')
with (ROOT / 'tests/setup-recovery-ui.test.ts').open('a') as file:
    file.write('''
test.each([
  "Launcher browser CDP endpoint is not ready; stopping the incomplete runtime failed: still alive",
  "Launcher browser CDP endpoint is not ready; checkpoint restoration failed",
  "Launcher browser CDP endpoint is not ready: CDP metadata did not identify the expected loopback browser endpoint",
  "Launcher browser CDP endpoint returned HTTP 302",
  "Launcher browser CDP endpoint returned HTTP 404",
])("unsafe recovery never offers a blind setup retry: %s", message => {
  expect(setupRecoveryKind(message)).toBeNull();
});
''')
(ROOT / 'tests/launcher-setup-integration.test.ts').write_text('''import { expect, test } from "bun:test";
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
''')
for name in ['launcher/electron/runtime.cjs', 'launcher/src/App.tsx', 'src/cli.ts', 'src/launcher-browser-host.ts', 'tests/cli.test.ts']:
    assert not PATTERN.search((ROOT / name).read_text()), name

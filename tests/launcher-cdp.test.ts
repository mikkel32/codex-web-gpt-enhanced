import { expect, test } from "bun:test";
import { waitForLauncherCdp } from "../src/lib/launcher-cdp";
const endpoint = "http://127.0.0.1:19222";
const socket = "ws://127.0.0.1:19222/devtools/browser/owned-browser";
const ready = () => Response.json({ webSocketDebuggerUrl: socket });
const run = (impl: (...args: Parameters<typeof fetch>) => Promise<Response>, timeoutMs = 2_000, signal?: AbortSignal) =>
  waitForLauncherCdp(endpoint, { timeoutMs, signal, isOwnerRunning: () => true, fetchImpl: impl as typeof fetch });

test("CDP recovers from connection refusal and temporary HTTP failure", async () => {
  let calls = 0;
  expect(await run(async (_url, options) => {
    expect(options?.redirect).toBe("error");
    calls++;
    if (calls === 1) throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });
    return calls === 2 ? new Response(null, { status: 503 }) : ready();
  })).toBe(socket);
  expect(calls).toBe(3);
});
test.each([401, 403, 404])("CDP never retries permanent HTTP %i", async status => {
  let calls = 0;
  await expect(run(async () => { calls++; return new Response(null, { status }); })).rejects.toThrow(`HTTP ${status}`);
  expect(calls).toBe(1);
});
test.each([
  "ws://127.0.0.1:19223/devtools/browser/other",
  "ws://127.0.0.1.example.com:19222/devtools/browser/other",
  "ws://user:secret@127.0.0.1:19222/devtools/browser/other",
  "ws://127.0.0.1:19222/devtools/page/other",
  "ws://127.0.0.1:19222/devtools/browser/other?secret=value",
])("CDP rejects an unsafe socket: %s", async value => {
  let calls = 0;
  await expect(run(async () => { calls++; return Response.json({ webSocketDebuggerUrl: value }); })).rejects.toThrow("expected loopback browser endpoint");
  expect(calls).toBe(1);
});
test("CDP rejects malformed metadata", async () => {
  await expect(run(async () => new Response("not JSON"))).rejects.toThrow("not valid JSON");
  await expect(run(async () => Response.json({}))).rejects.toThrow("valid browser WebSocket");
});
test("CDP timeout preserves the network cause within its total budget", async () => {
  const start = performance.now();
  await expect(run(async () => {
    throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });
  }, 35)).rejects.toThrow("ECONNREFUSED");
  expect(performance.now() - start).toBeLessThan(1_000);
});
test("CDP cancellation stops retry backoff", async () => {
  const controller = new AbortController();
  let calls = 0;
  const result = run(async () => { calls++; throw new TypeError("fetch failed"); }, 2_000, controller.signal);
  const timer = setTimeout(() => controller.abort(), 10);
  try { await expect(result).rejects.toMatchObject({ name: "AbortError" }); }
  finally { clearTimeout(timer); }
  expect(calls).toBe(1);
});
test("CDP refuses a dead owner before issuing a request", async () => {
  let calls = 0;
  await expect(waitForLauncherCdp(endpoint, {
    timeoutMs: 100, isOwnerRunning: () => false,
    fetchImpl: (async () => { calls++; return ready(); }) as typeof fetch,
  })).rejects.toThrow("host exited");
  expect(calls).toBe(0);
});
test.each([0, -1, Infinity, NaN])("CDP rejects invalid timeout %s", async timeoutMs => {
  await expect(waitForLauncherCdp(endpoint, { timeoutMs, isOwnerRunning: () => true })).rejects.toThrow("timeout must be positive");
});

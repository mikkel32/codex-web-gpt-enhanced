import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type RequestListener } from "node:http";
import { waitForLauncherCdp, LauncherCdpReadinessError } from "../src/launcher-cdp-readiness";

async function serverFor(handler: RequestListener) {
  const server = createServer(handler);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  return {
    descriptor: { endpoint: `http://127.0.0.1:${address.port}`, profile: "production" as const },
    close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}

const metadata = (host: string | undefined) => JSON.stringify({ webSocketDebuggerUrl: `ws://${host}/devtools/browser/test` });

test("CDP retries a cold browser and succeeds without retrying setup itself", async () => {
  let attempts = 0;
  const server = await serverFor((request, response) => {
    assert.equal(request.url, "/json/version");
    if (++attempts < 3) { response.writeHead(503); response.end(); }
    else response.end(metadata(request.headers.host));
  });
  try {
    assert.deepEqual(await waitForLauncherCdp(() => server.descriptor, { timeoutMs: 2_000 }), server.descriptor);
    assert.equal(attempts, 3);
  } finally { await server.close(); }
});

test("CDP rereads the descriptor when a browser restart changes its port", async () => {
  const old = await serverFor((_request, response) => { response.writeHead(503); response.end(); });
  const next = await serverFor((request, response) => response.end(metadata(request.headers.host)));
  let reads = 0;
  try {
    const ready = await waitForLauncherCdp(() => ++reads === 1 ? old.descriptor : next.descriptor);
    assert.equal(ready.endpoint, next.descriptor.endpoint);
    assert.equal(reads, 2);
  } finally { await old.close(); await next.close(); }
});

test("CDP cancellation interrupts a pending fetch", async () => {
  const server = await serverFor(() => {});
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30);
  try {
    await assert.rejects(waitForLauncherCdp(() => server.descriptor, { signal: controller.signal }), { name: "AbortError" });
  } finally { clearTimeout(timer); await server.close(); }
});

test("CDP has one bounded deadline even when the endpoint never answers", async () => {
  const server = await serverFor(() => {});
  const start = performance.now();
  try {
    await assert.rejects(waitForLauncherCdp(() => server.descriptor, { timeoutMs: 100 }), error => {
      assert.ok(error instanceof LauncherCdpReadinessError);
      assert.equal(error.code, "LAUNCHER_CDP_NOT_READY");
      assert.match(error.message, /100ms/);
      return true;
    });
    assert.ok(performance.now() - start < 2_000);
  } finally { await server.close(); }
});

for (const status of [301, 302, 401, 403, 404]) {
  test(`CDP fails closed on HTTP ${status} without redirects or retries`, async () => {
    let requests = 0;
    const server = await serverFor((_request, response) => {
      requests += 1; response.writeHead(status, { location: "http://127.0.0.1:1/private" }); response.end();
    });
    try {
      await assert.rejects(waitForLauncherCdp(() => server.descriptor), new RegExp(`HTTP ${status}`));
      assert.equal(requests, 1);
    } finally { await server.close(); }
  });
}

for (const socket of ["ws://127.0.0.1:1/devtools/browser/test", "ws://127.0.0.1.evil.test:1234/devtools/browser/test", "wss://127.0.0.1:1234/devtools/browser/test"]) {
  test(`CDP rejects unsafe metadata ${socket}`, async () => {
    let requests = 0;
    const server = await serverFor((_request, response) => { requests += 1; response.end(JSON.stringify({ webSocketDebuggerUrl: socket })); });
    try {
      await assert.rejects(waitForLauncherCdp(() => server.descriptor), /same loopback port/);
      assert.equal(requests, 1);
    } finally { await server.close(); }
  });
}

test("CDP does not retry invalid descriptor ownership or permissions", async () => {
  let reads = 0;
  await assert.rejects(waitForLauncherCdp(() => { reads += 1; throw new Error("unsafe permissions"); }), /unsafe permissions/);
  assert.equal(reads, 1);
});

test("CDP refuses a profile change during retry", async () => {
  const server = await serverFor((_request, response) => { response.writeHead(503); response.end(); });
  let reads = 0;
  try {
    await assert.rejects(waitForLauncherCdp(() => ({ ...server.descriptor, profile: ++reads === 1 ? "production" : "development" })), /production was required/);
  } finally { await server.close(); }
});

test("already cancelled CDP checks do not read the descriptor", async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(waitForLauncherCdp(() => { throw new Error("must not read"); }, { signal: controller.signal }), { name: "AbortError" });
});

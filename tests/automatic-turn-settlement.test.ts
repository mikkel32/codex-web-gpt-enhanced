import { expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { notifyLauncherTurn, LAUNCHER_BROWSER_HOST_KIND, LAUNCHER_BROWSER_IDLE_URL } from "../src/launcher-browser-host";
import { LauncherControlHttpError, reconcileLauncherTurnEnd } from "../src/launcher-turn-settlement";
const { BrowserHost } = require("../launcher/electron/browser-host.cjs");
const { BrowserControlServer } = require("../launcher/electron/control-server.cjs");
const { SavedConversations } = require("../launcher/electron/saved-conversations.cjs");

const ending = { phase: "end" as const, traceId: "fixture_turn", helperPid: 123, status: "completed" as const };

test("a lost completion response is reconciled by a read-only receipt without repeating the mutation", async () => {
  const calls: string[] = [];
  let original = "";
  const result = await reconcileLauncherTurnEnd(async (action, body) => {
    calls.push(action);
    if (action === "end") { original = JSON.stringify(body); throw new Error("fixture lost response after commit"); }
    expect(JSON.stringify(body)).toEqual(original);
    return { ok: true, state: "completed", result: { cancelledByUser: false } };
  }, ending, 500);
  expect(result).toEqual({ cancelledByUser: false });
  expect(calls).toEqual(["end", "settlement"]);
});

test("only a missing receipt on an idempotent server permits one identical end retry", async () => {
  const calls: string[] = [];
  const bodies: unknown[] = [];
  await reconcileLauncherTurnEnd(async (action, body) => {
    calls.push(action); bodies.push(body);
    if (calls.length === 1) throw new Error("fixture disconnected before delivery");
    if (action === "settlement") return { ok: true, state: "missing" };
    return { ok: true, cancelledByUser: false };
  }, ending, 500);
  expect(calls).toEqual(["end", "settlement", "end"]);
  expect(bodies.every(body => JSON.stringify(body) === JSON.stringify(bodies[0]))).toBe(true);
});

test("permanent rejection and legacy servers never trigger an end replay", async () => {
  for (const status of [400, 401, 403, 409]) {
    let calls = 0;
    await expect(reconcileLauncherTurnEnd(async () => { calls++; throw new LauncherControlHttpError(status, "fixture rejection"); }, ending, 500)).rejects.toThrow(`HTTP ${status}`);
    expect(calls).toBe(1);
  }
  const calls: string[] = [];
  await expect(reconcileLauncherTurnEnd(async action => {
    calls.push(action);
    if (action === "end") throw new Error("fixture lost old-server response");
    throw new LauncherControlHttpError(404, "old server has no receipts");
  }, ending, 500)).rejects.toThrow("no prompt was replayed");
  expect(calls).toEqual(["end", "settlement"]);
});

test("pending, failed and malformed receipts cannot invent a completion", async () => {
  for (const state of [{ state: "failed" }, { state: "completed", result: {} }, { state: "unknown" }, { state: "pending" }]) {
    let writes = 0;
    const start = performance.now();
    await expect(reconcileLauncherTurnEnd(async action => {
      if (action === "end") { writes++; throw new Error("fixture lost acknowledgement"); }
      return { ok: true, ...state };
    }, ending, 40)).rejects.toThrow("no prompt was replayed");
    expect(writes).toBe(1);
    expect(performance.now() - start).toBeLessThan(1000);
  }
});

async function listen(server: Server): Promise<string> {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture port");
  return `http://127.0.0.1:${address.port}`;
}

test("120 retained continuations survive dropped terminal HTTP responses with one durable completion each", async () => {
  const root = mkdtempSync(join(tmpdir(), "maria-settlement-integration-"));
  const key = "a".repeat(64), url = "https://chatgpt.com/c/offline-retained-fixture";
  const storeFile = join(root, "saved-conversations.json");
  const store = new SavedConversations(storeFile);
  store.set(key, { url, status: "ready", connectorIdentity: "fixture-connector", connectorBound: true });
  let completed = 0, submissions = 0, dropAfterCommit = true;
  const dropped = new Set<string>();
  const tab = { id: "retained", surfaceId: "s".repeat(32), traceId: "old_trace", helperPid: process.pid,
    conversationKey: key, connectorIdentity: "fixture-connector", connectorBound: true,
    status: "ready", interactionMode: "automatic", bootstrapReady: true,
    view: { webContents: { getURL: () => url, isDestroyed: () => false,
      setBackgroundThrottling() {}, isLoadingMainFrame: () => false } } };
  const logger = { info(event: string) { if (event === "browser.tab_completed") completed++; }, warn() {}, error() {} };
  const host = Object.assign(Object.create(BrowserHost.prototype), {
    manualOperation: null, browserInteractionMode: () => "automatic", savedConversations: store,
    turnTabs: new Map([[tab.id, tab]]), selectedTabId: tab.id,
    userCancelledTurnOwners: new Map(), closedTurnOwners: new Map(), logger,
    syncPowerSaveBlocker() {}, syncViewVisibility() {}, snapshot: () => ({}), publishState() {}, writeDescriptor() {},
    createTurnTab: () => { throw new Error("Must not open a replacement chat"); },
    removeTurnTab: () => { throw new Error("Must not remove the retained chat"); },
  });
  const control = await new BrowserControlServer({ logger, getBrowserHost: () => host, getPreferences: () => ({}) }).start();
  const real = control.descriptor();
  const proxy = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const bytes = Buffer.concat(chunks);
      const body = JSON.parse(bytes.toString());
      const lose = request.url === "/v1/turn/end" && !dropped.has(body.requestId);
      if (lose) dropped.add(body.requestId);
      if (lose && !dropAfterCommit) { response.destroy(); return; }
      const upstream = await fetch(`${real.endpoint}${request.url}`, {
        method: "POST", headers: { authorization: `Bearer ${real.token}`, "content-type": "application/json" }, body: bytes,
      });
      const text = await upstream.text();
      if (lose) { response.destroy(); return; }
      response.writeHead(upstream.status, { "content-type": "application/json" }); response.end(text);
    } catch { response.destroy(); }
  });
  try {
    const endpoint = await listen(proxy);
    const path = join(root, "launcher-browser.json");
    writeFileSync(path, JSON.stringify({ version: 2, kind: LAUNCHER_BROWSER_HOST_KIND, profile: "development", pid: process.pid,
      endpoint: "http://127.0.0.1:39110", control: { endpoint, token: real.token },
      helper: { executable: process.execPath, script: import.meta.path }, partition: "persist:codex-web-gpt-dev-chatgpt",
      idleUrl: LAUNCHER_BROWSER_IDLE_URL, surfaceId: "s".repeat(32), createdAt: new Date().toISOString(),
    }), { mode: 0o600 });
    for (let i = 0; i < 120; i++) {
      const traceId = `continuation_${i}`;
      const lease = await host.beginTurn(traceId, false, process.pid, key, "fixture-connector", true);
      expect(lease.reused).toBe(true);
      await host.rememberConversationSubmission(traceId, process.pid); submissions++;
      dropAfterCommit = i % 2 === 0;
      expect(await notifyLauncherTurn(path, { phase: "end", traceId, helperPid: process.pid, status: "completed", retain: true, connectorBound: true }, 2000))
        .toEqual({ cancelledByUser: false });
      // The accepted result remains authoritative when a helper exit arrives late.
      await host.endTurn(traceId, process.pid, "failed", false, "fixture delayed helper exit");
      expect(host.turnTabs.size).toBe(1);
      expect(tab.status).toBe("ready");
      expect(new SavedConversations(storeFile).get(key)).toMatchObject({ status: "ready", url, connectorBound: true });
    }
    expect(submissions).toBe(120);
    expect(completed).toBe(120);
    expect(dropped.size).toBe(120);
    console.info("RETAINED_SETTLEMENT_HTTP_OK continuations=120 dropped-responses=120 commits=120 replacement-chats=0");
  } finally {
    proxy.closeAllConnections();
    await new Promise<void>(resolve => proxy.close(() => resolve()));
    await control.close();
    rmSync(root, { recursive: true, force: true });
  }
}, 30000);

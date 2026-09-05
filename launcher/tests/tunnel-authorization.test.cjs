const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { tunnelAuthorizationFailure } = require('../electron/tunnel-authorization.cjs');
const { RuntimeSupervisor } = require('../electron/runtime-supervisor.cjs');
const { BrowserHost } = require('../electron/browser-host.cjs');
const { RuntimeHost } = require('../electron/runtime.cjs');

test('only recent explicit poll authorization errors pause access, and later recovery supersedes them', () => {
  const now = Date.now();
  const event = (status, time = now) => ({ message: 'poll failed; backing off', time: new Date(time).toISOString(), attrs: { status_code: status } });
  for (const status of [401, 403]) assert.equal(tunnelAuthorizationFailure([event(status)], now).status, status);
  for (const status of [400, 404, 408, 429, 500, 502, 503]) assert.equal(tunnelAuthorizationFailure([event(status)], now), null);
  assert.equal(tunnelAuthorizationFailure([event(403, now - 120001)], now), null);
  assert.equal(tunnelAuthorizationFailure([event(403, now + 6000)], now), null);
  assert.equal(tunnelAuthorizationFailure([{ ...event(403), message: 'unrelated upstream error' }], now), null);
  const recovered = { time: new Date(now + 1).toISOString(), message: 'poller recovered; polling operational' };
  assert.equal(tunnelAuthorizationFailure([recovered, event(403)], now), null);
});

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maria-tunnel-auth-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const create = () => new RuntimeSupervisor({ app: {}, logger: { info() {}, warn() {}, error() {} },
    coreHome: root, sourceRoot: root, browserDescriptorPath: path.join(root, 'browser.json') });
  return { root, create, supervisor: create() };
}

test('authorization rejection stops only the tunnel and blocks reconnect across app restarts', async t => {
  const { supervisor, create } = fixture(t);
  const daemon = { pid: process.pid };
  supervisor.daemon = daemon;
  let stops = 0;
  supervisor.stopTunnelGracefully = async () => { stops++; supervisor.tunnel = null; };
  supervisor.tryWriteState = () => true;
  await supervisor.pauseTunnelForAuthorization({}, { status: 403, detectedAt: new Date().toISOString() });
  assert.equal(stops, 1);
  assert.equal(supervisor.daemon, daemon);
  const pause = JSON.parse(fs.readFileSync(supervisor.tunnelAuthorizationPausePath, 'utf8'));
  assert.deepEqual(Object.keys(pause).sort(), ['detectedAt', 'status', 'version']);
  if (process.platform !== 'win32') assert.equal(fs.statSync(supervisor.tunnelAuthorizationPausePath).mode & 0o777, 0o600);
  const restored = create();
  await assert.rejects(restored.startTunnel({ mode: 'full' }), /access is paused/);
  restored.scheduleRecovery('tunnel');
  assert.equal(restored.restartTimers.tunnel, null);
  restored.clearTunnelAuthorizationPause();
  assert.equal(fs.existsSync(restored.tunnelAuthorizationPausePath), false);
});

test('a persistence failure still stops the tunnel and blocks automatic reconnect in memory', async t => {
  const { root, supervisor } = fixture(t);
  const blocker = path.join(root, 'not-a-directory'); fs.writeFileSync(blocker, 'block');
  supervisor.tunnelAuthorizationPausePath = path.join(blocker, 'pause.json');
  let stops = 0;
  supervisor.stopTunnelGracefully = async () => { stops++; };
  supervisor.tryWriteState = () => true;
  await supervisor.pauseTunnelForAuthorization({}, { status: 401, detectedAt: new Date().toISOString() });
  assert.equal(stops, 1);
  await assert.rejects(supervisor.startTunnel({ mode: 'full' }), /access is paused/);
  supervisor.scheduleRecovery('tunnel');
  assert.equal(supervisor.restartTimers.tunnel, null);
});

test('paused tunnel access blocks automatic allocation, manual handoff and the final Send boundary', async t => {
  const { supervisor } = fixture(t);
  supervisor.tunnelAuthorizationPaused = true;
  const browser = Object.assign(Object.create(BrowserHost.prototype), {
    assertWebTransportAvailable: () => supervisor.assertTunnelAccess(),
  });
  await assert.rejects(browser.beginTurnOnce('trace', false, 1), { code: 'browser_access_paused' });
  assert.throws(() => browser.beginManualTurn('trace', 1, 'prompt'), { code: 'browser_access_paused' });
  await assert.rejects(browser.admitConversationSubmission({}, 1), { code: 'browser_access_paused' });
  supervisor.tunnelAuthorizationPaused = false;
  const tab = { id: 'tab', status: 'running', helperPid: 1, interactionMode: 'automatic' };
  browser.turnTabs = new Map([[tab.id, tab]]);
  browser.accessGate = { beforeSend: async () => { supervisor.tunnelAuthorizationPaused = true; } };
  await assert.rejects(browser.admitConversationSubmission(tab, 1), { code: 'browser_access_paused' });
  assert.equal(tab.submissionActivated, undefined);
});

test('local poll diagnostics propagate authorization failure even when health endpoints report ready', async t => {
  const { supervisor } = fixture(t);
  supervisor.tunnelHealthBaseUrl = 'http://127.0.0.1:43127';
  supervisor.tunnel = { pid: process.pid };
  t.mock.method(global, 'fetch', async url => {
    assert.ok(String(url).startsWith(supervisor.tunnelHealthBaseUrl));
    return String(url).includes('/api/logs') ? Response.json({ events: [{
      time: new Date().toISOString(), message: 'poll failed; backing off', attrs: { status_code: 403 },
    }] }) : new Response('ready');
  });
  const health = await supervisor.readLocalTunnelHealth();
  assert.equal(health.ready, false);
  assert.equal(health.statusKnown, true);
  assert.equal(health.authorization.status, 403);
  assert.equal(health.waitingOnDependency, false);
});

test('only explicit MCP setup clears authorization, after configuration succeeds and before runtime start', async () => {
  const actions = [];
  let paused = true;
  const host = Object.assign(Object.create(RuntimeHost.prototype), {
    launcherProfile: 'development',
    currentOperation: () => null,
    runtimeConfigSnapshot: () => ({ configured: true, owner: 'launcher' }),
    captureSetupCheckpoint: () => ({}),
    supervisor: {
      assertTunnelAccess: () => { if (paused) throw new Error('authorization paused'); },
      stopForSetup: async () => { actions.push('stop'); },
      clearTunnelAuthorizationPause: () => { actions.push('clear'); paused = false; },
      startIfConfigured: async () => { assert.equal(paused, false); actions.push('start'); return { status: 'ready' }; },
    },
    run: async () => { assert.equal(paused, true); actions.push('configure'); return {}; },
  });
  await assert.rejects(host.runSetup('runtime-upgrade', [], {}), /authorization paused/);
  await assert.rejects(host.runSetup('bigger-context', [], {}), /authorization paused/);
  assert.deepEqual(actions, []);
  await host.runSetup('dev-mcp-setup', [], {});
  assert.deepEqual(actions, ['stop', 'configure', 'clear', 'start']);
});

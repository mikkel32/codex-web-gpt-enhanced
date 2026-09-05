const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const { RuntimeSupervisor } = require('../electron/runtime-supervisor.cjs');
const settle = () => new Promise(resolve => setImmediate(resolve));

function fixture(t) {
  let tick;
  const logs = [], states = [];
  t.mock.method(global, 'setInterval', callback => { tick = callback; return { unref() {} }; });
  t.mock.method(global, 'clearInterval', () => {});
  const supervisor = new RuntimeSupervisor({ app: {}, logger: {
    info: (...args) => logs.push(args), warn: (...args) => logs.push(args), error() {},
  }, coreHome: os.tmpdir(), sourceRoot: os.tmpdir(), browserDescriptorPath: '/unused' });
  supervisor.tryWriteState = (...args) => { states.push(args); return true; };
  supervisor.tunnel = { pid: process.pid };
  supervisor.daemon = { pid: process.pid };
  return { supervisor, logs, states, tick: async () => { tick(); await settle(); } };
}

test('a sustained dependency outage does not restart the tunnel or repeatedly log degradation', async t => {
  const { supervisor, tick, logs, states } = fixture(t);
  let restarts = 0;
  supervisor.scheduleRecovery = () => { restarts++; };
  supervisor.observeTunnelForMonitor = async () => ({ statusKnown: true, ready: false,
    waitingOnDependency: true, detail: 'readiness dependency unavailable' });
  supervisor.startTunnelMonitor({});
  for (let i = 0; i < 100; i++) await tick();
  assert.equal(restarts, 0);
  assert.equal(logs.filter(([name]) => name === 'runtime.tunnel_waiting_on_dependency').length, 1);
  assert.equal(states.filter(([state]) => state === 'degraded').length, 1);
  supervisor.observeTunnelForMonitor = async () => ({ statusKnown: true, ready: true, pid: process.pid });
  await tick();
  assert.equal(states.at(-1)[0], 'ready');
  assert.equal(logs.filter(([name]) => name === 'runtime.tunnel_dependency_recovered').length, 1);
});

test('missing observations and thrown probes cannot manufacture crash evidence', async t => {
  const { supervisor, tick } = fixture(t);
  let restarts = 0;
  supervisor.scheduleRecovery = () => { restarts++; };
  supervisor.observeTunnelForMonitor = async () => { throw new Error('probe unavailable'); };
  supervisor.startTunnelMonitor({});
  for (let i = 0; i < 10; i++) await tick();
  supervisor.observeTunnelForMonitor = async () => ({ statusKnown: false, ready: false });
  for (let i = 0; i < 10; i++) await tick();
  assert.equal(restarts, 0);
  supervisor.observeTunnelForMonitor = async () => ({ statusKnown: true, ready: false, detail: 'process stopped' });
  for (let i = 0; i < 3; i++) await tick();
  assert.equal(restarts, 1);
});

test('monitor ticks coalesce and stopped generations cannot request recovery', async t => {
  const { supervisor, tick } = fixture(t);
  let calls = 0, resolveProbe, restarts = 0;
  supervisor.scheduleRecovery = () => { restarts++; };
  supervisor.observeTunnelForMonitor = () => { calls++; return new Promise(resolve => { resolveProbe = resolve; }); };
  supervisor.startTunnelMonitor({});
  for (let i = 0; i < 20; i++) await tick();
  assert.equal(calls, 1);
  supervisor.stopTunnelMonitor();
  resolveProbe({ statusKnown: true, ready: false, fatal: true });
  await settle();
  assert.equal(restarts, 0);
});

test('overlapping recovery triggers share one attempt and failures schedule one backed-off successor', async t => {
  const { supervisor } = fixture(t);
  const timers = [];
  t.mock.method(global, 'setTimeout', (callback, delay) => { timers.push({ callback, delay }); return timers.length; });
  let rejectRecovery, calls = 0;
  supervisor.recover = () => { calls++; return new Promise((_, reject) => { rejectRecovery = reject; }); };
  supervisor.scheduleRecovery('tunnel');
  for (let i = 0; i < 20; i++) supervisor.scheduleRecovery('tunnel');
  assert.equal(timers.length, 1);
  timers[0].callback();
  for (let i = 0; i < 20; i++) supervisor.scheduleRecovery('tunnel');
  assert.equal(calls, 1);
  assert.equal(timers.length, 1);
  rejectRecovery(new Error('startup timed out'));
  await settle();
  assert.equal(timers.length, 2);
  assert.equal(timers[1].delay, 2000);
});

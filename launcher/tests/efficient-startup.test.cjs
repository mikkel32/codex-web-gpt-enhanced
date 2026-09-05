const test = require('node:test');
const assert = require('node:assert/strict');
const { RuntimeSupervisor } = require('../electron/runtime-supervisor.cjs');
const { NativeRecovery } = require('../electron/native-recovery.cjs');
const { BrowserHost } = require('../electron/browser-host.cjs');

function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise, resolve}; }

test('concurrent daemon and guardian startup requests join the same operation', async () => {
  for (const [prototype, method, worker] of [[RuntimeSupervisor.prototype, 'startDaemon', 'startDaemonOnce'], [NativeRecovery.prototype, 'ensure', 'ensureOnce']]) {
    const gate = deferred(); let starts = 0;
    const owner = Object.assign(Object.create(prototype), { [worker]: async () => { starts++; await gate.promise; return 'ready'; } });
    const pending = Array.from({length: 12}, () => owner[method]({}));
    assert.equal(starts, 1); gate.resolve();
    assert.deepEqual(await Promise.all(pending), Array(12).fill('ready'));
  }
});

test('duplicate same-trace browser starts share one tab allocation and reject conflicting owners', async () => {
  const gate = deferred(); let allocations = 0;
  const original = BrowserHost.prototype.beginTurnOnce;
  BrowserHost.prototype.beginTurnOnce = async () => { allocations++; await gate.promise; return {tabId:'one-tab', reused:true}; };
  try {
    const host = Object.create(BrowserHost.prototype);
    const first = host.beginTurn('trace_shared', false, 10, 'a'.repeat(64), 'Codex Native2');
    const second = host.beginTurn('trace_shared', false, 10, 'a'.repeat(64), 'Codex Native2');
    await assert.rejects(host.beginTurn('trace_shared', false, 11, 'a'.repeat(64), 'Codex Native2'), /another helper/);
    assert.equal(allocations, 1); gate.resolve();
    assert.deepEqual(await first, await second);
    assert.equal(host.beginOperations.size, 0);
  } finally { BrowserHost.prototype.beginTurnOnce = original; }
});

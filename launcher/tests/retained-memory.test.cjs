const test = require('node:test');
const assert = require('node:assert/strict');
const { BrowserHost } = require('../electron/browser-host.cjs');

test('extra idle automatic pages close without deleting saved chats; warm, viewed, manual and uncertain pages survive', () => {
  const now = 200000, closed = [], saved = new Map();
  function tab(id, extra = {}) {
    const url = 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc';
    const value = { id, traceId: id, conversationKey: id, connectorIdentity: 'Codex Native2',
      interactionMode: 'automatic', status: 'ready', lastHeartbeatAt: 1,
      view: { webContents: { getURL: () => url, isDestroyed: () => false, close: () => closed.push(id) } }, ...extra };
    saved.set(id, { status: 'ready', url, connectorIdentity: 'Codex Native2', connectorBound: true });
    return value;
  }
  const tabs = [tab('cold'), tab('warm', { lastHeartbeatAt: now - 1000 }),
    tab('viewed'), tab('manual', { interactionMode: 'manual' }), tab('uncertain'),
    tab('active', { status: 'running', helperPid: process.pid, bootstrapReady: true, lastHeartbeatAt: now })];
  saved.get('uncertain').status = 'in-flight';
  const host = Object.assign(Object.create(BrowserHost.prototype), {
    turnTabs: new Map(tabs.map(value => [value.id, value])), lastTurnSweepAt: now - 5000,
    selectedTabId: 'viewed', visible: true, surfaceActive: true,
    savedConversations: { get: key => saved.get(key) }, logger: { info() {}, warn() {} },
    window: { contentView: { removeChildView() {} } },
    syncPowerSaveBlocker() {}, syncViewVisibility() {}, writeDescriptor() {},
  });
  host.reapExpiredTurnTabs(now);
  assert.deepEqual(closed, ['cold']);
  assert.equal(saved.size, tabs.length);
  assert.equal(saved.get('cold').url, 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc');
  assert.deepEqual([...host.turnTabs.keys()], ['warm', 'viewed', 'manual', 'uncertain', 'active']);
});

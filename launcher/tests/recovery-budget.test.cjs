const test = require('node:test');
const assert = require('node:assert/strict');
const { RecoveryBudget } = require('../electron/recovery-budget.cjs');

test('slow failed startups exhaust a finite budget even across many minute windows', () => {
  let now = 0;
  const budget = new RecoveryBudget({ now: () => now });
  const delays = [];
  for (let i = 0; i < 5; i++) {
    const result = budget.failure('tunnel');
    assert.equal(result.allowed, true); delays.push(result.delayMs);
    now += 120000;
  }
  assert.deepEqual(delays, [1000, 2000, 4000, 8000, 16000]);
  assert.equal(budget.failure('tunnel').allowed, false);
  now += 3600000;
  assert.equal(budget.failure('tunnel').allowed, false);
  assert.equal(budget.failure('daemon').allowed, true);
});

test('brief recovery does not refill the budget; sustained health does', () => {
  let now = 0;
  const budget = new RecoveryBudget({ now: () => now });
  budget.failure('tunnel'); budget.healthy('tunnel'); now += 299999;
  assert.equal(budget.failure('tunnel').attempts, 2);
  budget.healthy('tunnel'); now += 300000;
  assert.equal(budget.failure('tunnel').attempts, 1);
  budget.healthy('tunnel'); now += 200000; budget.unhealthy('tunnel'); now += 500000;
  assert.equal(budget.failure('tunnel').attempts, 2);
  budget.reset();
  assert.equal(budget.failure('tunnel').attempts, 1);
});

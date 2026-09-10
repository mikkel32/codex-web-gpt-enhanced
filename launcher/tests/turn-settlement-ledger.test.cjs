const test = require("node:test");
const assert = require("node:assert/strict");
const { TurnSettlementLedger } = require("../electron/turn-settlement.cjs");
const request = index => ({ requestId: String(index).padStart(32, "0"), traceId: `trace_${index}`, helperPid: 123, status: "completed", retain: true });

test("concurrent duplicate terminal requests execute once and expose a read-only receipt", async () => {
  const ledger = new TurnSettlementLedger();
  let complete, calls = 0;
  const body = request(1);
  const action = () => { calls++; return new Promise(resolve => { complete = resolve; }); };
  const first = ledger.settle(body, action);
  assert.equal(ledger.settle({ ...body }, action), first);
  assert.deepEqual(ledger.inspect(body), { state: "pending" });
  await Promise.resolve();
  assert.equal(calls, 1);
  complete({ cancelledByUser: false });
  await first;
  assert.deepEqual(ledger.inspect(body), { state: "completed", result: { cancelledByUser: false } });
  await ledger.settle(body, () => assert.fail("terminal work repeated"));
  assert.equal(calls, 1);
});

test("receipts bind the exact owner and payload and never authorize another turn", async () => {
  const ledger = new TurnSettlementLedger();
  const body = request(2);
  await ledger.settle(body, () => ({ cancelledByUser: true }));
  for (const change of [{ traceId: "different" }, { helperPid: 124 }, { status: "failed" }, { retain: false }, { connectorBound: true }, { message: "different" }, { accessIssue: "rate-limit" }]) {
    assert.throws(() => ledger.inspect({ ...body, ...change }), /identity changed/);
    assert.throws(() => ledger.settle({ ...body, ...change }, () => assert.fail()), /identity changed/);
  }
  assert.deepEqual(ledger.inspect(request(3)), { state: "missing" });
  assert.throws(() => ledger.inspect({ ...body, requestId: "invalid" }), /invalid/);
});

test("failed mutations are retained, not automatically replayed", async () => {
  const ledger = new TurnSettlementLedger();
  const body = request(3);
  const cause = new Error("fixture storage denied");
  await assert.rejects(ledger.settle(body, () => { throw cause; }), error => error === cause);
  assert.deepEqual(ledger.inspect(body), { state: "failed" });
  await assert.rejects(ledger.settle(body, () => assert.fail("retry after a deterministic error")), error => error === cause);
  await assert.rejects(ledger.settle(request(4), () => ({})), /invalid/);
  assert.deepEqual(ledger.inspect(request(4)), { state: "failed" });
});

test("receipt retention is bounded without evicting pending operations", async () => {
  const ledger = new TurnSettlementLedger(3);
  let complete;
  const pending = ledger.settle(request(0), () => new Promise(resolve => { complete = resolve; }));
  for (let i = 1; i <= 1200; i++) await ledger.settle(request(i), () => ({ cancelledByUser: false }));
  assert.equal(ledger.entries.size, 3);
  assert.deepEqual(ledger.inspect(request(0)), { state: "pending" });
  assert.deepEqual(ledger.inspect(request(1)), { state: "missing" });
  complete({ cancelledByUser: false });
  await pending;
});

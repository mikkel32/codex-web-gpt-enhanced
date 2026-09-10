const { createHash } = require("node:crypto");

/** Exact-request receipts for automatic end notifications, never for browser Send. */
class TurnSettlementLedger {
  constructor(limit = 1024) {
    this.limit = limit;
    this.entries = new Map();
  }

  identity(body) {
    if (!/^[A-Za-z0-9_-]{32}$/.test(body.requestId || "")) throw new Error("turn settlement requestId is invalid");
    // Bind every outcome-affecting field, not JSON key order or UI preferences.
    return createHash("sha256").update(JSON.stringify([
      body.traceId, body.helperPid, body.status, body.message ?? null,
      body.retain === true, body.connectorBound === true, body.accessIssue ?? null,
    ])).digest("hex");
  }

  find(body) {
    const fingerprint = this.identity(body);
    const entry = this.entries.get(body.requestId);
    if (entry && entry.fingerprint !== fingerprint) throw new Error("turn settlement request identity changed");
    return entry;
  }

  inspect(body) {
    const entry = this.find(body);
    if (!entry) return { state: "missing" };
    if (entry.state === "completed") return { state: entry.state, result: entry.result };
    // Failed execution is terminal. Do not retry persistence, authorization or ownership errors.
    if (entry.state === "failed") return { state: entry.state };
    return { state: "pending" };
  }

  settle(body, action) {
    const previous = this.find(body);
    if (previous) return previous.promise;
    while (this.entries.size >= this.limit) {
      const oldest = [...this.entries].find(([, entry]) => entry.state !== "pending");
      if (!oldest) throw new Error("automatic turn settlement ledger is full");
      this.entries.delete(oldest[0]);
    }
    const entry = { fingerprint: this.identity(body), state: "pending" };
    // Install ownership synchronously before any action or awaited result can race a duplicate.
    this.entries.set(body.requestId, entry);
    entry.promise = Promise.resolve().then(action).then(result => {
      if (typeof result?.cancelledByUser !== "boolean") throw new Error("invalid automatic turn settlement result");
      entry.result = { cancelledByUser: result.cancelledByUser };
      entry.state = "completed";
      return entry.result;
    }).catch(error => {
      entry.state = "failed";
      throw error;
    });
    return entry.promise;
  }
}

module.exports = { TurnSettlementLedger };

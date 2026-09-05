// Count slow failures too. Briefly reaching ready must not reset a crash loop.
class RecoveryBudget {
  constructor({ now = Date.now, stableMs = 300_000, limit = 5 } = {}) {
    this.now = now;
    this.stableMs = stableMs;
    this.limit = limit;
    this.entries = new Map();
  }

  healthy(name) {
    const entry = this.entries.get(name);
    if (entry && entry.healthySince === null) entry.healthySince = this.now();
  }

  unhealthy(name) {
    const entry = this.entries.get(name);
    if (entry) entry.healthySince = null;
  }

  failure(name) {
    const previous = this.entries.get(name);
    const stable = previous?.healthySince != null
      && this.now() - previous.healthySince >= this.stableMs;
    const attempts = (stable ? 0 : previous?.attempts ?? 0) + 1;
    this.entries.set(name, { attempts, healthySince: null });
    return { attempts, allowed: attempts <= this.limit,
      delayMs: Math.min(30_000, 1_000 * 2 ** Math.min(attempts - 1, 5)) };
  }

  reset() { this.entries.clear(); }
}

module.exports = { RecoveryBudget };

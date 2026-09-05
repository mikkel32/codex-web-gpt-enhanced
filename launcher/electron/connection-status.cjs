function createConnectionSampler({ readConfig, readHealth, recoveryStatus, browserState, development = false, now = Date.now }) {
  let flight;
  let cached;
  let expires = 0;
  return async function sample() {
    if (flight) return flight;
    if (cached && now() < expires) return cached;
    flight = (async () => {
      const start = now();
      const config = development ? null : readConfig();
      const health = config ? await readHealth(config) : null;
      const valid = health?.service === "codex-chatgpt-web" && health?.status === "ok";
      const nativeAvailable = valid && health.accepting_turns === true;
      const recoveryAvailable = !development && recoveryStatus()?.running === true;
      return {
        nativeAvailable,
        browserConnected: development ? browserState()?.authenticated === true : Boolean(valid && health.browser_connected !== false),
        activeBrowserTurns: valid && Number.isSafeInteger(health.active_browser_turns) && health.active_browser_turns >= 0 ? health.active_browser_turns : 0,
        recoveryAvailable,
        phase: nativeAvailable ? "online" : development ? "development" : recoveryAvailable ? "recovering" : config ? "offline" : "unconfigured",
        checkedAt: new Date(now()).toISOString(),
        latencyMs: Math.max(0, now() - start),
      };
    })();
    try { cached = await flight; expires = now() + 750; return cached; }
    finally { flight = undefined; }
  };
}
module.exports = { createConnectionSampler };

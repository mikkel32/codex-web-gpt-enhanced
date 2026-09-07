const RECOVERY_GRACE_MS = 30_000;

function createConnectionSampler({ readConfig, readHealth, recoveryStatus, browserState,
  expectedReleaseVersion = require("../package.json").version, development = false, now = Date.now }) {
  let flight;
  let cached;
  let expires = 0;
  let recoveryKey;
  let recoverySince;
  return async function sample() {
    if (flight) return flight;
    if (cached && now() < expires) return cached;
    flight = (async () => {
      const start = now();
      const config = development ? null : readConfig();
      const health = config ? await readHealth(config) : null;
      // A listener for another release/mode is not evidence of this installation's health.
      // Keep the old installation's active-turn count during an upgrade, however: a version
      // mismatch must never grant permission to interrupt its work.
      const valid = Boolean(config && typeof config.releaseVersion === "string"
        && health?.service === "codex-chatgpt-web" && health?.status === "ok"
        && health.version === config.releaseVersion && health.mode === config.mode);
      const needsSetup = Boolean(config && expectedReleaseVersion
        && config.releaseVersion !== expectedReleaseVersion);
      const nativeAvailable = valid && !needsSetup && health.accepting_turns === true;
      const recoveryAvailable = !development && recoveryStatus()?.running === true;
      const key = config ? JSON.stringify([config.host, config.port, config.releaseVersion, config.mode]) : null;
      if (nativeAvailable || !recoveryAvailable || !config || needsSetup) {
        recoveryKey = undefined;
        recoverySince = undefined;
      } else if (recoverySince === undefined || recoveryKey !== key) {
        recoveryKey = key;
        recoverySince = start;
      }
      // A long-lived guardian only promises that recovery is available. It cannot keep
      // automatic setup waiting forever, especially after a failed or cross-version start.
      const recovering = recoverySince !== undefined && now() >= recoverySince && now() - recoverySince < RECOVERY_GRACE_MS;
      return {
        nativeAvailable,
        browserConnected: development ? browserState()?.authenticated === true : Boolean(valid && health.browser_connected === true),
        activeBrowserTurns: valid && Number.isSafeInteger(health.active_browser_turns) && health.active_browser_turns >= 0 ? health.active_browser_turns : 0,
        recoveryAvailable,
        phase: nativeAvailable ? "online" : development ? "development" : needsSetup ? "needs-setup"
          : recovering ? "recovering" : config ? "offline" : "unconfigured",
        checkedAt: new Date(now()).toISOString(),
        latencyMs: Math.max(0, now() - start),
      };
    })();
    try { cached = await flight; expires = now() + 750; return cached; }
    finally { flight = undefined; }
  };
}
module.exports = { createConnectionSampler, RECOVERY_GRACE_MS };

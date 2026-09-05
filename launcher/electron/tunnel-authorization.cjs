function tunnelAuthorizationFailure(events, now = Date.now()) {
  if (!Array.isArray(events)) return null;
  const relevant = events.filter(event => {
    const time = Date.parse(event?.time);
    return Number.isFinite(time) && time >= now - 120_000 && time <= now + 5_000
      && (event.message === "poll failed; backing off"
        || event.message === "poller recovered; polling operational");
  }).sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  const latest = relevant.at(-1);
  const status = latest?.attrs?.status_code;
  return latest?.message === "poll failed; backing off" && [401, 403].includes(status)
    ? { status, detectedAt: latest.time } : null;
}

module.exports = { tunnelAuthorizationFailure };

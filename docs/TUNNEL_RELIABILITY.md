# Tunnel traffic and recovery

Maria uses the pinned official tunnel-client 0.0.12. Normal long polling is required to receive commands; it is not an idle health check that can simply be removed. The official client owns command polling, queue backpressure, response delivery, and network backoff. Maria does not add a second poll loop or replay a command after an uncertain delivery.

## Observation without additional control-plane traffic

The official `runtimes status` command can fetch remote tunnel metadata. Maria now uses `runtimes cleanup --json` for CLI status and startup readiness as well as launcher endpoint discovery. This is a read-only local inventory: Maria never adds `--apply`. The configured alias must have a known ready state; a different ready alias or malformed inventory cannot make it ready.

Steady launcher supervision uses loopback health/readiness endpoints and bounded local diagnostics. At most one observation is in flight. Results belonging to a stopped monitor generation are ignored. Startup readiness retains its two-minute deadline; the former one-second status loop now generates zero additional control-plane metadata requests.

## One retry owner and finite recovery

- A live process with a failing readiness dependency does not trigger a watchdog restart. This preserves the client's backoff and Retry-After handling. The first degraded observation and subsequent recovery are logged once.
- An unobservable endpoint is not evidence of a crashed process. Unknown observations break the consecutive-failure count.
- Proven process failures and explicit internal MCP transport failures retain recovery. Each child has one in-flight recovery and a five-attempt budget, including attempts taking longer than the old one-minute crash window. Delays are 1, 2, 4, 8, and 16 seconds. Five minutes of sustained health or a successful explicit runtime start resets the budget; elapsed failure time alone does not.
- Accepted browser sends are never replayed by recovery. New work must pass the browser and tunnel access checks again.

## Authorization requires operator action

The pinned client logs explicit poll authorization failures but continues its backoff loop. Maria detects only recent structured `poll failed; backing off` events with status 401 or 403 from its verified local diagnostics endpoint. An unrelated error, 429, 5xx, stale event, or later successful poll recovery does not trigger this authorization pause.

Maria records `runtime/tunnel-authorization-pause.json` privately and stops the tunnel through its managed stop command. The record contains only a version, HTTP status, and detection timestamp. The native daemon is not stopped. New Web allocations and Send handoffs fail before browser interaction while the pause exists. App restarts, upgrades, and unrelated settings changes cannot silently clear it.

Review the application's access and runtime key, then reconnect through MCP setup. A successful explicit MCP setup clears the record; failed setup restores the checkpoint. No stopped task is replayed. If persistence or managed shutdown fails, Maria reports that failure explicitly and disables automatic recovery in the current process; it does not claim shutdown succeeded.

## Verification and limits

Fault-injection checks cover 100 dependency failures without a restart or repeated degradation log; overlapping monitor and recovery triggers; slow failures exhausting the budget; stable-health reset; unknown and stale observations; authorization persistence; disk-write failure; native-daemon preservation; and Web admission before and after asynchronous pacing. These tests use local fixtures, not synthetic ChatGPT prompts.

This reduces unnecessary traffic and handles service signals conservatively. It does not change OpenAI's account decisions or establish additional privileges beyond the application's approved access.

Source contracts: [official tunnel protocol](https://github.com/openai/tunnel-client/blob/v0.0.12/docs/protocol.md), [local runtime commands](https://github.com/openai/tunnel-client/blob/v0.0.12/cmd/client/runtimes_command.go), [health and readiness](https://github.com/openai/tunnel-client/blob/v0.0.12/pkg/runtimehealth/health.go), [poll backoff](https://github.com/openai/tunnel-client/blob/v0.0.12/pkg/controlplane/internal/poller.go).

# Maria WebGPT 5.8.0

This release reduces unnecessary tunnel traffic and makes failure recovery bounded and predictable.

- CLI status, startup readiness checks, and launcher diagnostics discovery now use the official local-only runtime inventory. They no longer make optional OpenAI metadata requests through the status command.
- A live tunnel waiting on a dependency is left to its own retry and cooldown logic. The launcher records one degradation message and one recovery message instead of repeatedly restarting it.
- Automatic recovery has a five-attempt budget that counts slow failures too, with exponential delays. Briefly becoming ready does not reset the budget; five minutes of sustained health does. Concurrent recovery triggers share one attempt.
- Explicit, recent tunnel poll authorization errors (401/403) stop the tunnel and persist an operator-action pause. App restarts and routine updates cannot silently reconnect. After reviewing access, use MCP setup to reconnect. Later successful poll recovery supersedes an older error.
- New automatic turns, manual handoffs, and queued Send operations are blocked while tunnel authorization is paused. Existing conversation identity and no-replay behavior are preserved; the native daemon is left running.
- Missing health observations do not count as proof that the tunnel crashed.

The release retains the 5.7 interface and motion system. Update through Maria when convenient.

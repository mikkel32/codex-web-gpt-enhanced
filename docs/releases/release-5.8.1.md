# Maria WebGPT 5.8.1

This update makes streamed delivery more efficient when Codex or a network reader slows down.

- The Windows stream producer now waits for actual reader demand instead of checking capacity every 5 milliseconds. Its pull callback remains synchronous to preserve the workaround for Bun's Windows stream teardown issue.
- Heartbeats no longer accumulate behind a stalled reader. The upstream stall watchdog remains active while waiting on the provider.
- Cancellation wakes a parked producer and releases its iterator. Stream ordering and explicit completion are preserved.

New tests cover parked readers with zero polling timers, bounded heartbeat buffering on Mac and Windows paths, exact ordered delivery of 128 chunks through a real local HTTP server, and HTTP-disconnect cleanup.

The signed-in ChatGPT composer, model controls, and completed-response structure were inspected without submitting a synthetic prompt. The current observed controls match Maria's existing selectors; no speculative selector or model changes were introduced.

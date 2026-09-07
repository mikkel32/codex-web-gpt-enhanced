# Maria WebGPT 5.13.6

Improves retained-conversation context handoff when ChatGPT finishes a compaction response without submitting the separate control tool call. The same checkpoint request now permits an exact JSON final-answer record bound to its unique handoff ID. Ordinary task replies, stale IDs, malformed records, empty summaries, and placeholder summaries are not accepted as checkpoints.

A completed response without either valid handoff channel fails promptly after a short grace period for an already-sent control response. It does not wait out the full compaction timeout or send another browser message. Existing cancellation, same-conversation restoration, physical browser settlement, canonical latest-user context, and reconnect behavior remain required.

Compaction now preserves actionable picker, sign-in, rate-limit, and other structured adapter errors instead of replacing them all with the generic context-handoff failure. Raw errors and control tokens remain out of the user-facing error text.

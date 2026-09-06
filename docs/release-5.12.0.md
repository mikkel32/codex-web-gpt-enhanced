# Maria WebGPT 5.12.0

Retained Web conversations now identify accepted history using exact answer receipts. A matching phrase such as "Done" is no longer enough to trim earlier native work. Maria binds the final answer to its emitted message ID and native turn, then checks those identifiers together with the saved input and answer hashes.

Repeated wording from later native turns stays in the continuation. Missing receipts, edited history, commentary, and new instructions before the answer keep the complete current context in the same saved conversation. Existing cursors migrate after a completed answer. Both streaming and JSON responses preserve receipts through local previous-response expansion and restart.

Development tests now run in temporary runtime homes, preventing HTTP fixtures from writing to the user's default continuation cache. Regression coverage checks the HTTP completion hooks, repeated and unrelated answers, restart, and process-level test isolation. See [continuity research](CONTINUITY_RESEARCH.md) for source evidence and remaining live measurements.

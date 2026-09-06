# Maria WebGPT 5.10.0

This release improves continuity through compaction and reduces unnecessary rendered context.

- Compaction failures preserve the saved Web conversation mapping instead of deleting it. Uncertain submissions remain protected from replay.
- When a completed conversation's process-local session has expired or been lost, compaction uses its durable cursor to request a checkpoint in the exact saved Web conversation. A failed restore does not silently create a replacement chat.
- Large Automatic Full-harness prompts above 64 KiB use two atomic context files when attachment slots permit, even with Bigger Context disabled. Small follow-ups remain inline. This changes transport, not the model's context allowance; files still count toward input limits.
- The current native goal context is preserved as last-observed data across repeated checkpoints. Updated native goal messages take precedence. Goal-looking ordinary user text is not promoted to native goal state, and Codex retains ownership of status, pause/resume, and budgets.
- Checkpoint instructions preserve objectives, corrections, completed evidence, live handles, pending work, and uncertain actions. Active compaction owners no longer expire from the replay cache merely because time passed; completed retention starts at settlement.
- Response observation uses DOM revision tokens instead of retaining and transmitting a redundant full-HTML copy for completion checks.
- Extra idle Automatic pages can be released after two minutes when their exact conversation URL is safely saved. The most recent warm page, the currently viewed page, active turns, manual pages, and uncertain saved state are protected from this early reclamation. Reopening a reclaimed task uses its original chat.

Focused tests cover repeated goal checkpoints, cache loss, restore failure, no mapping deletion on compaction failure, exact context preservation in files, completion stability, and idle-page reclamation. The research and limitations are documented in `docs/CONTINUITY_RESEARCH.md`.

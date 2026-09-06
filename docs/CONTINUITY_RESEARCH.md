# Web conversation continuity: findings and implementation

Research date: 2026-09-06. Evidence combines current official documentation, public Codex source, Maria source inspection, local fault-injection tests, and a read-only signed-in browser observation. No chat contents, account identifiers, credentials, or capability tokens are included here.

## The useful separation

| State | Owner | Maria's responsibility |
| --- | --- | --- |
| Task objective, instructions, goal status/budget, native tool execution | Codex | Preserve authoritative input, return correlated results, respect current controls |
| Saved Web conversation | ChatGPT | Keep the exact conversation mapping and avoid resending verified history |
| Browser page and response projection | Electron / ChatGPT UI | Observe the current response, avoid duplicate copies, reclaim recoverable idle pages |
| Checkpoint returned to Codex | Maria's compaction adapter | Return the required small handoff without replacing the continuing Web conversation |

OpenAI's [agent-loop explanation](https://openai.com/index/unrolling-the-codex-agent-loop/) describes how tool results grow Codex input and why compaction replaces that input with a smaller representation. A Web conversation remaining available does not remove Codex's separate input-window responsibility. Therefore this release makes checkpoints cheaper and more durable instead of disabling compaction or claiming unlimited context.

The [Memory FAQ](https://help.openai.com/en/articles/8590148-memory-faq) describes personalization as a changing synthesis of relevant context. That is not a transaction ledger for exact tool completion, goal budgets, or pending process handles. Maria keeps those facts under Codex's authority rather than relying on account memory to reconstruct them.

## Goal behavior investigated

Codex's [goal steering source](https://github.com/openai/codex/blob/main/codex-rs/ext/goal/src/steering.rs) constructs internal user-context fragments. Its [context fragment implementation](https://github.com/openai/codex/blob/main/codex-rs/core/src/context/internal_model_context.rs) identifies goal data through `goal.internal_context` metadata and supports the current goal wrapper plus the legacy wrapper. Maria requires the native annotation before treating a direct message as goal state; a matching piece of ordinary user text is not sufficient.

The [goal documentation](https://learn.chatgpt.com/use-cases/follow-goals) treats the objective as durable across turns. Public reports [32922](https://github.com/openai/codex/issues/32922) and [31099](https://github.com/openai/codex/issues/31099) describe goal context being lost or older steering taking precedence after compaction. They are reports, not proof of Maria's failure mode. Maria's own missing preservation path and error cleanup were inspected and tested independently.

The new canonical goal appendix carries last-observed goal data through v1 user-summary replay and supported v2 compaction envelopes. New native goal context supersedes older checkpoint data. The compiler explicitly distinguishes historical goal facts from current goal controls. It does not create, complete, resume, or reset a goal itself. If goal context was already discarded upstream before reaching Maria, this code cannot reconstruct unavailable facts; current Codex state/tools remain the source to consult.

## Live browser observation

One existing signed-in task conversation contained two mounted turns and 383,252 text characters. Only one turn was in the viewport, and the latest answer accounted for 7,065 characters. The older inline task input accounted for the remaining 376,187 characters. This demonstrates a concrete rendered-input cost in that sample; it is not a heap/RSS measurement or proof that every conversation has the same layout or payload.

An initial observation timed out, and a stale handle subsequently reported a closed target. The browser still listed the same conversation. Rebinding to that existing tab allowed inspection without reloading it or creating another conversation. This reinforces the distinction between an observation failure and actual conversation loss; the root cause of that tooling timeout was not established.

No model prompt was sent during this observation. Only aggregate counts are retained. This study does not claim to identify ChatGPT's private network protocol or the precise history included in model inference.

## What was inefficient or fragile

| Prior behavior | Change | Evidence |
| --- | --- | --- |
| Compaction error cleanup could delete the durable conversation mapping | Preserve the mapping while retiring the failed session | Adapter failure test verifies zero conversation-release calls |
| Missing process-local head immediately chose a fresh compaction fallback | Use a validated durable completion cursor to request the checkpoint in the exact retained chat | Tests cover successful checkpoint and failed restore with one attempted retained conversation |
| Large ordinary Full-harness snapshots could remain giant inline messages | Above 64 KiB, use existing atomic two-file transport when slots permit | Tests reconstruct roles and a 600,000-character tool result without loss |
| Complete response HTML was copied alongside Markdown segments and again into a completion signature | Use mutation revision tokens and separate text/key comparisons | Completion tests include DOM revision changes and outstanding tool calls |
| Every completed page could remain resident for thirty minutes | Release extra recoverable idle Automatic pages after two minutes, retaining the warm/viewed page | Reaper tests exercise real page-close behavior while saved records remain intact |
| Replay cache age could discard an active compaction owner | Keep active owners; age completed results from settlement | A simulated long operation remains singular and replayable |
| Goal facts depended solely on a model-written summary | Preserve annotated goal data deterministically and improve checkpoint instructions | Repeated v1/v2 checkpoint tests deliberately omit goal details from generated summary prose |

## How the Web and native tools work together

Normal retained follow-ups continue to use the existing verified context cursor. A matching prefix and final-answer boundary allow Maria to send only the new suffix. If that proof fails, it sends the current canonical snapshot; it does not guess what the Web model remembers. Current system/developer instructions stay authoritative.

For a known durable conversation, a missing process cache now needs only the checkpoint instruction plus the one-shot control binding. The launcher validates and restores the original saved URL. A test supplies 300,000 characters of historical local context while requiring the checkpoint request itself to remain below 16,000 bytes and excluding that historical marker from the request. These are fixture bounds, not a live network benchmark.

If a known retained conversation cannot be restored, the adapter returns a specific terminal error for review. It no longer hides that failure by opening a replacement summarizer conversation. The fresh compaction fallback remains only for cases with neither a process-local source nor a validated completed-conversation cursor, such as history entering the Web adapter for the first time.

Large normal snapshots are attached together in two JSON files, followed by one Send. No acknowledgement turns or temporary model switches are added. Small continuations stay inline. Manual mode, Luna checkpoint transport, attachment limits, and existing model input limits keep their prior boundaries. When there is no room for two context files alongside the images, automatic packing leaves the existing inline path in place rather than dropping attachments.

This trades two ordinary attachment uploads for a smaller visible message on those large snapshots. It reduces rendered inline context, not necessarily the number of HTTP requests for the first snapshot, and it remains subject to ChatGPT's attachment availability and limits.

Idle-page reclamation preserves server-side history and the saved URL. It does not erase conversations or force an active task into a new chat. The tradeoff is that returning to a reclaimed page requires loading that same saved conversation again. The currently active ChatGPT page can still retain its own history internally; this release does not promise zero browser history memory.

## Limits and next research questions

There is no evidence here that compaction can safely be removed altogether, that personalization guarantees exact recall, or that a lightweight DOM means a small model context. Private response-stream interception would require independent evidence for request correlation, tool-only completion, reconnect behavior, and cancellation before replacing the current observer. It is not implemented by this release.

The next meaningful measurements are real Electron per-renderer memory before/after idle reclamation, long goal runs across actual compaction boundaries, and the proportion of full snapshots versus verified suffixes. Those must be measured on representative work; local fixtures alone cannot establish a percentage improvement in RAM, model intelligence, or long-run success rate.

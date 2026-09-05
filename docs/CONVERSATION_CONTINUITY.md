# Conversation continuity

Maria keeps Codex's canonical history separate from the ChatGPT document that
executes a Web turn. Both are useful, but blindly sending the whole transcript on
every follow-up duplicates history; blindly cutting after the latest assistant
message can lose work performed by a native Codex model.

## Ownership

| Component | Stores | Authority |
| --- | --- | --- |
| Codex | Task messages, instructions, tool results, current checkpoint | Canonical task state |
| ChatGPT | Saved Full harness conversation and its own product context | Web execution and visible Web response |
| Maria conversation index | Exact URL, opaque task key, connector binding, submission state | Restore the correct document; prevent uncertain replay |
| Maria context cursors | Input prefix count and hash, final answer hash | Prove which old messages may be omitted |

The conversation key includes the execution namespace, Codex task ID, Web model,
and reasoning configuration. It excludes compaction data. The Responses execution
key separately includes the native turn and revision to preserve idempotency.

## Context selection

1. Commit a cursor only after a successful Web response.
2. On the next turn, verify that its canonical input prefix matches the recorded
   prefix, ignoring regenerated timestamps.
3. Find exactly one matching final Web answer after that prefix.
4. Supply everything after that answer, including intervening native model work.
5. If any check fails, supply all current Codex context in the same retained chat.
   A compaction checkpoint is a canonical state update, not an instruction to
   repeat previous effects.

Fresh ChatGPT documents always receive the complete canonical input. A cursor
alone never permits sending only a suffix to a fresh document. System instructions,
current tools, environment boundaries, and transport capabilities are refreshed
even for incremental turns. Native routes continue to receive Codex's own history.

## Saved chat lifecycle

Large-context transport uses two or three JSON attachments uploaded together, plus
one short execution prompt. The browser sends once. The complete file contents
count toward input usage, while only the short prompt counts toward the inline
composer limit. Attachment count and byte budgets are checked before UI mutation.
There is no model acknowledgement loop or temporary staging-model switch.

Automatic Full harness turns use normal saved ChatGPT documents. Completed chats
are indexed under `runtime/saved-conversations.json`; local cursor files live
beside the launcher descriptor. Files are private, atomically replaced, and contain
no duplicate transcript or capability token.

- A successful same-chat compaction settles the old logical response without
  releasing the durable browser conversation.
- A control-only checkpoint can end its browser observer after the broker accepts
  the exact handoff. This is distinguished from user cancellation and timeout.
- Closing a completed tab or reclaiming its memory leaves the saved link intact.
- Reopening loads only the exact HTTPS `/c/<id>` URL and checks the connector
  identity. Authentication redirects and missing documents cannot create a new chat.
- Before Send activation, a durable in-flight marker is written. A clean end marks
  it ready. An uncertain or interrupted submission remains blocked after restart.
- Preparation failures before Send do not poison an otherwise completed saved chat.
- An explicit conversation release removes its durable mapping. Corrupt ownership
  metadata stops recovery rather than guessing a task identity.

Version 1 saved links from earlier local installations migrate to version 2 on the
next write. The URL and conversation key remain unchanged. Development profiles
use their own files and browser partition.

## Limits and verification

Codex compaction does not expose an API to compact ChatGPT's internal context.
Saved history is not a promise that every old message remains in the model's active
window. Checkpoint refreshes retain current task state, and product limits remain
authoritative. Manual and read-only routes have different browser ownership rules;
they do not silently gain automatic chat navigation.

Tests cover exact URL restoration after process recreation and tab eviction,
legacy migration, connector mismatch, redirected documents, parallel ownership,
interrupted submission, compaction HTTP reconnect, full-context fallback, and native
work between Web turns. These are protocol and lifecycle tests, not a claim that a
live ChatGPT session cannot expire or that every historical outage is resolved.

OpenAI's [conversation-state documentation](https://developers.openai.com/api/docs/guides/conversation-state)
describes canonical history and durable conversation IDs for the Responses API.
Maria applies the ownership principle locally; it does not treat ChatGPT Web as a
Responses API conversation or assume access to its server-side compaction controls.

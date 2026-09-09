# Maria WebGPT 5.20.2

Stable patch release for interrupted-turn recovery and misleading stream-disconnect errors.

## What was wrong

A failed submitted turn could close its browser tab while the durable conversation
record correctly remained `in-flight`. Later requests refused to replay that
uncertain submission, but there was no way to review and release the saved chat.
The resulting error was wrapped as a generic browser-control HTTP 400.

Response-observation failures were also collapsed into "ChatGPT stopped responding"
even when the observer could not establish what ChatGPT was doing. Some DOM-health
and post-tool completion timers counted observation gaps or ignored reasoning
progress while the final-answer text stayed unchanged.

## Fixes

- Failed submitted chats remain available in Browser. After a restart, the next
  request can reopen only the exact saved URL for inspection; it does not send.
- **I reviewed this chat** acknowledges the uncertain result and enables a new
  request in the original Codex task. The action checks the current tab, one-use
  review identity, exact saved URL, ownership, Web-access state and a fresh idle,
  draft-free composer observation. Those bindings are checked again after the
  asynchronous observation. A stale click cannot release a newer failure.
- Reviewed chats re-verify their connector before the next Send. An unreviewed,
  unbound chat does not inherit that exception. The review marker is consumed by
  the next submission admission and survives restart until then.
- Saved-chat review conflicts use the non-retryable
  `previous_turn_needs_attention` signal across the control channel rather than a
  generic HTTP 400. Known response-DOM failures preserve their reason under
  `chatgpt_response_observation_failed`.
- Observation gaps, backwards clock jumps, internal reader faults and changing
  reasoning progress restart pending failure/completion evidence. Sustained
  failures still stop the turn; no submitted prompt is replayed automatically.

## Recovering an already blocked task

Install this update after active tasks finish. For a chat whose old tab was closed,
send a new message in the original Codex task to reopen its saved conversation for
review. Open **Browser**, inspect the response and any completed actions, and choose
**I reviewed this chat**. Then send a continuation message in the original Codex
task. Finish any pending generation, dialog or draft before acknowledging review.

Review does not claim that the interrupted request succeeded, undo any side effect,
resubmit its prompt, or replace its conversation. If the exact saved URL cannot be
verified, Maria keeps the record locked. A genuine upstream stop or service outage
can still interrupt a turn.

## Verification

Regression coverage includes failed-turn retention, restart restoration, exact URL
and connector identity, stale and concurrent review actions, asynchronous state
changes, blocked browser states, HTTP error typing and progress-aware observation
timers. Offline Electron renderer checks exercise the review control at desktop
and narrow widths. The release pipeline verifies and packages the exact source on
Windows, Linux, Apple Silicon and Intel Mac before publishing stable assets and
their checksums.

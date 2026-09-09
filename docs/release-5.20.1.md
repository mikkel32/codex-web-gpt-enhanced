# Maria WebGPT 5.20.1

Stable patch release for premature "Stopped thinking" cancellations and response
monitoring overhead.

## Fixes

- Context reads and searches now reach the browser's progress tracker, so loading
  required task records is recognized as work in progress.
- Stop detection checks generation state first, ignores quoted answer text and
  hidden controls, and requires 30 seconds of consecutive idle observations.
  New text, context/tool activity, uncertain state and long observation gaps reset
  the stop evidence.
- A confirmed upstream stop is reported as `chatgpt_generation_stopped`, separately
  from an explicit user cancellation. Submitted prompts are never replayed
  automatically to recover from an ambiguous result.
- Quiet response polling backs off from four checks per second to one, while
  context/tool activity wakes the wait immediately.
- Cancelled broker observations no longer open unnecessary Windows named-pipe
  connections. This fixes a shutdown hang found by the platform regression tests.
- Stop diagnostics record numeric progress evidence without message contents or
  credentials.

## Verification and updating

The fix passed 978 core tests and full CI on Windows, Linux, Apple Silicon and
Intel Mac. Real Electron fixtures cover English and Danish status labels, quoted
text, hidden controls, active generation, final-answer completion and large
response caching. Release publication repeats platform verification, packaging,
installer smoke checks and uploaded-asset checksum validation on the stable
version's exact source commit.

Install 5.20.1 or use the launcher's normal update flow after active tasks finish.
Installing the update is required for an already running older version to use
these fixes. A real upstream ChatGPT stop can still end a turn; this update avoids
misclassifying temporary or stale status as a user cancellation.

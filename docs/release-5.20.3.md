# Maria WebGPT 5.20.3

Stable patch for concurrent-chat isolation, response observation, and the Browser loading display.

## What changed

- Browser ownership lookup used to await every page without a per-page deadline.
  An unrelated unresponsive renderer could hold up all helpers. Reads now have
  bounded, cancellable waits and at most one pending probe per page per lookup.
- A helper connection no longer applies Playwright's default focus and media
  overrides across the user's browser context. Focus emulation is scoped to its
  exact owned task page. Disconnecting one helper preserves other task pages.
- Response reads distinguish an observed missing message from an unavailable
  observation. A blocked read has a deadline, and observation recovery rebinds
  the same owned page within the existing retry budget. Failed reads cannot
  reuse a cached final answer or automatically replay the prompt.
- Hidden task viewports stay at 800 x 600 rather than growing with the window.
  Resizing the launcher no longer resizes every background conversation's
  rendered layout. The five-tab limit and idle-page reclamation remain unchanged.
- Reusing a conversation and same-document navigation no longer leave a false
  loading state. Native view readiness starts when the document is ready rather
  than waiting for every subresource to finish.
- **Restore view** reapplies the selected native view's placement and stacking
  without navigation, reload, prompt submission, or acknowledgement of an
  interrupted task. Use it when the Browser display is blank while Codex is
  still receiving progress. Recovery of an uncertain task continues to use the
  separate **I reviewed this chat** action from 5.20.2.

## Verification and limits

The isolated Electron regression uses five real embedded WebContentsViews and
five concurrent production helper connections, plus an unrelated ownership probe
that never settles. It checks 15 viewport measurements across window resizes,
restoration without navigation, five large responses, 100 cached response reads,
unrelated focus/media preservation, and independent helper disconnection.
This regression runs in the existing verification pipeline on all release platforms.

Unit coverage checks cancellation, duplicate ownership, bounded hung reads, stale
completion rejection, same-document loading events, and native restoration.
Renderer checks cover the restore control at desktop and narrow widths.

These tests establish the covered local behaviors. They do not reproduce the
reported Windows blank page on the user's signed-in session, prove lower total
process RAM, or guarantee that ChatGPT can never stop or lose its connection.
A permanently blank loading page is not an intentional memory-saving mode;
background viewport sizing and idle-page reclamation are the resource controls.

Update after active work has finished. Publishing this release does not restart
the installed application or change any saved conversation's result.

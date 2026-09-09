# ChatGPT Web observations and stream efficiency

Inspected 2026-09-05. This records visible browser evidence and Maria source behavior, not undocumented claims about OpenAI's internal implementation. No credentials, conversation contents, or account identifiers are retained here.

## Observed signed-in interface

The live composer was a `DIV` with `contenteditable="true"`, role `textbox`, accessible name `Chat with ChatGPT`, and id `prompt-textarea`. Maria already recognizes this control. An earlier public shell exposed a textarea instead; that public view should not be used as the sole basis for signed-in automation changes.

The thinking-effort menu exposed a `Power` slider and a separate `Select model` menu. Its model choices used `menuitemradio` and `aria-checked`. The selected model label was `Latest`; the menu also offered GPT-5.6 Sol and GPT-5.5. These are observed UI labels, not a claim about the backend model behind Latest. Inspection did not change the user's selection.

A completed response in an existing conversation exposed `copy-turn-action-button` within a `SECTION` identified by `conversation-turn-N`. Maria's turn selectors and completion control match this structure. Completion still requires the existing running-state, stable-content, and tool-completion checks; a copy button or silent interval alone does not replace them.

## Delivery layers

Maria reads visible response state and serializes it into the Responses-compatible event stream that Codex consumes. This is separate from the official tunnel's MCP command delivery and from ChatGPT's internal network transport. The [official streaming guide](https://developers.openai.com/api/docs/guides/streaming-responses) documents incremental API events; it is not evidence of the private ChatGPT web protocol.

The existing browser worker already caches response projections by DOM mutation revision and retains exact conversation identity across observation recovery. This study did not justify changing those contracts or replaying a request.

## Implemented improvement

The Windows bridge previously polled reader capacity every 5 ms. It now parks one producer until a synchronous pull notification signals demand. This removes periodic capacity checks while retaining the independent pump needed for Bun's Windows transport. Cancellation explicitly releases the waiter.

The bridge also skips keep-alive enqueueing while the reader's queue is full. It continues checking genuine upstream silence rather than allowing heartbeat buffering to grow. Normal text, tool events, and terminal frames are unaffected.

Tests exercise no-demand parking, cancellation, heartbeat bounds, exact ordered chunk delivery over Bun.serve, a real HTTP disconnect, and the existing upstream timeout/heartbeat behavior. Platform CI must verify the Windows path on Windows before release. No synthetic ChatGPT conversation was needed for these checks.

# Maria WebGPT 5.13.8

Fixes false sign-in pauses caused by HTTP 401 responses from optional ChatGPT backend endpoints. Connector and auxiliary authorization failures no longer mark the browser as signed out. Primary identity or conversation-request failures use a distinct session-check state. Existing pause notices now explain that an already-signed-in user can resume, instead of asserting that another login is required.

For context-file transport, the exact current human request is also shown in the visible message when its native provenance is available and its complete text fits. The complete context and constraints remain attached. Developer text, tool results, and truncated requests are never substituted for the human request.

Expired tool-handle errors distinguish Codex task authorization from ChatGPT browser sign-in. Active bindings survive rejected tool results, while completed or cancelled bindings remain terminal. Resuming WebGPT enables a new request and never replays stopped work automatically. Existing tool-approval checks remain in force.

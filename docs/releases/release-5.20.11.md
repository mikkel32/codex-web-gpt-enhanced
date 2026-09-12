# Maria WebGPT 5.20.11

A mistyped context receipt previously stopped context loading permanently. The
broker now rejects that receipt with a typed error and, only for a page already
served in the same task, provides an exact bounded replay request. Replaying does
not acknowledge the page. The model must still return a valid receipt before
advancing, executing workspace tools or committing completion. Two corrections
per page are permitted; foreign receipts and expired bindings remain invalid.

Receipt-bearing text and image results include ready-to-copy next_read arguments.
The page-size calculation includes these fields, retaining the encoded response
limit. The public MCP input schema is unchanged. Existing receipt-based callers
remain supported.

An already settled browser-observation failure now rejects an identical reconnect
at HTTP preflight instead of reopening another SSE stream. The original error is
preserved. The completion guard still requires a post-tool answer, and its message
now distinguishes an unchanged earlier answer from the absence of any answer.
No automatic prompt resubmission or command replay is introduced.

Validation must include the real MCP path with a corrupted third-page receipt,
text and image replay, the required-context work gate, final-request retrieval,
and exact retry rejection. Live verification and distribution status are recorded
separately from offline tests. Packages target macOS Apple Silicon.

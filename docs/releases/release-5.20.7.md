# Maria WebGPT 5.20.7

Fixes three remaining access/reporting defects after 5.20.6: Danish OpenAI safety
rejections were classified as upstream server failures, deferred inventory errors
hid already advertised tools, and a blocked Gmail report could still prompt the
agent to invoke the sender again.

Broad tool discovery can now read only the advertised catalog without launching
extra discovery. When a requested deferred search fails, the result retains the
known tools and reports an incomplete catalog with the original error category.
It remains an MCP error, with no automatic retry or alternate gateway. Both
reporting tools remain discoverable through the existing inventory/call surface.

Gmail access rejections retain their platform cause instead of diagnosing a broken
account connection. Delivery pauses durably; blocked, uncertain, sent, failed and
in-flight incidents never instruct an automatic resend. Scheduled retries and a
paused installation are reflected in the agent's returned delivery status. A
contradictory error and message receipt remain uncertain.

Includes the main-branch fix for authenticated native task-message continuations
that followed 5.20.6. This release does not override OpenAI safety decisions or
turn local full-access settings into external authorization.

## Distribution and validation

The release targets macOS Apple Silicon, built locally with the pinned Bun 1.4.0.
Intel Mac, Windows and Linux packages are not part of this platform release; no
cross-platform validation is claimed. GitHub Actions are not used.

Publication requires the local full verification suite, native packaging, packaged
smoke checks, strict signature verification and uploaded-asset checksum comparison.
The automated Gmail tests exercise real broker discovery and dispatch with fixture
service responses. They do not send a real diagnostic or prove that an external
service will approve a future request.

Update the app and refresh the connector catalog to expose the new optional
`catalog` parameter. Existing cached catalogs retain the inventory/call sender
path. Queued is not sent; a message receipt establishes mail-server acceptance,
not independently verified inbox delivery.

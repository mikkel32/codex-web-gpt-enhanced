# Local verification and publication

The default is to verify on the current device or its native execution environment.
GitHub Actions are optional, explicitly requested tools. Neither pushes, pull
requests, tags nor another workflow's completion automatically starts CI or Release.
Do not dispatch a workflow just to obtain a green badge, or repeatedly poll one in
place of completing local work.

## Develop and check

Use the repository's pinned Bun version and installed dependencies. Run the focused
tests for the changed behavior first. For a candidate that will be distributed, run:

```sh
bun run verify
```

This already performs audits, type checks, tests, isolated renderer fixtures and
runtime smoke checks locally. A failure stays a failure; fix it or disclose the
unverified result rather than adding a skip flag.

For changes affecting a packaged app, also run on the affected target machine:

```sh
bun run app:package
bun run app:smoke
```

Keep the production app running while testing in the isolated development profile.
Do not install or restart the active runtime merely to demonstrate a source change.

## Record and publish

Record the exact git revision, dirty-tree status, runtime version, operating system,
architecture and the results of the relevant commands. Build each platform on its
appropriate host or supported environment. Never infer Windows or Linux results from
a Mac run. Consult the platform-specific checks in `release-validation.md` before
claiming live integration support.

When publication is authorized, upload the actual locally built artifacts to a
draft release using an available authorized GitHub integration. Verify uploaded
digests against the original local checksum manifest before publishing. Preserve
the existing tag/source checks and required artifact set in
`scripts/verify-release-assets.ts`; do not replace missing platform assets with old
versions or mark a partial release complete. Source publication is separate from
a complete installer release.

The existing manual Release workflow remains available for an explicit request to
build on GitHub. Dispatch it from `main` only. It retains its own checks because a
manually requested remote build must validate the bytes it will distribute.

## Diagnose apparent permission changes

`codex_tool_inventory` returns an `access` snapshot derived from the claimed turn.
Compare `native_policy_fingerprint` for native workspace/sandbox changes and
`native_tool_catalog_fingerprint` for advertised native tool-schema changes. These
fingerprints exclude turn tokens and expiry times. Deferred discoveries may differ
even when the advertised native catalog has not changed. `runtime_version` identifies
the server producing the snapshot, rather than the version of a source checkout.
An exact advertised tool-name lookup is answered from that turn's native catalog
without invoking a second discovery tool. Broader searches still inspect deferred
tools. `catalog_scope` states which catalog was searched; a native-only result is
not an assertion that no deferred tools exist.

These fields are observations, not permission grants. ChatGPT app authorization is
explicitly unobserved by the native inventory. A developer-MCP conversation restriction
is preserved as `conversation_mcp_scope_restricted`; an indeterminate OpenAI safety
check is `tool_safety_status_unknown`. Both are terminal permission responses instead
of generic upstream failures with automatic retry advice. They do not establish that
filesystem permissions, credentials or tunnel health changed.

Record the blocked operation once, preserve completed work, and continue independently
authorized operations. A catalog refresh can expose newly installed tools for later
tasks, but cannot prove that an external rejection has disappeared. Do not replay a
rejected operation through a different conversation, account, machine or gateway.


## Report discovery and platform denials in 5.20.7

For broad inventory inspection, `catalog: "advertised"` reads the current task's
supplied catalog without invoking a deferred discovery gateway. `catalog: "all"`
retains the existing full search. Exact advertised-name lookups remain local.
An unsuccessful deferred search returns an MCP error containing the known tools,
`catalog_complete: false`, and the specific `deferred_discovery` failure. Its
`total` and pagination describe only the advertised catalog; they cannot establish
that no deferred tools exist. Transport timeouts retain their retired-binding
result. Neither catalog mode changes permissions or authorizes a retry.

The launcher and runtime share classification for observed English and Danish
OpenAI safety rejections. A rejected Gmail profile or send operation pauses the
queue, preserves its access cause, and does not suggest that reconnecting an
account resolves a platform verdict. Capture guidance respects blocked, uncertain,
sent, failed, in-flight, paused, and scheduled-retry states. A conflicting mail
receipt and error remain uncertain. Connected delivery tests use simulated Gmail
responses through the real MCP discovery/dispatch path; they are not live email
or external-authorization verification.

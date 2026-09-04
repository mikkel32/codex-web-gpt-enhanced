# Enhanced fork contract

This file defines the behavior that must hold before a build is considered ready for daily Codex use.

## Source and release policy

The fork starts from the exact MIT-licensed upstream revision recorded in `UPSTREAM.lock`. Upstream history and attribution remain intact. Fork changes are reviewed in small branches and releases are built only from a clean, tested commit.

The application does not silently update itself. A new upstream revision is imported through an explicit lock-file change, CI verification, and a reviewable pull request. Release artifacts must contain the source commit, upstream commit, dependency lock hashes, and runtime manifest.

## Native and WebGPT coexistence

Codex keeps its built-in `openai` provider. The local loopback service acts as a narrow Responses router:

1. Official model-catalog requests are forwarded with the caller's authorization and client metadata.
2. Official rows are returned in their original order with their original metadata.
3. Optional WebGPT rows are appended under `chatgpt-web/*`.
4. Requests whose model starts with `chatgpt-web/` use the browser adapter.
5. Every other model, compaction request, and supported native endpoint is forwarded to the official Codex backend.

Setup must never write a global `model = "chatgpt-web/..."`, replace the user's native default, install a static native catalog, or create a second provider that hides official rows. Existing native model, effort, service tier, context settings, profiles, and unrelated configuration remain byte-for-byte preserved.

A task can switch between a native row and a WebGPT row. Before a request crosses from WebGPT back to native, bridge-owned response IDs, reasoning envelopes, and compaction envelopes are converted into portable history so the official backend is never asked to resolve local identifiers.

## Model presentation in Codex

Native rows appear first and remain visually unchanged. Web rows use explicit names:

- `WebGPT · Manual`
- `WebGPT · Manual Pro`
- `WebGPT · Instant`
- `WebGPT · Medium`
- `WebGPT · High`
- `WebGPT · Extra High`
- `WebGPT · Pro`

The compatibility slugs remain stable, including `chatgpt-web/zero-risk`. “Zero Risk” is not used as an absolute product promise. The manual row states exactly what it guarantees: the launcher copies the compiled prompt, while model selection, connector selection, paste, and send remain under the user's control and the adapter does not read or mutate the ChatGPT page.

Each WebGPT row advertises one immutable effort, no native Fast tier, and only capabilities implemented by the bridge. Web rows never receive a priority that removes native models from Codex's bounded subagent model list.

The launcher status page shows the lanes separately:

- Native route: online, degraded, or disconnected.
- WebGPT browser: signed out, ready, busy, or at capacity.
- Connector: exact `Codex Native2` verified or unavailable.
- Codex integration: connected or native-only.

## Stable process architecture

The loopback router is the smallest and most stable process. Browser automation, Electron surfaces, tunnels, and connector workers run as supervised children. A browser crash cannot terminate native passthrough. Native requests do not wait for browser readiness.

The router binds only to loopback and exposes authenticated lifecycle endpoints. Startup validates the installed runtime manifest before listening. Shutdown drains native HTTP requests and browser turns independently. Child restart uses a bounded budget; repeated failure becomes a visible degraded state rather than a restart loop.

The model endpoint has a short upstream timeout, bounded cache with freshness metadata, and last-known-good native catalog fallback only when the catalog was previously authenticated and remains within its explicit lifetime. Response generation itself never falls back from one model or lane to another.

Codex's WebSocket prewarm receives the explicit capability-negotiation response expected by Codex so the task stays on HTTP/SSE without changing provider or model. A native SSE connection reset is tolerated only after the protocol terminator has already arrived.

## Configuration safety

All integration writes use an application-owned journal and an atomic transaction across:

- Codex `config.toml`;
- integration journal and recovery journal;
- model cache;
- launcher configuration.

Before a write, the app records exact previous lines and file format. On failure it restores every participant. Disconnect and uninstall restore only values still owned by the app and refuse to overwrite newer user edits.

Setup defaults to preserving the current native model. If an older installation made a `chatgpt-web/*` row the global default, migration restores the recorded prior native model when available. When no prior value is recorded, it removes only the bridge-installed default and lets Codex choose its normal native default.

A Native-only control restores the official route transactionally, clears Codex's model cache, and reports that a Codex restart/new task is required. Reconnection performs the inverse transaction. The launcher never claims failover succeeded until the config and route journal both verify.

## Manual mode and retained conversations

The manual mode preserves the existing `chatgpt-web/zero-risk` slug for task compatibility. Its UI name and copy describe the real boundary rather than promising universal safety.

Sequential turns retain the exact ChatGPT conversation identity when the prior turn completed. A failed pre-send check preserves the conversation for retry. A completed response may hibernate its renderer after the configured retention period, but a failed cold restore stops before Send and reports a non-retryable local recovery failure. It never creates a replacement conversation silently.

The connector must be the exact `Codex Native2` identity on every production turn. Missing, ambiguous, legacy, or unverified connector state stops before Send. Verification state can survive an application upgrade only when the exact connector identity, account, profile, and validation evidence still match.

## Privacy and external traffic

The fork has no mandatory GitHub/X onboarding, social IPC, telemetry, analytics, crash upload, automatic update check, or release polling. External navigation is denied by default and allowed only for a small explicit help-link allowlist initiated by a visible user action.

Credentials, browser storage, connector state, route tokens, and diagnostics remain in local application directories with restrictive permissions. Secrets never appear in command arguments, generated profiles, logs, Git, or release metadata.

## Required verification

A release candidate must pass:

- root and launcher type checks;
- root and launcher tests;
- dependency audits;
- runtime-manifest verification;
- native catalog passthrough and metadata preservation tests;
- native-to-WebGPT and WebGPT-to-native task-switch tests;
- native requests while the browser child is stopped or crashed;
- manual pre-send failure and retained-conversation tests;
- exact connector verification and legacy-connector rejection tests;
- compaction-provider boundary tests;
- config install, migration, disconnect, reconnect, uninstall, and rollback tests;
- packaged launcher smoke tests on macOS, Windows, and Linux;
- macOS signing and bundle-integrity verification for the distributed app.

The migration from the existing private 4.0.9-local.25 build must port its no-replay, exact-conversation, headless-turn, connector-verification, privacy, and no-updater behavior before the enhanced fork replaces the installed application.

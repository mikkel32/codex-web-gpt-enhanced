# Enhanced 5.0.2

This private fork keeps regular Codex models and ChatGPT Web models in the same
picker. It is based on upstream 5.0.1; `UPSTREAM.lock` records the original revision.

## Model coexistence

- Setup recognizes an authenticated custom provider targeting the bridge's exact
  URL and selects Codex's built-in `openai` provider. This prevents custom-provider
  filtering from hiding subscription-only native models. The original assignment
  is journaled and restored on disconnect/uninstall; other providers are preserved.
- Native responses, compaction, and search use the official Codex backend. They
  do not depend on the browser session, manual mode, or MCP tunnel readiness.
- If Web model augmentation fails, the official native catalog is still returned.
  Health reports `model_catalog_status: native-only`, and Doctor explains how to
  repair Web discovery. This fallback never invents account capabilities or hides
  authentication errors. Only an augmented catalog verifies Web model installation.
- Native SSE streams tolerate a connection reset after a complete terminal
  Responses event even when the backend does not send `[DONE]`. Partial events
  remain errors. Cancellation propagates upstream; observation memory is bounded.

The shared local route still requires the launcher process. Quitting normally
restores the previous route; Codex may need a restart to read it. A separate custom
provider or static `model_catalog_json` chosen by the user can still override model
discovery. Uninstall restores those choices rather than deleting them.

## Manual mode

The picker now says **ChatGPT Web - Manual** or **Manual Pro**. Existing
`chatgpt-web/zero-risk` model IDs and the `Codex Zero Risk` connector name remain
compatible. The name describes the interaction, not an account-risk guarantee.

You have five minutes to paste, select your model and connector, send, and confirm
**Sent**. The connector then has a separate 90-second deadline. The launcher shows
a minutes-and-seconds countdown and the actual turn stage. Codex displays concise
submission steps and connection progress. Prompts are never automatically resent.

## Installation and updates

The repository remains private. Anonymous `curl` installers and the updater cannot
read private GitHub releases. Until release assets are published with an appropriate
distribution mechanism, use an authenticated clone and build from source with the
pinned Bun 1.4.0 runtime. From the repository root, run `bun install --frozen-lockfile`,
then `bun install --frozen-lockfile --cwd launcher`, and `bun run app`.

Run `bun run verify` for the runtime tests, launcher tests, typechecks, dependency
audit, renderer build, and packaged-runtime smoke test. `bun run app:package` builds
the desktop application for the current platform. Install/restart only after active
tasks finish; a source build alone does not update a running launcher.

Release installers, updater URLs, package metadata, and launcher links target this
fork. They never replace the enhanced build with an upstream release. Upstream
license and attribution remain intact.

## Local validation

Validated on macOS arm64 with Bun 1.4.0: 640 runtime tests passed; 286 launcher tests
passed with one skipped; both TypeScript checks, renderer build, version alignment,
and dependency audits passed. The native Codex catalog smoke test, relocated runtime
smoke test, and packaged launcher launch test passed. The renderer was checked at
1180px and 700px widths, including Manual mode, with no page errors or horizontal overflow.

A live catalog read after repairing the local provider returned nine regular Codex
models and five ChatGPT Web models. A live manual ChatGPT prompt and the original
intermittent compaction incident have not been reproduced in this validation run.

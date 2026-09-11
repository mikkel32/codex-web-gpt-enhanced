# Project work

Inspect the actual source checkout, current git state and running runtime before
changing Maria. Preserve existing work and the app carrying the active task.

## Verification runs locally

Run appropriate checks in this checkout on the current device or its available
native execution environment. Run `bun run verify` for a release candidate;
package changes also require `bun run app:package` and `bun run app:smoke` on each
affected target platform. Start with focused tests while implementing a change.

Do not dispatch, rerun, wait for or poll GitHub Actions as the normal development
or release verification path. CI and Release workflows are manual opt-in tools.
Only use them when the user explicitly requests GitHub-hosted jobs for that task.
Pushing source, creating a tag or publishing locally built assets does not grant
permission to run a workflow. Do not silently restore automatic workflow events.

Keep evidence tied to the tested source revision and operating system. A local
Mac pass is not a Windows or Linux pass. Keep release checksums, immutable source
identity, package signatures and duplicate-upload protection. Publish only the
artifacts actually built and verified; disclose unsupported or untested targets.
See `docs/development/local-verification.md` for the local workflow.

## Tool scope and continuity

Use the current turn's tool catalog and workspace. Never reuse a previous turn's
token, assume a listed tool is authorized, or treat a token change as a permission
change. Native filesystem permissions and ChatGPT app authorization are separate.

Preserve the exact cause of a developer-MCP-only restriction or indeterminate
safety rejection. Do not relabel either as a broken tunnel, missing credentials,
or a local permission failure without evidence. Stop the denied operation;
continue independent authorized work without replaying successful mutations.
Never change accounts, conversations, computers, gateways or permissions to evade
an access check. Report verified changes and remaining limitations separately.

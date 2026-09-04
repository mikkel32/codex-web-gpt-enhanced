# Maria WebGPT fork

This repository is the maintained Maria WebGPT fork of `miuuyy/codex-chatgpt-web`. The full TypeScript and Electron source on `main` is authoritative. Recovery archives, generated patches, and workflow-produced rewrites are not the development model.

## Product contract

- Official Codex models remain in the model picker with their upstream metadata and official backend route.
- Only model slugs beginning with `chatgpt-web/` use Maria's local Responses bridge and ChatGPT browser adapter.
- Setup repairs legacy `chatgpt_web_bridge` installations without permanently replacing the native provider.
- Integration changes are journaled, and uninstall restores prior values without overwriting later user edits.
- The manual browser rows are displayed as **Maria Web — Manual** and **Maria Web — Manual Pro**. Existing `zero-risk` slugs and the `Codex Zero Risk` connector name remain protocol compatibility identifiers.
- Closing Maria keeps the native daemon available; active browser work remains attached to its existing Codex task.

See [docs/NATIVE_COEXISTENCE.md](docs/NATIVE_COEXISTENCE.md) for the routing, migration, and continuity boundaries.

## Upstream maintenance

`UPSTREAM.lock` pins the exact upstream repository and commit used for comparison. The `Materialize pinned upstream baseline` workflow verifies that immutable revision and publishes it only to the baseline branch named in the lock file.

The baseline branch is review evidence. It never rewrites `main`, generates product source with regular expressions, or merges itself. Port upstream changes through ordinary source commits or pull requests and use the normal CI matrix to verify the resulting fork.

## Release gate

Create a version tag only from a `main` commit whose CI passes on macOS, Linux, and Windows. The release workflow rebuilds and smoke-tests every platform package, verifies macOS signatures, creates checksums, and compares them with GitHub's published asset digests.

Runtime keys, browser sessions, Codex authentication, tunnel credentials, and files under `~/.codex-chatgpt-web` must never be committed.
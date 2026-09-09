# Contributing

Maria WebGPT is maintained by Mikkel & Maria. Focused fixes, regression coverage,
documentation improvements and platform fixes are welcome. Discuss large features
or architecture changes in an issue before implementation.

## Before you start

Read the [development guide](docs/development/README.md) for the repository map,
DEV isolation and commands. Check existing issues and pull requests. Bug reports
should include a reproducible symptom and a redacted export from Activity, never
raw browser state, credentials or private conversation contents.

## Make the change reviewable

Describe the problem, the resulting behavior and the evidence. Keep unrelated
refactoring out of a fix. Add a regression test when behavior changes; for docs-only
work, check links, commands and translated README parity instead of inventing
runtime tests. Report unexecuted checks explicitly.

Run `bun run verify` for code changes. For browser changes, use observed DOM evidence
and a reproducible fixture. For execution changes, separately record validation
through an installed Codex integration. Package changes need the affected native
platform's smoke checks; CI alone is not proof of a signed-in account flow.

## Preserve these contracts

- Keep model, route, effort, connector and task identity explicit. Never silently
  switch models or replay an uncertain submitted prompt.
- Full harness tools belong to the active Codex task and its permissions.
  Browser-only and Manual mode must retain their separate boundaries.
- Preserve user changes and saved conversations. Stop with a useful error when
  success cannot be established.
- Keep browser sessions, keys, raw logs, local paths and generated build artifacts
  out of commits. Review [Security](SECURITY.md) before sharing diagnostic evidence.

## Close the loop

Target `main` unless the PR genuinely depends on another active PR. Name that
dependency when stacking. After a release, resolve PRs already included through
ancestry or an equivalent published tree, and link the integration evidence.
Remove merged branches; preserve unique historical commits before archiving a
superseded branch. Never merge obsolete release metadata just to close a PR.

Use [release notes](docs/releases/README.md) for version history and the
[release validation guide](docs/development/release-validation.md) for release checks.

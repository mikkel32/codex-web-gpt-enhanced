# Development

[Documentation](../README.md) · [Contributing](../../CONTRIBUTING.md)

## Repository map

| Path | Responsibility |
| --- | --- |
| `src/` | Responses bridge, Codex integration, runtime lifecycle and browser adapter |
| `launcher/electron/` | Desktop lifecycle, browser ownership, persistence and updater |
| `launcher/src/` | React interface and translated copy |
| `browser-connector/` | Browser sign-in connector source |
| `tests/`, `launcher/tests/` | Runtime and launcher regression coverage |
| `scripts/`, `launcher/scripts/` | Development, verification and native packaging |
| `docs/reference/` | Architecture and implementation contracts |
| `docs/research/` | Historical investigations and observed evidence |
| `docs/releases/` | Release notes; binaries remain in GitHub Releases |
| `.github/` | CI, release automation and contribution templates |

## Local work

Use the exact Bun version in `package.json` (1.4.0 for this source).
Install dependencies with `bun install --frozen-lockfile` in the root and `launcher/`.
`bun run app` starts an isolated DEV profile; do not connect production services
to source files you are editing. See the [DEV chat harness](dev-chat.md) for browser
and MCP development.

## Checks

| Command | Purpose |
| --- | --- |
| `bun run verify` | Audits, types, tests, renderer fixtures and runtime smoke |
| `bun run test` | Isolated core test runner |
| `bun run launcher:test` | Launcher regression suite |
| `bun run check-version` | Synchronized source and runtime version metadata |
| `bun run app:package` | Package for the current operating system |
| `bun run app:smoke` | Test the packaged application |
| `bun run app:performance` | Isolated UI performance check |

Package and verify locally on the matching operating system. See
[local verification](local-verification.md); GitHub workflows are manual opt-in.
Synthetic browser fixtures and package smoke checks
do not replace account-bound validation; record exactly what ran.

## Documentation and releases

Keep English, Japanese and Chinese README commands and links aligned. Put new
release notes in `docs/releases/release-VERSION.md`. Use the documentation index
for navigation instead of appending release announcements to the front page.

The [release validation guide](release-validation.md) separates automated and live
checks. An already published version is not rebuilt or retagged by later docs
changes. Check the assets for every platform a release claims to provide. Label
a release with a limited platform set explicitly; do not substitute older binaries.
See [fork maintenance](../../FORK.md) for upstream comparison and release ownership.

The upstream baseline workflow runs when `UPSTREAM.lock` changes or on manual
dispatch. Documentation edits do not rebuild historical dependencies. Baseline
verification still includes its dependency audit and must pass before publication.

[Branch archive](branch-archive.md) records retired branches and preserved commit identities.

# Maria WebGPT 5.20.0 - the breakthrough stable release

The working **5.15.0-alpha.10** implementation graduates to **5.20.0**. This is a
stable release, with the alpha label removed.

This is the breakthrough we have been working toward: the maintainer reports
that the workflow is finally working, with no issues in their current macOS
setup. The promotion preserves that implementation and updates the release
version, installer default, and documentation.

## What comes forward from the working alpha

- **Acknowledged context delivery and conversation continuity.** Required task
  records are delivered through bounded native reads with delivery receipts.
  Follow-ups preserve the existing conversation, earlier completed work, and
  attachment handoffs instead of replaying accepted work after an uncertain
  response.
- **ChatGPT-managed Web context.** Web models no longer declare artificial Codex
  token ceilings or automatic-compaction thresholds. ChatGPT manages its active
  context; native Codex models retain their own saved context preferences.
- **More reliable tools, plugins, and model selection.** Plugin evidence and
  structured tool results survive handoffs, native operations follow the current
  task's tool inventory, and Sol selection is checked against the visible picker.
- **Connection verification with concrete evidence.** Setup verifies the bound
  native connection and rejects stale readiness evidence instead of treating a
  configured connector as proof that a tool round trip works.

## Release verification

Publication is gated on the repository's release workflow: version consistency,
dependency audits, runtime and launcher tests, type checks, isolated UI checks,
and native package smoke checks for Apple Silicon macOS, Intel macOS, Windows
x64, and Linux x64. Uploaded assets are checked against the original build's
SHA-256 manifest before the release becomes public and is marked latest.

The maintainer's live, issue-free report applies to the installed macOS alpha.10
workflow. Automated checks cover the packaged release; they do not establish
account-bound live validation on every operating system or configuration.

## Update

Open **Updates** in Maria WebGPT and install **5.20.0** after finishing active
work. The stable update keeps the existing application settings and saved
connections through the normal updater path.

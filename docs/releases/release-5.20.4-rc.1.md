# Maria WebGPT 5.20.4-rc.1

This prerelease adds detailed diagnostic emails, agent-reported failures,
right-click inspection, and safer completion handling for retained conversations.

## Prerelease status

The signed-in Windows 11 checks (items 1 through 11) and macOS checks
(items 2 through 10) in the [release validation guide](../development/release-validation.md)
have not been recorded for this candidate. In particular, live account sign-in,
review-task recovery, compaction, cancellation, and upgrade preservation remain
unverified on those platforms. Local macOS tests and cross-platform CI do not
replace those account-bound checks. Interactive Linux behavior is also unverified.

This candidate must remain a prerelease and must not replace the stable updater
target until the required evidence is recorded. Keep the existing stable build
for active work. When a candidate flow fails, preserve the existing conversation,
stop that flow, and export a redacted Activity report; do not resend an ambiguously
accepted prompt. Resume normal work with the existing stable installation.

## Connection and completion fixes

- Reconcile a lost local completion acknowledgement against the launcher's exact
  operation receipt without sending the ChatGPT prompt again.
- Save a retained conversation's completed state before advertising it as ready.
  A late helper failure cannot downgrade an acknowledged completion.
- Preserve classified interruption causes across the browser helper and stop
  repeated review conflicts from reopening the same interrupted task.
- Distinguish Codex local access from external tool safety checks. Full local
  access does not disable those checks, and this release does not bypass them.

## Inspect the app and browser pages

Right-click for **Inspect element** or **Developer tools** on the launcher and its
embedded pages. F12, Command-Option-I on macOS, and Ctrl-Shift-I on Windows/Linux
open the focused page's tools. The inspector opens separately so it does not
resize, reload, or resend the active chat. Applicable editing actions are included.

## Detailed diagnostic emails

Open **Automatic error reports…** from the right-click menu. The personal-product
default recipient is Mikkel.mynderup@gmail.com; an explicitly configured address
is preserved. Reporting remains opt-in per installation.

Emails include readable HTML, a plain-text alternative, and a JSON evidence
attachment. The recorded error appears first, followed by available version,
platform, timestamps, task identifiers, and separately observed Web and Codex
response text. Missing sections, excerpts, and redactions are labeled.

When enabled for a real Automatic Web task, agents can report command, discovery,
context, and connection failures through `maria_report_issue`, even when native
command execution is unavailable but the authenticated broker still works.
Reports can describe expected and observed results, recovery attempts, verified
completed work, remaining blockers, and explicitly unverified hypotheses.
This operation does not unlock project tools or expand task permissions.

The durable queue groups repeated observations and preserves delivery state across
restarts. Attempts are bounded to five per hour and twenty per day, with seven-day
retention. Ambiguous email delivery is held as uncertain rather than automatically
resent. Known secrets are redacted, but response text can still contain private
project information that pattern-based redaction cannot recognize.

## Setup and verification limits

Capture can queue reports locally before a sender is configured. To send them,
enter a Gmail sender and its Google app password in Maria's local reporting
window, then use **Queue test email**. Credentials use operating-system encrypted
storage and are never bundled with the release. Queued does not mean sent, and
mail-server acceptance does not independently verify inbox delivery.

Local verification covered 1,010 core tests, 452 launcher tests with one
platform-specific skip, command-independent reporting through the real local MCP
protocol, 120 dropped completion acknowledgements, and isolated Electron checks
for five concurrent pages, inspection, and diagnostic email previews.
Release automation additionally verifies and packages each supported platform
before publishing and checks uploaded asset digests.

The email tests use offline composition and intercepted delivery. They do not
prove live Gmail authentication, inbox delivery, or every future agent's behavior.
The release does not install itself into a running task; apply the update after
active work has finished.

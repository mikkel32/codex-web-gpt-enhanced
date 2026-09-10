# Diagnostic emails and agent-reported failures

[Technical reference](README.md) · [User guide](../user-guide.md)

Mikkel.mynderup@gmail.com is the default recipient for this personal product.
An explicitly configured recipient is preserved. Reporting is enabled per
installation, and disabling it remains authoritative. Sender authentication is
separate from capture: an enabled installation can retain reports locally while
Gmail setup is pending. A queued report is never labeled as sent.

## What the email contains

Each email has a readable HTML body, a plain-text alternative, and a JSON
attachment containing the retained evidence. The body includes the error,
timestamps in UTC, app version, platform, available model and task identifiers,
and grouped observation count. Agent reports also describe the attempted
operation, expected and observed results, recovery attempts, verified completed
work, and remaining blockers. Hypotheses are labeled as unverified.

Web response text, the response Maria emitted to Codex, and tool failure text are
separate sections. Missing text is identified as unavailable rather than
reconstructed. Large sections become marked excerpts in the email; the attachment
retains the stored sections, including their redaction and truncation flags. The
HTML body is bounded to 80,000 UTF-8 bytes. It contains no remote images, styles,
scripts or tracking resources, and diagnostic text is escaped rather than rendered
as markup. Local consent identifiers and sender state are excluded from the email.

Known credentials are redacted. Response content can still contain private project
information or secrets that pattern-based redaction cannot identify. Prompts,
system/developer instructions, hidden reasoning, unrelated files and conversations
must not be supplied by agents. Detailed project content is excluded when the
response-content setting is disabled.

## Agent reporting without command execution

When local reporting is enabled and the task owner explicitly enables it in the
context plan, Maria adds reporting guidance to the generated Automatic Web task
instructions. Isolated connection probes and other contexts have no reporting
authorization or email instructions. Use the dedicated `maria_report_issue` tool
when it is advertised. Older catalogs can discover it using `codex_tool_inventory`
with that exact query and invoke the returned schema using `codex_tool_call`.
Choose the available path before calling; never try the other path after a rejection.
The discovery path and the report operation execute in
the authenticated broker; neither needs a functioning native command executor.

The broker supplies the active trace and configured recipient. Agents cannot
choose recipients, supply arbitrary attachments, spoof another task identity,
execute commands, alter permissions or unlock the context-completion fence through
this operation. A context-read failure can be reported before the required context
is acknowledged, but project tools remain gated. Disabled, revoked, completed and
Manual bindings cannot use the Automatic reporting operation.

Repeated reports for the same turn contribute to its existing incident. A report
already queued, sending, accepted or uncertain must not also be sent through Gmail.
If the Maria reporting path itself is unavailable, the generated instructions allow
one minimal redacted diagnostic through an independently available, authorized
Gmail connector. The agent must discover its current schema and use only the
configured recipient. A rejected Gmail call ends that reporting attempt; it must
not be routed through another tool, account or computer. The original denied
command must never be retried to evade a safety check. If reporting also fails,
the final answer states the unsent issue and preserves verified prior work.

Disabled reporting, withdrawn consent, absent sender credentials, and a safety or
permission rejection of reporting never authorize Gmail fallback. Pending reports
stay local until their configured sender is ready; fallback must not override the
owner's reporting preferences or a rejected operation.

The existing eight public connector tools remain compatible. Version 5.20.5 adds
`maria_report_issue`, `maria_send_reports` and `codex_project_inspect`, which exposes only bounded
read-only ripgrep operations through the existing native command executor. Refresh
the existing connector's tool catalog in ChatGPT settings after updating. This
does not disable external permission or safety checks.

## Connected Gmail

Select **Connected Gmail** in Automatic error reports to use the Gmail account
already connected to Codex. No SMTP credential is needed. After acknowledging the
required task context, an authorized Automatic Full task can call
`maria_send_reports`. This operation accepts no recipient or content overrides. It
checks the connected account against the configured recipient and sends one
eligible queued report through the native Gmail tool under its existing permissions.
It records the Gmail message ID and sent acknowledgement. A shared process lock
and persisted sending state prevent concurrent or interrupted deliveries from
replaying the same incident.

Generated reporting instructions deliver eligible pending reports when an active
task is available, including incidents created earlier by the runtime. Reports
recorded while no task is active wait for the next task. Unavailable Gmail access
produces an explicit connection action; rejected or uncertain sends are never
rerouted through SMTP or browser clicks. The selected method retains the existing
five attempts per hour and twenty per day limits.

## Delivery and verification boundaries

Open **Automatic error reports…** from Maria's right-click menu. The window shows
whether capture is enabled and whether a Gmail sender is configured. **Preview
email** displays the exact plain-text body; **Preview report** shows the local
record. Enter a Google app password in Maria's local settings window, never in a
chat. The credential is encrypted with the operating-system secure store.

Without a saved sender, reports show **Sender setup required** (`needs_sender`)
with zero delivery attempts. Older pending reports are migrated on startup. Saving
sender credentials lets the original eligible reports resume. The ChatGPT Gmail
connector and Maria's SMTP sender have separate credentials. A sender rejection
pauses delivery durably, even if its report is deleted or capture settings change;
save corrected sender credentials to resume. Queue status refreshes automatically
without clearing unsaved form input, and rate-limited reports show their next attempt.

Delivery retains the existing restart-safe queue, consent checks, bounded retries,
five attempts per hour and twenty per day, and seven-day retention. An ambiguous
SMTP acknowledgement is held as uncertain rather than resent. Mail-server
acceptance does not independently verify inbox delivery.

Tests exercise the real local MCP protocol with unavailable native execution and
unread required context, fixed-recipient enforcement, deduplication, secret
redaction, HTML escaping, body size limits, and Electron rendering at desktop and
mobile widths. Automated email composition and delivery fixtures are offline. The maintainer also
verified five real Gmail deliveries with matching Sent and Inbox labels during
5.20.5 validation. Neither proves every agent's future behavior or immunity from
external tool rejections.

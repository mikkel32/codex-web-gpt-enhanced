# Maria WebGPT 5.20.5

This update makes blocked-tool diagnostics more specific and fixes reports that
appeared to be waiting for delivery when no Gmail sender was configured.

- Automatic Full mode exposes `codex_project_inspect` for bounded file listings,
  text reads and literal searches. It accepts structured fields, disables ripgrep
  configuration and preprocessors, and preserves native command permissions.
  Ordinary project inspection has a read-only tool contract. Arbitrary commands
  retain their existing contract and checks.
- `maria_report_issue` is also available as a dedicated diagnostic tool with a
  fixed schema and non-destructive, outbound-email annotations. Reporting remains
  scoped to an enabled task and its configured recipient. The older inventory
  route remains compatible; rejected operations are never automatically rerouted.
- Connected Gmail delivery uses the Gmail account already connected to Codex,
  verifies that it matches the report recipient, sends the retained email and JSON
  attachment, and records Gmail's message ID plus its sent acknowledgement. No
  SMTP password is required. Active tasks call `maria_send_reports`; reports
  recorded while no task is active wait for the next authorized task.
- A shared delivery lock prevents simultaneous processes from sending one report
  twice. Interrupted or unacknowledged sends remain uncertain and are never replayed.
- Missing SMTP Gmail credentials produce `needs_sender` with an explicit setup action,
  including for older pending reports. Saving a sender resumes the same eligible
  incidents without creating duplicate emails. Evidence can still be added while
  sender setup is incomplete.
- Sender authentication pauses survive app restart, report deletion and unrelated
  reporting settings changes. Only explicit sender reconfiguration clears them.
  Delivery limits record the next attempt time. The settings window updates live
  without erasing unfinished sender or password input.

## After updating

Refresh the Codex Native2 connector's tool list in ChatGPT settings so future turns
can see the three new tools. Retain the existing connector identity and conversations;
the existing eight tools remain compatible. Do not retry an operation rejected by
a permission or safety check through a different tool.

In **Automatic error reports**, choose **Connected Gmail**, enable reporting,
and save. Connect Gmail in Codex using the same account as the recipient. An
active Automatic Full task then delivers eligible reports. The account and tool
permissions are checked before sending. SMTP remains an optional way to send
background reports while no Codex task is active.

If the new tools are absent, refresh the Codex Native2 connector catalog in ChatGPT
settings. Updating Maria does not automatically refresh ChatGPT's cached tools.

OpenAI controls external tool safety decisions. This release provides more precise
tool contracts and actionable delivery states; it cannot guarantee that an
external service will never reject a request. SMTP acceptance is distinct from
verified inbox delivery, and uncertain deliveries are not automatically resent.

## Validation

Regression coverage exercises real MCP stdio/broker calls, unchanged propagation
of a simulated safety rejection, fixed-command quoting, sender setup and upgrade
recovery, durable authentication pauses, rate limits and duplicate prevention.
The isolated Electron check exercises live queue updates, preserved form input,
preview rendering and intercepted email delivery. Release CI checks and packages
macOS ARM64, macOS Intel, Windows x64 and Linux x64 before publication. The connected Gmail sender was also exercised against the maintainer's existing
account: five previously queued reports received distinct message IDs and were
independently found in Sent and Inbox. No password, session cookie or access token
was copied into Maria. This does not establish an external tool safety verdict.

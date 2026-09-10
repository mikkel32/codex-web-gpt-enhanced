# User guide

[Documentation](README.md) · [Troubleshooting](../TROUBLESHOOTING.md)

## First setup

- Open **Maria WebGPT**. The Overview shows your connection and the next setup steps.
- Sign in to ChatGPT in the Browser page, or choose Manual mode in Settings.
- Open **Models & setup** to add Web models. Restart Codex once after installation so its picker refreshes.
- Choose a regular Codex model or a **Maria Web** model directly in Codex.
- Use **Help & guide** inside Maria whenever you need these instructions.

## Inspect the interface or a browser page

Right-click the element and choose **Inspect element**. The inspector belongs to
the page you clicked: the Maria interface and each embedded browser tab have
separate developer tools. Use **Developer tools** in the same menu to open the
console and other panels without selecting an element.

With the page focused, press **F12**, **Command+Option+I** on macOS, or
**Ctrl+Shift+I** on Windows/Linux. Tools open in a separate window; opening them
does not reload the conversation, resend a prompt, or change its native bounds.
Right-click menus also offer the applicable selection and editing actions.

Inspection is available in installed builds as well as development builds. It is
an explicit local action, including in Manual mode. It does not change Codex
permissions or ChatGPT's service checks. Developer tools can show private chat and
account information; review and redact anything before sharing it. Avoid pausing
the debugger or editing a page while an automatic turn is running.

## Two ways to work

### Native Codex

Regular models use your Codex account, reasoning controls, and native tools.
They do not need a ChatGPT browser login or the Web connector. Maria preserves
the official catalog and repairs old bridge-provider settings that can hide native models.

### ChatGPT Web

Automatic mode prepares and sends the current Codex task through your own
ChatGPT session. Available model tiers depend on what that account exposes.
Full harness mode connects ChatGPT to the tools of the same Codex task.

Manual mode gives you control over model selection and sending. Copy the prepared
prompt, paste it into ChatGPT, select your model and the **Codex Zero Risk** connector,
send it, and choose **Sent** in Maria. You have five minutes to prepare the prompt
and a separate 90 seconds for the connector to start. Attach images manually.
Existing connector names and model IDs stay compatible with your saved setup.

## Cooperative Web access

Maria spaces automatic sends across the browser profile, pauses on verification,
sign-in, rate-limit, and conversation-service failures, and respects Retry-After.
The pause survives restart. Complete any check yourself in ChatGPT, then choose
**Resume WebGPT** in Maria after the cooldown. Resume enables your next request;
it does not replay a stopped or uncertain turn. Native Codex remains independent.

Security-check pages are kept for inspection. Maria does not automatically reload
challenges or dismiss rate-limit dialogs. Local Activity records the reason,
server-provided request references when available, and explicit resume events.
No diagnostic report is sent automatically.

User-initiated browser automation is still automation. These controls reduce
avoidable traffic and duplicate actions; they cannot guarantee account access or
establish that a service decision was a false positive.

## Updates from our GitHub

Open **Updates** in Maria. When a newer complete release is available, the sidebar
shows **Update · v…** and the release page offers **Update to …**. Downloads are
verified against the release's SHA-256 checksums before installation.

- Maria checks at startup, every four hours, and when you return after at least 15 minutes. **Check for updates** retries immediately.
- The page shows the installed version, latest published version, and last successful check. A local build newer than the published release is labeled **ahead of the release**.
- **Release notes & downloads** opens GitHub. If update checks require repository access, connect a fine-grained GitHub token restricted to this repository with **Contents: Read-only**. It is stored using operating-system encryption and can be removed in Updates.
- GitHub access failures and offline checks stay visible; Maria never reports them as "up to date."
- Finish active work before installing. DEV/source installations stay separate and do not replace the installed application.

## One task, less repeated context

Codex remains the source of truth for your task history, instructions, tool results,
and compaction checkpoints. In Automatic Full harness mode, Maria keeps a saved
ChatGPT conversation for the same Codex task and Web model configuration.

Web models declare no numeric Codex context window or automatic-compaction threshold. ChatGPT manages its active context. Setup preserves existing global context preferences for native models only and restores those preferences when the bridge is disconnected or uninstalled. Normal evidence retrieval has no local token allowance; file bytes, page sizes and permissions remain bounded.

- **Large context:** required records are read through the bound native connection, with historical output and document text retrieved on demand. One browser Send starts the turn. Page acknowledgements verify delivery.
- **Follow-ups:** Maria sends only the new portion when the earlier input and final Web answer match a recorded local cursor. The cursor stores hashes, not another copy of your conversation.
- **Native → Web:** any work done with native Codex after the last Web answer is included. Maria does not assume the last assistant message came from ChatGPT.
- **Compaction:** the ChatGPT conversation identity stays the same. Codex's current checkpoint updates the task context without discarding the saved chat. Changed or unverifiable history uses the full current Codex context.
- **Restart or tab eviction:** completed Automatic Full harness chats reopen their exact saved `chatgpt.com/c/...` address. Existing saved links from earlier Maria builds migrate in place.
- **Uncertain submission:** Maria keeps the saved link and stops. It does not resend an accepted prompt or open a replacement task. Inspect the existing chat before continuing.

Manual mode also uses verified incremental context while its retained tab is
available; it does not automatically inspect or reopen remote chat history.
Read-only Web modes and isolated checkpoint fallback requests use Temporary Chat.
Saved Full harness chats appear in your ChatGPT history and use that account's
normal data controls. Codex compaction reduces local context; it cannot reset
ChatGPT's internal context window. ChatGPT's own limits still apply.

See [Conversation architecture](reference/conversation-continuity.md) for the recovery
and context-selection rules.

## Reuse an existing browser login

Open Browser in Maria and choose **Use an existing browser login**. Select Chrome,
Microsoft Edge, or Safari. Enable the bundled Maria Browser Sign-in connector once
in that browser, then connect the profile where ChatGPT is already signed in.

- Chrome and Edge: open the extensions page, enable Developer mode, choose Load unpacked, and select the folder shown by Maria. Then use Open connector.
- Safari: open the bundled Safari companion and enable its extension in Safari settings. Local unsigned builds may also require Safari's Develop > Allow Unsigned Extensions setting.
- The connection code expires after five minutes and accepts one session transfer.
- Maria verifies the login inside its own browser before reporting success. Passwords, other sites, and browsing history are not imported.
- Keep the source browser open. The handoff does not close or restart it.
- If the shared session expires or is revoked, reconnect from the browser. Native Codex sign-in stays separate.
- Connect in Automatic mode to verify sign-in; you can switch to Manual afterward.

## Keep developing when Maria is stopped

The native connection has an independent recovery guardian. If the transport exits
while Maria is closed, the guardian starts a native-only replacement. It never
resends a ChatGPT prompt. On macOS, the installed production app registers recovery
at login. On other platforms, Launch at login starts Maria and its guardian again.

For a native Codex session that bypasses Maria completely, use this from your project terminal:

```bash
codex -c model_provider=openai -c openai_base_url=https://chatgpt.com/backend-api/codex
```

Expand **Connection details** in Overview to copy the native launch command. In this source
repository, `bun run codex:native` provides the same direct route and ignores an
inherited OPENAI_BASE_URL override.

## Safe development environments

`bun run app` and `bun start` use an isolated DEV profile. Each checkout gets its own
state directory and private Vite port. Production routing, browser-profile paths,
and control credentials are removed from the development process environment.
`bun run dev:chat` uses that same checkout profile.

Source CLI commands that could change production Maria or Codex data require an
explicit `--allow-production` flag. Standard development commands never need it.
Use the installed packaged application for production; avoid pointing production
services at files you are actively editing.

## Closing Maria without losing Codex

Closing the window keeps your work running. When you quit with a ChatGPT turn
active, Maria stays in the background so that turn can finish. When no Web turn
is running, the UI can exit while the native connection continues in a separate
process. Reopening Maria reconnects to that process.

Native responses already streaming are not cancelled when the UI exits. A new
Web request while the browser is closed asks you to open Maria; regular Codex
requests continue. Turn on **Launch at login** for availability after restarting
your computer. Explicitly removing the integration stops its background connection.

## Connect the tools

- Open MCP in Maria and use your existing saved tunnel credentials, or configure a tunnel.
- Follow the connector instructions shown for your selected interaction mode.
- Keep the Automatic and Manual connectors separate. Their exact names are displayed in Maria.
- Give each runtime its own tunnel ID and ChatGPT connector, including Mac, Windows, and Codex's native MCP server. Do not run them against the same tunnel. Distinct profile names or API keys alone do not separate the endpoint. For multiple Automatic setups, configure distinct connector names such as `Codex Native2 Mac` and `Codex Native2 Windows` through setup's `--app-name` option.
- Run Verify runtime. Native Codex tools continue to use Codex's own permissions.

## If something needs attention

- **Native models missing:** use Setup to reinstall the model integration, then restart Codex.
- **Web model unavailable:** open Maria, check browser sign-in and the model tier on your account.
- **Manual connection timed out:** select the shown connector and check MCP status before starting a new turn.
- **Tool not found or task authorization rejected:** check whether another runtime uses the same tunnel ID. A healthy tunnel can still reach a different tool server or task broker. After separating the endpoints, refresh the corresponding ChatGPT connector's tools. Maria's Automatic connector should expose `codex_exec`, `codex_write_stdin`, `codex_apply_patch`, `codex_view_image`, `codex_tool_inventory`, `codex_tool_call`, `codex_context_read`, and `codex_context_search`; a catalog of bare `exec_command`/`apply_patch` tools belongs to a different contract. Local health and successful chip selection do not prove the remote tool contract.
- **A turn stops unexpectedly:** open Activity and export diagnostics. Check whether the browser tab closed or the connector disconnected.
- **Switching models:** finish or cancel the current turn, then choose another model in Codex. Your Codex task remains the same.

Maria does not automatically resend an accepted prompt. This avoids duplicate work
when a network connection becomes uncertain. Both saved and Temporary Chat are
processed by OpenAI. Account availability and limits still apply.
## Automatic error emails

Right-click the Maria interface or an embedded page and choose **Automatic error reports…**.
Configure a Gmail sender and a recipient, then explicitly enable reporting on this installation.
Enable **Include recorded Web and Codex response text** to include response content in the emails.
The sender requires a Google app password for an eligible account with 2-Step Verification;
enter it only in Maria's password field, never in a chat or source file.

The browser helper records its observed Markdown and the Responses server records the text it
emitted to Codex. Errors from the same identified turn are grouped into one report. Launcher
errors and renderer crashes are also captured. A 30-second collection window lets the browser
and server contribute before delivery. Missing sources are marked unavailable: this
feature does not scan unrelated Codex sessions or independently inspect the native Codex UI.
If the process or machine stops before an incident can be saved, a report cannot be guaranteed.

Reports contain the error, source, available turn identifiers, version, platform, and optionally
the recorded responses and a failing tool result. Known keys, bearer tokens, passwords, cookies,
receipts and URL queries are redacted. Prompts, system/developer instructions, hidden reasoning,
screenshots and credential files are excluded. Redaction cannot recognize every possible secret,
so enable response content only for a recipient you trust. Response tails are bounded and any
redaction, omission or truncation is marked. Each report is a JSON email attachment.

The queue persists across restarts, holds at most 80 reports or 20 MiB, and expires reports after
7 days. Delivery is capped at 5 attempts per hour and 20 per day, including retries. Proven
connection failures retry with backoff at most five times. Authentication rejection pauses
delivery until the sender is corrected. An uncertain SMTP result or a crash during sending
requires inbox review and is never automatically resent. **Sent** means the mail server accepted
the message, not that inbox arrival has been independently verified.

**Preview report** shows the saved content. **Queue test email** creates a test without conversation
text. **Disable & forget sender** disables reporting and removes the encrypted sender credential.
Earlier queued reports remain tied to their original recipient and consent, and are not sent
after those settings change. Delete them individually or let the retention limit expire.
Disabling cannot recall an email already handed to the mail server.

Credentials use Electron's operating-system secure storage; insecure Linux `basic_text` fallback
is rejected. Queued reports are locally stored with owner-only POSIX permissions where supported.
Reporting is disabled by default for every installation, and no developer inbox is hard-coded.

References: [Google app passwords](https://support.google.com/accounts/answer/185833),
[Nodemailer SMTP](https://nodemailer.com/smtp),
[Electron credential storage](https://www.electronjs.org/docs/latest/api/safe-storage).

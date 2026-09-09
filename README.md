# Maria WebGPT

[![CI](https://github.com/mikkel32/codex-web-gpt-enhanced/actions/workflows/ci.yml/badge.svg)](https://github.com/mikkel32/codex-web-gpt-enhanced/actions/workflows/ci.yml)
[Download the latest release](https://github.com/mikkel32/codex-web-gpt-enhanced/releases/latest) · [Release history](https://github.com/mikkel32/codex-web-gpt-enhanced/releases)

**Your models. Your workspace. A little more possibility.**

Built by Mikkel & Maria

Maria brings ChatGPT Web into your Codex workflow while keeping regular Codex
models available. Choose a native model for your Codex account, or choose a
**Maria Web** model to use your ChatGPT session. Your task, files, tools, and results
stay together in Codex.

> **Setup and recovery:** start with **Set up automatically** in Overview. The launcher reuses saved credentials and guides only the steps that need you. For `Tool read not found` or `Unknown root "/Users"`, see [connector recovery](docs/CONNECTOR_RECOVERY.md); changing folder permissions is not the default fix.

## Maria 5.20.2: stable interrupted-turn recovery

**5.20.2** keeps interrupted chats available for inspection instead of closing the
tab and leaving an unrecoverable in-flight record. In Browser, **I reviewed this
chat** enables a new message in the original Codex task after checking the exact
saved conversation. It never resends the interrupted prompt or opens a replacement
chat. The next request verifies the connector again.

Response-health timers now restart after observation gaps, reader faults and new
reasoning progress. Known DOM failures preserve their actual diagnostic reason,
and saved-chat conflicts have a typed recovery message rather than generic HTTP
400 errors. See the [5.20.2 release notes](docs/release-5.20.2.md) for recovery steps
and limits. The [5.20.1 reliability fixes](docs/release-5.20.1.md) remain included.

## Earlier interface and continuity improvements

Continuity now survives loss of the process-local conversation cache, and compaction
failures preserve the original Web chat mapping. Large Automatic Full-harness
snapshots use atomic context files when attachment slots permit. Goal context is
carried through checkpoints as last-observed data; Codex still owns goal status and
budgets. Extra idle Automatic pages can leave memory while their exact chat links
remain saved. See [Continuity research](docs/CONTINUITY_RESEARCH.md) for the evidence,
tradeoffs, and remaining limits.

Overview now offers one next action: sign in, finish the required setup, review
paused access, or continue your existing task. Connection details expand when
needed, and browser-only setups do not require optional MCP tools. The handbook
loads on demand, while live events take precedence over a delayed startup snapshot.

A cinematic motion system brings spring-driven navigation, an interactive depth mark,
masked heading reveals, and coordinated page transitions. The sidebar folds into an
icon rail and remembers its width and desktop preference.

Use Cmd/Ctrl+B to toggle the sidebar, Cmd/Ctrl+K for page search, and Cmd/Ctrl+1–8
to switch pages. Drag the sidebar edge to resize it; double-click to reset its width.
Connection checks are shared and visibility-aware, native browser geometry is
coordinated, and failed startup connections can be retried. Setup still sends no
test message.

## Start here

- Open **Maria WebGPT**. The Overview shows your connection and the next setup steps.
- Sign in to ChatGPT in the Browser page, or choose Manual mode in Settings.
- Open **Models & setup** to add Web models. Restart Codex once after installation so its picker refreshes.
- Choose a regular Codex model or a **Maria Web** model directly in Codex.
- Use **Help & guide** inside Maria whenever you need these instructions.

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

See [Conversation architecture](docs/CONVERSATION_CONTINUITY.md) for the recovery
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

## Our project

Source and issues live in our GitHub repository:
https://github.com/mikkel32/codex-web-gpt-enhanced

There are no social-page requirements in onboarding. The project ships its own
interface, local guide, model integration, diagnostics, and release tooling.
Third-party license notices are included in LICENSE and LICENSES.

## Run from source

This source path requires Bun 1.4.0. Authenticate the clone if repository access requires it.

```bash
git clone https://github.com/mikkel32/codex-web-gpt-enhanced.git
cd codex-web-gpt-enhanced
bun install --frozen-lockfile
bun install --frozen-lockfile --cwd launcher
bun run app
```

## Verify and build

```bash
bun run verify
bun run app:package
bun run app:smoke
bun run app:performance
```

Verification covers the runtime, launcher, model routing, process lifecycle,
TypeScript, the renderer, dependency audits, and relocatable runtime smoke checks.
Run core tests with `bun run test`, or select files with
`bun run scripts/test-core.ts tests/conversation-cursors.test.ts`. These commands
and the full verifier isolate runtime caches in temporary homes.
Packaging produces an installer for the current operating system. macOS builds
include a signature check and a launch test. Windows and Linux builds run in CI.

## Release notes

5.5.0 adds persistent cooperative-access pauses, Retry-After handling, shared send
pacing, user-controlled recovery, and terminal handling of typed errors after Send.

5.4.0 introduces the monochrome Moonlight interface, reduced-motion-aware interactions,
visibility-aware connection checks, batched Activity updates, exclusive guardian
ownership, and shared daemon/browser startup operations. Context hashing now avoids
allocating another complete serialized transcript.

5.3.0 adds a GitHub Updates page, private-release access, repeatable release checks,
durable completed-chat recovery, compaction continuity, and verified incremental
context that preserves work performed by native Codex models.

5.2.0 adds existing-browser sign-in, independent native recovery, and isolated checkout development.

5.1.0 introduces Maria's own interface and in-app handbook, removes promotional
onboarding, and keeps the native connection alive independently of the window.
The 5.0.2 foundation added reversible provider repair, native catalog fallback,
SSE completion handling, and more practical Manual-mode deadlines.

### Canonical task context

Automatic Full mode loads required instructions and active task records first. Large historical successful tool outputs become immutable evidence references with previews; current/error results, instruction-file reads, human instructions and assistant action records are preserved. `codex_context_search` retrieves relevant evidence instead of forcing the model to reread all old logs.

`codex_context_read` returns bounded pages and delivery receipts. The next read acknowledges the preceding receipt; the last required page is acknowledged explicitly. Work and final completion require acknowledged core context, not merely locally served pages. Timeouts permit at most two identical read-only retries; authorization, safety and invalid-receipt errors remain terminal. Search and text-page results are capped at 24 KiB, with a finite optional retrieval reserve.

For repository work the model uses the current native tool registry and workspace: applicable AGENTS.md, relevant README/build files, bounded directory listings and targeted searches. The bridge does not scan a drive or grant broader filesystem permissions.

Supplied text/CSV/JSON files retain their content; PDFs get bounded text extraction in a child process. Originals, including formats not text-extracted, are available as private temporary files for native readers and calculations. PDF graphics and scanned pages require native visual inspection. Full-mode images can travel as native multimodal tool results instead of browser uploads. Original data and source roles survive bridge-owned compaction; real OpenAI-encrypted checkpoints remain opaque. Resumed turns rebuild attachment availability from canonical data and receive fresh local paths.

Refresh the Automatic connector after upgrading: it should list `codex_context_read` (with `receipt`) and `codex_context_search`. Their access is limited to the bound task. Command/edit permissions are unchanged. Temporary copies are retired after the turn; use the new index on later turns. Invalid/missing data and unresolvable cloud file IDs fail explicitly. Native formats can be handled through the current task's native tools; no universal format decoder is promised.

External evidence storage and multipart delivery do not multiply model capacity. The compatibility context-file option keeps the actual model window. Manual mode and read-only browser mode retain their own transport contracts. See [context delivery design](docs/context-delivery.md) for invariants and the verification matrix.

# Maria WebGPT

[![CI](https://github.com/mikkel32/codex-web-gpt-enhanced/actions/workflows/ci.yml/badge.svg)](https://github.com/mikkel32/codex-web-gpt-enhanced/actions/workflows/ci.yml)
[Download the latest release](https://github.com/mikkel32/codex-web-gpt-enhanced/releases/latest) · [Release history](https://github.com/mikkel32/codex-web-gpt-enhanced/releases)

**Your models. Your workspace. A little more possibility.**

Made with love -- Maria GPT 6 Astra 👀

Maria brings ChatGPT Web into your Codex workflow while keeping regular Codex
models available. Choose a native model for your Codex account, or choose a
**Maria Web** model to use your ChatGPT session. Your task, files, tools, and results
stay together in Codex.

## Start here

- Open **Maria WebGPT**. The Overview shows your connection and the next setup steps.
- Sign in to ChatGPT in the Browser page, or choose Manual mode in Settings.
- Open Setup to add Web models. Restart Codex once after installation so its picker refreshes.
- Choose a regular Codex model or a **Maria Web** model directly in Codex.
- Use **Guide & README** inside Maria whenever you need these instructions.

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

## Updates from our GitHub

Open **Updates** in Maria. When a newer complete release is available, the sidebar
shows **Update · v…** and the release page offers **Update to …**. Downloads are
verified against the release's SHA-256 checksums before installation.

- Maria checks at startup, every four hours, and when you return after at least 15 minutes. **Check for updates** retries immediately.
- The page shows the installed version, latest published version, and last successful check. A local build newer than the published release is labeled **ahead of the release**.
- Our repository is private. **Release notes & downloads** opens GitHub using your normal browser sign-in. For automatic checks and in-app updates, connect a fine-grained GitHub token restricted to this repository with **Contents: Read-only**. It is stored using operating-system encryption and can be removed in Updates.
- GitHub access failures and offline checks stay visible; Maria never reports them as "up to date."
- Finish active work before installing. DEV/source installations stay separate and do not replace the installed application.

## One task, less repeated context

Codex remains the source of truth for your task history, instructions, tool results,
and compaction checkpoints. In Automatic Full harness mode, Maria keeps a saved
ChatGPT conversation for the same Codex task and Web model configuration.

- **Large context:** two or three context files and any images are attached together, followed by one Send. No model acknowledgement messages or staging-model switches. File contents still count toward the configured context budget.
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

The Overview's **Copy native command** button copies this command. In this source
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
- Run Verify runtime. Native Codex tools continue to use Codex's own permissions.

## If something needs attention

- **Native models missing:** use Setup to reinstall the model integration, then restart Codex.
- **Web model unavailable:** open Maria, check browser sign-in and the model tier on your account.
- **Manual connection timed out:** select the shown connector and check MCP status before starting a new turn.
- **A turn stops unexpectedly:** open Activity and export diagnostics. Check whether the browser tab closed or the connector disconnected.
- **Switching models:** finish or cancel the current turn, then choose another model in Codex. Your Codex task remains the same.

Maria does not automatically resend an accepted prompt. This avoids duplicate work
when a network connection becomes uncertain. Both saved and Temporary Chat are
processed by OpenAI. Account availability and limits still apply.

## Our project

Source and issues live in our private GitHub repository:
https://github.com/mikkel32/codex-web-gpt-enhanced

There are no social-page requirements in onboarding. The project ships its own
interface, local guide, model integration, diagnostics, and release tooling.
Third-party license notices are included in LICENSE and LICENSES.

## Run from source

This source path requires Bun 1.4.0. Use an authenticated clone for this private repository.

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
```

Verification covers the runtime, launcher, model routing, process lifecycle,
TypeScript, the renderer, dependency audits, and relocatable runtime smoke checks.
Packaging produces an installer for the current operating system. macOS builds
include a signature check and a launch test. Windows and Linux builds run in CI.

## Release notes

5.3.0 adds a GitHub Updates page, private-release access, repeatable release checks,
durable completed-chat recovery, compaction continuity, and verified incremental
context that preserves work performed by native Codex models.

5.2.0 adds existing-browser sign-in, independent native recovery, and isolated checkout development.

5.1.0 introduces Maria's own interface and in-app handbook, removes promotional
onboarding, and keeps the native connection alive independently of the window.
The 5.0.2 foundation added reversible provider repair, native catalog fallback,
SSE completion handling, and more practical Manual-mode deadlines.

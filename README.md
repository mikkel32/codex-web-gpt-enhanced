# Maria WebGPT

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
when a network connection becomes uncertain. Temporary Chat is processed by OpenAI;
it is not local-only inference. Account availability and limits still apply.

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

5.1.0 introduces Maria's own interface and in-app handbook, removes promotional
onboarding, and keeps the native connection alive independently of the window.
The 5.0.2 foundation added reversible provider repair, native catalog fallback,
SSE completion handling, and more practical Manual-mode deadlines.

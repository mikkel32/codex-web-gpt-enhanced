# Guided setup and connector recovery

Start Maria on the computer that owns the project and choose **Set up automatically** in Overview. Maria checks the saved session, reuses existing tool credentials, installs or repairs the local runtime when needed, waits for Codex's model-catalog evidence, and runs the final local checks. It does not change your selected workflow or silently switch models.

Sign-in, account permissions, selecting the correct ChatGPT connector, and reopening Codex can still require you. These are not permission checks Maria should bypass. The current step stays visible when you navigate away, and **Open this step** takes you back. **Pause setup** prevents another step from starting; an installation already in progress finishes its transaction safely.

The setup list shows saved milestones, not live health. The Native Codex status card uses the shared connection monitor. **Settings saved** does not mean a runtime is online, and a local check does not mean ChatGPT has successfully called a project tool. Manual mode deliberately does not inspect the ChatGPT account or claim that it verified your connector selection.

## “Tool read not found” or “Tool exec_command not found”

These failures indicate that the called tool is not present at the receiving endpoint. They are not, by themselves, evidence that filesystem permissions are missing.

This repository's Automatic connector advertises these public tools:

- `codex_exec` and `codex_write_stdin` for the outer harness's command sessions.
- `codex_apply_patch` and `codex_view_image` for native edits and images.
- `codex_tool_inventory` and `codex_tool_call` for the exact tools in the active task.

`read` and `exec_command` are not alternate public names for those bridge tools. A harness may expose an inner tool with either name, but it must be discovered and called through its current declared schema. Native calls also need the active turn's capability token. Do not take a token from another task or an old conversation, invent one, or add an unauthenticated alias to work around a missing active task.

Open **Workspace tools** and compare the expected connector name and the selected tunnel with the installation on the intended computer. A stale plugin tool list, wrong server, or wrong tunnel can all cause this symptom. Reconnect the correct plugin in ChatGPT and start a new conversation attached to the active Codex task. The **Connection check** panel can explain a pasted error without transmitting or saving that text.

When migrating from the retired `Codex Native` connector, preserve the existing migration rule: create `Codex Native2` as a new connector. Do not rename the legacy connector to hide its cached contract. Automatic, Manual, DEV, and different computers must keep their respective runtime identities and tunnel ownership separate.

The inventory result now includes the claimed task's `environment.cwd`, `environment.roots`, `environment.writable_roots`, and `environment.sandbox`, as well as the active contract. These are returned only after the existing turn capability is validated. Discovery grants no additional permissions. The public `tools/list` names, schemas, annotations, and ABI hash are unchanged by this addition.

## Desktop control through Maria

Use the native Computer Use tools supplied by the active Codex task through Maria's
existing `codex_tool_inventory` and `codex_tool_call` gateway. Discover the actual
tool name and schema with a focused `cua` or `computer` query, then follow the API
documentation returned by that tool. Its native approval checks remain in force.
Screenshot results remain images through the gateway; listing a tool alone is not
proof that a screenshot or desktop action completed.

This path does not require a Chat On Steroids app or a separate desktop tunnel.
An independently installed `chat_on_steroids_desktop_mac` connector belongs to that
companion, even if a generated description labels it differently. Its cached tool
list can remain advertised while its owning app is closed. Removing that integration
does not require changing Maria's working tunnel, adding unauthenticated aliases,
or granting the replacement broader permissions.

For reviewed native desktop integration tests, retain the Codex session history.
An ephemeral test session can prevent the automatic reviewer from creating its
review fork. Preserve and report any resulting access rejection; do not treat it as
a successful image test or disable approval checks to make the test pass.

## “Unknown root /Users”

A connector exposing Windows or virtual roots cannot open an arbitrary Mac path. In particular, a virtual `/codex` root can be a Windows configuration directory, not a substitute for `/Users/...` on a Mac.

Open the project in Codex on the intended computer and use that task's attached connector. Discover the current inventory and approved roots before reading files. Do not rewrite the path to another computer, widen access, or copy the project to an unrelated machine merely to make the error disappear.

The diagnostic panel identifies the **launcher computer** and labels the **Codex configuration folder** separately. It intentionally does not invent an approved project root from that configuration path. Only the active task can supply the correct project context.

## Safety while work is running

### Full local access and tool safety checks

The active task's inventory reports `environment.sandbox`. When that value is
`dangerFullAccess`, Maria has received Codex's full local access setting. Commands
and edits still run through that task's native tools and current approval policy.
Maria does not infer approval policy from the sandbox mode or grant permissions
from a message saying that all actions are allowed.

ChatGPT app permissions and tool safety checks are separate from the local
filesystem boundary. An error such as **could not determine the safety status of
the request** does not establish that the user withheld permission, the tunnel is
broken, or a service such as Colnect rejected authentication. It also does not
establish that the requested action was classified as unsafe: the reported result
is indeterminate. Preserve the exact failed operation and its returned message.

Do not change tool annotations to conceal a command's effects, silently switch
tools or computers, or replay the blocked operation to get around the check.
Keep earlier edits and test results, and distinguish them from the unavailable
result. Independent work may continue within the remaining authorized scope.
An external rejection that occurs before the connector receives a call cannot
be repaired or verified by changing Maria's local permission settings. Persistent
failures require review through the host's support process; include only redacted
operation details and any host-provided error reference, never credentials.

OpenAI documents the separate controls in [Developer mode and MCP apps](https://help.openai.com/en/articles/12584461),
[Codex execution controls](https://openai.com/index/running-codex-safely/), and
[tool annotations](https://developers.openai.com/plugins/reference#annotations).

### Active task preservation

Setup waits for running operations, testing/running browser tabs, pending Manual prompts, active browser turns reported by the connection monitor, and runtime recovery. It rechecks after asynchronous probes and again before publishing success. A sign-out, access pause, changed workflow, removed installation, missing credentials, or pending Codex restart cannot turn a stale snapshot into a green result.

A failed installation is not replayed by subsequent state events. Continuing after a failure is an explicit action. Error details from the connector and doctor are retained for diagnosis, with key and bearer-token redaction in the UI.

## Validation

Run the existing root and launcher typechecks and test suites, then build the renderer:

```sh
bun run typecheck
bun run test
bun run launcher:typecheck
bun run launcher:test
bun run launcher:build
node launcher/scripts/smoke-workspace-ui.cjs
```

The renderer test uses an in-memory fake launcher API: it never signs in, collects credentials, edits a project, or invokes a real runtime installation. It checks eight surfaces at 1180, 700, and 500 pixels, plus first-run, Manual, DEV, offline, onboarding, Japanese, and Simplified Chinese states. Screenshots are written only when `MARIA_UI_OUTPUT` is set.

Set `MARIA_CHROMIUM_EXECUTABLE_PATH` to use a local Chromium installation. Alternatively, `MARIA_UI_ELECTRON=1` loads the built renderer from disk in a disposable Electron app with context isolation and Node integration disabled. On headless Linux, run that variant under `xvfb-run -a`. The production preload, account connection, OS permissions, and actual Codex-to-ChatGPT round trip still require acceptance on the target computer. Passing mock-renderer tests is not a substitute for that live check.

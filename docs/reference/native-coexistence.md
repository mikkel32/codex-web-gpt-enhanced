# Native Codex and Maria Web coexistence

Maria exposes two model lanes through the same Codex picker.

| Selected model | Route | Conversation owner |
| --- | --- | --- |
| `chatgpt-web/*` | Maria's local Responses bridge and ChatGPT browser adapter | Maria's launcher and turn broker |
| Every other model slug | Official Codex backend passthrough | Codex |

## Catalog behavior

Maria fetches the official Codex catalog, preserves native rows and metadata, and appends only the Web rows available for the signed-in ChatGPT account. Failure to inspect ChatGPT capabilities must not erase or disable native Codex models.

Manual routes keep their stable protocol slugs while using clear product names:

- `chatgpt-web/zero-risk` is displayed as **Maria Web — Manual**.
- `chatgpt-web/zero-risk-pro` is displayed as **Maria Web — Manual Pro**.

The separate ChatGPT connector retains its existing `Codex Zero Risk` compatibility name so installed clients do not break. Maria's interface refers to the feature as Manual mode.

## Request isolation

A `chatgpt-web/` model must pass route and account-capability validation before the browser adapter runs. Native slugs never enter that adapter; Maria forwards them to the official Codex Responses endpoint with the caller's authorization and Codex headers.

When a task changes from a Web model to a native model, Maria removes bridge-owned response identifiers, encrypted reasoning state, and Web compaction checkpoints before passthrough. Provider-private continuation state cannot leak between routes.

## Configuration migration

Legacy builds set `model_provider = "chatgpt_web_bridge"`, which sent normal Codex rows to the wrong transport. Current setup migrates the provider back to `openai` while retaining Maria's loopback Responses URL. The local daemon then dispatches by model prefix.

The integration journal records prior provider, base URL, catalog, feature, context, and interrupt-hook values. Repair and uninstall compare active values with the exact managed state before changing them, so later user edits are preserved.

## Process and turn continuity

- The native daemon is independent of the launcher window and can be adopted by a later Maria process.
- A streaming native response continues when the UI exits.
- An active browser turn keeps its browser host and exact Codex task identity.
- Tool batches are replayed by call ID until matching results arrive.
- Browser observer replacement must reclaim the existing turn rather than submit the prompt again.
- Compaction and cancellation close ordinary delivery atomically.
- Manual mode has separate preparation and connector-start deadlines.

## Verification

Normal CI runs actionlint plus full runtime verification, launcher tests, type checks, packaging, and packaged-app smoke tests on macOS, Linux, and Windows. macOS PR builds use credential-free ad-hoc signing so strict signature checks exercise the same path as branch and release builds.
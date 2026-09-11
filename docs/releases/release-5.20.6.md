# Maria WebGPT 5.20.6

Fixes a delivery discovery gap in 5.20.5: `maria_report_issue` was available through
the dynamic inventory, but `maria_send_reports` was registered only as a direct
tool. A cached connector could therefore queue an incident without discovering
the sender.

Both reporting tools are now included in the authorized task's dynamic inventory.
The discovered sender accepts an empty object through `codex_tool_call` and uses
the same delivery handler as the direct tool. Sender discovery does not require
working native command execution. Existing connector catalogs can use the
inventory/call path after the Maria runtime is updated.

Regression coverage starts with inventory discovery, checks the returned schema,
dispatches the discovered wire name, crosses the real MCP/native boundary, and
records a Gmail receipt. It also checks incomplete context, disabled reporting,
invalid arguments, revoked tasks, and duplicate prevention across both entry points.
Automated Gmail responses are fixtures; they do not prove a live service verdict.

Includes the previously prepared access diagnostics: native permission settings
and tool catalogs have separate fingerprints, developer-MCP-only restrictions
retain their specific error code, and exact native-name lookups avoid an unnecessary
extra discovery call. Existing approval boundaries and external rejections remain
in effect; this fixes discovery and dispatch, not OpenAI's authorization decisions.

## Packages and verification

This preview release contains locally built **macOS Apple Silicon** app and runtime
packages. Intel Mac, Windows and Linux binaries are not included; their previous
packages remain available in the latest full stable release, 5.20.5. The preview
label keeps platforms without a new binary on that stable release. GitHub CI and
Release jobs were not run.
Local verification includes types, core and launcher tests, Electron fixtures,
runtime relocation, native package smoke and strict macOS signature verification.

Update Maria to 5.20.6. Agents can discover `maria_send_reports` through
`codex_tool_inventory` and call the returned name with `arguments: {}`. Refreshing
the connector catalog is optional for seeing the dedicated tool. Connected Gmail
still requires the matching account and an active authorized task; queued, sent,
paused, rate-limited and uncertain states retain their distinct meanings.

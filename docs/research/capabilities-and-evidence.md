# Native capabilities and evidence

Maria exposes the tools supplied to the current Codex task. The public connector stays small: `codex_tool_inventory` discovers direct and deferred tools, and `codex_tool_call` invokes their exact returned names. A new public alias for every plugin is unnecessary and would leave cached connector schemas stale.

| Capability | Route | Evidence needed |
| --- | --- | --- |
| Commands and persistent terminal sessions | `codex_exec`, `codex_write_stdin` | Native command result and terminal session state |
| File changes | `codex_apply_patch` or a discovered file tool | Native change result, followed by relevant validation |
| Local image inspection | `codex_view_image` | Returned image inspected by the model |
| Computer use, browser control, screenshots | Inventory query for `computer`, `browser`, or `screenshot`; invoke the discovered tool | Actual available tool, its initialization/API instructions, fresh UI state and image results |
| Connected apps and installed plugins | Inventory query for the app name or operation, including pagination | Current registry entry and actual app result |
| Task history and coordination | Inventory query for task/history tools | Retrieved task records; a failed lookup does not erase earlier work |
| Large outputs and independent reads | Discovered native execution gateway, when supplied | Awaited results, explicit error handling and focused output |
| Historical logs and attachments | `codex_context_search` and `codex_context_read` | Current task's resource index, required-page receipts and retrieved evidence |

Computer-use tools supplied by the desktop harness may be absent from a CLI task. Plugin installation, account access, OS permissions, native sandboxing and approvals remain owned by their respective runtimes. Discovery does not create missing tools or grant access. Follow each tool's own usage restrictions and use purpose-built tools when available.

Nested MCP calls must preserve model-visible `structuredContent`, errors, images, audio and resource references. A generic status string is insufficient when the useful result exists only in structured data. Client-only MCP `_meta` is not copied into the model's text context. Image block metadata needed for image detail remains on the image.

## Model and effort selection

The model menu and Power are independent controls:

- **Latest / Seneste / Nyeste + Pro:** Astra.
- **GPT-5.6 Sol + Pro:** Sol Pro.
- **GPT-5.6 Sol + Extra High:** Sol Extra High.

Every automatic Sol request explicitly selects Sol. Immediately before Send, Maria checks the selected radio and requested Power again. A bare Pro badge is insufficient. Missing choices, ignored selection or changed Power stop before Send; they do not silently substitute another model.

## Continuity and failure reporting

Required context is acknowledged before work. A continuation sends only a proven new suffix, while historical evidence still present in canonical Codex history is rebuilt into the current searchable store. Previously omitted logs are not pasted into the new prompt. Attachments retain current private temporary paths; stale turn handles are removed from replayed data, including handles following escaped newlines.

A later optional lookup failure does not undo earlier edits or tests. Report verified work, the exact failed operation and remaining uncertainty separately. Do not infer "no files changed" from an unavailable task record. Historical snapshots are evidence of past results, not proof that a repository or service remains unchanged now.

The `turn-summary` runtime log records context acknowledgement and completed/failed outer tool-call counts without arguments, results, credentials or conversation text. Counts are diagnostic: a nested tool can fail inside a successful execution cell, and a completed call does not by itself prove a mutation. Consult the correlated tool result for that distinction.

A visible "Stopped thinking" label is a hint, not a user cancellation. The bridge excludes answer text and hidden controls, checks generation state first, and requires 30 seconds of consecutive idle observations with no semantic progress. New text, tool/context activity, uncertain generation state, and long observation gaps reset that evidence. A confirmed upstream stop reports `chatgpt_generation_stopped` without replaying the submitted prompt; explicit Codex cancellation keeps its existing behavior.

Successful context reads and searches are forwarded to the browser helper as liveness without inventing a native tool batch or bypassing required-context receipts. Their broker observation waits for changes instead of polling. Quiet response polling backs off to one check per second, returns to 250 ms on changes, and wakes immediately for recorded context/tool progress. `stopped-status` logs record observing/cleared/confirmed transitions and numeric progress evidence without message contents or credentials.

## Hosted subagents

ChatGPT-hosted delegation is distinct from Maria/Codex creating tasks or tabs. Use a hosted delegation tool only when the selected ChatGPT environment exposes it. A prompt can request delegation but cannot establish that the tool exists or that private orchestration occurred. Do not count a model's claim of parallel reasoning as observed agent launches.

Historical Pro-labelled delegation has been verified: an inspected `gpt-5-6-pro` response in a saved Chat contained native Subagent activity events, a roster of six completed agents and separately accessible reports. The model label does not identify its full backend execution path. A negative smoke test therefore does not establish that Pro Chat cannot use hosted agents. Current availability must be verified for the actual run; fresh chats, a normal-Chat branch, a continuation of that historical chat, a regular-browser control and unpersonalized Temporary Chat did not produce verified new agents in the September 9 experiments.

Treat assistant-written diagnostic strings and generated benchmark metadata as claims, not transport evidence. One experiment reported `WORKER_IDENTITY_LOST`, then clarified that no recoverable launch result supported it. Require actual invocation/results or new native agent activity before diagnosing a launch failure. UI record names such as `SubAgentActivityThreadItem` are not established callable tool names. Do not present a prompt-only force-enable switch as implemented without repeatable successful launches.

Identify the provider before attributing an agent-tool error. An external plugin can advertise an `agents` operation while its server returns `Tool agents not found`; that is a catalog/server mismatch, not evidence about ChatGPT's native launcher. Task-history readers may return only prose even for chats with verified native agent panels. Their omission of tool records is not negative evidence.

Public client source distinguishes native agent activity from parallel response generation and supports Pro-labelled turns across runtime paths. A bounded experiment adding a suppressed legacy runtime field failed with a generic UI error despite HTTP 200. Ordinary and byte-identical pass-through controls completed without verified new agents. This does not establish server support or the failure's cause; Maria ships no runtime-forcing toggle based on those results.

OpenAI documents native multi-agent orchestration in the [Responses API](https://developers.openai.com/api/docs/guides/responses-multi-agent), where it is explicitly enabled. Its [GPT-5.6 builder guide](https://openai.com/index/builders-guide-to-gpt-5-6/) relates this to ChatGPT's ultra capability setting. Those documents alone do not prove that a regular Chat Sol Pro response exposes a user-callable hosted-subagent tool, or authorize substituting an API request for a Web request.

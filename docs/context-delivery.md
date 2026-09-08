# Context delivery design

## Evidence and decisions

The prior transport required reading every historical byte before work and counted a
locally served page as received. Responses input_file data was reduced to a filename.
These are distinct correctness and latency problems; a larger timeout does not fix them.

OpenAI recommends task-specific goals, context and constraints, plus repository guidance
in AGENTS.md: https://learn.chatgpt.com/guides/best-practices. Its retrieval guide documents
the latency/recall tradeoff when retrieving fewer results:
https://developers.openai.com/api/docs/guides/tools-file-search. Compaction output must be
preserved as the canonical next window, not arbitrarily pruned:
https://developers.openai.com/api/docs/guides/compaction. These are design references;
they do not establish ChatGPT Web's private protocol or service guarantees.

## Invariants

1. Preserve all system/developer/user/agent messages and assistant action records.
2. Preserve current and error tool results. Only large historical successful tool-result
   bodies may become immutable, searchable evidence references; retain metadata and
   bounded head/tail previews. Never regenerate evidence by replaying a mutation.
3. Require explicit response receipts for essential context before work/completion.
   Serving a page is not proof that its response reached the model.
4. Use the current Codex tool inventory, cwd and sandbox for repository exploration.
   Inspect relevant AGENTS.md, README, build files and requested paths through those
   tools. Do not crawl a whole drive or replace instructions with guessed summaries.
5. Preserve typed attachments. Decode supported content explicitly; reject unavailable
   IDs and malformed payloads with a precise reason. Preserve originals of unextracted formats for native tools.
6. Serve Full-mode images through the bound native connection when supported; do not
   duplicate them as base64 text or rely on a successful-looking upload card.
7. Bound page bytes, optional retrieval, deadlines and retries. Retire state and receipts
   with the task. Keep images, role provenance, model budgets and same-chat identity.
8. Keep manual mode and compaction contracts explicit. Do not advertise an untested
   fallback as supported, and do not infer that a green local health check proves delivery.

## Verification targets

Large old logs, late instructions, current failed commands, exact historical queries,
workspace discovery, attachment contents, images, invalid payloads, missing IDs, dropped
responses, duplicate receipts, wrong-task receipts, cancellation, budget exhaustion,
fresh/resumed tasks, and the actual packaged helper handoff are separate acceptance cases.

The transport is intended to make failure bounded and diagnosable. No test matrix proves
that every future network, model, file-format or account condition will succeed.

## Implemented delivery boundaries

- Required core records and higher-priority text attachments use receipt acknowledgements.
- Historical successful tool bodies over 16,384 characters may be deferred only before the latest user request and outside the most recent eight messages. Instruction-file reads and errors stay required.
- Evidence and supported attachment text are searchable, with a 32,000-token optional retrieval reserve. Actual model limits still apply.
- Text pages contain at most 12,000 UTF-16 code units and 24 KiB serialized; image data stays multimodal. Original supplied attachments are bounded to 20 MB each / 50 MB total, and native image sets to 32 distinct images subject to model budget.
- PDF extraction runs in a separate process with a 30-second deadline, 200-page and 4-million-character limits, and no network fetches. Text-only extraction does not establish visual understanding.
- Private per-turn copies let native tools compute on a large original file without transferring all its contents to the model. Stable content references rehydrate files on delta turns. Normal retirement removes copies; orphan cleanup only targets marked cache directories whose owner process is gone.
- Bridge-owned `ocx2:` checkpoints compress and preserve original document/image blocks and their roles. They are transparent bridge data, not OpenAI encryption. Native passthrough expands them into ordinary messages/attachments. Plain native compaction retains the native client's history policy.
- Read-only and manual browser modes do not silently claim inline-document support. A usable workspace reference or extracted content is required where that transport lacks document access.

## Removed conflicting paths

The unused staged ACK formatters and staging-effort selector, the duplicate context-read path through the write gateway, the synthetic automatic context-window multiplier, and the dormant 3x-context recommendation modal were removed. Current connector schemas, same-task identity, native permissions, and explicit manual boundaries remain authoritative.

PDF text support uses the maintained unpdf serverless build (https://github.com/unjs/unpdf), with per-page sequential extraction rather than unbounded parallel page processing. This is an implementation dependency, not evidence that every malformed or visual PDF can be understood.

## Fresh tasks, continuing tasks and compaction

The actual browser preparation path selects the prompt. A new ChatGPT conversation starts
from the current user request and supplied task records, with focused workspace discovery
when local evidence is needed. A proven retained conversation receives a continuation
instruction: use this same chat's existing history together with the new Codex updates.
The cursor verifies the accepted prefix, native turn and emitted final-answer message ID
before omitting anything. Unchanged system records can also be omitted after their digest
matches that accepted turn. Changed instructions, missing provenance and legacy cursors
preserve the supplied records. Only hashes and IDs are saved, not another transcript.

When a safe delta cannot be established, the retained chat receives a resync instruction
and the canonical current records. A readable checkpoint is identified as task state,
with completed work, pending work, constraints and references. A missing retained chat
still fails explicitly rather than silently moving the task elsewhere. Attachments are
rehydrated from canonical input with current paths and fresh receipts on every relevant turn.

During Codex compaction, outstanding accepted tool results remain canonical. A newly
requested tool intercepted at the compaction boundary is explicitly marked unexecuted.
The Web response settles, then the same retained conversation receives one structured
handoff request. The bridge accepts only the matching checkpoint after physical settlement.
Codex owns the replacement history and the next request. Compaction does not complete,
restart or replay work, reset a goal, or renew old tool tokens. Failure retains the task
for diagnosis instead of manufacturing an empty successful handoff.

The preferred handoff remains the one-shot native control tool. Its final-text fallback
uses exact `CODEX_COMPACTION_HANDOFF_BEGIN` and `CODEX_COMPACTION_HANDOFF_END` lines carrying
the current handoff ID. The summary between them is ordinary text/Markdown, so quoted JSON,
paths and code do not need JSON-string escaping. A repeated live test exposed that escaping
failure in the earlier JSON-only fallback. Wrong IDs, partial or nested boundaries, empty
summaries and extra surrounding text are rejected. Valid older JSON envelopes remain
readable; malformed JSON is never repaired or guessed into an accepted checkpoint.

The ordinary prompt asks the model to maintain concise working state and distinguish
verified completion from pending or uncertain work. It does not request a second private
summary every turn or let Web independently replace Codex history. The existing explicit
Luna rolling-checkpoint and manual Zero Risk protocols remain separate.

OpenAI's [current model guidance](https://developers.openai.com/api/docs/guides/latest-model)
supports clear task scope, follow-through, and explicit handling of conflicting instruction
files. The [Instruction Hierarchy paper](https://arxiv.org/html/2404.13208v1) studies role
priority and treating third-party content as lower-priority input; it is a training paper,
not a recipe that guarantees perfect prompts. The bridge therefore preserves role labels
and user corrections instead of flattening everything into a generated system summary.
Our application of these sources is an engineering choice verified by regression and live
tests, not an assertion about undocumented ChatGPT internals. OpenAI's
[compaction guidance](https://developers.openai.com/api/docs/guides/compaction) also requires
preserving the returned canonical window. A visible old chat is useful context but cannot
substitute for current constraints or evidence that is no longer available to the model.

## Automatic setup verification

Automatic Full setup checks local health and connector selection, then performs a real
read-only connection test before setting `mcpSetupComplete`. The test sends a disposable
task with paginated required context, receipt acknowledgements, separately searchable
evidence and one inert native probe discovered through the current tool inventory. Its
answer must reproduce independently generated values from all three sources. It exposes
no shell or repository tools, does not change permissions, and does not join an existing
user task. A selected chip, a locally served page, or a model's claim of success is insufficient.

The check uses Extra High where available, High for other Sol accounts, or Luna for
Luna-only accounts; it never chooses Pro. Current live acceptance uses Extra High only.
Failures and timeouts are terminal for that check, carry a `connection_...` trace ID, and
retire only its capability. Existing launcher Activity and sanitized log export retain
the diagnostic trail. Saved proof is invalidated when release, connector, tunnel, broker
or browser profile changes. Run `codex-chatgpt-web verify-connection` to reproduce the
round trip; source checkouts additionally require `--allow-production` for production data.

This proves the tested context and native gateway route. Each real task still supplies
its own tool inventory, sandbox and approvals. Initial account sign-in, tunnel credentials
and ChatGPT consent must be available; setup does not invent authorization or disable
approval enforcement. Manual Zero Risk verification remains a local health check with
manual connector selection and Send.

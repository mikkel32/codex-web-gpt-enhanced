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

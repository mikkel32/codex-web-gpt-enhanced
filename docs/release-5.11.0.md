# Maria WebGPT 5.11.0

Changing Bigger Context, timeouts, or approval preferences now preserves a Full launcher task's saved Web conversation identity. The first profile binding adopts the existing namespace; subsequent settings changes still take effect in the browser worker without changing conversation, trace, or replay ownership. Different browser and connector profiles remain separate, and damaged bindings stop with an actionable error.

The local Responses history cache now shares exact immutable prefixes instead of persisting the whole history separately for every response. Previous response IDs still reconstruct complete ordered input, including native tool and goal metadata. Expiring an older response does not discard history needed by its descendants. Existing snapshots migrate automatically; corrupted or oversized dependencies never produce partial replay.

In a deterministic 200-response fixture, the flat serialized history baseline was 21.5 MB and the new restart snapshot was 172 KB, about 125 times smaller. This measures that fixture's serialized storage, not total app memory or ChatGPT's context window. Compaction remains a Codex responsibility, and the live app can be updated normally without a development-time restart.

Regression coverage includes concurrent profile publication, settings changes after a completed compaction/tool turn without another browser send, shared-prefix restart recovery, forks, expiration, Unicode byte budgets, damaged snapshots, and caller mutation isolation. See [continuity research](CONTINUITY_RESEARCH.md) for evidence and remaining live measurements.

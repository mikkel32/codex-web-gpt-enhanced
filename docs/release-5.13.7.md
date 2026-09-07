# Maria WebGPT 5.13.7

Separates Web capability declarations from native model metadata. Web rows retain an explicit list of Codex host settings and declare their implemented transport capabilities; new native-only fields and reasoning-level metadata are no longer inherited automatically. Native inference settings remain unchanged.

Web requests now reject unsupported Fast/Priority/Flex tiers, Responses background jobs, native async tool-call semantics, and configuration_update items before starting an adapter. Native routes forward these settings unchanged. Notes/history tool definitions and results remain supported through the ordinary tool protocol.

Web effective context percentages now round down. Real Codex probes confirmed that the client already clamps global context overrides to each model's maximum, but rounding upward could let a global auto-compaction override exceed the Web budget. With Bigger Context enabled, Web Pro now reports an effective window of 282,726 tokens, below its 285,000-token compaction budget. Native 1M/900k overrides do not need to be removed or changed.

The reusable smoke:web-compatibility check runs a real Codex binary against local synthetic responses. It covers below-budget execution, one automatic compaction, checkpoint continuation, and preservation of the native context override. It passed with Codex 0.153.4 and 0.154.0-alpha.1. Its API-key fixture also accepts the experimental-context setting, but does not activate or certify the account-gated Plus/Pro experimental engine. The user's global experimental setting is not changed.

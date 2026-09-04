# Codex Web GPT Enhanced

Private hardening and integration fork for running optional ChatGPT Web models inside Codex while preserving the complete native Codex model catalog.

The repository is bootstrapped reproducibly from the pinned upstream revision in `UPSTREAM.lock`. The source import is created on a review branch, verified, and merged before fork-specific changes are added.

## Fork goals

- Keep official Codex models first-class, selectable, and unchanged.
- Append WebGPT models under an unmistakable `chatgpt-web/` namespace.
- Never make a WebGPT model the global default automatically.
- Keep the legacy `chatgpt-web/zero-risk` slug compatible while presenting it as a manual, no-DOM-automation mode.
- Preserve exact `Codex Native2` connector identity and fail closed before sending when verification is uncertain.
- Keep credentials and browser state local.
- Remove mandatory social actions, telemetry, and automatic update behavior.
- Make configuration changes transactional and exactly reversible.
- Verify native passthrough, provider switching, retained conversations, compaction, packaging, and launcher recovery.

See `FORK.md` for the implementation and release gates.

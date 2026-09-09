# Maria WebGPT 5.9.0

Home is simpler, startup preserves newer state, and the handbook loads only when needed.

- One primary Home action adapts to sign-in, model setup, tool setup, access review, or continuing an existing task. Continuing selects the original tab; it does not send a prompt.
- Removed repeated model and setup controls. Connection details expand when needed, with their summary status still visible. The native launch command remains available inside those details.
- Browser-only setups no longer treat optional MCP tools as unfinished setup. Manual mode, DEV mode, and configured full-harness setups still require their tool connection.
- The browser home tab no longer appears as a saved task or inflates the conversation count.
- Live settings, browser, operation, and update events arriving during startup take precedence over the initial snapshot. A delayed snapshot cannot revert newer state.
- The handbook is split out of the initial JavaScript bundle. A failed local guide load provides an online guide link instead of an endless loading state or ineffective retry.

Verified with focused state tests and isolated browser fixtures for ready, setup, manual mode, task resumption, delayed startup events, compact layout, and guide-load failure. Preview results do not measure live ChatGPT performance. The existing motion system and same-conversation transport safeguards are retained.

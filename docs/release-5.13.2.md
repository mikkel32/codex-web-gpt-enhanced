# Maria WebGPT 5.13.2

Fixes Astra selection when the model submenu is already expanded or Power remains visible but disabled during a transition. Selection now waits for the real menu state, tolerates radio rows unmounting, and waits for the trigger label to settle after closing the menu.

Compact embedded-browser layouts no longer need to display `6 Pro` on the closed button. Maria reads model information from that control's DOM and accessibility labels; a button that only says `Pro` requires fresh GPT-6 proof from the owned menu. A generic Pro label or an assistant's self-description is not treated as proof of Astra. Another generation is still rejected.

A repeated failed Astra selection now returns a terminal HTTP 400 with the picker phase and observed label, rather than another failed stream that Codex retries five times. A new instruction has a separate retry identity.

CI and release builds now exercise the production selector in Electron's Node runtime against a real Chromium picker fixture on Windows, both macOS architectures, and Linux. Coverage includes delayed transitions, compact/hidden generation labels, an expanded submenu, retained compact controls, and rejection of 5.6 Pro. These are offline interface regression tests, not live tests against a user's ChatGPT account.

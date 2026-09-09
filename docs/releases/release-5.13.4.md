# Maria WebGPT 5.13.4

Fixes Astra selection rejecting ChatGPT when Latest is selected and Power is already Pro but the picker displays only Pro. The route now checks Latest's selected radio state and the Pro power setting, without requiring a literal GPT-6 label. Numeric badges no longer bypass that check either.

Both initial selection and the final check before Send use the actual picker state, including retained conversations. A different selected model or lower power still stops submission. Real Electron regressions cover the already-selected Latest + Pro state with no generation label, selecting it from another state, both submenu layouts, and rejection when either setting is wrong.

# Maria WebGPT 5.20.9

Includes the keyboard-based personalization preflight fix from local 5.20.8 and
reliable short connector mention insertion. The live picker exposed the existing
Codex Native2 Mac connector after text insertion, while per-character key events
left the verification composer empty and produced a misleading missing-connector
result. Connector discovery now inserts its short query through the composer's
text input path, then performs the existing exact menu and selected-chip checks.

No tool permissions, sandbox settings, authentication, connector names or external
safety decisions are changed. Cancellation and cleanup retain their existing
boundaries. A regression models dropped per-key input and proves that selection
requires the complete mention. The full native runtime and installed browser
verification results must be recorded separately from offline tests.

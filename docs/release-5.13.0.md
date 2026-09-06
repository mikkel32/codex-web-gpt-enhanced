# Maria WebGPT 5.13.0

Adds **Maria Web - Astra Pro** to the automatic Pro-account model catalog. The route uses regular Chat's Latest + Pro selection and confirms the actual `6 Pro` badge before submission. It stops with a specific error if the account exposes another generation or cannot confirm Pro. The existing native MCP tool loop, response replay, and retained conversation handling remain available through the separate Astra route.

Only Astra Pro is verified on the regular-Chat transport. High and other lower Latest settings do not identify the model generation in the observed picker; requesting `gpt-6-pro` with `high` in the URL still selects Pro. Work separately exposes Astra Light, Medium, High, Extra High, Max, and Ultra, but this release does not route Maria's regular-Chat transport through Work.

The implementation follows the visible-picker approach traced in Chat On Steroids PR 83. See [Astra routing investigation](ASTRA_ROUTING.md) for exact source references, live observations, and the difference between product controls and API reasoning parameters. Existing Pro transport budgets remain conservative bounds rather than claimed Astra capacity measurements.

# Astra routing investigation

Observed 2026-09-06. The relevant Chat On Steroids implementation is the then-unmerged [PR 83](https://github.com/totec448-spec/chat-on-steroids/pull/83), inspected at commit `9204522a005d6351f3d6765aefd1f4e80518f718`. The released 2.0.5 branch only mentioned Astra in release notes and did not implement model selection.

## Regular Chat

Their [picker adapter](https://github.com/totec448-spec/chat-on-steroids/blob/9204522a005d6351f3d6765aefd1f4e80518f718/extension/chatgpt-dom.js#L1815) opens ChatGPT's normal thinking menu, chooses Latest, moves Power to Pro, and reads the generation badge. Its discovery code exposes a numeric Pro model only when the badge confirms that generation. Their [model classification](https://github.com/totec448-spec/chat-on-steroids/blob/9204522a005d6351f3d6765aefd1f4e80518f718/src/shared/chat-models.ts#L2) treats GPT-6 Pro as Astra. This is a visible account picker route, not a hidden model unlock or an API request rewrite.

A signed-in regular Chat inspection reproduced Latest + Pro displaying `6 Pro`. The user subsequently confirmed the resulting Astra conversation worked. The assistant did not send a test prompt.

Stepping down to Extra High, High, Medium, and Instant removed the numeric generation badge. Opening the repository's model/effort URL combination `model=gpt-6-pro&reasoning_effort=high` still produced `6 Pro`, not an Astra High selection. These observations establish Astra Pro on this account; they do not establish which backend serves the lower Latest levels.

Maria's `chatgpt-web/astra-pro` route retains the current Pro transport budgets and native MCP tool loop. It selects Latest, checks the observed five-position Chat power range, moves to Pro, and verifies the `6 Pro` badge both before and after closing the menu. Missing Pro, another generation, or an unconfirmed selection produces a terminal error. Existing conversation keys include the separate Astra backend identity.

The route advertises the existing fixed Codex `ultra` protocol value and maps it to the adapter's Pro (`max`) mode. It does not advertise unverified lower Astra efforts. Pro account capability exposes the candidate route; actual Astra access is checked in the browser before submission. The existing conservative Pro context envelope is not a new measurement of Astra's maximum capacity. Compatibility V1's five-entry subagent override roster remains bounded; Astra is available in the main model catalog but may fall outside that legacy override roster.

## Work

The separate Work picker explicitly retained `GPT-6 Astra` while visiting all six displayed levels: Light, Medium, High, Extra High, Max, and Ultra. That establishes UI selection availability, not a verified integration of Work with Maria's regular-Chat transport. The [official API model page](https://developers.openai.com/api/docs/models/gpt-6-astra) documents API reasoning levels separately; product labels should not be silently treated as identical API parameters.

Only the owned blank inspection tab was changed. The user's working conversation was preserved, and the inspected preferences were restored to Astra Light on Work and Latest Pro on Chat. Tests cover generation mismatches, missing Pro, unexpected slider movement, route gating, and a complete native MCP tool round with completed-response replay.

## Submission and cancellation audit

The initial selection check was insufficient for retained conversations: those can skip the picker, and prompt/file preparation happens after selection. Every Astra submission now checks the badge again after Send becomes enabled and before marking Send activated. A changed generation, lower effort, or missing control stops submission. On compact controls that only show Pro, this can open the owned menu to read its generation, then close it without switching models. Reused conversations receive the same check.

Picker operations carry the turn/stage cancellation signal. Cancelling during a model change prevents subsequent power adjustments; cancelling while the menu opens prevents the pointer fallback. Cancellation retains its original reason instead of becoming an Astra-availability error. Explicitly disabled power controls are rejected. Fault-injection tests call the real submission method and assert zero Send presses and zero activation callbacks when the final badge cannot authorize Astra.

The reported Windows failure exposed gaps in the original synchronous mocks. Live inspection confirmed that Power stays mounted but disabled while the model list is expanded, and the expanded model row loses its Select model label. The selector now handles those states explicitly and waits through temporary disablement. Compact-label handling uses only the owned model control and menu, never conversation prose. An exact native retry of a cached Astra selection failure receives HTTP 400 before another adapter is constructed. The failure message identifies the phase and, when available, the observed picker label.

`bun run smoke:astra-picker` runs a compiled selector driver in Electron-as-Node against an isolated Electron Chromium window. CI runs it on every supported platform after package checks. The fixture mirrors the observed menu states and the reported compact-label case, with asynchronous transitions and unmounted radio rows. This adds real keyboard/DOM coverage beyond mocks while keeping user accounts and conversations out of the test.

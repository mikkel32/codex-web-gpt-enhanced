# Maria WebGPT 5.13.5

Fixes Astra selection in Danish ChatGPT. The picker recognizes Seneste and locates the model expander and power slider by their ARIA structure instead of requiring the English labels Select model and Power. Closing the picker also uses its open/closed state instead of translated effort text. Latest/Seneste plus Pro is checked during preparation and again before Send, including already-selected and retained conversations.

Adds Danish handling for Temporary Chat onboarding, Think mode, one-time connector approval and denial, rate-limit and session errors, subscription errors, terminal errors, and stopped-thinking status. Connector confirmations remain scoped to the configured app, and persistent approval actions are never substituted for one-time approval.

The real Electron picker regression runs the same selection and rejection cases in English and Danish on Windows, macOS, and Linux. Danish picker labels were checked in the live ChatGPT interface; the original browser language preference was restored after inspection. No language change is required to use the fix.

# Maria WebGPT 5.6.0

Maria 5.6 brings a complete desktop interface refresh and removes the old browser
smoke-test requirement from account setup.

- One shared copper Maria mark across the application, onboarding, sidebar,
  browser tabs, and browser connector.
- A redesigned workspace with conversation shortcuts, real connection states,
  setup progress, and direct access to model configuration.
- One-page onboarding with language and interaction mode choices.
- Two-step automatic setup: connect ChatGPT, then discover and install available
  Web models. Setup does not select High or send a disposable prompt.
- Cmd/Ctrl+K page search with keyboard navigation and native focus containment.
- Activity search, severity filters, and a pause control for reading incoming
  events; log storage and updates remain bounded.
- Grouped settings with named accessible switches, real browser identification
  icons, and consistent styling across setup, tools, recovery, and updates.
- Updated English, Chinese, and Japanese setup and workspace text.

Existing completed setup remains valid. Obsolete smoke-test state is discarded,
and stale requests to run the retired test are rejected before a helper starts.
Manual-mode setup continues through its separate workspace-tool connection.

This release retains the 5.5 cooperative access pause/resume behavior and strict
handling of submissions after Send. It does not restart or install itself until
the user chooses the update action.

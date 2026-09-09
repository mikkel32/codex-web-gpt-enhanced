# Maria WebGPT 5.7.0

## Motion and navigation

- The sidebar now folds into a usable icon rail with a spring-driven width
  transition and a shared moving selection indicator.
- Sidebar width and the desktop collapsed state are remembered. Compact windows
  have a separate overlay state. Resize with the edge, arrow keys, or double-click
  to reset the width.
- Page transitions, masked heading reveals, staggered panels, interactive
  three-dimensional branding, and control feedback use one motion system.
  System reduced-motion preferences remain respected.
- Cmd/Ctrl+B toggles the sidebar, Cmd/Ctrl+K opens page search, and Cmd/Ctrl+1–8
  switches pages. Native shortcut routing works from the embedded browser.
- Returning to a page restores its scroll position. Activity search and severity
  filters survive navigation within the current window.

## Runtime and reliability

- Native browser geometry has one owner. Rapid changes coalesce, measurements
  precede reveal, and retired navigation cannot apply a stale reveal.
- Redundant native bounds updates and synthetic browser resize events are removed.
- Connection readers share one visibility-aware monitor, with event invalidation,
  fast recovery checks, bounded failure backoff, and stale-response suppression.
- Health samples are coalesced and validate the service identity before reporting
  a connection. Development profiles remain separate from production.
- Failed initial IPC now presents a retry action instead of an endless loading
  screen. Renderer navigation hides stale native views while new bounds arrive.
- About includes the packaged source revision and local-build status.

## Release infrastructure

Intel Mac joins the normal CI matrix. Automatic tags are created after all platform
builds and local asset checks. Installers are uploaded to a draft, and the release
becomes visible to the updater only after published checksums are verified.
Published releases are not overwritten by reruns.

Existing sessions, configuration, manual-mode boundaries, and no-replay handling
are preserved. Setup still performs no synthetic ChatGPT message.

# Guided workspace UI

The primary setup surface is `AutomaticSetup`, mounted once outside the route
transition. `automatic-setup.ts` owns the single-flight sequence; changing pages
must never create another controller or repeat installation. `guided-setup-view.ts`
derives progress from observed state rather than elapsed time. `guided.css` is the
final design layer, preserving native browser geometry and existing safety controls.

## Flow ownership

Onboarding's explicit user intent is observed even if its state event wins the IPC
reply race. `start()` may perform setup; `inspect()` is read-only and cannot log in,
install, navigate or repair. Event bursts coalesce. A generation fence discards
late results after pause, disposal or invalidated read-only evidence. `pause()`
lets an already-started IPC transaction finish safely.

Core and tools installation have independent, bounded attempt sets. A clean
Automatic Full request first establishes the Codex catalog required by the tool
form. Manual, DEV and existing Full profiles instead require their own credentials
without a Browser-only fallback. The form owns new credential submission; an
external setup failure stops the guided controller instead of replaying that write.

Before final readiness, reread authentication, access, profile, mode, runtime,
Codex-catalog and tool-connection evidence. Permissions and live process ownership
remain enforced by the main process; renderer state is presentation, not authority.

## Validation

```sh
bun run launcher:build
bun run smoke:guided-ui
bun run test
bun run launcher:test
```

Set `GUIDED_UI_ARTIFACT_DIR` to an absolute directory to retain renderer screenshots.
The UI smoke launches a standalone Electron fixture with a fresh temporary home,
blocks external network access, denies browser permission requests and never loads
the production main process. It exercises the built production renderer through
its public preload API contract, but does not prove authenticated account flows.
Linux uses `xvfb-run`; macOS and Windows use their native Electron builds.

The optional existing renderer stress check remains available through
`bun run app:performance`. `MARIA_CHROMIUM_PATH` can select an explicitly installed
Chromium for an offline validation environment. Never point a fixture at a live
launcher or include credentials in retained screenshots.

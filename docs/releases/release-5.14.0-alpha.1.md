# Maria WebGPT 5.14.0-alpha.1 — Your workspace, connected

An opt-in preview of the redesigned Maria launcher. This release builds on the
integrated automatic-setup and safe-recovery changes in 5.13.10-alpha.2.

## A simpler interface, throughout

A new charcoal-and-sage workspace replaces the old presentation across onboarding,
Overview, ChatGPT, Connection, Local tools, Activity, Help, Updates and Settings.
Readable cards, clear focus states and responsive layouts work at desktop,
compact and narrow window widths. Reduced-motion preferences are respected.

Overview now presents one next action, an evidence-based setup checklist, active
conversations and connection health. Advanced connection controls are still
available, but no longer compete with everyday actions. Help starts with concise
answers; the technical handbook loads only when opened. Updates distinguish an
available installer from a failed check or a remembered version number.

## More work handled by Maria

- Choosing **Connect my workspace** during onboarding starts the guided flow.
  A state event arriving before the onboarding reply does not lose that intent.
- Setup continues after sign-in and verified Codex catalog events, reuses saved
  connection details, and remains active across navigation.
- New Automatic installations requesting local tools establish the necessary
  Codex connection before asking for tool credentials. Existing Full, manual
  and DEV configurations are never silently converted to Browser-only.
- Local tools use two meaningful steps, with credential-format validation and
  duplicate-submission guards. A failed external setup operation is not blindly
  retried by the automatic controller.
- Returning users get read-only health checks, not another installation. Sign-out,
  access pauses and configuration changes invalidate old success states.
- Active work blocks disruptive setup/update actions. Permission problems,
  invalid endpoint metadata and failed rollback require review rather than an
  indiscriminate retry loop.

## What still needs you

The combined release retains claimed-task workspace discovery, distinct missing-tool
and wrong-computer diagnostics, compatible-runtime health checks, bounded recovery,
and verification of uploaded assets against the original build checksum manifest.
Explicit setup requests arriving during a read-only check are preserved; Pause and
disposal still cancel pending intent. A changed installation identity invalidates
previously displayed setup evidence.

Maria cannot create or approve account access on your behalf. You sign in, provide
one-time tunnel credentials for local tools, and approve the ChatGPT connector.
Codex may need to be reopened after installation; finish active work first.
Manual mode remains manual: no automated prompt submission or ChatGPT content
inspection is enabled by this redesign. No rate-limit or model-access checks are
bypassed.

## Installation and recovery

Choose the installer matching your computer from this release's assets: Apple
Silicon or Intel macOS, Windows x64, or Linux x64 AppImage. The runtime archives
are for advanced/manual installations. `checksums.txt` covers the published files.
This is a prerelease, not the stable/latest automatic-update channel.

Quit or finish active work before upgrading. Existing saved settings and browser
profiles are reused. If setup stops, keep Maria open and follow its single next
action. Technical diagnostics remain available in Activity; export only the safe
log, never cookies, raw profiles, tunnel IDs or keys. An interrupted cross-version
setup preserves its settings as upgrade-required instead of reporting false
readiness. Do not delete your saved profile merely to clear an error.

## Validation and acceptance boundary

The release workflow must pass the full four-platform verification, native
packaging and packaged-app smoke matrix before publishing. `bun run verify` now
also runs a real-Electron **offline renderer** suite: three locales, three window
widths, every navigation surface, first-time setup handoffs, duplicate-click
protection, stale-readiness invalidation, manual/access boundaries and failure
presentation. These fixtures contain no live account or user profile.

**Account-bound acceptance remains unexecuted for this version:** Windows 11
items 1–11, macOS items 2–10 and Linux interactive items 2–7 in
`docs/development/release-validation.md`. This includes authenticated ChatGPT sign-in,
installed Codex model discovery, live MCP tools, compaction/cancellation and
upgrade behavior on a real user's machine. Offline tests and packaging smoke do
not establish those results. This is why the release is explicitly an alpha.

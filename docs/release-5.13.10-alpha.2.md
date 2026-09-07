# Maria WebGPT 5.13.10-alpha.2 — guided workspace and reliable recovery

This is an **opt-in prerelease**, not the stable/latest update. It includes the merged
launcher redesign and Native2 workspace diagnostics from PR #6, plus a follow-up fix
for stalled automatic recovery and stricter release verification.

## Connection and automatic setup fixes

- A running recovery helper no longer traps an outdated installation in an endless
  “recovering” state. A release mismatch is explicitly upgrade-required. Other offline
  recovery attempts have a bounded 30-second grace period before guided repair can proceed.
- A health response must match the configured runtime's release and mode before the
  connection can appear ready. Missing browser evidence is not reported as connected.
  Active browser turns belonging to the old installation still prevent an upgrade.
- Guided setup resumes when the shared connection monitor observes recovery, even when
  no browser or settings event arrives. Pause remains effective; it never authorizes
  another setup step. No second polling loop is introduced.
- Setup checks work, authentication, credentials, mode, profile, and configuration
  location again after installation and connector verification, before starting the
  next step. A changed snapshot cannot silently continue in a different workspace.
- The active Native2 inventory reports its claimed task's working directory and sandbox
  roots. Wrong tool contracts and wrong-computer paths receive distinct recovery guidance.
  Cached `read` or `exec_command` aliases are not substituted for the public bridge tools.

## Interface

The shared dark launcher redesign covers navigation, overview, setup, workspace tools,
settings, activity, browser controls, onboarding, help, updates, and dialogs. The persistent
setup panel provides one main setup action, saved milestones, contextual navigation,
and Pause/Continue. Live connection status is separated from saved configuration.

The local Connection check panel explains errors without storing or transmitting pasted
text. Local checks are not presented as proof of a successful ChatGPT project-tool call.

## Release integrity

Publication compares every uploaded asset, including the checksum manifest itself,
against the **original build's checksums**. Missing, extra, duplicate, or altered uploads
fail validation; checksums are never regenerated from remote digests to bless a mismatch.
The guided-workspace Electron checks run in Linux release builds as well as PR CI.
The temporary source-review bundle workflow is removed.

## Install and connect

Finish active work before upgrading. Choose the matching desktop asset: Apple Silicon
macOS arm64 DMG/ZIP, Intel macOS x64 DMG/ZIP, Windows x64 EXE, or Linux x64 AppImage.
Open Maria on the computer containing your project and select **Set up automatically**.
Saved credentials are reused. Complete any requested sign-in or account authorization,
then reopen Codex and open its model picker when prompted.

An already-open ChatGPT conversation can still hold an old connector schema or point to
another computer. This release does not silently reattach that external plugin. Check
**Workspace tools**, select the matching connector/tunnel, and use a fresh conversation
attached to the intended Codex task. A Windows connector cannot read a Mac `/Users` path.
Do not widen filesystem permissions or hand-edit release versions to hide that mismatch.

## Validation boundary

Release publication remains gated on verification, native packaging, and packaged-app
smoke checks on Windows, Linux, Apple Silicon macOS, and Intel macOS. Additional regressions
cover version/mode mismatches, bounded recovery, busy-to-ready continuation without IPC
events, Pause, post-step races, and uploaded-asset integrity.

The Electron UI suite uses an isolated in-memory launcher API, not a real account. Live
installed-Mac/ChatGPT/Codex project-tool acceptance, account-bound sign-in and connector
selection, and the remaining interactive gates in `docs/release-validation.md` remain
unexecuted for this candidate. The user's installed launcher and credentials were not
changed during source verification. This is why the release remains an alpha.

For a persistent failure, use **Activity → Export safe log**. Do not upload raw browser
state, account keys, tunnel credentials, or prompt contents. See `docs/CONNECTOR_RECOVERY.md`.

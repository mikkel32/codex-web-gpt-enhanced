# Maria WebGPT 5.13.10-alpha.1 — automatic setup and connection recovery

This is an **opt-in prerelease**, not a stable update. It combines the automatic setup work from PR #3 with PR #4's connection and recovery fixes, preserving both changes after resolving their conflicts.

## Improvements

- **Guided automatic setup:** start once from Home or Setup. Maria checks the existing installation, opens sign-in when needed, reuses saved tool credentials, waits for Codex catalog evidence, and runs final health checks. The setup intent survives navigation; pause stops new steps while allowing an in-progress transaction to finish safely.
- **Resilient local browser connection:** bounded, cancellable retries tolerate a cold browser and transient local transport failures. The descriptor is reread if its port changes. Connection and metadata-only checks now share one implementation, and Playwright connects directly to the verified browser WebSocket instead of repeating discovery.
- **Safer setup and rollback:** check local browser liveness before stopping a working runtime. Stop an incomplete replacement before restoring old files; never write old settings underneath a replacement that cannot stop. A restored older configuration remains explicitly upgrade-required, not falsely healthy. Development mode retains its separate version behavior.
- **Accurate completion and actionable errors:** setup is completed only after runtime readiness and final verification. The interface receives committed state immediately. Localized messages retain expandable, redacted details and offer a guarded retry only for appropriate failures; unsafe metadata, permission failures, and failed rollback do not offer a blind retry.

Authentication, account permissions, explicit model selection, loopback ownership checks, manual-mode boundaries, and exact runtime-version checks remain in place. No account keys, cookies, or tunnel identifiers are included in this release. Account credentials and permissions are not provisioned automatically.

## Installing and using this prerelease

Finish active Codex work before upgrading. Choose the desktop installer for your operating system from this release's Assets: Windows x64 EXE, macOS Apple Silicon or Intel DMG/ZIP, or Linux x64 AppImage. Runtime archives and checksum-verified installer scripts are also provided.

Open Maria and choose **Set up automatically**. Complete any requested ChatGPT sign-in, browser verification, or account permission prompt. Tool credentials are reused when present; otherwise enter them once in Tools. When prompted, reopen Codex and open its model picker so Maria can verify the catalog. The flow does not force-close Codex or silently approve account permissions.

If setup fails, keep Maria open, read the explanation, and retry only when offered after resolving the indicated issue. For a persistent browser transport failure, restart Maria and retry. A failed rollback requires review of **Activity → Export safe log** before further changes. Do not change release versions in config.json by hand, delete saved credentials, or upload raw browser state.

## Validation and known limitations

The merged source passed **817 core tests and 363 launcher tests** in an isolated Linux test environment, plus both TypeScript checks and the renderer production build. Release publication is gated by the repository's four-platform CI and release jobs, including native packaging, packaged-app smoke tests, Linux AppImage ABI checks, and macOS signature verification. Automated smoke tests are not live-account acceptance evidence.

**Not executed for this candidate:** the account-bound Windows 11 gate items 1–11, macOS items 2–10, and Linux interactive items 2–7 in docs/release-validation.md. These include clean/upgrade installation with a real account, authenticated model discovery, Browser-only and Full MCP turns, compaction, cancellation, session reuse, and account-level connector behavior. The user's currently installed launcher was not modified or tested during this change.

Because those manual checks remain outstanding, this build is published as an alpha and is not promoted to the stable/latest channel. Use it only where an opt-in test build is appropriate. For a failure, stop new work and use the safe-log recovery path above; report the OS, release version, clean-install or upgrade path, and the failed check without credentials or prompt contents.

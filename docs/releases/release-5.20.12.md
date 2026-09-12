# Maria WebGPT 5.20.12

This update improves context delivery and connection recovery while preserving the
active Codex task, its permissions, and completed work.

## Changes

- A mistyped context receipt now returns a bounded instruction to reread the
  already-served page in the same task. Ready-to-copy continuation arguments reduce
  transcription errors. Invalid receipts never acknowledge unread context.
- Rejected offsets and over-budget evidence reads no longer acknowledge the
  preceding page. Workspace tools and final completion remain gated until all
  required context is acknowledged successfully.
- Reconnecting an already-settled browser failure returns its terminal result
  instead of opening another stream or resending the prompt.
- Astra/Sol picker checks now run in the standard verification pipeline, including
  English/Danish, compact and expanded menus, and the final selection before Send.
- Native desktop-gateway regression coverage verifies task isolation, image-result
  preservation, and unchanged approval errors. Desktop work can use Codex's native
  Computer Use tools through Maria's existing gateway; no separate companion tunnel
  is required for that path.

The public native connector input schemas remain compatible with existing cached
catalogs. Updating Maria does not change ChatGPT permissions or remove separately
installed third-party plugins from other computers.

## Downloads

Use the installer matching your computer. Windows x64 uses
`codex-web-gpt-5.20.12-win-x64.exe`. Runtime archives are provided separately for
command-line installations. Verify downloads against `checksums.txt`.

## Verification and limitations

Live macOS checks exercised context-receipt recovery, native file changes and
commands, Astra model selection, and image delivery. Native desktop approval and
external ChatGPT tool-safety decisions remain enforced; this release does not
promise that every external tool request will be approved.

Automated platform build and package results must be verified before these assets
are published. Authenticated Windows account flows have not yet been re-run for
this release; automated Windows packaging is separate from that manual validation.

# Moonlight performance

The launcher is Electron and React. The SwiftUI Expert review principles were
applied to state ownership, stable row identity, narrow invalidation, and animation
scope; this release does not introduce a second native UI process.

## Runtime ownership

- Concurrent native starts share one pending operation, including readiness and failure cleanup.
- Concurrent guardian starts share an initialization handshake. A SQLite exclusive transaction provides cross-process ownership; the OS releases it even after SIGKILL. The existing marker remains for compatibility and diagnostics.
- An alive, recorded daemon or launcher owner requires no guardian HTTP health probe. Quiet guardian checks run every five seconds; failed recovery attempts back off.
- Adopted background processes are checked every two seconds instead of every 250 ms. Directly owned children retain immediate exit events.
- Repeated browser start requests for the same trace and helper await one tab allocation. A conflicting helper or conversation is rejected.
- Context hashing streams each message into the existing digest format. It avoids allocating an additional serialized copy of the complete transcript, while preserving saved cursor compatibility.

## Renderer work

- Activity subscribes to logs only while mounted. It batches live records at 100 ms, uses stable row IDs, and retains at most 300 rows.
- Identical browser snapshots do not invalidate the root view.
- The overview performs at most one connection request at a time, stops polling while hidden, resumes on visibility, and leaves unchanged values untouched.
- Moonlight uses opaque backgrounds without the sidebar blur or native window vibrancy layer. Decorative animation settles after entry. Motion uses transforms and opacity; sidebar geometry changes once per toggle.
- Reduced Motion is respected by CSS and Motion. Hidden windows pause CSS animations. Closed navigation is inert to keyboard and accessibility interaction.

## Reproduce the UI check

Run `bun run app:performance` after installing Playwright's Chromium for Testing.
The check serves the built renderer on loopback, injects synthetic IPC fixtures,
exercises navigation at 1180 and 700 pixels, verifies hidden-window polling,
replays 800 log/status events, and checks the 300-row Activity bound. It never opens
a real ChatGPT conversation or changes production configuration.

Set `MARIA_BASELINE_RENDERER` to a previous release's extracted renderer directory
for a before/after comparison. Screenshots and JSON results are written to the OS
temporary directory. No benchmark browser or server remains running afterward.

On this Mac, a 5.3-to-Moonlight comparison at 1180 pixels recorded renderer
ScriptDuration of 490 ms versus 4 ms and total TaskDuration of 617 ms versus 63 ms
for that replay. These are synthetic UI-work measurements, not general speed claims
or measurements of ChatGPT latency. The overview showed zero running animations
once settled; hidden-window checks verified no periodic connection requests.

Runtime tests separately exercise six simultaneous guardian processes, abrupt owner
exit and reacquisition, daemon recovery, and duplicate browser-start requests.

# Maria WebGPT 5.20.8

Fixes connector verification hanging for 30 seconds at the Temporary Chat
personalization preflight. The background maintenance view can expose a visible
Unpersonalized button while its native view does not accept pointer activation.
The old code clicked that button, then waited for a menu that never opened.

Personalization now opens its exact control with ArrowDown and activates its
owned radio choice with Enter. Localized setup and restoration use the same
keyboard path. Existing deadlines, menu ownership checks, state confirmation,
cancellation and rollback remain enforced. The fix changes no connector name,
tunnel, authentication setting, tool schema or approval policy.

A regression fixture models a background view that ignores pointer activation:
the released implementation fails and the keyboard implementation passes. The
personalization suite also checks localized controls, hydration, cancellation,
menu cleanup and restoration after a failed connector proof.

This hotfix is validated locally on macOS Apple Silicon. Other operating systems
require their own native package checks. Real connector verification and the
installed application's version must be reported separately from fixture tests.

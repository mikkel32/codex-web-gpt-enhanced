# Maria WebGPT 5.20.10

Fixes the missing browser-focus initialization in connector verification. The
Playwright connection uses noDefaults, and focus emulation was enabled only when
the caller supplied an explicit turn-surface identifier. Setup verification uses
the descriptor-owned maintenance page instead, so it skipped that initialization.
Its personalization and connector input could remain unresponsive in the background.

Every successful ownership lookup now initializes focus for that exact page,
including the default maintenance page. Other pages remain untouched, and a failed
focus setup closes the connection. No operating-system window is brought forward
by this change. Connector permissions, authentication and sandbox checks are unchanged.

Includes the keyboard personalization activation and short text-query improvements
from the preceding local test builds. A regression invokes the real connection
function with isolated transport doubles and checks both default maintenance and
explicit turn selection, unrelated-page isolation, and failed-connection cleanup.
The original branch fails that regression by never focusing the maintenance page.

Report installed live connector verification separately from offline tests and
package checks. This build is validated locally on macOS Apple Silicon.

# Maria WebGPT 5.7.1

This update makes verification and cooldown recovery more predictable while retaining the new 5.7 interface and motion system.

- Mixed verification, sign-in, rate-limit, and service failures during an active cooldown count as one incident. Background failures no longer repeatedly multiply the fallback wait. Explicit later server deadlines are still respected.
- View ChatGPT keeps the page that needs your attention, even when another tab reports a secondary failure. A verification request cannot be downgraded to a sign-in or service message.
- Explicit Cloudflare challenge responses are recognized by the documented challenge header across HTTP status codes. Ordinary permission errors remain distinct from verification.
- Cancelled or invalidated sends leave the queue before consuming a wait. The final Send handoff checks the current helper, interaction mode, and pause state again.

Resume enables a new request; stopped turns are never replayed automatically. These changes improve local handling and do not guarantee how an external service classifies a session.

Update through Maria's updater when convenient.

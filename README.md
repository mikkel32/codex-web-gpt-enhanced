<p align="center"><img src="launcher/assets/icon.png" width="88" alt="Maria WebGPT" /></p>

# Maria WebGPT

[![Release](https://img.shields.io/github/v/release/mikkel32/codex-web-gpt-enhanced)](https://github.com/mikkel32/codex-web-gpt-enhanced/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

[English](README.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md)

**ChatGPT Web and native Codex, in one workspace.**

Maria is a desktop companion that connects your own ChatGPT session to Codex.
Keep native Codex models available, work with files and tools in the current task,
and continue in the same conversation across follow-ups.

## Download

**[Get the latest stable release](https://github.com/mikkel32/codex-web-gpt-enhanced/releases/latest)**

| Platform | Choose this package |
| --- | --- |
| macOS · Apple Silicon | `mac-arm64.dmg` or `mac-arm64.zip` |
| macOS · Intel | `mac-x64.dmg` or `mac-x64.zip` |
| Windows · x64 | `win-x64.exe` |
| Linux · x64 | `linux-x64.AppImage` |

Packages include the runtime. Existing users can install through **Updates** in
Maria after active tasks finish. Downloads are verified against release checksums.
See the [release notes](docs/releases/README.md) for changes and validation limits.

## Get started

1. Open Maria and choose **Set up automatically** in Overview.
2. Sign in to ChatGPT and follow the model setup. Fully restart Codex when prompted.
3. Select a native Codex model or a **Maria Web** model in your existing Codex task.

Local tools in Web mode require the Full harness connector and **Verify runtime**.
The [user guide](docs/user-guide.md) covers setup, sign-in, updates and shortcuts.

## Choose how you work

| Mode | Who handles the browser? | Tools |
| --- | --- | --- |
| Native Codex | No ChatGPT browser required | Native Codex tools |
| Automatic Web | Maria prepares and sends the task | Browser-only or Full harness |
| Manual Web | You choose the model and send the prepared prompt | The displayed Manual connector |

Model availability follows your account. Maria keeps task ownership and permissions
explicit, and does not automatically resend an uncertain submission.

## When a task needs attention

**Blank Browser while Codex still progresses:** choose **Restore view** to redraw
the current page without reloading or resending. **Interrupted task:** inspect the
saved chat, choose **I reviewed this chat** when available, then continue in the
original Codex task. See [Troubleshooting](TROUBLESHOOTING.md).

## Build and contribute

Development requires Bun 1.4.0. Source launches use an isolated DEV profile.

```bash
git clone https://github.com/mikkel32/codex-web-gpt-enhanced.git
cd codex-web-gpt-enhanced
bun install --frozen-lockfile
bun install --frozen-lockfile --cwd launcher
bun run app
```

Run appropriate checks locally; use `bun run verify` for a release candidate.
GitHub CI and Release jobs are explicit opt-in workflows, never automatic on a push.
The [local verification guide](docs/development/local-verification.md) covers checks and
publication; the [development guide](docs/development/README.md) maps the repository.

## Explore

[Documentation](docs/README.md) · [Security](SECURITY.md) ·
[Report an issue](https://github.com/mikkel32/codex-web-gpt-enhanced/issues/new/choose)

Built by **Mikkel & Maria**. [MIT license](LICENSE). Based on
[miuuyy/codex-chatgpt-web](https://github.com/miuuyy/codex-chatgpt-web).

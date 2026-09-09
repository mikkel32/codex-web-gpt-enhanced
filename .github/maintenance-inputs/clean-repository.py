"""Reorganize documentation from the verified 5.20.3 source; no runtime edits."""
from pathlib import Path
import os
import posixpath
import re
import subprocess
from urllib.parse import unquote, urlsplit

root = Path.cwd()
assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip() == '14a52cd941431e6e952c140706301fef044f860f'
assert not subprocess.check_output(['git', 'status', '--porcelain'], text=True).strip()
files = subprocess.check_output(['git', 'ls-files'], text=True).splitlines()
original = {p: Path(p).read_text() for p in files if p.endswith('.md')}
mapping = {}
research = {'ASTRA_ROUTING.md', 'CHATGPT_WEB_OBSERVATIONS.md', 'CONTINUITY_RESEARCH.md', 'capabilities-and-evidence.md'}
for path in original:
    if not path.startswith('docs/'):
        continue
    name = Path(path).name
    group = ('development' if name in {'dev-chat.md', 'release-validation.md'} else
             'releases' if name.startswith('release-') or name == 'enhanced-release.md' else
             'research' if name in research else 'reference')
    mapping[path] = f'docs/{group}/{name.lower().replace("_", "-")}'

def relocate_links(text, old_path, new_path):
    def link(match):
        target = match.group(2)
        parsed = urlsplit(target)
        if parsed.scheme or target.startswith(('#', '//')):
            return match.group(0)
        decoded = unquote(parsed.path)
        absolute = posixpath.normpath(posixpath.join(posixpath.dirname(old_path), decoded))
        if absolute not in files and not Path(absolute).exists():
            return match.group(0)
        destination = mapping.get(absolute, absolute)
        relative = posixpath.relpath(destination, posixpath.dirname(new_path) or '.')
        if parsed.fragment:
            relative += '#' + parsed.fragment
        return match.group(1) + relative + match.group(3)
    text = re.sub(r'(\]\()([^\s)]+)(\))', link, text)
    for old, new in mapping.items():
        text = text.replace('https://github.com/mikkel32/codex-web-gpt-enhanced/blob/main/' + old,
                            'https://github.com/mikkel32/codex-web-gpt-enhanced/blob/main/' + new)
        text = text.replace('`' + old + '`', '`' + new + '`')
    return text

for old, text in original.items():
    new = mapping.get(old, old)
    Path(new).parent.mkdir(parents=True, exist_ok=True)
    Path(new).write_text(relocate_links(text, old, new))
for old in mapping:
    Path(old).unlink()

guide = original['README.md'].split('## Start here\n', 1)[1].split('## Our project\n', 1)[0]
guide = '# User guide\n\n[Documentation](README.md) · [Troubleshooting](../TROUBLESHOOTING.md)\n\n## First setup\n' + guide
guide = relocate_links(guide, 'README.md', 'docs/user-guide.md')
# The two links added above already use the new location.
guide = guide.replace('[Documentation](docs/README.md)', '[Documentation](README.md)')
Path('docs/user-guide.md').write_text(guide)

header = '''<p align="center"><img src="launcher/assets/icon.png" width="88" alt="Maria WebGPT" /></p>

# Maria WebGPT

[![CI](https://github.com/mikkel32/codex-web-gpt-enhanced/actions/workflows/ci.yml/badge.svg)](https://github.com/mikkel32/codex-web-gpt-enhanced/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/mikkel32/codex-web-gpt-enhanced)](https://github.com/mikkel32/codex-web-gpt-enhanced/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

[English](README.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md)

'''
commands = '''```bash
git clone https://github.com/mikkel32/codex-web-gpt-enhanced.git
cd codex-web-gpt-enhanced
bun install --frozen-lockfile
bun install --frozen-lockfile --cwd launcher
bun run app
```
'''
readmes = {
'README.md': '''**ChatGPT Web and native Codex, in one workspace.**

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

{commands}

Run `bun run verify` before proposing code changes. The [development guide](docs/development/README.md)
maps the repository and its checks; [Contributing](CONTRIBUTING.md) explains the review process.

## Explore

[Documentation](docs/README.md) · [Security](SECURITY.md) ·
[Report an issue](https://github.com/mikkel32/codex-web-gpt-enhanced/issues/new/choose)

Built by **Mikkel & Maria**. [MIT license](LICENSE). Based on
[miuuyy/codex-chatgpt-web](https://github.com/miuuyy/codex-chatgpt-web).
''',
'README.ja.md': '''**ChatGPT Web とネイティブ Codex を、ひとつのワークスペースで。**

Maria は、自分の ChatGPT セッションを Codex に接続するデスクトップアプリです。
ネイティブ Codex モデルを引き続き利用しながら、現在のタスクのファイルとツールを使い、
追加の依頼も同じ会話で続けられます。

## ダウンロード

**[最新の安定版を入手](https://github.com/mikkel32/codex-web-gpt-enhanced/releases/latest)**

| プラットフォーム | パッケージ |
| --- | --- |
| macOS · Apple Silicon | `mac-arm64.dmg` / `mac-arm64.zip` |
| macOS · Intel | `mac-x64.dmg` / `mac-x64.zip` |
| Windows · x64 | `win-x64.exe` |
| Linux · x64 | `linux-x64.AppImage` |

ランタイムは同梱されています。利用中のタスクが終了してから、Maria の **Updates** で更新できます。
ダウンロードはリリースのチェックサムで検証します。
変更点と検証範囲は [リリースノート](docs/releases/README.md) を参照してください。

## はじめに

1. Maria を開き、Overview の **自動でセットアップ** を選びます。
2. ChatGPT にサインインしてモデルの設定を行い、案内に従って Codex を完全に再起動します。
3. 既存の Codex タスクで、ネイティブモデルまたは **Maria Web** モデルを選びます。

Web モードでローカルツールを使うには、Full harness コネクターと **Verify runtime** が必要です。
設定、サインイン、更新、ショートカットは [ユーザーガイド](docs/user-guide.md) にまとめています。

## 作業モード

| モード | ブラウザー操作 | ツール |
| --- | --- | --- |
| ネイティブ Codex | ChatGPT ブラウザーは不要 | Codex のネイティブツール |
| Automatic Web | Maria がタスクを準備して送信 | Browser-only / Full harness |
| Manual Web | 自分でモデルを選択し、準備済みのプロンプトを送信 | 表示された Manual コネクター |

利用できるモデルはアカウントによって異なります。タスクの所有関係と権限は明示的に保持され、
結果が不確かな送信を自動で繰り返すことはありません。

## 問題が起きたとき

Codex が進行中なのに Browser が空白の場合は **表示を復元** を選びます。再読み込みや再送はしません。
中断したタスクでは保存されたチャットを確認し、表示された **このチャットを確認しました** を選んでから、
元の Codex タスクを続けてください。[トラブルシューティング](TROUBLESHOOTING.md) に詳しい手順があります。

## 開発と貢献

開発には Bun 1.4.0 が必要です。ソースからの起動には分離された DEV プロファイルを使います。

{commands}

コードの変更を提案する前に `bun run verify` を実行してください。
[開発ガイド](docs/development/README.md) で構成と検証手順を、[貢献ガイド](CONTRIBUTING.md) でレビュー方針を確認できます。

## 関連情報

[ドキュメント](docs/README.md) · [セキュリティ](SECURITY.md) ·
[問題を報告](https://github.com/mikkel32/codex-web-gpt-enhanced/issues/new/choose)

**Mikkel & Maria** による開発。[MIT ライセンス](LICENSE)。
[miuuyy/codex-chatgpt-web](https://github.com/miuuyy/codex-chatgpt-web) を基にしています。
''',
'README.zh-CN.md': '''**在同一个工作区中使用 ChatGPT Web 和原生 Codex。**

Maria 是一款将你自己的 ChatGPT 会话连接到 Codex 的桌面应用。
保留原生 Codex 模型，使用当前任务的文件和工具，并在同一对话中继续后续工作。

## 下载

**[获取最新稳定版](https://github.com/mikkel32/codex-web-gpt-enhanced/releases/latest)**

| 平台 | 安装包 |
| --- | --- |
| macOS · Apple Silicon | `mac-arm64.dmg` 或 `mac-arm64.zip` |
| macOS · Intel | `mac-x64.dmg` 或 `mac-x64.zip` |
| Windows · x64 | `win-x64.exe` |
| Linux · x64 | `linux-x64.AppImage` |

安装包已包含运行时。现有用户可在活动任务结束后，通过 Maria 的 **Updates** 更新。
下载内容会根据发布的校验和进行验证。
变更和验证范围请查看 [发布说明](docs/releases/README.md)。

## 开始使用

1. 打开 Maria，在 Overview 中选择 **自动完成设置**。
2. 登录 ChatGPT 并完成模型设置，按提示完全重启 Codex。
3. 在现有 Codex 任务中选择原生模型或 **Maria Web** 模型。

Web 模式下的本地工具需要 Full harness 连接器，并通过 **Verify runtime** 验证。
[用户指南](docs/user-guide.md) 包含设置、登录、更新和快捷键的说明。

## 选择工作方式

| 模式 | 谁操作浏览器？ | 工具 |
| --- | --- | --- |
| 原生 Codex | 不需要 ChatGPT 浏览器 | 原生 Codex 工具 |
| Automatic Web | Maria 准备并发送任务 | Browser-only 或 Full harness |
| Manual Web | 你选择模型并发送准备好的提示词 | 界面显示的 Manual 连接器 |

可用模型取决于你的账户。Maria 明确保留任务归属和权限，不会自动重发结果不确定的请求。

## 任务需要处理时

Codex 仍在更新但 Browser 一片空白时，选择 **恢复显示**，无需重新加载或重发。
任务中断时，先检查保存的聊天，选择可用的 **我已检查此聊天**，然后回到原 Codex 任务继续。
详细步骤见 [故障排查](TROUBLESHOOTING.md)。

## 开发与贡献

开发需要 Bun 1.4.0。源码启动使用独立的 DEV 配置。

{commands}

提出代码变更前请运行 `bun run verify`。
[开发指南](docs/development/README.md) 介绍仓库结构和检查流程；[贡献指南](CONTRIBUTING.md) 介绍审核方式。

## 更多信息

[文档](docs/README.md) · [安全](SECURITY.md) ·
[报告问题](https://github.com/mikkel32/codex-web-gpt-enhanced/issues/new/choose)

由 **Mikkel & Maria** 开发。[MIT 许可证](LICENSE)。基于
[miuuyy/codex-chatgpt-web](https://github.com/miuuyy/codex-chatgpt-web)。
'''}
for path, text in readmes.items():
    Path(path).write_text(header + text.replace('{commands}', commands.strip()))

for group, title, description in [
    ('reference', 'Technical reference', 'Implementation contracts and architecture. For everyday setup, start with the [user guide](../user-guide.md).'),
    ('research', 'Research and observations', 'Dated investigations and implementation evidence. These records describe their observed versions and accounts, not guarantees about current ChatGPT behavior.'),
    ('releases', 'Release notes', 'Source release notes, including historical prereleases. Use [GitHub Releases](https://github.com/mikkel32/codex-web-gpt-enhanced/releases) to check which packages were actually published.')]:
    entries = []
    for p in sorted(Path('docs', group).glob('*.md'), key=lambda p: [int(t) if t.isdigit() else t for t in re.split('(\d+)', p.name)], reverse=group == 'releases'):
        title_line = p.read_text().splitlines()[0].lstrip('# ')
        entries.append(f'- [{title_line}]({p.name})')
    Path('docs', group, 'README.md').write_text(f'# {title}\n\n[Documentation](../README.md)\n\n{description}\n\n' + '\n'.join(entries) + '\n')

Path('docs/README.md').write_text('''# Documentation

[Project home](../README.md) · [Latest stable release](https://github.com/mikkel32/codex-web-gpt-enhanced/releases/latest)

## Use Maria

| Start here | What you will find |
| --- | --- |
| [User guide](user-guide.md) | Setup, modes, sign-in, updates, context and closing the app |
| [Troubleshooting](../TROUBLESHOOTING.md) | Recovery by symptom, including blank views and interrupted tasks |
| [Connector recovery](reference/connector-recovery.md) | Tool discovery, workspace identity and verification |
| [Release notes](releases/README.md) | Version history, changes and validation limits |

## Build and understand Maria

| Guide | Scope |
| --- | --- |
| [Development](development/README.md) | Repository map, isolated development, tests and packaging |
| [Technical reference](reference/README.md) | Architecture, ownership, context, access and performance |
| [Research archive](research/README.md) | Dated observations and experiments |
| [Contributing](../CONTRIBUTING.md) | Review expectations and completion criteria |
| [Security](../SECURITY.md) | Reporting and trust boundaries |

The front page is an introduction; reference documents explain the implementation.
Research records and old release notes preserve history and should not be read as
current product guarantees. Published installers live in GitHub Releases, not in source folders.
''')
Path('docs/development/README.md').write_text('''# Development

[Documentation](../README.md) · [Contributing](../../CONTRIBUTING.md)

## Repository map

| Path | Responsibility |
| --- | --- |
| `src/` | Responses bridge, Codex integration, runtime lifecycle and browser adapter |
| `launcher/electron/` | Desktop lifecycle, browser ownership, persistence and updater |
| `launcher/src/` | React interface and translated copy |
| `browser-connector/` | Browser sign-in connector source |
| `tests/`, `launcher/tests/` | Runtime and launcher regression coverage |
| `scripts/`, `launcher/scripts/` | Development, verification and native packaging |
| `docs/reference/` | Architecture and implementation contracts |
| `docs/research/` | Historical investigations and observed evidence |
| `docs/releases/` | Release notes; binaries remain in GitHub Releases |
| `.github/` | CI, release automation and contribution templates |

## Local work

Use the exact Bun version in `package.json` (1.4.0 for this source).
Install dependencies with `bun install --frozen-lockfile` in the root and `launcher/`.
`bun run app` starts an isolated DEV profile; do not connect production services
to source files you are editing. See the [DEV chat harness](dev-chat.md) for browser
and MCP development.

## Checks

| Command | Purpose |
| --- | --- |
| `bun run verify` | Audits, types, tests, renderer fixtures and runtime smoke |
| `bun run test` | Isolated core test runner |
| `bun run launcher:test` | Launcher regression suite |
| `bun run check-version` | Synchronized source and runtime version metadata |
| `bun run app:package` | Package for the current operating system |
| `bun run app:smoke` | Test the packaged application |
| `bun run app:performance` | Isolated UI performance check |

Package on the matching operating system. CI covers Apple Silicon Mac, Intel Mac,
Windows x64 and Linux x64. Synthetic browser fixtures and package smoke checks
do not replace account-bound validation; record exactly what ran.

## Documentation and releases

Keep English, Japanese and Chinese README commands and links aligned. Put new
release notes in `docs/releases/release-VERSION.md`. Use the documentation index
for navigation instead of appending release announcements to the front page.

The [release validation guide](release-validation.md) separates automated and live
checks. An already published version is not rebuilt or retagged by later docs
changes. A new version still requires the complete release matrix and asset checks.
See [fork maintenance](../../FORK.md) for upstream comparison and release ownership.
''')

Path('CONTRIBUTING.md').write_text('''# Contributing

Maria WebGPT is maintained by Mikkel & Maria. Focused fixes, regression coverage,
documentation improvements and platform fixes are welcome. Discuss large features
or architecture changes in an issue before implementation.

## Before you start

Read the [development guide](docs/development/README.md) for the repository map,
DEV isolation and commands. Check existing issues and pull requests. Bug reports
should include a reproducible symptom and a redacted export from Activity, never
raw browser state, credentials or private conversation contents.

## Make the change reviewable

Describe the problem, the resulting behavior and the evidence. Keep unrelated
refactoring out of a fix. Add a regression test when behavior changes; for docs-only
work, check links, commands and translated README parity instead of inventing
runtime tests. Report unexecuted checks explicitly.

Run `bun run verify` for code changes. For browser changes, use observed DOM evidence
and a reproducible fixture. For execution changes, separately record validation
through an installed Codex integration. Package changes need the affected native
platform's smoke checks; CI alone is not proof of a signed-in account flow.

## Preserve these contracts

- Keep model, route, effort, connector and task identity explicit. Never silently
  switch models or replay an uncertain submitted prompt.
- Full harness tools belong to the active Codex task and its permissions.
  Browser-only and Manual mode must retain their separate boundaries.
- Preserve user changes and saved conversations. Stop with a useful error when
  success cannot be established.
- Keep browser sessions, keys, raw logs, local paths and generated build artifacts
  out of commits. Review [Security](SECURITY.md) before sharing diagnostic evidence.

## Close the loop

Target `main` unless the PR genuinely depends on another active PR. Name that
dependency when stacking. After a release, resolve PRs already included through
ancestry or an equivalent published tree, and link the integration evidence.
Remove merged branches; preserve unique historical commits before archiving a
superseded branch. Never merge obsolete release metadata just to close a PR.

Use [release notes](docs/releases/README.md) for version history and the
[release validation guide](docs/development/release-validation.md) for release checks.
''')
Path('.github/PULL_REQUEST_TEMPLATE.md').write_text('''## Problem and result

<!-- Describe the user-visible problem and the resulting behavior. Link the issue or dependency. -->

## Verification

<!-- State the commands, platforms and results actually checked. For docs-only changes,
check links and translated README parity. Mark unexecuted checks as not run. -->

## Review checklist

- [ ] The change is focused and follows [Contributing](../CONTRIBUTING.md).
- [ ] Behavior changes have relevant regression coverage.
- [ ] Conversation identity, model selection and task permissions are preserved.
- [ ] No credentials, raw logs, private paths or generated packages are committed.

## Dependencies and release impact

<!-- Default base: main. Name any stacked PR, migration, version change or release requirement.
Distinguish isolated fixture results from installed, signed-in validation. -->
''')
trouble = Path('TROUBLESHOOTING.md').read_text()
trouble = trouble.replace('1. Install the [latest release](https://github.com/mikkel32/codex-web-gpt-enhanced/releases/latest). Quit\n   **Maria WebGPT** before running the installer again; updating preserves its private ChatGPT\n   profile and launcher configuration.',
    '1. Check the installed version against the [latest stable release](https://github.com/mikkel32/codex-web-gpt-enhanced/releases/latest).\n   Finish active tasks before updating. Do not restart the app to diagnose a task that is still progressing.')
trouble = trouble.replace('- Retry once in a fresh Codex task. State whether the fresh task works and whether the failure is\n  consistent.', '- Inspect the saved ChatGPT conversation and any completed actions. Use **I reviewed this chat**\n  when offered, then continue in the original Codex task. Do not replay an uncertain request.')
trouble = trouble.replace('First-class external-router composition is\ntracked in [#205](https://github.com/mikkel32/codex-web-gpt-enhanced/issues/205), but is not supported today.',
    'Use one owner for the route; preserve its configuration journal when changing integrations.')
trouble = re.sub(r'If tool calls work until native Codex quota is exhausted.*?after the Web tool call already completed\.\n',
    'If automatic approval review rejects a tool call, preserve the exact rejection and check the\ncurrent Codex review configuration. A tool rejection is not evidence that the browser lost the conversation.\n', trouble, flags=re.S)
intro = '''## Choose the symptom

| Symptom | First action |
| --- | --- |
| Browser is blank or says Loading while Codex still updates | Use **Restore view**. This redraws the existing page without navigation or resending. |
| Previous turn needs attention | Inspect the saved chat, choose **I reviewed this chat**, then continue in the original task. |
| Tool not found or wrong workspace | Follow [connector recovery](docs/reference/connector-recovery.md); verify the exact runtime and tool catalog. |
| Sign-in, verification or rate limit | Complete the required action and cooldown; resume without replaying the interrupted prompt. |

Background viewport sizing and idle-page reclamation reduce work; a permanently
blank foreground view is not an intentional memory-saving mode.

'''
trouble = trouble.replace('## The first five minutes\n', intro + '## The first five minutes\n')
Path('TROUBLESHOOTING.md').write_text(trouble)
security = Path('SECURITY.md').read_text()
security = security.replace('Once the GitHub repository is public, use its private Security Advisory reporting flow. Until that\nis enabled, do not publish a proof of concept that exposes credentials or arbitrary local tool\nexecution; contact the maintainer privately through the GitHub account listed by the repository.',
    'Use GitHub private vulnerability reporting when it is available on the repository Security tab.\nOtherwise contact the maintainer privately through the GitHub account listed by the repository.\nDo not place credential-bearing reports or private conversation data in public issues.')
Path('SECURITY.md').write_text(security)
config = Path('.github/ISSUE_TEMPLATE/config.yml').read_text()
config = re.sub(r'  - name: Questions and usage discussions\n.*?(?=  - name:)',
    '  - name: User guide\n    url: https://github.com/mikkel32/codex-web-gpt-enhanced/blob/main/docs/user-guide.md\n    about: Setup, interaction modes, updates and recovery.\n', config, flags=re.S)
Path('.github/ISSUE_TEMPLATE/config.yml').write_text(config)
feature = Path('.github/ISSUE_TEMPLATE/feature-request.yml')
feature.write_text(feature.read_text().replace('existing issues and Discussions', 'existing issues and pull requests'))
ignore = Path('.gitignore')
ignore.write_text(ignore.read_text() + '\n# Local verification worktrees and scratch evidence\n/validation/\n/.verification/\n')
workflow = Path('.github/workflows/release.yml').read_text()
workflow = workflow.replace('notes_file="docs/release-${RELEASE_TAG#v}.md"', 'notes_file="docs/releases/release-${RELEASE_TAG#v}.md"')
lookup = '          existing_draft="$(gh release view "$tag" --repo "$GITHUB_REPOSITORY" --json isDraft --jq \'.isDraft\' 2>/dev/null || true)"\n'
assert workflow.count(lookup) == 1
workflow = workflow.replace(lookup, '')
workflow = workflow.replace('          publish=true\n', '          publish=true\n' + lookup)
workflow = workflow.replace('              test "$tagged_sha" = "$source_sha"\n',
    '              if [ "$existing_draft" = false ]; then\n                git merge-base --is-ancestor "$tagged_sha" "$source_sha"\n              else\n                test "$tagged_sha" = "$source_sha"\n              fi\n', 1)
Path('.github/workflows/release.yml').write_text(workflow)
print('DOCUMENTATION_REORGANIZED', len(mapping), 'documents; runtime source unchanged')

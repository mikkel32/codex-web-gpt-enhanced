<p align="center"><img src="launcher/assets/icon.png" width="88" alt="Maria WebGPT" /></p>

# Maria WebGPT

[![CI](https://github.com/mikkel32/codex-web-gpt-enhanced/actions/workflows/ci.yml/badge.svg)](https://github.com/mikkel32/codex-web-gpt-enhanced/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/mikkel32/codex-web-gpt-enhanced)](https://github.com/mikkel32/codex-web-gpt-enhanced/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

[English](README.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md)

**在同一个工作区中使用 ChatGPT Web 和原生 Codex。**

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

```bash
git clone https://github.com/mikkel32/codex-web-gpt-enhanced.git
cd codex-web-gpt-enhanced
bun install --frozen-lockfile
bun install --frozen-lockfile --cwd launcher
bun run app
```

提出代码变更前请运行 `bun run verify`。
[开发指南](docs/development/README.md) 介绍仓库结构和检查流程；[贡献指南](CONTRIBUTING.md) 介绍审核方式。

## 更多信息

[文档](docs/README.md) · [安全](SECURITY.md) ·
[报告问题](https://github.com/mikkel32/codex-web-gpt-enhanced/issues/new/choose)

由 **Mikkel & Maria** 开发。[MIT 许可证](LICENSE)。基于
[miuuyy/codex-chatgpt-web](https://github.com/miuuyy/codex-chatgpt-web)。

<p align="center"><img src="launcher/assets/icon.png" width="88" alt="Maria WebGPT" /></p>

# Maria WebGPT

[![CI](https://github.com/mikkel32/codex-web-gpt-enhanced/actions/workflows/ci.yml/badge.svg)](https://github.com/mikkel32/codex-web-gpt-enhanced/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/mikkel32/codex-web-gpt-enhanced)](https://github.com/mikkel32/codex-web-gpt-enhanced/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

[English](README.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md)

**ChatGPT Web とネイティブ Codex を、ひとつのワークスペースで。**

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

```bash
git clone https://github.com/mikkel32/codex-web-gpt-enhanced.git
cd codex-web-gpt-enhanced
bun install --frozen-lockfile
bun install --frozen-lockfile --cwd launcher
bun run app
```

コードの変更を提案する前に `bun run verify` を実行してください。
[開発ガイド](docs/development/README.md) で構成と検証手順を、[貢献ガイド](CONTRIBUTING.md) でレビュー方針を確認できます。

## 関連情報

[ドキュメント](docs/README.md) · [セキュリティ](SECURITY.md) ·
[問題を報告](https://github.com/mikkel32/codex-web-gpt-enhanced/issues/new/choose)

**Mikkel & Maria** による開発。[MIT ライセンス](LICENSE)。
[miuuyy/codex-chatgpt-web](https://github.com/miuuyy/codex-chatgpt-web) を基にしています。

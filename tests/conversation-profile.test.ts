import { afterAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { conversationProfileNamespace } from "../src/adapters/chatgpt-web/conversation-profile";
import { ChatGptBrowserWorker } from "../src/adapters/chatgpt-web/browser-worker";
import type { CodexProviderConfig } from "../src/types";

const root = mkdtempSync(join(tmpdir(), "cgw-profiles-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
function provider(name: string): CodexProviderConfig {
  return { adapter: "chatgpt-web", baseUrl: "browser://chatgpt", chatgptWeb: {
    browserHost: "launcher", browserHostDescriptorPath: join(root, name, "launcher.json"),
    localToolsEnabled: true, appName: "Codex Native2", headed: true,
  } };
}

test("first binding preserves legacy cursors while operational settings select a new worker only", () => {
  const initial = provider("settings");
  const legacy = createHash("sha256").update(JSON.stringify({ baseUrl: initial.baseUrl, chatgptWeb: initial.chatgptWeb })).digest("hex");
  expect(conversationProfileNamespace(initial)).toBe(legacy);
  const updated = { ...initial, chatgptWeb: { ...initial.chatgptWeb, headed: false, experimentalBiggerContext: true,
    autoApproveToolCalls: true, turnTimeoutMs: 30_000, stallTimeoutSec: 600, proAvailable: true } };
  expect(conversationProfileNamespace(updated)).toBe(legacy);
  expect(ChatGptBrowserWorker.forProvider(updated)).not.toBe(ChatGptBrowserWorker.forProvider(initial));
  const files = readdirSync(join(root, "settings", "conversation-profiles"));
  expect(files).toHaveLength(1);
  expect(JSON.parse(readFileSync(join(root, "settings", "conversation-profiles", files[0]!), "utf8")).namespace).toBe(legacy);
});

test("different browser, connector, and manual identities never share a profile", () => {
  const initial = provider("isolation");
  const first = conversationProfileNamespace(initial);
  for (const settings of [{ appName: "Another connector" }, { browserInteractionMode: "manual" as const },
    { browserHostDescriptorPath: join(root, "other", "launcher.json") }, { storageStatePath: join(root, "account.json") }]) {
    expect(conversationProfileNamespace({ ...initial, chatgptWeb: { ...initial.chatgptWeb, ...settings } })).not.toBe(first);
  }
  expect(conversationProfileNamespace({ ...initial, baseUrl: "browser://other" })).not.toBe(first);
});

test("damaged binding fails closed instead of starting a new conversation", () => {
  const initial = provider("damaged");
  conversationProfileNamespace(initial);
  const directory = join(root, "damaged", "conversation-profiles");
  const path = join(directory, readdirSync(directory)[0]!);
  writeFileSync(path, "{broken");
  expect(() => conversationProfileNamespace(initial)).toThrow("restore its binding");
  expect(readdirSync(directory)).toHaveLength(1);
});

test("concurrent processes changing preferences adopt one complete persistent binding", async () => {
  const initial = provider("concurrent");
  const modulePath = fileURLToPath(new URL("../src/adapters/chatgpt-web/conversation-profile.ts", import.meta.url));
  const children = Array.from({ length: 6 }, (_, index) => Bun.spawn([process.execPath, "-e",
    `import { conversationProfileNamespace } from ${JSON.stringify(modulePath)}; console.log(conversationProfileNamespace(JSON.parse(process.argv[1])));`,
    JSON.stringify({ ...initial, chatgptWeb: { ...initial.chatgptWeb, turnTimeoutMs: 30_000 + index } }),
  ], { stdout: "pipe", stderr: "pipe" }));
  const outcomes = await Promise.all(children.map(async child => ({ code: await child.exited, output: (await new Response(child.stdout).text()).trim(), error: await new Response(child.stderr).text() })));
  expect(outcomes.map(item => item.code)).toEqual([0, 0, 0, 0, 0, 0]);
  expect(outcomes.map(item => item.error)).toEqual(["", "", "", "", "", ""]);
  expect(new Set(outcomes.map(item => item.output)).size).toBe(1);
  expect(conversationProfileNamespace(initial)).toBe(outcomes[0]!.output);
  expect(readdirSync(join(root, "concurrent", "conversation-profiles"))).toHaveLength(1);
});

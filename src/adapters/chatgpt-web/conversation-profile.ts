import { createHash, randomUUID } from "node:crypto";
import { closeSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { expandUserPath } from "../../config";
import type { CodexProviderConfig } from "../../types";

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** Adopt the existing namespace once; operational preferences must not create a new chat. */
export function conversationProfileNamespace(provider: CodexProviderConfig): string {
  const settings = provider.chatgptWeb ?? {};
  const legacy = digest({ baseUrl: provider.baseUrl, chatgptWeb: settings });
  if (settings.browserHost !== "launcher" || !settings.localToolsEnabled || !settings.browserHostDescriptorPath) return legacy;
  const descriptor = resolve(expandUserPath(settings.browserHostDescriptorPath));
  const scope = digest({
    baseUrl: provider.baseUrl,
    descriptor,
    appName: settings.appName ?? "",
    interaction: settings.browserInteractionMode ?? "automatic",
    storageState: settings.storageStatePath ? resolve(expandUserPath(settings.storageStatePath)) : "",
  });
  const directory = join(dirname(descriptor), "conversation-profiles");
  const path = join(directory, `${scope}.json`);
  const read = (): string | undefined => {
    let source: string;
    try { source = readFileSync(path, "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    try {
      const record = JSON.parse(source);
      if (record.version === 1 && record.scope === scope && typeof record.namespace === "string" && /^[a-f0-9]{64}$/.test(record.namespace)) return record.namespace;
    } catch { /* A damaged binding must never select a replacement conversation. */ }
    throw new Error("Saved ChatGPT conversation profile is invalid; restore its binding before continuing this task");
  };
  const existing = read();
  if (existing) return existing;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = join(directory, `.${scope}.${randomUUID()}.tmp`);
  const fd = openSync(temporary, "wx", 0o600);
  try {
    try {
      writeFileSync(fd, JSON.stringify({ version: 1, scope, namespace: legacy }));
      fsyncSync(fd);
    } finally { closeSync(fd); }
    // Hard-link publication is complete and first-writer-wins, including across processes.
    try { linkSync(temporary, path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    const published = read();
    if (!published) throw new Error("ChatGPT conversation profile disappeared during publication");
    return published;
  } finally { unlinkSync(temporary); }
}

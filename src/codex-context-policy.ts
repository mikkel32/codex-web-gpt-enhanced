import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const keys = ["model_context_window", "model_auto_compact_token_limit"] as const;
type Key = typeof keys[number];
interface Entry { rawLine: string; value: number }
export interface NativeContextPolicy {
  version: 1;
  configPath: string;
  entries: Partial<Record<Key, Entry>>;
}
const marker = (key: Key) => `# Managed by codex-chatgpt-web: ${key} is preserved for native models in the model catalog.`;

function parseAssignment(line: string, key: Key): number | undefined {
  const match = new RegExp(`^\\s*${key}\\s*=\\s*([1-9](?:_?[0-9])*)(?:\\s*#.*)?\\s*$`).exec(line);
  if (!match) return undefined;
  const value = Number(match[1]!.replaceAll("_", ""));
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${key} must be a positive integer`);
  return value;
}

export function readNativeContextPolicy(path: string, configPath: string): NativeContextPolicy {
  if (!existsSync(path)) return { version: 1, configPath, entries: {} };
  if (statSync(path).size > 16_384) throw new Error("Native context preference record exceeds its size limit");
  const value = JSON.parse(readFileSync(path, "utf8"));
  if (value?.version !== 1 || typeof value.configPath !== "string" || resolve(value.configPath) !== resolve(configPath)
    || !value.entries || typeof value.entries !== "object" || Array.isArray(value.entries)) throw new Error("Invalid native context preference record");
  for (const [key, entry] of Object.entries(value.entries) as Array<[Key, Entry]>) {
    if (!keys.includes(key) || !entry || typeof entry.rawLine !== "string" || /[\r\n]/.test(entry.rawLine)
      || parseAssignment(entry.rawLine, key) !== entry.value) throw new Error("Invalid saved native context preference");
  }
  return value;
}

/** Move global numeric preferences out of Web's way while retaining native behavior.
 * Markers keep restoration at the original location without introducing unknown TOML keys. */
export function planNativeContextPolicy(text: string, configPath: string, previous: NativeContextPolicy, active: boolean) {
  const bom = text.startsWith("\uFEFF") ? "\uFEFF" : "";
  const ending = text.includes("\r\n") ? "\r\n" : text.includes("\r") ? "\r" : "\n";
  const lines = text.slice(bom.length).split(/\r\n|\n|\r/);
  const entries = { ...previous.entries };
  for (const key of keys) {
    const table = lines.findIndex(line => /^\s*\[/.test(line));
    const top = table < 0 ? lines.length : table;
    const indexes = lines.flatMap((line, index) => index < top && new RegExp(`^\\s*${key}\\s*=`).test(line) ? [index] : []);
    const markers = lines.flatMap((line, index) => index < top && line.trim() === marker(key) ? [index] : []);
    if (indexes.length > 1 || markers.length > 1) throw new Error(`Duplicate ${key} preference or ownership marker`);
    const index = indexes[0], owned = markers[0];
    if (owned !== undefined && !entries[key]) throw new Error(`Saved ${key} preference is missing; restore its record before continuing`);
    if (active && index !== undefined) {
      const rawLine = lines[index]!, value = parseAssignment(rawLine, key);
      if (value === undefined) throw new Error(`${key} must be a simple positive integer assignment`);
      entries[key] = { rawLine, value };
      lines[index] = marker(key);
      if (owned !== undefined) lines.splice(owned, 1);
    } else if (!active && owned !== undefined) {
      // A later explicit user assignment wins over the saved original.
      if (index === undefined) lines[owned] = entries[key]!.rawLine;
      else lines.splice(owned, 1);
      delete entries[key];
    } else if (owned === undefined) {
      delete entries[key];
    }
  }
  return { text: bom + lines.join(ending), policy: { version: 1 as const, configPath, entries } };
}

export function nativeContextPreferences(text: string, policy: NativeContextPolicy) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/);
  const table = lines.findIndex(line => /^\s*\[/.test(line));
  const top = table < 0 ? lines : lines.slice(0, table);
  const owned = (key: Key) => top.some(line => line.trim() === marker(key)) ? policy.entries[key]?.value : undefined;
  return { contextWindow: owned("model_context_window"), autoCompactTokenLimit: owned("model_auto_compact_token_limit") };
}

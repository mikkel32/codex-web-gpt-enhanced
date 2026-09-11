import { createHash } from "node:crypto";
import type { ChatGptTurnEnvironment } from "./environment";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

/** An exact advertised name is already discoverable without executing another catalog tool. */
export function nativeCatalogHasExactName(query: string | undefined, names: readonly string[]): boolean {
  const needle = query?.trim().toLowerCase();
  return Boolean(needle && names.some(name => name.toLowerCase() === needle));
}

/** Derived afresh from a claimed turn. No cached permission grants or capability tokens. */
export function nativeAccessSnapshot(environment: ChatGptTurnEnvironment, runtimeVersion: string, contract: "native" | "safe") {
  const policy = environment.sandboxPolicy.type === "workspaceWrite"
    ? { ...environment.sandboxPolicy, writableRoots: [...new Set(environment.sandboxPolicy.writableRoots)].sort() }
    : environment.sandboxPolicy;
  const tools = environment.tools.map(tool => canonical({
    name: tool.name, namespace: tool.namespace ?? null, parameters: tool.parameters,
    freeform: tool.freeform ?? false, toolSearch: tool.toolSearch ?? false,
  })).map(tool => JSON.stringify(tool)).sort();
  return {
    source: "current_codex_turn" as const,
    runtime_version: runtimeVersion,
    contract,
    native_policy_fingerprint: fingerprint({
      cwd: environment.cwd, roots: [...new Set(environment.roots)].sort(),
      writable_roots: [...new Set(environment.writableRoots)].sort(), sandbox_policy: policy,
    }),
    native_tool_catalog_fingerprint: fingerprint(tools),
    native_tool_catalog_scope: "advertised_native_tools" as const,
    native_approval_policy: "not_supplied_by_this_inventory" as const,
    chatgpt_app_authorization: "not_observable_from_native_inventory" as const,
    listing_grants_permission: false,
    reusable_across_turns: false,
  };
}

import type { LauncherSnapshot } from "./types";

type LiveFields = Pick<LauncherSnapshot, "state" | "browser" | "operation" | "update">;

// IPC events can arrive while the initial disk/runtime snapshot is still loading.
// Each latest event owns its field; null is an update too, not a missing value.
export function createBootstrapOverlay() {
  const live: Partial<LiveFields> = {};
  return {
    record<K extends keyof LiveFields>(key: K, value: LiveFields[K]) { live[key] = value; },
    merge(snapshot: LauncherSnapshot): LauncherSnapshot { return { ...snapshot, ...live }; },
  };
}

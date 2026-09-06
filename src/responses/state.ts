import { join } from "node:path";
import { getConfigDir } from "../config";
import { ResponseHistoryStore } from "./history-store";

const SNAPSHOT_DEBOUNCE_MS = 2000;
// Runtime homes are process configuration, never a request-supplied namespace.
const stores = new Map<string, ResponseHistoryStore>();
const pendingWrites = new Map<ResponseHistoryStore, ReturnType<typeof setTimeout>>();
const requestStores = new WeakMap<object, ResponseHistoryStore>();
const replayedInputPrefixLengths = new WeakMap<object, number>();

function currentStore(): ResponseHistoryStore {
  const path = join(getConfigDir(), "responses-state.json");
  let store = stores.get(path);
  if (!store) { store = new ResponseHistoryStore({ path }); stores.set(path, store); }
  return store;
}

function schedulePersist(store: ResponseHistoryStore): void {
  if (pendingWrites.has(store)) return;
  const timer = setTimeout(() => {
    pendingWrites.delete(store);
    store.flush();
  }, SNAPSHOT_DEBOUNCE_MS);
  timer.unref?.();
  pendingWrites.set(store, timer);
}

/** Flush each owner to its original path even if the configured home changed. */
export function flushResponseState(): void {
  for (const [store, timer] of pendingWrites) {
    clearTimeout(timer);
    pendingWrites.delete(store);
    store.flush();
  }
}

function inputItems(input: unknown): unknown[] {
  if (input === undefined) return [];
  if (Array.isArray(input)) return input;
  if (typeof input === "string") return [{ role: "user", content: input }];
  return [input];
}

export function expandPreviousResponseInput(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  if (replayedInputPrefixLengths.has(body)) return body;
  const request = body as Record<string, unknown>;
  const store = currentStore();
  requestStores.set(body, store);
  const previousId = typeof request.previous_response_id === "string" ? request.previous_response_id : undefined;
  if (!previousId) return body;
  const previous = store.expand(previousId);
  if (!previous) return body;
  const expanded = { ...request, input: [...previous, ...inputItems(request.input)] };
  requestStores.set(expanded, store);
  replayedInputPrefixLengths.set(expanded, previous.length);
  return expanded;
}

/** Proxy-private provenance; never inferred from caller-authored fields. */
export function previousResponseReplayPrefixLength(body: unknown): number {
  if (!body || typeof body !== "object" || Array.isArray(body)) return 0;
  return replayedInputPrefixLengths.get(body) ?? 0;
}

/** Completed and max-output partial responses only; no failed/content-filter replay. */
export function rememberResponseState(
  requestBody: unknown,
  response: { id?: unknown; output?: unknown; status?: unknown; incomplete_details?: unknown },
  opts?: { force?: boolean },
): void {
  if (!requestBody || typeof requestBody !== "object" || Array.isArray(requestBody)) return;
  const request = requestBody as Record<string, unknown>;
  if (request.store === false && !opts?.force) return;
  if (typeof response.id !== "string" || !Array.isArray(response.output)) return;
  if (response.status === "incomplete") {
    const details = response.incomplete_details;
    if (!details || typeof details !== "object" || Array.isArray(details)
      || (details as { reason?: unknown }).reason !== "max_output_tokens") return;
  } else if (response.status !== undefined && response.status !== "completed") return;
  const store = requestStores.get(requestBody) ?? currentStore();
  store.remember(response.id, [...inputItems(request.input), ...response.output]);
  schedulePersist(store);
}

/** Aggregate cache weight, not an estimate of total process RSS or model context. */
export function responseStateStats() { return currentStore().stats(); }

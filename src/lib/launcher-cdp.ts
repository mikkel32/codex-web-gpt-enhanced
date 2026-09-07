type CdpReadinessOptions = {
  timeoutMs: number;
  signal?: AbortSignal;
  isOwnerRunning: () => boolean;
  fetchImpl?: typeof fetch;
};

class CdpMetadataError extends Error {}
class CdpHttpError extends Error {
  readonly status: number;
  constructor(status: number) { super(`HTTP ${status}`); this.status = status; }
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Launcher browser connection aborted", "AbortError");
}

function pause(milliseconds: number, signal?: AbortSignal): Promise<void> {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const finish = () => { signal?.removeEventListener("abort", abort); resolve(); };
    const timer = setTimeout(finish, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(new DOMException("Launcher browser connection aborted", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

function websocketFromMetadata(body: unknown, endpoint: URL): string {
  const value = body && typeof body === "object"
    ? (body as Record<string, unknown>).webSocketDebuggerUrl : undefined;
  let socket: URL;
  try {
    if (typeof value !== "string") throw new Error();
    socket = new URL(value);
  } catch { throw new CdpMetadataError("CDP metadata did not expose a valid browser WebSocket"); }
  if (socket.protocol !== "ws:" || socket.host !== endpoint.host
    || socket.username || socket.password || socket.search || socket.hash
    || !/^\/devtools\/browser\/[^/]+$/.test(socket.pathname)) {
    throw new CdpMetadataError("CDP metadata did not identify the expected loopback browser endpoint");
  }
  return socket.href;
}

/** Retry readiness/transport failures without accepting a redirected or foreign CDP host. */
export async function waitForLauncherCdp(endpointValue: string, options: CdpReadinessOptions): Promise<string> {
  const { timeoutMs, signal, isOwnerRunning, fetchImpl = fetch } = options;
  checkAbort(signal);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError("CDP readiness timeout must be positive");
  const endpoint = new URL(endpointValue);
  if (endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1" || !endpoint.port
    || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== "/") {
    throw new CdpMetadataError("Launcher CDP endpoint must be an explicit loopback origin");
  }
  const deadline = performance.now() + timeoutMs;
  let attempts = 0;
  let lastDetail = "browser is still starting";
  while (performance.now() < deadline) {
    checkAbort(signal);
    if (!isOwnerRunning()) throw new Error("Launcher browser host exited before its CDP endpoint became ready");
    attempts += 1;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(abort, Math.max(1, Math.min(1_000, deadline - performance.now())));
    try {
      const response = await fetchImpl(`${endpoint.origin}/json/version`, {
        signal: controller.signal, redirect: "error", cache: "no-store",
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new CdpHttpError(response.status);
      }
      let body: unknown;
      try { body = await response.json(); }
      catch (error) {
        if (error instanceof SyntaxError) throw new CdpMetadataError("CDP metadata is not valid JSON");
        throw error;
      }
      checkAbort(signal);
      if (!isOwnerRunning()) throw new CdpMetadataError("Launcher browser host exited during CDP readiness verification");
      if (performance.now() >= deadline) throw new CdpHttpError(408);
      return websocketFromMetadata(body, endpoint);
    } catch (error) {
      checkAbort(signal);
      const retryableHttp = error instanceof CdpHttpError && [408, 429, 500, 502, 503, 504].includes(error.status);
      if (error instanceof CdpMetadataError || (error instanceof CdpHttpError && !retryableHttp)) {
        throw new Error(`Launcher browser CDP endpoint is not ready: ${error.message}`);
      }
      const detail = error instanceof Error ? error.message : String(error);
      const cause = error && typeof error === "object" ? (error as { cause?: { code?: unknown }; code?: unknown }) : undefined;
      const code = cause?.cause?.code ?? cause?.code;
      lastDetail = `${detail}${typeof code === "string" ? ` (${code})` : ""}`.slice(0, 500);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
    const remaining = deadline - performance.now();
    if (remaining <= 0) break;
    await pause(Math.min(100 * 2 ** Math.min(attempts - 1, 4), 1_000, remaining), signal);
  }
  checkAbort(signal);
  throw new Error(`Launcher browser CDP endpoint is not ready after ${timeoutMs}ms (${attempts} attempts): ${lastDetail}`);
}

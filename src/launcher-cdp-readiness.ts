/** Wait for the owned Chromium transport without retrying authentication or unsafe metadata. */
export interface CdpHostDescriptor {
  endpoint: string;
  profile: "production" | "development";
}

export class LauncherCdpReadinessError extends Error {
  readonly code = "LAUNCHER_CDP_NOT_READY";
  constructor(message: string) {
    super(message);
    this.name = "LauncherCdpReadinessError";
  }
}

class InvalidCdpMetadataError extends Error {}
const TRANSIENT_HTTP = new Set([408, 425, 429, 500, 502, 503, 504]);

function aborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Launcher browser connection aborted", "AbortError");
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = () => { signal?.removeEventListener("abort", cancel); resolve(); };
    const timer = setTimeout(finish, ms);
    const cancel = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      reject(new DOMException("Launcher browser connection aborted", "AbortError"));
    };
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
  });
}

function endpointURL(endpoint: string): URL {
  let url: URL;
  try { url = new URL(endpoint); }
  catch { throw new InvalidCdpMetadataError("Launcher CDP endpoint is not a valid URL"); }
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port
    || Number(url.port) < 1 || url.username || url.password || url.search || url.hash
    || url.pathname !== "/") {
    throw new InvalidCdpMetadataError("Launcher CDP endpoint must be an explicit loopback origin");
  }
  return url;
}

function validateMetadata(body: unknown, endpoint: URL): string {
  let socket: URL;
  try {
    if (!body || typeof body !== "object" || !("webSocketDebuggerUrl" in body)
      || typeof body.webSocketDebuggerUrl !== "string") throw new Error();
    socket = new URL(body.webSocketDebuggerUrl);
  } catch {
    throw new InvalidCdpMetadataError("CDP metadata did not expose a valid browser WebSocket");
  }
  if (socket.protocol !== "ws:" || socket.hostname !== "127.0.0.1" || socket.port !== endpoint.port
    || socket.username || socket.password || socket.search || socket.hash
    || !/^\/devtools\/browser\/[^/]+$/.test(socket.pathname)) {
    throw new InvalidCdpMetadataError("CDP metadata did not identify the expected loopback browser endpoint on the same loopback port");
  }
  return socket.href;
}

function transportDetail(error: unknown): string {
  // Do not include URLs, response bodies, cookies, or arbitrary exception payloads in diagnostics.
  const cause = error && typeof error === "object" && "cause" in error ? error.cause : undefined;
  const code = cause && typeof cause === "object" && "code" in cause ? cause.code : undefined;
  if (typeof code === "string" && /^[A-Z0-9_]{1,50}$/.test(code)) return code;
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")
    ? "probe timed out" : "local browser transport unavailable";
}

export interface CdpReadinessOptions<T extends CdpHostDescriptor> {
  timeoutMs?: number;
  signal?: AbortSignal;
  expectedProfile?: T["profile"];
  isOwnerRunning?: (descriptor: T) => boolean;
  fetchImpl?: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;
}

export async function waitForLauncherCdpConnection<T extends CdpHostDescriptor>(
  readDescriptor: () => T,
  options: CdpReadinessOptions<T> = {},
): Promise<{ descriptor: T; webSocketDebuggerUrl: string }> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("CDP readiness timeout must be positive and finite");
  const deadline = performance.now() + timeoutMs;
  let expectedProfile = options.expectedProfile;
  let attempts = 0;
  let detail = "local browser transport unavailable";
  for (;;) {
    aborted(options.signal);
    // Reread on every attempt: a restart can atomically replace the descriptor and its port.
    // Invalid permissions, identity, ownership, or a dead process remain immediate failures.
    const descriptor = readDescriptor();
    if (options.isOwnerRunning && !options.isOwnerRunning(descriptor)) {
      throw new Error("Launcher browser host exited before its CDP endpoint became ready");
    }
    expectedProfile ??= descriptor.profile;
    if (descriptor.profile !== expectedProfile) {
      throw new Error(`Launcher browser belongs to ${descriptor.profile}, but ${expectedProfile} was required`);
    }
    const endpoint = endpointURL(descriptor.endpoint);
    const remaining = deadline - performance.now();
    if (remaining <= 0) break;
    attempts += 1;
    const controller = new AbortController();
    const cancel = () => controller.abort();
    options.signal?.addEventListener("abort", cancel, { once: true });
    if (options.signal?.aborted) cancel();
    const timer = setTimeout(cancel, Math.min(1_000, remaining));
    try {
      const response = await (options.fetchImpl ?? fetch)(`${endpoint.origin}/json/version`, {
        signal: controller.signal,
        redirect: "manual",
        cache: "no-store",
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (!TRANSIENT_HTTP.has(response.status)) {
          throw new InvalidCdpMetadataError(`Launcher CDP endpoint returned HTTP ${response.status}`);
        }
        detail = `HTTP ${response.status}`;
      } else {
        let body: unknown;
        try { body = await response.json(); }
        catch (error) {
          if (controller.signal.aborted) throw error;
          throw new InvalidCdpMetadataError("CDP metadata is not valid JSON");
        }
        const webSocketDebuggerUrl = validateMetadata(body, endpoint);
        if (controller.signal.aborted || performance.now() >= deadline) {
          throw new DOMException("CDP probe timed out", "AbortError");
        }
        aborted(options.signal);
        if (options.isOwnerRunning && !options.isOwnerRunning(descriptor)) {
          throw new InvalidCdpMetadataError("Launcher browser host exited during CDP readiness verification");
        }
        return { descriptor, webSocketDebuggerUrl };
      }
    } catch (error) {
      aborted(options.signal);
      if (error instanceof InvalidCdpMetadataError) throw error;
      detail = transportDetail(error);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", cancel);
    }
    const rest = deadline - performance.now();
    if (rest <= 0) break;
    await delay(Math.min(100 * 2 ** Math.min(attempts - 1, 3), rest), options.signal);
  }
  aborted(options.signal);
  throw new LauncherCdpReadinessError(
    `Launcher browser CDP endpoint is not ready after ${timeoutMs}ms (${attempts} attempts): ${detail}. `
    + "Keep Maria open and retry setup. If this persists, restart Maria and export its privacy-safe log.",
  );
}

/** Metadata-only callers share the exact same ownership, deadline and retry checks. */
export async function waitForLauncherCdp<T extends CdpHostDescriptor>(
  readDescriptor: () => T,
  options: CdpReadinessOptions<T> = {},
): Promise<T> {
  return (await waitForLauncherCdpConnection(readDescriptor, options)).descriptor;
}

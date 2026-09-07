import { waitForLauncherCdpConnection } from "../launcher-cdp-readiness";

type CdpReadinessOptions = {
  timeoutMs: number;
  signal?: AbortSignal;
  isOwnerRunning: () => boolean;
  fetchImpl?: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;
};

/** Compatibility facade: all callers use the same validated CDP readiness implementation. */
export async function waitForLauncherCdp(endpoint: string, options: CdpReadinessOptions): Promise<string> {
  const connection = await waitForLauncherCdpConnection(
    () => ({ endpoint, profile: "production" as const }), options,
  );
  return connection.webSocketDebuggerUrl;
}

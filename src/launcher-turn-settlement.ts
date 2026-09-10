import { randomBytes } from "node:crypto";

export class LauncherControlHttpError extends Error {
  constructor(readonly status: number, detail: string) { super(`HTTP ${status}${detail ? `: ${detail}` : ""}`); }
}

type EndRequest = {
  phase: "end";
  traceId: string;
  helperPid: number;
  status: "completed" | "failed" | "aborted";
};
type Request = (action: "end" | "settlement", body: EndRequest & { requestId: string }, timeoutMs: number) => Promise<Record<string, unknown>>;

function releaseResult(body: Record<string, unknown>): { cancelledByUser: boolean } {
  if (body.ok !== true || typeof body.cancelledByUser !== "boolean") {
    throw new Error("Launcher browser control channel returned an invalid turn release result");
  }
  return { cancelledByUser: body.cancelledByUser };
}

function terminalRejection(error: unknown): boolean {
  return error instanceof LauncherControlHttpError && error.status < 500
    || error instanceof Error && error.name === "LauncherBrowserTurnCancelledError";
}

/** A lost HTTP response must not turn a committed completion into another browser submission. */
export async function reconcileLauncherTurnEnd(request: Request, activity: EndRequest, timeoutMs: number): Promise<{ cancelledByUser: boolean }> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("Invalid launcher settlement deadline");
  const body = { ...activity, requestId: randomBytes(24).toString("base64url") };
  const deadline = performance.now() + timeoutMs;
  const remaining = () => Math.max(1, Math.ceil(deadline - performance.now()));
  const attemptBudget = () => Math.min(5_000, Math.max(1, Math.ceil(timeoutMs / 2)), remaining());
  let originalError: unknown;
  try { return releaseResult(await request("end", body, attemptBudget())); }
  catch (error) {
    // Rejected ownership, authorization, invalid requests and explicit cancellations are
    // terminal. Only an ambiguous delivery warrants consulting the read-only receipt.
    if (!(error instanceof Error) || terminalRejection(error)) throw error;
    originalError = error;
  }
  let retried = false;
  try {
    for (let observation = 0; observation < 12 && performance.now() < deadline; observation++) {
      const state = await request("settlement", body, Math.min(2_000, remaining()));
      if (state.ok !== true) throw new Error("Launcher returned an invalid settlement receipt");
      if (state.state === "completed") {
        if (!state.result || typeof state.result !== "object" || Array.isArray(state.result)) {
          throw new Error("Launcher returned an invalid settled result");
        }
        return releaseResult({ ...state.result as Record<string, unknown>, ok: true });
      }
      if (state.state === "missing" && !retried) {
        // The endpoint's presence proves idempotency support. Delayed and repeated end
        // requests share this exact nonce, payload and launcher connection; never Send.
        retried = true;
        try { return releaseResult(await request("end", body, attemptBudget())); }
        catch (error) {
          if (terminalRejection(error)) throw error;
        }
      } else if (state.state !== "pending") {
        throw new Error("Launcher could not confirm the terminal operation");
      }
      await new Promise(resolve => setTimeout(resolve, Math.min(100 * 2 ** Math.min(observation, 3), remaining())));
    }
    throw new Error("Launcher completion acknowledgement deadline expired");
  } catch (error) {
    throw new AggregateError([originalError, error], "Launcher completion acknowledgement could not be confirmed; no prompt was replayed");
  }
}

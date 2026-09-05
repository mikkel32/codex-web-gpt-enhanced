import { useCallback, useEffect, useRef, useState } from "react";
import type { ConnectionStatus } from "./types";

let inFlight: Promise<ConnectionStatus> | undefined;
function readConnection(): Promise<ConnectionStatus> {
  if (!inFlight) inFlight = window.codexWebLauncher!.connectionStatus().finally(() => { inFlight = undefined; });
  return inFlight;
}

export function useConnectionStatus() {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState(false);
  const refreshRef = useRef<() => void>(() => {});
  useEffect(() => {
    let disposed = false;
    let pending = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let signature = "";
    const check = async (manual = false) => {
      clearTimeout(timer);
      if (disposed || document.hidden || pending) return;
      pending = true;
      if (manual) setChecking(true);
      try {
        const next = await readConnection();
        if (!disposed) {
          const nextSignature = JSON.stringify(next);
          if (nextSignature !== signature) { signature = nextSignature; setStatus(next); }
          setError(false);
        }
      } catch { if (!disposed) setError(true); }
      finally {
        pending = false;
        if (!disposed) {
          setChecking(false);
          if (!document.hidden) timer = setTimeout(() => void check(), 15_000);
        }
      }
    };
    const onVisibility = () => { clearTimeout(timer); if (!document.hidden) void check(); };
    refreshRef.current = () => void check(true);
    document.addEventListener("visibilitychange", onVisibility);
    void check();
    return () => { disposed = true; clearTimeout(timer); document.removeEventListener("visibilitychange", onVisibility); };
  }, []);
  const refresh = useCallback(() => refreshRef.current(), []);
  return { status, checking, error, refresh };
}

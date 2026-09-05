import { useEffect, useState } from "react";
import type { LogRecord } from "./types";

type DisplayLog = LogRecord & { uiId: number };
let sequence = 0;
const displayLog = (record: LogRecord): DisplayLog => ({ ...record, uiId: ++sequence });

// Only the mounted Activity page subscribes. Bursts update its rows at most ten times a second.
export function useActivityLogs() {
  const [logs, setLogs] = useState<DisplayLog[]>([]);
  useEffect(() => {
    const api = window.codexWebLauncher!;
    let disposed = false;
    let seeded = false;
    let pending: LogRecord[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      timer = undefined;
      if (disposed || document.hidden || !seeded || !pending.length) return;
      const batch = pending; pending = [];
      setLogs(previous => [...previous, ...batch.map(displayLog)].slice(-300));
    };
    const unsubscribe = api.onLog(record => {
      pending.push(record);
      if (pending.length > 300) pending.shift();
      if (!timer && seeded && !document.hidden) timer = setTimeout(flush, 100);
    });
    void api.logs(300).then(initial => {
      if (disposed) return;
      const known = new Set(initial.map(record => JSON.stringify(record)));
      setLogs([...initial, ...pending.filter(record => !known.has(JSON.stringify(record)))].slice(-300).map(displayLog));
      pending = []; seeded = true;
    }).catch(() => { seeded = true; flush(); });
    const onVisibility = () => { clearTimeout(timer); timer = undefined; if (!document.hidden) flush(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { disposed = true; unsubscribe(); clearTimeout(timer); document.removeEventListener("visibilitychange", onVisibility); };
  }, []);
  return logs;
}

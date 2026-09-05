import type { ConnectionStatus } from "./types";

export type ConnectionSnapshot = {
  status: ConnectionStatus | null; checking: boolean; error: boolean; stale: boolean;
};
type Timer = ReturnType<typeof setTimeout>;
export function createConnectionMonitor(read: () => Promise<ConnectionStatus>, clock = {
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  clearTimeout: (timer: Timer) => clearTimeout(timer),
}) {
  let snapshot: ConnectionSnapshot = { status: null, checking: false, error: false, stale: true };
  const listeners = new Set<() => void>();
  let timer: Timer | undefined;
  let flight: Promise<void> | undefined;
  let visible = true;
  let generation = 0;
  let failures = 0;
  let dirty = false;
  const publish = (next: ConnectionSnapshot) => {
    if (JSON.stringify(next) === JSON.stringify(snapshot)) return;
    snapshot = next; listeners.forEach(listener => listener());
  };
  const stopTimer = () => { if (timer !== undefined) clock.clearTimeout(timer); timer = undefined; };
  const interval = () => snapshot.error ? Math.min(30_000, 3000 * 2 ** Math.min(failures - 1, 4))
    : snapshot.status?.activeBrowserTurns || snapshot.status?.phase === "recovering" ? 3000 : 15_000;
  const schedule = (ms = interval()) => {
    stopTimer();
    if (visible && listeners.size) timer = clock.setTimeout(() => { timer = undefined; void refresh(); }, ms);
  };
  const refresh = () => {
    stopTimer();
    if (!visible || !listeners.size) return Promise.resolve();
    if (flight) return flight;
    const epoch = generation;
    dirty = false;
    publish({ ...snapshot, checking: true });
    flight = Promise.resolve().then(read).then(status => {
      if (epoch !== generation) return;
      failures = 0;
      publish({ status, checking: false, error: false, stale: false });
    }, () => {
      if (epoch !== generation) return;
      failures += 1;
      publish({ ...snapshot, checking: false, error: true, stale: true });
    }).finally(() => {
      flight = undefined;
      if (dirty) { dirty = false; schedule(150); }
      else schedule();
    });
    return flight;
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1) { generation += 1; dirty = true; void refresh(); }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) { generation += 1; stopTimer(); snapshot = { ...snapshot, checking: false, stale: true }; }
      };
    },
    refresh,
    invalidate() { dirty = true; if (!flight) schedule(150); },
    setVisible(next: boolean) {
      if (visible === next) return;
      visible = next;
      if (!visible) { stopTimer(); generation += 1; publish({ ...snapshot, checking: false, stale: true }); }
      else { dirty = true; void refresh(); }
    },
  };
}

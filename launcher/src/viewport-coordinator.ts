export type ViewportBounds = { x: number; y: number; width: number; height: number };
type Target = { active: boolean; bounds: ViewportBounds | null };
type ViewportApi = {
  setBrowserBounds(bounds: ViewportBounds): Promise<unknown>;
  setBrowserSurfaceActive(active: boolean): Promise<unknown>;
};
const sameBounds = (a: ViewportBounds | null, b: ViewportBounds | null) =>
  a === b || Boolean(a && b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height);

/** One owner for native view geometry; rapid intents replace queued intermediate states. */
export function createViewportCoordinator(api: ViewportApi, report: (error: unknown) => void) {
  let target: Target = { active: false, bounds: null };
  let applied: { active: boolean | null; bounds: ViewportBounds | null } = { active: null, bounds: null };
  let revision = 0;
  let disposed = false;
  let failed = false;
  let handled = 0;
  let running: Promise<void> | null = null;
  const pump = () => {
    if (running || disposed) return running;
    const work = async () => {
      while (!disposed) {
        const next = target;
        const seen = revision;
        try {
          if (!next.active || !next.bounds) {
            if (applied.active !== false) { await api.setBrowserSurfaceActive(false); applied.active = false; }
          } else {
            if (!sameBounds(applied.bounds, next.bounds)) {
              await api.setBrowserBounds(next.bounds);
              applied.bounds = next.bounds;
            }
            // An overlay or navigation may have won while geometry was in flight.
            if (seen !== revision) continue;
            if (!applied.active) { await api.setBrowserSurfaceActive(true); applied.active = true; }
          }
        } catch (error) {
          failed = true;
          handled = seen;
          if (!disposed) report(error);
          // Never retry a failed IPC in a hot loop; a new intent can try again.
          if (seen === revision) return;
        }
        failed = false;
        handled = seen;
        if (seen === revision) return;
      }
    };
    running = Promise.resolve().then(work).finally(() => {
      running = null;
      if (!disposed && handled !== revision) void pump();
    });
    return running;
  };
  return {
    update(active: boolean, bounds: ViewportBounds | null = null) {
      if (disposed) return;
      const rounded = bounds && Object.values(bounds).every(Number.isFinite) && bounds.width > 0 && bounds.height > 0
        ? Object.fromEntries(Object.entries(bounds).map(([key, value]) => [key, Math.round(value)])) as ViewportBounds
        : null;
      if (applied.active !== null && !failed && target.active === active && sameBounds(target.bounds, rounded)) return;
      target = { active, bounds: rounded };
      revision += 1;
      void pump();
    },
    idle: () => running ?? Promise.resolve(),
    dispose() {
      target = { active: false, bounds: null };
      revision += 1;
      // Let an in-flight reveal settle, then always retire the native surface.
      const pending = running ?? Promise.resolve();
      disposed = true;
      return pending.then(() => api.setBrowserSurfaceActive(false)).catch(report);
    },
  };
}

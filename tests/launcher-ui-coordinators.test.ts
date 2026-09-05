import { expect, test } from "bun:test";
import { createViewportCoordinator } from "../launcher/src/viewport-coordinator";
import { createConnectionMonitor } from "../launcher/src/connection-monitor";

const ticks = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const bounds = (x: number) => ({ x, y: 46, width: 900, height: 700 });
const status = { nativeAvailable: true, browserConnected: true, activeBrowserTurns: 0 };

test("a navigation during native measurement cannot reveal the retired surface", async () => {
  const calls: unknown[] = [];
  let finish!: () => void;
  const owner = createViewportCoordinator({
    setBrowserBounds: async b => { calls.push(b); await new Promise<void>(resolve => { finish = resolve; }); },
    setBrowserSurfaceActive: async active => { calls.push(active); },
  }, error => { throw error; });
  owner.update(true, bounds(252));
  await ticks();
  owner.update(false);
  finish();
  await owner.idle();
  expect(calls).toEqual([bounds(252), false]);
});

test("rapid native resizes coalesce to the latest geometry and skip duplicates", async () => {
  const calls: unknown[] = [];
  let finish!: () => void;
  let first = true;
  const owner = createViewportCoordinator({
    setBrowserBounds: async b => { calls.push(b); if (first) { first = false; await new Promise<void>(resolve => { finish = resolve; }); } },
    setBrowserSurfaceActive: async active => { calls.push(active); },
  }, error => { throw error; });
  owner.update(true, bounds(252)); await ticks();
  owner.update(true, bounds(200)); owner.update(true, bounds(76));
  finish(); await owner.idle();
  owner.update(true, bounds(76)); await ticks();
  expect(calls).toEqual([bounds(252), bounds(76), true]);
  await owner.dispose();
  expect(calls.at(-1)).toBe(false);
});

test("failed geometry does not loop and can recover on a new explicit intent", async () => {
  let attempts = 0;
  const errors: unknown[] = [];
  const calls: boolean[] = [];
  const owner = createViewportCoordinator({
    setBrowserBounds: async () => { if (++attempts === 1) throw new Error("IPC unavailable"); },
    setBrowserSurfaceActive: async active => { calls.push(active); },
  }, error => errors.push(error));
  owner.update(true, bounds(252)); await owner.idle(); await ticks();
  expect(attempts).toBe(1); expect(errors).toHaveLength(1); expect(calls).toEqual([]);
  owner.update(true, bounds(252)); await owner.idle();
  expect(attempts).toBe(2); expect(calls).toEqual([true]);
});

function fakeClock() {
  let time = 0, next = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    timers,
    clock: {
      setTimeout(fn: () => void, ms: number) { const id = ++next; timers.set(id, { at: time + ms, fn }); return id as unknown as ReturnType<typeof setTimeout>; },
      clearTimeout(id: ReturnType<typeof setTimeout>) { timers.delete(id as unknown as number); },
    },
    async advance(ms: number) {
      time += ms;
      for (const [id, task] of [...timers]) if (task.at <= time) { timers.delete(id); task.fn(); }
      await ticks();
    },
  };
}

test("connection readers share requests, debounce invalidation, and stop when hidden", async () => {
  let reads = 0;
  const clock = fakeClock();
  const monitor = createConnectionMonitor(async () => { reads += 1; return status; }, clock.clock);
  const offA = monitor.subscribe(() => {}), offB = monitor.subscribe(() => {});
  await Promise.all([monitor.refresh(), monitor.refresh()]);
  expect(reads).toBe(1);
  monitor.invalidate(); monitor.invalidate(); monitor.invalidate();
  await clock.advance(150);
  expect(reads).toBe(2);
  monitor.setVisible(false);
  await clock.advance(60_000);
  expect(reads).toBe(2); expect(clock.timers.size).toBe(0);
  monitor.setVisible(true); await ticks();
  expect(reads).toBe(3);
  offA(); offB(); expect(clock.timers.size).toBe(0);
});

test("late connection results from a hidden generation are discarded", async () => {
  const clock = fakeClock();
  let finish!: (value: typeof status) => void;
  let reads = 0;
  const monitor = createConnectionMonitor(() => ++reads === 1
    ? new Promise(resolve => { finish = resolve; })
    : Promise.resolve(status), clock.clock);
  const off = monitor.subscribe(() => {});
  await ticks();
  monitor.setVisible(false); monitor.setVisible(true);
  finish({ ...status, nativeAvailable: false }); await ticks();
  expect(monitor.getSnapshot().status).toBeNull();
  await clock.advance(150);
  expect(monitor.getSnapshot().status?.nativeAvailable).toBe(true);
  off();
});

test("connection failures use bounded backoff and recover after invalidation", async () => {
  const clock = fakeClock(); let healthy = false, reads = 0;
  const monitor = createConnectionMonitor(async () => { reads += 1; if (!healthy) throw new Error("offline"); return status; }, clock.clock);
  const off = monitor.subscribe(() => {}); await ticks();
  expect(monitor.getSnapshot().error).toBe(true);
  await clock.advance(2999); expect(reads).toBe(1);
  await clock.advance(1); expect(reads).toBe(2);
  healthy = true; monitor.invalidate(); await clock.advance(150);
  expect(monitor.getSnapshot().error).toBe(false); expect(monitor.getSnapshot().stale).toBe(false);
  off();
});

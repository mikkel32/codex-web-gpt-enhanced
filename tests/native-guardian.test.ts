import { expect, test } from "bun:test";
import { guardianMayRecover } from "../src/native-guardian";

test("native recovery respects a live UI and never kills an ambiguous live daemon", () => {
  const owner = { ownerPid: 10, daemonPid: 20, status: "ready", updatedAt: new Date(10000).toISOString() };
  expect(guardianMayRecover(owner, 30, pid => pid === 10, 0)).toBe(false);
  expect(guardianMayRecover(owner, 30, pid => pid === 20, 0)).toBe(false);
  expect(guardianMayRecover(owner, 30, () => false, 0)).toBe(true);
});

test("native recovery ignores stale PIDs from a previous boot and recognizes its own ownership", () => {
  expect(guardianMayRecover({ ownerPid: 10, daemonPid: 20, status: "background", updatedAt: new Date(10000).toISOString() }, 30, () => true, 100000)).toBe(true);
  expect(guardianMayRecover({ ownerPid: 30, daemonPid: null, status: "background", updatedAt: new Date(10000).toISOString() }, 30, () => true, 0)).toBe(true);
});

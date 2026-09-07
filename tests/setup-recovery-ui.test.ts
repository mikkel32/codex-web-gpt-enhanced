import { expect, test } from "bun:test";
import { setupRecoveryCopy, setupRecoveryKind } from "../launcher/src/setup-recovery";

test("nested CDP errors offer connection recovery", () => {
  expect(setupRecoveryKind("Error invoking remote method 'launcher:setup-core': Launcher browser CDP endpoint is not ready: fetch failed; restoring the previous launcher runtime failed: Config requires 5.13.5; launcher is 5.13.8")).toBe("browser");
});
test("version recovery upgrades but never downgrades the saved runtime", () => {
  expect(setupRecoveryKind("Config requires 5.13.5; launcher is 5.13.8")).toBe("version");
  expect(setupRecoveryKind("Config requires 5.13.10; launcher is 5.13.9")).toBeNull();
  expect(setupRecoveryKind("Config requires 5.13.9; launcher is 5.13.9")).toBeNull();
});
test.each([
  "Sign in to ChatGPT; restoring the previous launcher runtime failed: Config requires 5.13.5; launcher is 5.13.8",
  "Launcher browser CDP endpoint is not ready: HTTP 403",
  "Access paused; Launcher browser CDP endpoint is not ready",
  "An unrelated error",
])("non-retryable failures do not offer setup: %s", message => {
  expect(setupRecoveryKind(message)).toBeNull();
});
test.each(["en", "ja", "zh-CN"])("recovery copy is available for %s", language => {
  for (const kind of ["browser", "version"] as const) {
    const copy = setupRecoveryCopy(kind, language);
    for (const value of Object.values(copy)) expect(value.length).toBeGreaterThan(0);
  }
});

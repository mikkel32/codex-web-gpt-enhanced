import { expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { runtimeScopedTunnelAlias } from "../src/tunnel";

test("custom core homes cannot share a user-global tunnel runtime alias", () => {
  const user = resolve("alias-test-user");
  const first = runtimeScopedTunnelAlias("codex-chatgpt-web", join(user, "qa-one"), user);
  const second = runtimeScopedTunnelAlias("codex-chatgpt-web", join(user, "qa-two"), user);
  expect(first).not.toBe(second);
  expect(first).toMatch(/^codex-chatgpt-web-[a-f0-9]{12}$/);
  expect(first).toBe(runtimeScopedTunnelAlias("codex-chatgpt-web", join(user, "qa-one", "."), user));
  expect(first).not.toBe(runtimeScopedTunnelAlias("codex-chatgpt-web-zero-risk", join(user, "qa-one"), user));
});

test("standard production and DEV aliases remain compatible", () => {
  const user = resolve("alias-test-user");
  expect(runtimeScopedTunnelAlias("codex-chatgpt-web", join(user, ".codex-chatgpt-web"), user)).toBe("codex-chatgpt-web");
  expect(runtimeScopedTunnelAlias("codex-chatgpt-web-dev", join(user, ".codex-chatgpt-web-dev"), user)).toBe("codex-chatgpt-web-dev");
});

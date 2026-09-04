import { expect, test } from "bun:test";
import { sourceCommandNeedsProductionOptIn } from "../src/source-scope";

test("source mutation requires explicit production intent for either production home", () => {
  const base = { entry: "/workspace/src/cli.ts", userHome: "/users/test", configHome: "/users/test/.codex-chatgpt-web", codexHome: "/users/test/.codex" };
  for (const command of ["setup", "serve", "guard", "uninstall", "route", "subagents"]) expect(sourceCommandNeedsProductionOptIn({ ...base, command })).toBe(true);
  expect(sourceCommandNeedsProductionOptIn({ ...base, configHome: "/scratch/maria", command: "setup" })).toBe(true);
  expect(sourceCommandNeedsProductionOptIn({ ...base, configHome: "/scratch/maria", codexHome: "/scratch/codex", command: "setup" })).toBe(false);
});

test("installed runtime, diagnostics, and DEV commands keep their normal behavior", () => {
  const base = { entry: "/workspace/src/cli.ts", userHome: "/users/test", configHome: "/users/test/.codex-chatgpt-web" };
  for (const command of ["help", "status", "doctor", "dev"]) expect(sourceCommandNeedsProductionOptIn({ ...base, command })).toBe(false);
  expect(sourceCommandNeedsProductionOptIn({ ...base, command: "route", action: "status" })).toBe(false);
  expect(sourceCommandNeedsProductionOptIn({ ...base, entry: "/installed/app/cli.js", command: "setup" })).toBe(false);
});

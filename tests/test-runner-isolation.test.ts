import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("the core test command isolates child state even when its parent points at a live home", async () => {
  const root = mkdtempSync(join(tmpdir(), "maria-test-runner-fixture-"));
  const fixture = join(root, "isolated.test.ts");
  const sentinel = join(root, "responses-state.json");
  writeFileSync(sentinel, "original cache");
  writeFileSync(fixture, `import { test, expect } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
test("isolated child", () => {
  const home = process.env.CODEX_CHATGPT_WEB_HOME!;
  expect(home).not.toBe(${JSON.stringify(root)});
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, "responses-state.json"), "fixture cache");
  console.log("ISOLATED_CHILD_HOME=" + home);
});
`);
  try {
    const child = Bun.spawn([process.execPath, "run", "scripts/test-core.ts", fixture], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: { ...process.env, CODEX_CHATGPT_WEB_HOME: root }, stdout: "pipe", stderr: "pipe",
    });
    const [status, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect({ status, failed: stderr.includes("(fail)") }).toEqual({ status: 0, failed: false });
    expect(readFileSync(sentinel, "utf8")).toBe("original cache");
    const childHome = stdout.match(/ISOLATED_CHILD_HOME=([^\r\n]+)/)?.[1];
    expect(childHome).toBeDefined();
    expect(existsSync(childHome!)).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const scratch = mkdtempSync(join(tmpdir(), "maria-core-tests-"));
const targets = process.argv.slice(2);
const args = targets.length ? targets : [...new Bun.Glob("tests/*.test.ts").scanSync({ cwd: root })].sort();
let exitCode = 1;
try {
  const child = Bun.spawn([process.execPath, "test", ...args], {
    cwd: root,
    env: { ...process.env, CODEX_CHATGPT_WEB_HOME: join(scratch, "home") },
    stdin: "inherit", stdout: "inherit", stderr: "inherit",
  });
  exitCode = await child.exited;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
process.exit(exitCode);

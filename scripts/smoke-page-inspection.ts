import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const root = resolve(import.meta.dir, "..");
const home = mkdtempSync(join(tmpdir(), "maria-inspection-electron-"));
const electron = createRequire(join(root, "launcher/package.json"))("electron") as string;
const args = [electron, join(root, "launcher/scripts/smoke-page-inspection.cjs")];
if (process.platform === "linux") { args.push("--no-sandbox"); args.unshift("xvfb-run", "-a"); }
const env: NodeJS.ProcessEnv = { ...process.env, MARIA_INSPECTION_TEST_HOME: home, CODEX_CHATGPT_WEB_HOME: join(home, "core"), CODEX_HOME: join(home, "codex") };
delete env.ELECTRON_RUN_AS_NODE;
let child: ReturnType<typeof Bun.spawn> | undefined;
try {
  const launched = Bun.spawn(args, { cwd: root, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  child = launched;
  const timer = setTimeout(() => launched.kill(), 90_000);
  const [status, stdout, stderr] = await Promise.all([
    launched.exited,
    new Response(launched.stdout).text(),
    new Response(launched.stderr).text(),
  ]).finally(() => clearTimeout(timer));
  assert.equal(status, 0, `Electron inspection fixture failed: ${stdout.slice(-3000)}\n${stderr.slice(-6000)}`);
  assert(stdout.includes("PAGE_INSPECTION_ELECTRON_OK"));
  process.stdout.write(stdout);
} finally {
  if (child && child.exitCode === null) { child.kill(); await child.exited; }
  rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

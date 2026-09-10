import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const root = resolve(import.meta.dir, "..");
const home = mkdtempSync(join(tmpdir(), "maria-report-ui-"));
const electron = createRequire(join(root, "launcher/package.json"))("electron") as string;
const args = [electron, join(root, "launcher/scripts/smoke-error-reporting.cjs")];
if (process.platform === "linux") { args.push("--no-sandbox"); args.unshift("xvfb-run", "-a"); }
const env: NodeJS.ProcessEnv = { ...process.env, MARIA_REPORT_TEST_HOME: home, CODEX_CHATGPT_WEB_HOME: home, CODEX_HOME: join(home, "codex") };
delete env.ELECTRON_RUN_AS_NODE;
const child = Bun.spawn(args, { cwd: root, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
const timer = setTimeout(() => child.kill(), 45_000);
try {
  const [code, output, error] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  assert.equal(code, 0, error.slice(-4000));
  assert(output.includes("ERROR_REPORTING_ELECTRON_OK"));
  process.stdout.write(output);
} finally {
  clearTimeout(timer);
  if (child.exitCode === null) { child.kill(); await child.exited; }
  rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

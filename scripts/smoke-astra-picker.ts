import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const root = resolve(import.meta.dir, "..");
const home = mkdtempSync(join(tmpdir(), "maria-astra-electron-"));
const electron = createRequire(join(root, "launcher/package.json"))("electron") as string;
const args = [electron, join(root, "launcher/scripts/astra-picker-electron.cjs")];
// This offline fixture has no account, network access, or production browser state.
if (process.platform === "linux") { args.push("--no-sandbox"); args.unshift("xvfb-run", "-a"); }
const environment: NodeJS.ProcessEnv = { ...process.env, ASTRA_PICKER_TEST_HOME: home };
delete environment.ELECTRON_RUN_AS_NODE;
const child = Bun.spawn(args, { cwd: root, env: environment, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
const stderr = new Response(child.stderr).text();
try {
  const portFile = join(home, "DevToolsActivePort"), deadline = Date.now() + 30_000;
  let exited = false;
  void child.exited.then(() => { exited = true; });
  while (!existsSync(portFile) && !exited && Date.now() < deadline) await Bun.sleep(50);
  assert(existsSync(portFile), "Electron did not publish its CDP port");
  const port = Number(readFileSync(portFile, "utf8").split("\n")[0]);
  const driverPath = join(home, "driver.mjs");
  const build = await Bun.build({ entrypoints: [join(root, "scripts/astra-picker-driver.ts")], target: "node", format: "esm", outdir: home, naming: "driver.mjs" });
  assert(build.success, `Picker driver build failed: ${build.logs.join("\n")}`);
  // Match production: the selector and Playwright execute in Electron's Node runtime.
  const driver = Bun.spawn([electron, driverPath, `http://127.0.0.1:${port}`], {
    cwd: root, env: { ...environment, ELECTRON_RUN_AS_NODE: "1" }, stdout: "pipe", stderr: "pipe",
  });
  const [status, stdout, errors] = await Promise.all([driver.exited, new Response(driver.stdout).text(), new Response(driver.stderr).text()]);
  assert.equal(status, 0, `Real Electron selector failed: ${errors}`);
  assert(stdout.includes("ASTRA_ELECTRON_PICKER_OK"), "Picker driver did not finish");
  process.stdout.write(stdout);
} finally {
  try { child.stdin.end(); } catch { /* The fixture may already have exited. */ }
  const stopped = await Promise.race([child.exited.then(() => true), Bun.sleep(5_000).then(() => false)]);
  if (!stopped) child.kill();
  await child.exited;
  const errors = await stderr;
  if (child.exitCode && !errors.includes("DevTools listening")) process.stderr.write(errors.slice(-4000));
  rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

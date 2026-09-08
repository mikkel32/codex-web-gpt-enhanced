import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { waitForElectronDebugger } from "./electron-debugger-readiness";

const root = resolve(import.meta.dir, "..");
const home = mkdtempSync(join(tmpdir(), "maria-astra-electron-"));
const electron = createRequire(join(root, "launcher/package.json"))("electron") as string;
const args = [electron, join(root, "launcher/scripts/astra-picker-electron.cjs")];
// This offline fixture has no account, network access, or production browser state.
if (process.platform === "linux") { args.push("--no-sandbox"); args.unshift("xvfb-run", "-a"); }
const environment: NodeJS.ProcessEnv = { ...process.env, ASTRA_PICKER_TEST_HOME: home };
delete environment.ELECTRON_RUN_AS_NODE;
const child = Bun.spawn(args, { cwd: root, env: environment, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
const stderr = new Response(child.stderr).text();
let completed = false;
try {
  const websocket = await waitForElectronDebugger(join(home, "DevToolsActivePort"), () => child.exitCode === null);
  const driverPath = join(home, "driver.mjs");
  const build = await Bun.build({ entrypoints: [join(root, "scripts/astra-picker-driver.ts")], target: "node", format: "esm", outdir: home, naming: "driver.mjs" });
  assert(build.success, `Picker driver build failed: ${build.logs.join("\n")}`);
  // Match production: the selector and Playwright execute in Electron's Node runtime.
  const driver = Bun.spawn([electron, driverPath, websocket], {
    cwd: root, env: { ...environment, ELECTRON_RUN_AS_NODE: "1" }, stdout: "pipe", stderr: "pipe",
  });
  const [status, stdout, errors] = await Promise.all([driver.exited, new Response(driver.stdout).text(), new Response(driver.stderr).text()]);
  assert.equal(status, 0, `Real Electron selector failed: ${errors}`);
  assert(stdout.includes("ASTRA_ELECTRON_PICKER_OK"), "Picker driver did not finish");
  process.stdout.write(stdout);
  completed = true;
} finally {
  writeFileSync(join(home, "stop"), "stop");
  const stopped = await Promise.race([child.exited.then(() => true), Bun.sleep(5_000).then(() => false)]);
  if (!stopped) child.kill();
  await child.exited;
  const errors = await stderr;
  if (!completed || child.exitCode) process.stderr.write(errors.slice(-4000));
  rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

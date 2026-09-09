import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { waitForElectronDebugger } from "./electron-debugger-readiness";

const root = resolve(import.meta.dir, "..");
const home = mkdtempSync(join(tmpdir(), "maria-response-electron-"));
const electron = createRequire(join(root, "launcher/package.json"))("electron") as string;
// Reuse the existing offline Electron shell, with a fresh profile and no production browser data.
const args = [electron, join(root, "launcher/scripts/astra-picker-electron.cjs")];
if (process.platform === "linux") { args.push("--no-sandbox"); args.unshift("xvfb-run", "-a"); }
const environment: NodeJS.ProcessEnv = { ...process.env, ASTRA_PICKER_TEST_HOME: home };
delete environment.ELECTRON_RUN_AS_NODE;
const child = Bun.spawn(args, { cwd: root, env: environment, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
const stderr = new Response(child.stderr).text();
try {
  const websocket = await waitForElectronDebugger(join(home, "DevToolsActivePort"), () => child.exitCode === null);
  const build = await Bun.build({ entrypoints: [join(root, "scripts/response-state-driver.ts")], target: "node", format: "esm", outdir: home, naming: "driver.mjs" });
  assert(build.success, `Response driver build failed: ${build.logs.join("\n")}`);
  const driver = Bun.spawn([electron, join(home, "driver.mjs"), websocket], {
    cwd: root, env: { ...environment, ELECTRON_RUN_AS_NODE: "1" }, stdout: "pipe", stderr: "pipe",
  });
  const [status, stdout, errors] = await Promise.all([driver.exited, new Response(driver.stdout).text(), new Response(driver.stderr).text()]);
  assert.equal(status, 0, `Electron response-state fixture failed: ${errors}`);
  assert(stdout.includes("RESPONSE_STATE_ELECTRON_OK"));
  process.stdout.write(stdout);
} finally {
  writeFileSync(join(home, "stop"), "stop");
  const stopped = await Promise.race([child.exited.then(() => true), Bun.sleep(5_000).then(() => false)]);
  if (!stopped) child.kill();
  await child.exited;
  if (child.exitCode) process.stderr.write((await stderr).slice(-4000));
  rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

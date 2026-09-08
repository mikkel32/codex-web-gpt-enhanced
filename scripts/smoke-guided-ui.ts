import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createRequire } from "node:module";
import { waitForElectronDebugger } from "./electron-debugger-readiness";

const root = resolve(import.meta.dir, "..");
const dist = join(root, "launcher", "dist");
assert(existsSync(join(dist, "index.html")), "Build the renderer before running its smoke test");
const home = mkdtempSync(join(tmpdir(), "maria-guided-ui-"));
const electron = createRequire(join(root, "launcher/package.json"))("electron") as string;
const environment: NodeJS.ProcessEnv = { ...process.env, GUIDED_UI_TEST_HOME: home };
delete environment.ELECTRON_RUN_AS_NODE;
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const pathname = new URL(request.url).pathname;
  const file = resolve(dist, `.${pathname === "/" ? "/index.html" : pathname}`);
  if (!file.startsWith(`${dist}${sep}`)) return new Response("Forbidden", { status: 403 });
  const content = Bun.file(file);
  return await content.exists() ? new Response(content) : new Response("Not found", { status: 404 });
} });
const args = [electron, join(root, "launcher/scripts/guided-ui-electron.cjs")];
if (process.platform === "linux") { args.push("--no-sandbox"); args.unshift("xvfb-run", "-a"); }
const child = Bun.spawn(args, { cwd: root, env: environment, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
const stderr = new Response(child.stderr).text();
const stdout = new Response(child.stdout).text();
let driver: ReturnType<typeof Bun.spawn> | undefined;
let completed = false;
try {
  const websocket = await waitForElectronDebugger(join(home, "DevToolsActivePort"), () => child.exitCode === null);
  const build = await Bun.build({ entrypoints: [join(root, "scripts/guided-ui-driver.ts")], target: "node", format: "esm", outdir: home, naming: "driver.mjs" });
  assert(build.success, build.logs.map(String).join("\n"));
  const runningDriver = Bun.spawn([electron, join(home, "driver.mjs"), websocket, `http://127.0.0.1:${server.port}`], {
    cwd: root, env: { ...environment, ELECTRON_RUN_AS_NODE: "1" }, stdin: "ignore", stdout: "pipe", stderr: "pipe",
  });
  driver = runningDriver;
  const output = (async () => {
    let text = ""; const decoder = new TextDecoder();
    for await (const chunk of runningDriver.stdout) { const line = decoder.decode(chunk, { stream: true }); text += line; process.stdout.write(line); }
    return text + decoder.decode();
  })();
  const errors = new Response(runningDriver.stderr).text();
  const timer = setTimeout(() => driver?.kill(), 180_000);
  try {
    assert.equal(await driver.exited, 0, `Guided renderer checks failed: ${await output}\n${await errors}`);
    const result = await output;
    assert(result.includes("GUIDED_RENDERER_OK"), "Renderer driver did not complete");
    completed = true;
  } finally { clearTimeout(timer); }
} finally {
  if (driver && driver.exitCode === null) { driver.kill(); await driver.exited; }
  writeFileSync(join(home, "stop"), "stop");
  const stopped = await Promise.race([child.exited.then(() => true), Bun.sleep(5000).then(() => false)]);
  if (!stopped) child.kill();
  await child.exited; server.stop(true);
  const errors = await stderr; await stdout;
  if (!completed) process.stderr.write(errors.slice(-4000));
  rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

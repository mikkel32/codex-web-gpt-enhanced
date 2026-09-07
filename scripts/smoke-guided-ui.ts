import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createRequire } from "node:module";

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
  const portFile = join(home, "DevToolsActivePort"), deadline = Date.now() + 30_000;
  while (!existsSync(portFile) && child.exitCode === null && Date.now() < deadline) await Bun.sleep(50);
  assert(existsSync(portFile), "Isolated Electron renderer did not publish its debugger");
  const port = Number(readFileSync(portFile, "utf8").split("\n")[0]);
  let websocket = "";
  while (!websocket && child.exitCode === null && Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) websocket = (await response.json() as { webSocketDebuggerUrl: string }).webSocketDebuggerUrl;
    } catch { /* The port marker may precede HTTP readiness. */ }
    if (!websocket) await Bun.sleep(50);
  }
  assert(websocket.startsWith(`ws://127.0.0.1:${port}/devtools/browser/`), "Invalid isolated Electron debugger endpoint");
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

const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const net = require("node:net");
const { randomBytes } = require("node:crypto");
const { isolatedDevEnvironment } = require("../electron/dev-environment.cjs");

const root = path.resolve(__dirname, "..");
const vitePackage = require.resolve("vite/package.json", { paths: [root] });
const viteBin = path.join(path.dirname(vitePackage), "bin", "vite.js");
const electronBin = require("electron");
const bun = process.env.CODEX_WEB_GPT_BUN || process.execPath;
const devEnvironment = isolatedDevEnvironment(path.resolve(root, ".."));
const nonce = randomBytes(24).toString("hex");

const helperBuild = spawnSync(bun, ["run", "scripts/build-browser-helper.ts"], {
  cwd: path.resolve(root, ".."),
  env: process.env,
  stdio: "inherit",
});
if (helperBuild.error) throw helperBuild.error;
if (helperBuild.status !== 0) process.exit(helperBuild.status ?? 1);

let vite;
let viteUrl;

let electron;
let stopped = false;

const stop = () => {
  if (stopped) return;
  stopped = true;
  electron?.kill("SIGTERM");
  vite?.kill("SIGTERM");
};

const waitForVite = async () => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (stopped || vite?.exitCode !== null) throw new Error("Development server stopped before readiness");
    try {
      const response = await fetch(`${viteUrl}/__maria_dev_ready`);
      if (response.ok && await response.text() === nonce) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("The isolated development server did not become ready");
};

void (async () => {
  const probe = net.createServer();
  await new Promise((resolve, reject) => { probe.once("error", reject); probe.listen(0, "127.0.0.1", resolve); });
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  viteUrl = `http://127.0.0.1:${port}`;
  vite = spawn(process.execPath, [viteBin, "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: root, stdio: "inherit", env: { ...devEnvironment, MARIA_DEV_SERVER_NONCE: nonce },
  });
  vite.once("exit", code => { if (!stopped) { stop(); process.exitCode = code || 1; } });
  vite.once("error", error => { console.error(error.message); stop(); process.exitCode = 1; });
  await waitForVite();
  electron = spawn(electronBin, [root, "--dev-profile"], {
    cwd: root,
    stdio: "inherit",
    env: {
      ...devEnvironment,
      VITE_DEV_SERVER_URL: viteUrl,
      CODEX_WEB_GPT_BUN: bun,
      CODEX_CHATGPT_WEB_BUN: bun,
    },
  });
  electron.once("exit", (code) => {
    stop();
    process.exitCode = code ?? 0;
  });
  electron.once("error", (error) => {
    console.error(`Electron failed to start: ${error.message}`);
    stop();
    process.exitCode = 1;
  });
})().catch((error) => {
  console.error(error);
  stop();
  process.exitCode = 1;
});

process.once("SIGINT", stop);
process.once("SIGTERM", stop);

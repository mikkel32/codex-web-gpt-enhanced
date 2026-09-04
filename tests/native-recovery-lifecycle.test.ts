import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defaultConfig } from "../src/config";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { RuntimeSupervisor } = require("../launcher/electron/runtime-supervisor.cjs");
const { NativeRecovery } = require("../launcher/electron/native-recovery.cjs");

test("the independent guardian replaces a crashed native transport without a launcher", async () => {
  const root = mkdtempSync(join(tmpdir(), "maria-native-recovery-"));
  const core = join(root, "core"); const codex = join(root, "codex");
  mkdirSync(join(core, "runtime"), { recursive: true }); mkdirSync(join(core, "codex")); mkdirSync(codex);
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("ok") });
  const port = probe.port!; probe.stop(true);
  const config = {
    ...defaultConfig("browser-only"), port, browserHost: "launcher" as const,
    browserHostDescriptorPath: join(core, "runtime", "launcher-browser.json"),
    storageStatePath: join(core, "browser", "storage-state.json"),
    brokerSocketPath: process.platform === "win32" ? `\\\\.\\pipe\\maria-recovery-${crypto.randomUUID()}` : join(core, "runtime", "broker.sock"),
    runtimeCommand: [process.execPath, resolve(import.meta.dir, "../src/cli.ts")],
  };
  writeFileSync(join(core, "config.json"), JSON.stringify(config));
  writeFileSync(join(core, "codex", "integration-journal.json"), JSON.stringify({ version: 10, active: true }));
  const guardian = Bun.spawn([...config.runtimeCommand, "--home", core, "guard"], {
    env: { ...process.env, CODEX_HOME: codex, CODEX_CHATGPT_WEB_HOME: core }, stdout: "ignore", stderr: "ignore",
  });
  let workerPid: number | undefined;
  let supervisor: any;
  const wait = async (previousPid?: number) => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      try {
        const health = await (await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(500) })).json() as { pid: number; browser_connected: boolean; accepting_turns: boolean };
        if (health.pid !== previousPid && health.browser_connected === false && health.accepting_turns) return health.pid;
      } catch {}
      await Bun.sleep(100);
    }
    throw new Error("Native recovery did not provide a healthy replacement");
  };
  try {
    workerPid = await wait();
    const first = workerPid;
    process.kill(first, "SIGKILL");
    workerPid = await wait(first);
    expect(workerPid).not.toBe(first);
    const owner = JSON.parse(readFileSync(join(core, "runtime", "launcher-supervisor.json"), "utf8"));
    expect(owner.manager).toBe("native-guardian"); expect(owner.daemonPid).toBe(workerPid);
    const web = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "chatgpt-web/high", input: [] }),
    });
    expect(web.status).toBe(503);
    const logger = { info() {}, warn() {}, error() {} };
    supervisor = new RuntimeSupervisor({
      app: { getVersion: () => config.releaseVersion }, coreHome: core,
      browserDescriptorPath: config.browserHostDescriptorPath, logger,
      nativeRecovery: new NativeRecovery({ coreHome: core, logger, persistent: false }),
    });
    supervisor.readConfig = () => config;
    const adopted = await supervisor.startIfConfigured();
    expect(adopted.daemonPid).toBe(workerPid);
    await supervisor.stopForSetup();
    workerPid = undefined;
    await Bun.sleep(2200);
    await expect(fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(500) })).rejects.toThrow();
  } finally {
    if (existsSync(join(core, "config.json"))) rmSync(join(core, "config.json"));
    guardian.kill("SIGTERM");
    await Promise.race([guardian.exited, Bun.sleep(3000).then(() => guardian.kill("SIGKILL"))]);
    if (workerPid) {
      try { process.kill(workerPid, "SIGTERM"); } catch {}
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        try { process.kill(workerPid, 0); } catch { break; }
        await Bun.sleep(50);
      }
    }
    supervisor?.daemon?.release?.();
    rmSync(root, { recursive: true, force: true });
  }
}, 30000);

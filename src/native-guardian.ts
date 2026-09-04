import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { uptime } from "node:os";
import { atomicWriteFile, assertDurableRuntimeCommand, getConfigDir, getConfigPath, loadConfig, type AppConfig } from "./config";
import { processRunning } from "./process";

export interface GuardianOwner {
  ownerPid: number;
  daemonPid: number | null;
  status: string;
  updatedAt: string;
  manager?: string;
}

export function guardianMayRecover(owner: GuardianOwner | null, guardianPid: number, alive: (pid: number) => boolean, bootStartedAt: number): boolean {
  if (!owner || Date.parse(owner.updatedAt) < bootStartedAt - 5_000) return true;
  if (owner.ownerPid !== guardianPid && alive(owner.ownerPid)) return false;
  // An unresponsive live process needs diagnosis; never kill a PID on stale file evidence.
  return owner.daemonPid === null || !alive(owner.daemonPid);
}

function readOwner(path: string): GuardianOwner | null {
  if (!existsSync(path)) return null;
  const value = JSON.parse(readFileSync(path, "utf8"));
  if (!value || value.version !== 1 || !Number.isInteger(value.ownerPid)
    || value.ownerPid < 1 || (value.daemonPid !== null && (!Number.isInteger(value.daemonPid) || value.daemonPid < 1))
    || !Number.isFinite(Date.parse(value.updatedAt))) throw new Error("Native ownership marker is invalid");
  return value;
}

async function healthy(config: AppConfig): Promise<boolean> {
  try {
    const response = await fetch(`http://${config.host}:${config.port}/healthz`, { signal: AbortSignal.timeout(1500) });
    const body = await response.json() as Record<string, unknown>;
    return response.ok && body.service === "codex-chatgpt-web" && body.status === "ok";
  } catch { return false; }
}

export async function runNativeGuardian(): Promise<void> {
  const initial = loadConfig();
  if (initial.purpose === "dev-harness" || initial.browserHost !== "launcher") {
    throw new Error("Native recovery is available only for an installed production launcher");
  }
  const runtime = join(getConfigDir(), "runtime");
  mkdirSync(runtime, { recursive: true, mode: 0o700 });
  const lock = join(runtime, "native-guardian.lock");
  const marker = join(runtime, "native-guardian.json");
  const ownerPath = join(runtime, "launcher-supervisor.json");
  const boot = Date.now() - uptime() * 1000;
  const nonce = crypto.randomUUID();
  const identity = { version: 1, pid: process.pid, nonce, startedAt: new Date().toISOString() };
  try {
    const fd = openSync(lock, "wx", 0o600);
    try { writeFileSync(fd, JSON.stringify(identity)); } finally { closeSync(fd); }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    // A second start never races a partially written lock or replaces a live owner.
    if (Date.now() - statSync(lock).mtimeMs < 5000) return;
    let previous;
    try { previous = JSON.parse(readFileSync(lock, "utf8")); } catch { return; }
    if (Date.parse(previous.startedAt) >= boot - 5000 && processRunning(previous.pid)) return;
    rmSync(lock);
    return runNativeGuardian();
  }
  atomicWriteFile(marker, JSON.stringify(identity));
  let stopped = false;
  const stop = () => { stopped = true; };
  process.once("SIGTERM", stop); process.once("SIGINT", stop);
  let failures = 0;
  try {
    while (!stopped && existsSync(getConfigPath())) {
      try {
        const config = loadConfig();
        if (config.purpose === "dev-harness" || config.browserHost !== "launcher") break;
        const journalPath = join(getConfigDir(), "codex", "integration-journal.json");
        const journal = existsSync(journalPath) ? JSON.parse(readFileSync(journalPath, "utf8")) : null;
        const pausePath = join(runtime, "native-recovery-pause.json");
        const pause = existsSync(pausePath) ? JSON.parse(readFileSync(pausePath, "utf8")) : null;
        const paused = pause?.version === 1 && Date.parse(pause.updatedAt) >= boot - 5000 && processRunning(pause.pid);
        if (!paused && journal?.active === true && !await healthy(config)) {
          const owner = readOwner(ownerPath);
          if (guardianMayRecover(owner, process.pid, processRunning, boot)) {
            assertDurableRuntimeCommand(config.runtimeCommand);
            const before = existsSync(ownerPath) ? readFileSync(ownerPath, "utf8") : null;
            const logDir = join(getConfigDir(), "logs"); mkdirSync(logDir, { recursive: true, mode: 0o700 });
            const output = openSync(join(logDir, "native-runtime.log"), "a", 0o600);
            let child;
            try {
              child = spawn(config.runtimeCommand[0]!, [...config.runtimeCommand.slice(1), "serve", "--native-only"], {
                env: { ...process.env, CODEX_CHATGPT_WEB_HOME: getConfigDir() },
                detached: true, windowsHide: true, stdio: ["ignore", output, output],
              });
            } finally { closeSync(output); }
            child.on("error", error => console.error(`[maria-native-recovery] ${error.message}`));
            child.unref();
            const unchanged = (existsSync(ownerPath) ? readFileSync(ownerPath, "utf8") : null) === before;
            if (child.pid && unchanged) atomicWriteFile(ownerPath, JSON.stringify({
              version: 1, ownerPid: process.pid, daemonPid: child.pid, tunnelPid: null,
              status: "background", manager: "native-guardian", updatedAt: new Date().toISOString(),
            }));
            failures = Math.min(failures + 1, 5);
            console.info(`[maria-native-recovery] restarted native transport pid=${child.pid ?? "unavailable"}`);
          }
        } else failures = 0;
      } catch (error) {
        failures = Math.min(failures + 1, 5);
        console.error(`[maria-native-recovery] ${error instanceof Error ? error.message : String(error)}`);
      }
      const delay = Math.min(30_000, 1000 * 2 ** failures);
      for (let waited = 0; waited < delay && !stopped; waited += 250) await new Promise(resolve => setTimeout(resolve, 250));
    }
  } finally {
    process.removeListener("SIGTERM", stop); process.removeListener("SIGINT", stop);
    for (const path of [marker, lock]) {
      try { if (JSON.parse(readFileSync(path, "utf8")).nonce === nonce) rmSync(path); } catch {}
    }
  }
}

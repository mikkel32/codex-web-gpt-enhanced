const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { processRunning } = require("./process-tree.cjs");
const { writePrivateFileAtomic } = require("./atomic-file.cjs");

const LABEL = "dev.maria.codex-native-recovery";
const xml = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

function guardianStatus(coreHome) {
  try {
    const marker = JSON.parse(fs.readFileSync(path.join(coreHome, "runtime", "native-guardian.json"), "utf8"));
    const boot = Date.now() - os.uptime() * 1000;
    return { running: marker.version === 1 && Date.parse(marker.startedAt) >= boot - 5000 && processRunning(marker.pid), pid: marker.pid };
  } catch { return { running: false }; }
}

function guardianPlist(command, coreHome, logs) {
  return `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
<key>Label</key><string>${LABEL}</string><key>ProgramArguments</key><array>${command.map(x => `<string>${xml(x)}</string>`).join("")}</array>
<key>EnvironmentVariables</key><dict><key>CODEX_CHATGPT_WEB_HOME</key><string>${xml(coreHome)}</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer>
<key>StandardOutPath</key><string>${xml(logs)}</string><key>StandardErrorPath</key><string>${xml(logs)}</string>
<key>ProcessType</key><string>Background</string></dict></plist>\n`;
}

class NativeRecovery {
  constructor({ coreHome, logger, persistent = process.platform === "darwin" }) {
    this.coreHome = coreHome; this.logger = logger; this.persistent = persistent;
    this.plistPath = path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
  }
  status() { return guardianStatus(this.coreHome); }
  pause() {
    writePrivateFileAtomic(path.join(this.coreHome, "runtime", "native-recovery-pause.json"), JSON.stringify({ version: 1, pid: process.pid, updatedAt: new Date().toISOString() }));
  }
  resume() {
    const file = path.join(this.coreHome, "runtime", "native-recovery-pause.json");
    try {
      const pause = JSON.parse(fs.readFileSync(file, "utf8"));
      if (pause.pid === process.pid || !processRunning(pause.pid)) fs.rmSync(file);
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  async ensure(config) {
    if (this.ensurePromise) return this.ensurePromise;
    const pending = this.ensureOnce(config);
    this.ensurePromise = pending;
    try { return await pending; }
    finally { if (this.ensurePromise === pending) this.ensurePromise = null; }
  }
  async ensureOnce(config) {
    this.resume();
    const command = [...config.runtimeCommand, "--home", this.coreHome, "guard"];
    const logsDir = path.join(this.coreHome, "logs"); fs.mkdirSync(logsDir, { recursive: true, mode: 0o700 });
    const log = path.join(logsDir, "native-recovery.log");
    if (this.persistent && process.platform === "darwin") {
      const body = guardianPlist(command, this.coreHome, log);
      const changed = !fs.existsSync(this.plistPath) || fs.readFileSync(this.plistPath, "utf8") !== body;
      if (changed) {
        writePrivateFileAtomic(this.plistPath, body);
        spawnSync("launchctl", ["bootout", `gui/${process.getuid()}/${LABEL}`], { stdio: "ignore", timeout: 5000 });
      }
      const present = spawnSync("launchctl", ["print", `gui/${process.getuid()}/${LABEL}`], { stdio: "ignore", timeout: 5000 });
      if (present.status !== 0) {
        const loaded = spawnSync("launchctl", ["bootstrap", `gui/${process.getuid()}`, this.plistPath], { encoding: "utf8", timeout: 10000 });
        if (loaded.status === 0) return;
        this.logger.warn("native_recovery.login_service_unavailable", { message: loaded.stderr?.trim() || "Could not start login service" });
      } else return;
    }
    if (this.status().running) return;
    const output = fs.openSync(log, "a", 0o600);
    try {
      const child = spawn(command[0], command.slice(1), { env: { ...process.env, CODEX_CHATGPT_WEB_HOME: this.coreHome }, detached: true, windowsHide: true, stdio: ["ignore", output, output] });
      child.on("error", error => this.logger.warn("native_recovery.start_failed", { message: error.message })); child.unref();
      // Keep concurrent ensure calls joined until the child has published its ownership.
      const deadline = Date.now() + 5_000;
      while (child.pid && processRunning(child.pid) && !this.status().running && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } finally { fs.closeSync(output); }
  }
  async stop() {
    if (this.ensurePromise) await this.ensurePromise;
    this.pause();
    if (process.platform === "darwin" && this.persistent && fs.existsSync(this.plistPath)) {
      spawnSync("launchctl", ["bootout", `gui/${process.getuid()}/${LABEL}`], { stdio: "ignore", timeout: 5000 });
      fs.rmSync(this.plistPath);
    }
    const status = this.status();
    if (status.running) { try { process.kill(status.pid, "SIGTERM"); } catch {} }
  }
}

module.exports = { NativeRecovery, guardianStatus, guardianPlist };

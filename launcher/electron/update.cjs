const crypto = require("node:crypto");
const fs = require("node:fs");
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { pipeline } = require("node:stream/promises");

const REPOSITORY = "mikkel32/codex-web-gpt-enhanced";
const RELEASE_API_URL = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
const USER_AGENT = "codex-web-gpt-launcher-updater";
const MAX_REDIRECTS = 5;
const CHECK_INTERVAL_MS = 4 * 60 * 60_000;
const FOCUS_CHECK_INTERVAL_MS = 15 * 60_000;
const RELEASES_URL = `https://github.com/${REPOSITORY}/releases`;

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(value || "").trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] || null,
  };
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) throw new Error(`Invalid release version comparison: ${left} / ${right}`);
  for (const key of ["major", "minor", "patch"]) {
    if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;
  return a.prerelease.localeCompare(b.prerelease, "en", { numeric: true });
}

function releaseVersion(tagName) {
  const version = String(tagName || "").replace(/^v/, "");
  if (!parseVersion(version)) throw new Error(`GitHub returned an invalid release tag: ${tagName}`);
  return version;
}

function releaseAssetName(version, platform = process.platform, arch = process.arch) {
  if (platform === "darwin" && ["arm64", "x64"].includes(arch)) {
    return `codex-web-gpt-${version}-mac-${arch}.zip`;
  }
  if (platform === "win32" && arch === "x64") {
    return `codex-web-gpt-${version}-win-x64.exe`;
  }
  if (platform === "linux" && arch === "x64") {
    return `codex-web-gpt-${version}-linux-x64.AppImage`;
  }
  return null;
}

function expectedChecksum(contents, assetName) {
  for (const line of String(contents || "").split(/\r?\n/)) {
    const match = /^([a-fA-F0-9]{64})\s+(.+)$/.exec(line.trim());
    if (match && match[2] === assetName) return match[1].toLowerCase();
  }
  throw new Error(`checksums.txt has no entry for ${assetName}`);
}

function validateReleaseAssetUrl(raw, version, assetName) {
  const url = new URL(raw);
  const expectedPath = `/${REPOSITORY}/releases/download/v${version}/${assetName}`;
  if (url.origin !== "https://github.com" || url.username || url.password || url.search || url.hash || url.pathname !== expectedPath) {
    throw new Error(`GitHub returned an unexpected release asset URL for ${assetName}`);
  }
  return url.toString();
}

function updateRequestHeaders(url, { token, accept } = {}) {
  const parsed = new URL(url);
  const headers = { Accept: accept || "application/vnd.github+json", "User-Agent": USER_AGENT };
  if (token && parsed.origin === "https://api.github.com"
    && parsed.pathname.startsWith(`/repos/${REPOSITORY}/releases/`)) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function request(url, options = {}, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > MAX_REDIRECTS) {
      reject(new Error(`Too many redirects while downloading ${url}`));
      return;
    }
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      reject(new Error(`Refusing non-HTTPS update URL: ${parsed.protocol}`));
      return;
    }
    const req = https.get(parsed, {
      headers: updateRequestHeaders(url, options),
    }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        const next = new URL(response.headers.location, parsed).toString();
        // Signed asset redirects never receive the repository credential.
        request(next, { accept: options.accept }, redirects + 1).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        const error = new Error(`GitHub update request returned HTTP ${response.statusCode}`);
        error.statusCode = response.statusCode;
        reject(error);
        return;
      }
      resolve(response);
    });
    req.setTimeout(60_000, () => req.destroy(new Error("Update request timed out")));
    req.once("error", reject);
  });
}

async function downloadText(url, options = {}, maxBytes = 2 * 1024 * 1024) {
  const response = await request(url, options);
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw new Error("Update metadata exceeded its size limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function downloadFile(url, destination, options = {}) {
  const response = await request(url, options);
  await pipeline(response, fs.createWriteStream(destination, { flags: "wx", mode: 0o600 }));
}

function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const count = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (count === 0) break;
      hash.update(buffer.subarray(0, count));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

function macApplicationPath(executablePath) {
  const match = /^(.*\.app)[\\/]Contents[\\/]MacOS[\\/][^\\/]+$/.exec(executablePath);
  if (!match?.[1]) throw new Error(`Could not resolve the macOS application bundle from ${executablePath}`);
  return match[1];
}

function findMacApplication(root) {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const appEntry = entries.find((entry) => entry.isDirectory() && entry.name.endsWith(".app"));
  if (!appEntry) throw new Error("The macOS update archive does not contain an application bundle");
  const application = path.join(root, appEntry.name);
  const executable = path.join(application, "Contents", "MacOS", "Maria WebGPT");
  if (!fs.existsSync(executable) || !fs.statSync(executable).isFile()) {
    throw new Error("The macOS update archive is incomplete");
  }
  return application;
}

function buildJob({ version, platform, executablePath, assetPath, stagingRoot, tempRoot, logPath }) {
  if (platform === "darwin") {
    return {
      version,
      platform,
      parentPid: process.pid,
      tempRoot,
      logPath,
      source: findMacApplication(stagingRoot),
      target: macApplicationPath(executablePath),
    };
  }
  if (platform === "win32") {
    return {
      version,
      platform,
      parentPid: process.pid,
      tempRoot,
      logPath,
      source: assetPath,
      target: executablePath,
    };
  }
  if (platform === "linux") {
    const target = process.env.CODEX_WEB_GPT_APPIMAGE?.trim()
      || process.env.APPIMAGE?.trim();
    if (!target || !path.isAbsolute(target)) {
      throw new Error("The running Linux AppImage path is unavailable; reinstall with install-launcher.sh");
    }
    const wrapper = process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE?.trim();
    if (!wrapper || !path.isAbsolute(wrapper)) {
      throw new Error("Linux auto-update requires the stable install-launcher.sh wrapper; reinstall once");
    }
    return {
      version,
      platform,
      parentPid: process.pid,
      tempRoot,
      logPath,
      source: assetPath,
      target,
      wrapper,
      runnerSource: path.join(tempRoot, "linux-appimage-runner.sh"),
    };
  }
  throw new Error(`Updates are not supported on ${platform}`);
}

function defaultDependencies() {
  return {
    fetchRelease: async (token) => JSON.parse(await downloadText(RELEASE_API_URL, { token })),
    downloadText,
    downloadFile,
    sha256,
    extractMac(archive, destination) {
      fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
      const result = spawnSync("/usr/bin/ditto", ["-x", "-k", archive, destination], {
        encoding: "utf8",
        timeout: 120_000,
      });
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(`Could not extract the macOS update: ${result.stderr.trim()}`);
    },
    linuxRunnerSource() {
      if (typeof process.resourcesPath === "string" && process.resourcesPath) {
        const unpacked = path.join(
          process.resourcesPath,
          "app.asar.unpacked",
          "assets",
          "linux-appimage-runner.sh",
        );
        if (fs.statSync(unpacked, { throwIfNoEntry: false })?.isFile()) return unpacked;
      }
      const source = path.resolve(__dirname, "..", "assets", "linux-appimage-runner.sh");
      if (fs.statSync(source, { throwIfNoEntry: false })?.isFile()) return source;
      throw new Error("Packaged Linux AppImage runner is missing");
    },
    spawnWorker(runtimeExecutable, workerPath, jobPath) {
      return spawn(runtimeExecutable, [workerPath, jobPath], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
    },
  };
}

function createUpdateController({
  currentVersion,
  platform,
  arch,
  packaged,
  executablePath,
  runtimeExecutable,
  logsDirectory,
  publish,
  logger,
  credentials,
  dependencies = {},
}) {
  const deps = { ...defaultDependencies(), ...dependencies };
  const supportedAsset = releaseAssetName(currentVersion, platform, arch);
  let state = packaged && supportedAsset ? { status: "idle" } : { status: "disabled" };
  let lastAttemptAt = 0;
  let checkedAt;
  let checking = null;
  let timer;
  let pending = null;
  let candidate = null;

  const transition = (next) => {
    state = { ...next, ...(checkedAt ? { checkedAt } : {}), authenticated: credentials?.configured() === true };
    publish?.(state);
    return state;
  };

  async function performCheck() {
    lastAttemptAt = Date.now();
    transition({ status: "checking", ...(candidate ? { version: candidate.version } : {}) });
    try {
      const token = credentials?.read();
      const release = await deps.fetchRelease(token);
      if (release?.draft || release?.prerelease) throw new Error("GitHub has not published a stable release yet.");
      const version = releaseVersion(release?.tag_name);
      if (compareVersions(version, currentVersion) <= 0) {
        candidate = null;
        checkedAt = new Date().toISOString();
        return transition({ status: compareVersions(version, currentVersion) === 0 ? "up-to-date" : "ahead", latestVersion: version });
      }
      const assetName = releaseAssetName(version, platform, arch);
      if (!assetName) return transition({ status: "disabled" });
      const assets = Array.isArray(release?.assets) ? release.assets : [];
      const asset = assets.find((item) => item?.name === assetName);
      const checksums = assets.find((item) => item?.name === "checksums.txt");
      if (!asset?.browser_download_url || !checksums?.browser_download_url) {
        throw new Error(`Release v${version} is missing ${assetName} or checksums.txt`);
      }
      const nextCandidate = {
        version,
        assetName,
        assetUrl: validateReleaseAssetUrl(asset.browser_download_url, version, assetName),
        checksumsUrl: validateReleaseAssetUrl(checksums.browser_download_url, version, "checksums.txt"),
      };
      if (token) {
        for (const [key, item] of [["assetUrl", asset], ["checksumsUrl", checksums]]) {
          if (!Number.isSafeInteger(item.id) || item.id <= 0) throw new Error("GitHub release asset identity is missing.");
          nextCandidate[key] = `https://api.github.com/repos/${REPOSITORY}/releases/assets/${item.id}`;
        }
      }
      candidate = nextCandidate;
      checkedAt = new Date().toISOString();
      logger?.info("launcher.update_available", { currentVersion, version, platform, arch });
      return transition({ status: "available", version });
    } catch (error) {
      const accessRequired = [401, 403, 404].includes(error?.statusCode);
      const message = accessRequired
        ? "GitHub could not grant access to this release. Connect a token with read access to our repository, or open releases in your browser. A 404 can also mean no release has been published."
        : error instanceof Error ? error.message : String(error);
      logger?.warn("launcher.update_check_failed", { message });
      return transition({ status: accessRequired ? "access-required" : "error", message, ...(candidate ? { version: candidate.version } : {}) });
    }
  }

  function check({ force = false, minAge = FOCUS_CHECK_INTERVAL_MS } = {}) {
    if (checking) return checking;
    if (state.status === "disabled" || pending || state.status === "installing"
      || (!force && lastAttemptAt && Date.now() - lastAttemptAt < minAge)) return Promise.resolve(state);
    checking = performCheck().finally(() => { checking = null; });
    return checking;
  }

  function start() {
    if (timer || state.status === "disabled") return;
    void check();
    timer = setInterval(() => void check({ minAge: CHECK_INTERVAL_MS }), CHECK_INTERVAL_MS);
    timer.unref?.();
  }

  async function beginInstall() {
    if (pending) throw new Error("An update is already being prepared");
    if (checking || !["available", "error"].includes(state.status) || !candidate) throw new Error("Check for updates before installing.");
    const available = candidate;
    pending = (async () => {
      transition({ status: "downloading", version: available.version });
      const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codex-web-gpt-update-"));
      try {
        const options = { token: credentials?.read(), accept: "application/octet-stream" };
        const checksums = await deps.downloadText(available.checksumsUrl, options);
        const expected = expectedChecksum(checksums, available.assetName);
        const assetPath = path.join(tempRoot, available.assetName);
        await deps.downloadFile(available.assetUrl, assetPath, options);
        const actual = deps.sha256(assetPath);
        if (actual !== expected) throw new Error(`SHA-256 verification failed for ${available.assetName}`);

        const stagingRoot = path.join(tempRoot, "stage");
        if (platform === "darwin") deps.extractMac(assetPath, stagingRoot);
        if (platform === "linux") {
          fs.chmodSync(assetPath, 0o755);
          const runnerSource = deps.linuxRunnerSource();
          fs.copyFileSync(runnerSource, path.join(tempRoot, "linux-appimage-runner.sh"));
          fs.chmodSync(path.join(tempRoot, "linux-appimage-runner.sh"), 0o755);
        }

        const workerPath = path.join(tempRoot, "update-worker.cjs");
        fs.copyFileSync(path.join(__dirname, "update-worker.cjs"), workerPath);
        const job = buildJob({
          version: available.version,
          platform,
          executablePath,
          assetPath,
          stagingRoot,
          tempRoot,
          logPath: path.join(logsDirectory, "update-worker.log"),
        });
        const jobPath = path.join(tempRoot, "job.json");
        fs.writeFileSync(jobPath, `${JSON.stringify(job)}\n`, { mode: 0o600 });
        const child = deps.spawnWorker(runtimeExecutable, workerPath, jobPath);
        if (!Number.isInteger(child?.pid) || child.pid <= 0) throw new Error("The update worker did not start");
        child.unref?.();
        logger?.info("launcher.update_worker_started", { pid: child.pid, version: available.version });
        transition({ status: "installing", version: available.version });
        return { child, tempRoot, version: available.version };
      } catch (error) {
        fs.rmSync(tempRoot, { recursive: true, force: true });
        transition({ status: "available", version: available.version });
        throw error;
      }
    })();
    try {
      return await pending;
    } finally {
      pending = null;
    }
  }

  function cancelInstall(launch) {
    try { launch?.child?.kill(); } catch {}
    if (launch?.tempRoot) fs.rmSync(launch.tempRoot, { recursive: true, force: true });
    if (candidate) transition({ status: "available", version: candidate.version });
  }

  return {
    getState: () => state,
    checkOnce: () => check(),
    check,
    start,
    stop: () => { clearInterval(timer); timer = null; },
    async setToken(token) {
      if (pending || checking || state.status === "installing") throw new Error("Wait for the update operation to finish.");
      if (!credentials) throw new Error("Secure credential storage is unavailable.");
      if (token === null) credentials.clear();
      else credentials.save(token);
      candidate = null;
      return check({ force: true });
    },
    beginInstall,
    cancelInstall,
  };
}

module.exports = {
  RELEASES_URL,
  updateRequestHeaders,
  buildJob,
  compareVersions,
  createUpdateController,
  expectedChecksum,
  macApplicationPath,
  parseVersion,
  releaseAssetName,
  releaseVersion,
  validateReleaseAssetUrl,
};

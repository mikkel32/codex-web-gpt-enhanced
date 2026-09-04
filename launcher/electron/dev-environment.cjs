const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");

function canonical(candidate) {
  let parent = path.resolve(candidate); const suffix = [];
  while (!fs.existsSync(parent)) {
    const next = path.dirname(parent); if (next === parent) break;
    suffix.unshift(path.basename(parent)); parent = next;
  }
  return path.join(fs.existsSync(parent) ? fs.realpathSync(parent) : parent, ...suffix);
}
function overlaps(left, right) {
  const within = (a, b) => { const relative = path.relative(b, a); return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)); };
  return within(left, right) || within(right, left);
}
function assertDevStorageIsolated(devHome, environment = process.env, homeDirectory = os.homedir()) {
  const protectedHomes = [
    path.join(homeDirectory, ".codex"), path.join(homeDirectory, ".codex-chatgpt-web"),
    environment.CODEX_HOME, environment.CODEX_CHATGPT_WEB_HOME, environment.CODEX_WEB_GPT_LAUNCHER_DATA_DIR,
  ].filter(Boolean).map(canonical);
  if (protectedHomes.some(production => overlaps(canonical(devHome), production))) throw new Error("Development storage must not overlap production Codex or Maria data");
}
function isolatedDevEnvironment(workspace, environment = process.env, homeDirectory = os.homedir()) {
  const root = canonical(workspace);
  const identity = createHash("sha256").update(process.platform === "win32" ? root.toLowerCase() : root).digest("hex").slice(0, 16);
  const requested = environment.CODEX_WEB_GPT_DEV_HOME?.trim();
  const devHome = canonical(requested
    ? requested.replace(/^~(?=[/\\]|$)/, homeDirectory)
    : path.join(homeDirectory, ".codex-chatgpt-web-dev", "workspaces", identity));
  assertDevStorageIsolated(devHome, environment, homeDirectory);
  const env = { ...environment };
  for (const key of Object.keys(env)) {
    if (["CODEX_HOME", "CODEX_CHATGPT_WEB_HOME", "CODEX_WEB_GPT_LAUNCHER_DATA_DIR", "ELECTRON_RUN_AS_NODE"].includes(key)
      || /^CODEX_CHATGPT_WEB_(?:LAUNCHER|BROWSER_HOST|CONTROL|BROKER)/.test(key)) delete env[key];
  }
  env.CODEX_WEB_GPT_DEV_HOME = devHome;
  env.CODEX_WEB_GPT_DEV_WORKSPACE = root;
  return env;
}

module.exports = { isolatedDevEnvironment, assertDevStorageIsolated };

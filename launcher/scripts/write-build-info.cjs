const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "../..");
const git = args => spawnSync("git", args, { cwd: root, encoding: "utf8", timeout: 5000 });
const revision = git(["rev-parse", "HEAD"]);
const sourceCommit = /^[a-f0-9]{40}$/.test(revision.stdout?.trim()) ? revision.stdout.trim() : null;
const status = git(["status", "--porcelain", "--untracked-files=normal"]);
const info = {
  version: JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version,
  sourceCommit,
  builtAt: new Date().toISOString(),
  localChanges: status.status !== 0 || Boolean(status.stdout?.trim()),
};
const target = path.join(root, "launcher/build/build-info.json");
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify(info, null, 2) + "\n");
console.log("Build identity recorded: " + (sourceCommit?.slice(0, 8) ?? "source archive"));

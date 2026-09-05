const fs = require("node:fs");
function readBuildInfo(file, version) {
  try {
    const info = JSON.parse(fs.readFileSync(file, "utf8"));
    if (info.version !== version || (info.sourceCommit !== null && !/^[a-f0-9]{40}$/.test(info.sourceCommit))
      || !Number.isFinite(Date.parse(info.builtAt)) || typeof info.localChanges !== "boolean") return null;
    return { version, sourceCommit: info.sourceCommit, builtAt: info.builtAt, localChanges: info.localChanges };
  } catch { return null; }
}
module.exports = { readBuildInfo };

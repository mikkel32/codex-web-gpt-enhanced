const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { readBuildInfo } = require("../electron/build-info.cjs");
test("build identity is version-bound and rejects malformed metadata", context => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maria-build-info-"));
  context.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "build-info.json");
  const info = { version: "5.7.0", sourceCommit: "a".repeat(40), builtAt: "2026-09-05T12:00:00Z", localChanges: false };
  fs.writeFileSync(file, JSON.stringify(info));
  assert.deepEqual(readBuildInfo(file, "5.7.0"), info);
  assert.equal(readBuildInfo(file, "5.6.2"), null);
  fs.writeFileSync(file, JSON.stringify({ ...info, sourceCommit: "../other" }));
  assert.equal(readBuildInfo(file, "5.7.0"), null);
});

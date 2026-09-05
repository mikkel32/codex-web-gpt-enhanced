const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const root = path.resolve(__dirname, "../..");
test("automatic tags are created only after platform builds and asset verification", () => {
  const source = fs.readFileSync(path.join(root, ".github/workflows/release.yml"), "utf8");
  const prepare = source.slice(source.indexOf("\n  prepare:"), source.indexOf("\n  build:"));
  const publish = source.slice(source.indexOf("\n  publish:"));
  assert.doesNotMatch(prepare, /git tag -a/);
  assert.match(publish, /needs: \[prepare, build\]/);
  const tag = publish.indexOf("git tag -a");
  assert.ok(tag > publish.indexOf("Verify every built asset is checksummed"));
  assert.ok(tag < publish.indexOf("gh release create"));
  assert.match(publish, /test "\$tagged_sha" = "\$RELEASE_SOURCE_SHA"/);
  assert.match(publish, /notes_flags=\(--notes-file "\$notes_file"\)/);
});

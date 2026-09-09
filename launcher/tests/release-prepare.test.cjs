const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "../..");
const workflow = fs.readFileSync(path.join(root, ".github/workflows/release.yml"), "utf8").replace(/\r\n/g, "\n");
const prepare = workflow.slice(workflow.indexOf("      - name: Resolve the immutable release candidate"), workflow.indexOf("\n  build:"));
const script = prepare.split("        run: |\n")[1].split("\n").map(line => line.replace(/^          /, "")).join("\n");

test("release preparation skips published ancestors but rejects conflicting unpublished tags", {
  skip: process.platform === "win32" ? "Release preparation runs in the Ubuntu publish job" : false,
}, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "maria-release-prepare-"));
  const executable = (name, body) => fs.writeFileSync(path.join(directory, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  try {
    executable("jq", 'printf "5.20.3\\n"');
    executable("gh", 'printf "%s\\n" "$TEST_DRAFT"');
    executable("git", `case "$1" in
  fetch) exit 0 ;;
  rev-parse) printf '%s\\n' "$TEST_SOURCE" ;;
  rev-list) test -n "$TEST_TAG" || exit 1; printf '%s\\n' "$TEST_TAG" ;;
  merge-base) test "$TEST_ANCESTOR" = yes ;;
  *) exit 90 ;;
esac`);
    const cases = [
      { name: "new version", draft: "", tag: "", ancestor: "no", success: true, publish: "true" },
      { name: "published ancestor plus docs", draft: "false", tag: "released", ancestor: "yes", success: true, publish: "false" },
      { name: "published unrelated tag", draft: "false", tag: "unrelated", ancestor: "no", success: false },
      { name: "draft tag has changed", draft: "true", tag: "older", ancestor: "yes", success: false },
      { name: "unpublished tag has changed", draft: "", tag: "older", ancestor: "yes", success: false },
      { name: "exact draft candidate", draft: "true", tag: "candidate", ancestor: "yes", success: true, publish: "true" },
    ];
    for (const entry of cases) {
      const output = path.join(directory, "result");
      fs.writeFileSync(output, "");
      const result = spawnSync("/bin/bash", ["-c", script], { encoding: "utf8", timeout: 5000,
        env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, GITHUB_OUTPUT: output,
          GITHUB_REPOSITORY: "fixture/release",
          EVENT_NAME: "workflow_run", WORKFLOW_HEAD_BRANCH: "main", WORKFLOW_HEAD_SHA: "candidate",
          TEST_SOURCE: "candidate", TEST_DRAFT: entry.draft, TEST_TAG: entry.tag, TEST_ANCESTOR: entry.ancestor } });
      assert.equal(result.status === 0, entry.success, `${entry.name}: ${result.stderr}`);
      if (entry.success) assert(fs.readFileSync(output, "utf8").includes(`publish=${entry.publish}\n`), entry.name);
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

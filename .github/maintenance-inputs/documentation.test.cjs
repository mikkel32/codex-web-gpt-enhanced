const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
function markdownFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? markdownFiles(file) : entry.name.endsWith(".md") ? [file] : [];
  });
}

test("documentation links and local images resolve after reorganization", () => {
  const files = [
    ...fs.readdirSync(root).filter(name => name.endsWith(".md")).map(name => path.join(root, name)),
    ...markdownFiles(path.join(root, "docs")),
    ...markdownFiles(path.join(root, ".github")),
  ];
  const missing = [];
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8").replace(/```[\s\S]*?```/g, "");
    const targets = [...text.matchAll(/\]\(([^\s)]+)\)|(?:src|href)="([^"]+)"/g)];
    for (const match of targets) {
      const target = match[1] || match[2];
      if (/^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i.test(target)) continue;
      const resolved = path.resolve(path.dirname(file), decodeURIComponent(target.split(/[?#]/)[0]));
      if (!fs.existsSync(resolved)) missing.push(`${path.relative(root, file)} -> ${target}`);
    }
  }
  assert.deepEqual(missing, []);
});

test("each reference, research and release document is discoverable from its index", () => {
  for (const group of ["reference", "research", "releases"]) {
    const directory = path.join(root, "docs", group);
    const index = fs.readFileSync(path.join(directory, "README.md"), "utf8");
    for (const file of fs.readdirSync(directory).filter(name => name.endsWith(".md") && name !== "README.md")) {
      assert(index.includes(`](${file})`), `${group}/${file} is not indexed`);
    }
  }
});

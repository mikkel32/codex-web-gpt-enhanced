const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { isolatedDevEnvironment, assertDevStorageIsolated } = require("../electron/dev-environment.cjs");
const { prepareDevBrowserConnector } = require("../electron/dev-browser-connector.cjs");
const { CONNECTOR_ID } = require("../electron/signin-browsers.cjs");

test("development browser connectors cannot replace the installed production extension", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "maria-dev-connector-"));
  const source = path.resolve(__dirname, "../../browser-connector/extension");
  try {
    const first = prepareDevBrowserConnector(source, path.join(root, "a"));
    const again = prepareDevBrowserConnector(source, path.join(root, "a"));
    const second = prepareDevBrowserConnector(source, path.join(root, "b"));
    assert.equal(first.id, again.id); assert.notEqual(first.id, second.id); assert.notEqual(first.id, CONNECTOR_ID);
    assert.equal(JSON.parse(fs.readFileSync(path.join(first.folder, "manifest.json"), "utf8")).name, "Maria Browser Sign-in DEV");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("each checkout gets stable private state and loses inherited production control", () => {
  const home = path.resolve(os.tmpdir(), "maria-env-home");
  const inherited = { CODEX_HOME: path.join(home, ".codex"), CODEX_CHATGPT_WEB_HOME: path.join(home, ".codex-chatgpt-web"), CODEX_CHATGPT_WEB_LAUNCHER_CONTROL_TOKEN: "production-only", CODEX_WEB_GPT_LAUNCHER_DATA_DIR: path.join(home, "browser"), ELECTRON_RUN_AS_NODE: "1", PATH: "kept" };
  const first = isolatedDevEnvironment(path.join(home, "checkout-a"), inherited, home);
  const again = isolatedDevEnvironment(path.join(home, "checkout-a"), inherited, home);
  const second = isolatedDevEnvironment(path.join(home, "checkout-b"), inherited, home);
  assert.equal(first.CODEX_WEB_GPT_DEV_HOME, again.CODEX_WEB_GPT_DEV_HOME);
  assert.notEqual(first.CODEX_WEB_GPT_DEV_HOME, second.CODEX_WEB_GPT_DEV_HOME);
  for (const key of ["CODEX_HOME", "CODEX_CHATGPT_WEB_HOME", "CODEX_CHATGPT_WEB_LAUNCHER_CONTROL_TOKEN", "CODEX_WEB_GPT_LAUNCHER_DATA_DIR", "ELECTRON_RUN_AS_NODE"]) assert.equal(first[key], undefined);
  assert.equal(first.PATH, "kept"); assert.equal(inherited.CODEX_CHATGPT_WEB_LAUNCHER_CONTROL_TOKEN, "production-only");
});

test("DEV storage cannot contain or sit inside a production home", () => {
  const home = path.resolve(os.tmpdir(), "maria-env-parent");
  for (const dev of [home, path.join(home, ".codex"), path.join(home, ".codex", "nested"), path.join(home, ".codex-chatgpt-web", "runtime")]) {
    assert.throws(() => assertDevStorageIsolated(dev, {}, home), /must not overlap/);
  }
});

test("a symlink cannot disguise overlapping production state", { skip: process.platform === "win32" }, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "maria-env-link-"));
  try {
    fs.mkdirSync(path.join(home, ".codex"));
    fs.symlinkSync(path.join(home, ".codex"), path.join(home, "looks-isolated"));
    assert.throws(() => assertDevStorageIsolated(path.join(home, "looks-isolated"), {}, home), /must not overlap/);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

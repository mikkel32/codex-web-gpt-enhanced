const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { CONNECTOR_ID, signInBrowsers, browserSignInInvocation } = require("../electron/signin-browsers.cjs");

test("the installed connector identity and permissions match the local browser handoff", () => {
  const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../browser-connector/extension/manifest.json"), "utf8"));
  const hash = createHash("sha256").update(Buffer.from(manifest.key, "base64")).digest("hex").slice(0, 32);
  const id = hash.replace(/[0-9a-f]/g, character => String.fromCharCode(97 + parseInt(character, 16)));
  assert.equal(id, CONNECTOR_ID);
  assert.deepEqual(manifest.permissions, ["cookies"]);
  assert.deepEqual(manifest.host_permissions, ["https://chatgpt.com/*", "https://auth.openai.com/*", "http://127.0.0.1/*"]);
});

test("browser choices reflect installation evidence without inspecting user profiles", () => {
  const choices = signInBrowsers({ platform: "darwin", exists: candidate => candidate.includes("Microsoft Edge") });
  assert.equal(choices.find(b => b.id === "edge").executable, "/Applications/Microsoft Edge.app");
  assert.equal(choices.find(b => b.id === "chrome").executable, null);
  assert.equal(choices.find(b => b.id === "safari").executable, null);
});

test("browser launch targets are fixed and never execute code or restart a browser profile", () => {
  const code = `maria1:17899:${"a".repeat(64)}`;
  const chrome = browserSignInInvocation({ id: "chrome", executable: "/Applications/Google Chrome.app" }, "connect", code, "darwin");
  assert.equal(chrome.executable, "/usr/bin/open");
  assert.deepEqual(chrome.args.slice(0, 2), ["-a", "/Applications/Google Chrome.app"]);
  assert.match(chrome.args[2], new RegExp(`^chrome-extension://${CONNECTOR_ID}/connect.html#`));
  const safari = browserSignInInvocation({ id: "safari", executable: "/Applications/Safari.app" }, "connect", code, "darwin");
  assert.equal(safari.args.at(-1), "https://chatgpt.com/");
  assert.throws(() => browserSignInInvocation({ id: "chrome", executable: "/browser" }, "connect", "malformed", "linux"), /fresh browser connection/);
});

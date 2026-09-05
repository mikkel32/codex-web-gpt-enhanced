const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { createUpdateCredentials } = require("../electron/update-credentials.cjs");

test("private-update credentials require real OS encryption and can be removed", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "maria-credential-"));
  try {
    const file = path.join(root, "github.enc");
    const token = "github_pat_test_only_123456789";
    let backend = "basic_text";
    let encrypted;
    const store = createUpdateCredentials(file, { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => backend,
      encryptString: text => { encrypted = text; return Buffer.from("mock OS ciphertext"); },
      decryptString: bytes => { assert.equal(bytes.toString(), "mock OS ciphertext"); return encrypted; },
    });
    assert.throws(() => store.save(token), /Secure credential storage is unavailable/);
    assert.equal(fs.existsSync(file), false);
    backend = "keychain"; store.save(token);
    assert.equal(store.configured(), true);
    assert.equal(store.read(), token);
    assert.equal(fs.readFileSync(file, "utf8").includes(token), false);
    if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    store.clear(); assert.equal(store.configured(), false); assert.equal(store.read(), null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

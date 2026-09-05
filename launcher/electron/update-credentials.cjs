const fs = require("node:fs");
const { writePrivateFileAtomic } = require("./atomic-file.cjs");

function createUpdateCredentials(filePath, safeStorage) {
  const available = () => safeStorage.isEncryptionAvailable()
    && safeStorage.getSelectedStorageBackend?.() !== "basic_text";
  return {
    read() {
      if (!fs.existsSync(filePath)) return null;
      if (!available()) throw new Error("Unlock your operating system keychain to check private GitHub releases.");
      return safeStorage.decryptString(fs.readFileSync(filePath));
    },
    save(value) {
      const token = typeof value === "string" ? value.trim() : "";
      if (!/^[A-Za-z0-9_]{20,255}$/.test(token)) throw new Error("Enter a valid GitHub access token.");
      if (!available()) throw new Error("Secure credential storage is unavailable. Open GitHub releases in your browser instead.");
      writePrivateFileAtomic(filePath, safeStorage.encryptString(token));
    },
    clear() { fs.rmSync(filePath, { force: true }); },
    configured: () => fs.existsSync(filePath),
  };
}

module.exports = { createUpdateCredentials };

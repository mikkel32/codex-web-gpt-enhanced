const fs = require("node:fs");
const { writePrivateFileAtomic } = require("./atomic-file.cjs");

function savedConversationUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.origin === "https://chatgpt.com" && !url.username && !url.password && !url.search && !url.hash
      && /^\/c\/[A-Za-z0-9_-]{8,128}$/.test(url.pathname) ? url.href : null;
  } catch { return null; }
}

class SavedConversations {
  constructor(filePath) {
    this.filePath = filePath;
    this.entries = {};
    try {
      if (!fs.existsSync(filePath)) return;
      if (fs.statSync(filePath).size > 4 * 1024 * 1024) throw new Error("Conversation index is too large");
      const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (![1, 2].includes(data.version) || !data.conversations || typeof data.conversations !== "object" || Array.isArray(data.conversations)) throw new Error("Invalid conversation index");
      for (const [key, value] of Object.entries(data.conversations)) {
        // Earlier installed builds wrote only completed, connector-bound saved chats.
        if (data.version === 1 && value?.status === undefined && Number.isFinite(value?.lastUsedAt)
          && value.connectorBound === true && savedConversationUrl(value.url)) value.status = "ready";
        if (!/^[a-f0-9]{64}$/.test(key) || !value || !["ready", "in-flight"].includes(value.status)
          || (value.url !== null && !savedConversationUrl(value.url)) || typeof value.connectorIdentity !== "string"
          || typeof value.connectorBound !== "boolean") throw new Error("Invalid saved conversation");
      }
      this.entries = data.conversations;
    } catch { this.error = new Error("Maria's conversation index needs recovery. Your Codex history is intact; no replacement ChatGPT chat was opened."); }
  }
  get(key) { if (this.error) throw this.error; return this.entries[key]; }
  set(key, value) {
    this.get(key);
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("Invalid conversation key");
    if (!this.entries[key] && Object.keys(this.entries).length >= 4096) throw new Error("Maria's saved conversation index is full.");
    const next = { ...this.entries, [key]: { ...value, updatedAt: Date.now() } };
    writePrivateFileAtomic(this.filePath, JSON.stringify({ version: 2, conversations: next }));
    this.entries = next;
  }
  delete(key) {
    this.get(key);
    const next = { ...this.entries }; delete next[key];
    writePrivateFileAtomic(this.filePath, JSON.stringify({ version: 2, conversations: next }));
    this.entries = next;
  }
}

module.exports = { SavedConversations, savedConversationUrl };

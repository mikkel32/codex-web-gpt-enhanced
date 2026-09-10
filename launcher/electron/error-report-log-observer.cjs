const fs = require("node:fs");
const { StringDecoder } = require("node:string_decoder");

/** Observe only newly appended launcher events, never scan the user's conversation archive. */
class ReportLogObserver {
  constructor(file, onIncident) {
    this.file = file; this.onIncident = onIncident; this.offset = 0; this.pending = ""; this.identity = null;
    this.decoder = new StringDecoder("utf8");
    try { const info = fs.statSync(file); this.offset = info.size; this.identity = `${info.dev}:${info.ino}`; } catch {}
  }
  poll(enabled) {
    let info;
    try { info = fs.lstatSync(this.file); } catch (error) { if (error.code === "ENOENT") return; throw error; }
    if (!info.isFile() || info.isSymbolicLink()) return;
    const identity = `${info.dev}:${info.ino}`;
    if (this.identity !== identity || info.size < this.offset) { this.offset = 0; this.pending = ""; this.identity = identity; this.decoder = new StringDecoder("utf8"); }
    if (!enabled) { this.offset = info.size; this.pending = ""; this.decoder = new StringDecoder("utf8"); return; }
    const available = Math.min(64 * 1024, Math.max(0, info.size - this.offset));
    if (!available) return;
    const fd = fs.openSync(this.file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    let text;
    try { const buffer = Buffer.alloc(available); const read = fs.readSync(fd, buffer, 0, buffer.length, this.offset); this.offset += read; text = this.decoder.write(buffer.subarray(0, read)); }
    finally { fs.closeSync(fd); }
    const lines = (this.pending + text).split("\n");
    this.pending = (lines.pop() || "").slice(-64 * 1024);
    for (const line of lines) {
      let row; try { row = JSON.parse(line); } catch { continue; }
      if (!row || typeof row.event !== "string" || /error.report|runtime\.(?:stdout|stderr)/i.test(row.event)) continue;
      if (row.level !== "error" && row.event !== "browser.control_rejected") continue;
      const detail = row.detail && typeof row.detail === "object" ? row.detail : {};
      this.onIncident({ source: row.event.startsWith("browser.") ? "browser" : row.event.startsWith("runtime.") ? "native-runtime" : "launcher",
        traceId: typeof detail.traceId === "string" ? detail.traceId : undefined,
        code: row.event, error: typeof detail.message === "string" ? detail.message : row.event,
        notes: "Recorded launcher event. Responses remain unavailable unless an owned WebGPT turn supplies them; unrelated Codex conversations are not scanned." });
    }
  }
}
module.exports = { ReportLogObserver };

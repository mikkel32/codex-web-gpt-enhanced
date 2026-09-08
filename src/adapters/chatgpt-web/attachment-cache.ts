import { createHash, randomBytes } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PREFIX = "maria-task-attachments-";
let pruned = false;
function pruneOrphans(): void {
  if (pruned) return;
  pruned = true;
  for (const name of readdirSync(tmpdir())) {
    const match = /^maria-task-attachments-(\d+)-([a-f0-9]{24})$/.exec(name);
    if (!match) continue;
    const directory = join(tmpdir(), name);
    try {
      const stat = lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink() || (process.getuid && stat.uid !== process.getuid())) continue;
      const marker = join(directory, ".owner.json");
      if (!lstatSync(marker).isFile() || lstatSync(marker).size > 1024) continue;
      const owner = JSON.parse(readFileSync(marker, "utf8"));
      if (owner.version !== 1 || String(owner.pid) !== match[1] || owner.nonce !== match[2]) continue;
      try { process.kill(owner.pid, 0); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") rmSync(directory, { recursive: true, force: true });
      }
    } catch { /* An unknown or busy directory is never assumed disposable. */ }
  }
}

/** Original input bytes only; never accepts a path to read, and never touches repository files. */
export class AttachmentCache {
  private directory?: string;
  private disposed = false;
  write(filename: string, bytes: Uint8Array): string {
    if (this.disposed) throw new Error("Attachment cache has been retired");
    if (!this.directory) {
      pruneOrphans();
      const nonce = randomBytes(12).toString("hex");
      this.directory = join(tmpdir(), `${PREFIX}${process.pid}-${nonce}`);
      mkdirSync(this.directory, { mode: 0o700 });
      if (process.platform !== "win32") chmodSync(this.directory, 0o700);
      writeFileSync(join(this.directory, ".owner.json"), JSON.stringify({ version: 1, pid: process.pid, nonce }), { mode: 0o600 });
    }
    const basename = filename.split(/[/\\]/).at(-1)?.replace(/[^\p{L}\p{N} ._-]/gu, "_").slice(-96) || "attachment.bin";
    const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
    const path = join(this.directory, `${digest}-${randomBytes(4).toString("hex")}-${basename}`);
    writeFileSync(path, bytes, { mode: 0o600, flag: "wx" });
    return path;
  }
  dispose = (): void => {
    if (this.disposed) return;
    this.disposed = true;
    if (this.directory) {
      try { rmSync(this.directory, { recursive: true, force: true }); }
      catch { console.warn("[chatgpt-web] attachment cache cleanup deferred; original files are unaffected"); }
    }
  };
}

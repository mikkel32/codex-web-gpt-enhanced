import { existsSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import type { CodexFileContent } from "../../types";

export interface ExtractedDocument { text: string; filename: string; extraction: string; pages?: number; originalBytes: Uint8Array }

export async function extractInputDocument(file: CodexFileContent, signal?: AbortSignal): Promise<ExtractedDocument> {
  signal?.throwIfAborted();
  const filename = (file.filename ?? "attached-file").split(/[/\\]/).at(-1)!.replace(/[\x00-\x1f]/g, "").slice(0, 256);
  if (file.fileData === undefined) throw new Error(`Attachment ${filename} has no supplied bytes. File IDs and remote URLs cannot be resolved by this bridge; provide inline file data or an accessible workspace file.`);
  const match = /^data:([^;,]+)(?:;charset=[^;]+)?;base64,([\s\S]*)$/.exec(file.fileData);
  const encoded = match ? match[2]! : file.fileData;
  const mimeType = match?.[1]?.toLowerCase();
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 !== 0 || encoded.length > 27_000_000) throw new Error(`Attachment ${filename} has invalid or oversized base64 data`);
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length > 20_000_000) throw new Error(`Attachment ${filename} exceeds the 20 MB limit`);
  const extension = extname(filename).toLowerCase();
  if (extension === ".pdf" || mimeType === "application/pdf") {
    const here = dirname(fileURLToPath(import.meta.url));
    const built = join(here, "document-worker.js");
    const source = join(here, "document-worker.ts");
    const child = Bun.spawn([process.execPath, existsSync(built) ? built : source], {
      stdin: new Blob([JSON.stringify({ data: encoded })]), stdout: "pipe", stderr: "pipe",
      env: { PATH: process.env.PATH ?? "", LANG: "en_US.UTF-8" },
    });
    let timedOut = false;
    const abort = () => child.kill("SIGKILL");
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 30_000);
    try {
      const [output, , exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      signal?.throwIfAborted();
      if (timedOut) return { text: "", filename, originalBytes: bytes, extraction: "PDF text extraction timed out; inspect the original file with native tools" };
      if (output.length > 5_000_000) throw new Error(`Attachment ${filename} exceeded the extracted text limit`);
      let value: { text?: string; pages?: number; extraction?: string; error?: string };
      try { value = JSON.parse(output); } catch { throw new Error(`Attachment ${filename} could not be parsed as a PDF`); }
      if (exit || value.error || typeof value.text !== "string") return { text: "", filename, originalBytes: bytes,
        extraction: `PDF text unavailable: ${value.error ?? "extraction failed"}. Inspect the original with native tools; no visual content has been read.` };
      return { text: value.text, filename, pages: value.pages, extraction: value.extraction!, originalBytes: bytes };
    } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); if (child.exitCode === null) child.kill("SIGKILL"); }
  }
  const textExtension = /\.(?:txt|md|markdown|json|jsonl|csv|tsv|log|yaml|yml|xml|html|htm|css|js|jsx|ts|tsx|py|swift|rs|go|java|c|h|cpp|sh|toml|ini|sql)$/;
  if (extension && !textExtension.test(extension) && !mimeType?.startsWith("text/") && !["application/json", "application/xml"].includes(mimeType ?? "")) {
    return { text: "", filename, originalBytes: bytes, extraction: "Original binary file available through native tools; this format was not text-extracted" };
  }
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le" : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : "utf-8";
  let text: string;
  try { text = new TextDecoder(encoding, { fatal: true }).decode(bytes); }
  catch { return { text: "", filename, originalBytes: bytes, extraction: `Not decoded as ${encoding}; use native tools on the original to determine its encoding` }; }
  if (text.includes("\0")) return { text: "", filename, originalBytes: bytes, extraction: "Contains binary or unrecognized encoded data; inspect the original with native tools" };
  return { text, filename, extraction: `decoded ${encoding} text`, originalBytes: bytes };
}

import { getDocumentProxy } from "unpdf";

// This process consumes supplied bytes only. It never fetches PDF-linked resources.
globalThis.fetch = Object.assign(async () => { throw new Error("Network access is unavailable during document extraction"); },
  { preconnect: () => { throw new Error("Network access is unavailable during document extraction"); } });
try {
  const input = await Bun.stdin.text();
  if (input.length > 28_000_000) throw new Error("PDF input exceeds extraction budget");
  const { data } = JSON.parse(input);
  if (typeof data !== "string") throw new Error("Missing PDF bytes");
  const pdf = await getDocumentProxy(new Uint8Array(Buffer.from(data, "base64")), {
    disableAutoFetch: true, disableStream: true, verbosity: 0,
    useSystemFonts: false, disableFontFace: true, enableXfa: false,
    useWorkerFetch: false, useWasm: false, maxImageSize: 10_000_000, stopAtErrors: true,
  });
  try {
    if (pdf.numPages > 200) throw new Error("PDF exceeds the 200-page extraction budget");
    const pages: string[] = [];
    let characters = 0;
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      const text = content.items.map(item => "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "").join("");
      characters += text.length;
      if (characters > 4_000_000) throw new Error("PDF extracted text exceeds its budget");
      pages.push(`--- Page ${number} ---\n${text}`);
      page.cleanup();
    }
    if (!pages.some(page => page.replace(/^--- Page \d+ ---\n/, "").trim())) throw new Error("PDF contains no extractable text; provide page images for visual inspection");
    process.stdout.write(JSON.stringify({ text: pages.join("\n\n"), pages: pdf.numPages, extraction: "text-only; page graphics were not inspected" }));
  } finally { await pdf.loadingTask.destroy(); }
} catch (error) {
  process.stdout.write(JSON.stringify({ error: error instanceof Error ? error.message.slice(0, 500) : "PDF extraction failed" }));
  process.exitCode = 1;
}

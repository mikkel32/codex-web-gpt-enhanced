import { expect, test } from "bun:test";
import { extractInputDocument } from "../src/adapters/chatgpt-web/input-files";

function pdf(text: string, count = 1): Buffer {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [3 0 R] /Count ${count} >>`,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let output = "%PDF-1.4\n"; const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(output)); output += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("") + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(output);
}
test("text attachments preserve UTF-8, BOM-marked UTF-16, and empty files", async () => {
  for (const [data, expected] of [[Buffer.from("\u00e6\u00f8\u00e5"), "\u00e6\u00f8\u00e5"], [Buffer.concat([Buffer.from([255, 254]), Buffer.from("hello", "utf16le")]), "hello"], [Buffer.alloc(0), ""]] as const) {
    expect((await extractInputDocument({ type: "file", filename: "sample.txt", fileData: data.toString("base64") })).text).toBe(expected);
  }
});
test("PDF text is extracted in the bounded worker with its visual limitation disclosed", async () => {
  const result = await extractInputDocument({ type: "file", filename: "sample.pdf", fileData: pdf("PDF-UNIQUE-MARKER 42").toString("base64") });
  expect(result.text).toContain("PDF-UNIQUE-MARKER 42"); expect(result.pages).toBe(1); expect(result.extraction).toContain("graphics were not inspected");
}, 35000);
test("unextracted formats preserve original bytes with explicit limits; missing or malformed data fails", async () => {
  expect((await extractInputDocument({ type: "file", filename: "empty.pdf", fileData: pdf("").toString("base64") })).extraction).toContain("no extractable text");
  expect((await extractInputDocument({ type: "file", filename: "bad.pdf", fileData: Buffer.from("not PDF").toString("base64") })).extraction).toContain("PDF text unavailable");
  const binary = await extractInputDocument({ type: "file", filename: "archive.zip", fileData: "AQID" });
  expect(binary.extraction).toContain("not text-extracted"); expect([...binary.originalBytes]).toEqual([1, 2, 3]);
  await expect(extractInputDocument({ type: "file", filename: "sample.txt", fileData: "!!!" })).rejects.toThrow("base64");
  await expect(extractInputDocument({ type: "file", fileUrl: "https://example.com/private" })).rejects.toThrow("no supplied bytes");
}, 35000);

import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDebuggerMarker, verifiedDebuggerUrl, waitForElectronDebugger } from "../scripts/electron-debugger-readiness";

const browserPath = "/devtools/browser/11111111-1111-4111-8111-111111111111";
test("debugger marker rejects incomplete and invalid ports", () => {
  for (const text of ["", "12345\n", `0\n${browserPath}`, `65536\n${browserPath}`, `NaN\n${browserPath}`]) {
    expect(parseDebuggerMarker(text)).toBeUndefined();
  }
  expect(parseDebuggerMarker(`12345\r\n${browserPath}\r\n`)).toEqual({ port: 12345, path: browserPath });
});

test("debugger metadata must match the exact owned browser path and port", () => {
  const marker = { port: 12345, path: browserPath };
  expect(verifiedDebuggerUrl(`ws://localhost:12345${browserPath}`, marker)).toBe(`ws://127.0.0.1:12345${browserPath}`);
  for (const url of [`ws://example.com:12345${browserPath}`, `ws://127.0.0.1:12346${browserPath}`,
    `ws://127.0.0.1:12345/devtools/browser/another-browser`, `ws://user@127.0.0.1:12345${browserPath}`,
    `ws://127.0.0.1:12345${browserPath}?token=unexpected`]) expect(verifiedDebuggerUrl(url, marker)).toBeUndefined();
});

test("readiness rereads a partially written marker before probing its endpoint", async () => {
  const root = mkdtempSync(join(tmpdir(), "maria-cdp-readiness-"));
  const marker = join(root, "DevToolsActivePort");
  let requests = 0;
  const server = createServer((_request, response) => {
    requests += 1;
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing fixture address");
    response.end(JSON.stringify({ webSocketDebuggerUrl: `ws://localhost:${address.port}${browserPath}` }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture address");
  writeFileSync(marker, "");
  const pending = waitForElectronDebugger(marker, () => true, 2000);
  const timer = setTimeout(() => writeFileSync(marker, `${address.port}\n${browserPath}`), 20);
  try {
    expect(await pending).toBe(`ws://127.0.0.1:${address.port}${browserPath}`);
    expect(requests).toBe(1);
  } finally {
    clearTimeout(timer);
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});

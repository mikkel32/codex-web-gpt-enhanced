import { readFileSync } from "node:fs";
import { get } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";

export function parseDebuggerMarker(text: string): { port: number; path: string } | undefined {
  const [portText, path] = text.split(/\r?\n/);
  if (!/^\d{1,5}$/.test(portText ?? "") || !/^\/devtools\/browser\/[A-Za-z0-9_-]{8,128}$/.test(path ?? "")) return;
  const port = Number(portText);
  return port > 0 && port <= 65535 ? { port, path: path! } : undefined;
}

export function verifiedDebuggerUrl(value: unknown, marker: { port: number; path: string }): string | undefined {
  if (typeof value !== "string") return;
  try {
    const url = new URL(value);
    if (url.protocol !== "ws:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      || Number(url.port) !== marker.port || url.pathname !== marker.path
      || url.username || url.password || url.search || url.hash) return;
    return `ws://127.0.0.1:${marker.port}${marker.path}`;
  } catch { return; }
}

function probe(port: number, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    // Direct loopback HTTP must not inherit an ambient corporate proxy.
    const request = get({ hostname: "127.0.0.1", port, path: "/json/version" }, response => {
      if (response.statusCode !== 200) { response.resume(); reject(new Error(`CDP HTTP ${response.statusCode}`)); return; }
      let text = "";
      response.setEncoding("utf8");
      response.on("data", chunk => {
        text += chunk;
        if (text.length > 1024 * 1024) request.destroy(new Error("CDP metadata exceeded its size limit"));
      });
      response.on("error", reject);
      response.on("end", () => {
        try { resolve(JSON.parse(text).webSocketDebuggerUrl); } catch { reject(new Error("Invalid CDP metadata JSON")); }
      });
    });
    const timer = setTimeout(() => request.destroy(new Error("CDP metadata probe timed out")), timeoutMs);
    request.once("close", () => clearTimeout(timer));
    request.on("error", reject);
  });
}

export async function waitForElectronDebugger(portFile: string, isRunning: () => boolean, timeoutMs = 30_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let detail = "debugger marker not ready";
  while (isRunning() && Date.now() < deadline) {
    try {
      const marker = parseDebuggerMarker(readFileSync(portFile, "utf8"));
      if (marker) {
        const value = await probe(marker.port, Math.max(1, Math.min(1000, deadline - Date.now())));
        const verified = verifiedDebuggerUrl(value, marker);
        if (verified) return verified;
        detail = "CDP metadata did not match the owned debugger marker";
      } else detail = "debugger marker is incomplete or invalid";
    } catch (error) { detail = error instanceof Error ? error.message : String(error); }
    await sleep(Math.max(1, Math.min(50, deadline - Date.now())));
  }
  throw new Error(`Isolated Electron debugger did not become ready (${isRunning() ? "deadline" : "process exited"}): ${detail}`);
}

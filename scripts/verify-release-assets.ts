import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/** Compare the upload to the ORIGINAL build manifest. Never derive trust from the upload itself. */
export function verifyReleaseAssets(manifest: string, assets: unknown): number {
  const expected = new Map<string, string>();
  for (const line of manifest.trimEnd().split("\n")) {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9][A-Za-z0-9_.-]*)$/.exec(line);
    if (!match || match[2] === "checksums.txt" || expected.has(match[2])) {
      throw new Error("Build checksum manifest has an invalid or duplicate entry");
    }
    expected.set(match[2], `sha256:${match[1]}`);
  }
  expected.set("checksums.txt", `sha256:${createHash("sha256").update(manifest).digest("hex")}`);
  if (!Array.isArray(assets) || assets.length !== expected.size) {
    throw new Error("Uploaded release asset count does not match the build manifest");
  }
  const seen = new Set<string>();
  for (const asset of assets) {
    if (!asset || typeof asset !== "object" || typeof asset.name !== "string"
      || typeof asset.digest !== "string" || !expected.has(asset.name) || seen.has(asset.name)) {
      throw new Error("Uploaded release contains an unknown, duplicate, or invalid asset");
    }
    if (expected.get(asset.name) !== asset.digest) {
      throw new Error(`Uploaded release asset differs from the original build: ${asset.name}`);
    }
    seen.add(asset.name);
  }
  return seen.size;
}

if (import.meta.main) {
  try {
    const [manifestPath, remotePath] = process.argv.slice(2);
    if (!manifestPath || !remotePath) throw new Error("Usage: verify-release-assets.ts checksums.txt remote-assets.json");
    const manifest = readFileSync(manifestPath, "utf8");
    const remote: unknown = JSON.parse(readFileSync(remotePath, "utf8"));
    const assets = remote && typeof remote === "object" && "assets" in remote ? remote.assets : undefined;
    const count = verifyReleaseAssets(manifest, assets);
    console.log(`RELEASE_ASSETS_VERIFIED ${count} assets match the original build`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

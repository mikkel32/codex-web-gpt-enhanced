import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { verifyReleaseAssets } from "../scripts/verify-release-assets";
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
function fixture() {
  const manifest = `${digest("installer")}  installer.dmg\n${digest("runtime")}  runtime.tar.gz\n`;
  const assets = [{ name: "runtime.tar.gz", digest: `sha256:${digest("runtime")}` },
    { name: "installer.dmg", digest: `sha256:${digest("installer")}` },
    { name: "checksums.txt", digest: `sha256:${digest(manifest)}` }];
  return { manifest, assets };
}
test("release verification accepts only the exact original build, regardless of asset ordering", () => {
  const f = fixture(); expect(verifyReleaseAssets(f.manifest, f.assets)).toBe(3);
});
test("rewriting an upload and its checksum file cannot replace the original trust anchor", () => {
  const f = fixture(); f.assets[1]!.digest = `sha256:${digest("different installer")}`;
  f.assets[2]!.digest = `sha256:${digest(f.manifest.replace(digest("installer"), digest("different installer")))}`;
  expect(() => verifyReleaseAssets(f.manifest, f.assets)).toThrow("differs from the original build");
});
test("a modified uploaded manifest is rejected even when the binaries match", () => {
  const f = fixture(); f.assets[2]!.digest = `sha256:${digest(f.manifest + "\n")}`;
  expect(() => verifyReleaseAssets(f.manifest, f.assets)).toThrow("checksums.txt");
});
for (const change of ["missing", "extra", "duplicate", "unknown", "no-digest"] as const) {
  test(`release verification rejects ${change} assets`, () => {
    const f = fixture();
    if (change === "missing") f.assets.pop();
    if (change === "extra") f.assets.push({ name: "extra.exe", digest: `sha256:${digest("extra")}` });
    if (change === "duplicate") f.assets[0] = { ...f.assets[1]! };
    if (change === "unknown") f.assets[0]!.name = "foreign.exe";
    if (change === "no-digest") f.assets[0]!.digest = "";
    expect(() => verifyReleaseAssets(f.manifest, f.assets)).toThrow();
  });
}
for (const manifest of ["", "bad  file.exe\n", `${digest("x")}  ../file.exe\n`,
  `${digest("x")}  checksums.txt\n`, `${digest("x")}  file.exe\n${digest("y")}  file.exe\n`]) {
  test(`malformed build manifest is rejected: ${JSON.stringify(manifest).slice(0, 65)}`, () => {
    expect(() => verifyReleaseAssets(manifest, [])).toThrow();
  });
}

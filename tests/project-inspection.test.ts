import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { projectInspectionCommand, projectInspectionSchema } from "../src/adapters/chatgpt-web/project-inspection";
import type { ChatGptTurnEnvironment } from "../src/adapters/chatgpt-web/environment";

test("fixed inspection quotes hostile paths and literal queries and ignores rg command configuration", async () => {
  const root = mkdtempSync(join(tmpdir(), "maria-inspect-"));
  try {
    const env: ChatGptTurnEnvironment = { cwd: root, roots: [root], writableRoots: [], sandboxPolicy: { type: "readOnly", networkAccess: false }, tools: [] };
    const name = "it's a $(touch INJECTED) `echo unsafe`.txt";
    const query = "$(touch INJECTED); 'quoted' & literal";
    writeFileSync(join(root, name), `${query}\nsecond line\nthird line\n`);
    const config = join(root, "rg-config");
    writeFileSync(config, "--pre=nonexistent-program-that-must-not-run\n");
    const run = async (fields: Record<string, unknown>) => {
      const cmd = projectInspectionCommand(projectInspectionSchema.parse(fields), env);
      const child = Bun.spawn(process.platform === "win32" ? ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", cmd]
        : ["/bin/sh", "-c", cmd], { cwd: root, env: { ...process.env, RIPGREP_CONFIG_PATH: config }, stdout: "pipe", stderr: "pipe" });
      const output = await new Response(child.stdout).text();
      const error = await new Response(child.stderr).text();
      expect(await child.exited, error).toBe(0);
      return output;
    };
    // The real command is exercised when rg is installed; no shell fallbacks are generated.
    if (Bun.which("rg")) {
      expect(await run({ operation: "search", path: name, query })).toContain(query);
      const read = await run({ operation: "read", path: name, limit: 2 });
      expect(read).toContain("second line"); expect(read).not.toContain("third line");
      expect(await run({ operation: "files", path: "." })).toContain(name);
      expect(existsSync(join(root, "INJECTED"))).toBe(false);
    }
    expect(() => projectInspectionCommand(projectInspectionSchema.parse({ operation: "read", path: "../outside" }), env)).toThrow("workspace roots");
    expect(() => projectInspectionCommand(projectInspectionSchema.parse({ operation: "search", path: "." }), env)).toThrow("query");
    for (const extra of [{ cmd: "touch INJECTED" }, { limit: 501 }, { max_depth: 9 }, { operation: "execute" }]) {
      expect(() => projectInspectionSchema.parse({ operation: "read", path: name, ...extra })).toThrow();
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

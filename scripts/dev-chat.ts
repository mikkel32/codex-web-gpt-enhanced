import { resolve } from "node:path";
import { isolatedDevEnvironment } from "../launcher/electron/dev-environment.cjs";
const workspace = resolve(import.meta.dir, "..");
const child = Bun.spawn([process.execPath, "run", "src/cli.ts", "dev", "chat", ...process.argv.slice(2)], {
  cwd: workspace, env: isolatedDevEnvironment(workspace), stdin: "inherit", stdout: "inherit", stderr: "inherit",
});
process.exitCode = await child.exited;

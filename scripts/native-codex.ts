import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const candidates = [Bun.which("codex"), join(homedir(), ".local", "bin", "codex"), "/Applications/Codex.app/Contents/Resources/codex"];
const executable = candidates.find(candidate => candidate && existsSync(candidate));
if (!executable) throw new Error("Install the Codex CLI to open a direct native session.");
const environment = { ...process.env };
delete environment.OPENAI_BASE_URL;
const processHandle = Bun.spawn([
  executable,
  "-c", 'model_provider="openai"',
  "-c", 'openai_base_url="https://chatgpt.com/backend-api/codex"',
  ...process.argv.slice(2),
], { env: environment, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
process.exitCode = await processHandle.exited;

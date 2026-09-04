import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { existsSync, realpathSync } from "node:fs";

export function sourceCommandNeedsProductionOptIn({ entry, configHome, codexHome, command, action, userHome = homedir() }: {
  entry: string; configHome: string; codexHome?: string; command: string; action?: string; userHome?: string;
}): boolean {
  if (!/(?:^|[/\\])src[/\\]cli\.ts$/.test(entry)) return false;
  const canonical = (path: string) => existsSync(path) ? realpathSync(path) : resolve(path);
  const productionCore = canonical(configHome) === canonical(join(userHome, ".codex-chatgpt-web"));
  const productionCodex = codexHome !== undefined && canonical(codexHome) === canonical(join(userHome, ".codex"));
  if (!productionCore && !productionCodex) return false;
  if (["help", "doctor", "status", "dev", "open"].includes(command)) return false;
  if (["route", "service", "tunnel", "subagents"].includes(command) && action === "status") return false;
  if (command === "login") return productionCore;
  return ["setup", "serve", "guard", "uninstall", "route", "service", "tunnel", "subagents", "hook"].includes(command);
}

import { isAbsolute, relative, resolve, sep } from "node:path";
import * as z from "zod/v4";
import type { ChatGptTurnEnvironment } from "./environment";

export const projectInspectionSchema = z.object({
  operation: z.enum(["files", "read", "search"]),
  path: z.string().min(1).max(4096),
  query: z.string().min(1).max(500).optional(),
  limit: z.number().int().min(1).max(500).default(200),
  max_depth: z.number().int().min(1).max(8).default(2),
}).strict();

/** Fixed read-only rg operations, still invoked through the outer native command
 * tool and its approvals. No model-authored shell, rg configuration, or preprocessors. */
export function projectInspectionCommand(input: z.infer<typeof projectInspectionSchema>, environment: ChatGptTurnEnvironment) {
  const target = resolve(environment.cwd, input.path);
  if (!environment.roots.some(root => {
    const remainder = relative(resolve(root), target);
    return remainder === "" || (!isAbsolute(remainder) && remainder !== ".." && !remainder.startsWith(`..${sep}`));
  })) throw new Error("Project inspection requires a path within this task's workspace roots");
  if (input.path.includes("\0") || input.query?.includes("\0")) throw new Error("Inspection input cannot contain NUL");
  if ((input.operation === "search") !== (input.query !== undefined)) throw new Error("Only search requires a literal query");
  const args = ["--no-config", "--color", "never", "--hidden", "--glob", "!.git", "--max-depth", String(input.max_depth)];
  if (input.operation === "files") args.push("--files", "--", target);
  else {
    args.push("--line-number", "--max-count", String(input.limit), "--max-columns", "2000");
    if (input.operation === "search") args.push("--fixed-strings");
    args.push("--", input.operation === "search" ? input.query! : "^", target);
  }
  const quote = process.platform === "win32"
    ? (value: string) => `'${value.replaceAll("'", "''")}'`
    : (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  return `rg ${args.map(quote).join(" ")}`;
}

import { expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { AttachmentCache } from "../src/adapters/chatgpt-web/attachment-cache";

test("temporary attachment copies preserve bytes, stay private, and retire idempotently", () => {
  const cache = new AttachmentCache();
  const bytes = Buffer.from([0, 255, 3, 17]);
  const path = cache.write("../../original.bin", bytes);
  expect(readFileSync(path)).toEqual(bytes);
  expect(path).toContain("maria-task-attachments-");
  expect(path).not.toContain("..");
  if (process.platform !== "win32") {
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(dirname(path)).mode & 0o777).toBe(0o700);
  }
  cache.dispose(); cache.dispose();
  expect(existsSync(path)).toBe(false);
  expect(() => cache.write("file", bytes)).toThrow("retired");
});

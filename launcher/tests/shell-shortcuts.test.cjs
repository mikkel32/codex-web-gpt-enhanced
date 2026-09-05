const { test } = require("node:test");
const assert = require("node:assert/strict");
const { shellNavigationForInput } = require("../electron/shell-shortcuts.cjs");
test("native shortcuts are platform-specific, bounded, and leave typing alone", () => {
  const key = { type: "keyDown", meta: true, key: "K" };
  assert.deepEqual(shellNavigationForInput(key, "darwin"), { type: "commands" });
  assert.equal(shellNavigationForInput(key, "win32"), null);
  assert.deepEqual(shellNavigationForInput({ ...key, meta: false, control: true }, "win32"), { type: "commands" });
  assert.deepEqual(shellNavigationForInput({ ...key, key: "8" }, "darwin"), { type: "navigate", index: 7 });
  for (const patch of [{ key: "9" }, { key: "Enter" }, { key: " " }, { shift: true }, { alt: true }, { isAutoRepeat: true }, { isComposing: true }, { type: "keyUp" }])
    assert.equal(shellNavigationForInput({ ...key, ...patch }, "darwin"), null);
});

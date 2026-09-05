function shellNavigationForInput(input, platform = process.platform) {
  if (!input || input.type !== "keyDown" || input.isAutoRepeat || input.isComposing || input.shift || input.alt) return null;
  if (!(platform === "darwin" ? input.meta : input.control)) return null;
  const key = String(input.key ?? "").toLowerCase();
  if (key === "k") return { type: "commands" };
  if (key === "b") return { type: "sidebar" };
  if (/^[1-8]$/.test(key)) return { type: "navigate", index: Number(key) - 1 };
  return null;
}
module.exports = { shellNavigationForInput };

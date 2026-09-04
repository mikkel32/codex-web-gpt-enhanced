const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function connectorId(key) {
  return crypto.createHash("sha256").update(Buffer.from(key, "base64")).digest("hex").slice(0, 32)
    .replace(/[0-9a-f]/g, character => String.fromCharCode(97 + parseInt(character, 16)));
}

function prepareDevBrowserConnector(source, coreHome) {
  const folder = path.join(coreHome, "browser-connector");
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  const keyPath = path.join(coreHome, "browser-connector-public-key.json");
  let key;
  if (fs.existsSync(keyPath)) key = JSON.parse(fs.readFileSync(keyPath, "utf8")).key;
  else {
    const { publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    key = publicKey.export({ format: "der", type: "spki" }).toString("base64");
    fs.writeFileSync(keyPath, JSON.stringify({ key }), { mode: 0o600, flag: "wx" });
  }
  crypto.createPublicKey({ key: Buffer.from(key, "base64"), format: "der", type: "spki" });
  for (const name of ["connect.html", "connect.js", "connect.css", "icon.png"]) fs.copyFileSync(path.join(source, name), path.join(folder, name));
  const manifest = JSON.parse(fs.readFileSync(path.join(source, "manifest.json"), "utf8"));
  manifest.key = key; manifest.name = "Maria Browser Sign-in DEV";
  fs.writeFileSync(path.join(folder, "manifest.json"), JSON.stringify(manifest, null, 2));
  return { folder, id: connectorId(key) };
}

module.exports = { prepareDevBrowserConnector, connectorId };

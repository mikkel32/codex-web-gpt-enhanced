const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const launcherRoot = path.resolve(__dirname, "..");
const extension = path.resolve(launcherRoot, "..", "browser-connector", "extension");
const manifest = JSON.parse(fs.readFileSync(path.join(extension, "manifest.json"), "utf8"));
if (!manifest.permissions.includes("cookies") || !manifest.key) throw new Error("Browser connector manifest is incomplete");
if (process.platform !== "darwin") process.exit(0);

const project = path.join(launcherRoot, "build", "safari-project");
const output = path.join(launcherRoot, "build", "safari");
function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", timeout: 180000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed while preparing the Safari connector`);
}
run("xcrun", ["safari-web-extension-converter", extension, "--project-location", project,
  "--app-name", "Maria Browser Sign-in", "--bundle-identifier", "dev.maria.browser-signin",
  "--macos-only", "--swift", "--copy-resources", "--no-open", "--no-prompt", "--force"]);
const projectFile = path.join(project, "Maria Browser Sign-in", "Maria Browser Sign-in.xcodeproj", "project.pbxproj");
// Some Xcode converters derive the containing app ID from its display name while
// applying --bundle-identifier only to the extension. Keep the parent relationship valid.
fs.writeFileSync(projectFile, fs.readFileSync(projectFile, "utf8").replace(
  /PRODUCT_BUNDLE_IDENTIFIER = "([^"]+)";/g,
  (_line, identifier) => `PRODUCT_BUNDLE_IDENTIFIER = "${identifier.endsWith(".Extension") ? "dev.maria.browser-signin.Extension" : "dev.maria.browser-signin"}";`,
));
run("xcodebuild", ["-project", path.join(project, "Maria Browser Sign-in", "Maria Browser Sign-in.xcodeproj"),
  "-scheme", "Maria Browser Sign-in", "-configuration", "Release", "-derivedDataPath", output,
  "CODE_SIGN_IDENTITY=-", "CODE_SIGNING_ALLOWED=YES", "CODE_SIGNING_REQUIRED=YES", "REGISTER_APP_WITH_LAUNCH_SERVICES=NO", "build"]);
run("codesign", ["--verify", "--deep", "--strict", path.join(output, "Build", "Products", "Release", "Maria Browser Sign-in.app")]);

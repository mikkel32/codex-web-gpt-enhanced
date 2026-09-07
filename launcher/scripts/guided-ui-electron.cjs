const { app, BrowserWindow, session } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const home = process.env.GUIDED_UI_TEST_HOME;
if (!home || !path.isAbsolute(home)) throw new Error("An isolated renderer test home is required");
app.setPath("userData", home);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("remote-debugging-address", "127.0.0.1");
app.commandLine.appendSwitch("remote-debugging-port", "0");
app.commandLine.appendSwitch("disable-background-timer-throttling");
let fixtureWindow;
const stop = path.join(home, "stop");
fs.watchFile(stop, { interval: 100 }, current => { if (current.size) app.quit(); });
app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url);
    callback({ cancel: !["data:", "about:", "devtools:"].includes(url.protocol) && !(url.protocol === "http:" && url.hostname === "127.0.0.1") });
  });
  fixtureWindow = new BrowserWindow({ show: true, width: 1180, height: 1000,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
  fixtureWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  await fixtureWindow.loadURL("about:blank");
});
app.on("will-quit", () => fs.unwatchFile(stop));
app.on("window-all-closed", () => app.quit());

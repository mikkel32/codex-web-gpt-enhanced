const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const home = process.env.ASTRA_PICKER_TEST_HOME;
if (!home || !path.isAbsolute(home)) throw new Error('An isolated test home is required');
app.setPath('userData', home);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
app.commandLine.appendSwitch('remote-debugging-port', '0');
app.commandLine.appendSwitch('disable-background-timer-throttling');
// Keep a strong reference on every OS; a collected BrowserWindow closes its page.
let fixtureWindow;
const stopFile = path.join(home, 'stop');
fs.watchFile(stopFile, { interval: 100 }, current => { if (current.size) app.quit(); });
app.whenReady().then(async () => {
  fixtureWindow = new BrowserWindow({ show: false, width: 900, height: 700, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  await fixtureWindow.loadFile(path.resolve(__dirname, '../../tests/fixtures/astra-picker.html'));
});
app.on('will-quit', () => fs.unwatchFile(stopFile));
app.on('window-all-closed', () => app.quit());

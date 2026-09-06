const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const home = process.env.ASTRA_PICKER_TEST_HOME;
if (!home || !path.isAbsolute(home)) throw new Error('An isolated test home is required');
app.setPath('userData', home);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
app.commandLine.appendSwitch('remote-debugging-port', '0');
app.commandLine.appendSwitch('disable-background-timer-throttling');
process.stdin.on('end', () => app.quit());
process.stdin.resume();
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 900, height: 700, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  await window.loadFile(path.resolve(__dirname, '../../tests/fixtures/astra-picker.html'));
});
app.on('window-all-closed', () => app.quit());

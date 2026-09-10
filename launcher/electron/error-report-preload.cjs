const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("errorReporting", Object.freeze({
  request: value => ipcRenderer.invoke("maria:error-reporting:settings", value),
}));

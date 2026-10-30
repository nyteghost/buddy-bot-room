const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("showpilotAI", Object.freeze({
  status: () => ipcRenderer.invoke("showpilot-ai:status"),
  saveKey: (provider, key) => ipcRenderer.invoke("showpilot-ai:save",provider,key),
  removeKey: (provider) => ipcRenderer.invoke("showpilot-ai:remove",provider),
  suggestTasks: (provider, context) => ipcRenderer.invoke("showpilot-ai:suggest",provider,context),
}));

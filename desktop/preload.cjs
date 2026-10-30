const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("showpilotUpdates",Object.freeze({status:()=>ipcRenderer.invoke("showpilot-update:status"),setChannel:(channel)=>ipcRenderer.invoke("showpilot-update:channel",channel),check:()=>ipcRenderer.invoke("showpilot-update:check"),open:()=>ipcRenderer.invoke("showpilot-update:open")}));
contextBridge.exposeInMainWorld("showpilotAI", Object.freeze({
  status: () => ipcRenderer.invoke("showpilot-ai:status"),
  saveKey: (provider, key) => ipcRenderer.invoke("showpilot-ai:save",provider,key),
  removeKey: (provider) => ipcRenderer.invoke("showpilot-ai:remove",provider),
  suggestTasks: (provider, context) => ipcRenderer.invoke("showpilot-ai:suggest",provider,context),
}));

contextBridge.exposeInMainWorld("showpilotCalendar", Object.freeze({
  status: () => ipcRenderer.invoke("showpilot-calendar:status"),
  saveClient: (json) => ipcRenderer.invoke("showpilot-calendar:save-client",json),
  connect: () => ipcRenderer.invoke("showpilot-calendar:connect"),
  disconnect: () => ipcRenderer.invoke("showpilot-calendar:disconnect"),
  forget: () => ipcRenderer.invoke("showpilot-calendar:forget"),
  updateAll: (payload) => ipcRenderer.invoke("showpilot-calendar:update-all",payload),
}));

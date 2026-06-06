const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getApiUrl: () => ipcRenderer.invoke('get-api-url'),
});
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('workManager', {
  versions: process.versions,
  openExternal: (url) => ipcRenderer.invoke('browser:open-external', url)
});

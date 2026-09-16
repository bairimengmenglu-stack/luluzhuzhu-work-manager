const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('workManager', {
  versions: process.versions,
  openExternal: (url) => ipcRenderer.invoke('browser:open-external', url),
  // 主进程转发的 guest 新窗口请求 → 在浏览器面板里开新标签
  onNewTab: (callback) => ipcRenderer.on('browser:new-tab', (_event, payload) => callback(payload))
});

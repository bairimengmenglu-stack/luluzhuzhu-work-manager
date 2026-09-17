const { contextBridge, ipcRenderer, webFrame } = require('electron');

// ZCode 桌面缩放：Ctrl+= / Ctrl+- / Ctrl+0 调整整窗缩放级别
contextBridge.exposeInMainWorld('workManager', {
  versions: process.versions,
  platform: process.platform,
  openExternal: (url) => ipcRenderer.invoke('browser:open-external', url),
  // 主进程转发的 guest 新窗口请求 → 在浏览器面板里开新标签
  onNewTab: (callback) => ipcRenderer.on('browser:new-tab', (_event, payload) => callback(payload)),
  zoomStep: (delta) => {
    const current = webFrame.getZoomLevel();
    const next = Math.max(-2, Math.min(2, delta === 0 ? 0 : current + delta));
    webFrame.setZoomLevel(next);
  },
  // settings.browser.*：忽略证书校验 / 清除数据
  setInsecure: (on) => ipcRenderer.invoke('browser:set-insecure', on),
  clearData: (mode) => ipcRenderer.invoke('browser:clear-data', mode),
  confirmClearAll: () => ipcRenderer.invoke('browser:confirm-clear-all'),
  // 选品建档：保存当前页完整 HTML
  archivePage: (payload) => ipcRenderer.invoke('browser:archive-page', payload)
});

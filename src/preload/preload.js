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
  archivePage: (payload) => ipcRenderer.invoke('browser:archive-page', payload),
  // 选品建档：批量下载页面图片
  archiveImages: (payload) => ipcRenderer.invoke('browser:archive-images', payload),
  // 删除选品条目时同步删除建档文件
  deleteArchive: (file) => ipcRenderer.invoke('browser:delete-archive', file),
  // 建档目录（渲染层拼接 file:// 预览图）
  archiveRoot: () => ipcRenderer.invoke('browser:archive-root'),
  openArchiveFile: (rel) => ipcRenderer.invoke('browser:open-archive-file', rel),
  // 本地建档文件清单
  listArchive: () => ipcRenderer.invoke('browser:list-archive'),
  // 删除单张建档图片（同步元数据）
  deleteImage: (base, rel) => ipcRenderer.invoke('browser:delete-image', { base, rel })
});

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('workManager', {
  versions: process.versions
});

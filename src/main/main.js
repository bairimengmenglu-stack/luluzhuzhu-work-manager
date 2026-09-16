const { app, BrowserWindow, shell, ipcMain, Menu } = require('electron');
const path = require('path');

Menu.setApplicationMenu(null);

// 与 ZCode 一致的 webview URL 协议白名单
const SUPPORTED_URL = /^(https?|file|about|data):/i;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: 'luluzhuzhu 工作管理',
    backgroundColor: '#fafafa',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // 对齐 ZCode will-attach-webview：加固 guest 配置并在挂载时校验 URL
  win.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    webPreferences.contextIsolation = true;
    webPreferences.nodeIntegration = false;
    webPreferences.sandbox = true;
    delete params.preload;
    delete params.nodeintegration;
    params.nodeintegrationinsubframes = 'true';
    delete params.disablewebsecurity;
    params.allowpopups = 'true';

    const src = params.src ?? 'about:blank';
    if (!SUPPORTED_URL.test(src)) {
      event.preventDefault();
    }
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

// 对齐 ZCode did-attach-webview 的 guest 新窗口策略：
// 默认发给渲染层在浏览器面板开新标签；按住 Ctrl/⌘ 或 background-tab 时用系统浏览器
app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() !== 'webview') return;

  let externalModifier = false;
  contents.on('before-input-event', (_e, input) => {
    const modifierKeyUp =
      input.type === 'keyUp' &&
      (input.key === 'Control' || input.key === 'Meta' ||
        input.code === 'ControlLeft' || input.code === 'ControlRight' ||
        input.code === 'MetaLeft' || input.code === 'MetaRight');
    if (modifierKeyUp) {
      externalModifier = false;
      return;
    }
    externalModifier = input.meta === true || input.control === true;
  });

  contents.setWindowOpenHandler(({ url, disposition }) => {
    if (!SUPPORTED_URL.test(url)) return { action: 'deny' };

    if (externalModifier || disposition === 'background-tab') {
      shell.openExternal(url).catch(() => {});
      return { action: 'deny' };
    }

    contents.hostWebContents?.send('browser:new-tab', { url, disposition });
    return { action: 'deny' };
  });
});

ipcMain.handle('browser:open-external', (_event, url) => {
  if (typeof url === 'string' && SUPPORTED_URL.test(url)) {
    shell.openExternal(url);
  }
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

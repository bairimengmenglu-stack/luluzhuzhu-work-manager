const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron');
const path = require('path');

Menu.setApplicationMenu(null);

// 与 ZCode 一致的 webview URL 协议白名单
const SUPPORTED_URL = /^(https?|file|about|data):/i;

// ZCode buildWindowsTitleBarOverlay：透明底 + 主题色按钮，高度与自绘标题栏一致
const TITLEBAR_HEIGHT = 44;
const titleBarOverlay = () => ({ color: '#00000000', symbolColor: '#1f1f1f', height: TITLEBAR_HEIGHT });

// ZCode buildTextContextMenuTemplate：可编辑框全量编辑项；选中文字仅复制；未打包时追加 Inspect Element
function buildContextMenu(win, params) {
  const items = [];
  if (params.isEditable) {
    const f = params.editFlags;
    items.push(
      { label: '撤销', role: 'undo', enabled: f.canUndo },
      { label: '重做', role: 'redo', enabled: f.canRedo },
      { type: 'separator' },
      { label: '剪切', role: 'cut', enabled: f.canCut },
      { label: '复制', role: 'copy', enabled: f.canCopy },
      { label: '粘贴', role: 'paste', enabled: f.canPaste },
      { label: '删除', role: 'delete', enabled: f.canDelete },
      { type: 'separator' },
      { label: '全选', role: 'selectAll', enabled: f.canSelectAll }
    );
  } else if (params.selectionText.trim().length > 0) {
    items.push({ label: '复制', role: 'copy', enabled: params.editFlags.canCopy });
  }
  if (!app.isPackaged) {
    if (items.length > 0) items.push({ type: 'separator' });
    items.push({
      label: 'Inspect Element',
      click: () => win.webContents.inspectElement(params.x, params.y)
    });
  }
  return items;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 480,
    minHeight: 640,
    title: 'luluzhuzhu 工作管理',
    backgroundColor: '#fafafa',
    // ZCode Windows 顶栏方案：隐藏原生标题栏，保留原生窗口按钮（overlay）
    titleBarStyle: 'hidden',
    titleBarOverlay: titleBarOverlay(),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true
    }
  });

  // 右键菜单（ZCode 同款模板，仅宿主页面；guest 页面无菜单）
  win.webContents.on('context-menu', (_event, params) => {
    const items = buildContextMenu(win, params);
    if (items.length > 0) Menu.buildFromTemplate(items).popup({ window: win });
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

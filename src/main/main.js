const { app, BrowserWindow, Menu, shell, ipcMain, dialog, session, net } = require('electron');
const fsPromises = require('fs/promises');
const path = require('path');

// 选品建档：HTML 快照独立目录（git 忽略，未来在此解析商品信息）
const ARCHIVE_DIR = path.join(__dirname, '..', '..', 'selection-archive');

Menu.setApplicationMenu(null);

// 与 ZCode 一致的 webview URL 协议白名单
const SUPPORTED_URL = /^(https?|file|about|data):/i;
// ZCode 内嵌浏览器持久化分区（本地命名对齐应用）
const BROWSER_PARTITION = 'persist:embedded-browser';
// ZCode 同款：guest 页 alert/confirm 品牌化对话框的预加载脚本
const GUEST_DIALOG_PRELOAD = path.join(__dirname, '..', 'preload', 'guest-dialogs.cjs');
let allowInsecureCerts = false;

// ZCode clearEmbeddedBrowserData：cache 模式保留 Cookie/登录态，all 模式全清
ipcMain.handle('browser:clear-data', async (_event, mode) => {
  const s = session.fromPartition(BROWSER_PARTITION);
  await s.clearCache();
  if (mode === 'all') {
    await s.clearStorageData();
  } else {
    await s.clearStorageData({ storages: ['shadercache', 'serviceworkers', 'cachestorage'] });
  }
  return true;
});

ipcMain.handle('browser:set-insecure', (_event, on) => {
  allowInsecureCerts = !!on;
  return true;
});

ipcMain.handle('browser:confirm-clear-all', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showMessageBox(win, {
    type: 'warning',
    title: '清除全部内置浏览器数据',
    message: '清除全部内置浏览器数据？',
    detail: '这会退出内置浏览器中已登录的网站，并删除 Cookie、站点数据和缓存。此操作不可撤销。',
    buttons: ['确认清除', '取消'],
    defaultId: 0,
    cancelId: 1
  });
  return result.response === 0;
});

// ZCode EmbeddedBrowserJavaScriptDialog：guest 页 alert/confirm 同步换宿主品牌化对话框
ipcMain.on('guest-dialog', (event, payload) => {
  event.returnValue = handleGuestDialog(event, payload);
});

function handleGuestDialog(event, payload) {
  try {
    if (typeof payload !== 'object' || payload === null) return { handled: false };
    const { type, message } = payload;
    if ((type !== 'alert' && type !== 'confirm') || typeof message !== 'string') return { handled: false };
    if (event.sender.getType() !== 'webview') return { handled: false };

    // ZCode resolveEmbeddedBrowserDialogSource：`<host> says`
    let source = 'This page says';
    for (const candidate of [event.senderFrame?.url ?? '', event.sender.getURL()]) {
      if (!candidate) continue;
      try {
        const u = new URL(candidate);
        if ((u.protocol === 'http:' || u.protocol === 'https:') && u.host) {
          source = `${u.host} says`;
          break;
        }
      } catch { /* 非 URL 候选 */ }
    }

    const win = BrowserWindow.fromWebContents(event.sender);
    const choice = dialog.showMessageBoxSync(win, {
      type: type === 'alert' ? 'info' : 'question',
      buttons: type === 'alert' ? ['确定'] : ['取消', '确定'],
      defaultId: type === 'alert' ? 0 : 1,
      cancelId: 0,
      message: source,
      detail: message,
      noLink: true
    });
    return { handled: true, ...(type === 'confirm' ? { value: choice === 1 } : {}) };
  } catch {
    return { handled: false };
  }
}

// ZCode embeddedBrowserAllowInsecureCertificates：仅对内置浏览器分区生效
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  if (allowInsecureCerts && webContents.session === session.fromPartition(BROWSER_PARTITION)) {
    event.preventDefault();
    callback(true);
    return;
  }
  callback(false);
});

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

  // 对齐 ZCode will-attach-webview：加固 guest 配置、注入对话框预加载并校验 URL
  win.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    webPreferences.contextIsolation = true;
    webPreferences.nodeIntegration = false;
    webPreferences.sandbox = true;
    webPreferences.preload = GUEST_DIALOG_PRELOAD;
    params.nodeintegrationinsubframes = 'true';
    delete params.nodeintegration;
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

// 选品建档：保存渲染后的完整 HTML + 元数据 JSON，返回文件名挂到清单条目
// 选品建档：保存渲染后的完整 HTML + 元数据 JSON，返回文件名挂到清单条目
const EXT_BY_MIME = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
  'image/avif': '.avif', 'image/bmp': '.bmp', 'image/svg+xml': '.svg'
};
const VALID_BASE = /^[\w.-]+$/;

// 选品建档图片下载：走内嵌浏览器同一 session（命中浏览器磁盘缓存、共享登录 Cookie），
// 按 主图/sku/视频/详情 分类命名；单图失败跳过
ipcMain.handle('browser:archive-images', async (_event, payload) => {
  try {
    if (typeof payload !== 'object' || payload === null) return { ok: false, map: {} };
    const { baseName, referer, categorized } = payload;
    if (typeof baseName !== 'string' || !VALID_BASE.test(baseName) || typeof categorized !== 'object' || categorized === null) {
      return { ok: false, map: {} };
    }
    const dir = path.join(ARCHIVE_DIR, `${baseName}_files`);
    await fsPromises.mkdir(dir, { recursive: true });
    // 条目为 {url, hd}：hd 为渲染层按 Fatkun alicdn 规则生成的高清链，优先下载，失败回退原图
    const cats = {};
    for (const cat of ['sku', 'main', 'detail']) {
      if (Array.isArray(categorized[cat])) {
        cats[cat] = categorized[cat]
          .filter((e) => e && typeof e.url === 'string' && /^https?:\/\//i.test(e.url))
          .slice(0, 80);
      }
    }
    const map = {};
    const failed = [];
    const queue = [];
    for (const cat of Object.keys(cats)) {
      for (const entry of cats[cat]) {
        const targets = entry.hd && /^https?:\/\//i.test(entry.hd) && entry.hd !== entry.url
          ? [entry.hd, entry.url]
          : [entry.url];
        queue.push({ cat, url: entry.url, targets });
      }
    }
    const counters = {};
    const worker = async () => {
      while (queue.length) {
        const { cat, url, targets } = queue.shift();
        try {
          if (map[url]) continue; // 多规格共享同一图时只下载一次，条目仍一一对应
          let buf = null;
          let mime = '';
          // SKU 需要可用大图：逐候选下载，sku 要求 ≥3KB（过滤坏图/占位图），全部失败再用原图
          for (const target of targets) {
            const candidates = cat === 'sku'
              ? [target, url.replace(/\.(png|jpg|jpeg|webp)(\?|$)/i, '_400x400.jpg$2'), url]
              : [target];
            let saved = false;
            for (const candidate of [...new Set(candidates)]) {
              if (!/^https?:\/\//i.test(candidate)) continue;
              try {
                const res = await net.fetch(candidate, {
                  session: session.fromPartition(BROWSER_PARTITION),
                  useSessionCookies: true,
                  signal: AbortSignal.timeout(15000),
                  redirect: 'follow'
                });
                if (!res.ok) { if (failed.length < 5) failed.push(`${res.status} ${candidate.slice(0, 60)}`); continue; }
                const b = Buffer.from(await res.arrayBuffer());
                // detail ≥2KB；主图/SKU ≥3KB（过滤坏图、1x1 占位图与图标）
                const min = cat === 'detail' ? 2048 : 3072;
                if (b.length < min) continue;
                buf = b;
                mime = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
                saved = true;
                break;
              } catch (err) {
                if (failed.length < 5) failed.push(`${err?.message || err} ${candidate.slice(0, 60)}`);
              }
            }
            if (saved) break;
          }
          if (!buf) continue;
          let ext = EXT_BY_MIME[mime]
            || (path.extname(new URL(url).pathname).match(/^(\.\w{1,5})$/) ? RegExp.$1 : '');
          if (!ext) ext = '.img';
          counters[cat] = (counters[cat] || 0) + 1;
          const fname = `${cat}_${counters[cat]}${ext}`;
          await fsPromises.writeFile(path.join(dir, fname), buf);
          map[url] = `${baseName}_files/${fname}`;
        } catch (err) {
          if (failed.length < 5) failed.push(`${err?.message || err} ${url.slice(0, 60)}`);
        }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    return { ok: true, map, failed };
  } catch (err) {
    return { ok: false, map: {}, error: err?.message || String(err) };
  }
});

ipcMain.handle('browser:archive-page', async (_event, payload) => {
  try {
    if (typeof payload !== 'object' || payload === null) return { ok: false, error: 'bad payload' };
    const { html, url, title } = payload;
    if (typeof html !== 'string' || !html || typeof url !== 'string' || !SUPPORTED_URL.test(url)) {
      return { ok: false, error: 'bad payload' };
    }
    await fsPromises.mkdir(ARCHIVE_DIR, { recursive: true });
    // 渲染层可传入共享 baseName（图片目录同名复用），否则本地生成
    let name = typeof payload.baseName === 'string' && VALID_BASE.test(payload.baseName) ? payload.baseName : '';
    if (!name) {
      let host = 'page';
      try {
        host = new URL(url).hostname.replace(/^www\./, '').replace(/[^\w.-]/g, '') || 'page';
      } catch { /* 保底文件名 */ }
      name = `${new Date().toISOString().slice(0, 10)}_${host}_${Date.now()}`;
    }
    await fsPromises.writeFile(path.join(ARCHIVE_DIR, `${name}.html`), html, 'utf8');
    const metaOut = { url, title: typeof title === 'string' ? title : '', savedAt: new Date().toISOString() };
    // 渲染层提取的商品信息（价格/参数/SKU/分类图片）合并进元数据
    if (typeof payload.meta === 'object' && payload.meta !== null) {
      for (const [k, v] of Object.entries(payload.meta)) {
        if (v !== undefined && v !== null) metaOut[k] = v;
      }
    }
    await fsPromises.writeFile(
      path.join(ARCHIVE_DIR, `${name}.json`),
      JSON.stringify(metaOut, null, 2),
      'utf8'
    );
    return { ok: true, file: `${name}.html` };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
});

// 删除选品条目时同步删除建档文件（仅限 ARCHIVE_DIR 内，防路径穿越）
ipcMain.handle('browser:delete-archive', async (_event, file) => {
  try {
    if (typeof file !== 'string' || !file) return { ok: false };
    const base = path.basename(file);
    if (base !== file || file.includes('\\') || file.includes('/')) return { ok: false };
    await fsPromises.rm(path.join(ARCHIVE_DIR, base), { force: true });
    await fsPromises.rm(path.join(ARCHIVE_DIR, base.replace(/\.html$/, '.json')), { force: true });
    await fsPromises.rm(path.join(ARCHIVE_DIR, `${base.replace(/\.html$/, '')}_files`), { recursive: true, force: true });
    return { ok: true };
  } catch {
    return { ok: false };
  }
});

ipcMain.handle('browser:archive-root', () => ARCHIVE_DIR);

// 打开建档目录内的本地文件（校验路径不越界）
ipcMain.handle('browser:open-archive-file', async (_event, rel) => {
  try {
    if (typeof rel !== 'string' || !rel) return false;
    const full = path.resolve(ARCHIVE_DIR, rel);
    if (!full.startsWith(path.resolve(ARCHIVE_DIR))) return false;
    return await shell.openPath(full);
  } catch {
    return false;
  }
});

// 本地建档文件清单（按修改时间倒序）
ipcMain.handle('browser:list-archive', async () => {
  try {
    await fsPromises.mkdir(ARCHIVE_DIR, { recursive: true });
    const names = await fsPromises.readdir(ARCHIVE_DIR);
    const bases = new Map();
    for (const n of names) {
      const full = path.join(ARCHIVE_DIR, n);
      let base = null;
      let isDir = false;
      if (n.endsWith('.html')) { base = n.slice(0, -5); }
      else if (n.endsWith('_files')) { base = n.slice(0, -6); isDir = true; }
      if (base === null) continue;
      const b = bases.get(base) || { base, html: '', images: 0, mtime: 0 };
      try {
        const st = await fsPromises.stat(full);
        b.mtime = Math.max(b.mtime, st.mtimeMs);
      } catch { /* 忽略 */ }
      if (isDir) {
        try { b.images = (await fsPromises.readdir(full)).length; } catch { /* 忽略 */ }
      } else {
        b.html = n;
      }
      bases.set(base, b);
    }
    const out = [];
    for (const b of bases.values()) {
      let title = '';
      let date = '';
      if (b.html) {
        try {
          const j = JSON.parse(await fsPromises.readFile(path.join(ARCHIVE_DIR, b.base + '.json'), 'utf8'));
          title = j.title || '';
          date = (j.savedAt || '').slice(0, 10);
        } catch { /* 无元数据 */ }
      }
      out.push({ base: b.base, html: b.html, title, date, images: b.images, mtime: b.mtime });
    }
    out.sort((a, b2) => b2.mtime - a.mtime);
    return out;
  } catch {
    return [];
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

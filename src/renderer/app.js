/* ZCode 风格的工作管理应用：左侧栏 + 工作台 + 浏览器侧面板（多标签） */

const $ = (sel) => document.querySelector(sel);

const state = {
  tabs: [],           // { id, url, title, favicon, openedAt, isLoading, canGoBack, canGoForward, error }
  closed: [],         // { title, url, closedAt }
  activeTabId: null,
  paneOpen: false,
  sidebarOpen: true,
  responsive: false,
  responsiveZoom: 'fit',
  picking: false,
  nextTabId: 1
};

/* ---------- 左侧栏收起与调宽（ZCode toggleSidebar / resizeSidebar） ---------- */

const SIDEBAR_DEFAULT_WIDTH = 236;
const SIDEBAR_RANGE = { min: 180, max: 340 };

function sidebarWidthOk(w) {
  return Number.isInteger(w) && w >= SIDEBAR_RANGE.min && w <= SIDEBAR_RANGE.max;
}

function setSidebarOpen(open) {
  state.sidebarOpen = open;
  $('#sidebar').hidden = !open;
  $('#ic-sidebar-close').classList.toggle('hidden', !open);
  $('#ic-sidebar-open').classList.toggle('hidden', open);
  $('#btn-toggle-sidebar').title = open ? '隐藏侧边栏 (Ctrl+B)' : '显示侧边栏 (Ctrl+B)';
  try { localStorage.setItem('sidebar.collapsed', open ? '0' : '1'); } catch { /* 忽略 */ }
}

function initSidebarResize() {
  const handle = $('#sb-resize-handle');
  const sidebar = $('#sidebar');
  const saved = parseInt(localStorage.getItem('sidebar.width'), 10);
  if (sidebarWidthOk(saved)) sidebar.style.width = saved + 'px';

  let startX = 0, startW = 0, dragging = false;
  handle.addEventListener('pointerdown', (e) => {
    dragging = true;
    startX = e.clientX;
    startW = sidebar.getBoundingClientRect().width;
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const w = startW + (e.clientX - startX);
    if (sidebarWidthOk(w)) sidebar.style.width = w + 'px';
  });
  handle.addEventListener('pointerup', () => {
    dragging = false;
    const w = Math.round(sidebar.getBoundingClientRect().width);
    if (sidebarWidthOk(w)) localStorage.setItem('sidebar.width', String(w));
  });
  handle.addEventListener('dblclick', () => {
    sidebar.style.width = '';
    localStorage.removeItem('sidebar.width');
  });
}

/* ---------- 工具 ---------- */

function toast(msg, ms = 3500) {
  const item = document.createElement('div');
  item.className = 'toast';
  item.textContent = msg;
  $('#toast-wrap').appendChild(item);
  setTimeout(() => item.remove(), ms);
}

function relTime(ts) {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  return `${Math.floor(hr / 24)} 天前`;
}

const URL_SCHEMES = /^(https?|file|about|data):/i;
const BARE_HOST = /^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/i;

function resolveUrl(raw) {
  const input = (raw || '').trim();
  if (!input) return null;
  if (URL_SCHEMES.test(input)) return input;
  if (BARE_HOST.test(input)) return `https://${input}`;
  return null;
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

const GLOBE_MINI =
  '<svg class="ic" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>';

/* ---------- 标签管理 ---------- */

function activeTab() {
  return state.tabs.find((t) => t.id === state.activeTabId) || null;
}

function createTab(url = '') {
  const tab = {
    id: state.nextTabId++,
    url,
    title: '',
    favicon: '',
    openedAt: Date.now(),
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    error: null
  };
  state.tabs.push(tab);
  createView(tab);
  activateTab(tab.id);
  renderStrip();
  return tab;
}

function closeTab(id) {
  const idx = state.tabs.findIndex((t) => t.id === id);
  if (idx === -1) return;
  const tab = state.tabs[idx];
  const view = $('#view-' + id);
  if (view) try { view.close(); } catch { /* 已卸载 */ }
  state.tabs.splice(idx, 1);
  if (tab.url) state.closed.unshift({ title: tabTitle(tab), url: tab.url, closedAt: Date.now() });
  if (state.closed.length > 20) state.closed.pop();

  if (state.activeTabId === id) {
    const next = state.tabs[idx] || state.tabs[idx - 1];
    state.activeTabId = next ? next.id : null;
  }
  renderViews();
  renderStrip();
  syncToolbar();
}

function activateTab(id) {
  state.activeTabId = id;
  renderStrip();
  renderViews();
  syncToolbar();
}

function tabTitle(tab) {
  return tab.title || (tab.url ? hostOf(tab.url) : '新标签页');
}

/* ---------- 视图 ---------- */

function createView(tab) {
  const wrap = document.createElement('div');
  wrap.className = 'view-wrap';
  wrap.id = 'wrap-' + tab.id;
  const stage = document.createElement('div');
  stage.className = 'vp-stage';
  const view = document.createElement('webview');
  view.id = 'view-' + tab.id;
  // ZCode 同款持久化会话分区：Cookie/登录态在重启后保留，代理跟随系统
  view.setAttribute('partition', 'persist:embedded-browser');
  view.src = tab.url || 'about:blank';
  view.setAttribute('allowpopups', '');
  stage.appendChild(view);
  wrap.appendChild(stage);
  $('#views').appendChild(wrap);
  wireView(tab, view);
}

function renderViews() {
  for (const tab of state.tabs) {
    const wrap = $('#wrap-' + tab.id);
    if (wrap) wrap.classList.toggle('active', tab.id === state.activeTabId);
  }
  const paneEl = $('#browser-pane');
  const tab = activeTab();
  const showEmpty = !tab || !tab.url;
  $('#browser-empty').classList.toggle('hidden', !(showEmpty && !tab?.error));
  $('#browser-loading').classList.toggle('hidden', !(tab && tab.isLoading && !tab.error));
  paneEl.classList.toggle('loading', !!tab?.isLoading);
}

function wireView(tab, view) {
  view.addEventListener('did-start-loading', () => {
    tab.isLoading = true;
    tab.error = null;
    syncToolbar();
    renderViews();
  });

  view.addEventListener('did-stop-loading', () => {
    tab.isLoading = false;
    syncToolbar();
    renderViews();
  });

  view.addEventListener('did-navigate', (e) => {
    if (e.url === 'about:blank') return;
    tab.url = e.url;
    tab.error = null;
    syncAddress();
    syncToolbar();
    renderViews();
    renderStrip();
  });

  view.addEventListener('did-navigate-in-page', (e) => {
    if (e.url === 'about:blank') return;
    tab.url = e.url;
    syncAddress();
    renderStrip();
  });

  view.addEventListener('page-title-updated', (e) => {
    tab.title = e.title;
    renderStrip();
  });

  view.addEventListener('page-favicon-updated', (e) => {
    tab.favicon = (e.favicons && e.favicons[0]) || '';
    renderStrip();
  });

  view.addEventListener('did-fail-load', (e) => {
    if (!e.isMainFrame || e.errorCode === -3) return;
    const CERT_CODES = [-200, -201, -202, -203, -205, -206, -207, -210, -211];
    if (CERT_CODES.includes(e.errorCode)) {
      tab.errorTitle = '该站点的 HTTPS 证书不受信任';
      tab.guestGone = false;
    } else {
      tab.errorTitle = '无法打开该页面';
      tab.guestGone = false;
    }
    tab.error = e.errorDescription || '加载失败';
    renderViews();
    renderError(tab);
  });

  view.addEventListener('render-process-gone', () => {
    tab.errorTitle = '内置浏览器启动失败';
    tab.error = '浏览器进程在显示页面前退出。检查系统环境后可以重试。';
    tab.guestGone = true;
    renderViews();
    renderError(tab);
  });

  view.addEventListener('dom-ready', () => {
    if (tab.url && state.activeTabId === tab.id) syncToolbar();
  });
}

/* ---------- 标签条 ---------- */

let dragTabId = null;

function renderStrip() {
  const strip = $('#tab-strip');
  strip.textContent = '';
  for (const tab of state.tabs) {
    const el = document.createElement('div');
    el.className = 'browser-tab' + (tab.id === state.activeTabId ? ' active' : '');
    el.dataset.tabId = tab.id;

    const fav = document.createElement('span');
    fav.className = 'tab-fav';
    if (tab.favicon) {
      const img = document.createElement('img');
      img.src = tab.favicon;
      img.onerror = () => { fav.innerHTML = GLOBE_MINI; };
      fav.appendChild(img);
    } else {
      fav.innerHTML = GLOBE_MINI;
    }

    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = tabTitle(tab);

    const close = document.createElement('span');
    close.className = 'tab-close';
    close.title = '关闭标签';
    close.innerHTML = '<svg class="ic" viewBox="0 0 24 24"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(tab.id);
    });

    el.append(fav, title, close);
    el.title = tabTitle(tab);
    el.addEventListener('click', (e) => {
      if (e.button === 1) return;
      activateTab(tab.id);
    });
    el.addEventListener('auxclick', (e) => {
      if (e.button === 1) closeTab(tab.id);
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openTabContextMenu(e, tab);
    });

    // ZCode 标签可拖拽排序（dnd-kit），这里用 HTML5 DnD 实现同效果
    el.draggable = true;
    el.addEventListener('dragstart', (e) => {
      dragTabId = tab.id;
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', String(tab.id)); } catch { /* IE 兼容无需 */ }
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      dragTabId = null;
    });
    el.addEventListener('dragover', (e) => {
      if (dragTabId == null || dragTabId === tab.id) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const from = state.tabs.findIndex((t) => t.id === dragTabId);
      const to = state.tabs.findIndex((t) => t.id === tab.id);
      if (from < 0 || to < 0) return;
      const rect = el.getBoundingClientRect();
      let target = e.clientX > rect.left + rect.width / 2 ? to + 1 : to;
      if (from < target) target -= 1;
      if (target !== from) {
        const [moved] = state.tabs.splice(from, 1);
        state.tabs.splice(target, 0, moved);
        renderStrip();
      }
    });
    strip.appendChild(el);
  }
  const active = strip.querySelector('.browser-tab.active');
  if (active) active.scrollIntoView({ inline: 'nearest' });
  saveSession();
}

/* ---------- 工具栏同步 ---------- */

function syncToolbar() {
  const tab = activeTab();
  const ready = !!tab && !!tab.url && !tab.error;
  $('#b-back').disabled = !tab || !tab.canGoBack;
  $('#b-forward').disabled = !tab || !tab.canGoForward;
  $('#b-reload').disabled = !ready && !(tab && tab.url);
  $('#b-picker').disabled = !ready;
  $('#ic-reload').classList.toggle('spinning', !!tab?.isLoading);
  $('#b-reload').title = tab?.isLoading ? '停止' : '刷新';
  syncAddress();
  updateBookmarkState();
}

// 选品建档：页面内一次性提取 分类图片 + 商品信息（标题/价格/SKU/参数）
const PRODUCT_DATA_SCRIPT = `(() => {
  const abs = (u) => {
    try {
      const x = new URL(u, location.href);
      return x.protocol === 'http:' || x.protocol === 'https:' ? x.href : null;
    } catch { return null; }
  };
  const cats = { video: [], sku: [], main: [], other: [] };
  const seen = new Set();
  const push = (cat, u) => { if (u && !seen.has(u)) { seen.add(u); cats[cat].push(u); } };
  const ancestorText = (el) => {
    let s = '', n = el;
    for (let i = 0; i < 5 && n; i++, n = n.parentElement) {
      s += ' ' + (n.className || '') + ' ' + (n.id || '');
    }
    return s.toLowerCase();
  };
  for (const v of document.querySelectorAll('video')) {
    const src = v.currentSrc || v.src || (v.querySelector('source') && v.querySelector('source').src);
    push('video', abs(src));
    push('video', abs(v.poster));
  }
  const LAZY = ['src', 'data-src', 'data-lazy-src', 'data-original'];
  for (const img of document.querySelectorAll('img')) {
    const urls = [];
    for (const a of LAZY) {
      const u = abs(img.getAttribute(a));
      if (u) urls.push(u);
    }
    if (img.srcset) {
      for (const part of img.srcset.split(',')) {
        const u = abs(part.trim().split(/\\s+/)[0]);
        if (u) urls.push(u);
      }
    }
    if (!urls.length) continue;
    const anc = ancestorText(img);
    const cat = /sku|variant|prop|color/i.test(anc) ? 'sku'
      : /gallery|mainpic|pic|carousel|swiper|thumb|banner|slide/i.test(anc) ? 'main' : 'other';
    for (const u of urls) push(cat, u);
  }
  const ogImg = document.querySelector('meta[property="og:image"]');
  if (ogImg && ogImg.content) {
    const u = abs(ogImg.content);
    if (u && !seen.has(u)) { seen.add(u); cats.main.unshift(u); }
  }
  const info = {};
  const ogTitle = document.querySelector('meta[property="og:title"]');
  if (ogTitle && ogTitle.content && ogTitle.content.trim()) info.title = ogTitle.content.trim();
  if (!info.title) {
    const h1 = document.querySelector('h1');
    if (h1) info.title = h1.textContent.trim();
  }
  const priceEl = document.querySelector('[class*="price" i]');
  if (priceEl) info.price = (priceEl.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40);
  info.skus = [];
  const skuSeen = new Set();
  for (const el of document.querySelectorAll('[class*="sku" i] img, [class*="sku" i] button, [class*="sku" i] li, [class*="sku" i] [class*="value" i]')) {
    const t = (el.getAttribute('aria-label') || el.title || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 60);
    const img = el.tagName === 'IMG' ? el : el.querySelector('img');
    const u = img ? abs(img.getAttribute('src') || img.getAttribute('data-src') || '') : null;
    const key = t + '|' + (u || '');
    if ((t || u) && !skuSeen.has(key)) {
      skuSeen.add(key);
      const entry = {};
      if (t) entry.name = t;
      if (u) entry.img = u;
      info.skus.push(entry);
    }
    if (info.skus.length >= 30) break;
  }
  info.params = [];
  const pSeen = new Set();
  for (const li of document.querySelectorAll('[class*="attr" i] li, [class*="attr" i] td, [class*="param" i] li, [class*="param" i] td, [class*="parameter" i] li')) {
    const t = (li.textContent || '').trim().replace(/\\s+/g, ' ');
    if (t && t.length <= 120 && !pSeen.has(t)) { pSeen.add(t); info.params.push(t); }
    if (info.params.length >= 60) break;
  }
  return { images: cats, info };
})()`;

function updateBookmarkState() {
  const btn = $('#b-bookmark');
  const tab = activeTab();
  const hasPage = !!tab?.url && tab.url !== 'about:blank' && !tab.error;
  btn.disabled = !hasPage;
  btn.title = hasPage ? '收藏到选品清单' : '没有可收藏的页面';
  btn.classList.toggle('starred', hasPage && readSelection().some((i) => i.url === tab.url));
}

async function bookmarkCurrentPage() {
  const tab = activeTab();
  if (!tab?.url || tab.url === 'about:blank') {
    toast('当前没有可收藏的页面');
    return;
  }
  const items = readSelection();
  // 与选品清单同步：已收藏 → 星标点击 = 删除（含建档文件）
  if (items.some((i) => i.url === tab.url)) {
    const item = items.find((i) => i.url === tab.url);
    if (item.file) await window.workManager.deleteArchive(item.file);
    writeSelection(items.filter((i) => i.url !== tab.url));
    renderSelection();
    updateBookmarkState();
    toast('已从选品清单移除');
    return;
  }

  const view = $('#view-' + tab.id);
  let data = null;
  try {
    data = await view.executeJavaScript(PRODUCT_DATA_SCRIPT, false);
  } catch { /* 页面未就绪时全部走兜底 */ }
  let name = data?.info?.title || '';
  if (!name) name = tabTitle(tab);

  // 先抓当前 HTML 快照（改写离线完成，不依赖页面存活）
  let html = '';
  try {
    html = await view.executeJavaScript('document.documentElement.outerHTML', false);
  } catch { /* 无法获取 */ }

  const host = (hostOf(tab.url) || 'page').replace(/^www\./, '').replace(/[^\w.-]/g, '') || 'page';
  const baseName = `${new Date().toISOString().slice(0, 10)}_${host}_${Date.now()}`;
  const item = {
    id: Date.now(),
    title: name,
    url: tab.url,
    addedAt: Date.now(),
    file: '',
    images: 0,
    status: 'archiving',
    info: {
      price: data?.info?.price || '',
      params: data?.info?.params || [],
      skus: data?.info?.skus || [],
      images: data?.images || {}
    }
  };
  items.unshift(item);
  writeSelection(items);
  renderSelection();
  updateBookmarkState();
  toast('已收藏，后台建档中…');

  // 异步建档：下载/改写/落盘完成后回填条目
  (async () => {
    try {
      const stillExists = () => readSelection().some((i) => i.id === item.id);
      const cats = item.info.images;
      const total = Object.values(cats).reduce((s, a) => s + a.length, 0);
      let map = {};
      if (total) {
        const result = await window.workManager.archiveImages({ baseName, referer: tab.url, categorized: cats });
        if (result?.ok && result.map) map = result.map;
      }
      if (!stillExists()) {
        await window.workManager.deleteArchive(baseName + '.html');
        return;
      }
      // 离线改写：原始 URL 与 HTML 转义形式（& → &amp;）都替换
      for (const [url, rel] of Object.entries(map)) {
        html = html.split(url).join(rel);
        const esc = url.replace(/&/g, '&amp;');
        if (esc !== url) html = html.split(esc).join(rel);
      }
      const catPaths = {};
      for (const cat of Object.keys(cats)) {
        catPaths[cat] = cats[cat].map((u) => map[u]).filter(Boolean);
      }
      const result = await window.workManager.archivePage({
        baseName,
        html,
        url: tab.url,
        title: name,
        meta: {
          price: item.info.price,
          params: item.info.params,
          skus: item.info.skus,
          images: catPaths,
          imageCount: Object.keys(map).length
        }
      });
      if (!stillExists()) {
        await window.workManager.deleteArchive(baseName + '.html');
        return;
      }
      if (result?.ok) {
        updateItem(item.id, { file: result.file, images: Object.keys(map).length, status: 'done' });
        toast(`建档完成：${name}（图 ${Object.keys(map).length}）`);
      } else {
        updateItem(item.id, { status: 'failed' });
        toast(`建档失败：${name}`);
      }
    } catch {
      updateItem(item.id, { status: 'failed' });
    }
  })();
}

function updateItem(id, patch) {
  writeSelection(readSelection().map((i) => (i.id === id ? { ...i, ...patch } : i)));
  renderSelection();
}

function syncAddress() {
  const input = $('#b-address');
  if (document.activeElement === input) return;
  const tab = activeTab();
  input.value = tab ? tab.url : '';
  // https 页面显示锁形图标（ZCode 地址栏同款）
  $('#address-lock').classList.toggle('hidden', !tab || !tab.url || !/^https:/i.test(tab.url));
}

function renderError(tab) {
  const overlay = $('#browser-loading');
  overlay.innerHTML =
    `<div style="display:flex;flex-direction:column;align-items:center;max-width:320px">` +
    `<h3 style="font-weight:500">${tab.errorTitle || '无法打开该页面'}</h3>` +
    `<p style="margin-top:8px;color:var(--foreground-subtle)">${tab.error}</p>` +
    `<button class="mini-btn" id="err-retry" style="margin-top:16px">${tab.guestGone ? '重试浏览器' : '重新加载'}</button></div>`;
  overlay.classList.remove('hidden');
  $('#err-retry').addEventListener('click', () => reloadActive());
}

/* ---------- 导航 ---------- */

function navigateActive(raw) {
  const tab = activeTab();
  if (!tab) return;
  const url = resolveUrl(raw);
  if (!url) {
    toast('仅支持 http、https、file、about、data 地址');
    return;
  }
  const view = $('#view-' + tab.id);
  tab.error = null;
  view.loadURL(url).catch((err) => {
    tab.error = `页面加载失败：${err.message || err}`;
    renderViews();
    renderError(tab);
  });
}

function reloadActive() {
  const tab = activeTab();
  if (!tab || !tab.url) return;
  tab.error = null;
  renderViews();
  $('#view-' + tab.id).reload();
}

function goBack() {
  const tab = activeTab();
  if (tab?.canGoBack) $('#view-' + tab.id).goBack();
}

function goForward() {
  const tab = activeTab();
  if (tab?.canGoForward) $('#view-' + tab.id).goForward();
}

/* ---------- 菜单 ---------- */

function closeMenus(except) {
  for (const id of ['add-menu', 'more-menu', 'tab-overview', 'zoom-menu', 'settings-menu']) {
    if (id !== except) $('#' + id).classList.add('hidden');
  }
  for (const el of document.querySelectorAll('.ctx-menu')) el.remove();
}

function placeMenu(menu, x, y) {
  menu.classList.remove('hidden');
  const rect = menu.getBoundingClientRect();
  menu.style.left = Math.min(x, window.innerWidth - rect.width - 8) + 'px';
  menu.style.top = Math.min(y, window.innerHeight - rect.height - 8) + 'px';
}

function openTabContextMenu(e, tab) {
  closeMenus(null);
  const menu = document.createElement('div');
  menu.className = 'menu ctx-menu';
  menu.style.width = '10rem';
  const items = [
    ['关闭标签', () => closeTab(tab.id)],
    ['关闭其他标签', () => { for (const t of [...state.tabs]) if (t.id !== tab.id) closeTab(t.id); }],
    ['关闭所有标签', () => { for (const t of [...state.tabs]) closeTab(t.id); }]
  ];
  for (const [label, fn] of items) {
    const btn = document.createElement('button');
    btn.className = 'menu-item';
    btn.textContent = label;
    btn.addEventListener('click', () => { menu.remove(); fn(); });
    menu.appendChild(btn);
  }
  document.body.appendChild(menu);
  placeMenu(menu, e.clientX, e.clientY);
}

function openOverview() {
  const pop = $('#tab-overview');
  if (!pop.classList.contains('hidden')) {
    pop.classList.add('hidden');
    return;
  }
  closeMenus('tab-overview');
  pop.textContent = '';

  // ZCode sidePane.searchTabs：总览带搜索框
  const search = document.createElement('input');
  search.className = 'ov-search';
  search.placeholder = '搜索标签页...';
  search.spellcheck = false;

  const listWrap = document.createElement('div');
  const renderList = (query = '') => {
    listWrap.textContent = '';
    const q = query.trim().toLowerCase();
    const match = (t) => !q || tabTitle(t).toLowerCase().includes(q) || (t.url || '').toLowerCase().includes(q);
    const openTabs = state.tabs.filter(match);
    const closedTabs = state.closed.filter((t) => match(t));

    const openTitle = document.createElement('div');
    openTitle.className = 'ov-section-title';
    openTitle.textContent = '打开的标签页';
    listWrap.appendChild(openTitle);

    if (!openTabs.length && !closedTabs.length) {
      const empty = document.createElement('div');
      empty.className = 'ov-empty';
      empty.textContent = '没有找到标签页。';
      listWrap.appendChild(empty);
      return;
    }
    if (!openTabs.length) {
      const empty = document.createElement('div');
      empty.className = 'ov-empty';
      empty.textContent = '没有找到标签页。';
      listWrap.appendChild(empty);
    }
    for (const tab of openTabs) {
      const item = document.createElement('button');
      item.className = 'ov-item';
      item.innerHTML = `<span class="ov-title">${tabTitle(tab)}</span><span class="ov-time">${relTime(tab.openedAt)}打开</span>`;
      item.addEventListener('click', () => { activateTab(tab.id); pop.classList.add('hidden'); });
      listWrap.appendChild(item);
    }

    if (closedTabs.length) {
      const closedTitle = document.createElement('div');
      closedTitle.className = 'ov-section-title';
      closedTitle.textContent = '最近关闭的标签页';
      listWrap.appendChild(closedTitle);
      for (const c of closedTabs.slice(0, 8)) {
        const item = document.createElement('button');
        item.className = 'ov-item';
        item.innerHTML = `<span class="ov-title">${c.title}</span><span class="ov-time">${relTime(c.closedAt)}关闭</span>`;
        item.addEventListener('click', () => {
          createTab(c.url);
          state.closed = state.closed.filter((x) => x !== c);
          pop.classList.add('hidden');
        });
        listWrap.appendChild(item);
      }
    }
  };

  search.addEventListener('input', () => renderList(search.value));
  pop.append(search, listWrap);
  renderList('');
  pop.classList.remove('hidden');
}

/* ---------- 元素选择器 ---------- */

const PICKER_SCRIPT = `
  new Promise((resolve) => {
    if (window.__zcPickActive) { resolve(null); return; }
    window.__zcPickActive = true;
    const outline = document.createElement('div');
    outline.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #0284c7;background:rgba(2,132,199,.08);border-radius:2px;display:none';
    document.documentElement.appendChild(outline);
    function cleanup() {
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
      outline.remove();
      document.documentElement.style.cursor = '';
      delete window.__zcPickActive;
      delete window.__zcPickCancel;
    }
    function desc(el) {
      return {
        tag: el.tagName.toLowerCase(),
        id: el.id || '',
        classes: Array.from(el.classList || []).slice(0, 3).join('.'),
        text: (el.textContent || '').trim().slice(0, 40)
      };
    }
    function onMove(e) {
      const r = e.target.getBoundingClientRect();
      outline.style.display = 'block';
      outline.style.top = r.top + 'px';
      outline.style.left = r.left + 'px';
      outline.style.width = r.width + 'px';
      outline.style.height = r.height + 'px';
    }
    function onClick(e) {
      e.preventDefault(); e.stopPropagation();
      const target = e.target;
      cleanup();
      resolve(desc(target));
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); cleanup(); resolve(null); }
    }
    window.__zcPickCancel = () => { cleanup(); resolve(null); };
    document.documentElement.style.cursor = 'crosshair';
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
  })`;

async function togglePicker() {
  const tab = activeTab();
  if (!tab || !tab.url) return;
  const view = $('#view-' + tab.id);
  if (state.picking) {
    try { await view.executeJavaScript('window.__zcPickCancel && __zcPickCancel()', false); } catch { /* 页面已跳转 */ }
    setPicking(false);
    return;
  }
  setPicking(true);
  try {
    const picked = await view.executeJavaScript(PICKER_SCRIPT, false);
    if (picked) {
      const sel = picked.tag + (picked.id ? '#' + picked.id : '') + (picked.classes ? '.' + picked.classes : '');
      toast(`已选择元素：<${sel}>` + (picked.text ? `「${picked.text}」` : ''));
    }
  } catch {
    toast('网页元素选择失败');
  }
  setPicking(false);
}

function setPicking(on) {
  state.picking = on;
  $('#b-picker').classList.toggle('pressed', on);
  $('#b-picker').title = on ? '取消网页元素选择' : '选择网页元素';
}

/* ---------- 自由尺寸 ---------- */

const VIEWPORT_KEY = 'browser.viewport';
const INSECURE_KEY = 'browser.allowInsecureCerts';
const SESSION_KEY = 'browser.session';
// 视口尺寸范围（browser.responsive.dimensionRangeError）
const VP_RANGE = { width: { min: 200, max: 4096 }, height: { min: 200, max: 4320 } };

// ZCode 会话恢复：把打开的标签（URL+标题）持久化，重启后还原
let sessionSaveTimer = null;

function saveSession() {
  clearTimeout(sessionSaveTimer);
  sessionSaveTimer = setTimeout(() => {
    const tabs = state.tabs.filter((t) => t.url).slice(0, 20)
      .map((t) => ({ url: t.url, title: t.title }));
    const active = Math.max(0, state.tabs.findIndex((t) => t.id === state.activeTabId));
    try { localStorage.setItem(SESSION_KEY, JSON.stringify({ tabs, active })); } catch { /* 存储满 */ }
  }, 400);
}

function readSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY));
    return saved && Array.isArray(saved.tabs) ? saved : null;
  } catch {
    return null;
  }
}

function loadViewport() {
  try {
    const saved = JSON.parse(localStorage.getItem(VIEWPORT_KEY));
    if (saved && Number.isInteger(saved.width) && Number.isInteger(saved.height)) {
      $('#resp-width').value = saved.width;
      $('#resp-height').value = saved.height;
    }
  } catch { /* 忽略损坏数据 */ }
}

function saveViewport() {
  const w = parseInt($('#resp-width').value, 10);
  const h = parseInt($('#resp-height').value, 10);
  localStorage.setItem(VIEWPORT_KEY, JSON.stringify({
    width: Number.isInteger(w) ? w : 375,
    height: Number.isInteger(h) ? h : 667
  }));
}

function inRange(dimension, value) {
  const r = VP_RANGE[dimension];
  return Number.isInteger(value) && value >= r.min && value <= r.max;
}

// 读取并校验视口输入；无效时标红并提示（browser.responsive.dimensionRangeError）
function readViewportInput() {
  const dims = [
    ['width', $('#resp-width')],
    ['height', $('#resp-height')]
  ];
  let ok = true, parsed = {};
  for (const [dim, input] of dims) {
    const value = Number(input.value.trim());
    if (!inRange(dim, value)) {
      input.classList.add('invalid');
      const r = VP_RANGE[dim];
      toast(`请输入 ${r.min} 到 ${r.max} 之间的整数`);
      ok = false;
    } else {
      input.classList.remove('invalid');
      parsed[dim] = value;
    }
  }
  return ok ? parsed : null;
}

function applyPreviewZoom(view, viewportWidth) {
  let z = state.responsiveZoom;
  if (z === 'fit') z = Math.min(1, $('#views').clientWidth / viewportWidth);
  try { view.setZoomFactor(z); } catch { /* guest 未就绪 */ }
}

// ZCode browser.responsive.resizeWidth/resizeHeight：视口边缘可拖拽改尺寸
function attachViewportHandles(stage) {
  for (const dir of ['x', 'y']) {
    if (stage.querySelector('.vp-handle-' + dir)) continue;
    const handle = document.createElement('div');
    handle.className = 'vp-handle vp-handle-' + dir;
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      const startW = stage.offsetWidth;
      const startH = stage.offsetHeight;
      const sx = e.clientX;
      const sy = e.clientY;
      const onMove = (ev) => {
        if (dir === 'x') {
          const w = startW + (ev.clientX - sx);
          if (inRange('width', w)) {
            stage.style.width = w + 'px';
            $('#resp-width').value = w;
          }
        } else {
          const h = startH + (ev.clientY - sy);
          if (inRange('height', h)) {
            stage.style.height = h + 'px';
            $('#resp-height').value = h;
          }
        }
      };
      const onUp = () => {
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        saveViewport();
        applyPreviewZoom(stage.querySelector('webview'), stage.offsetWidth);
      };
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
    });
    stage.appendChild(handle);
  }
}

function applyResponsive() {
  if (state.responsive) saveViewport();
  const dims = readViewportInput() || { width: 375, height: 667 };
  for (const tab of state.tabs) {
    const wrap = $('#wrap-' + tab.id);
    if (!wrap) continue;
    const stage = wrap.querySelector('.vp-stage');
    const view = stage.querySelector('webview');
    if (state.responsive && tab.id === state.activeTabId) {
      wrap.classList.add('responsive');
      stage.style.width = dims.width + 'px';
      stage.style.height = dims.height + 'px';
      attachViewportHandles(stage);
      applyPreviewZoom(view, dims.width);
    } else {
      wrap.classList.remove('responsive');
      stage.style.width = '';
      stage.style.height = '';
      try { view.setZoomFactor(1); } catch { /* guest 未就绪 */ }
    }
  }
}

function toggleResponsive(force) {
  state.responsive = force !== undefined ? force : !state.responsive;
  $('#b-responsive').classList.toggle('pressed', state.responsive);
  $('#responsive-bar').classList.toggle('hidden', !state.responsive);
  applyResponsive();
}

/* ---------- 面板开关与宽度 ---------- */

function setPaneOpen(open) {
  state.paneOpen = open;
  $('#browser-pane').hidden = !open;
  $('#btn-toggle-browser').setAttribute('aria-pressed', String(open));
  $('#sb-browser').classList.toggle('active', open);
  if (open) {
    if (!state.tabs.length) {
      // 会话恢复：还原上次打开的标签
      const saved = readSession();
      if (saved && saved.tabs.length) {
        for (const t of saved.tabs.slice(0, 20)) {
          const tab = createTab(t.url);
          tab.title = t.title || '';
        }
        const activeIdx = Math.min(saved.active || 0, state.tabs.length - 1);
        activateTab(state.tabs[activeIdx].id);
      } else {
        createTab('');
      }
    }
    renderViews();
    syncToolbar();
  }
}

function initPaneResize() {
  const handle = $('#pane-resize-handle');
  const pane = $('#browser-pane');
  let startX = 0, startW = 0, dragging = false;

  handle.addEventListener('pointerdown', (e) => {
    dragging = true;
    startX = e.clientX;
    startW = pane.getBoundingClientRect().width;
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const w = Math.min(900, Math.max(320, startW + (startX - e.clientX)));
    pane.style.width = w + 'px';
  });
  handle.addEventListener('pointerup', () => { dragging = false; });
  handle.addEventListener('dblclick', () => {
    const wide = pane.getBoundingClientRect().width > 600;
    pane.style.width = wide ? '' : Math.round(window.innerWidth * 0.6) + 'px';
  });
}

/* ---------- 事件绑定 ---------- */

function bindEvents() {
  $('#btn-toggle-sidebar').addEventListener('click', () => setSidebarOpen(!state.sidebarOpen));
  $('#btn-start-selection').addEventListener('click', startSelection);
  $('#sel-rail').addEventListener('click', () => setSelectionCollapsed(false));
  $('#sel-collapse').addEventListener('click', () => setSelectionCollapsed(true));
  $('#sel-exit').addEventListener('click', exitSelection);
  $('#sel-clear').addEventListener('click', async () => {
    for (const item of readSelection()) {
      if (item.file) await window.workManager.deleteArchive(item.file);
    }
    writeSelection([]);
    renderSelection();
  });
  $('#btn-toggle-browser').addEventListener('click', () => setPaneOpen(!state.paneOpen));
  $('#sb-browser').addEventListener('click', () => setPaneOpen(!state.paneOpen));
  $('#sb-workbench').addEventListener('click', () => setPaneOpen(false));

  $('#b-back').addEventListener('click', goBack);
  $('#b-forward').addEventListener('click', goForward);
  $('#b-reload').addEventListener('click', reloadActive);

  const address = $('#b-address');
  address.addEventListener('focus', () => address.select());
  address.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      navigateActive(address.value);
      address.blur();
    }
  });

  $('#b-more').addEventListener('click', () => {
    const menu = $('#more-menu');
    const hidden = menu.classList.contains('hidden');
    closeMenus(hidden ? 'more-menu' : null);
    menu.classList.toggle('hidden', !hidden);
  });

  $('#more-open-external').addEventListener('click', () => {
    closeMenus(null);
    const tab = activeTab();
    if (tab?.url && /^https?:/i.test(tab.url)) {
      window.workManager.openExternal(tab.url);
    }
  });

  $('#more-devtools').addEventListener('click', () => {
    closeMenus(null);
    const tab = activeTab();
    if (tab?.url) $('#view-' + tab.id).openDevTools();
  });

  $('#btn-add-tab').addEventListener('click', () => {
    const menu = $('#add-menu');
    const hidden = menu.classList.contains('hidden');
    closeMenus(hidden ? 'add-menu' : null);
    menu.classList.toggle('hidden', !hidden);
  });

  $('#add-browser-tab').addEventListener('click', () => {
    closeMenus(null);
    createTab('');
    $('#b-address').focus();
  });

  $('#btn-overview').addEventListener('click', openOverview);

  $('#b-bookmark').addEventListener('click', bookmarkCurrentPage);
  $('#b-responsive').addEventListener('click', () => toggleResponsive());
  // 预览缩放档位（browser.responsive.zoom）：适应窗口 / 百分比
  $('#resp-zoom').addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = $('#zoom-menu');
    const hidden = menu.classList.contains('hidden');
    closeMenus(hidden ? 'zoom-menu' : null);
    if (!hidden) return;
    // zoom 菜单在 .side-pane（relative）内，需换算成面板内坐标
    const btn = e.currentTarget.getBoundingClientRect();
    const pane = document.querySelector('.side-pane').getBoundingClientRect();
    placeMenu(menu, btn.left - pane.left, btn.bottom - pane.top + 4);
  });
  for (const item of document.querySelectorAll('.zoom-item')) {
    item.addEventListener('click', () => {
      state.responsiveZoom = item.dataset.zoom === 'fit' ? 'fit' : Number(item.dataset.zoom);
      $('#resp-zoom').textContent = state.responsiveZoom === 'fit' ? '适应窗口' : `${Math.round(state.responsiveZoom * 100)}%`;
      for (const it of document.querySelectorAll('.zoom-item')) {
        it.querySelector('.check').textContent = it === item ? '✓' : '';
      }
      $('#zoom-menu').classList.add('hidden');
      applyResponsive();
    });
  }
  $('#resp-exit').addEventListener('click', () => toggleResponsive(false));
  for (const id of ['resp-width', 'resp-height']) {
    $('#' + id).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') applyResponsive();
    });
    $('#' + id).addEventListener('input', () => $('#' + id).classList.remove('invalid'));
  }

  // 设置菜单（settings.browser.*）：忽略证书校验 / 清除缓存 / 清除全部数据
  $('#sb-gear').addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = $('#settings-menu');
    const hidden = menu.classList.contains('hidden');
    closeMenus(hidden ? 'settings-menu' : null);
    if (!hidden) return;
    $('#insecure-check').textContent = localStorage.getItem(INSECURE_KEY) === '1' ? '✓' : '';
    const rect = e.currentTarget.getBoundingClientRect();
    menu.classList.remove('hidden');
    const menuHeight = menu.getBoundingClientRect().height;
    menu.style.left = Math.max(8, rect.left - 110) + 'px';
    menu.style.top = Math.max(8, rect.top - menuHeight - 10) + 'px';
  });

  $('#set-insecure').addEventListener('click', () => {
    const on = localStorage.getItem(INSECURE_KEY) !== '1';
    localStorage.setItem(INSECURE_KEY, on ? '1' : '0');
    window.workManager.setInsecure(on);
    closeMenus(null);
    toast(on ? '已开启忽略证书校验' : '已关闭忽略证书校验');
  });

  $('#set-clear-cache').addEventListener('click', async () => {
    closeMenus(null);
    await window.workManager.clearData('cache');
    toast('内置浏览器缓存已清除');
  });

  $('#set-clear-all').addEventListener('click', async () => {
    closeMenus(null);
    if (!(await window.workManager.confirmClearAll())) return;
    await window.workManager.clearData('all');
    toast('内置浏览器数据已全部清除');
  });

  $('#b-picker').addEventListener('click', togglePicker);

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.menu') && !e.target.closest('#btn-add-tab') &&
        !e.target.closest('#b-more') && !e.target.closest('#btn-overview')) {
      closeMenus(null);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (state.picking) { togglePicker(); return; }
      closeMenus(null);
      return;
    }
    // ZCode 桌面缩放：Ctrl+= 放大 / Ctrl+- 缩小 / Ctrl+0 复位
    if (e.ctrlKey && !e.shiftKey && !e.altKey && ['=', '+', '-', '0'].includes(e.key)) {
      e.preventDefault();
      window.workManager.zoomStep(e.key === '0' ? 0 : (e.key === '-' ? -0.5 : 0.5));
      return;
    }
    if (!e.ctrlKey || e.shiftKey || e.altKey) return;
    // ZCode quickPick toggleSidebar：Ctrl+B 切换左侧栏
    if (e.key === 'b' || e.key === 'B') { e.preventDefault(); setSidebarOpen(!state.sidebarOpen); return; }
    if (e.key === '1') { e.preventDefault(); setPaneOpen(false); }
    if (e.key === '2') { e.preventDefault(); setPaneOpen(!state.paneOpen); }
    if (!state.paneOpen) return;
    if (e.key === 't' || e.key === 'T') { e.preventDefault(); createTab(''); $('#b-address').focus(); }
    if (e.key === 'w' || e.key === 'W') { e.preventDefault(); if (activeTab()) closeTab(state.activeTabId); }
  });

  // 轮询历史状态（webview 无对应事件）
  setInterval(() => {
    const tab = activeTab();
    if (!tab || !tab.url) return;
    const view = $('#view-' + tab.id);
    if (!view) return;
    try {
      const back = view.canGoBack();
      const fwd = view.canGoForward();
      if (back !== tab.canGoBack || fwd !== tab.canGoForward) {
        tab.canGoBack = back;
        tab.canGoForward = fwd;
        syncToolbar();
      }
    } catch { /* guest 未就绪 */ }
  }, 500);
}

/* ---------- 选品模式：清单(1) + 浏览器(2) ---------- */

const SELECTION_KEY = 'selection.items';
const SELECTION_HOME = 'https://www.taobao.com';
let selectionPriorPane = false;

function readSelection() {
  try {
    const items = JSON.parse(localStorage.getItem(SELECTION_KEY));
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function writeSelection(items) {
  try { localStorage.setItem(SELECTION_KEY, JSON.stringify(items.slice(0, 50))); } catch { /* 存储满 */ }
}

function renderSelection() {
  const items = readSelection();
  $('#sel-count').textContent = items.length;
  $('#sel-rail-count').textContent = items.length;
  $('#sel-rail-count').style.display = items.length ? '' : 'none';
  const list = $('#sel-list');
  list.textContent = '';

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'sel-empty';
    empty.innerHTML = '清单还是空的<br />在右侧浏览器打开候选商品页，点「加入当前页面」收进来';
    list.appendChild(empty);
    return;
  }

  items.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'sel-item';

    const idx = document.createElement('span');
    idx.className = 'sel-idx';
    idx.textContent = index + 1;

    const info = document.createElement('div');
    info.className = 'sel-info';
    const title = document.createElement('div');
    title.className = 'sel-item-title';
    title.textContent = item.title || hostOf(item.url);
    title.title = item.title || item.url;
    const url = document.createElement('div');
    url.className = 'sel-item-url';
    url.textContent = item.url;
    info.append(title, url);

    const remove = document.createElement('button');
    remove.className = 'sel-remove';
    remove.title = '移除';
    remove.innerHTML = '<svg class="ic" viewBox="0 0 24 24"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
    remove.addEventListener('click', async () => {
      if (item.file) await window.workManager.deleteArchive(item.file);
      writeSelection(readSelection().filter((i) => i.id !== item.id));
      renderSelection();
    });

    let chip = null;
    if (item.status === 'archiving') {
      chip = document.createElement('span');
      chip.className = 'chip';
      chip.style.cssText = 'background:#E3E1F4;color:#5243C7;flex-shrink:0';
      chip.textContent = '建档中…';
    } else if (item.status === 'failed') {
      chip = document.createElement('span');
      chip.className = 'chip';
      chip.style.cssText = 'background:#F6DAE4;color:#AE3D64;flex-shrink:0';
      chip.textContent = '建档失败';
    } else if (item.file) {
      chip = document.createElement('span');
      chip.className = 'chip';
      chip.style.cssText = 'background:#DBE7C5;color:#536534;flex-shrink:0';
      chip.textContent = item.images ? `已建档 · ${item.images}图` : '已建档';
      chip.title = item.file;
    }
    if (chip) {
      row.append(idx, info, chip, remove);
    } else {
      row.append(idx, info, remove);
    }
    list.appendChild(row);
  });
}

// 进入选品直接展开清单；需要腾地方时可用「收起」折成左侧竖条
function setSelectionCollapsed(collapsed) {
  $('#selection-panel').classList.toggle('collapsed', collapsed);
}

// 淘宝系域名（taobao.com 及 tmall.com 全部子域，如 detail.tmall.com）
function isTaobaoUrl(url) {
  try {
    return /(^|\.)(taobao|tmall)\.com$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

function startSelection() {
  selectionPriorPane = state.paneOpen;
  $('#workbench').classList.add('selecting');
  $('#browser-pane').classList.add('selecting');
  setSelectionCollapsed(false);
  setPaneOpen(true);
  // 已有淘宝标签就直接复用，不再重复开新标签
  const existing = state.tabs.find((t) => isTaobaoUrl(t.url));
  if (existing) {
    activateTab(existing.id);
  } else {
    createTab(SELECTION_HOME);
    for (const t of [...state.tabs]) {
      if (!t.url) closeTab(t.id);
    }
  }
  renderSelection();
}

function exitSelection() {
  $('#workbench').classList.remove('selecting');
  $('#browser-pane').classList.remove('selecting');
  if (!selectionPriorPane) setPaneOpen(false);
}

/* ---------- 启动 ---------- */

document.addEventListener('DOMContentLoaded', () => {
  // 平台类名：Windows 下为顶栏让出原生窗口按钮区域
  document.body.classList.add('platform-' + (window.workManager.platform || 'unknown'));
  bindEvents();
  initPaneResize();
  initSidebarResize();
  setSidebarOpen(localStorage.getItem('sidebar.collapsed') !== '1');
  loadViewport();
  window.workManager.setInsecure?.(localStorage.getItem(INSECURE_KEY) === '1');
  setPaneOpen(false);

  // guest 页面的新窗口请求 → 在浏览器面板内开新标签（ZCode 行为）
  window.workManager.onNewTab?.(({ url }) => {
    setPaneOpen(true);
    createTab(url);
  });
});

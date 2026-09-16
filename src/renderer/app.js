/* ZCode 风格的工作管理应用：左侧栏 + 工作台 + 浏览器侧面板（多标签） */

const $ = (sel) => document.querySelector(sel);

const state = {
  tabs: [],           // { id, url, title, favicon, openedAt, isLoading, canGoBack, canGoForward, error }
  closed: [],         // { title, url, closedAt }
  activeTabId: null,
  paneOpen: false,
  responsive: false,
  responsiveZoom: 'fit',
  picking: false,
  nextTabId: 1
};

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
  const view = document.createElement('webview');
  view.id = 'view-' + tab.id;
  // ZCode 同款持久化会话分区：Cookie/登录态在重启后保留，代理跟随系统
  view.setAttribute('partition', 'persist:embedded-browser');
  view.src = tab.url || 'about:blank';
  view.setAttribute('allowpopups', '');
  wrap.appendChild(view);
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
    strip.appendChild(el);
  }
  const active = strip.querySelector('.browser-tab.active');
  if (active) active.scrollIntoView({ inline: 'nearest' });
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
}

function syncAddress() {
  const input = $('#b-address');
  if (document.activeElement === input) return;
  const tab = activeTab();
  input.value = tab ? tab.url : '';
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
// 视口尺寸范围（browser.responsive.dimensionRangeError）
const VP_RANGE = { width: { min: 200, max: 4096 }, height: { min: 200, max: 4320 } };

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

function applyResponsive() {
  if (state.responsive) saveViewport();
  const dims = readViewportInput() || { width: 375, height: 667 };
  for (const tab of state.tabs) {
    const wrap = $('#wrap-' + tab.id);
    if (!wrap) continue;
    const view = wrap.querySelector('webview');
    if (state.responsive && tab.id === state.activeTabId) {
      wrap.classList.add('responsive');
      view.style.flex = 'none';
      view.style.width = dims.width + 'px';
      view.style.height = dims.height + 'px';
      applyPreviewZoom(view, dims.width);
    } else {
      wrap.classList.remove('responsive');
      view.style.flex = '';
      view.style.width = '';
      view.style.height = '';
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
    if (!state.tabs.length) createTab('');
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

/* ---------- 启动 ---------- */

document.addEventListener('DOMContentLoaded', () => {
  // 平台类名：Windows 下为顶栏让出原生窗口按钮区域
  document.body.classList.add('platform-' + (window.workManager.platform || 'unknown'));
  bindEvents();
  initPaneResize();
  loadViewport();
  window.workManager.setInsecure?.(localStorage.getItem(INSECURE_KEY) === '1');
  setPaneOpen(false);

  // guest 页面的新窗口请求 → 在浏览器面板内开新标签（ZCode 行为）
  window.workManager.onNewTab?.(({ url }) => {
    setPaneOpen(true);
    createTab(url);
  });
});

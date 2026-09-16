/* 面板注册表：新增面板只需在这里加一项并提供 render 函数 */
const PANELS = [
  { id: 'workbench', name: '工作台', icon: '🏠', hotkey: 'Ctrl+1', render: renderWorkbench },
  { id: 'browser', name: '浏览器', icon: '🌐', hotkey: 'Ctrl+2', render: renderBrowser }
];

const HOME_URL = 'https://www.bing.com';

document.addEventListener('DOMContentLoaded', init);

function init() {
  const nav = document.getElementById('nav');
  const panelsEl = document.getElementById('panels');

  for (const panel of PANELS) {
    const section = document.createElement('section');
    section.className = 'panel';
    section.id = `panel-${panel.id}`;
    panelsEl.appendChild(section);
    panel.render(section);

    const button = document.createElement('button');
    button.className = 'nav-item';
    button.id = `nav-${panel.id}`;
    button.innerHTML =
      `<span class="nav-icon">${panel.icon}</span>` +
      `<span>${panel.name}</span>` +
      (panel.hotkey ? `<span class="nav-hotkey">${panel.hotkey}</span>` : '');
    button.addEventListener('click', () => activatePanel(panel.id));
    nav.appendChild(button);
  }

  document.addEventListener('keydown', (event) => {
    if (!event.ctrlKey || event.shiftKey || event.altKey) return;
    const index = Number(event.key) - 1;
    if (index >= 0 && index < PANELS.length) {
      event.preventDefault();
      activatePanel(PANELS[index].id);
    }
  });

  showVersions();
  activatePanel(PANELS[0].id);
}

function activatePanel(id) {
  for (const panel of PANELS) {
    document.getElementById(`panel-${panel.id}`).classList.toggle('active', panel.id === id);
    document.getElementById(`nav-${panel.id}`).classList.toggle('active', panel.id === id);
  }
}

function showVersions() {
  const versions = window.workManager?.versions;
  if (!versions) return;
  document.getElementById('sidebar-footer').textContent =
    `Electron ${versions.electron}\nNode ${versions.node}\nChromium ${versions.chrome}`;
}

/* ---------- 工作台 ---------- */

function renderWorkbench(el) {
  el.innerHTML = `
    <div class="workbench">
      <h1>工作台</h1>
      <div class="clock" id="clock">--:--:--</div>
      <div class="date" id="date"></div>
      <div class="hint">
        侧边栏可切换面板，浏览器面板已就绪 🌐<br />
        任务管理等功能将在这里逐步加入
      </div>
    </div>`;

  const clock = el.querySelector('#clock');
  const date = el.querySelector('#date');

  function tick() {
    const now = new Date();
    clock.textContent = now.toLocaleTimeString('zh-CN', { hour12: false });
    date.textContent = now.toLocaleDateString('zh-CN', {
      year: 'numeric', month: 'long', day: 'numeric', weekday: 'long'
    });
  }

  tick();
  setInterval(tick, 1000);
}

/* ---------- 浏览器 ---------- */

function renderBrowser(el) {
  el.innerHTML = `
    <div class="browser-toolbar">
      <button id="btn-back" title="后退">←</button>
      <button id="btn-forward" title="前进">→</button>
      <button id="btn-reload" title="刷新">⟳</button>
      <button id="btn-home" title="主页">⌂</button>
      <input id="url-input" type="text" spellcheck="false"
             placeholder="输入网址或搜索内容，回车访问" />
      <button id="btn-go" title="前往" class="btn-go">前往</button>
    </div>
    <div class="browser-body">
      <webview id="browser-view" src="${HOME_URL}" allowpopups></webview>
      <div class="browser-loading">加载中…</div>
    </div>`;

  const view = el.querySelector('#browser-view');
  const urlInput = el.querySelector('#url-input');

  function navigate(raw) {
    const input = raw.trim();
    if (!input) return;
    const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input);
    const looksLikeHost = /^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/i.test(input) && !input.includes(' ');
    const url = hasScheme
      ? input
      : looksLikeHost
        ? `https://${input}`
        : `https://www.bing.com/search?q=${encodeURIComponent(input)}`;
    view.loadURL(url);
  }

  urlInput.addEventListener('focus', () => urlInput.select());
  urlInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') navigate(urlInput.value);
  });
  el.querySelector('#btn-go').addEventListener('click', () => navigate(urlInput.value));
  el.querySelector('#btn-back').addEventListener('click', () => view.goBack());
  el.querySelector('#btn-forward').addEventListener('click', () => view.goForward());
  el.querySelector('#btn-reload').addEventListener('click', () => view.reload());
  el.querySelector('#btn-home').addEventListener('click', () => view.loadURL(HOME_URL));

  view.addEventListener('did-navigate', (event) => {
    urlInput.value = event.url;
  });
  view.addEventListener('did-navigate-in-page', (event) => {
    urlInput.value = event.url;
  });
  view.addEventListener('did-start-loading', () => el.classList.add('loading'));
  view.addEventListener('did-stop-loading', () => el.classList.remove('loading'));
}

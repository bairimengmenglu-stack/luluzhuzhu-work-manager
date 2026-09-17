// 对齐 ZCode embeddedBrowserJavaScriptDialog：
// 把 guest 页面的 alert/confirm 换成宿主应用的品牌化对话框（同步应答），prompt 保持原生
const { contextBridge, ipcRenderer } = require('electron');

const KEY = '__wmGuestDialog__';

contextBridge.exposeInMainWorld(KEY, {
  show(type, message) {
    try {
      const result = ipcRenderer.sendSync('guest-dialog', { type, message });
      if (result && result.handled === true) {
        return { handled: true, ...(typeof result.value === 'boolean' ? { value: result.value } : {}) };
      }
    } catch { /* 主进程不可用则回退原生 */ }
    return { handled: false };
  }
});

// exposeInMainWorld 的对象在页面主世界可见，executeInMainWorld 借它覆盖 window.alert/confirm
contextBridge.executeInMainWorld({
  func: (key) => {
    const bridge = window[key];
    if (!bridge) return;
    const nativeAlert = window.alert.bind(window);
    const nativeConfirm = window.confirm.bind(window);

    window.alert = (msg) => {
      const text = msg === undefined ? '' : String(msg);
      if (!bridge.show('alert', text).handled) nativeAlert(text);
    };
    window.confirm = (msg) => {
      const text = msg === undefined ? '' : String(msg);
      const result = bridge.show('confirm', text);
      return result.handled ? result.value === true : nativeConfirm(text);
    };
  },
  args: [KEY]
});

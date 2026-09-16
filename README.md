# luluzhuzhu Work Manager

luluzhuzhu 的工作管理应用。

基于 **Electron**（Chromium + Node.js）构建 —— 与 ZCode 桌面客户端相同的技术栈。

## 当前功能

- **面板切换**：左侧边栏在多个面板之间切换，支持 `Ctrl+1` / `Ctrl+2` 快捷键
  - 工作台：时钟与日期，后续任务管理功能的落点
  - 浏览器：内嵌浏览器面板
- **内嵌浏览器**：基于 Electron `<webview>`，支持地址栏导航（回车或「前往」按钮）、前进 / 后退 / 刷新 / 主页；输入非网址内容时自动用 Bing 搜索；新开窗口的链接交给系统默认浏览器打开

## 运行

```bash
npm install
npm start
```

## 项目结构

```
src/
├── main/       # 主进程：窗口创建、新窗口策略
│   └── main.js
├── preload/    # 预加载：contextBridge 暴露安全 API
│   └── preload.js
└── renderer/   # 渲染进程：面板切换 UI 与浏览器面板
    ├── index.html
    ├── styles.css
    └── app.js
```

## 如何新增面板

在 `src/renderer/app.js` 的 `PANELS` 数组中添加一项（`id`、`name`、`icon`、`render`），面板会自动出现在侧边栏并参与切换。

# Agent 分工

本仓库由两个 Agent 协作。不要越权改对方的文件，除非对方的契约已经挡路。

## 功能 Agent（当前）

负责：

- 架构与模块边界
- 浏览器扩展逻辑（`manifest.json`、content script 加载顺序）
- 数据层（`constants.js`、`storage.js`、`prompt-engine.js`）
- Grok 页面集成（`grok-editor.js`、`content.js`）
- 构建与测试（`package.json`、`tests/`、`TEST_CHECKLIST.md` 中的功能项）
- 控制器与 UI 行为契约（`ui.js` 的 CRUD、拖拽、对话框、焦点、插入）

默认只做能跑通的最低限度界面。不要把时间花在美术、动效润色或品牌图形上。

## UI Agent（OpenCode + GLM）

负责：

- `content.css`
- `icons/`
- `docs/images/`
- `ui.js` 里纯展示用的 SVG / class 名称（不要改事件、存储、插入路径）
- 视觉主题、动效、间距、图标

必须保持这些功能契约：

- 根节点 `#phg-root`，所有扩展 DOM 使用 `phg-` 前缀
- 面板 `data-phg-state` 只有 `closed` / `open`
- header / 可滚动 body / footer 三段结构
- 用户文本只用 `textContent` 或原生 value，禁止 `innerHTML`
- 关键控件可点区域至少 44 px
- 细指针悬停才显示卡片编辑/删除；触屏始终显示
- `@media (prefers-reduced-motion: reduce)` 取消过渡，但状态仍可理解
- 主题变量只定义在 `#phg-root`

## 不要改

UI Agent 不要改：

- `grok-editor.js` 选择器与插入算法
- `storage.js` / `prompt-engine.js` / `content.js` 生命周期
- `manifest.json` 的权限和 `https://grok.com/*` 匹配范围
- 测试里的功能断言

功能 Agent 不要重做视觉系统。需要新 class 时，先加语义 class，再交给 UI Agent 上色。

# 贡献指南 / Contributing Guide

欢迎优化桌宠！无论是修 bug、加功能、改进 UI，都可以通过 Pull Request 提交。

## 快速导航

| 你想做什么 | 去哪里 |
|-----------|--------|
| 改进 AI 回复质量 | [`src/ai.js`](src/ai.js) — prompt 构建、模型调用 |
| 添加新工具（命令执行等） | [`src/system-tools.js`](src/system-tools.js) |
| 优化微信桥接 | [`src/wechat-bridge.js`](src/wechat-bridge.js) — ilink API 协议 |
| 改进聊天 UI/样式 | [`chat/chat.css`](chat/chat.css)、[`chat/chat.html`](chat/chat.html) |
| 新增桌宠形象 | [`pet/themes/`](pet/themes/) + [`themes.js`](themes.js) |
| 消息渲染（Markdown/代码高亮） | [`chat/chat-messages.js`](chat/chat-messages.js) |
| 对话管理/存储 | [`src/store.js`](src/store.js) |
| 联网搜索 | [`src/search.js`](src/search.js) |
| 文件导入解析 | [`src/file-reader.js`](src/file-reader.js) |
| 自动更新 | [`src/updater.js`](src/updater.js) |

## 环境搭建

```bash
# 1. Fork + Clone
git clone https://github.com/<你的用户名>/desktop-pet-wechat.git
cd desktop-pet-wechat
git checkout windows   # 当前开发分支

# 2. 安装依赖（Node.js 18/20，不要用 v24）
npm install

# 3. 运行
npm start
```

## 项目架构

```
main.js (Electron 主进程)
  ├── 窗口管理 → src/windows.js
  ├── IPC 处理 → src/ipc-handlers.js
  ├── 微信桥接 → src/wechat-bridge.js
  ├── AI 引擎   → src/ai.js
  ├── 任务处理 → src/task-processor.js
  ├── 系统工具 → src/system-tools.js
  └── 数据持久 → src/store.js

preload.js (安全桥接层)
  └── 暴露 petAPI 给渲染进程

渲染进程
  ├── pet/   (桌宠窗口 — SVG 动画 + 气泡)
  └── chat/  (聊天窗口 — 对话界面 + 设置面板)
```

**关键原则：**
- 渲染进程**不直接访问** Node.js API，全部通过 `preload.js` → IPC → 主进程
- AI 调用、文件读写、命令执行都在主进程完成
- 微信消息通过 ilink API 长轮询（非 webhook），不需要公网 URL

## 代码风格

- **缩进**: 2 空格
- **引号**: 单引号（JS 字符串）、模板字符串（含变量时）
- **分号**: 有
- **命名**: camelCase（变量/函数）、PascalCase（类/构造函数）
- **注释**: 关键逻辑加中文注释，复杂函数加 JSDoc
- **模块**: CommonJS（`require` / `module.exports`），不使用 ES Module
- **中文**: UI 文案用中文，日志用英文，console.log 保留用于调试

参考现有代码风格即可，不需要 Prettier/ESLint。

## 测试

```bash
npm test   # 运行全部 85 个测试
```

| 测试文件 | 覆盖模块 |
|---------|---------|
| [`test/store.test.js`](test/store.test.js) | 数据 CRUD |
| [`test/ai.test.js`](test/ai.test.js) | AI 调用逻辑 |
| [`test/search.test.js`](test/search.test.js) | 搜索/天气 |
| [`test/file-reader.test.js`](test/file-reader.test.js) | 文件解析 |
| [`test/ipc-handlers.test.js`](test/ipc-handlers.test.js) | IPC 处理 |

新增功能**必须**添加对应测试，已有 85 个测试**必须**全部通过才能合并。

## Pull Request 流程

```
1. 从 windows 分支创建功能分支
   git checkout windows
   git pull origin windows
   git checkout -b feat/你的功能名

2. 开发 + 测试
   npm test   # 确保全绿

3. 提交（使用中文或英文都可以）
   git commit -m "feat: xxx功能描述"

4. 推送到自己的 Fork
   git push origin feat/你的功能名

5. 在 GitHub 上发起 Pull Request
   目标分支: windows (或 main)
```

### Commit 规范

建议使用 [Conventional Commits](https://www.conventionalcommits.org/)：

```
feat: 新功能
fix:  修复 bug
docs: 文档变更
refactor: 重构（不改变功能）
test: 测试相关
chore: 构建/工具链
```

示例：`feat: 添加语音消息支持` / `fix: 修复微信扫码后状态不更新`

### PR 标题示例

- `feat: 支持微信图片消息`
- `fix: 聊天窗口最小尺寸限制失效`
- `refactor: 提取公共的消息格式化函数`

## 用 Claude Code 提交贡献

如果你也在用 Claude Code，可以直接让它帮你完成从改代码到提 PR 的全流程。

### 准备工作

首先把 Claude Code 的授权和能力告诉它：

```
你现在在帮我优化一个开源桌宠项目 desktop-pet-wechat，
仓库在 https://github.com/yangr8640-eng/desktop-pet-wechat，
我先 Fork 并 Clone 到了本地。

请先阅读 CONTRIBUTING.md 了解项目规范和代码风格。
```

### 日常贡献的话术

直接把需求描述清楚就行，跟聊天一样：

```
帮我给桌宠的微信桥接加一个功能：当微信用户发图片时，
自动 OCR 识别文字内容，然后交给 AI 处理。

改动完成后跑 npm test 确保不破坏现有功能，
然后用 Conventional Commits 格式提交，
最后帮我提 PR 到 yangr8640-eng/desktop-pet-wechat 的 windows 分支。
```

### PR 话术

```
把当前分支的改动推到我 Fork 的仓库，
然后用 gh 命令给 yangr8640-eng/desktop-pet-wechat 的 windows 分支提一个 PR，
标题写 "feat: xxx"，描述写清楚改了什么。
```

Claude Code 会自动完成：读代码 → 改文件 → 跑测试 → commit → push → `gh pr create`。

## 常见贡献方向

- 🎨 **新桌宠形象** — 在 `pet/themes/` 下新建设计目录 + `themes.js` 注册
- 🔧 **新 AI 工具** — 在 `src/system-tools.js` 添加工具定义 + 处理器
- 🌐 **新搜索源** — 在 `src/search.js` 添加搜索 provider
- 🎛️ **设置面板优化** — 改 `chat/chat.html` + `chat/chat-settings.js`
- 📱 **微信集成增强** — 改 `src/wechat-bridge.js`（注意与 ilink API 协议兼容）
- 🐛 **Bug 修复** — 任何模块，先提 Issue 描述问题

## 行为准则

- 对新手友好 — PR 描述写清楚改了什么、为什么这样改
- Review 意见是讨论而非命令 — 保持友善
- MIT 协议 — 贡献代码即同意在此协议下发布

---

有问题先在 [Issues](https://github.com/yangr8640-eng/desktop-pet-wechat/issues) 讨论，避免做了大量工作后发现方向不对。

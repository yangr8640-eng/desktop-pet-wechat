# 贡献指南 / Contributing Guide

欢迎优化桌宠！无论是修 bug、加功能、改进 UI，都可以通过 Pull Request 提交。

## 快速导航

| 你想做什么 | 去哪里 |
|-----------|--------|
| 改进 AI 回复/聊天逻辑 | [`chat/chat.js`](chat/chat.js) — AI API 调用 + 消息渲染 |
| 优化 UI 样式 | [`chat/chat.css`](chat/chat.css) — 液态玻璃暗色主题 |
| 调整 UI 布局 | [`chat/chat.html`](chat/chat.html) — 聊天窗口 HTML |
| 新增桌宠形象 | [`pet/themes/`](pet/themes/) + [`themes.js`](themes.js) |
| 修改窗口行为 | [`main.js`](main.js) — Electron 主进程 |
| IPC 通信 | [`preload.js`](preload.js) — 安全桥接层 |
| 文档解析 | `main.js` 中的文件读取逻辑 |

## 环境搭建

```bash
# 1. Fork + Clone
git clone https://github.com/<你的用户名>/desktop-pet-wechat.git
cd desktop-pet-wechat
git checkout main   # macOS 主分支

# 2. 安装依赖（macOS, Node.js 18/20，不要用 v24）
npm install

# 3. 运行
npm start
```

## 项目架构

```
main.js (Electron 主进程)
  ├── 窗口管理 — 桌宠窗口 + 聊天窗口创建与显隐
  ├── AI API 调用 — DeepSeek/OpenAI/自定义模型
  ├── 文件解析 — TXT/PDF/DOCX/MD 导入
  ├── IPC 处理 — 渲染进程 ↔ 主进程通信
  └── 搜索 — Bing 搜索 + 天气查询

preload.js (安全桥接层)
  └── 暴露 petAPI 给渲染进程

渲染进程
  ├── pet/   (桌宠窗口 — SVG 动画 + 气泡交互)
  └── chat/  (聊天窗口 — 对话界面 + 设置)
```

**关键原则：**
- 渲染进程**不直接访问** Node.js API，全部通过 `preload.js` → IPC → 主进程
- AI 调用、文件读写都在主进程完成
- macOS 使用原生 vibrancy 毛玻璃效果（`NSPanel` + `visualEffectState`）

## 代码风格

- **缩进**: 2 空格
- **引号**: 单引号（JS 字符串）、模板字符串（含变量时）
- **分号**: 有
- **命名**: camelCase（变量/函数）、PascalCase（类/构造函数）
- **注释**: 关键逻辑加中文注释
- **模块**: CommonJS（`require` / `module.exports`），不使用 ES Module
- **中文**: UI 文案用中文，日志用英文，console.log 保留用于调试

参考现有代码风格即可，不需要 Prettier/ESLint。

## Pull Request 流程

```
1. 从 main 分支创建功能分支
   git checkout main
   git pull origin main
   git checkout -b feat/你的功能名

2. 开发 + 在本地运行测试
   npm start   # 手动验证功能正常

3. 提交（中文或英文都可以）
   git commit -m "feat: xxx功能描述"

4. 推送到自己的 Fork
   git push origin feat/你的功能名

5. 在 GitHub 上发起 Pull Request
   目标分支: main
```

### Commit 规范

建议使用 [Conventional Commits](https://www.conventionalcommits.org/)：

```
feat: 新功能
fix:  修复 bug
docs: 文档变更
refactor: 重构（不改变功能）
chore: 构建/工具链
```

### PR 标题示例

- `feat: 添加语音输入支持`
- `fix: 修复PDF导入中文乱码`
- `refactor: 提取公共的消息渲染函数`

## 用 Claude Code 提交贡献

如果你也在用 Claude Code，可以直接让它帮你从改代码到提 PR 全自动完成。

### 准备工作

先让 Claude Code 了解项目背景：

```
你现在在帮我优化一个开源桌宠项目 desktop-pet-wechat，
仓库在 https://github.com/yangr8640-eng/desktop-pet-wechat，
我已经 Fork 并 Clone 到了本地。

请先阅读 CONTRIBUTING.md 了解项目规范和代码风格。
```

### 日常贡献的话术

直接说需求就行：

```
帮我给桌宠加一个功能：当用户输入特定关键词时，
自动更换桌宠形象。

改动完成后帮我用 Conventional Commits 格式提交，
然后提 PR 到 yangr8640-eng/desktop-pet-wechat 的 main 分支。
```

### PR 话术

```
把当前分支的改动推到我 Fork 的仓库，
然后用 gh 命令给 yangr8640-eng/desktop-pet-wechat 的 main 分支提一个 PR，
标题写 "feat: xxx"，描述写清楚改了什么。
```

Claude Code 会自动完成：读代码 → 改文件 → commit → push → `gh pr create`，全程不需要离开终端。

## 常见贡献方向

- 🎨 **新桌宠形象** — 在 `pet/themes/` 下新建目录，放入 `normal.svg` + `mouthopen.svg`，在 `themes.js` 注册
- 💬 **聊天体验优化** — 改进 `chat/chat.js` 中的消息渲染、Markdown 解析
- 🎛️ **设置面板改进** — 改 `chat/chat.html` 中的设置区域
- 📄 **新文件格式支持** — 在 `main.js` 中添加解析器
- 🐛 **Bug 修复** — 任何模块，先提 Issue 描述问题

## 行为准则

- 对新手友好 — PR 描述写清楚改了什么、为什么这样改
- Review 意见是讨论而非命令 — 保持友善
- MIT 协议 — 贡献代码即同意在此协议下发布

---

有问题先在 [Issues](https://github.com/yangr8640-eng/desktop-pet-wechat/issues) 讨论，避免做了大量工作后发现方向不对。

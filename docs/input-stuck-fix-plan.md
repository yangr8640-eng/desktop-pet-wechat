# 聊天输入框卡住问题 — 修复方案

## 问题现象

Mac 端用户反馈：有时候聊天输入框会卡住，无法输入文字，只能重启 app。

## 根因分析

### 🔴 根因 1：AI API 调用无超时（最可能）

`main.js` 中 `callAI` 函数：

```js
const resp = await fetch(provider.apiBaseUrl, {
  method: 'POST',
  headers: { ... },
  body: JSON.stringify({ ... })
});
```

没有 AbortController、没有 timeout。如果 API 服务器 TCP 连接建立后挂住（网络抖动、服务端卡顿），fetch 永不 resolve → `isLoading` 永久为 `true` → `sendMessage()` 永远直接 return → 输入框彻底卡死。

### 🔴 根因 2：搜索调用在 try/catch 外部

`send-message` handler 中，`fetchWeatherData()` 和 `performWebSearch()` 在 try/catch 之前调用。虽然内部有错误处理，但如果发生非标准异常（如 Electron SSL 错误），异常穿透导致 renderer 端 Promise rejection 未处理，`isLoading` 不会重置。

### 🟡 根因 3：macOS `alwaysOnTop` 焦点冲突

两个窗口都是 `alwaysOnTop: true`，且 pet 窗口用了 `type: 'panel'`。macOS 上 alwaysOnTop 窗口焦点切换有已知问题：用户在输入框打字时，macOS 可能短暂把焦点给后面的普通窗口 → blur 触发 → hideChatWindow()。

### 🟡 根因 4：blur 保护时间过短

`ignoreBlurUntil = Date.now() + 400`（仅 400ms），滑入动画 280ms 后只剩 120ms 缓冲。

### 🟢 根因 5：缺少取消请求机制

macOS 版本没有 cancel-request IPC handler，API 卡住时用户无法中断。

## 修复计划

### P0 — 紧急修复

| # | 改动 | 文件 | 说明 |
|---|------|------|------|
| 1 | `callAI` 加 30s 超时 + AbortController | `main.js` | 防止 API 卡死导致 isLoading 永久为 true |
| 2 | `send-message` handler 搜索调用包入 try/catch | `main.js` | 防止未捕获异常导致 isLoading 不重置 |

### P1 — 体验优化（如果 P0 后仍出现再修）

| # | 改动 | 文件 | 说明 |
|---|------|------|------|
| 3 | `ignoreBlurUntil` 从 400ms 延长到 800ms | `main.js` | 给用户更多操作时间 |
| 4 | 添加 `cancel-request` IPC handler | `main.js` + `preload.js` + `chat/chat.js` | 允许用户中断卡住的请求 |

### P2 — 防御性改进（如果 P1 后仍出现再修）

| # | 改动 | 文件 | 说明 |
|---|------|------|------|
| 5 | blur handler 在 `isLoading` 时不隐藏窗口 | `main.js` | 等待 AI 回复时不让窗口消失 |
| 6 | 显示 "正在回复..." 状态提示 | `chat/chat.js` | 让用户知道正在处理而非卡死 |

## 实施记录

- [x] P0-1: `callAI` 添加 30s 超时 + AbortController — commit `02e1b1a`
- [ ] P0-2: 搜索调用包入 try/catch
- [ ] P1-3: blur 保护时间延长
- [ ] P1-4: 取消请求机制
- [ ] P2-5: isLoading 时抑制 blur 隐藏
- [ ] P2-6: 状态提示 UI

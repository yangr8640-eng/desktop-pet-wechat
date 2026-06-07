// wechat-bridge.js — WeChat Clawbot integration via ilink API
//
// Uses the official WeChat Clawbot ilink API (same protocol as
// @tencent-weixin/openclaw-weixin) to bridge WeChat messages
// into the desktop pet's AI agent.
//
// Protocol:
//   QR Login:  get_bot_qrcode → poll get_qrcode_status → bot_token
//   Messages:  getupdates (long polling, like Telegram Bot API)
//   Reply:     sendmessage
//
// No public URL / webhook / tunnel needed — all connections are outbound.

const { store } = require('./store');
const { processTask } = require('./task-processor');

// ─── Constants ───

const DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com';
const BOT_TYPE = '3';
const LONG_POLL_TIMEOUT_MS = 35_000;
const POLL_ERROR_DELAY_MS = 5_000;
const MAX_CONSECUTIVE_FAILURES = 5;

// ─── Bridge State ───

let state = {
  status: 'disconnected',  // disconnected | connecting | connected | error
  accountId: null,
  token: null,
  baseUrl: DEFAULT_BASE_URL,
  userId: null,
  contextToken: null,      // for proactive messaging (from latest getupdates)
  abortController: null,   // AbortController for active poll loop
  pollFailures: 0,         // consecutive poll failures
  currentQR: null,         // { qrcode, qrcodeDataUrl } for current login attempt
};

// ─── Notify pet window (reuse same mechanism as task-queue) ───

function notifyPetWindow(event, data) {
  try {
    const { getPetWindow } = require('./windows');
    const petWindow = getPetWindow();
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.webContents.send('agent-event', { event, data });
    }
  } catch { /* windows module might not be ready */ }
}

function notifyChatWindow(channel, data) {
  try {
    const { getChatWindow } = require('./windows');
    const chatWindow = getChatWindow();
    if (chatWindow && !chatWindow.isDestroyed()) {
      chatWindow.webContents.send(channel, data);
    }
  } catch { /* windows module might not be ready */ }
}

// ─── API Helpers ───

function buildHeaders(token, body) {
  const headers = {
    'Content-Type': 'application/json',
    'AuthorizationType': 'ilink_bot_token',
  };
  if (body) {
    headers['Content-Length'] = String(Buffer.byteLength(body, 'utf-8'));
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

async function apiFetch(endpoint, { token, body, timeoutMs = 30_000, baseUrl }) {
  const base = (baseUrl || state.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const url = `${base}/${endpoint.replace(/^\/+/, '')}`;
  const bodyStr = body ? JSON.stringify(body) : undefined;
  const headers = buildHeaders(token, bodyStr);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: bodyStr,
      signal: controller.signal,
    });
    clearTimeout(timer);
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    return JSON.parse(text);
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ─── QR Code Login ───

/**
 * Step 1: Request a QR code for WeChat login.
 * Generates QR code data URL locally using the 'qrcode' library.
 * Returns { qrcode, qrcodeDataUrl }
 */
async function requestQRCode() {
  const data = await apiFetch(
    `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(BOT_TYPE)}`,
    { timeoutMs: 15_000 }
  );

  if (!data.qrcode) {
    throw new Error('获取二维码失败：服务器未返回 qrcode');
  }

  // Generate QR code from qrcode_img_content (the WeChat login URL),
  // NOT from qrcode (which is just the session key for polling).
  let qrcodeDataUrl = null;
  try {
    const QRCode = require('qrcode');
    // qrcode_img_content is the actual URL that WeChat processes when scanned
    const qrContent = data.qrcode_img_content || data.qrcode;
    console.log('[WechatBridge] Generating QR for:', qrContent.slice(0, 100));
    qrcodeDataUrl = await QRCode.toDataURL(qrContent, {
      width: 300,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' }
    });
    console.log('[WechatBridge] QR data URL generated, length:', qrcodeDataUrl.length);
  } catch (err) {
    console.error('[WechatBridge] QR generation failed:', err.message);
  }

  return {
    qrcode: data.qrcode,
    qrcodeDataUrl: qrcodeDataUrl,
  };
}

/**
 * Step 2: Poll until the QR code is scanned and confirmed.
 * Returns { token, accountId, baseUrl, userId }
 */
async function waitForQRScan(qrcode) {
  const startTime = Date.now();
  const maxWaitMs = 480_000; // 8 minutes

  while (Date.now() - startTime < maxWaitMs) {
    const data = await apiFetch(
      'ilink/bot/get_qrcode_status',
      {
        body: { qrcode, bot_type: BOT_TYPE },
        timeoutMs: 10_000,
      }
    );

    switch (data.status) {
      case 'confirmed':
        if (!data.bot_token) {
          throw new Error('登录确认但未收到 bot_token');
        }
        return {
          token: data.bot_token,
          accountId: data.ilink_bot_id || 'unknown',
          baseUrl: data.baseurl || DEFAULT_BASE_URL,
          userId: data.ilink_user_id || '',
        };

      case 'scaned':
        // User scanned — update UI, keep waiting
        notifyChatWindow('wechat-qr-scanned', {});
        await sleep(1000);
        break;

      case 'expired':
        throw new Error('二维码已过期，请重新获取');

      case 'wait':
      default:
        await sleep(2000);
        break;
    }
  }

  throw new Error('二维码登录超时（8分钟）');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Public API: Login ───

/**
 * Start the WeChat login flow. Emits events to renderer for QR display.
 * Caller should listen for 'wechat-qr-code' on chat window.
 */
async function startLogin() {
  if (state.status === 'connected' || state.status === 'connecting') {
    return { success: false, error: '已有微信连接或正在连接中' };
  }

  state.status = 'connecting';
  saveState();

  try {
    // Step 1: Get QR code
    const qr = await requestQRCode();
    state.currentQR = qr;

    // Send QR to renderer for display (data URL, no CORS issues)
    notifyChatWindow('wechat-qr-code', {
      qrcodeDataUrl: qr.qrcodeDataUrl,
      qrcode: qr.qrcode,
    });

    // Step 2: Wait for scan
    const result = await waitForQRScan(qr.qrcode);

    // Step 3: Save credentials
    state.token = result.token;
    state.accountId = result.accountId;
    state.baseUrl = result.baseUrl || DEFAULT_BASE_URL;
    state.userId = result.userId;
    state.status = 'connected';
    state.currentQR = null;
    state.pollFailures = 0;
    saveState();

    // Start message polling
    startPollingLoop();

    notifyChatWindow('wechat-connected', {
      accountId: state.accountId,
      userId: state.userId,
    });

    return { success: true, accountId: state.accountId };
  } catch (err) {
    state.status = 'disconnected';
    state.currentQR = null;
    saveState();

    notifyChatWindow('wechat-login-error', { error: err.message });
    return { success: false, error: err.message };
  }
}

// ─── Message Polling ───

async function startPollingLoop() {
  if (state.abortController) {
    state.abortController.abort();
  }
  state.abortController = new AbortController();
  const signal = state.abortController.signal;

  // Fire-and-forget the poll loop
  (async () => {
    while (state.status === 'connected' && !signal.aborted) {
      try {
        await pollOnce(signal);
        state.pollFailures = 0;
      } catch (err) {
        if (signal.aborted) break;

        state.pollFailures++;
        console.error('[WechatBridge] Poll error:', err.message,
          `(${state.pollFailures}/${MAX_CONSECUTIVE_FAILURES})`);

        if (state.pollFailures >= MAX_CONSECUTIVE_FAILURES) {
          console.error('[WechatBridge] Too many poll failures, stopping');
          disconnect({ notify: true, reason: '轮询失败次数过多，连接已断开' });
          break;
        }

        // Wait before retry
        await sleepWithAbort(POLL_ERROR_DELAY_MS, signal);
      }
    }
  })().catch(err => {
    console.error('[WechatBridge] Poll loop fatal:', err.message);
  });
}

async function pollOnce(signal) {
  const body = {
    base_info: { channel_version: '1.0.0' },
  };

  const res = await apiFetch('ilink/bot/getupdates', {
    token: state.token,
    body,
    timeoutMs: LONG_POLL_TIMEOUT_MS + 5_000,
    baseUrl: state.baseUrl,
  });

  if (!res || !Array.isArray(res.updates)) return;

  for (const update of res.updates) {
    if (signal.aborted) break;

    // Update contextToken for proactive messaging
    if (update.context_token) {
      state.contextToken = update.context_token;
    }

    await processUpdate(update);
  }
}

async function processUpdate(update) {
  // Extract message info
  const msg = update.message || update;
  if (!msg) return;

  const conversationId = msg.from_user_id || msg.fromUserName || 'unknown';
  const msgType = msg.msg_type || msg.msgType || 'text';

  let text = '';
  let media = null;

  if (msgType === 'text' || msgType === 1) {
    text = msg.content || msg.text || '';
  } else if (msgType === 'image' || msgType === 3) {
    text = '[图片消息]';
    media = {
      type: 'image',
      filePath: msg.file_path || msg.cdn_url || '',
      mimeType: 'image/jpeg',
    };
  } else if (msgType === 'voice' || msgType === 34) {
    // WeChat voice — SDK auto-transcribes, fallback to text
    text = msg.voice_text || msg.content || '[语音消息]';
  } else if (msgType === 'video' || msgType === 43) {
    text = '[视频消息]';
  } else if (msgType === 'file') {
    text = msg.content || `[文件: ${msg.file_name || '未知'}]`;
  } else {
    text = msg.content || msg.text || '[未知消息类型]';
  }

  if (!text.trim()) return;

  // Dedup check (simple: ignore empty and pure-media-w-o-text)
  const trimmed = text.trim();
  if (!trimmed) return;

  // Notify pet
  notifyPetWindow('task-queued', {
    id: conversationId,
    senderName: conversationId.slice(0, 8) + '...',
  });

  // Process through AI agent
  notifyPetWindow('task-started', { id: conversationId });

  const result = await processTask(trimmed, {
    systemExtra: '你正在通过微信与用户沟通。回复应该简洁，适合在微信聊天界面阅读。',
    onThinking: (round) => {
      notifyPetWindow('task-thinking', { id: conversationId, round });
    },
    onToolCall: (name, params) => {
      notifyPetWindow('task-tool-call', { id: conversationId, tool: name });
    },
    onToolResult: (name) => {
      notifyPetWindow('task-tool-result', { id: conversationId, tool: name });
    },
    onError: (msg) => {
      console.error('[WechatBridge] Task error:', msg);
    },
  });

  // Send reply
  if (result.success && result.response) {
    await sendReply(conversationId, result.response);
  } else if (!result.success) {
    await sendReply(conversationId, `❌ 任务处理失败: ${result.error || '未知错误'}`);
  }

  notifyPetWindow('task-completed', {
    id: conversationId,
    status: result.success ? 'completed' : 'failed',
  });
}

// ─── Send Reply ───

async function sendReply(toUserId, text) {
  if (!state.token || state.status !== 'connected') {
    console.error('[WechatBridge] Cannot send reply: not connected');
    return false;
  }

  try {
    await apiFetch('ilink/bot/sendmessage', {
      token: state.token,
      body: {
        to_user_id: toUserId,
        msg_type: 1, // text
        content: text,
        context_token: state.contextToken || '',
        base_info: { channel_version: '1.0.0' },
      },
      timeoutMs: 15_000,
      baseUrl: state.baseUrl,
    });
    return true;
  } catch (err) {
    console.error('[WechatBridge] Send reply failed:', err.message);
    return false;
  }
}

// ─── Proactive Messaging ───

/**
 * Proactively send a message to a WeChat user (without waiting for a message).
 * Requires contextToken from a previous inbound message.
 */
async function sendProactiveMessage(toUserId, text) {
  return sendReply(toUserId, text);
}

// ─── Disconnect ───

function disconnect(opts = {}) {
  const { notify = true, reason } = opts;

  if (state.abortController) {
    state.abortController.abort();
    state.abortController = null;
  }

  state.status = 'disconnected';
  state.token = null;
  state.accountId = null;
  state.userId = null;
  state.contextToken = null;
  state.currentQR = null;
  state.pollFailures = 0;
  saveState();

  if (notify) {
    notifyChatWindow('wechat-disconnected', {
      reason: reason || '用户主动断开',
    });
  }
}

// ─── Auto-reconnect on startup ───

function loadState() {
  try {
    const saved = store.get('wechatBridge');
    if (saved) {
      state.token = saved.token || null;
      state.accountId = saved.accountId || null;
      state.baseUrl = saved.baseUrl || DEFAULT_BASE_URL;
      state.userId = saved.userId || null;
    }
  } catch { /* ignore */ }
}

function saveState() {
  try {
    store.set('wechatBridge', {
      token: state.token,
      accountId: state.accountId,
      baseUrl: state.baseUrl,
      userId: state.userId,
      lastSaved: new Date().toISOString(),
    });
  } catch { /* ignore */ }
}

/**
 * Try to reconnect on app startup using saved token.
 */
async function autoReconnect() {
  loadState();

  if (!state.token || !state.accountId) {
    return { success: false, reason: 'no_credentials' };
  }

  state.status = 'connecting';
  notifyChatWindow('wechat-connecting', {});

  try {
    // Verify token is still valid by making a poll request
    const res = await apiFetch('ilink/bot/getupdates', {
      token: state.token,
      body: { base_info: { channel_version: '1.0.0' } },
      timeoutMs: 10_000,
      baseUrl: state.baseUrl,
    });

    // Token works — we're connected
    state.status = 'connected';
    state.pollFailures = 0;
    saveState();

    startPollingLoop();

    notifyChatWindow('wechat-connected', {
      accountId: state.accountId,
      userId: state.userId,
    });
    return { success: true, accountId: state.accountId };
  } catch (err) {
    // Token expired or invalid — need fresh login
    state.status = 'disconnected';
    state.token = null;
    saveState();

    notifyChatWindow('wechat-disconnected', {
      reason: '登录已过期，请重新扫码',
    });
    return { success: false, reason: 'token_invalid', error: err.message };
  }
}

// ─── Status Queries ───

function getStatus() {
  return {
    status: state.status,
    accountId: state.accountId,
    userId: state.userId,
    hasToken: !!state.token,
    pollFailures: state.pollFailures,
  };
}

function getQRCode() {
  return state.currentQR;
}

// ─── Utility ───

function sleepWithAbort(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new Error('Aborted'));
      });
    }
  });
}

// ─── Exports ───

module.exports = {
  startLogin,
  disconnect,
  autoReconnect,
  sendProactiveMessage,
  getStatus,
  getQRCode,
};

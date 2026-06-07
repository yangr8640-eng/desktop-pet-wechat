// wechat-bridge.js — WeChat Clawbot integration via ilink API
//
// Protocol verified against @tencent-weixin/openclaw-weixin v2.4.4:
//   QR Login:  get_bot_qrcode (POST) → get_qrcode_status (GET, long poll)
//   Messages:  getupdates (POST, long poll) → item_list format
//   Reply:     sendmessage (POST, nested msg/item_list structure)
//
// No public URL / webhook / tunnel needed — all connections are outbound.

const crypto = require('crypto');
const { store } = require('./store');
const { processTask } = require('./task-processor');

// ─── Constants ───

const DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com';
const BOT_TYPE = '3';
const LONG_POLL_TIMEOUT_MS = 35_000;
const QR_LONG_POLL_TIMEOUT_MS = 35_000;
const DEFAULT_API_TIMEOUT_MS = 15_000;
const POLL_ERROR_DELAY_MS = 5_000;
const MAX_CONSECUTIVE_FAILURES = 5;
const CHANNEL_VERSION = '1.0.0';

// Message types (mirrors @tencent-weixin/openclaw-weixin MessageItemType)
const MessageItemType = {
  NONE: 0,
  TEXT: 1,
  IMAGE: 2,
  VOICE: 3,
  FILE: 4,
  VIDEO: 5,
  TOOL_CALL_START: 11,
  TOOL_CALL_RESULT: 12,
};

const MessageType = {
  NONE: 0,
  USER: 1,
  BOT: 2,
};

const MessageState = {
  NEW: 0,
  GENERATING: 1,
  FINISH: 2,
};

// ─── Bridge State ───

let state = {
  status: 'disconnected',  // disconnected | connecting | connected | error
  accountId: null,
  token: null,
  baseUrl: DEFAULT_BASE_URL,
  userId: null,
  contextTokens: {},       // userId → contextToken map
  getUpdatesBuf: '',       // pagination buffer for getupdates
  abortController: null,
  pollFailures: 0,
  currentQR: null,
};

// ─── Helpers ───

function randomWechatUin() {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), 'utf-8').toString('base64');
}

function generateClientId() {
  return `desktop-pet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildBaseInfo() {
  return {
    channel_version: CHANNEL_VERSION,
    bot_agent: 'desktop-pet',
  };
}

function buildHeaders(token) {
  const headers = {
    'Content-Type': 'application/json',
    'AuthorizationType': 'ilink_bot_token',
    'X-WECHAT-UIN': randomWechatUin(),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

// ─── Notify Renderers ───

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

// ─── Sleep ───

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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

// ─── API: GET ───

/**
 * GET request to ilink API. Used for get_qrcode_status (long poll).
 */
async function apiGetFetch({ baseUrl, endpoint, token, timeoutMs, label }) {
  const base = (baseUrl || state.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const url = new URL(endpoint, base + '/');
  const headers = buildHeaders(token);

  console.log(`[WechatBridge] GET ${label}:`, url.toString().slice(0, 100));

  const controller = new AbortController();
  const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    if (timer) clearTimeout(timer);
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    return JSON.parse(text);
  } catch (err) {
    if (timer) clearTimeout(timer);
    // AbortError (timeout) is normal for long polling — return wait status
    if (err.name === 'AbortError') {
      console.log(`[WechatBridge] ${label}: timeout (normal for long poll)`);
      return { status: 'wait' };
    }
    throw err;
  }
}

// ─── API: POST ───

async function apiPostFetch({ baseUrl, endpoint, token, body, timeoutMs, label }) {
  const base = (baseUrl || state.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const url = new URL(endpoint, base + '/');
  const bodyStr = body ? JSON.stringify({ ...body, base_info: buildBaseInfo() }) : JSON.stringify({ base_info: buildBaseInfo() });
  const headers = buildHeaders(token);

  console.log(`[WechatBridge] POST ${label}:`, url.toString().slice(0, 100));

  const controller = new AbortController();
  const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers,
      body: bodyStr,
      signal: controller.signal,
    });
    if (timer) clearTimeout(timer);
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    return JSON.parse(text);
  } catch (err) {
    if (timer) clearTimeout(timer);
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════
// QR Code Login
// ═══════════════════════════════════════════════════════════════

/**
 * Step 1: Request a QR code for WeChat login.
 * Sends local_token_list to allow auto-binding to existing bots.
 * Generates QR code data URL locally using the 'qrcode' library.
 */
async function requestQRCode() {
  // Collect any previously saved tokens for auto-rebinding
  const localTokenList = [];
  try {
    const saved = store.get('wechatBridge');
    if (saved && saved.token) {
      localTokenList.push(saved.token);
    }
  } catch { /* ignore */ }

  const data = await apiPostFetch({
    endpoint: `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(BOT_TYPE)}`,
    body: { local_token_list: localTokenList },
    timeoutMs: DEFAULT_API_TIMEOUT_MS,
    label: 'fetchQRCode',
  });

  if (!data.qrcode) {
    throw new Error('获取二维码失败：服务器未返回 qrcode');
  }

  // Generate QR code image from qrcode_img_content (the WeChat login URL)
  let qrcodeDataUrl = null;
  try {
    const QRCode = require('qrcode');
    const qrContent = data.qrcode_img_content || data.qrcode;
    console.log('[WechatBridge] Generating QR for:', qrContent.slice(0, 100));
    qrcodeDataUrl = await QRCode.toDataURL(qrContent, {
      width: 300,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' }
    });
  } catch (err) {
    console.error('[WechatBridge] QR generation failed:', err.message);
  }

  return {
    qrcode: data.qrcode,
    qrcodeDataUrl: qrcodeDataUrl,
  };
}

/**
 * Step 2: Long-poll for QR scan status.
 * This is a GET request with the qrcode as a query parameter.
 * Uses long polling (35s timeout) like the official SDK.
 */
async function pollQRStatus(apiBaseUrl, qrcode) {
  const endpoint = `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`;
  try {
    const data = await apiGetFetch({
      baseUrl: apiBaseUrl || DEFAULT_BASE_URL,
      endpoint,
      timeoutMs: QR_LONG_POLL_TIMEOUT_MS,
      label: 'pollQRStatus',
    });
    return data;
  } catch (err) {
    // Network/gateway errors → treat as 'wait' and retry
    console.warn('[WechatBridge] pollQRStatus network error, will retry:', err.message);
    return { status: 'wait' };
  }
}

/**
 * Wait until the QR code is scanned and confirmed.
 */
async function waitForQRScan(qrcode) {
  const startTime = Date.now();
  const maxWaitMs = 480_000; // 8 minutes
  let currentBaseUrl = DEFAULT_BASE_URL;

  while (Date.now() - startTime < maxWaitMs) {
    const data = await pollQRStatus(currentBaseUrl, qrcode);
    console.log('[WechatBridge] QR status:', data.status, data);

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

      case 'scanned':
        // User scanned — update UI, keep polling
        notifyChatWindow('wechat-qr-scanned', {});
        break;

      case 'scaned_but_redirect': {
        // IDC redirect: switch to a different regional server
        const redirectHost = data.redirect_host;
        if (redirectHost) {
          currentBaseUrl = `https://${redirectHost}`;
          console.log('[WechatBridge] IDC redirect to:', currentBaseUrl);
        }
        break;
      }

      case 'binded_redirect':
        // Bot already bound to this account — no need to re-scan
        console.log('[WechatBridge] Bot already bound (binded_redirect)');
        // The server should have returned the token info already
        if (data.bot_token) {
          return {
            token: data.bot_token,
            accountId: data.ilink_bot_id || 'unknown',
            baseUrl: data.baseurl || DEFAULT_BASE_URL,
            userId: data.ilink_user_id || '',
          };
        }
        throw new Error('已绑定但未收到 bot_token，请先解除原有连接再重试');

      case 'expired':
        throw new Error('二维码已过期，请重新获取');

      case 'verify_code_blocked':
        throw new Error('多次输入错误，请稍后再试');

      case 'wait':
      default:
        // status 'wait' or unknown — just continue long polling
        break;
    }

    // Small delay between polls when we get a non-wait response quickly
    // (the API itself does long polling so normally we won't loop tight)
    await sleep(1000);
  }

  throw new Error('二维码登录超时（8分钟）');
}

// ═══════════════════════════════════════════════════════════════
// Public API: Login
// ═══════════════════════════════════════════════════════════════

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

    // Send QR to renderer
    notifyChatWindow('wechat-qr-code', {
      qrcodeDataUrl: qr.qrcodeDataUrl,
      qrcode: qr.qrcode,
    });

    // Step 2: Wait for scan (long polling)
    const result = await waitForQRScan(qr.qrcode);

    // Step 3: Save credentials
    state.token = result.token;
    state.accountId = result.accountId;
    state.baseUrl = result.baseUrl || DEFAULT_BASE_URL;
    state.userId = result.userId;
    state.status = 'connected';
    state.currentQR = null;
    state.pollFailures = 0;
    state.getUpdatesBuf = '';
    state.contextTokens = {};
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

// ═══════════════════════════════════════════════════════════════
// Message Polling (getupdates — long poll)
// ═══════════════════════════════════════════════════════════════

async function startPollingLoop() {
  if (state.abortController) {
    state.abortController.abort();
  }
  state.abortController = new AbortController();
  const signal = state.abortController.signal;

  (async () => {
    console.log('[WechatBridge] Poll loop started');
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

        await sleepWithAbort(POLL_ERROR_DELAY_MS, signal);
      }
    }
  })().catch(err => {
    console.error('[WechatBridge] Poll loop fatal:', err.message);
  });
}

async function pollOnce(signal) {
  const res = await apiPostFetch({
    endpoint: 'ilink/bot/getupdates',
    token: state.token,
    body: {
      get_updates_buf: state.getUpdatesBuf || '',
    },
    timeoutMs: LONG_POLL_TIMEOUT_MS + 5_000,
    baseUrl: state.baseUrl,
    label: 'getUpdates',
  });

  // Save pagination buffer for next poll
  if (res && res.get_updates_buf != null && res.get_updates_buf !== '') {
    state.getUpdatesBuf = res.get_updates_buf;
  }

  // Process messages
  const msgs = res && res.msgs ? res.msgs : (res && res.updates ? res.updates : []);
  if (!Array.isArray(msgs) || msgs.length === 0) return;

  for (const msg of msgs) {
    if (signal.aborted) break;

    // Store context_token for this user
    if (msg.context_token && msg.from_user_id) {
      state.contextTokens[msg.from_user_id] = msg.context_token;
    }

    await processMessage(msg);
  }
}

/**
 * Process a single inbound message using the official message format.
 *
 * Message structure:
 * {
 *   from_user_id: string,
 *   message_id: string,
 *   context_token: string,
 *   item_list: [
 *     { type: 1 (TEXT), text_item: { text: "..." } },
 *     { type: 2 (IMAGE), image_item: { media: {...} } },
 *     ...
 *   ]
 * }
 */
async function processMessage(msg) {
  const fromUserId = msg.from_user_id || msg.fromUserName || 'unknown';
  const itemList = msg.item_list || [];

  // Extract text from item_list
  let text = '';
  let media = null;

  for (const item of itemList) {
    switch (item.type) {
      case MessageItemType.TEXT:
        text += (item.text_item && item.text_item.text) || '';
        break;

      case MessageItemType.IMAGE:
        text += '[图片消息]';
        if (item.image_item && item.image_item.media) {
          media = {
            type: 'image',
            filePath: item.image_item.media.full_url || item.image_item.media.encrypt_query_param || '',
            mimeType: 'image/jpeg',
          };
        }
        break;

      case MessageItemType.VOICE:
        text += (item.voice_item && item.voice_item.text) || '[语音消息]';
        break;

      case MessageItemType.VIDEO:
        text += '[视频消息]';
        break;

      case MessageItemType.FILE:
        text += item.file_item
          ? `[文件: ${item.file_item.file_name || '未知'}]`
          : '[文件消息]';
        break;

      default:
        // unknown type — try to extract any text
        if (item.text_item && item.text_item.text) {
          text += item.text_item.text;
        }
        break;
    }
  }

  // Fallback: try legacy format (content/text field directly on message)
  if (!text.trim()) {
    text = msg.content || msg.text || '';
  }

  if (!text.trim()) return;

  console.log('[WechatBridge] Message from', fromUserId.slice(0, 12), ':', text.slice(0, 80));

  // Notify pet
  notifyPetWindow('task-queued', {
    id: fromUserId,
    senderName: fromUserId.slice(0, 8) + '...',
  });

  notifyPetWindow('task-started', { id: fromUserId });

  // Process through AI agent
  const result = await processTask(text.trim(), {
    systemExtra: '你正在通过微信与用户沟通。回复应该简洁，适合在微信聊天界面阅读。',
    onThinking: (round) => {
      notifyPetWindow('task-thinking', { id: fromUserId, round });
    },
    onToolCall: (name, params) => {
      notifyPetWindow('task-tool-call', { id: fromUserId, tool: name });
    },
    onToolResult: (name) => {
      notifyPetWindow('task-tool-result', { id: fromUserId, tool: name });
    },
    onError: (msg) => {
      console.error('[WechatBridge] Task error:', msg);
    },
  });

  // Send reply
  if (result.success && result.response) {
    await sendReply(fromUserId, result.response);
  } else if (!result.success) {
    await sendReply(fromUserId, `❌ 任务处理失败: ${result.error || '未知错误'}`);
  }

  notifyPetWindow('task-completed', {
    id: fromUserId,
    status: result.success ? 'completed' : 'failed',
  });
}

// ═══════════════════════════════════════════════════════════════
// Send Reply (sendmessage)
// ═══════════════════════════════════════════════════════════════

async function sendReply(toUserId, text) {
  if (!state.token || state.status !== 'connected') {
    console.error('[WechatBridge] Cannot send reply: not connected');
    return false;
  }

  const contextToken = state.contextTokens[toUserId] || '';

  // Build message in the official format
  const reqBody = {
    msg: {
      from_user_id: '',
      to_user_id: toUserId,
      client_id: generateClientId(),
      message_type: MessageType.BOT,    // 2
      message_state: MessageState.FINISH, // 2
      item_list: text ? [
        { type: MessageItemType.TEXT, text_item: { text } },
      ] : [],
      context_token: contextToken || undefined,
    },
  };

  try {
    await apiPostFetch({
      endpoint: 'ilink/bot/sendmessage',
      token: state.token,
      body: reqBody,
      timeoutMs: DEFAULT_API_TIMEOUT_MS,
      baseUrl: state.baseUrl,
      label: 'sendMessage',
    });
    console.log('[WechatBridge] Reply sent to', toUserId.slice(0, 12));
    return true;
  } catch (err) {
    console.error('[WechatBridge] Send reply failed:', err.message);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════
// Proactive Messaging
// ═══════════════════════════════════════════════════════════════

async function sendProactiveMessage(toUserId, text) {
  return sendReply(toUserId, text);
}

// ═══════════════════════════════════════════════════════════════
// Disconnect
// ═══════════════════════════════════════════════════════════════

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
  state.contextTokens = {};
  state.getUpdatesBuf = '';
  state.currentQR = null;
  state.pollFailures = 0;
  saveState();

  if (notify) {
    notifyChatWindow('wechat-disconnected', {
      reason: reason || '用户主动断开',
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// Persistence
// ═══════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════
// Auto-reconnect on startup
// ═══════════════════════════════════════════════════════════════

async function autoReconnect() {
  loadState();

  if (!state.token || !state.accountId) {
    return { success: false, reason: 'no_credentials' };
  }

  state.status = 'connecting';
  notifyChatWindow('wechat-connecting', {});

  try {
    // Verify token by making a poll request
    const res = await apiPostFetch({
      endpoint: 'ilink/bot/getupdates',
      token: state.token,
      body: { get_updates_buf: '' },
      timeoutMs: DEFAULT_API_TIMEOUT_MS,
      baseUrl: state.baseUrl,
      label: 'autoReconnect',
    });

    state.status = 'connected';
    state.pollFailures = 0;
    state.getUpdatesBuf = '';
    state.contextTokens = {};
    saveState();

    startPollingLoop();

    notifyChatWindow('wechat-connected', {
      accountId: state.accountId,
      userId: state.userId,
    });
    return { success: true, accountId: state.accountId };
  } catch (err) {
    state.status = 'disconnected';
    state.token = null;
    saveState();

    notifyChatWindow('wechat-disconnected', {
      reason: '登录已过期，请重新扫码',
    });
    return { success: false, reason: 'token_invalid', error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// Status Queries
// ═══════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════
// Exports
// ═══════════════════════════════════════════════════════════════

module.exports = {
  startLogin,
  disconnect,
  autoReconnect,
  sendProactiveMessage,
  getStatus,
  getQRCode,
};

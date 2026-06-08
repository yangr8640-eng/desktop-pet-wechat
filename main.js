const { app, BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');
const { themes, getTheme } = require('./themes');

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const store = new Store({
  defaults: {
    petPosition: null,
    conversations: [],
    activeConversationId: null,
    modelProviders: [],
    activeModelProviderId: 'deepseek',
    searchEnabled: false,
    personalityPrompt: '',
    activeTheme: 'claude'
  }
});

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function getConversations() {
  return store.get('conversations') || [];
}

function saveConversations(convs) {
  store.set('conversations', convs);
}

function getActiveConversation() {
  const convs = getConversations();
  const activeId = store.get('activeConversationId');
  let conv = convs.find(c => c.id === activeId);
  if (!conv) {
    conv = {
      id: generateId(),
      title: '新对话',
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    convs.push(conv);
    store.set('activeConversationId', conv.id);
    saveConversations(convs);
  }
  return { conv, convs };
}

function getConversationList() {
  const convs = getConversations();
  return convs.map(c => ({
    id: c.id,
    title: c.title,
    updatedAt: c.updatedAt
  })).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

function updateActiveConversation(updater) {
  const convs = getConversations();
  const activeId = store.get('activeConversationId');
  const idx = convs.findIndex(c => c.id === activeId);
  if (idx >= 0) {
    updater(convs[idx]);
    saveConversations(convs);
  }
}

/* ─── Model Provider helpers ─── */
const PRESET_PROVIDERS = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    type: 'preset',
    apiKey: '',
    apiBaseUrl: 'https://api.deepseek.com/chat/completions',
    modelName: 'deepseek-chat',
    order: 0
  },
  {
    id: 'openai',
    name: 'OpenAI / ChatGPT',
    type: 'preset',
    apiKey: '',
    apiBaseUrl: 'https://api.openai.com/v1/chat/completions',
    modelName: 'gpt-4o',
    order: 1
  }
];

function getModelProviders() {
  return store.get('modelProviders') || [];
}

function saveModelProviders(providers) {
  store.set('modelProviders', providers);
}

function ensurePresetProviders() {
  let providers = getModelProviders();
  let changed = false;
  for (const preset of PRESET_PROVIDERS) {
    if (!providers.find(p => p.id === preset.id)) {
      providers.push({ ...preset });
      changed = true;
    }
  }
  if (changed) saveModelProviders(providers);
  return providers;
}

function getActiveModelProvider() {
  ensurePresetProviders();
  const providers = getModelProviders();
  const activeId = store.get('activeModelProviderId') || 'deepseek';
  let provider = providers.find(p => p.id === activeId);
  if (!provider) {
    provider = providers[0] || PRESET_PROVIDERS[0];
    store.set('activeModelProviderId', provider.id);
  }
  return provider;
}

let petWindow = null;
let chatWindow = null;
let isChatVisible = false;
let chatWidth = 360;
let chatHeight = 400; // default, recalculated in createChatWindow
let savedChatBounds = null; // preserved across hide/show cycles
let ignoreBlurUntil = 0; // timestamp to suppress blur after show
let isQuitting = false;

/* ─── Pet Window ─── */
function createPetWindow() {
  const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;
  const savedPos = store.get('petPosition');

  const petWidth = 145;
  const petHeight = 170;
  const x = savedPos != null ? savedPos.x : screenWidth - petWidth - 40;
  const y = savedPos != null ? savedPos.y : 30;

  petWindow = new BrowserWindow({
    width: petWidth,
    height: petHeight,
    x,
    y,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    type: 'panel',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  petWindow.loadFile('pet/pet.html');
  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  petWindow.on('closed', () => { petWindow = null; });
}

/* ─── Chat Window ─── */
function createChatWindow() {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  chatWidth = 360;
  chatHeight = Math.round(screenHeight * 0.8);
  const chatY = Math.round((screenHeight - chatHeight) / 2);

  chatWindow = new BrowserWindow({
    width: chatWidth,
    height: chatHeight,
    x: screenWidth,
    y: chatY,
    frame: false,
    resizable: true,
    minWidth: 360,
    minHeight: chatHeight,
    skipTaskbar: false,
    show: false,
    alwaysOnTop: true,
    hasShadow: true,
    vibrancy: 'sidebar',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  chatWindow.loadFile('chat/chat.html');
  chatWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  chatWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      hideChatWindow();
    }
  });
  chatWindow.on('blur', () => {
    if (Date.now() < ignoreBlurUntil) return;
    hideChatWindow();
  });
  chatWindow.on('closed', () => { chatWindow = null; });
}

/* ─── Chat slide animation ─── */
function showChatWindow() {
  if (isChatVisible) return;
  isChatVisible = true;

  // Restore user-resized dimensions from last hide
  if (savedChatBounds) {
    chatWidth = savedChatBounds.width;
    chatHeight = savedChatBounds.height;
  }

  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  const chatY = Math.round((screenHeight - chatHeight) / 2);
  const startX = screenWidth;
  const endX = screenWidth - chatWidth;

  chatWindow.setBounds({ x: startX, y: chatY, width: chatWidth, height: chatHeight });
  chatWindow.show();
  chatWindow.focus();
  ignoreBlurUntil = Date.now() + 400; // suppress blur for 400ms after show

  const duration = 280;
  const startTime = Date.now();
  const step = () => {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    chatWindow.setBounds({
      x: Math.round(startX + (endX - startX) * eased),
      y: chatY,
      width: chatWidth,
      height: chatHeight
    });
    if (progress < 1) {
      setTimeout(step, 10);
    }
  };
  step();
}

function hideChatWindow() {
  if (!isChatVisible) return;
  isChatVisible = false;

  // Save current size so we can restore on next show
  savedChatBounds = chatWindow.getBounds();
  chatWidth = savedChatBounds.width;
  chatHeight = savedChatBounds.height;

  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  const chatY = Math.round((screenHeight - chatHeight) / 2);
  const startX = screenWidth - chatWidth;
  const endX = screenWidth;

  const duration = 200;
  const startTime = Date.now();
  const step = () => {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    chatWindow.setBounds({
      x: Math.round(startX + (endX - startX) * eased),
      y: chatY,
      width: chatWidth,
      height: chatHeight
    });
    if (progress < 1) {
      setTimeout(step, 10);
    } else {
      chatWindow.hide();
    }
  };
  step();
}

/* ─── AI API ─── */
async function callAI(messages, timeoutMs = 30000) {
  const provider = getActiveModelProvider();
  if (!provider.apiKey) {
    return `你还没设置${provider.name}的API Key哦！请在聊天窗口的设置里输入API Key~`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(provider.apiBaseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.apiKey}`
      },
      body: JSON.stringify({
        model: provider.modelName,
        messages,
        temperature: 0.8,
        max_tokens: 2000
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`API错误(${resp.status}): ${errText}`);
    }

    const data = await resp.json();
    return data.choices[0].message.content;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error(`请求超时(${timeoutMs / 1000}秒)，请检查网络后重试`);
    }
    throw err;
  }
}

/* ─── API Key Validation ─── */
async function validateModelApiKey(providerId) {
  const id = providerId || store.get('activeModelProviderId') || 'deepseek';
  const providers = getModelProviders();
  const provider = providers.find(p => p.id === id);
  if (!provider || !provider.apiKey || !provider.apiKey.trim()) {
    return { valid: false, reason: 'no-key' };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const resp = await fetch(provider.apiBaseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.apiKey}`
      },
      body: JSON.stringify({
        model: provider.modelName,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (resp.ok || resp.status === 429) {
      return { valid: true };
    }
    if (resp.status === 401 || resp.status === 403) {
      return { valid: false, reason: 'invalid-key' };
    }
    return { valid: true };
  } catch {
    return { valid: true, reason: 'network-error' };
  }
}

async function generateConversationTitle(userMessage, aiResponse) {
  const summaryPrompt = [
    { role: 'system', content: '你是一个标题生成器。根据对话内容生成一个简短的标题（10个字以内，不要引号，不要句号）。只输出标题本身，不要任何其他文字。' },
    { role: 'user', content: `用户: ${userMessage.slice(0, 200)}\n\nAI: ${aiResponse.slice(0, 200)}\n\n请为以上对话生成一个简短标题。` }
  ];
  try {
    return await callAI(summaryPrompt);
  } catch {
    return null;
  }
}

function buildSystemPrompt(searchContext) {
  const now = new Date();
  const todayStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;
  const theme = getTheme(store.get('activeTheme') || 'claude');

  let content = `今天是${todayStr}。

你叫"${theme.name}"，是一个可爱的桌面宠物。你的性格：
${theme.personality}`;

  if (searchContext) {
    content += searchContext;
  }

  const personality = store.get('personalityPrompt');
  if (personality) {
    content += `\n\n【用户偏好】\n${personality}`;
  }

  return {
    role: 'system',
    content
  };
}

/* ─── Web Search ─── */
async function performWebSearch(query) {
  try {
    const resp = await fetch(`https://cn.bing.com/search?q=${encodeURIComponent(query)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (!resp.ok) return null;
    const html = await resp.text();

    // Extract result blocks: each result has an h2>a title and a b_caption>p snippet
    const results = [];
    const titleRegex = /<h2[^>]*>\s*<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>/gi;
    const captionRegex = /class="b_caption"[^>]*>\s*<p[^>]*>([\s\S]*?)<\/p>/gi;

    const titles = [];
    const captions = [];
    let m;
    while ((m = titleRegex.exec(html)) !== null && titles.length < 5) {
      titles.push({ url: m[1], title: m[2].replace(/<[^>]+>/g, '').trim() });
    }
    while ((m = captionRegex.exec(html)) !== null && captions.length < 5) {
      captions.push(m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&ensp;/g, ' ').replace(/&#0?\d+;/g, '').trim());
    }

    for (let i = 0; i < Math.min(titles.length, captions.length); i++) {
      results.push({
        title: titles[i].title,
        snippet: captions[i],
        url: titles[i].url
      });
    }

    return results.length > 0 ? results : null;
  } catch (err) {
    console.error('Web search error:', err.message);
    return null;
  }
}

function formatSearchContext(query, results) {
  if (!results || results.length === 0) return null;

  let text = '\n\n【联网搜索结果】\n';
  text += `用户查询："${query}"\n`;
  text += `共找到 ${results.length} 条相关结果：\n\n`;

  results.forEach((r, i) => {
    text += `${i + 1}. ${r.title}\n`;
    if (r.snippet) text += `   ${r.snippet}\n`;
    text += `   来源: ${r.url}\n\n`;
  });

  text += '请根据以上搜索结果回答用户的问题。如果搜索结果与问题不相关或不充分，请如实告诉用户，并尽量用你自己的知识补充回答。记住保持你可爱的性格~\n';
  return text;
}

/* ─── Weather ─── */
function isWeatherQuery(query) {
  return /天气|气温|温度|下雨|下雪|刮风|台风|雾霾|晴天|阴天|多云|湿度|风力|穿什么|热不热|冷不冷|weather|temperature|rain|snow|wind|forecast/i.test(query);
}

async function fetchWeatherData() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch('https://wttr.in?format=j1', {
      signal: controller.signal,
      headers: { 'User-Agent': 'curl/8.0' }
    });
    clearTimeout(timeout);
    if (!resp.ok) return null;
    const data = await resp.json();
    return formatWeatherData(data);
  } catch { return null; }
}

function formatWeatherData(data) {
  const current = data.current_condition?.[0];
  const today = data.weather?.[0];
  if (!current) return null;

  let text = '\n\n【实时天气数据 - wttr.in】\n';
  text += `当前温度: ${current.temp_C}°C (体感 ${current.FeelsLikeC}°C)\n`;
  text += `天气状况: ${current.weatherDesc?.[0]?.value || '未知'}\n`;
  text += `湿度: ${current.humidity}%\n`;
  text += `风速: ${current.windspeedKmph} km/h\n`;
  if (today) {
    text += `今日最高: ${today.maxtempC}°C / 最低: ${today.mintempC}°C\n`;
  }
  text += '\n请根据以上实时天气数据回答用户。记住保持你可爱的性格~\n';
  return text;
}

/* ─── File reading ─── */
async function readFileContent(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  try {
    switch (ext) {
      case '.txt':
      case '.md':
      case '.json':
      case '.csv':
      case '.log':
      case '.xml':
      case '.yaml':
      case '.yml':
        return fs.readFileSync(filePath, 'utf-8');
      case '.pdf': {
        const pdfParse = require('pdf-parse');
        const buffer = fs.readFileSync(filePath);
        const data = await pdfParse(buffer);
        return data.text || '(PDF内容为空)';
      }
      case '.docx': {
        const mammoth = require('mammoth');
        const result = await mammoth.extractRawText({ path: filePath });
        return result.value || '(文档内容为空)';
      }
      default:
        return null;
    }
  } catch (err) {
    console.error('File read error:', err.message);
    return `[读取文件失败: ${err.message}]`;
  }
}

/* ─── IPC handlers ─── */
ipcMain.handle('send-message', async (_event, message) => {
  const provider = getActiveModelProvider();
  if (!provider.apiKey) {
    return `你还没设置${provider.name}的API Key呢！请在右上角⚙️设置中输入API Key~`;
  }

  const { conv, convs } = getActiveConversation();
  const history = conv.messages || [];

  let searchContext = null;
  if (store.get('searchEnabled')) {
    if (isWeatherQuery(message)) {
      const weatherData = await fetchWeatherData();
      if (weatherData) {
        searchContext = weatherData;
      }
    }
    if (!searchContext) {
      const results = await performWebSearch(message);
      if (results) {
        searchContext = formatSearchContext(message, results);
      }
    }
  }

  const messages = [buildSystemPrompt(searchContext), ...history, { role: 'user', content: message }];
  const recentHistory = messages.slice(-30);

  try {
    const reply = await callAI(recentHistory);
    conv.messages.push({ role: 'user', content: message });
    conv.messages.push({ role: 'assistant', content: reply });

    if (conv.title === '新对话') {
      const summary = await generateConversationTitle(message, reply);
      conv.title = summary || message.slice(0, 20) + (message.length > 20 ? '...' : '');
    }

    conv.updatedAt = new Date().toISOString();
    if (conv.messages.length > 100) conv.messages.splice(0, conv.messages.length - 100);
    saveConversations(convs);
    return reply;
  } catch (err) {
    return `出错了: ${err.message}`;
  }
});

ipcMain.handle('analyze-file', async (_event, filePath) => {
  const provider = getActiveModelProvider();
  if (!provider.apiKey) {
    return `你还没设置${provider.name}的API Key呢！请先在聊天窗口设置API Key~`;
  }

  const fileName = path.basename(filePath);
  const content = await readFileContent(filePath);

  if (content === null) {
    const theme = getTheme(store.get('activeTheme') || 'claude');
    return `${theme.name}还不支持"${path.extname(filePath)}"这种文件格式哦，试试 .txt / .pdf / .docx 文件吧~`;
  }

  if (typeof content === 'string' && content.startsWith('[读取文件失败')) {
    return content;
  }

  const maxContent = content.slice(0, 20000);
  const truncated = content.length > 20000 ? '\n\n(文件太长了，只读取了前20000字哦)' : '';

  const messages = [
    buildSystemPrompt(),
    {
      role: 'user',
      content: `主人给你丢了一个文件过来！文件名是"${fileName}"。\n\n请帮主人分析总结这个文件的内容:\n\n${maxContent}${truncated}\n\n请回复: 先用可爱的语气告诉主人文件是什么类型的，然后用清晰的结构总结文档的核心内容。`
    }
  ];

  try {
    const reply = await callAI(messages);
    const { conv, convs } = getActiveConversation();
    conv.messages.push({ role: 'user', content: `📄 拖入文件: ${fileName}` });
    conv.messages.push({ role: 'assistant', content: reply });
    if (conv.messages.length > 100) conv.messages.splice(0, conv.messages.length - 100);
    if (conv.title === '新对话') {
      const summary = await generateConversationTitle(
        `用户导入文件: ${fileName}`, reply
      );
      conv.title = summary || `文件分析: ${fileName}`;
    }
    conv.updatedAt = new Date().toISOString();
    saveConversations(convs);

    if (chatWindow) chatWindow.webContents.send('messages-updated');

    return reply;
  } catch (err) {
    return `分析文件时出错了: ${err.message}`;
  }
});

ipcMain.handle('get-history', () => {
  const { conv } = getActiveConversation();
  return conv.messages || [];
});

ipcMain.handle('new-conversation', () => {
  const convs = getConversations();
  const activeId = store.get('activeConversationId');
  const activeConv = convs.find(c => c.id === activeId);

  // If current conversation is empty, just reuse it — don't create a new one
  if (activeConv && (!activeConv.messages || activeConv.messages.length === 0)) {
    return getConversationList();
  }

  const newConv = {
    id: generateId(),
    title: '新对话',
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  convs.push(newConv);
  saveConversations(convs);
  store.set('activeConversationId', newConv.id);
  return getConversationList();
});

ipcMain.handle('clear-history', () => {
  // Backward compat: same logic as new-conversation
  const convs = getConversations();
  const activeId = store.get('activeConversationId');
  const activeConv = convs.find(c => c.id === activeId);

  if (activeConv && (!activeConv.messages || activeConv.messages.length === 0)) {
    return true;
  }

  const newConv = {
    id: generateId(),
    title: '新对话',
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  convs.push(newConv);
  saveConversations(convs);
  store.set('activeConversationId', newConv.id);
  return true;
});

ipcMain.handle('get-conversations', () => {
  return getConversationList();
});

ipcMain.handle('get-active-conversation-id', () => {
  return store.get('activeConversationId');
});

ipcMain.handle('switch-conversation', (_event, id) => {
  const convs = getConversations();
  if (convs.some(c => c.id === id)) {
    store.set('activeConversationId', id);
    return true;
  }
  return false;
});

ipcMain.handle('delete-conversation', (_event, id) => {
  const convs = getConversations();
  if (convs.length <= 1) return false;
  const idx = convs.findIndex(c => c.id === id);
  if (idx >= 0) {
    convs.splice(idx, 1);
    saveConversations(convs);
    if (store.get('activeConversationId') === id) {
      store.set('activeConversationId', convs[0].id);
    }
    return true;
  }
  return false;
});

ipcMain.handle('import-file', async () => {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog({
    title: '导入文档',
    filters: [
      { name: '文档文件', extensions: ['txt', 'md', 'pdf', 'docx', 'json', 'csv', 'xml', 'yaml', 'yml', 'log'] }
    ],
    properties: ['openFile']
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const filePath = result.filePaths[0];
  const fileName = path.basename(filePath);
  const content = await readFileContent(filePath);

  if (content === null) {
    return { fileName, content: null, error: `不支持的文件格式: ${path.extname(filePath)}` };
  }

  if (typeof content === 'string' && content.startsWith('[读取文件失败')) {
    return { fileName, content: null, error: content };
  }

  const truncated = content.slice(0, 20000);
  return { fileName, content: truncated };
});

/* ─── Model Provider IPC ─── */
ipcMain.handle('get-model-providers', () => {
  ensurePresetProviders();
  return getModelProviders();
});

ipcMain.handle('save-model-provider', (_event, provider) => {
  const providers = getModelProviders();
  const idx = providers.findIndex(p => p.id === provider.id);
  if (idx >= 0) {
    providers[idx] = { ...providers[idx], ...provider };
  } else {
    providers.push(provider);
  }
  saveModelProviders(providers);
  return true;
});

ipcMain.handle('delete-model-provider', (_event, id) => {
  const providers = getModelProviders();
  const provider = providers.find(p => p.id === id);
  if (!provider || provider.type === 'preset') return false;
  const idx = providers.findIndex(p => p.id === id);
  if (idx >= 0) {
    providers.splice(idx, 1);
    saveModelProviders(providers);
    if (store.get('activeModelProviderId') === id) {
      store.set('activeModelProviderId', providers[0]?.id || 'deepseek');
    }
    return true;
  }
  return false;
});

ipcMain.handle('get-active-model-provider', () => {
  return getActiveModelProvider();
});

ipcMain.handle('set-active-model-provider', (_event, id) => {
  const providers = getModelProviders();
  if (providers.some(p => p.id === id)) {
    store.set('activeModelProviderId', id);
    return getActiveModelProvider();
  }
  return null;
});

ipcMain.handle('validate-model-api-key', async (_event, providerId) => {
  return await validateModelApiKey(providerId);
});

ipcMain.handle('toggle-search', () => {
  const current = store.get('searchEnabled');
  store.set('searchEnabled', !current);
  return !current;
});

ipcMain.handle('get-search-enabled', () => {
  return store.get('searchEnabled');
});

ipcMain.handle('save-personality', (_event, text) => {
  store.set('personalityPrompt', text.trim());
  return true;
});

ipcMain.handle('get-personality', () => {
  return store.get('personalityPrompt') || '';
});

ipcMain.handle('get-theme', () => {
  const themeId = store.get('activeTheme') || 'claude';
  return getTheme(themeId);
});

ipcMain.handle('set-theme', (_event, themeId) => {
  const theme = getTheme(themeId);
  if (!theme) return false;
  store.set('activeTheme', themeId);
  if (petWindow) petWindow.webContents.send('theme-changed', theme);
  if (chatWindow) chatWindow.webContents.send('theme-changed', theme);
  return true;
});

ipcMain.on('open-chat', () => {
  if (isChatVisible) {
    hideChatWindow();
  } else {
    showChatWindow();
    if (chatWindow) chatWindow.webContents.send('focus-input');
  }
});

ipcMain.on('show-chat', () => {
  if (!isChatVisible) {
    showChatWindow();
  }
  if (chatWindow) chatWindow.webContents.send('focus-input');
});

ipcMain.on('resize-window', (_event, width, height) => {
  if (!chatWindow) return;
  const { width: scrW, height: scrH } = screen.getPrimaryDisplay().workAreaSize;
  const minH = Math.round(scrH * 0.7);
  chatWidth = Math.max(360, Math.round(width));
  chatHeight = Math.max(minH, Math.round(height));
  chatWindow.setBounds({
    x: scrW - chatWidth,
    y: chatWindow.getBounds().y,
    width: chatWidth,
    height: chatHeight
  });
});

ipcMain.on('close-chat', () => {
  hideChatWindow();
});

ipcMain.on('save-position', () => {
  if (petWindow) {
    const [x, y] = petWindow.getPosition();
    store.set('petPosition', { x, y });
  }
});

ipcMain.on('move-window', (_event, dx, dy) => {
  if (petWindow) {
    const [x, y] = petWindow.getPosition();
    petWindow.setPosition(x + dx, y + dy);
  }
});

ipcMain.on('resize-pet', (_event, width, height) => {
  if (petWindow) {
    const [x, y] = petWindow.getPosition();
    petWindow.setBounds({ x, y, width, height });
  }
});

ipcMain.on('minimize-chat', () => {
  hideChatWindow();
});

ipcMain.on('quit-app', () => {
  isQuitting = true;
  if (petWindow) {
    const pos = petWindow.getPosition();
    store.set('petPosition', { x: pos[0], y: pos[1] });
  }
  app.quit();
});

/* ─── App lifecycle ─── */
app.whenReady().then(() => {
  // Migrate old single apiKey to modelProviders array
  const oldApiKey = store.get('apiKey');
  if (oldApiKey !== undefined) {
    const providers = store.get('modelProviders');
    if (!providers || providers.length === 0) {
      store.set('modelProviders', [
        {
          id: 'deepseek',
          name: 'DeepSeek',
          type: 'preset',
          apiKey: oldApiKey || '',
          apiBaseUrl: 'https://api.deepseek.com/chat/completions',
          modelName: 'deepseek-chat',
          order: 0
        }
      ]);
      store.set('activeModelProviderId', 'deepseek');
    }
    store.delete('apiKey');
  }

  // Migrate old chatHistory to new conversations model
  const conversations = store.get('conversations');
  if (!conversations || conversations.length === 0) {
    const oldHistory = store.get('chatHistory');
    if (oldHistory && oldHistory.length > 0) {
      const migratedConv = {
        id: generateId(),
        title: '历史对话',
        messages: oldHistory,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      store.set('conversations', [migratedConv]);
      store.set('activeConversationId', migratedConv.id);
      store.delete('chatHistory');
    }
  }
  // Clean up any leftover chatHistory key from old data model
  if (store.get('chatHistory') !== undefined) {
    store.delete('chatHistory');
  }

  createPetWindow();
  createChatWindow();

  app.setLoginItemSettings({
    openAtLogin: true,
    path: app.getPath('exe')
  });
});

app.on('window-all-closed', () => {
  // Keep app running in background
});

app.on('activate', () => {
  if (petWindow === null) createPetWindow();
});

app.on('before-quit', () => {
  // Save position before quitting
  if (petWindow) {
    const pos = petWindow.getPosition();
    store.set('petPosition', { x: pos[0], y: pos[1] });
  }
});

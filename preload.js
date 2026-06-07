const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('petAPI', {
  // Chat
  sendMessage: (msg) => ipcRenderer.send('send-message', msg),
  analyzeFile: (filePath) => ipcRenderer.send('analyze-file', filePath),
  onStreamChunk: (cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on('stream-chunk', handler);
    return () => ipcRenderer.removeListener('stream-chunk', handler);
  },
  getFilePath: (file) => webUtils.getPathForFile(file),
  getHistory: () => ipcRenderer.invoke('get-history'),

  // Conversations
  getConversations: () => ipcRenderer.invoke('get-conversations'),
  getActiveConversationId: () => ipcRenderer.invoke('get-active-conversation-id'),
  switchConversation: (id) => ipcRenderer.invoke('switch-conversation', id),
  newConversation: () => ipcRenderer.invoke('new-conversation'),
  deleteConversation: (id) => ipcRenderer.invoke('delete-conversation', id),
  clearHistory: () => ipcRenderer.invoke('clear-history'),

  // File import
  importFile: () => ipcRenderer.invoke('import-file'),

  // Export
  exportConversation: () => ipcRenderer.invoke('export-conversation'),

  // Message operations
  regenerateMessage: () => ipcRenderer.send('regenerate-message'),
  trimConversation: (messageIndex) => ipcRenderer.invoke('trim-conversation', messageIndex),
  cancelRequest: () => ipcRenderer.send('cancel-request'),

  // Cross-conversation search
  searchAllConversations: (query) => ipcRenderer.invoke('search-all-conversations', query),

  // Model Providers
  getModelProviders: () => ipcRenderer.invoke('get-model-providers'),
  saveModelProvider: (provider) => ipcRenderer.invoke('save-model-provider', provider),
  deleteModelProvider: (id) => ipcRenderer.invoke('delete-model-provider', id),
  getActiveModelProvider: () => ipcRenderer.invoke('get-active-model-provider'),
  setActiveModelProvider: (id) => ipcRenderer.invoke('set-active-model-provider', id),
  validateModelApiKey: (providerId) => ipcRenderer.invoke('validate-model-api-key', providerId),

  // Search toggle
  toggleSearch: () => ipcRenderer.invoke('toggle-search'),
  getSearchEnabled: () => ipcRenderer.invoke('get-search-enabled'),

  // Auto-launch toggle
  getAutoLaunch: () => ipcRenderer.invoke('get-auto-launch'),
  setAutoLaunch: (enabled) => ipcRenderer.invoke('set-auto-launch', enabled),

  // Personality
  savePersonality: (text) => ipcRenderer.invoke('save-personality', text),
  getPersonality: () => ipcRenderer.invoke('get-personality'),

  // Theme
  getTheme: () => ipcRenderer.invoke('get-theme'),
  setTheme: (themeId) => ipcRenderer.invoke('set-theme', themeId),
  onThemeChanged: (cb) => ipcRenderer.on('theme-changed', (_event, theme) => cb(theme)),

  // Platform
  getPlatform: () => ipcRenderer.invoke('get-platform'),

  // Window controls
  resizeWindow: (width, height) => ipcRenderer.send('resize-window', width, height),
  resizePet: (width, height) => ipcRenderer.send('resize-pet', width, height),
  openChat: () => ipcRenderer.send('open-chat'),
  showChat: () => ipcRenderer.send('show-chat'),
  closeChat: () => ipcRenderer.send('close-chat'),
  moveWindow: (dx, dy) => ipcRenderer.send('move-window', dx, dy),
  savePosition: (pos) => ipcRenderer.send('save-position', pos),
  minimizeChat: () => ipcRenderer.send('minimize-chat'),
  quitApp: () => ipcRenderer.send('quit-app'),

  // Auto update
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  quitAndInstall: () => ipcRenderer.invoke('quit-and-install'),
  onUpdateEvent: (channel, cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },

  // Listen for events from main
  onFocusInput: (cb) => ipcRenderer.on('focus-input', () => cb()),
  onMessagesUpdated: (cb) => ipcRenderer.on('messages-updated', () => cb()),

  // WeChat bridge
  wechatLogin: () => ipcRenderer.invoke('wechat-login'),
  wechatDisconnect: () => ipcRenderer.invoke('wechat-disconnect'),
  wechatStatus: () => ipcRenderer.invoke('wechat-status'),
  wechatQRCode: () => ipcRenderer.invoke('wechat-qrcode'),
  wechatAutoReconnect: () => ipcRenderer.invoke('wechat-auto-reconnect'),

  // Task queue
  getTaskList: () => ipcRenderer.invoke('task-list'),
  getTaskStatus: (taskId) => ipcRenderer.invoke('task-status', taskId),

  // Agent log
  getAgentLog: (limit) => ipcRenderer.invoke('agent-log', limit),

  // Agent events from main process (task status changes)
  onAgentEvent: (cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on('agent-event', handler);
    return () => ipcRenderer.removeListener('agent-event', handler);
  },

  // WeChat bridge events
  onWechatEvent: (event, cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on(event, handler);
    return () => ipcRenderer.removeListener(event, handler);
  }
});

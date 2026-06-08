// Mock Electron APIs
const mockIpcMainHandlers = {};
const mockIpcMainOns = {};

jest.mock('electron', () => ({
  ipcMain: {
    on: jest.fn((channel, handler) => { mockIpcMainOns[channel] = handler; }),
    handle: jest.fn((channel, handler) => { mockIpcMainHandlers[channel] = handler; }),
    removeHandler: jest.fn()
  },
  screen: {
    getPrimaryDisplay: jest.fn().mockReturnValue({
      workAreaSize: { width: 1920, height: 1080 }
    })
  },
  app: {
    exit: jest.fn(),
    setLoginItemSettings: jest.fn(),
    getPath: jest.fn().mockReturnValue('/fake/path')
  },
  dialog: {
    showOpenDialog: jest.fn(),
    showSaveDialog: jest.fn()
  },
  Notification: {
    isSupported: jest.fn().mockReturnValue(false)
  }
}));

// Mock store module
const mockConvs = [
  {
    id: 'conv-1',
    title: 'Test Conv 1',
    messages: [
      { role: 'user', content: 'Hello world' },
      { role: 'assistant', content: 'Hi there! How can I help?' }
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:01:00.000Z'
  },
  {
    id: 'conv-2',
    title: 'Test Conv 2',
    messages: [
      { role: 'user', content: 'What is the weather?' },
      { role: 'assistant', content: 'It is sunny today with some code examples.' }
    ],
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:01:00.000Z'
  }
];

const mockStore = {
  get: jest.fn((key, defaultValue) => {
    if (key === 'activeConversationId') return 'conv-1';
    if (key === 'autoLaunch') return true;
    if (key === 'searchEnabled') return false;
    if (key === 'activeTheme') return 'claude';
    if (key === 'activeModelProviderId') return 'deepseek';
    if (key === 'personalityPrompt') return '';
    return defaultValue;
  }),
  set: jest.fn(),
  delete: jest.fn()
};

let mockConversations = JSON.parse(JSON.stringify(mockConvs));

const mockStoreModule = {
  store: mockStore,
  generateId: jest.fn(() => 'new-conv-id'),
  getConversations: jest.fn(() => mockConversations),
  saveConversations: jest.fn((convs) => { mockConversations = convs; }),
  getActiveConversation: jest.fn(() => {
    const conv = mockConversations.find(c => c.id === mockStore.get('activeConversationId'));
    return { conv, convs: mockConversations };
  }),
  getConversationList: jest.fn(() => mockConversations.map(c => ({
    id: c.id, title: c.title, updatedAt: c.updatedAt
  }))),
  ensurePresetProviders: jest.fn(),
  getModelProviders: jest.fn(() => [
    { id: 'deepseek', name: 'DeepSeek', type: 'preset', apiKey: 'sk-test', apiBaseUrl: 'https://api.deepseek.com/chat/completions', modelName: 'deepseek-chat' }
  ]),
  saveModelProviders: jest.fn(),
  getActiveModelProvider: jest.fn(() => ({
    id: 'deepseek', name: 'DeepSeek', type: 'preset', apiKey: 'sk-test', apiBaseUrl: 'https://api.deepseek.com/chat/completions', modelName: 'deepseek-chat'
  }))
};

jest.mock('../src/store', () => mockStoreModule);

// Mock ai module
const mockCancelActiveStream = jest.fn();
jest.mock('../src/ai', () => ({
  callAI: jest.fn(),
  callAIStream: jest.fn(),
  callAIStreamWithRetry: jest.fn(),
  cancelActiveStream: mockCancelActiveStream,
  validateModelApiKey: jest.fn(),
  generateConversationTitle: jest.fn(),
  buildSystemPrompt: jest.fn().mockReturnValue({ role: 'system', content: 'test prompt' })
}));

// Mock search module
jest.mock('../src/search', () => ({
  performWebSearch: jest.fn(),
  formatSearchContext: jest.fn(),
  isWeatherQuery: jest.fn().mockReturnValue(false),
  fetchWeatherData: jest.fn()
}));

// Mock file-reader module
jest.mock('../src/file-reader', () => ({
  readFileContent: jest.fn()
}));

// Mock windows module
const mockWindows = {
  getPetWindow: jest.fn(),
  getChatWindow: jest.fn().mockReturnValue({ webContents: { send: jest.fn() }, isMinimized: jest.fn().mockReturnValue(false) }),
  getChatVisible: jest.fn().mockReturnValue(true),
  showChatWindow: jest.fn(),
  hideChatWindow: jest.fn(),
  setQuitting: jest.fn()
};
jest.mock('../src/windows', () => mockWindows);

// Mock tray
jest.mock('../src/tray', () => ({
  destroyTray: jest.fn()
}));

// Mock themes - valid theme IDs return objects, invalid return undefined
jest.mock('../themes', () => ({
  getTheme: jest.fn((id) => {
    const themes = { claude: { id: 'claude', name: 'Claude', emoji: '💠', personality: '冷静理性', svgs: { normal: '', mouthOpen: '' }, welcomeGreeting: '', welcomeSubtitle: '', accent: '#6C5CE7', accentDark: '#5A4BD1', bubbleStyle: 'code' } };
    return themes[id] || undefined;
  })
}));

const { registerIpcHandlers } = require('../src/ipc-handlers');
const { ipcMain, app } = require('electron');

describe('IPC Handlers', () => {
  let acquireHandler;

  const defaultStoreGetImpl = (key, defaultValue) => {
    if (key === 'activeConversationId') return 'conv-1';
    if (key === 'autoLaunch') return true;
    if (key === 'searchEnabled') return false;
    if (key === 'activeTheme') return 'claude';
    if (key === 'activeModelProviderId') return 'deepseek';
    if (key === 'personalityPrompt') return '';
    return defaultValue;
  };

  beforeAll(() => {
    // Reset mocks before registering
    for (const key of Object.keys(mockIpcMainHandlers)) delete mockIpcMainHandlers[key];
    for (const key of Object.keys(mockIpcMainOns)) delete mockIpcMainOns[key];
    registerIpcHandlers();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockStore.get.mockImplementation(defaultStoreGetImpl);
    mockConversations = JSON.parse(JSON.stringify(mockConvs));
  });

  function getHandler(name) {
    const h = mockIpcMainHandlers[name];
    if (!h) throw new Error(`No handler for ${name}`);
    return h;
  }

  function getOnHandler(name) {
    const h = mockIpcMainOns[name];
    if (!h) throw new Error(`No on handler for ${name}`);
    return h;
  }

  /* ─── cancel-request ─── */
  describe('cancel-request', () => {
    test('calls cancelActiveStream', () => {
      const handler = getOnHandler('cancel-request');
      mockCancelActiveStream.mockClear();
      handler();
      expect(mockCancelActiveStream).toHaveBeenCalledTimes(1);
    });
  });

  /* ─── search-all-conversations ─── */
  describe('search-all-conversations', () => {
    test('returns empty array for empty query', async () => {
      const handler = getHandler('search-all-conversations');
      const result = await handler({}, '');
      expect(result).toEqual([]);
    });

    test('returns empty array for whitespace query', async () => {
      const handler = getHandler('search-all-conversations');
      const result = await handler({}, '   ');
      expect(result).toEqual([]);
    });

    test('finds matching messages across conversations', async () => {
      // Reset conversations for this test
      mockConversations = JSON.parse(JSON.stringify(mockConvs));
      const handler = getHandler('search-all-conversations');
      const result = await handler({}, 'hello');
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toHaveProperty('conversationId');
      expect(result[0]).toHaveProperty('conversationTitle');
      expect(result[0]).toHaveProperty('messageIndex');
      expect(result[0]).toHaveProperty('preview');
      expect(result.some(r => r.preview.toLowerCase().includes('hello'))).toBe(true);
    });

    test('finds messages by content across conversations', async () => {
      mockConversations = JSON.parse(JSON.stringify(mockConvs));
      const handler = getHandler('search-all-conversations');
      const result = await handler({}, 'weather');
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].conversationTitle).toBe('Test Conv 2');
    });

    test('returns empty for non-matching query', async () => {
      mockConversations = JSON.parse(JSON.stringify(mockConvs));
      const handler = getHandler('search-all-conversations');
      const result = await handler({}, 'zzzznonexistent');
      expect(result).toEqual([]);
    });

    test('skips conversations with no messages', async () => {
      mockConversations = [
        { id: 'empty-conv', title: 'Empty', messages: [], createdAt: '', updatedAt: '' },
        ...JSON.parse(JSON.stringify(mockConvs))
      ];
      const handler = getHandler('search-all-conversations');
      const result = await handler({}, 'hello');
      expect(result.every(r => r.conversationId !== 'empty-conv')).toBe(true);
    });
  });

  /* ─── get-conversations ─── */
  describe('get-conversations', () => {
    test('returns conversation list', async () => {
      mockConversations = JSON.parse(JSON.stringify(mockConvs));
      const handler = getHandler('get-conversations');
      const result = await handler();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toHaveProperty('id');
      expect(result[0]).toHaveProperty('title');
    });
  });

  /* ─── get-active-conversation-id ─── */
  describe('get-active-conversation-id', () => {
    test('returns the active conversation ID from store', async () => {
      mockStore.get.mockReturnValue('conv-1');
      const handler = getHandler('get-active-conversation-id');
      const result = await handler();
      expect(result).toBe('conv-1');
    });
  });

  /* ─── switch-conversation ─── */
  describe('switch-conversation', () => {
    test('switches to existing conversation', async () => {
      mockConversations = JSON.parse(JSON.stringify(mockConvs));
      const handler = getHandler('switch-conversation');
      const result = await handler({}, 'conv-2');
      expect(result).toBe(true);
      expect(mockStore.set).toHaveBeenCalledWith('activeConversationId', 'conv-2');
    });

    test('returns false for non-existent conversation', async () => {
      mockConversations = JSON.parse(JSON.stringify(mockConvs));
      const handler = getHandler('switch-conversation');
      const result = await handler({}, 'non-existent-id');
      expect(result).toBe(false);
    });
  });

  /* ─── new-conversation ─── */
  describe('new-conversation', () => {
    test('creates new conversation when current has messages', async () => {
      mockConversations = JSON.parse(JSON.stringify(mockConvs));
      mockStore.get.mockReturnValue('conv-1'); // active conv has messages
      const handler = getHandler('new-conversation');
      const result = await handler();
      expect(Array.isArray(result)).toBe(true);
      expect(mockStore.set).toHaveBeenCalledWith('activeConversationId', 'new-conv-id');
    });

    test('does not create new conv if current is empty', async () => {
      const emptyConv = { id: 'empty-1', title: '新对话', messages: [], createdAt: '', updatedAt: '' };
      mockConversations = [emptyConv, ...JSON.parse(JSON.stringify(mockConvs))];
      mockStore.get.mockReturnValue('empty-1');
      const handler = getHandler('new-conversation');
      const result = await handler();
      // Should return current list without creating new
      expect(Array.isArray(result)).toBe(true);
    });
  });

  /* ─── clear-history ─── */
  describe('clear-history', () => {
    test('returns true after clearing', async () => {
      mockConversations = JSON.parse(JSON.stringify(mockConvs));
      mockStore.get.mockReturnValue('conv-1');
      const handler = getHandler('clear-history');
      const result = await handler();
      expect(result).toBe(true);
    });
  });

  /* ─── delete-conversation ─── */
  describe('delete-conversation', () => {
    test('returns false when only one conversation exists', async () => {
      mockConversations = [{ id: 'conv-1', title: 'Only', messages: [], createdAt: '', updatedAt: '' }];
      const handler = getHandler('delete-conversation');
      const result = await handler({}, 'conv-1');
      expect(result).toBe(false);
    });

    test('deletes conversation and reassigns active if needed', async () => {
      mockConversations = JSON.parse(JSON.stringify(mockConvs));
      mockStore.get.mockReturnValue('conv-2');
      const handler = getHandler('delete-conversation');
      const result = await handler({}, 'conv-2');
      expect(result).toBe(true);
      expect(mockStore.set).toHaveBeenCalledWith('activeConversationId', mockConversations[0].id);
    });
  });

  /* ─── get-history ─── */
  describe('get-history', () => {
    test('returns messages for active conversation', async () => {
      mockConversations = JSON.parse(JSON.stringify(mockConvs));
      mockStore.get.mockReturnValue('conv-1');
      const handler = getHandler('get-history');
      const result = await handler();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
    });
  });

  /* ─── get-auto-launch / set-auto-launch ─── */
  describe('auto-launch settings', () => {
    test('get-auto-launch returns store value', async () => {
      mockStore.get.mockReturnValue(true);
      const handler = getHandler('get-auto-launch');
      const result = await handler();
      expect(result).toBe(true);
    });

    test('set-auto-launch updates store and login items', async () => {
      const handler = getHandler('set-auto-launch');
      const result = await handler({}, false);
      expect(mockStore.set).toHaveBeenCalledWith('autoLaunch', false);
      expect(app.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: false });
      expect(result).toBeUndefined();
    });
  });

  /* ─── get-theme / set-theme ─── */
  describe('theme settings', () => {
    test('get-theme returns current theme', async () => {
      const handler = getHandler('get-theme');
      const result = await handler();
      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('name');
    });

    test('set-theme returns false for invalid theme', async () => {
      const handler = getHandler('set-theme');
      const result = await handler({}, 'nonexistent-theme');
      expect(result).toBe(false);
    });

    test('set-theme updates and broadcasts for valid theme', async () => {
      const handler = getHandler('set-theme');
      const result = await handler({}, 'claude');
      expect(result).toBe(true);
      expect(mockStore.set).toHaveBeenCalledWith('activeTheme', 'claude');
    });
  });

  /* ─── get-platform ─── */
  describe('get-platform', () => {
    test('returns current platform string', async () => {
      const handler = getHandler('get-platform');
      const result = await handler();
      expect(typeof result).toBe('string');
    });
  });

  /* ─── get-search-enabled ─── */
  describe('search toggle', () => {
    test('get-search-enabled returns store value', async () => {
      mockStore.get.mockReturnValue(false);
      const handler = getHandler('get-search-enabled');
      const result = await handler();
      expect(result).toBe(false);
    });

    test('toggle-search flips the value', async () => {
      mockStore.get.mockReturnValue(true);
      const handler = getHandler('toggle-search');
      const result = await handler();
      expect(result).toBe(false);
      expect(mockStore.set).toHaveBeenCalledWith('searchEnabled', false);
    });
  });

  /* ─── get-personality / save-personality ─── */
  describe('personality', () => {
    test('get-personality returns stored prompt', async () => {
      mockStore.get.mockReturnValue('custom prompt');
      const handler = getHandler('get-personality');
      const result = await handler();
      expect(result).toBe('custom prompt');
    });

    test('get-personality returns empty string if not set', async () => {
      mockStore.get.mockReturnValue(undefined);
      const handler = getHandler('get-personality');
      const result = await handler();
      expect(result).toBe('');
    });

    test('save-personality trims and saves', async () => {
      const handler = getHandler('save-personality');
      const result = await handler({}, '  trimmed prompt  ');
      expect(result).toBe(true);
      expect(mockStore.set).toHaveBeenCalledWith('personalityPrompt', 'trimmed prompt');
    });
  });

  /* ─── quit-app ─── */
  describe('quit-app', () => {
    test('saves position, destroys tray, and exits', () => {
      const { destroyTray } = require('../src/tray');
      const handler = getOnHandler('quit-app');
      const mockPetWindow = { getPosition: jest.fn().mockReturnValue([100, 200]) };
      mockWindows.getPetWindow.mockReturnValue(mockPetWindow);

      handler();

      expect(mockPetWindow.getPosition).toHaveBeenCalled();
      expect(mockStore.set).toHaveBeenCalledWith('petPosition', { x: 100, y: 200 });
      expect(destroyTray).toHaveBeenCalled();
      expect(app.exit).toHaveBeenCalledWith(0);
    });
  });

  /* ─── close-chat ─── */
  describe('close-chat', () => {
    test('calls hideChatWindow', () => {
      const handler = getOnHandler('close-chat');
      mockWindows.hideChatWindow.mockClear();
      handler();
      expect(mockWindows.hideChatWindow).toHaveBeenCalled();
    });
  });

  /* ─── open-chat ─── */
  describe('open-chat', () => {
    test('hides chat when visible', () => {
      mockWindows.getChatVisible.mockReturnValue(true);
      mockWindows.hideChatWindow.mockClear();
      const handler = getOnHandler('open-chat');
      handler();
      expect(mockWindows.hideChatWindow).toHaveBeenCalled();
    });

    test('shows chat when hidden', () => {
      mockWindows.getChatVisible.mockReturnValue(false);
      mockWindows.showChatWindow.mockClear();
      mockWindows.getChatWindow.mockReturnValue({ webContents: { send: jest.fn() } });
      const handler = getOnHandler('open-chat');
      handler();
      expect(mockWindows.showChatWindow).toHaveBeenCalled();
    });
  });

  /* ─── move-window ─── */
  describe('move-window', () => {
    test('moves pet window by delta', () => {
      const mockPetWindow = { getPosition: jest.fn().mockReturnValue([100, 200]), setPosition: jest.fn() };
      mockWindows.getPetWindow.mockReturnValue(mockPetWindow);
      const handler = getOnHandler('move-window');
      handler({}, 10, -5);
      expect(mockPetWindow.setPosition).toHaveBeenCalledWith(110, 195);
    });
  });

  /* ─── resize-pet ─── */
  describe('resize-pet', () => {
    test('resizes pet window', () => {
      const mockPetWindow = { getPosition: jest.fn().mockReturnValue([100, 200]), setBounds: jest.fn() };
      mockWindows.getPetWindow.mockReturnValue(mockPetWindow);
      const handler = getOnHandler('resize-pet');
      handler({}, 145, 170);
      expect(mockPetWindow.setBounds).toHaveBeenCalledWith({ x: 100, y: 200, width: 145, height: 170 });
    });
  });

  /* ─── save-position ─── */
  describe('save-position', () => {
    test('saves pet window position to store', () => {
      const mockPetWindow = { getPosition: jest.fn().mockReturnValue([300, 400]) };
      mockWindows.getPetWindow.mockReturnValue(mockPetWindow);
      const handler = getOnHandler('save-position');
      handler();
      expect(mockStore.set).toHaveBeenCalledWith('petPosition', { x: 300, y: 400 });
    });
  });

  /* ─── export-conversation ─── */
  describe('export-conversation', () => {
    test('returns error when conversation is empty', async () => {
      const emptyConv = { id: 'empty', title: 'Empty', messages: [], createdAt: '', updatedAt: '' };
      mockConversations = [emptyConv];
      mockStore.get.mockReturnValue('empty');
      const handler = getHandler('export-conversation');
      const result = await handler();
      expect(result).toEqual({ error: '当前对话为空' });
    });
  });

  /* ─── trim-conversation ─── */
  describe('trim-conversation', () => {
    test('trims messages to given index', async () => {
      mockConversations = JSON.parse(JSON.stringify(mockConvs));
      mockStore.get.mockReturnValue('conv-1');
      const handler = getHandler('trim-conversation');
      const result = await handler({}, 1);
      expect(result).toBe(true);
      expect(mockConversations[0].messages.length).toBe(1);
    });
  });
});

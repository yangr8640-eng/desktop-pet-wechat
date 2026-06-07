// chat-core.js — DOM element references, shared state, utility functions

window.Chat = window.Chat || {};
(function() {
  const C = window.Chat;

  // ─── DOM Element References ───
  C.elements = {
    messagesArea: document.getElementById('messagesArea'),
    chatInput: document.getElementById('chatInput'),
    sendBtn: document.getElementById('sendBtn'),
    searchToggle: document.getElementById('searchToggle'),
    autoLaunchToggle: document.getElementById('autoLaunchToggle'),
    searchHeaderBtn: document.getElementById('searchHeaderBtn'),
    settingsBtn: document.getElementById('settingsBtn'),
    settingsPanel: document.getElementById('settingsPanel'),
    apiKeyInput: document.getElementById('apiKeyInput'),
    saveKeyBtn: document.getElementById('saveKeyBtn'),
    newChatBtn: document.getElementById('newChatBtn'),
    closeBtn: document.getElementById('closeBtn'),
    quitBtn: document.getElementById('quitBtn'),
    conversationDropdown: document.getElementById('conversationDropdown'),
    dropdownToggle: document.getElementById('dropdownToggle'),
    dropdownList: document.getElementById('dropdownList'),
    importBtn: document.getElementById('importBtn'),
    personalityInput: document.getElementById('personalityInput'),
    savePersonalityBtn: document.getElementById('savePersonalityBtn'),
    exportSettingsBtn: document.getElementById('exportSettingsBtn'),
    themeSelect: document.getElementById('themeSelect'),
    headerIcon: document.getElementById('headerIcon'),
    headerTitle: document.getElementById('headerTitle'),
    modelSelect: document.getElementById('modelSelect'),
    modelNameInput: document.getElementById('modelNameInput'),
    modelUrlInput: document.getElementById('modelUrlInput'),
    modelModelIdInput: document.getElementById('modelModelIdInput'),
    modelInfo: document.getElementById('modelInfo'),
    keyValidation: document.getElementById('keyValidation'),
    addModelBtn: document.getElementById('addModelBtn'),
    deleteModelBtn: document.getElementById('deleteModelBtn'),
    modelCustomFields: document.getElementById('modelCustomFields'),
    apiKeyLabel: document.getElementById('apiKeyLabel'),
    updateBanner: document.getElementById('updateBanner'),
    updateBannerText: document.getElementById('updateBannerText'),
    updateBannerBtn: document.getElementById('updateBannerBtn'),
    updateBannerDismiss: document.getElementById('updateBannerDismiss'),
    globalSearchOverlay: document.getElementById('globalSearchOverlay'),
    globalSearchInput: document.getElementById('globalSearchInput'),
    globalSearchResults: document.getElementById('globalSearchResults'),
    wechatLoginBtn: document.getElementById('wechatLoginBtn'),
    wechatStatusDot: document.getElementById('wechatStatusDot'),
    wechatStatusText: document.getElementById('wechatStatusText'),
    wechatUserId: document.getElementById('wechatUserId'),
    wechatQRContainer: document.getElementById('wechatQRContainer'),
    wechatQRImage: document.getElementById('wechatQRImage'),
    wechatQRHint: document.getElementById('wechatQRHint'),
    wechatDisconnectBtn: document.getElementById('wechatDisconnectBtn')
  };

  // ─── Shared State ───
  C.state = {
    isLoading: false,
    isSearchEnabled: false,
    isSwitchingConversation: false,
    currentModelProvider: null,
    modelProviders: [],
    streamCleanup: null,
    currentWelcomeEmoji: '💠',  // 💠
    currentWelcomeGreeting: 'Hello! 我是Claude。💠',
    currentWelcomeSubtitle: '有什么我可以帮你的？用代码说话也行，用自然语言聊天也可以~',
    resize: { isResizing: false, dir: null, start: {} }
  };

  // ─── Typing Indicator (singleton) ───
  function createTypingIndicatorEl() {
    const el = document.createElement('div');
    el.className = 'typing-dots';
    el.id = 'typingDots';
    el.innerHTML = '<span></span><span></span><span></span>';
    C.elements.messagesArea.appendChild(el);
    return el;
  }
  C.elements.typingDots = document.getElementById('typingDots') || createTypingIndicatorEl();

  // ─── Utility Functions ───
  C.hexToRgb = function(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`
      : '255, 179, 71';
  };

  C.escapeHtml = function(str) {
    return str
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };
})();

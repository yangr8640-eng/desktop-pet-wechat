// chat.js — Bootstrap init, global event handlers, resize

window.Chat = window.Chat || {};
(function() {
  const C = window.Chat;

  /* ─── Init ─── */
  C.init = async function() {
    // Load model providers
    await C.loadModelProviders();

    // Validate active model's API key on startup
    try {
      if (C.state.currentModelProvider) {
        const validation = await window.petAPI.validateModelApiKey(C.state.currentModelProvider.id);
        if (!validation.valid) {
          C.showApiKeyWarning(validation.reason);
        }
      }
    } catch {
      // IPC itself fails — don't block
    }

    // Load personality
    const personality = await window.petAPI.getPersonality();
    C.elements.personalityInput.value = personality;

    // Load and apply current theme
    const theme = await window.petAPI.getTheme();
    C.applyTheme(theme);

    // Load conversations
    await C.refreshConversationSelect();
    await C.loadConversationMessages();

    // Search toggle
    await C.initSearchToggle();

    // Windows platform class
    const platform = await window.petAPI.getPlatform();
    if (platform === 'win32') {
      document.body.classList.add('win32');
    }

    // External message updates (e.g., file drop analysis)
    window.petAPI.onMessagesUpdated(async () => {
      await C.loadConversationMessages();
      await C.refreshConversationSelect();
    });

    // Theme change listener
    window.petAPI.onThemeChanged((theme) => {
      C.applyTheme(theme);
      const messagesArea = C.elements.messagesArea;
      const typingDots = C.elements.typingDots;
      if (messagesArea.querySelector('.welcome-msg')) {
        const sub = messagesArea.querySelector('.welcome-sub');
        messagesArea.innerHTML = C.renderWelcomeMessage(sub ? sub.textContent : '');
        messagesArea.appendChild(typingDots);
      }
    });

    // Focus input listener
    window.petAPI.onFocusInput(() => {
      C.elements.chatInput.focus();
      setTimeout(() => {
        C.elements.messagesArea.scrollTop = C.elements.messagesArea.scrollHeight;
      }, 100);
    });

    // Auto-update listeners
    C.setupUpdateListeners();
  };

  /* ─── New chat, close, quit ─── */
  function initGlobalHandlers() {
    C.elements.newChatBtn.addEventListener('click', async () => {
      await window.petAPI.newConversation();
      await C.refreshConversationSelect();
      const messagesArea = C.elements.messagesArea;
      const typingDots = C.elements.typingDots;
      messagesArea.innerHTML = C.renderWelcomeMessage('有什么想聊的吗？');
      messagesArea.appendChild(typingDots);
    });

    C.elements.closeBtn.addEventListener('click', () => {
      window.petAPI.minimizeChat();
    });

    C.elements.quitBtn.addEventListener('click', () => {
      window.petAPI.quitApp();
    });
  }

  /* ─── Resize handles ─── */
  function initResizeHandlers() {
    const rs = C.state.resize;
    const MIN_WIDTH = 420;

    function getMinHeight() {
      return Math.round(screen.availHeight * 0.7);
    }

    document.querySelectorAll('.resize-handle').forEach(handle => {
      handle.addEventListener('mousedown', (e) => {
        rs.isResizing = true;
        rs.dir = handle.dataset.resize;
        rs.start = {
          x: e.screenX,
          y: e.screenY,
          width: window.innerWidth,
          height: window.innerHeight
        };
        e.preventDefault();
        e.stopPropagation();
      });
    });

    document.addEventListener('mousemove', (e) => {
      if (!rs.isResizing) return;

      const dx = e.screenX - rs.start.x;
      const dy = e.screenY - rs.start.y;
      const minH = getMinHeight();

      let newWidth = rs.start.width;
      let newHeight = rs.start.height;

      if (rs.dir.includes('e')) newWidth = Math.max(MIN_WIDTH, rs.start.width + dx);
      if (rs.dir.includes('w')) newWidth = Math.max(MIN_WIDTH, rs.start.width - dx);
      if (rs.dir.includes('s')) newHeight = Math.max(minH, rs.start.height + dy);

      window.petAPI.resizeWindow(newWidth, newHeight);
    });

    document.addEventListener('mouseup', () => {
      rs.isResizing = false;
      rs.dir = null;
    });
  }

  // Wire everything up
  initGlobalHandlers();
  C.initConversationDropdown();
  C.initInputHandlers();
  C.initSettingsHandlers();
  C.initGlobalSearch();
  C.initWechatSettings();
  initResizeHandlers();

  // Bootstrap
  C.init();
})();

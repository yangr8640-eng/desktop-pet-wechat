// chat-wechat-settings.js — WeChat Clawbot connection settings panel (QR login)

window.Chat = window.Chat || {};
(function() {
  const C = window.Chat;

  let connectedAccountId = null;

  C.initWechatSettings = async function() {
    const els = C.elements;
    if (!els.wechatLoginBtn) return;

    // Check current status on init
    await refreshWechatStatus();

    // ─── Connect button ───
    els.wechatLoginBtn.addEventListener('click', async () => {
      els.wechatLoginBtn.disabled = true;
      els.wechatLoginBtn.textContent = '⏳ 正在获取二维码...';
      els.wechatQRContainer.style.display = 'none';

      // Show QR container (empty for now)
      els.wechatQRContainer.style.display = 'block';
      els.wechatQRImage.style.display = 'none';
      els.wechatQRHint.textContent = '正在获取二维码...';

      try {
        const result = await window.petAPI.wechatLogin();
        if (!result.success) {
          els.wechatQRHint.textContent = `登录失败: ${result.error}`;
          els.wechatQRContainer.style.display = 'none';
          els.wechatLoginBtn.disabled = false;
          els.wechatLoginBtn.textContent = '📱 扫码登录';
        }
      } catch (err) {
        els.wechatQRHint.textContent = `登录异常: ${err.message}`;
        els.wechatLoginBtn.disabled = false;
        els.wechatLoginBtn.textContent = '📱 扫码登录';
      }
    });

    // ─── Disconnect button ───
    els.wechatDisconnectBtn.addEventListener('click', async () => {
      els.wechatDisconnectBtn.disabled = true;
      els.wechatDisconnectBtn.textContent = '⏳ ...';
      try {
        await window.petAPI.wechatDisconnect();
        updateWechatUI({ status: 'disconnected' });
      } catch (err) {
        console.error('[WechatSettings] Disconnect error:', err);
      }
      els.wechatDisconnectBtn.disabled = false;
      els.wechatDisconnectBtn.textContent = '断开连接';
    });

    // ─── Listen for wechat events from main process ───
    setupEventListeners();
  };

  function setupEventListeners() {
    // QR code received (data URL — no CORS issues)
    window.petAPI.onWechatEvent('wechat-qr-code', (data) => {
      const els = C.elements;
      const qrSrc = data.qrcodeDataUrl || data.qrcodeUrl;
      if (qrSrc) {
        els.wechatQRImage.src = qrSrc;
        els.wechatQRImage.style.display = 'block';
        els.wechatQRHint.textContent = '请使用微信扫描二维码';
        els.wechatQRContainer.style.display = 'block';
        els.wechatLoginBtn.textContent = '🔄 等待扫码...';
        els.wechatLoginBtn.disabled = true;
      } else {
        // No image URL — show the QR code as text link
        els.wechatQRImage.style.display = 'none';
        els.wechatQRHint.innerHTML = `请在浏览器中打开: <br><a href="${qrSrc || data.qrcode}" target="_blank">二维码链接</a>`;
        els.wechatQRContainer.style.display = 'block';
      }
    });

    // QR scanned
    window.petAPI.onWechatEvent('wechat-qr-scanned', () => {
      C.elements.wechatQRHint.textContent = '已扫描，请在微信中确认登录...';
    });

    // Connected
    window.petAPI.onWechatEvent('wechat-connected', (data) => {
      connectedAccountId = data.accountId;
      updateWechatUI({
        status: 'connected',
        accountId: data.accountId,
        userId: data.userId,
      });
    });

    // Connecting
    window.petAPI.onWechatEvent('wechat-connecting', () => {
      updateWechatUI({ status: 'connecting' });
    });

    // Disconnected
    window.petAPI.onWechatEvent('wechat-disconnected', (data) => {
      connectedAccountId = null;
      updateWechatUI({ status: 'disconnected' });
      if (data && data.reason) {
        C.elements.wechatQRHint.textContent = data.reason;
      }
    });

    // Login error
    window.petAPI.onWechatEvent('wechat-login-error', (data) => {
      updateWechatUI({ status: 'disconnected' });
      C.elements.wechatQRHint.textContent = `登录失败: ${data.error}`;
      C.elements.wechatQRContainer.style.display = 'block';
    });
  }

  async function refreshWechatStatus() {
    try {
      const status = await window.petAPI.wechatStatus();
      if (status && status.status === 'connected') {
        connectedAccountId = status.accountId;
        updateWechatUI({
          status: 'connected',
          accountId: status.accountId,
          userId: status.userId,
        });
      } else {
        updateWechatUI({ status: status ? status.status : 'disconnected' });
      }
    } catch (err) {
      updateWechatUI({ status: 'disconnected' });
    }
  }

  function updateWechatUI(state) {
    const els = C.elements;
    if (!els.wechatStatusDot) return;

    switch (state.status) {
      case 'connected':
        els.wechatStatusDot.className = 'wechat-status-dot connected';
        els.wechatStatusText.textContent = '已连接';
        els.wechatUserId.textContent = state.accountId
          ? `(${state.accountId.slice(0, 12)}...)`
          : '';
        els.wechatLoginBtn.style.display = 'none';
        els.wechatDisconnectBtn.style.display = '';
        els.wechatDisconnectBtn.disabled = false;
        els.wechatDisconnectBtn.textContent = '断开连接';
        els.wechatQRContainer.style.display = 'none';
        els.wechatLoginBtn.disabled = false;
        els.wechatLoginBtn.textContent = '📱 扫码登录';
        break;

      case 'connecting':
        els.wechatStatusDot.className = 'wechat-status-dot connecting';
        els.wechatStatusText.textContent = '连接中...';
        els.wechatUserId.textContent = '';
        els.wechatLoginBtn.style.display = 'none';
        els.wechatDisconnectBtn.style.display = '';
        els.wechatDisconnectBtn.textContent = '取消';
        els.wechatLoginBtn.disabled = true;
        break;

      case 'disconnected':
      default:
        els.wechatStatusDot.className = 'wechat-status-dot disconnected';
        els.wechatStatusText.textContent = '未连接';
        els.wechatUserId.textContent = '';
        els.wechatLoginBtn.style.display = '';
        els.wechatDisconnectBtn.style.display = 'none';
        els.wechatQRContainer.style.display = 'none';
        els.wechatLoginBtn.disabled = false;
        els.wechatLoginBtn.textContent = '📱 扫码登录';
        break;
    }
  }

  // Auto-init when DOM ready
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(() => {
      if (C.elements && C.elements.wechatLoginBtn && !C._wechatInited) {
        C._wechatInited = true;
        C.initWechatSettings();
      }
    }, 300);
  }

  // Also hook into settings panel display
  const settingsPanel = document.getElementById('settingsPanel');
  if (settingsPanel) {
    const observer = new MutationObserver(() => {
      if (C.elements && C.elements.wechatLoginBtn && !C._wechatInited) {
        C._wechatInited = true;
        C.initWechatSettings();
      }
    });
    observer.observe(settingsPanel, { attributes: true, attributeFilter: ['style', 'class'] });
  }
})();

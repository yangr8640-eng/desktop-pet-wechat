const { BrowserWindow, screen } = require('electron');
const path = require('path');
const { store } = require('./store');
const { cancelActiveStream } = require('./ai');

const isMac = process.platform === 'darwin';

let petWindow = null;
let chatWindow = null;
let isChatVisible = false;
let chatWidth = 420;
let chatHeight = 400;
let savedChatBounds = null;
let ignoreBlurUntil = 0;
let animTimer = null;
let isQuitting = false;

function getPetWindow() { return petWindow; }
function getChatWindow() { return chatWindow; }
function getChatVisible() { return isChatVisible; }

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
    ...(isMac && { type: 'panel' }),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  petWindow.loadFile('pet/pet.html');
  if (isMac) {
    petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } else {
    petWindow.setVisibleOnAllWorkspaces(true);
  }
  petWindow.on('closed', () => { petWindow = null; });
}

function createChatWindow() {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  chatWidth = 420;
  chatHeight = Math.round(screenHeight * 0.8);
  const chatY = Math.round((screenHeight - chatHeight) / 2);

  chatWindow = new BrowserWindow({
    width: chatWidth,
    height: chatHeight,
    x: screenWidth,
    y: chatY,
    frame: false,
    resizable: true,
    minWidth: 420,
    minHeight: chatHeight,
    skipTaskbar: false,
    show: false,
    alwaysOnTop: true,
    hasShadow: true,
    ...(isMac
      ? {
          vibrancy: 'sidebar',
          backgroundColor: '#00000000'
        }
      : {
          backgroundColor: '#1a1a1c'
        }
    ),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  chatWindow.loadFile('chat/chat.html');
  if (isMac) {
    chatWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } else {
    chatWindow.setVisibleOnAllWorkspaces(true);
  }

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

function showChatWindow() {
  if (isChatVisible) return;
  isChatVisible = true;

  // Cancel any in-progress hide animation
  if (animTimer) { clearTimeout(animTimer); animTimer = null; }

  if (savedChatBounds) {
    chatWidth = savedChatBounds.width;
    chatHeight = savedChatBounds.height;
  }

  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

  // Position near pet window
  const pw = getPetWindow();
  let targetX, targetY, startX;
  const gap = 12;

  if (pw) {
    const pb = pw.getBounds();
    // Place to right of pet, or left if not enough room, or fallback to screen right
    if (pb.x + pb.width + gap + chatWidth <= screenWidth) {
      targetX = pb.x + pb.width + gap;
    } else if (pb.x - gap - chatWidth >= 0) {
      targetX = pb.x - gap - chatWidth;
    } else {
      targetX = screenWidth - chatWidth;
    }
    targetY = Math.round(pb.y + (pb.height - chatHeight) / 2);
    targetY = Math.max(0, Math.min(targetY, screenHeight - chatHeight));
    startX = pb.x + Math.round(pb.width / 2);
  } else {
    targetX = screenWidth - chatWidth;
    targetY = Math.round((screenHeight - chatHeight) / 2);
    startX = screenWidth;
  }

  chatWindow.setBounds({ x: startX, y: targetY, width: chatWidth, height: chatHeight });
  chatWindow.show();
  chatWindow.focus();
  ignoreBlurUntil = Date.now() + 400;

  const duration = 280;
  const startTime = Date.now();
  const step = () => {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    chatWindow.setBounds({
      x: Math.round(startX + (targetX - startX) * eased),
      y: targetY,
      width: chatWidth,
      height: chatHeight
    });
    if (progress < 1) {
      animTimer = setTimeout(step, 10);
    }
  };
  step();
}

function hideChatWindow() {
  if (!isChatVisible) return;
  isChatVisible = false;
  cancelActiveStream();

  // Cancel any in-progress show animation
  if (animTimer) { clearTimeout(animTimer); animTimer = null; }

  savedChatBounds = chatWindow.getBounds();
  chatWidth = savedChatBounds.width;
  chatHeight = savedChatBounds.height;

  // Animate toward pet position, or off-screen right if no pet
  const pw = getPetWindow();
  let endX;
  if (pw) {
    endX = pw.getBounds().x + Math.round(pw.getBounds().width / 2);
  } else {
    endX = screen.getPrimaryDisplay().workAreaSize.width;
  }

  const startX = savedChatBounds.x;
  const chatY = savedChatBounds.y;

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
      animTimer = setTimeout(step, 10);
    } else {
      chatWindow.hide();
    }
  };
  step();
}

function setQuitting() { isQuitting = true; }

module.exports = {
  getPetWindow,
  getChatWindow,
  getChatVisible,
  createPetWindow,
  createChatWindow,
  showChatWindow,
  hideChatWindow,
  setQuitting
};

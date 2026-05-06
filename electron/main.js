const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const isDev = require('electron-is-dev');

let mainWindow;
const chatWindows = new Map(); // chatId → BrowserWindow

// WhatsApp & Telegram bridge (wrapped in try-catch so a missing dep won't crash the whole app)
let whatsappBridge, telegramBridge;
try { whatsappBridge = require('./whatsapp-bridge'); } catch (e) {
  console.error('[WA bridge load]', e.message);
  whatsappBridge = { init(){}, getQR:()=>null, getChats:()=>[], getMessages:()=>[], sendMessage(){}, getStatus:()=>'error' };
}
try { telegramBridge = require('./telegram-bridge'); } catch (e) {
  console.error('[TG bridge load]', e.message);
  telegramBridge = { init(){}, requestCode(){}, signIn(){}, startQRLogin(){}, submit2FA(){}, getStatus:()=>'error', getDialogs:()=>[], getMessages:()=>[], sendMessage(){} };
}

// ── Dev URL helper ────────────────────────────────────────────
function devUrl(params = '') {
  return isDev
    ? `http://localhost:3000${params ? '?' + params : ''}`
    : `file://${path.join(__dirname, '../build/index.html')}${params ? '?' + params : ''}`;
}

// ── Main contact-list window ─────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width:    270,
    height:   580,
    minWidth: 240,
    minHeight: 420,
    maxWidth: 360,
    frame: false,
    resizable: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    title: 'ICQ Messenger',
  });

  mainWindow.loadURL(devUrl());

  mainWindow.on('closed', () => {
    // Close all open chat windows when main window is closed
    chatWindows.forEach(win => { if (!win.isDestroyed()) win.close(); });
    chatWindows.clear();
    mainWindow = null;
  });
}

app.on('ready', async () => {
  createWindow();
  try { await whatsappBridge.init(); } catch (e) { console.error('[WA init]', e.message); }
  try { await telegramBridge.init(); } catch (e) { console.error('[TG init]', e.message); }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});

// ── IPC: Open separate chat window (ICQ 5 style) ─────────────
ipcMain.handle('open-chat', async (e, { chatId, chatName, service }) => {
  // Focus existing window if already open
  if (chatWindows.has(chatId)) {
    const existing = chatWindows.get(chatId);
    if (!existing.isDestroyed()) { existing.focus(); return; }
  }

  const chatWin = new BrowserWindow({
    width:    520,
    height:   440,
    minWidth: 380,
    minHeight: 300,
    frame: false,
    resizable: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    title: chatName || 'Chat',
  });

  const params = new URLSearchParams({ mode: 'chat', chatId, chatName: chatName || '', service }).toString();
  chatWin.loadURL(devUrl(params));
  chatWindows.set(chatId, chatWin);
  chatWin.on('closed', () => chatWindows.delete(chatId));
});

// ── IPC: WhatsApp ─────────────────────────────────────────────
ipcMain.handle('wa:get-qr',       async ()             => whatsappBridge.getQR());
ipcMain.handle('wa:get-chats',    async ()             => whatsappBridge.getChats());
ipcMain.handle('wa:get-messages', async (e, chatId)    => whatsappBridge.getMessages(chatId));
ipcMain.handle('wa:send-message', async (e, id, text)  => whatsappBridge.sendMessage(id, text));
ipcMain.handle('wa:status',       async ()             => whatsappBridge.getStatus());

// ── IPC: Telegram ─────────────────────────────────────────────
ipcMain.handle('tg:request-code',   async (e, phone)            => telegramBridge.requestCode(phone));
ipcMain.handle('tg:sign-in',        async (e, phone, code, hash)=> telegramBridge.signIn(phone, code, hash));
ipcMain.handle('tg:start-qr-login', async ()                    => telegramBridge.startQRLogin());
ipcMain.handle('tg:2fa-password',   async (e, password)         => telegramBridge.submit2FA(password));
ipcMain.handle('tg:get-dialogs',    async ()                    => telegramBridge.getDialogs());
ipcMain.handle('tg:get-messages',   async (e, chatId)           => telegramBridge.getMessages(chatId));
ipcMain.handle('tg:send-message',   async (e, chatId, text)     => telegramBridge.sendMessage(chatId, text));
ipcMain.handle('tg:status',         async ()                    => telegramBridge.getStatus());

// ── IPC: Window controls ──────────────────────────────────────
ipcMain.on('window:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize());
ipcMain.on('window:close',    (e) => BrowserWindow.fromWebContents(e.sender)?.close());


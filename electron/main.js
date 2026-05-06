const { app, BrowserWindow, ipcMain, shell, dialog, clipboard, Menu, MenuItem } = require('electron');
const path = require('path');
const isDev = require('electron-is-dev');

// ── Portable: redirect userData to folder next to .exe ───────
if (process.env.PORTABLE_EXECUTABLE_DIR) {
  app.setPath('userData', path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'ICQ-Data'));
}

let mainWindow;
const chatWindows = new Map(); // chatId → BrowserWindow
const avatarStore  = new Map(); // chatId → avatar data URL

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
    icon: path.join(__dirname, '../public/icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    title: 'ICQ Messenger',
  });

  mainWindow.loadURL(devUrl());
  wireExternalLinks(mainWindow);

  mainWindow.on('closed', () => {
    // Close all open chat windows when main window is closed
    chatWindows.forEach(win => { if (!win.isDestroyed()) win.close(); });
    chatWindows.clear();
    mainWindow = null;
  });
}

app.on('ready', async () => {
  createWindow();
  // Dev: use local ./data dir. Packaged: use userData (installer → %APPDATA%, portable → next to exe)
  const dataDir = isDev
    ? path.join(__dirname, '../data')
    : app.getPath('userData');
  const cacheAvatar = (id, avatar) => { if (id && avatar) avatarStore.set(String(id), avatar); };
  try { await whatsappBridge.init(cacheAvatar, dataDir); } catch (e) { console.error('[WA init]', e.message); }
  try { await telegramBridge.init(null, cacheAvatar, dataDir); } catch (e) { console.error('[TG init]', e.message); }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});

// ── IPC: Open separate chat window (ICQ 5 style) ─────────────
ipcMain.handle('open-chat', async (e, { chatId, chatName, service, avatar }) => {
  if (avatar) avatarStore.set(chatId, avatar);
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
    icon: path.join(__dirname, '../public/icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    title: chatName || 'Chat',
  });

  const params = new URLSearchParams({ mode: 'chat', chatId, chatName: chatName || '', service }).toString();
  chatWin.loadURL(devUrl(params));
  wireExternalLinks(chatWin);
  chatWindows.set(chatId, chatWin);
  chatWin.on('closed', () => chatWindows.delete(chatId));
});

// ── IPC: WhatsApp ─────────────────────────────────────────────
ipcMain.handle('get-stored-avatar', async (e, id) => {
  if (!id) return null;
  return avatarStore.get(String(id)) || null;
});
ipcMain.handle('wa:get-qr',       async ()             => whatsappBridge.getQR());
ipcMain.handle('wa:get-chats',    async ()             => whatsappBridge.getChats());
ipcMain.handle('wa:get-messages', async (e, chatId)    => whatsappBridge.getMessages(chatId));
ipcMain.handle('wa:send-message', async (e, id, text)  => whatsappBridge.sendMessage(id, text));
ipcMain.handle('wa:send-file',    async (e, id, path)  => whatsappBridge.sendFile(id, path));
ipcMain.handle('wa:mark-read',    async (e, id)        => whatsappBridge.markChatRead(id));
ipcMain.handle('wa:status',       async ()             => whatsappBridge.getStatus());
ipcMain.handle('wa:get-my-profile', async ()           => whatsappBridge.getMyProfile());
ipcMain.handle('wa:get-avatar',   async (e, id)        => whatsappBridge.getContactAvatar(id));
ipcMain.handle('wa:logout',       async ()             => whatsappBridge.logout());

// ── IPC: Telegram ─────────────────────────────────────────────
ipcMain.handle('tg:request-code',   async (e, phone)            => telegramBridge.requestCode(phone));
ipcMain.handle('tg:sign-in',        async (e, phone, code, hash)=> telegramBridge.signIn(phone, code, hash));
ipcMain.handle('tg:start-qr-login', async ()                    => telegramBridge.startQRLogin());
ipcMain.handle('tg:2fa-password',   async (e, password)         => telegramBridge.submit2FA(password));
ipcMain.handle('tg:get-dialogs',    async ()                    => telegramBridge.getDialogs());
ipcMain.handle('tg:get-messages',   async (e, chatId)           => telegramBridge.getMessages(chatId));
ipcMain.handle('tg:send-message',   async (e, chatId, text)     => telegramBridge.sendMessage(chatId, text));
ipcMain.handle('tg:send-file',      async (e, chatId, path)     => telegramBridge.sendFile(chatId, path));
ipcMain.handle('tg:mark-read',      async (e, chatId)           => telegramBridge.markChatRead(chatId));
ipcMain.handle('tg:status',         async ()                    => telegramBridge.getStatus());
ipcMain.handle('tg:get-me',         async ()                    => telegramBridge.getMe());
ipcMain.handle('tg:get-avatar',     async (e, id)               => telegramBridge.getContactAvatar(id));
ipcMain.handle('tg:logout',         async ()                    => telegramBridge.logout());
ipcMain.handle('tg:set-credentials',async (e, apiId, apiHash)   => telegramBridge.setCredentials(apiId, apiHash));

// ── IPC: Window controls ──────────────────────────────────────
ipcMain.on('window:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize());
ipcMain.on('window:maximize', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win?.isMaximized()) win.unmaximize(); else win?.maximize();
});
ipcMain.on('window:close',    (e) => BrowserWindow.fromWebContents(e.sender)?.close());

ipcMain.handle('open-file-dialog', async () => {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [
      { name: 'Alle Dateien', extensions: ['*'] },
      { name: 'Bilder', extensions: ['jpg','jpeg','png','gif','webp','bmp'] },
      { name: 'Videos', extensions: ['mp4','mov','avi','mkv','webm'] },
      { name: 'Dokumente', extensions: ['pdf','doc','docx','xls','xlsx','txt','zip'] },
    ],
  });
  return result.canceled ? null : result.filePaths[0];
});

// ── IPC: Open URL in default browser ────────────────────────
ipcMain.on('open-external', (e, url) => {
  if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
    shell.openExternal(url);
  }
});

// Helper: intercept any navigation / new-window to redirect to default browser
function wireExternalLinks(win) {
  win.webContents.on('will-navigate', (e, url) => {
    const local = devUrl();
    if (!url.startsWith(local)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Native right-click context menu (cut / copy / paste / select all)
  win.webContents.on('context-menu', (e, params) => {
    const menu = new Menu();
    if (params.linkURL) {
      menu.append(new MenuItem({ label: 'Link kopieren', click: () => clipboard.writeText(params.linkURL) }));
      menu.append(new MenuItem({ label: 'Link öffnen', click: () => shell.openExternal(params.linkURL) }));
      menu.append(new MenuItem({ type: 'separator' }));
    }
    if (params.isEditable) {
      menu.append(new MenuItem({ label: 'Ausschneiden',  role: 'cut',       enabled: params.selectionText.length > 0 }));
    }
    if (params.selectionText.length > 0 || params.isEditable) {
      menu.append(new MenuItem({ label: 'Kopieren',      role: 'copy',      enabled: params.selectionText.length > 0 }));
    }
    if (params.isEditable) {
      menu.append(new MenuItem({ label: 'Einfügen',      role: 'paste' }));
      menu.append(new MenuItem({ type: 'separator' }));
      menu.append(new MenuItem({ label: 'Alles markieren', role: 'selectAll' }));
    }
    if (menu.items.length > 0) menu.popup({ window: win });
  });
}

// Broadcast a sent message to all other windows (so sidebar updates immediately)
ipcMain.on('chat:sent', (e, msg) => {
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed() && w.webContents !== e.sender)
      w.webContents.send('chat:sent-broadcast', msg);
  });
});


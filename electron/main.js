const { app, BrowserWindow, ipcMain, shell, dialog, clipboard, Menu, MenuItem } = require('electron');
const path = require('path');
const os   = require('os');
const fs   = require('fs');
const isDev = require('electron-is-dev');

const STARTUP_LOG = path.join(os.tmpdir(), 'icq-startup.log');
function logStartup(msg, err) {
  try {
    const detail = err ? ` | ${err.stack || err.message || String(err)}` : '';
    fs.appendFileSync(STARTUP_LOG, `[${new Date().toISOString()}] ${msg}${detail}\n`, 'utf8');
  } catch (e) {}
}

function wireWindowDiagnostics(win, label) {
  const safeLabel = label || 'window';
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    logStartup(`${safeLabel} did-fail-load code=${code} desc=${desc} url=${url}`);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    logStartup(`${safeLabel} render-process-gone reason=${details?.reason} exitCode=${details?.exitCode}`);
  });
  win.webContents.on('unresponsive', () => {
    logStartup(`${safeLabel} unresponsive`);
  });
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) logStartup(`${safeLabel} console level=${level} ${sourceId}:${line} ${message}`);
  });
}

process.on('uncaughtException', (err) => logStartup('uncaughtException', err));
process.on('unhandledRejection', (err) => logStartup('unhandledRejection', err));

logStartup('app bootstrap start');

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  logStartup('second instance blocked: quitting new process');
  app.quit();
}

// ── Portable: redirect userData to folder next to .exe ───────
if (process.env.PORTABLE_EXECUTABLE_DIR) {
  const portableUserData = path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'ICQ-Data');
  const portableSessionData = path.join(portableUserData, 'session');
  try {
    fs.mkdirSync(portableUserData, { recursive: true });
    fs.mkdirSync(portableSessionData, { recursive: true });
    fs.accessSync(portableUserData, fs.constants.W_OK);
    app.setPath('userData', portableUserData);
    app.setPath('sessionData', portableSessionData);
    logStartup(`Portable paths active: userData=${portableUserData}`);
  } catch (e) {
    // Keep Electron default userData when portable dir is not writable.
    logStartup('Portable path setup failed, using default userData', e);
  }
}

// Contactlist/Chat windows
let contactListWindow = null;
const chatWindows = new Map(); // chatId → BrowserWindow
const avatarStore  = new Map(); // chatId → avatar data URL
const waMessageCache = new Map(); // chatId → { messages, timestamp } for last 5 chats
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const CACHE_SIZE = 5;
let appDataDir = null; // set in app.on('ready'), used for reconnect

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

function resolveAssetPath(...parts) {
  const candidates = [
    path.join(__dirname, '..', ...parts),
    path.join(app.getAppPath(), ...parts),
    path.join(process.resourcesPath || '', ...parts),
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return candidates[0];
}

function getWindowIconPath() {
  if (process.platform === 'darwin') return resolveAssetPath('public', 'icon.icns');
  if (process.platform === 'linux') return resolveAssetPath('public', 'icon.png');
  return resolveAssetPath('public', 'icon.ico');
}


// ── Contactlist window ───────────────────────────────────────
function createContactListWindow() {
  if (contactListWindow && !contactListWindow.isDestroyed()) {
    contactListWindow.focus();
    return contactListWindow;
  }
  contactListWindow = new BrowserWindow({
    width: 270,
    height: 580,
    minWidth: 240,
    minHeight: 420,
    maxWidth: 360,
    frame: false,
    resizable: true,
    show: true,
    icon: getWindowIconPath(),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js'),
    },
    title: 'ICQ Kontaktliste',
  });
  contactListWindow.loadURL(devUrl());
  wireWindowDiagnostics(contactListWindow, 'contact-list');
  wireExternalLinks(contactListWindow);

  contactListWindow.on('closed', () => {
    // Close all open chat windows when contact list is closed
    chatWindows.forEach(win => { if (!win.isDestroyed()) win.close(); });
    chatWindows.clear();
    contactListWindow = null;
  });
  return contactListWindow;
}

// Chat window logic
function createChatWindow(chatId, chatName, service, avatar, isGroup) {
  const chatWin = new BrowserWindow({
    width:    isGroup ? 900 : 520,
    height:   440,
    minWidth: 380,
    minHeight: 300,
    frame: false,
    resizable: true,
    icon: getWindowIconPath(),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js'),
    },
    title: chatName || 'Chat',
  });
  const params = new URLSearchParams({ mode: 'chat', chatId, chatName: chatName || '', service, isGroup: isGroup ? '1' : '0' }).toString();
  chatWin.loadURL(devUrl(params));
  wireWindowDiagnostics(chatWin, `chat-${chatId}`);
  wireExternalLinks(chatWin);
  chatWindows.set(chatId, chatWin);
  chatWin.on('closed', () => chatWindows.delete(chatId));
  return chatWin;
}

app.on('ready', async () => {
  const win = createContactListWindow();
  win.show();
  // Dev: use local ./data dir. Packaged: use userData (installer → %APPDATA%, portable → next to exe)
  const dataDir = isDev
    ? path.join(__dirname, '../data')
    : app.getPath('userData');
  appDataDir = dataDir;
  const cacheAvatar = (id, avatar) => { if (id && avatar) avatarStore.set(String(id), avatar); };
  try { await whatsappBridge.init(cacheAvatar, dataDir); } catch (e) { console.error('[WA init]', e.message); }
  try { await telegramBridge.init(null, cacheAvatar, dataDir); } catch (e) { console.error('[TG init]', e.message); }
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', (e) => {
  e.preventDefault();
  // Give bridges max 1.5s to shut down cleanly, then force exit
  const timeout = setTimeout(() => app.exit(0), 1500);
  Promise.all([
    whatsappBridge.shutdown?.().catch(() => {}),
    telegramBridge.shutdown?.().catch(() => {}),
  ]).then(() => {
    clearTimeout(timeout);
    app.exit(0);
  });
});

app.on('activate', () => {
  if (contactListWindow === null) createContactListWindow();
});

app.on('second-instance', () => {
  try {
    const win = createContactListWindow();
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    logStartup('second-instance: focused existing contact window');
  } catch (e) {
    logStartup('second-instance handler failed', e);
  }
});

ipcMain.handle('open-chat', async (e, { chatId, chatName, service, avatar, isGroup }) => {
  if (avatar) avatarStore.set(chatId, avatar);
  // Focus existing window if already open
  if (chatWindows.has(chatId)) {
    const existing = chatWindows.get(chatId);
    if (!existing.isDestroyed()) { existing.focus(); return; }
  }
  createChatWindow(chatId, chatName, service, avatar, !!isGroup);
});

// ── IPC: WhatsApp ─────────────────────────────────────────────
ipcMain.handle('get-stored-avatar', async (e, id) => {
  if (!id) return null;
  return avatarStore.get(String(id)) || null;
});
ipcMain.handle('wa:get-qr',       async ()             => whatsappBridge.getQR());
ipcMain.handle('wa:reconnect',    async ()             => {
  // Force a fresh init — useful when stuck in error state
  whatsappBridge.reconnect(appDataDir);
});
ipcMain.handle('wa:get-chats',    async ()             => whatsappBridge.getChats());
ipcMain.handle('wa:get-messages', async (e, chatId, opts = {}) => {
  // Check cache for faster repeat opens
  const cached = waMessageCache.get(chatId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL && !opts.refresh) {
    return cached.messages;
  }
  
  const messages = await whatsappBridge.getMessages(chatId, opts);
  
  // Maintain cache size limit
  if (waMessageCache.size >= CACHE_SIZE) {
    const firstKey = waMessageCache.keys().next().value;
    waMessageCache.delete(firstKey);
  }
  waMessageCache.set(chatId, { messages, timestamp: Date.now() });
  
  return messages;
});
ipcMain.handle('wa:send-message', async (e, id, text)  => whatsappBridge.sendMessage(id, text));
ipcMain.handle('wa:send-file',    async (e, id, path)  => whatsappBridge.sendFile(id, path));
ipcMain.handle('wa:send-sticker', async (e, id, path)  => whatsappBridge.sendSticker(id, path));
ipcMain.handle('wa:send-voice',   async (e, id, base64, mime) => whatsappBridge.sendVoice(id, base64, mime));
ipcMain.handle('wa:set-archive',  async (e, id, archive) => whatsappBridge.setArchive(id, archive));
ipcMain.handle('wa:edit-message', async (e, chatId, messageId, newText) => whatsappBridge.editMessage(chatId, messageId, newText));
ipcMain.handle('wa:delete-message', async (e, chatId, messageId, forEveryone) => whatsappBridge.deleteMessage(chatId, messageId, forEveryone));
ipcMain.handle('wa:mark-read',    async (e, id)        => whatsappBridge.markChatRead(id));
ipcMain.handle('wa:status',       async ()             => whatsappBridge.getStatus());
ipcMain.handle('wa:get-my-profile', async ()           => whatsappBridge.getMyProfile());
ipcMain.handle('wa:get-avatar',   async (e, id)        => whatsappBridge.getContactAvatar(id));
ipcMain.handle('wa:get-participants', async (e, id)     => whatsappBridge.getParticipants(id));
ipcMain.handle('wa:logout',       async ()             => whatsappBridge.logout());

// ── IPC: Telegram ─────────────────────────────────────────────
ipcMain.handle('tg:request-code',   async (e, phone)            => telegramBridge.requestCode(phone));
ipcMain.handle('tg:sign-in',        async (e, phone, code, hash)=> telegramBridge.signIn(phone, code, hash));
ipcMain.handle('tg:start-qr-login', async ()                    => telegramBridge.startQRLogin());
ipcMain.handle('tg:2fa-password',   async (e, password)         => telegramBridge.submit2FA(password));
ipcMain.handle('tg:get-dialogs',    async ()                    => telegramBridge.getDialogs());
ipcMain.handle('tg:get-messages',   async (e, chatId, opts)     => telegramBridge.getMessages(chatId, opts));
ipcMain.handle('tg:send-message',   async (e, chatId, text)     => telegramBridge.sendMessage(chatId, text));
ipcMain.handle('tg:send-file',      async (e, chatId, path)     => telegramBridge.sendFile(chatId, path));
ipcMain.handle('tg:send-sticker',   async (e, chatId, path)     => telegramBridge.sendSticker(chatId, path));
ipcMain.handle('tg:send-voice',     async (e, chatId, base64, mime) => telegramBridge.sendVoice(chatId, base64, mime));
ipcMain.handle('tg:set-archive',   async (e, chatId, archive) => telegramBridge.setArchive(chatId, archive));

ipcMain.handle('tg:get-participants', async (e, chatId) => telegramBridge.getParticipants(chatId));

ipcMain.handle('show-contact-context', async (e, { id, service, archived, name }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const { Menu, MenuItem } = require('electron');
  const menu = new Menu();
  menu.append(new MenuItem({ label: name || id, enabled: false }));
  menu.append(new MenuItem({ type: 'separator' }));
  menu.append(new MenuItem({
    label: archived ? 'Archivierung rückgängig' : 'Archivieren',
    click: async () => {
      try {
        if (service === 'whatsapp') await whatsappBridge.setArchive(id, !archived);
        else if (service === 'telegram') await telegramBridge.setArchive(id, !archived);
      } catch (err) { console.error('[setArchive]', err); }
    }
  }));
  menu.popup({ window: win });
});

ipcMain.handle('show-message-context', async (e, { chatId, msg, service }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const { Menu, MenuItem } = require('electron');
  const menu = new Menu();
  menu.append(new MenuItem({ label: (msg?.body || '').slice(0, 80) || (msg?.type || 'Message'), enabled: false }));
  menu.append(new MenuItem({ type: 'separator' }));
  menu.append(new MenuItem({ label: 'Kopieren', click: () => e.sender.send('message-context-action', { action: 'copy', msgId: msg?.id, chatId, service }) }));
  if ((msg?.body || '').trim()) {
    menu.append(new MenuItem({ label: 'Antworten', click: () => e.sender.send('message-context-action', { action: 'reply', msgId: msg?.id, chatId, service }) }));
    menu.append(new MenuItem({ label: 'Weiterleiten', click: () => e.sender.send('message-context-action', { action: 'forward', msgId: msg?.id, chatId, service }) }));
  }
  if (msg?.fromMe) {
    menu.append(new MenuItem({ type: 'separator' }));
    menu.append(new MenuItem({ label: 'Bearbeiten', click: () => e.sender.send('message-context-action', { action: 'edit', msgId: msg?.id, chatId, service }) }));
    menu.append(new MenuItem({ label: 'Löschen', click: () => e.sender.send('message-context-action', { action: 'delete', msgId: msg?.id, chatId, service }) }));
  }
  menu.popup({ window: win });
});
ipcMain.handle('tg:edit-message',   async (e, chatId, messageId, newText) => telegramBridge.editMessage(chatId, messageId, newText));
ipcMain.handle('tg:delete-message', async (e, chatId, messageId, revoke)  => telegramBridge.deleteMessage(chatId, messageId, revoke));
ipcMain.handle('tg:get-recent-stickers', async (e, limit)       => telegramBridge.getRecentStickers(limit));
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

// ── IPC: Save clipboard image to temp file ─────────────────
ipcMain.handle('app:save-temp-image', async (e, base64, ext) => {
  const fname = `clipboard_${Date.now()}.${ext || 'png'}`;
  const fpath = path.join(os.tmpdir(), fname);
  fs.writeFileSync(fpath, Buffer.from(base64, 'base64'));
  return fpath;
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

// Broadcast read state to all other windows (so unread badges are cleared immediately)
ipcMain.on('chat:read', (e, msg) => {
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed() && w.webContents !== e.sender)
      w.webContents.send('chat:read-broadcast', msg);
  });
});




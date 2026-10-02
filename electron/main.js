const { app, BrowserWindow, ipcMain, shell, dialog, clipboard, Menu, MenuItem, net } = require('electron');
const path = require('path');
const os   = require('os');
const fs   = require('fs');
const isDev = require('electron-is-dev');
const { resolveDataDir, findLegacyDataDir, migrateLegacyData } = require('./lib/data-dir');
// E2E smoke mode (set by the Playwright CI test): load the built renderer
// and skip messenger bridge init so the app boots deterministically with
// no network / Puppeteer dependency.
const isE2E = process.env.ICQ_E2E === '1';

const STARTUP_LOG = path.join(os.tmpdir(), 'icq-startup.log');
function logStartup(msg, err) {
  try {
    const detail = err ? ` | ${err.stack || err.message || String(err)}` : '';
    fs.appendFileSync(STARTUP_LOG, `[${new Date().toISOString()}] ${msg}${detail}\n`, 'utf8');
  } catch (e) {}
}

// Only web links leave the app. Popups from game sites (and their ads) could
// otherwise hand file:, search-ms: or other protocol handlers to the OS.
function openExternalSafe(url) {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url);
}

// Avatar cache files are named after chat ids — keep them inside the folder and
// free of characters Windows treats specially (':' would make an NTFS stream).
// Real ids ("4917…@s.whatsapp.net", "-100123") pass through unchanged, so the
// existing cache keeps working.
function avatarFileName(id) {
  return `${String(id).replace(/[^A-Za-z0-9@._+-]/g, '_').replace(/\.{2,}/g, '_')}.img`;
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

// Declare appDataDir early so portable blocks can assign it without TDZ errors
let appDataDir = null;

// Save original userData path (before any portable redirect) so we can migrate
const ORIGINAL_USER_DATA = app.getPath('userData');

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  logStartup('second instance blocked: quitting new process');
  app.quit();
}

// ── User-data directory ───────────────────────────────────────
// Portable builds keep the login/session in `ICQ-Data` next to the .exe so the
// folder is self-contained; installed builds (Windows setup, macOS, Linux) use the
// OS user-data folder — never the install folder, which every update deletes.
// The decision logic lives in electron/lib/data-dir.js so it can be unit-tested.
const dataDecision = resolveDataDir({
  portableExecDir: process.env.PORTABLE_EXECUTABLE_DIR,
  fs,
});
if (dataDecision) {
  app.setPath('userData', dataDecision.userDataDir);
  app.setPath('sessionData', dataDecision.sessionDataDir);
  appDataDir = dataDecision.userDataDir;
  logStartup(`Data dir active (${dataDecision.source}): userData=${dataDecision.userDataDir}`);
} else {
  logStartup(`Using default userData: ${ORIGINAL_USER_DATA}`);
  // Older installed builds kept ICQ-Data in the install folder. Bring it over once
  // (only the primary instance — a second one is about to quit).
  if (singleInstanceLock) {
    const legacy = findLegacyDataDir({
      portableExecDir: process.env.PORTABLE_EXECUTABLE_DIR,
      isPackaged: app.isPackaged,
      execPath: process.execPath,
      userDataDir: ORIGINAL_USER_DATA,
      // Where installer/installer.nsh rescues an old ICQ-Data before an update.
      extraCandidates: [path.join(app.getPath('appData'), 'ICQ Messenger', 'legacy-ICQ-Data')],
      fs,
    });
    if (legacy) {
      try {
        const r = migrateLegacyData({ from: legacy, to: ORIGINAL_USER_DATA, fs });
        logStartup(`Legacy data migration from ${legacy}: ${r.reason}`);
      } catch (e) { logStartup(`Legacy data migration from ${legacy} failed`, e); }
    }
  }
}

// Contactlist/Chat windows
let contactListWindow = null;
const chatWindows = new Map(); // chatId → BrowserWindow
const avatarStore  = new Map(); // chatId → avatar data URL
const participantsStore = new Map(); // chatId → participants array
// appDataDir declared early at top of file (before portable blocks)

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
  return (isDev && !isE2E)
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
    width:    isGroup ? 1000 : 520,
    height:   440,
    // Enforce stricter widths: narrow for 1:1, wide for groups (IRC style)
    minWidth: isGroup ? 760 : 480,
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
  // E2E smoke: the window + renderer are all we assert on. Skip bridge init
  // so the test is deterministic and needs no WhatsApp/Telegram session.
  if (isE2E) { logStartup('E2E mode — skipping messenger bridge init'); return; }
  // Dev: use local ./data dir. Packaged: use userData (installer → %APPDATA%, portable → next to exe)
  const dataDir = isDev
    ? path.join(__dirname, '../data')
    : app.getPath('userData');
  appDataDir = dataDir;
  // One-time cleanup: an earlier build kept a merged on-disk message history here.
  // Merging never dropped anything, so malformed entries from those builds stayed
  // forever and rendered as duplicate messages. The cache is in-memory now; remove
  // the old directory so nobody has to clean it up by hand.
  try {
    const legacyMsgDir = path.join(dataDir, 'wa-messages');
    if (fs.existsSync(legacyMsgDir)) {
      fs.rmSync(legacyMsgDir, { recursive: true, force: true });
      logStartup('Removed legacy wa-messages cache');
    }
  } catch (e) { logStartup('Legacy wa-messages cleanup failed', e); }
  const cacheAvatar = (id, avatar) => { if (id && avatar) avatarStore.set(String(id), avatar); };
  try { await whatsappBridge.init(cacheAvatar, dataDir); } catch (e) { console.error('[WA init]', e.message); }
  try { await telegramBridge.init(null, cacheAvatar, dataDir); } catch (e) { console.error('[TG init]', e.message); }
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', (e) => {
  e.preventDefault();
  // WhatsApp's session credentials live in Chrome's IndexedDB/LevelDB, which needs a
  // moment to flush on close. Killing it too early corrupts that store and WhatsApp
  // then refuses the next login ("Login zurzeit nicht möglich") until the session
  // folder is deleted. Give the bridges a realistic window to close cleanly; the
  // timeout is only the last-resort escape hatch.
  const timeout = setTimeout(() => app.exit(0), 7000);
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

// ── Game windows ──────────────────────────────────────────────
const gameWindows = new Map(); // url → BrowserWindow

ipcMain.handle('open-game', async (e, url, title) => {
  // Focus existing window for same URL if already open
  if (gameWindows.has(url)) {
    const existing = gameWindows.get(url);
    if (!existing.isDestroyed()) { existing.focus(); return; }
    gameWindows.delete(url);
  }

  const gameWin = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 800,
    minHeight: 600,
    frame: true,
    resizable: true,
    title: title || 'ICQ Spiele',
    icon: getWindowIconPath(),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  // Allow the game site to open popups inside new Electron windows
  gameWin.webContents.setWindowOpenHandler(({ url: popUrl }) => {
    const allowed = ['bloob.io', 'slidealama.eu', 'robinko2.eu'];
    try {
      const host = new URL(popUrl).hostname;
      if (allowed.some(d => host === d || host.endsWith('.' + d))) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 1000, height: 700, frame: true,
            webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
          },
        };
      }
    } catch (_) {}
    // Open anything else in the real browser
    openExternalSafe(popUrl);
    return { action: 'deny' };
  });

  gameWin.removeMenu();
  gameWin.loadURL(url);
  wireWindowDiagnostics(gameWin, `game-${url}`);
  gameWindows.set(url, gameWin);
  gameWin.on('closed', () => gameWindows.delete(url));
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
  const key = String(id);
  if (avatarStore.has(key)) return avatarStore.get(key);
  try {
    const userData = appDataDir || app.getPath('userData');
    const dir = path.join(userData, 'avatars');
    const fname = path.join(dir, avatarFileName(key));
    if (fs.existsSync(fname)) {
      const buf = fs.readFileSync(fname);
      // Skip broken/empty files written by old bug (HTTP URL stored as empty bytes)
      if (buf.length === 0) {
        try { fs.unlinkSync(fname); } catch (_) {}
        return null;
      }
      const mime = 'image/jpeg'; // all avatar images stored as jpeg
      const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
      avatarStore.set(key, dataUrl);
      return dataUrl;
    }
  } catch (e) { console.error('[get-stored-avatar read]', e); }
  return null;
});
ipcMain.handle('wa:get-qr',       async ()             => whatsappBridge.getQR());
ipcMain.handle('wa:reconnect',    async ()             => {
  // Force a fresh init — useful when stuck in error state
  whatsappBridge.reconnect(appDataDir);
});
ipcMain.handle('wa:get-chats',    async ()             => whatsappBridge.getChats());

// No message cache here (there used to be a 10 s one): the Baileys bridge answers
// from its own in-memory store, so there is no WhatsApp round trip to save. The
// cache outlived the 8 s reconcile in the chat window and handed it snapshots from
// before the latest receipt or deletion — ticks fell back, deleted messages returned.
ipcMain.handle('wa:get-messages', async (e, chatId, opts = {}) => {
  const messages = await whatsappBridge.getMessages(chatId, opts).catch(() => []);
  return Array.isArray(messages) ? messages : [];
});

// NOTE: deliberately no background pre-fetch of other chats. After the QR scan the
// contact list must load on its own — anything else competing for the single
// WhatsApp page made the first load crawl. Messages are fetched+cached only when a
// chat is actually opened (see the handler above).
ipcMain.handle('wa:send-message', async (e, id, text, quotedMessageId)  => whatsappBridge.sendMessage(id, text, quotedMessageId));
ipcMain.handle('wa:send-file',    async (e, id, path)  => whatsappBridge.sendFile(id, path));
ipcMain.handle('wa:send-sticker', async (e, id, path)  => whatsappBridge.sendSticker(id, path));
ipcMain.handle('wa:send-voice',   async (e, id, base64, mime, waveform) => whatsappBridge.sendVoice(id, base64, mime, waveform));
ipcMain.handle('wa:set-archive',  async (e, id, archive) => whatsappBridge.setArchive(id, archive));
ipcMain.handle('wa:edit-message', async (e, chatId, messageId, newText) => whatsappBridge.editMessage(chatId, messageId, newText));
ipcMain.handle('wa:delete-message', async (e, chatId, messageId, forEveryone) => whatsappBridge.deleteMessage(chatId, messageId, forEveryone));
ipcMain.handle('wa:mark-read',    async (e, id)        => whatsappBridge.markChatRead(id));
ipcMain.handle('wa:status',       async ()             => whatsappBridge.getStatus());
ipcMain.handle('wa:get-my-profile', async ()           => whatsappBridge.getMyProfile());
ipcMain.handle('wa:get-avatar',   async (e, id)        => whatsappBridge.getContactAvatar(id));
ipcMain.handle('wa:get-participants', async (e, id)     => whatsappBridge.getParticipants(id));
ipcMain.handle('wa:logout',       async ()             => whatsappBridge.logout());
ipcMain.handle('wa:get-sync',     async ()             => whatsappBridge.getSyncState?.() || false);
ipcMain.handle('wa:pair-new-device', async ()          => whatsappBridge.pairAsNewDevice?.());

// ── IPC: Telegram ─────────────────────────────────────────────
ipcMain.handle('tg:request-code',   async (e, phone)            => telegramBridge.requestCode(phone));
ipcMain.handle('tg:sign-in',        async (e, phone, code, hash)=> telegramBridge.signIn(phone, code, hash));
ipcMain.handle('tg:start-qr-login', async ()                    => telegramBridge.startQRLogin());
ipcMain.handle('tg:2fa-password',   async (e, password)         => telegramBridge.submit2FA(password));
ipcMain.handle('tg:get-dialogs',    async ()                    => telegramBridge.getDialogs());
ipcMain.handle('tg:get-messages',   async (e, chatId, opts)     => telegramBridge.getMessages(chatId, opts));
ipcMain.handle('tg:send-message',   async (e, chatId, text, quotedMessageId)     => telegramBridge.sendMessage(chatId, text, quotedMessageId));
ipcMain.handle('tg:send-file',      async (e, chatId, path)     => telegramBridge.sendFile(chatId, path));
ipcMain.handle('tg:send-sticker',   async (e, chatId, path)     => telegramBridge.sendSticker(chatId, path));
ipcMain.handle('tg:send-voice',     async (e, chatId, base64, mime, waveform) => telegramBridge.sendVoice(chatId, base64, mime, waveform));
ipcMain.handle('tg:set-archive',   async (e, chatId, archive) => telegramBridge.setArchive(chatId, archive));

ipcMain.handle('tg:get-participants', async (e, chatId) => telegramBridge.getParticipants(chatId));

ipcMain.handle('show-contact-context', async (e, { id, service, archived, name, isGroup }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const bridge = service === 'whatsapp' ? whatsappBridge : telegramBridge;
  const { Menu, MenuItem } = require('electron');
  const menu = new Menu();
  menu.append(new MenuItem({ label: name || id, enabled: false }));
  menu.append(new MenuItem({ type: 'separator' }));

  // Mark this single chat as read on the server, then clear its badge everywhere.
  menu.append(new MenuItem({
    label: 'Als gelesen markieren',
    click: async () => {
      try {
        await bridge.markChatRead?.(id);
        BrowserWindow.getAllWindows().forEach(w => {
          if (!w.isDestroyed()) w.webContents.send('chat:read-broadcast', { chatId: String(id), service });
        });
      } catch (err) { console.error('[ctx markRead]', err); }
    }
  }));

  menu.append(new MenuItem({
    label: archived ? 'Archivierung rückgängig' : 'Archivieren',
    click: async () => {
      try { await bridge.setArchive?.(id, !archived); }
      catch (err) { console.error('[setArchive]', err); }
    }
  }));

  // Block / unblock — 1:1 contacts only (groups can't be blocked).
  if (!isGroup) {
    let blocked = false;
    try { blocked = await bridge.isContactBlocked?.(id); } catch (err) {}
    menu.append(new MenuItem({ type: 'separator' }));
    menu.append(new MenuItem({
      label: blocked ? 'Entsperren' : 'Blockieren',
      click: async () => {
        try { await bridge.setBlocked?.(id, !blocked); }
        catch (err) { console.error('[setBlocked]', err); }
      }
    }));
  }

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
  const safeExt = /^[a-z0-9]{1,5}$/i.test(String(ext || '')) ? ext : 'png';
  const fname = `clipboard_${Date.now()}.${safeExt}`;
  const fpath = path.join(os.tmpdir(), fname);
  fs.writeFileSync(fpath, Buffer.from(base64, 'base64'));
  return fpath;
});

// Read a local file and return a data URL (used to show previews for sent images)
ipcMain.handle('app:read-file-dataurl', async (e, filePath) => {
  try {
    if (!filePath) return null;
    const buf = fs.readFileSync(filePath);
    const ext = (path.extname(filePath) || '').toLowerCase().replace('.', '');
    const map = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml' };
    const mime = map[ext] || 'application/octet-stream';
    const b64 = buf.toString('base64');
    return `data:${mime};base64,${b64}`;
  } catch (err) {
    console.error('[read-file-dataurl]', err);
    return null;
  }
});

ipcMain.handle('set-stored-avatar', async (e, id, dataUrl) => {
  try {
    if (!id || !dataUrl) return false;
    const key = String(id);
    avatarStore.set(key, dataUrl);
    try {
      // Resolve HTTP(S) avatar URLs to actual image data before persisting.
      // WhatsApp returns expiring CDN URLs — we fetch them in the main process
      // (bypasses CORS) and convert to a base64 data URL for durable disk storage.
      let persistUrl = dataUrl;
      if (dataUrl.startsWith('http://') || dataUrl.startsWith('https://')) {
        try {
          const resp = await net.fetch(dataUrl);
          if (resp.ok) {
            const arrBuf = await resp.arrayBuffer();
            const buf = Buffer.from(arrBuf);
            if (buf.length > 0) {
              const ct = (resp.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
              persistUrl = `data:${ct};base64,${buf.toString('base64')}`;
              avatarStore.set(key, persistUrl); // update in-memory store with data URL
            } else {
              return true; // empty response — in-memory URL only, skip disk
            }
          } else {
            return true; // fetch failed — in-memory URL only, skip disk
          }
        } catch (fetchErr) {
          logStartup(`Avatar fetch failed for ${key}`, fetchErr);
          return true; // in-memory URL only, skip disk
        }
      }

      const m = /^data:(.+?);base64,(.+)$/.exec(persistUrl);
      if (!m || !m[2]) return true; // still not a data URL — skip disk
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length === 0) return true; // empty data — skip disk

      const userData = appDataDir || app.getPath('userData');
      const dir = path.join(userData, 'avatars');
      fs.mkdirSync(dir, { recursive: true });
      const fname = path.join(dir, avatarFileName(key));
      fs.writeFileSync(fname, buf);
    } catch (e) { console.error('[set-stored-avatar write]', e); }
    return true;
  } catch (err) {
    console.error('[set-stored-avatar]', err);
    return false;
  }
});

ipcMain.handle('set-stored-participants', async (e, chatId, participants) => {
  try {
    if (!chatId || !participants) return false;
    participantsStore.set(String(chatId), Array.isArray(participants) ? participants : []);
    return true;
  } catch (err) { console.error('[set-stored-participants]', err); return false; }
});

ipcMain.handle('get-stored-participants', async (e, chatId) => {
  try {
    if (!chatId) return null;
    return participantsStore.get(String(chatId)) || null;
  } catch (err) { console.error('[get-stored-participants]', err); return null; }
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
      openExternalSafe(url);
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url);
    return { action: 'deny' };
  });

  // Native right-click context menu (cut / copy / paste / select all)
  win.webContents.on('context-menu', (e, params) => {
    const menu = new Menu();
    if (params.linkURL) {
      menu.append(new MenuItem({ label: 'Link kopieren', click: () => clipboard.writeText(params.linkURL) }));
      menu.append(new MenuItem({ label: 'Link öffnen', click: () => openExternalSafe(params.linkURL) }));
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

// Broadcast a skin change to all other windows so every open chat
// window + the contact list re-theme together instantly.
ipcMain.on('skin:set', (e, id) => {
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed() && w.webContents !== e.sender)
      w.webContents.send('skin:changed', id);
  });
});

// Broadcast a sent message to all other windows (so sidebar updates immediately)
ipcMain.on('chat:sent', (e, msg) => {
  try {
    if (msg && msg.chatId != null) msg.chatId = String(msg.chatId);
  } catch (e) {}
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed() && w.webContents !== e.sender)
      w.webContents.send('chat:sent-broadcast', msg);
  });
});

// Broadcast read state to all other windows (so unread badges are cleared immediately)
ipcMain.on('chat:read', (e, msg) => {
  try {
    if (msg && msg.chatId != null) msg.chatId = String(msg.chatId);
  } catch (e) {}
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed() && w.webContents !== e.sender)
      w.webContents.send('chat:read-broadcast', msg);
  });
});




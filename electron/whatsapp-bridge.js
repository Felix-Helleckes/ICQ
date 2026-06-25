/**
 * WhatsApp bridge using whatsapp-web.js
 * Runs in the Electron main process.
 */
const { Client, LocalAuth } = require('whatsapp-web.js');
const { BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Logging helper: append to temp startup log for easier debugging across restarts
const STARTUP_LOG = path.join(os.tmpdir(), 'icq-startup.log');
function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`;
  try { fs.appendFileSync(STARTUP_LOG, line + '\n'); } catch (e) {}
  try { console.log(...args); } catch (e) {}
}

let client = null;
let status = 'disconnected';
let currentQR = null;
let onAvatarCb = null;
let lastDataDir = null;
let lastClientId = null;
let loadingWatchdog = null;
let waRetryUsed = false;
let waManualLogout = false; // true only when logout() was explicitly called — prevents auto-reconnect

const WA_LOADING_TIMEOUT_MS = 180000;     // 180s startup budget (packaged app + Chrome cold start)
const WA_POST_AUTH_TIMEOUT_MS = 90000;   // 90s post-auth: packaged apps need more time than dev

function broadcast(channel, data) {
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed()) w.webContents.send(channel, data);
  });
  // Notify main.js avatar cache if registered
  if (channel === 'wa:avatar' && onAvatarCb) onAvatarCb(data.id, data.avatar);
}

function clearLoadingWatchdog() {
  if (loadingWatchdog) {
    clearTimeout(loadingWatchdog);
    loadingWatchdog = null;
  }
}

function armLoadingWatchdog(reason) {
  clearLoadingWatchdog();
  // Use shorter timeout for post-auth (typically <5s), fallback to normal for startup
  const timeout = reason === 'post-auth' ? WA_POST_AUTH_TIMEOUT_MS : WA_LOADING_TIMEOUT_MS;
  loadingWatchdog = setTimeout(async () => {
    // Only recover when WA is still not ready and a client exists.
    if (!client || status === 'ready') return;
    if (waRetryUsed) {
      console.error(`[WA watchdog] still stuck after retry (${reason})`);
      status = 'error';
      broadcast('wa:status', 'error');
      return;
    }

    waRetryUsed = true;
    console.warn(`[WA watchdog] timeout (${reason}) -> retry init`);
    try { if (client) await client.destroy(); } catch (e) {}
    client = null;
    currentQR = null;
    status = 'loading';
    broadcast('wa:status', 'loading');
    init(onAvatarCb, lastDataDir, { isRetry: true });
  }, timeout);
}

function cleanupStaleSessionLocks(dataDir) {
  const lockNames = ['lockfile', 'SingletonLock', 'SingletonCookie', 'SingletonSocket', 'DevToolsActivePort'];
  const waDir = path.join(dataDir, 'whatsapp');
  // Clean all session-* subdirs (covers both default 'session' and clientId-based 'session-*')
  const dirsToClean = [];
  try {
    const entries = fs.readdirSync(waDir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory() && e.name.startsWith('session')) dirsToClean.push(path.join(waDir, e.name));
    }
  } catch (e) {}
  for (const sessionDir of dirsToClean) {
    for (const name of lockNames) {
      const fp = path.join(sessionDir, name);
      if (fs.existsSync(fp)) { try { fs.rmSync(fp, { force: true }); } catch (e) {} }
    }
  }
}

const WA_CONNECTED_STATES = new Set(['CONNECTED', 'OPENING', 'PAIRING']);

async function getClientStateSafe() {
  if (!client) return null;
  try {
    return await client.getState();
  } catch (e) {
    return null;
  }
}

function shouldReconnectOnError(err) {
  const text = String(err?.message || err || '').toLowerCase();
  if (!text) return false;
  return (
    text.includes('promise was collected') ||
    text.includes('target closed') ||
    text.includes('session closed') ||
    text.includes('execution context was destroyed') ||
    text.includes('protocol error') ||
    text.includes('not connected') ||
    text.includes('not ready') ||
    text.includes('evaluation failed')
  );
}

async function ensureOperationalForSend() {
  if (!client || status !== 'ready') {
    throw new Error('WhatsApp not ready');
  }
  const state = await getClientStateSafe();
  if (state && !WA_CONNECTED_STATES.has(String(state))) {
    throw new Error(`WhatsApp not connected (${state})`);
  }
}

function triggerRecovery(reason) {
  if (waManualLogout) return;
  console.warn('[WA recovery]', reason);
  status = 'loading';
  broadcast('wa:status', 'loading');
  reconnect(lastDataDir);
}

async function waitForReady(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (status === 'ready' && client) {
      const state = await getClientStateSafe();
      if (!state || WA_CONNECTED_STATES.has(String(state))) return true;
    }
    await new Promise(resolve => setTimeout(resolve, 450));
  }
  return false;
}

async function runWithRecovery(opName, handler) {
  await ensureOperationalForSend();
  try {
    return await handler();
  } catch (e) {
    if (!shouldReconnectOnError(e)) throw e;

    triggerRecovery(`${opName} failed: ${e?.message || e}`);
    const recovered = await waitForReady(35000);
    if (!recovered) throw e;

    await ensureOperationalForSend();
    return await handler();
  }
}

function getPlatformTag() {
  if (process.platform === 'win32') return 'win';
  if (process.platform === 'darwin') return 'mac';
  return 'linux';
}

function sanitizeToken(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'node';
}

function getDeviceIdentity() {
  const platform = getPlatformTag();
  const host = sanitizeToken(os.hostname());
  return {
    clientId: `retrogram-${platform}-${host}`,
  };
}

function resolveClientIdForLocalAuth(dataDir) {
  // If an existing session folder exists, reuse its clientId to preserve sessions across restarts.
  try {
    const waDir = path.join(dataDir, 'whatsapp');
    const entries = fs.readdirSync(waDir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name === 'session') return null; // legacy default session folder — no clientId
      if (e.name.startsWith('session-')) return e.name.slice('session-'.length);
    }
  } catch (e) {
    // ignore
  }
  // No existing session found: return a stable id based on platform only (avoid hostname volatility)
  return `retrogram-${getPlatformTag()}`;
}

function restoreFromBackups(dataDir) {
  try {
    const waDir = path.join(dataDir, 'whatsapp');
    if (!fs.existsSync(waDir)) return;
    const entries = fs.readdirSync(waDir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const name = e.name;
      const marker = '.corrupt-backup-';
      if (!name.includes(marker)) continue;
      // Original session folder name is the prefix before the marker
      const sessionFolder = name.split(marker)[0];
      const backupDir = path.join(waDir, name);
      const targetDefault = path.join(waDir, sessionFolder, 'Default');
      log('WA restore: found backup', backupDir, 'target', targetDefault);
      try {
        fs.mkdirSync(targetDefault, { recursive: true });
        const files = fs.readdirSync(backupDir, { withFileTypes: true });
        for (const f of files) {
          const src = path.join(backupDir, f.name);
          const dest = path.join(targetDefault, f.name.replace(/\s+/g, '_'));
          if (fs.existsSync(dest)) {
            log('WA restore: dest exists, skipping', dest);
            continue;
          }
          try { fs.renameSync(src, dest); log('WA restore: moved', src, '->', dest); } catch (e) { try { fs.copyFileSync(src, dest); fs.rmSync(src, { force: true }); log('WA restore: copied then removed', src, '->', dest); } catch (err) { log('WA restore: failed to move/copy', src, String(err)); } }
        }
        // After moving files, remove backup dir if empty
        try { const rem = fs.readdirSync(backupDir); if (rem.length === 0) fs.rmdirSync(backupDir); } catch (e) {}
        broadcast('wa:backup-restored', { sessionFolder, path: targetDefault });
      } catch (e) { log('WA restore error', String(e)); }
    }
  } catch (e) { log('WA restore scan error', String(e)); }
}

// Find a usable Chrome/Edge/Chromium on the host system.
// Priority: 1. bundled extraResources chrome, 2. system Chrome/Edge, 3. puppeteer cache (dev)
function ensureExecutable(filePath) {
  if (!filePath || process.platform === 'win32') return filePath;
  try { fs.chmodSync(filePath, 0o755); } catch (e) {}
  return filePath;
}

function findChromiumExecutable() {
  const win = process.platform === 'win32';
  const mac = process.platform === 'darwin';
  // Auf macOS immer System-Chrome bevorzugen!
  if (mac) {
    const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (fs.existsSync(chromePath)) return ensureExecutable(chromePath);
    const chromiumPath = '/Applications/Chromium.app/Contents/MacOS/Chromium';
    if (fs.existsSync(chromiumPath)) return ensureExecutable(chromiumPath);
    const edgePath = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
    if (fs.existsSync(edgePath)) return ensureExecutable(edgePath);
    // Kein Chrome gefunden
    console.error('[WA init] Kein Google Chrome auf macOS gefunden! Bitte Chrome installieren.');
    return null;
  }
  // Windows/Linux: wie gehabt
  // 1. Bundled chromium (extraResources → resources/chrome/<version>/chrome-*/chrome[.exe])
  try {
    const resPath = process.resourcesPath;
    if (resPath) {
      const chromeDir = path.join(resPath, 'chrome');
      const versions = fs.readdirSync(chromeDir);
      for (const v of versions) {
        const vDir = path.join(chromeDir, v);
        const candidates = [
          path.join(vDir, 'chrome-win64',  'chrome.exe'),
          path.join(vDir, 'chrome-win32',  'chrome.exe'),
          path.join(vDir, 'chrome-linux64', 'chrome'),
          path.join(vDir, 'chrome-linux',   'chrome'),
          path.join(vDir, 'chrome-mac-x64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
          path.join(vDir, 'chrome-mac-arm64','Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
        ];
        for (const exe of candidates) {
          if (fs.existsSync(exe)) return ensureExecutable(exe);
        }
      }
    }
  } catch (e) {}

  // 2. System Chrome / Edge
  const sysCandidates = win ? [
    path.join(process.env['ProgramFiles']        || '', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(process.env['ProgramFiles(x86)']   || '', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(process.env['LOCALAPPDATA']        || '', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(process.env['ProgramFiles']        || '', 'Microsoft\\Edge\\Application\\msedge.exe'),
    path.join(process.env['ProgramFiles(x86)']   || '', 'Microsoft\\Edge\\Application\\msedge.exe'),
  ] : [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/snap/bin/chromium',
  ];

  for (const p of sysCandidates) {
    if (p && fs.existsSync(p)) return ensureExecutable(p);
  }

  // 3. Dev fallback: puppeteer's own downloaded Chromium
  try {
    const p = require('puppeteer').executablePath?.();
    if (p && fs.existsSync(p)) return ensureExecutable(p);
  } catch (e) {}

  return null;
}

function init(avatarCallback, dataDir, opts = {}) {
  const { isRetry = false } = opts;
  if (avatarCallback) onAvatarCb = avatarCallback;
  lastDataDir = dataDir;
  if (!isRetry) waRetryUsed = false;

  // Attempt to restore any previous corrupt-backup files before cleaning locks
  restoreFromBackups(dataDir);

  // Setup installs keep persistent AppData state; stale Chromium lock files can block startup.
  cleanupStaleSessionLocks(dataDir);

  clearLoadingWatchdog();
  status = 'loading';
  broadcast('wa:status', 'loading');

  const executablePath = findChromiumExecutable();

  if (!executablePath && process.platform === 'linux') {
    status = 'error';
    currentQR = null;
    clearLoadingWatchdog();
    broadcast('wa:status', 'error');
    console.error('[WA init] No Chrome/Chromium executable found on Linux. Install chromium or google-chrome and restart.');
    return;
  }

  const isMac = process.platform === 'darwin';
  const resolvedClientId = resolveClientIdForLocalAuth(dataDir);
  lastClientId = resolvedClientId;

  const localAuthOpts = { dataPath: path.join(dataDir, 'whatsapp') };
  if (resolvedClientId) localAuthOpts.clientId = resolvedClientId;

  // Log init details for debugging session reuse issues
  try {
    const sessionFolder = resolvedClientId ? `session-${resolvedClientId}` : 'session';
    log('WA init', { dataDir, resolvedClientId, sessionFolder, executablePath: executablePath || null });
  } catch (e) { log('WA init log error', String(e)); }

  client = new Client({
    authStrategy: new LocalAuth(localAuthOpts),
    puppeteer: {
      ...(executablePath ? { executablePath } : {}),
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        // --disable-gpu: needed on Windows + Linux for headless stability
        // On macOS with Chrome 112+ it causes post-auth rendering failures → skip on mac
        ...(!isMac ? ['--disable-gpu'] : []),
        '--disable-extensions',
        // --disable-background-networking blocks WhatsApp's post-QR WebSocket auth flow
        // Removed: causes QR scan to succeed but session never becomes ready
        '--disable-default-apps',
        '--disable-sync',
        '--disable-translate',
        '--metrics-recording-only',
        '--no-first-run',
        '--safebrowsing-disable-auto-update',
      ],
    },
  });

  client.on('qr', (qr) => {
    currentQR = qr;
    status = 'qr';
    clearLoadingWatchdog();
    broadcast('wa:qr', qr);
    log('WA event', 'qr-generated');
  });

  client.on('authenticated', () => {
    // After QR scan/auth, WA can still hang before ready in rare cases.
    status = 'loading';
    broadcast('wa:status', 'loading');
    armLoadingWatchdog('post-auth');
    log('WA event', 'authenticated');
  });

  client.on('ready', () => {
    status = 'ready';
    currentQR = null;
    clearLoadingWatchdog();
    broadcast('wa:status', 'ready');
    broadcast('wa:ready', { name: client.info?.pushname });
    startHealthCheck();
    log('WA event', 'ready', { pushname: client.info?.pushname });
  });

  client.on('message', async (msg) => {
    let mediaData = null;
    if (msg.hasMedia && (msg.type === 'sticker' || msg.type === 'image' || msg.type === 'video' || msg.type === 'ptt' || msg.type === 'audio')) {
      try {
        const media = await msg.downloadMedia();
        if (media) mediaData = `data:${media.mimetype};base64,${media.data}`;
      } catch (e) { /* ignore download errors */ }
    }
    broadcast('wa:message', {
      from: msg.from,
      to: msg.to,
      body: msg.body || '',
      timestamp: msg.timestamp,
      id: msg.id._serialized,
      type: msg.type,
      isGif: msg.isGif || false,
      fromMe: msg.fromMe,
      ack: msg.ack ?? 0,
      mediaData,
    });
    // Also emit a chat-update so the UI can react immediately (ordering, lastMessage, archived)
    try {
      const chatId = msg.from || msg.to;
        let archivedFlag = false;
        try {
          const ch = await client.getChatById(chatId);
          archivedFlag = !!ch?.archived;
        } catch (e) { /* ignore */ }
        broadcast('wa:chat-update', {
          id: chatId,
          lastMessage: msg.body || '',
          timestamp: msg.timestamp || Math.floor(Date.now()/1000),
          unreadCount: undefined,
          isGroup: msg.isGroup || false,
          archived: archivedFlag,
        });
    } catch (e) {}
  });

  // Ausgehende Nachrichten (eigene) auch broadcasten für Badge-Update
  client.on('message_create', async (msg) => {
    if (!msg.fromMe) return;
    broadcast('wa:message', {
      from: msg.from,
      to: msg.to,
      body: msg.body || '',
      timestamp: msg.timestamp,
      id: msg.id._serialized,
      type: msg.type,
      fromMe: true,
      ack: msg.ack ?? 0,
      mediaData: null,
    });
    try {
      const chatId = msg.to || msg.from;
        let archivedFlag = false;
        try {
          const ch = await client.getChatById(chatId);
          archivedFlag = !!ch?.archived;
        } catch (e) { /* ignore */ }
        broadcast('wa:chat-update', {
          id: chatId,
          lastMessage: msg.body || '',
          timestamp: msg.timestamp || Math.floor(Date.now()/1000),
          unreadCount: 0,
          isGroup: msg.isGroup || false,
          archived: archivedFlag,
        });
    } catch (e) {}
  });

  // Ack-Updates (gesendet/zugestellt/gelesen)
  client.on('message_ack', (msg, ack) => {
    broadcast('wa:ack', { id: msg.id._serialized, ack });
  });

  // Tipp-Indikator
  client.on('contact_changed', () => {}); // keep alive
  try {
    client.on('typing', ({ chatId }) => broadcast('wa:typing', { chatId, typing: true }));
    client.on('stop_typing', ({ chatId }) => broadcast('wa:typing', { chatId, typing: false }));
  } catch (e) { /* older whatsapp-web.js versions may not have these events */ }

  client.on('disconnected', (reason) => {
    clearLoadingWatchdog();
    console.warn('[WA disconnected]', reason);
    log('WA event', 'disconnected', reason);
    if (waManualLogout) {
      // User explicitly logged out — don't reconnect
      status = 'disconnected';
      currentQR = null;
      broadcast('wa:status', 'disconnected');
      return;
    }
    // Auto-reconnect: destroy old client and re-initialize after short delay
    status = 'loading';
    broadcast('wa:status', 'loading');
    const oldClient = client;
    client = null;
    currentQR = null;
    setTimeout(async () => {
      try { await oldClient.destroy(); } catch (e) {}
      if (!waManualLogout) {
        waRetryUsed = false;
        init(onAvatarCb, lastDataDir);
      }
    }, 3000);
  });

  client.on('auth_failure', (msg) => {
    console.error('[WA auth_failure]', msg);
    log('WA event', 'auth_failure', msg);
    clearLoadingWatchdog();
    // Attempt safe recovery: move suspicious storage files to a backup folder instead of deleting them.
    try {
      const sessionBase = path.join(lastDataDir, 'whatsapp');
      const sessionFolder = lastClientId ? `session-${lastClientId}` : 'session';
      const sessionDir = path.join(sessionBase, sessionFolder, 'Default');
      if (fs.existsSync(sessionDir)) {
        const backupDir = path.join(sessionBase, `${sessionFolder}.corrupt-backup-${Date.now()}`);
        fs.mkdirSync(backupDir, { recursive: true });
        const files = ['Cookies', 'Local Storage', 'Session Storage', 'IndexedDB'];
        files.forEach(f => {
          const fp = path.join(sessionDir, f);
          if (!fs.existsSync(fp)) return;
          try {
            const dest = path.join(backupDir, f.replace(/\s+/g, '_'));
            fs.renameSync(fp, dest);
            log('WA auth_failure: moved', fp, '->', dest);
          } catch (e) {
            try { fs.rmSync(fp, { recursive: true, force: true }); log('WA auth_failure: removed fallback', fp); } catch (err) { log('WA auth_failure: remove failed', fp, String(err)); }
          }
        });
        log('WA auth_failure: backup created', backupDir);
      }
    } catch (e) { log('WA auth_failure cleanup error', String(e)); }
    // Reinit to show QR again instead of stuck error screen
    client = null;
    currentQR = null;
    waRetryUsed = false;
    status = 'loading';
    broadcast('wa:status', 'loading');
    setTimeout(() => init(onAvatarCb, lastDataDir), 2000);
  });

  armLoadingWatchdog('startup');
  client.initialize().catch((err) => {
    status = 'error';
    clearLoadingWatchdog();
    broadcast('wa:status', 'error');
    console.error('[WA initialize error]', err.message || err);
  });
}

async function getQR() { return currentQR; }
function getStatus() {
  return status;
}

// Background health check — runs every 30s, never blocks the poll path.
let healthCheckTimer = null;
function startHealthCheck() {
  if (healthCheckTimer) return;
  healthCheckTimer = setInterval(async () => {
    if (status !== 'ready') return;
    if (!client) { triggerRecovery('ready-without-client'); return; }
    const state = await getClientStateSafe();
    if (state && !WA_CONNECTED_STATES.has(String(state))) {
      triggerRecovery(`health-check state=${state}`);
    }
  }, 30000);
}
function stopHealthCheck() {
  if (healthCheckTimer) { clearInterval(healthCheckTimer); healthCheckTimer = null; }
}

async function getChats() {
  if (status !== 'ready') return [];
  const chats = await client.getChats();
  // Sofort die Basisdaten zurückgeben (ohne Avatare)
  const result = chats.slice(0, 100).map(c => ({
    id: c.id._serialized,
    name: c.name,
    lastMessage: c.lastMessage?.body || '',
    timestamp: c.lastMessage?.timestamp || 0,
    unreadCount: c.unreadCount,
    isGroup: c.isGroup,
    archived: !!c.archived,
    avatar: null,
  }));
  // Avatare im Hintergrund nachladen und einzeln broadcasten
  (async () => {
    for (const c of chats.slice(0, 100)) {
      try {
        const contact = await c.getContact();
        const pic = await contact.getProfilePicUrl();
        if (pic) broadcast('wa:avatar', { id: c.id._serialized, avatar: pic });
      } catch (e) { /* no pic */ }
    }
  })();
  return result;
}

async function getMessages(chatId, opts = {}) {
  if (status !== 'ready') return [];
  const limit = opts.limit ?? 30; // Limit reduced for faster initial load
  const chat = await client.getChatById(chatId);
  const msgs = await chat.fetchMessages({ limit });
  
  // Return immediately WITHOUT media to unblock UI
  const result = msgs.map(m => ({
    id: m.id._serialized,
    body: m.body || '',
    fromMe: m.fromMe,
    timestamp: m.timestamp,
    author: m.author || m.from,
    type: m.type,
    isGif: m.isGif || false,
    ack: m.ack ?? (m.fromMe ? 1 : -1),
    hasMedia: m.hasMedia,
    mediaData: null,
  }));
  
  // Load media in background (don't block UI)
  (async () => {
    for (const m of msgs) {
      if (m.hasMedia && (m.type === 'sticker' || m.type === 'image' || m.type === 'video' || m.type === 'ptt' || m.type === 'audio')) {
        try {
          const media = await m.downloadMedia();
          if (media) {
            const mediaData = `data:${media.mimetype};base64,${media.data}`;
            broadcast('wa:media', { msgId: m.id._serialized, mediaData });
          }
        } catch (e) { /* ignore media load errors */ }
      }
    }
  })();
  
  return result;
}

async function sendMessage(chatId, text, quotedMessageId = null) {
  return runWithRecovery('sendMessage', async () => {
    // If message contains a URL, disable automatic link preview generation
    // to avoid waiting for preview fetching which can slow down send.
    const URL_RE = /https?:\/\/\S+/i;
    const options = {};
    if (URL_RE.test(String(text || ''))) {
      options.linkPreview = false;
    }
    if (quotedMessageId) {
      options.quotedMessageId = quotedMessageId;
    }
    await client.sendMessage(chatId, text, options);
    return true;
  });
}

async function markChatRead(chatId) {
  if (status !== 'ready') return;
  try {
    const chat = await client.getChatById(chatId);
    await chat.sendSeen();
  } catch (e) { /* ignore */ }
}

async function sendFile(chatId, filePath) {
  const { MessageMedia } = require('whatsapp-web.js');
  const media = MessageMedia.fromFilePath(filePath);
  return runWithRecovery('sendFile', async () => {
    await client.sendMessage(chatId, media);
    return true;
  });
}

async function sendSticker(chatId, filePath) {
  const { MessageMedia } = require('whatsapp-web.js');
  const media = MessageMedia.fromFilePath(filePath);
  return runWithRecovery('sendSticker', async () => {
    await client.sendMessage(chatId, media, { sendMediaAsSticker: true });
    return true;
  });
}

async function sendVoice(chatId, base64Data, mimeType) {
  return runWithRecovery('sendVoice', async () => {
    const { MessageMedia } = require('whatsapp-web.js');
    const mt = mimeType || 'audio/ogg';
    const filename = mt.includes('ogg') ? 'voice.ogg' : 'voice.webm';
    const media = new MessageMedia(mt, String(base64Data || ''), filename);
    await client.sendMessage(chatId, media, { sendAudioAsVoice: true });
    return true;
  });
}

async function setArchive(chatId, archive) {
  return runWithRecovery('setArchive', async () => {
    try {
      if (archive) await client.archiveChat(chatId);
      else await client.unarchiveChat(chatId);
      // Broadcast updated chat state
      try {
        const ch = await client.getChatById(chatId);
        broadcast('wa:chat-update', {
          id: chatId,
          lastMessage: ch?.lastMessage?.body || '',
          timestamp: ch?.lastMessage?.timestamp || Math.floor(Date.now()/1000),
          unreadCount: ch?.unreadCount,
          isGroup: ch?.isGroup || false,
          archived: !!ch?.archived,
        });
      } catch (e) {}
    } catch (e) { throw e; }
    return true;
  });
}

// Block / unblock a contact — propagates to WhatsApp servers via the
// linked-device protocol (the contact really gets blocked on your account).
async function setBlocked(contactId, blocked) {
  return runWithRecovery('setBlocked', async () => {
    const contact = await client.getContactById(contactId);
    if (!contact) throw new Error('Contact not found');
    if (blocked) await contact.block();
    else await contact.unblock();
    return true;
  });
}

async function isContactBlocked(contactId) {
  if (status !== 'ready') return false;
  try {
    const contact = await client.getContactById(contactId);
    return !!contact?.isBlocked;
  } catch (e) { return false; }
}

async function editMessage(chatId, messageId, newText) {
  return runWithRecovery('editMessage', async () => {
    if (!messageId) throw new Error('Missing message id');
    const msg = await client.getMessageById(messageId);
    if (!msg) throw new Error('Message not found');
    if (!msg.fromMe) throw new Error('Only own messages can be edited');
    await msg.edit(newText);
    return true;
  });
}

async function deleteMessage(chatId, messageId, forEveryone = true) {
  return runWithRecovery('deleteMessage', async () => {
    if (!messageId) throw new Error('Missing message id');
    const msg = await client.getMessageById(messageId);
    if (!msg) throw new Error('Message not found');
    if (!msg.fromMe) throw new Error('Only own messages can be deleted');
    await msg.delete(Boolean(forEveryone));
    return true;
  });
}

async function getMyProfile() {
  if (status !== 'ready') return null;
  try {
    const contact = await client.getContactById(client.info.wid._serialized);
    let avatar = null;
    try { avatar = await contact.getProfilePicUrl(); } catch (e) {}
    return { name: client.info.pushname || contact.pushname || contact.name, avatar };
  } catch (e) {
    return { name: client.info?.pushname || 'Me', avatar: null };
  }
}

async function getParticipants(chatId) {
  if (status !== 'ready') return [];
  try {
    const ch = await client.getChatById(chatId);
    const parts = [];
    // whatsapp-web.js may expose participants in several ways
    const list = ch?.participants || ch?.groupMetadata?.participants || [];
    for (const p of list) {
      try {
        // p can be Contact objects or IDs
        let id = null;
        if (p?.id) id = p.id?._serialized || p.id;
        else if (typeof p === 'string') id = p;
        else if (p?._serialized) id = p._serialized;
        if (!id) continue;
        const contact = await client.getContactById(id).catch(() => null);
        const isOnline = !!(contact?.isOnline || contact?.presence === 'online' || contact?.presence?.lastKnownPresence === 'online');
        parts.push({
          id: id,
          name: contact?.pushname || contact?.name || (contact ? `${contact?.number || ''}` : id),
          pushname: contact?.pushname || null,
          isAdmin: !!(p?.isAdmin || (p?.admin === true)),
          online: isOnline,
        });
      } catch (e) {}
    }
    return parts;
  } catch (e) { return []; }
}

async function getContactAvatar(id) {
  if (status !== 'ready') return null;
  try {
    const contact = await client.getContactById(id);
    return await contact.getProfilePicUrl() || null;
  } catch (e) { return null; }
}

async function logout() {
  waManualLogout = true;
  clearLoadingWatchdog();
  try { await client.logout(); } catch (e) {}
  try { if (client) await client.destroy(); } catch (e) {}
  client = null;
  status = 'disconnected';
  currentQR = null;
  broadcast('wa:status', 'disconnected');
  // After explicit logout, start a clean session init so QR login is immediately possible.
  setTimeout(() => {
    waManualLogout = false;
    reconnect(lastDataDir);
  }, 700);
}

async function shutdown() {
  stopHealthCheck();
  clearLoadingWatchdog();
  try { if (client) await client.destroy(); } catch (e) {}
  status = 'disconnected';
}

function reconnect(dataDir) {
  stopHealthCheck();
  clearLoadingWatchdog();
  const oldClient = client;
  client = null;
  currentQR = null;
  waRetryUsed = false;
  waManualLogout = false;
  status = 'loading';
  broadcast('wa:status', 'loading');
  setTimeout(async () => {
    try { if (oldClient) await oldClient.destroy(); } catch (e) {}
    init(onAvatarCb, dataDir || lastDataDir);
  }, 500);
}

module.exports = {
  init,
  getQR,
  getStatus,
  getChats,
  getMessages,
  sendMessage,
  sendFile,
  sendSticker,
  sendVoice,
  setArchive,
  setBlocked,
  isContactBlocked,
  editMessage,
  deleteMessage,
  markChatRead,
  getMyProfile,
  getContactAvatar,
  getParticipants,
  logout,
  reconnect,
  shutdown,
};

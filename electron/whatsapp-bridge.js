/**
 * WhatsApp bridge using whatsapp-web.js
 * Runs in the Electron main process.
 */
const { Client, LocalAuth } = require('whatsapp-web.js');
const { BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

let client = null;
let status = 'disconnected';
let currentQR = null;
let onAvatarCb = null;
let lastDataDir = null;
let loadingWatchdog = null;
let waRetryUsed = false;

const WA_LOADING_TIMEOUT_MS = 60000;
const WA_POST_AUTH_TIMEOUT_MS = 20000; // Shorter timeout post-auth, should be faster

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
  try {
    const sessionDir = path.join(dataDir, 'whatsapp', 'session');
    const lockNames = [
      'lockfile',
      'SingletonLock',
      'SingletonCookie',
      'SingletonSocket',
      'DevToolsActivePort',
    ];
    for (const name of lockNames) {
      const fp = path.join(sessionDir, name);
      if (fs.existsSync(fp)) {
        try { fs.rmSync(fp, { force: true }); } catch (e) {}
      }
    }
  } catch (e) {}
}

// Find a usable Chrome/Edge/Chromium on the host system.
// Priority: 1. bundled extraResources chrome, 2. system Chrome/Edge, 3. puppeteer cache (dev)
function findChromiumExecutable() {
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
          if (fs.existsSync(exe)) return exe;
        }
      }
    }
  } catch (e) {}

  // 2. System Chrome / Edge
  const win = process.platform === 'win32';
  const mac = process.platform === 'darwin';
  const sysCandidates = win ? [
    path.join(process.env['ProgramFiles']        || '', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(process.env['ProgramFiles(x86)']   || '', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(process.env['LOCALAPPDATA']        || '', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(process.env['ProgramFiles']        || '', 'Microsoft\\Edge\\Application\\msedge.exe'),
    path.join(process.env['ProgramFiles(x86)']   || '', 'Microsoft\\Edge\\Application\\msedge.exe'),
  ] : mac ? [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ] : [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/snap/bin/chromium',
  ];

  for (const p of sysCandidates) {
    if (p && fs.existsSync(p)) return p;
  }

  // 3. Dev fallback: puppeteer's own downloaded Chromium
  try {
    const p = require('puppeteer').executablePath?.();
    if (p && fs.existsSync(p)) return p;
  } catch (e) {}

  return null;
}

function init(avatarCallback, dataDir, opts = {}) {
  const { isRetry = false } = opts;
  if (avatarCallback) onAvatarCb = avatarCallback;
  lastDataDir = dataDir;
  if (!isRetry) waRetryUsed = false;

  // Setup installs keep persistent AppData state; stale Chromium lock files can block startup.
  cleanupStaleSessionLocks(dataDir);

  clearLoadingWatchdog();
  status = 'loading';
  broadcast('wa:status', 'loading');

  const executablePath = findChromiumExecutable();

  const isMac = process.platform === 'darwin';
  const isLinux = process.platform === 'linux';

  client = new Client({
    authStrategy: new LocalAuth({ dataPath: path.join(dataDir, 'whatsapp') }),
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
  });

  client.on('authenticated', () => {
    // After QR scan/auth, WA can still hang before ready in rare cases.
    status = 'loading';
    broadcast('wa:status', 'loading');
    armLoadingWatchdog('post-auth');
  });

  client.on('ready', () => {
    status = 'ready';
    currentQR = null;
    clearLoadingWatchdog();
    broadcast('wa:status', 'ready');
    broadcast('wa:ready', { name: client.info?.pushname });
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

  client.on('disconnected', () => {
    status = 'disconnected';
    currentQR = null;
    clearLoadingWatchdog();
    broadcast('wa:status', 'disconnected');
  });

  client.on('auth_failure', (msg) => {
    status = 'error';
    clearLoadingWatchdog();
    broadcast('wa:status', 'error');
    console.error('[WA auth_failure]', msg);
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
function getStatus() { return status; }

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

async function sendMessage(chatId, text) {
  if (status !== 'ready') throw new Error('WhatsApp not ready');
  await client.sendMessage(chatId, text);
}

async function markChatRead(chatId) {
  if (status !== 'ready') return;
  try {
    const chat = await client.getChatById(chatId);
    await chat.sendSeen();
  } catch (e) { /* ignore */ }
}

async function sendFile(chatId, filePath) {
  if (status !== 'ready') throw new Error('WhatsApp not ready');
  const { MessageMedia } = require('whatsapp-web.js');
  const media = MessageMedia.fromFilePath(filePath);
  await client.sendMessage(chatId, media);
}

async function sendSticker(chatId, filePath) {
  if (status !== 'ready') throw new Error('WhatsApp not ready');
  const { MessageMedia } = require('whatsapp-web.js');
  const media = MessageMedia.fromFilePath(filePath);
  await client.sendMessage(chatId, media, { sendMediaAsSticker: true });
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

async function getContactAvatar(id) {
  if (status !== 'ready') return null;
  try {
    const contact = await client.getContactById(id);
    return await contact.getProfilePicUrl() || null;
  } catch (e) { return null; }
}

async function logout() {
  clearLoadingWatchdog();
  try { await client.logout(); } catch (e) {}
  try { if (client) await client.destroy(); } catch (e) {}
  client = null;
  status = 'disconnected';
  currentQR = null;
  broadcast('wa:status', 'disconnected');
}

async function shutdown() {
  clearLoadingWatchdog();
  try { if (client) await client.destroy(); } catch (e) {}
  status = 'disconnected';
}

module.exports = { init, getQR, getStatus, getChats, getMessages, sendMessage, sendFile, sendSticker, markChatRead, getMyProfile, getContactAvatar, logout, shutdown };

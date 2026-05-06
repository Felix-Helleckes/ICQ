/**
 * Telegram bridge using GramJS (telegram npm package)
 * Runs in the Electron main process.
 * Supports both phone+code login AND QR code login (with optional 2FA).
 */
const { TelegramClient, utils: tgUtils } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const { BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

let SESSION_FILE     = path.join(__dirname, '../data/telegram.session');
let CREDENTIALS_FILE = path.join(__dirname, '../data/telegram-credentials.json');

// Fallback: Telegram Desktop open-source credentials (publicly available on GitHub)
// Users can override via env vars or the credentials file.
const DEFAULT_API_ID   = 2040;
const DEFAULT_API_HASH = 'b18441a1ff607e10a989891a5462e627';

let API_ID   = parseInt(process.env.TG_API_ID   || '0', 10) || DEFAULT_API_ID;
let API_HASH =          process.env.TG_API_HASH  || DEFAULT_API_HASH;

function loadCredentials() {
  try {
    const raw = fs.readFileSync(CREDENTIALS_FILE, 'utf8');
    const { apiId, apiHash } = JSON.parse(raw);
    if (apiId && apiHash) { API_ID = parseInt(apiId, 10); API_HASH = apiHash; }
  } catch {}
}

function saveCredentials(apiId, apiHash) {
  fs.mkdirSync(path.dirname(CREDENTIALS_FILE), { recursive: true });
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify({ apiId, apiHash }), 'utf8');
}

let tgClient = null;
let mainWin  = null;
let status   = 'disconnected';
let phoneHash = null;
let pending2FAResolve = null;
let pending2FAReject  = null;
let onAvatarCb = null;

function broadcast(channel, data) {
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed()) w.webContents.send(channel, data);
  });
  if (channel === 'tg:avatar' && onAvatarCb) onAvatarCb(data.id, data.avatar);
}

function loadSession() {
  try { return fs.readFileSync(SESSION_FILE, 'utf8').trim(); } catch { return ''; }
}
function saveSession(str) {
  fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
  fs.writeFileSync(SESSION_FILE, str, 'utf8');
}

async function init(win, avatarCallback, dataDir) {
  if (dataDir) {
    SESSION_FILE     = path.join(dataDir, 'telegram.session');
    CREDENTIALS_FILE = path.join(dataDir, 'telegram-credentials.json');
  }
  if (avatarCallback) onAvatarCb = avatarCallback;
  if (avatarCallback) onAvatarCb = avatarCallback;
  mainWin = win;
  loadCredentials(); // load from file, overrides defaults if present
  await connect();
}

async function connect() {
  const session = new StringSession(loadSession());
  tgClient = new TelegramClient(session, API_ID, API_HASH, {
    connectionRetries: 5,
  });

  await tgClient.connect();
  if (await tgClient.isUserAuthorized()) {
    status = 'ready';
    saveSession(tgClient.session.save());
    const me = await getMe();
    broadcast('tg:ready', me || {});
    listenForMessages();
  } else {
    status = 'needs-auth';
    broadcast('tg:status', 'needs-auth');
  }
}

async function setCredentials(apiId, apiHash) {
  API_ID   = parseInt(apiId, 10);
  API_HASH = apiHash;
  saveCredentials(API_ID, API_HASH);
  tgClient = null;
  status = 'disconnected';
  await connect();
}

// ── Phone + code login ────────────────────────────────────────
async function requestCode(phone) {
  if (!tgClient) throw new Error('Telegram not initialized');
  const result = await tgClient.sendCode({ apiId: API_ID, apiHash: API_HASH }, phone);
  phoneHash = result.phoneCodeHash;
  return result.phoneCodeHash;
}

async function signIn(phone, code, hash) {
  await tgClient.signIn({ phoneNumber: phone, phoneCode: code, phoneCodeHash: hash || phoneHash });
  saveSession(tgClient.session.save());
  status = 'ready';
  listenForMessages();
  return { success: true };
}

// ── QR code login ─────────────────────────────────────────────
async function startQRLogin() {
  if (!tgClient) throw new Error('Telegram not initialized');
  status = 'qr';

  try {
    await tgClient.signInUserWithQrCode(
      { apiId: API_ID, apiHash: API_HASH },
      {
        // Called every time a new QR token is issued (~30s expiry)
        qrCode: async ({ token }) => {
          const tokenB64 = Buffer.from(token).toString('base64url');
          const qrLink   = `tg://login?token=${tokenB64}`;
          broadcast('tg:qr', qrLink);
        },
        password: async (hint) => {
          broadcast('tg:2fa-needed', { hint: hint || '' });
          return new Promise((resolve, reject) => {
            pending2FAResolve = resolve;
            pending2FAReject  = reject;
          });
        },
        onError: async (err) => {
          console.error('[TG QR]', err.message);
          // Return false = keep trying; true = stop
          return false;
        },
      }
    );

    saveSession(tgClient.session.save());
    status = 'ready';
    const me = await getMe();
    broadcast('tg:ready', me || {});
    listenForMessages();
  } catch (err) {
    status = 'needs-auth';
    throw err;
  }
}

// Called from IPC when the user submits their 2FA password
function submit2FA(password) {
  if (pending2FAResolve) {
    pending2FAResolve(password);
    pending2FAResolve = null;
    pending2FAReject  = null;
  }
}

function listenForMessages() {
  tgClient.addEventHandler(async (event) => {
    const msg = event.message;
    // getPeerId gibt dieselbe kanonische ID wie d.id in getDialogs() zurück
    // (für Kanäle z.B. -1001234567890, für User positive Zahl)
    let chatId;
    try { chatId = tgUtils.getPeerId(msg.peerId)?.toString(); } catch (e) {}
    if (!chatId) chatId = msg.chatId?.toString();
    broadcast('tg:message', {
      chatId,
      body: msg.message,
      fromMe: msg.out,
      timestamp: msg.date,
      id: msg.id?.toString(),
    });
  }, new NewMessage({}));
}

function getStatus() { return status; }

async function getDialogs() {
  if (status !== 'ready') return [];
  const dialogs = await tgClient.getDialogs({ limit: 50 });
  // Sofort ohne Avatare zurückgeben
  const result = dialogs.map(d => ({
    id: d.id?.toString(),
    name: d.name || d.title,
    lastMessage: d.message?.message || '',
    timestamp: d.message?.date || 0,
    unreadCount: d.unreadCount,
    isGroup: d.isGroup || d.isChannel,
    avatar: null,
  }));
  // Avatare im Hintergrund nachladen
  (async () => {
    for (const d of dialogs) {
      try {
        const buf = await tgClient.downloadProfilePhoto(d.entity, { isBig: false });
        if (buf && buf.length > 0) {
          const avatar = 'data:image/jpeg;base64,' + buf.toString('base64');
          broadcast('tg:avatar', { id: d.id?.toString(), avatar });
        }
      } catch (e) { /* no pic */ }
    }
  })();
  return result;
}

// GramJS braucht BigInt (nicht String) als Peer-ID
function toPeer(id) {
  try { return BigInt(id); } catch (e) { return id; }
}

async function getContactAvatar(id) {
  if (status !== 'ready') return null;
  try {
    const buf = await tgClient.downloadProfilePhoto(toPeer(id), { isBig: false });
    if (buf && buf.length > 0) return 'data:image/jpeg;base64,' + buf.toString('base64');
  } catch (e) {}
  return null;
}

async function getMessages(chatId) {
  if (status !== 'ready') return [];
  const messages = await tgClient.getMessages(toPeer(chatId), { limit: 50 });
  return await Promise.all(messages.map(async m => {
    let mediaData = null;
    let mediaType = null;
    let isGif = false;
    try {
      if (m.photo) {
        const buf = await tgClient.downloadMedia(m, { outputFile: Buffer.alloc(0) });
        if (buf && buf.length) mediaData = 'data:image/jpeg;base64,' + buf.toString('base64');
        mediaType = 'image';
      } else if (m.document) {
        const mime = m.document.mimeType || '';
        const attrs = m.document.attributes || [];
        const isVideoAttr = attrs.some(a => a.className === 'DocumentAttributeVideo');
        const isAnimated  = attrs.some(a => a.className === 'DocumentAttributeAnimated');
        isGif = isAnimated || mime === 'image/gif';
        if (mime.startsWith('video/') || mime === 'image/gif' || isAnimated) {
          mediaType = 'video';
          const buf = await tgClient.downloadMedia(m, { outputFile: Buffer.alloc(0) });
          if (buf && buf.length) mediaData = `data:${mime};base64,` + buf.toString('base64');
        }
      }
    } catch (e) { /* skip media errors */ }
    return {
      id: m.id?.toString(),
      body: m.message || '',
      fromMe: m.out,
      timestamp: m.date,
      author: m.fromId?.userId?.toString() || '',
      type: mediaType || 'text',
      isGif,
      mediaData,
    };
  }));
}

async function sendMessage(chatId, text) {
  if (status !== 'ready') throw new Error('Telegram not ready');
  await tgClient.sendMessage(toPeer(chatId), { message: text });
}

async function sendFile(chatId, filePath) {
  if (status !== 'ready') throw new Error('Telegram not ready');
  await tgClient.sendFile(toPeer(chatId), { file: filePath });
}

async function markChatRead(chatId) {
  if (status !== 'ready') return;
  try {
    const { Api } = require('telegram');
    const peer = toPeer(chatId);
    // Try channels.ReadHistory first (groups/channels), fall back to messages.ReadHistory
    try {
      await tgClient.invoke(new Api.channels.ReadHistory({ channel: peer, maxId: 0 }));
    } catch (e) {
      await tgClient.invoke(new Api.messages.ReadHistory({ peer, maxId: 0 }));
    }
  } catch (e) { /* ignore */ }
}

async function getMe() {
  if (!tgClient) return null;
  try {
    const me = await tgClient.getMe();
    let avatar = null;
    try {
      const buf = await tgClient.downloadProfilePhoto(me, { isBig: false });
      if (buf && buf.length > 0) avatar = 'data:image/jpeg;base64,' + buf.toString('base64');
    } catch (e) {}
    return { name: (me.firstName || '') + (me.lastName ? ' ' + me.lastName : ''), avatar };
  } catch (e) { return null; }
}

async function logout() {
  try { await tgClient.invoke(new (require('telegram/tl').functions.auth.LogOutRequest)()); } catch (e) {}
  try { fs.unlinkSync(SESSION_FILE); } catch (e) {}
  status = 'needs-auth';
  tgClient = null;
}

module.exports = { init, requestCode, signIn, startQRLogin, submit2FA, getStatus, getDialogs, getMessages, sendMessage, sendFile, markChatRead, getMe, logout, setCredentials, getContactAvatar };

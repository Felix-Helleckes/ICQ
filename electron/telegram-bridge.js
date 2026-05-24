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
const os = require('os');

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
  // tgClient can be null after logout — reinitialize if needed
  if (!tgClient) await connect();
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
    let mediaData = null;
    let type = 'text';
    try {
      const attrs = msg.document?.attributes || [];
      const isSticker = attrs.some(a => a.className === 'DocumentAttributeSticker');
      if (isSticker) {
        const mime = msg.document?.mimeType || 'image/webp';
        const buf = await tgClient.downloadMedia(msg, { outputFile: Buffer.alloc(0) });
        if (buf && buf.length) {
          mediaData = `data:${mime};base64,` + buf.toString('base64');
          type = 'sticker';
        }
      }
    } catch (e) { /* ignore media download errors */ }

    broadcast('tg:message', {
      chatId,
      body: msg.message,
      fromMe: msg.out,
      timestamp: msg.date,
      id: msg.id?.toString(),
      type,
      mediaData,
    });
    try {
      broadcast('tg:chat-update', {
        id: chatId,
        lastMessage: msg.message || '',
        timestamp: msg.date || Math.floor(Date.now()/1000),
        unreadCount: undefined,
        isGroup: false,
        archived: false,
      });
    } catch (e) {}
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
    archived: Boolean(d.archived || d.isArchived || d.isHidden || false),
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

async function getMessages(chatId, opts = {}) {
  if (status !== 'ready') return [];
  const limit = Number.isFinite(opts.limit) ? Math.max(1, Math.min(100, opts.limit)) : 50;
  const minId = opts.minId ? Number(opts.minId) : 0;
  const messages = await tgClient.getMessages(toPeer(chatId), { limit, minId });

  const results = [];
  for (const m of messages) {
    let mediaData = null;
    let mediaType = null;
    let isGif = false;
    try {
      if (m.photo) {
        // Only download small photos to avoid flood wait
        const buf = await tgClient.downloadMedia(m, { outputFile: Buffer.alloc(0), thumb: -1 });
        if (buf && buf.length) mediaData = 'data:image/jpeg;base64,' + buf.toString('base64');
        mediaType = 'image';
      } else if (m.document) {
        const mime = m.document.mimeType || '';
        const attrs = m.document.attributes || [];
        const isSticker = attrs.some(a => a.className === 'DocumentAttributeSticker');
        const isAnimated  = attrs.some(a => a.className === 'DocumentAttributeAnimated');
        isGif = isAnimated || mime === 'image/gif';
        const isVoice = attrs.some(a => a.className === 'DocumentAttributeAudio' && a.voice);
        const isAudio = attrs.some(a => a.className === 'DocumentAttributeAudio');
        if (isSticker) {
          mediaType = 'sticker';
          const buf = await tgClient.downloadMedia(m, { outputFile: Buffer.alloc(0) });
          if (buf && buf.length) mediaData = `data:${mime || 'image/webp'};base64,` + buf.toString('base64');
        } else if (isVoice || isAudio || mime.startsWith('audio/')) {
          // Only download audio/voice — skip large video on initial load
          mediaType = isVoice ? 'ptt' : 'audio';
          const buf = await tgClient.downloadMedia(m, { outputFile: Buffer.alloc(0) });
          if (buf && buf.length) mediaData = `data:${mime || 'audio/ogg'};base64,` + buf.toString('base64');
        } else if (mime.startsWith('video/') || mime === 'image/gif' || isAnimated) {
          // Mark as video but don't download inline — too large, causes flood wait
          mediaType = 'video';
        }
      }
    } catch (e) { /* skip media errors */ }
    results.push({
      id: m.id?.toString(),
      body: m.message || '',
      fromMe: m.out,
      timestamp: m.date,
      author: m.fromId?.userId?.toString() || '',
      type: mediaType || 'text',
      isGif,
      mediaData,
    });
  }
  return results;
}

async function sendMessage(chatId, text) {
  if (status !== 'ready') throw new Error('Telegram not ready');
  const msg = await tgClient.sendMessage(toPeer(chatId), { message: text });
  return {
    id: msg?.id?.toString?.() || null,
    timestamp: msg?.date || Math.floor(Date.now() / 1000),
    body: msg?.message || text,
    fromMe: true,
    type: 'text',
  };
}

async function sendFile(chatId, filePath) {
  if (status !== 'ready') throw new Error('Telegram not ready');
  const msg = await tgClient.sendFile(toPeer(chatId), { file: filePath });
  return {
    id: msg?.id?.toString?.() || null,
    timestamp: msg?.date || Math.floor(Date.now() / 1000),
    fromMe: true,
    body: msg?.message || '',
    type: 'file',
  };
}

async function sendSticker(chatId, filePath) {
  if (status !== 'ready') throw new Error('Telegram not ready');
  const { Api } = require('telegram');
  try {
    const msg = await tgClient.sendFile(toPeer(chatId), {
      file: filePath,
      forceDocument: true,
      attributes: [
        new Api.DocumentAttributeSticker({
          alt: '',
          stickerset: new Api.InputStickerSetEmpty(),
        }),
      ],
    });
    return {
      id: msg?.id?.toString?.() || null,
      timestamp: msg?.date || Math.floor(Date.now() / 1000),
      fromMe: true,
      body: msg?.message || '',
      type: 'sticker',
    };
  } catch (e) {
    // Fallback: send as a regular file if sticker attributes are rejected by server.
    const msg = await tgClient.sendFile(toPeer(chatId), { file: filePath });
    return {
      id: msg?.id?.toString?.() || null,
      timestamp: msg?.date || Math.floor(Date.now() / 1000),
      fromMe: true,
      body: msg?.message || '',
      type: 'file',
    };
  }
}

async function sendVoice(chatId, base64Data, mimeType) {
  if (status !== 'ready') throw new Error('Telegram not ready');
  const buf = Buffer.from(base64Data || '', 'base64');
  // GramJS sendFile supports voiceNote option
  const msg = await tgClient.sendFile(toPeer(chatId), { file: buf, voiceNote: true });
  return {
    id: msg?.id?.toString?.() || null,
    timestamp: msg?.date || Math.floor(Date.now() / 1000),
    fromMe: true,
    body: msg?.message || '',
    type: 'ptt',
  };
}

async function editMessage(chatId, messageId, newText) {
  if (status !== 'ready') throw new Error('Telegram not ready');
  if (!messageId) throw new Error('Missing message id');
  const { Api } = require('telegram');
  await tgClient.invoke(new Api.messages.EditMessage({
    peer: toPeer(chatId),
    id: Number(messageId),
    message: newText,
    noWebpage: true,
  }));
  return true;
}

async function deleteMessage(chatId, messageId, revoke = true) {
  if (status !== 'ready') throw new Error('Telegram not ready');
  if (!messageId) throw new Error('Missing message id');
  await tgClient.deleteMessages(toPeer(chatId), [Number(messageId)], { revoke: Boolean(revoke) });
  return true;
}

async function getRecentStickers(limit = 24) {
  if (status !== 'ready') return [];
  const { Api } = require('telegram');
  let result;
  try {
    result = await tgClient.invoke(new Api.messages.GetRecentStickers({ attached: false, hash: BigInt(0) }));
  } catch (e) {
    return [];
  }

  const docs = Array.isArray(result?.stickers) ? result.stickers.slice(0, Math.max(1, Math.min(50, limit))) : [];
  const out = [];
  const baseDir = path.join(os.tmpdir(), 'icq-tg-stickers');
  try { fs.mkdirSync(baseDir, { recursive: true }); } catch (e) {}

  for (const doc of docs) {
    const mimeType = doc?.mimeType || 'image/webp';
    // Lottie tgs cannot be rendered in our current UI without an additional player.
    if (mimeType === 'application/x-tgsticker') continue;
    try {
      const buf = await tgClient.downloadMedia(doc, { outputFile: Buffer.alloc(0) });
      if (!buf || !buf.length) continue;
      const ext =
        mimeType === 'image/webp' ? 'webp' :
        mimeType === 'image/png' ? 'png' :
        mimeType === 'image/jpeg' ? 'jpg' :
        mimeType === 'image/gif' ? 'gif' :
        mimeType.startsWith('video/') ? 'webm' : 'bin';
      const filePath = path.join(baseDir, `${doc.id.toString()}.${ext}`);
      try { fs.writeFileSync(filePath, Buffer.from(buf)); } catch (e) { continue; }

      const attrs = Array.isArray(doc.attributes) ? doc.attributes : [];
      const stickerAttr = attrs.find(a => a.className === 'DocumentAttributeSticker');
      const emoji = stickerAttr?.alt || '';

      out.push({
        id: doc.id.toString(),
        emoji,
        mimeType,
        type: mimeType.startsWith('video/') ? 'video' : 'image',
        previewData: `data:${mimeType};base64,${Buffer.from(buf).toString('base64')}`,
        filePath,
      });
    } catch (e) {
      // Ignore broken sticker entries
    }
  }

  return out;
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
  // Reinitialize an unauthenticated client so the next login attempt works immediately
  await connect();
}

async function shutdown() {
  try { if (tgClient) await tgClient.disconnect(); } catch (e) {}
  status = 'disconnected';
}

module.exports = {
  init,
  requestCode,
  signIn,
  startQRLogin,
  submit2FA,
  getStatus,
  getDialogs,
  getMessages,
  sendMessage,
  sendFile,
  sendSticker,
  sendVoice,
  editMessage,
  deleteMessage,
  getRecentStickers,
  markChatRead,
  getMe,
  logout,
  shutdown,
  setCredentials,
  getContactAvatar,
};

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
const { buildTelegramVoice } = require('./lib/tg-voice');
const { createMediaCache } = require('./lib/media-cache');

// Downloaded media by chat+message. The chat window refreshes every 8 s and this
// used to download every photo, sticker and voice note of the last 40 messages
// again each time — heavy traffic that runs into Telegram's flood-wait limits.
const mediaCache = createMediaCache();

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

// Test seam (like __setBaileysForTests in the WhatsApp bridge): the suite swaps in
// a fake client so login, sending and logout run without network or account.
let makeClient = (session) => new TelegramClient(session, API_ID, API_HASH, { connectionRetries: 5 });
function __setTelegramForTests({ clientFactory }) { makeClient = clientFactory; }

async function connect() {
  const session = new StringSession(loadSession());
  tgClient = makeClient(session);

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

/** End a client for good — a merely dropped one keeps its connection and its
 *  message handler, which then pushes messages into the UI after a logout. */
async function retireClient() {
  const old = tgClient;
  tgClient = null;
  if (!old) return;
  try { await (old.destroy ? old.destroy() : old.disconnect()); } catch (e) { /* already gone */ }
}

async function setCredentials(apiId, apiHash) {
  API_ID   = parseInt(apiId, 10);
  API_HASH = apiHash;
  saveCredentials(API_ID, API_HASH);
  await retireClient();
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

// The 2FA prompt shared by both login paths: the UI asks, submit2FA() answers.
function askFor2FA(hint) {
  broadcast('tg:2fa-needed', { hint: hint || '' });
  return new Promise((resolve, reject) => {
    pending2FAResolve = resolve;
    pending2FAReject  = reject;
  });
}

async function signIn(phone, code, hash) {
  if (!tgClient) throw new Error('Telegram not initialized');
  // gramjs has no client.signIn — this path threw a TypeError since the first
  // release. The raw auth.signIn matches the UI's two steps (code requested
  // first, entered later).
  const { Api } = require('telegram');
  try {
    const result = await tgClient.invoke(new Api.auth.SignIn({
      phoneNumber: String(phone),
      phoneCodeHash: hash || phoneHash,
      phoneCode: String(code),
    }));
    if (result instanceof Api.auth.AuthorizationSignUpRequired) {
      throw new Error('Für diese Nummer gibt es noch kein Telegram-Konto — bitte erst in der Telegram-App registrieren.');
    }
  } catch (err) {
    if (err?.errorMessage !== 'SESSION_PASSWORD_NEEDED') throw err;
    // Two-step verification: the same prompt as the QR login.
    await tgClient.signInWithPassword(
      { apiId: API_ID, apiHash: API_HASH },
      {
        password: askFor2FA,
        // Wrong password → ask again (false = keep trying).
        onError: async (e) => { console.error('[TG 2FA]', e?.message || e); return false; },
      },
    );
  }
  saveSession(tgClient.session.save());
  status = 'ready';
  const me = await getMe();
  broadcast('tg:ready', me || {});
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

/** The sender as a name (gramjs attaches the user entity it received). */
function senderNameOf(m) {
  try {
    const u = m.sender;
    if (!u || m.out) return undefined;
    return [u.firstName, u.lastName].filter(Boolean).join(' ') || u.title || u.username || undefined;
  } catch (e) { return undefined; }
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
    const cacheKey = `${chatId}:${m.id}`;
    // Download once; later refreshes reuse it, failures are not retried every time.
    const download = async (mime, options = {}) => {
      const hit = mediaCache.get(cacheKey);
      if (hit) return hit;
      if (mediaCache.recentlyFailed(cacheKey)) return null;
      try {
        const buf = await tgClient.downloadMedia(m, { outputFile: Buffer.alloc(0), ...options });
        if (!buf || !buf.length) { mediaCache.markFailed(cacheKey); return null; }
        const url = `data:${mime};base64,` + buf.toString('base64');
        mediaCache.set(cacheKey, url);
        return url;
      } catch (e) { mediaCache.markFailed(cacheKey); throw e; }
    };
    try {
      if (m.photo) {
        // Only download small photos to avoid flood wait
        mediaData = await download('image/jpeg', { thumb: -1 });
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
          mediaData = await download(mime || 'image/webp');
        } else if (isVoice || isAudio || mime.startsWith('audio/')) {
          // Only download audio/voice — skip large video on initial load
          mediaType = isVoice ? 'ptt' : 'audio';
          mediaData = await download(mime || 'audio/ogg');
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
      // Shown above group messages; the bare user id meant nothing to anyone.
      senderName: senderNameOf(m),
      type: mediaType || 'text',
      isGif,
      mediaData,
    });
  }
  return results;
}

async function sendMessage(chatId, text, quotedMessageId = null) {
  if (status !== 'ready') throw new Error('Telegram not ready');
  const options = { message: text };
  if (quotedMessageId) {
    options.replyTo = quotedMessageId;
  }
  const msg = await tgClient.sendMessage(toPeer(chatId), options);
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
  // Decide BEFORE sending, and send exactly once. This used to retry as a plain
  // file whenever the first send threw — but a send can throw after the server
  // already accepted it (timeout, lost reply), and then the sticker arrived twice.
  // Telegram takes .webp (and animated .tgs / video .webm) as stickers; anything
  // else goes out as a picture, like on WhatsApp.
  const ext = (String(filePath).split('.').pop() || '').toLowerCase();
  const asSticker = ['webp', 'tgs', 'webm'].includes(ext);
  const msg = await tgClient.sendFile(toPeer(chatId), asSticker
    ? {
      file: filePath,
      forceDocument: true,
      attributes: [new Api.DocumentAttributeSticker({ alt: '', stickerset: new Api.InputStickerSetEmpty() })],
    }
    : { file: filePath });
  return {
    id: msg?.id?.toString?.() || null,
    timestamp: msg?.date || Math.floor(Date.now() / 1000),
    fromMe: true,
    body: msg?.message || '',
    type: asSticker ? 'sticker' : 'image',
  };
}

async function sendVoice(chatId, base64Data, mimeType, waveform) {
  if (status !== 'ready') throw new Error('Telegram not ready');
  // A bare Buffer went out as an 'unnamed' file — see lib/tg-voice.js.
  const { Api } = require('telegram');
  const { CustomFile } = require('telegram/client/uploads');
  const voice = buildTelegramVoice(base64Data, mimeType, waveform, { CustomFile, Api });
  const msg = await tgClient.sendFile(toPeer(chatId), voice);
  return {
    id: msg?.id?.toString?.() || null,
    timestamp: msg?.date || Math.floor(Date.now() / 1000),
    fromMe: true,
    body: msg?.message || '',
    type: 'ptt',
  };
}

async function setArchive(chatId, archive) {
  if (status !== 'ready') return false;
  const { Api } = require('telegram');
  try {
    // Try to obtain an InputPeer for the target chat
    let inputPeer = null;
    try {
      if (typeof tgClient.getInputEntity === 'function') {
        inputPeer = await tgClient.getInputEntity(toPeer(chatId));
      } else if (typeof tgClient.getEntity === 'function') {
        const ent = await tgClient.getEntity(toPeer(chatId));
        // GramJS entities are acceptable as peer in many API calls
        inputPeer = ent;
      }
    } catch (e) {
      inputPeer = null;
    }

    // Fallback: try to build a simple InputPeerUser/Channel/Chat where possible
    if (!inputPeer) {
      const idNum = Number(chatId);
      if (idNum < 0) {
        // channel/group (negative ids in our mapping are already stringified)
        try { inputPeer = new Api.InputPeerChannel({ channelId: BigInt(Math.abs(idNum)), accessHash: BigInt(0) }); } catch (e) { inputPeer = null; }
      } else {
        try { inputPeer = new Api.InputPeerUser({ userId: BigInt(idNum), accessHash: BigInt(0) }); } catch (e) { inputPeer = null; }
      }
    }

    if (!inputPeer) {
      console.warn('[tg setArchive] could not resolve input peer for', chatId);
      return false;
    }

    // Folder id 1 is the Archive folder in Telegram's UI; 0 removes from folders
    const folderId = archive ? 1 : 0;
    // Construct folderPeers parameter. Use plain object form which GramJS can accept.
    const folderPeers = [{ folderId, peer: inputPeer }];
    try {
      await tgClient.invoke(new Api.folders.EditPeerFolders({ folderPeers }));
      // Broadcast an updated chat state so UI can refresh
      broadcast('tg:chat-update', { id: String(chatId), archived: !!archive });
      return true;
    } catch (e) {
      // Some servers or client setups might reject EditPeerFolders; log and return false
      console.error('[tg setArchive invoke EditPeerFolders]', e?.message || e);
      return false;
    }
  } catch (err) {
    console.error('[tg setArchive]', err?.message || err);
    return false;
  }
}

// Block / unblock a user — propagates to Telegram servers (contacts.Block).
async function setBlocked(chatId, blocked) {
  if (status !== 'ready') return false;
  const { Api } = require('telegram');
  try {
    let inputPeer = null;
    try { inputPeer = await tgClient.getInputEntity(toPeer(chatId)); } catch (e) { inputPeer = null; }
    if (!inputPeer) { console.warn('[tg setBlocked] could not resolve peer for', chatId); return false; }
    if (blocked) await tgClient.invoke(new Api.contacts.Block({ id: inputPeer }));
    else await tgClient.invoke(new Api.contacts.Unblock({ id: inputPeer }));
    broadcast('tg:chat-update', { id: String(chatId), blocked: !!blocked });
    return true;
  } catch (err) {
    console.error('[tg setBlocked]', err?.message || err);
    return false;
  }
}

async function isContactBlocked(chatId) {
  if (status !== 'ready') return false;
  const { Api } = require('telegram');
  try {
    const inputPeer = await tgClient.getInputEntity(toPeer(chatId)).catch(() => null);
    if (!inputPeer) return false;
    const full = await tgClient.invoke(new Api.users.GetFullUser({ id: inputPeer }));
    return !!(full && full.fullUser && full.fullUser.blocked);
  } catch (e) { return false; }
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

async function getParticipants(chatId) {
  if (status !== 'ready') return [];
  const { Api } = require('telegram');
  try {
    // Try high-level helper if available
    if (typeof tgClient.getParticipants === 'function') {
      const list = await tgClient.getParticipants(toPeer(chatId), { limit: 200 });
      return (list || []).map(p => ({
        id: p.userId?.toString?.() || String(p.user?.id || ''),
        name: `${p.user?.firstName || ''} ${p.user?.lastName || ''}`.trim(),
        isAdmin: !!p.rank,
        online: !!(p.user?.status && String((p.user.status && p.user.status.className) || '').includes('UserStatusOnline')),
      }));
    }
    // Fallback: try messages.GetFullChat for small groups
    try {
      const full = await tgClient.invoke(new Api.messages.GetFullChat({ chatId: Number(chatId) }));
      const users = (full?.users || []).map(u => ({
        id: String(u.id),
        name: `${u.firstName || ''} ${u.lastName || ''}`.trim(),
        isAdmin: false,
        online: !!(u.status && String((u.status && u.status.className) || '').includes('UserStatusOnline')),
      }));
      return users;
    } catch (e) {
      return [];
    }
  } catch (err) {
    console.error('[tg getParticipants]', err?.message || err);
    return [];
  }
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
  // Ends the session on Telegram's side too. The old call referenced an API that
  // does not exist, so the session stayed valid on the server — any copy of
  // telegram.session (a copied portable folder, a backup) kept working.
  const { Api } = require('telegram');
  try { if (tgClient) await tgClient.invoke(new Api.auth.LogOut()); } catch (e) { /* offline: local logout still happens */ }
  try { fs.unlinkSync(SESSION_FILE); } catch (e) {}
  mediaCache.clear();
  status = 'needs-auth';
  await retireClient();
  // Reinitialize an unauthenticated client so the next login attempt works immediately
  await connect();
}

async function shutdown() {
  try { if (tgClient) await tgClient.disconnect(); } catch (e) {}
  status = 'disconnected';
}

module.exports = {
  __setTelegramForTests,
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
  setArchive,
  setBlocked,
  isContactBlocked,
  getParticipants,
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

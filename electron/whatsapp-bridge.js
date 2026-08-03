/**
 * WhatsApp bridge built on Baileys (WhatsApp multi-device protocol over WebSocket).
 * Runs in the Electron main process.
 *
 * This replaces the previous whatsapp-web.js/Puppeteer bridge, which drove the real
 * WhatsApp Web app inside a bundled headless Chrome and reached into its private
 * internals. That approach broke every time WhatsApp shipped a web update, needed a
 * 409 MB Chrome, and tied the session to a Chrome profile (version conflicts, stale
 * locks, orphaned processes). Baileys speaks the protocol directly — no browser.
 *
 * The public API and every 'wa:*' broadcast channel are unchanged, so main.js and the
 * renderer keep working as before.
 *
 * Baileys v7 removed makeInMemoryStore, so this module keeps its own bounded store of
 * chats/messages/contacts, fed by the history sync and the live event stream.
 */
const { BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { mapMessageEntry, isBacklogMessage } = require('./lib/message-entry');
const { mapChatEntry } = require('./lib/chat-entry');
const { createContactDirectory } = require('./lib/contact-names');
const { ackFromStatus, statusFromReceipt, createAckTracker } = require('./lib/ack');

// Logging helper: append to temp startup log for easier debugging across restarts
const STARTUP_LOG = path.join(os.tmpdir(), 'icq-startup.log');
function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`;
  try { fs.appendFileSync(STARTUP_LOG, line + '\n'); } catch (e) {}
  try { console.log(...args); } catch (e) {}
}

// Baileys expects a pino-like logger. Providing our own keeps its very chatty debug
// output out of the app log while still surfacing real errors.
const waLogger = {
  level: 'silent',
  child() { return waLogger; },
  trace() {}, debug() {}, info() {},
  warn(...a) { try { console.warn('[WA]', ...a); } catch (e) {} },
  error(...a) { try { console.error('[WA]', ...a); } catch (e) {} },
  fatal(...a) { try { console.error('[WA fatal]', ...a); } catch (e) {} },
};

// Baileys v7 is a pure ESM package. Electron's Node (20.x in Electron 29) cannot
// require() ESM, so it is loaded lazily via dynamic import — which Electron does
// support. `BA` is populated by init() before any other code path touches it.
let BA = null;
async function loadBaileys() {
  if (!BA) BA = await import('@whiskeysockets/baileys');
  return BA;
}

let sock = null;
let status = 'disconnected';
let currentQR = null;
let onAvatarCb = null;
let lastDataDir = null;
let saveCreds = null;
let waManualLogout = false;   // true only while logout() runs — prevents auto-reconnect
let reconnectTimer = null;
let reconnectAttempt = 0;
let readyAtSec = 0;           // when the socket last opened — tags replayed backlog messages
let meId = null;
let connectionOpen = false;   // socket is up; 'ready' may still be waiting for history
let historySeen = false;      // at least one history chunk with chats has arrived
let readyTimer = null;        // fallback so an account without history still becomes ready
let chatsChangedTimer = null; // debounces the "reload your chat list" signal

const MAX_MSGS_PER_CHAT = 200; // bounded store — history sync can deliver a lot

// ── Store (Baileys v7 has no built-in store) ──────────────────────────────
const chatStore = new Map();     // jid → chat record
const messageStore = new Map();  // jid → Map<msgId, WAMessage>
const contacts = createContactDirectory(); // names + LID↔phone mapping
const ackTracker = createAckTracker();     // highest delivery state seen per message
const blockedSet = new Set();

function resetStore() {
  chatStore.clear();
  messageStore.clear();
  contacts.clear();
  blockedSet.clear();
  ackStore.clear();
}

function broadcast(channel, data) {
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed()) w.webContents.send(channel, data);
  });
  if (channel === 'wa:avatar' && onAvatarCb) onAvatarCb(data.id, data.avatar);
}

function setStatus(next) {
  if (status === next) return;
  status = next;
  broadcast('wa:status', next);
}

// ── Conversions ───────────────────────────────────────────────────────────

// Ack mapping + the "never move backwards" rule live in lib/ack.js (tested there).
function ackOf(m) {
  const computed = ackFromStatus(m?.status, !!m?.key?.fromMe);
  return ackTracker.resolve(m?.key?.id, computed);
}

// Record and publish a delivery state. Acks only ever move forward.
function applyAck(jid, id, status, fromMe) {
  const ack = ackFromStatus(status, fromMe);
  if (ackTracker.record(id, ack) == null) return; // not a forward move — ignore
  const bucket = jid ? messageStore.get(jid) : null;
  if (bucket?.has(id)) bucket.set(id, { ...bucket.get(id), status });
  broadcast('wa:ack', { id, ack });
  log('WA ack', { id, ack });
}

// Baileys message content type → the type strings the UI switches on
function typeOf(m) {
  const t = BA.getContentType(m?.message || {});
  switch (t) {
    case 'imageMessage': return 'image';
    case 'videoMessage': return m?.message?.videoMessage?.gifPlayback ? 'video' : 'video';
    case 'stickerMessage': return 'sticker';
    case 'audioMessage': return m?.message?.audioMessage?.ptt ? 'ptt' : 'audio';
    case 'documentMessage':
    case 'documentWithCaptionMessage': return 'document';
    default: return 'chat';
  }
}

function bodyOf(m) {
  const msg = m?.message || {};
  const inner = msg.ephemeralMessage?.message || msg.viewOnceMessage?.message
    || msg.viewOnceMessageV2?.message || msg.documentWithCaptionMessage?.message || msg;
  return (
    inner.conversation
    || inner.extendedTextMessage?.text
    || inner.imageMessage?.caption
    || inner.videoMessage?.caption
    || inner.documentMessage?.caption
    || inner.documentMessage?.fileName
    || ''
  );
}

const MEDIA_TYPES = new Set(['image', 'video', 'sticker', 'ptt', 'audio', 'document']);

// WAMessage → the flat shape the renderer uses. mapMessageEntry normalizes the rest.
function toMessageEntry(m) {
  const type = typeOf(m);
  return mapMessageEntry({
    id: m?.key?.id,
    body: bodyOf(m),
    fromMe: !!m?.key?.fromMe,
    timestamp: Number(m?.messageTimestamp?.low ?? m?.messageTimestamp ?? 0),
    author: m?.key?.participant || m?.participant || m?.key?.remoteJid,
    type,
    isGif: !!m?.message?.videoMessage?.gifPlayback,
    ack: ackOf(m),
    hasMedia: MEDIA_TYPES.has(type),
  });
}

// Name lookup lives in lib/contact-names.js (LID↔phone handling is subtle enough to
// deserve its own tests). These thin wrappers keep the call sites readable.
const rememberLidMapping = (m) => contacts.rememberMapping(m);
const rememberContact = (c) => contacts.rememberContact(c);
const displayNameFor = (jid) => contacts.nameFor(jid);
const prettyIdFor = (jid) => contacts.prettyIdFor(jid);

function chatEntryFor(jid) {
  const c = chatStore.get(jid) || {};
  const msgs = messageStore.get(jid);
  let last = null;
  if (msgs && msgs.size) {
    for (const m of msgs.values()) {
      const t = Number(m?.messageTimestamp?.low ?? m?.messageTimestamp ?? 0);
      if (!last || t >= last.t) last = { t, body: bodyOf(m) };
    }
  }
  return mapChatEntry({
    id: { _serialized: jid },
    // prettyIdFor is the floor: mapChatEntry would otherwise fall back to the raw
    // JID, which is what put "4917...@s.whatsapp.net" in the contact list.
    name: c.name || displayNameFor(jid) || prettyIdFor(jid),
    lastMessage: last ? { body: last.body, t: last.t } : null,
    unreadCount: Math.max(0, Number(c.unreadCount) || 0),
    isGroup: jid.endsWith('@g.us'),
    archive: !!c.archived,
    t: Number(c.conversationTimestamp?.low ?? c.conversationTimestamp ?? 0),
  });
}

// ── Store maintenance ─────────────────────────────────────────────────────

function upsertChat(c) {
  if (!c?.id) return;
  const prev = chatStore.get(c.id) || {};
  chatStore.set(c.id, { ...prev, ...c });
}

function storeMessages(list) {
  for (const m of list || []) {
    const jid = m?.key?.remoteJid;
    const id = m?.key?.id;
    if (!jid || !id) continue;
    if (!messageStore.has(jid)) messageStore.set(jid, new Map());
    const bucket = messageStore.get(jid);
    bucket.set(id, { ...(bucket.get(id) || {}), ...m });
    if (bucket.size > MAX_MSGS_PER_CHAT) {
      // drop the oldest by timestamp
      const sorted = [...bucket.entries()].sort(
        (a, b) => Number(a[1]?.messageTimestamp?.low ?? a[1]?.messageTimestamp ?? 0)
                - Number(b[1]?.messageTimestamp?.low ?? b[1]?.messageTimestamp ?? 0),
      );
      for (let i = 0; i < sorted.length - MAX_MSGS_PER_CHAT; i += 1) bucket.delete(sorted[i][0]);
    }
    // Make sure a chat exists for every message we know about.
    if (!chatStore.has(jid)) upsertChat({ id: jid, conversationTimestamp: m.messageTimestamp });
  }
}

function sortedChatJids() {
  return [...chatStore.keys()].sort((a, b) => {
    const ta = chatEntryFor(a).timestamp || 0;
    const tb = chatEntryFor(b).timestamp || 0;
    return tb - ta;
  });
}

// ── Connection ────────────────────────────────────────────────────────────

function sessionDir(dataDir) {
  return path.join(dataDir, 'whatsapp', 'baileys-auth');
}

function clearReconnectTimer() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
}

function scheduleReconnect(dataDir) {
  if (waManualLogout) return;
  clearReconnectTimer();
  // Back off gently: 2s, 4s, 8s … capped at 30s.
  const delay = Math.min(30000, 2000 * Math.pow(2, Math.min(reconnectAttempt, 4)));
  reconnectAttempt += 1;
  log('WA reconnect scheduled', { attempt: reconnectAttempt, delay });
  reconnectTimer = setTimeout(() => init(onAvatarCb, dataDir || lastDataDir), delay);
}

async function init(avatarCallback, dataDir) {
  if (avatarCallback) onAvatarCb = avatarCallback;
  lastDataDir = dataDir;
  clearReconnectTimer();
  setStatus('loading');

  try {
    await loadBaileys();
  } catch (e) {
    log('WA baileys import failed', String(e?.message || e));
    setStatus('error');
    return;
  }

  const authDir = sessionDir(dataDir);
  try { fs.mkdirSync(authDir, { recursive: true }); } catch (e) {}

  let state;
  try {
    const auth = await BA.useMultiFileAuthState(authDir);
    state = auth.state;
    saveCreds = auth.saveCreds;
  } catch (e) {
    log('WA auth state failed', String(e?.message || e));
    setStatus('error');
    return;
  }

  log('WA init', { dataDir, authDir });

  try {
    sock = BA.default({
      auth: {
        creds: state.creds,
        keys: BA.makeCacheableSignalKeyStore(state.keys, waLogger),
      },
      logger: waLogger,
      // Identify as a desktop client so WhatsApp lists it sensibly under linked devices.
      browser: BA.Browsers.appropriate('Desktop'),
      markOnlineOnConnect: false, // don't steal notifications from the phone
      syncFullHistory: false,     // recent history is enough and syncs far quicker
      generateHighQualityLinkPreview: false,
      // Needed for message retries: Baileys asks us for a message it must re-send.
      getMessage: async (key) => {
        const bucket = messageStore.get(key?.remoteJid);
        return bucket?.get(key?.id)?.message || undefined;
      },
    });
  } catch (e) {
    log('WA socket creation failed', String(e?.message || e));
    setStatus('error');
    scheduleReconnect(dataDir);
    return;
  }

  wireEvents(dataDir);
}

// Report 'ready' exactly once per connection, once there is something to show.
function announceReady() {
  if (status === 'ready') return;
  clearTimeout(readyTimer);
  readyTimer = null;
  setStatus('ready');
  broadcast('wa:ready', { name: sock?.user?.name || sock?.user?.verifiedName || null });
  log('WA event', 'ready', { chats: chatStore.size });
}

// Tell the renderer its cached chat list is stale. History arrives in chunks well
// after the first one, and without this the list would keep showing the first chunk.
// Debounced so a burst of chunks triggers a single refresh.
function signalChatsChanged() {
  clearTimeout(chatsChangedTimer);
  chatsChangedTimer = setTimeout(() => {
    chatsChangedTimer = null;
    log('WA chats-updated', { chats: chatStore.size });
    broadcast('wa:chats-updated', { count: chatStore.size });
  }, 1500);
}

function wireEvents(dataDir) {
  sock.ev.on('creds.update', () => { try { saveCreds?.(); } catch (e) {} });

  sock.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect, qr } = u;

    if (qr) {
      currentQR = qr;
      setStatus('qr');
      broadcast('wa:qr', qr);
      log('WA event', 'qr-generated');
    }

    if (connection === 'open') {
      currentQR = null;
      reconnectAttempt = 0;
      readyAtSec = Math.floor(Date.now() / 1000);
      meId = sock.user?.id ? BA.jidNormalizedUser(sock.user.id) : null;
      connectionOpen = true;
      log('WA event', 'connected', { pushname: sock.user?.name, id: meId });

      // Do NOT report 'ready' yet. Unlike whatsapp-web.js — which only fired 'ready'
      // once its store was populated — Baileys opens the socket immediately and
      // streams the chat history in afterwards (seconds later). Announcing ready now
      // makes the UI fetch an almost empty chat list and cache it. Wait for the first
      // history chunk, with a timeout so an account that has no history still starts.
      clearTimeout(readyTimer);
      readyTimer = setTimeout(() => {
        if (connectionOpen && status !== 'ready') {
          log('WA ready (history timeout)', { chats: chatStore.size });
          announceReady();
        }
      }, 12000);

      // Cache our own blocklist so the contact menu can show the right entry.
      try {
        const list = await sock.fetchBlocklist();
        blockedSet.clear();
        for (const j of list || []) blockedSet.add(j);
      } catch (e) { /* not fatal */ }
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = code === BA.DisconnectReason.loggedOut;
      connectionOpen = false;
      historySeen = false;
      clearTimeout(readyTimer);
      readyTimer = null;
      log('WA event', 'disconnected', { code, loggedOut });

      if (waManualLogout) { setStatus('disconnected'); return; }

      if (loggedOut) {
        // The session was revoked (unlinked on the phone). Wipe it so the next
        // start shows a QR instead of retrying with dead credentials forever.
        try { fs.rmSync(sessionDir(dataDir), { recursive: true, force: true }); } catch (e) {}
        resetStore();
        currentQR = null;
        setStatus('disconnected');
        scheduleReconnect(dataDir);
        return;
      }
      setStatus('loading');
      scheduleReconnect(dataDir);
    }
  });

  // Initial history sync — seeds chats, contacts and recent messages. It arrives in
  // several chunks over a few seconds, so this both releases the initial 'ready' and
  // tells the UI to refresh when later chunks add more.
  sock.ev.on('messaging-history.set', ({ chats, contacts, messages, isLatest, lidPnMappings }) => {
    // Mappings first: they let a contact found under one JID form name a chat keyed
    // by the other one.
    for (const m of lidPnMappings || []) rememberLidMapping(m);
    for (const c of chats || []) upsertChat(c);
    for (const c of contacts || []) rememberContact(c);
    storeMessages(messages);
    log('WA history', { chats: chats?.length || 0, contacts: contacts?.length || 0, messages: messages?.length || 0, isLatest: !!isLatest });

    const gotSomething = (chats?.length || 0) > 0 || (contacts?.length || 0) > 0;
    if (!gotSomething) return;
    if (!historySeen) {
      historySeen = true;
      announceReady();
    } else {
      signalChatsChanged();
    }
  });

  sock.ev.on('chats.upsert', (list) => { for (const c of list || []) upsertChat(c); });
  sock.ev.on('chats.update', (list) => {
    for (const c of list || []) {
      if (!c?.id) continue;
      upsertChat(c);
      broadcast('wa:chat-update', {
        id: c.id,
        archived: c.archived ?? undefined,
        unreadCount: typeof c.unreadCount === 'number' ? Math.max(0, c.unreadCount) : undefined,
      });
    }
  });
  sock.ev.on('chats.delete', (ids) => {
    for (const id of ids || []) { chatStore.delete(id); messageStore.delete(id); }
  });

  sock.ev.on('contacts.upsert', (list) => {
    for (const c of list || []) rememberContact(c);
    // Contact names feed the chat list — refresh it so raw JIDs turn into names.
    if (list?.length && status === 'ready') signalChatsChanged();
  });
  sock.ev.on('contacts.update', (list) => {
    for (const c of list || []) rememberContact(c);
    if (list?.length && status === 'ready') signalChatsChanged();
  });

  // WhatsApp can send the LID↔phone mapping separately from the contact records.
  sock.ev.on('lid-mapping.update', (m) => {
    rememberLidMapping(m);
    if (status === 'ready') signalChatsChanged();
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    storeMessages(messages);
    for (const m of messages || []) {
      const jid = m?.key?.remoteJid;
      if (!jid || jid === 'status@broadcast') continue;
      // Protocol/system messages carry no renderable content.
      if (!m.message) continue;

      const entry = toMessageEntry(m);
      const ts = entry.timestamp;
      // 'append' means history/backfill; 'notify' is live. Either way, anything
      // older than our connect time is replayed backlog: no sound, no unread bump.
      const isBacklog = type !== 'notify' || isBacklogMessage(ts, readyAtSec);

      broadcast('wa:message', {
        from: m.key.fromMe ? (meId || jid) : jid,
        to: m.key.fromMe ? jid : (meId || jid),
        body: entry.body,
        timestamp: ts,
        id: entry.id,
        type: entry.type,
        isGif: entry.isGif,
        fromMe: entry.fromMe,
        ack: entry.ack,
        mediaData: null,
        isBacklog,
      });

      broadcast('wa:chat-update', {
        id: jid,
        lastMessage: entry.body,
        timestamp: ts,
        isGroup: jid.endsWith('@g.us'),
      });

      // Live incoming media: fetch it so an open chat window fills in right away.
      if (!isBacklog && entry.hasMedia && entry.type !== 'document') {
        downloadMediaFor(m).catch(() => {});
      }
    }
  });

  sock.ev.on('messages.update', (updates) => {
    for (const u of updates || []) {
      const jid = u?.key?.remoteJid;
      const id = u?.key?.id;
      if (!jid || !id) continue;
      const bucket = messageStore.get(jid);
      if (bucket?.has(id)) bucket.set(id, { ...bucket.get(id), ...(u.update || {}) });
      if (u.update?.status != null) applyAck(jid, id, u.update.status, !!u.key?.fromMe);
    }
  });

  // Per-recipient delivery/read receipts. In groups this is the only path that
  // reports delivery, and in 1:1 chats it is a second chance at the confirmation
  // that messages.update may not have carried.
  sock.ev.on('message-receipt.update', (updates) => {
    for (const u of updates || []) {
      const jid = u?.key?.remoteJid;
      const id = u?.key?.id;
      if (!jid || !id) continue;
      const status = statusFromReceipt(u.receipt);
      if (status != null) applyAck(jid, id, status, !!u.key?.fromMe);
    }
  });

  sock.ev.on('messages.delete', (item) => {
    if (item?.keys) {
      for (const k of item.keys) messageStore.get(k.remoteJid)?.delete(k.id);
    } else if (item?.jid) {
      messageStore.delete(item.jid);
    }
  });

  sock.ev.on('presence.update', ({ id, presences }) => {
    if (!id || !presences) return;
    const typing = Object.values(presences).some(
      p => p?.lastKnownPresence === 'composing' || p?.lastKnownPresence === 'recording',
    );
    broadcast('wa:typing', { chatId: id, typing });
  });

  sock.ev.on('blocklist.set', ({ blocklist }) => {
    blockedSet.clear();
    for (const j of blocklist || []) blockedSet.add(j);
  });
  sock.ev.on('blocklist.update', ({ blocklist, type }) => {
    for (const j of blocklist || []) {
      if (type === 'add') blockedSet.add(j); else blockedSet.delete(j);
    }
  });
}

// ── Media ─────────────────────────────────────────────────────────────────

async function downloadMediaFor(m) {
  const type = typeOf(m);
  if (!MEDIA_TYPES.has(type)) return null;
  const content = m?.message?.[`${type === 'ptt' ? 'audio' : type}Message`]
    || m?.message?.imageMessage || m?.message?.videoMessage
    || m?.message?.stickerMessage || m?.message?.audioMessage || m?.message?.documentMessage;
  const mimetype = content?.mimetype || 'application/octet-stream';
  const buffer = await BA.downloadMediaMessage(
    m, 'buffer', {},
    { logger: waLogger, reuploadRequest: sock.updateMediaMessage },
  );
  if (!buffer) return null;
  const dataUrl = `data:${mimetype};base64,${buffer.toString('base64')}`;
  broadcast('wa:media', { msgId: m.key.id, mediaData: dataUrl });
  return dataUrl;
}

// ── Public API ────────────────────────────────────────────────────────────

async function getQR() { return currentQR; }
function getStatus() { return status; }

async function getChats() {
  if (status !== 'ready') return [];
  const jids = sortedChatJids().filter(j => j && j !== 'status@broadcast' && !j.endsWith('@newsletter'));
  return jids.slice(0, 100).map(chatEntryFor);
}

async function getMessages(chatId, opts = {}) {
  if (status !== 'ready') return [];
  const limit = opts.limit ?? 30;
  const bucket = messageStore.get(chatId);
  const all = bucket ? [...bucket.values()] : [];

  const entries = all
    .filter(m => m?.message)
    .map(toMessageEntry)
    .sort((a, b) => a.timestamp - b.timestamp);
  const result = entries.slice(-limit);

  // Fill in media for what we're about to show (background, non-blocking).
  if (!opts.skipMedia) {
    (async () => {
      for (const e of result) {
        if (!e.hasMedia || e.type === 'document') continue;
        const m = bucket?.get(e.id);
        if (m) { try { await downloadMediaFor(m); } catch (err) { /* ignore */ } }
      }
    })();
  }

  log('WA getMessages', { chatId, count: result.length, stored: all.length });
  return result;
}

function requireSock() {
  if (!sock || status !== 'ready') throw new Error('WhatsApp not ready');
  return sock;
}

// Sends are never auto-retried: a retry can deliver the message twice and that
// cannot be taken back. A failure the user can repeat is strictly better.
async function sendMessage(chatId, text, quotedMessageId = null) {
  const s = requireSock();
  const options = {};
  if (quotedMessageId) {
    const quoted = messageStore.get(chatId)?.get(quotedMessageId);
    if (quoted) options.quoted = quoted;
  }
  try {
    await s.sendMessage(chatId, { text: String(text ?? '') }, options);
    return true;
  } catch (e) {
    log('WA send failed', 'sendMessage', chatId, String(e?.message || e));
    throw e;
  }
}

const MIME_BY_EXT = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4',
  pdf: 'application/pdf', zip: 'application/zip', txt: 'text/plain',
};

async function sendFile(chatId, filePath) {
  const s = requireSock();
  const name = path.basename(filePath);
  const ext = (name.split('.').pop() || '').toLowerCase();
  const mimetype = MIME_BY_EXT[ext] || 'application/octet-stream';
  const buffer = fs.readFileSync(filePath);

  let content;
  if (mimetype.startsWith('image/')) content = { image: buffer, mimetype };
  else if (mimetype.startsWith('video/')) content = { video: buffer, mimetype };
  else if (mimetype.startsWith('audio/')) content = { audio: buffer, mimetype };
  else content = { document: buffer, mimetype, fileName: name };

  try {
    await s.sendMessage(chatId, content);
    return true;
  } catch (e) {
    log('WA send failed', 'sendFile', chatId, String(e?.message || e));
    throw e;
  }
}

async function sendSticker(chatId, filePath) {
  const s = requireSock();
  const buffer = fs.readFileSync(filePath);
  const isWebp = (filePath.split('.').pop() || '').toLowerCase() === 'webp';
  try {
    // WhatsApp only accepts webp as a sticker. Anything else goes out as an image
    // rather than failing — converting would need a native image encoder.
    if (isWebp) await s.sendMessage(chatId, { sticker: buffer });
    else await s.sendMessage(chatId, { image: buffer, mimetype: 'image/png' });
    return true;
  } catch (e) {
    log('WA send failed', 'sendSticker', chatId, String(e?.message || e));
    throw e;
  }
}

async function sendVoice(chatId, base64Data, mimeType) {
  const s = requireSock();
  const mt = mimeType || 'audio/ogg; codecs=opus';
  const buffer = Buffer.from(String(base64Data || ''), 'base64');
  try {
    await s.sendMessage(chatId, { audio: buffer, mimetype: mt, ptt: true });
    return true;
  } catch (e) {
    log('WA send failed', 'sendVoice', chatId, String(e?.message || e));
    throw e;
  }
}

async function setArchive(chatId, archive) {
  const s = requireSock();
  // chatModify needs the chat's latest message (newest first) to anchor the change.
  const bucket = messageStore.get(chatId);
  const newest = bucket && bucket.size
    ? [...bucket.values()].sort(
        (a, b) => Number(b?.messageTimestamp?.low ?? b?.messageTimestamp ?? 0)
                - Number(a?.messageTimestamp?.low ?? a?.messageTimestamp ?? 0),
      )[0]
    : null;
  const lastMessages = newest ? [{ key: newest.key, messageTimestamp: newest.messageTimestamp }] : [];
  await s.chatModify({ archive: !!archive, lastMessages }, chatId);
  upsertChat({ id: chatId, archived: !!archive });
  broadcast('wa:chat-update', { id: chatId, archived: !!archive });
  return true;
}

async function setBlocked(contactId, blocked) {
  const s = requireSock();
  await s.updateBlockStatus(contactId, blocked ? 'block' : 'unblock');
  if (blocked) blockedSet.add(contactId); else blockedSet.delete(contactId);
  return true;
}

async function isContactBlocked(contactId) {
  return blockedSet.has(contactId);
}

async function editMessage(chatId, messageId, newText) {
  const s = requireSock();
  const original = messageStore.get(chatId)?.get(messageId);
  if (!original) throw new Error('Message not found');
  if (!original.key?.fromMe) throw new Error('Only own messages can be edited');
  await s.sendMessage(chatId, { text: String(newText ?? ''), edit: original.key });
  return true;
}

async function deleteMessage(chatId, messageId) {
  const s = requireSock();
  const original = messageStore.get(chatId)?.get(messageId);
  if (!original) throw new Error('Message not found');
  if (!original.key?.fromMe) throw new Error('Only own messages can be deleted');
  await s.sendMessage(chatId, { delete: original.key });
  messageStore.get(chatId)?.delete(messageId);
  return true;
}

async function markChatRead(chatId) {
  if (status !== 'ready') return;
  try {
    const bucket = messageStore.get(chatId);
    if (!bucket || !bucket.size) return;
    const unread = [...bucket.values()].filter(m => !m.key?.fromMe).slice(-20).map(m => m.key);
    if (unread.length) await sock.readMessages(unread);
    upsertChat({ id: chatId, unreadCount: 0 });
  } catch (e) { /* ignore */ }
}

async function getMyProfile() {
  if (status !== 'ready') return null;
  // sock.user.name can still be empty right after a fresh link; the stored creds
  // carry the pushname once the server has sent it.
  const name = sock.user?.name
    || sock.user?.verifiedName
    || sock.authState?.creds?.me?.name
    || displayNameFor(meId)
    || 'Me';
  let avatar = null;
  try { if (meId) avatar = await sock.profilePictureUrl(meId, 'image'); } catch (e) { /* none set */ }
  return { name, avatar };
}

async function getContactAvatar(id) {
  if (status !== 'ready' || !id) return null;
  try { return await sock.profilePictureUrl(id, 'image') || null; } catch (e) { return null; }
}

async function getParticipants(chatId) {
  if (status !== 'ready' || !chatId?.endsWith('@g.us')) return [];
  try {
    const meta = await sock.groupMetadata(chatId);
    return (meta?.participants || []).map(p => ({
      id: p.id,
      name: displayNameFor(p.id) || prettyIdFor(p.id),
      pushname: displayNameFor(p.id),
      isAdmin: p.admin === 'admin' || p.admin === 'superadmin',
      online: false,
    }));
  } catch (e) {
    log('WA getParticipants failed', chatId, String(e?.message || e));
    return [];
  }
}

async function closeSocket() {
  connectionOpen = false;
  historySeen = false;
  clearTimeout(readyTimer); readyTimer = null;
  clearTimeout(chatsChangedTimer); chatsChangedTimer = null;
  const s = sock;
  sock = null;
  if (!s) return;
  try { s.ev.removeAllListeners(); } catch (e) {}
  try { s.end(undefined); } catch (e) {}
}

async function logout() {
  waManualLogout = true;
  clearReconnectTimer();
  try { await sock?.logout(); } catch (e) { /* already gone */ }
  await closeSocket();
  try { fs.rmSync(sessionDir(lastDataDir), { recursive: true, force: true }); } catch (e) {}
  resetStore();
  currentQR = null;
  meId = null;
  setStatus('disconnected');
  // Start a clean session so a QR login is immediately possible again.
  setTimeout(() => {
    waManualLogout = false;
    reconnectAttempt = 0;
    init(onAvatarCb, lastDataDir);
  }, 700);
}

async function shutdown() {
  clearReconnectTimer();
  await closeSocket();
  status = 'disconnected';
}

async function reconnect(dataDir) {
  clearReconnectTimer();
  waManualLogout = false;
  reconnectAttempt = 0;
  await closeSocket();
  setStatus('loading');
  return init(onAvatarCb, dataDir || lastDataDir);
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

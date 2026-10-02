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
const { mapMessageEntry, isBacklogMessage, isRealMessage } = require('./lib/message-entry');
const { mapChatEntry } = require('./lib/chat-entry');
const { createContactDirectory, normalizeJid, isLid, isPn } = require('./lib/contact-names');
const { ackFromStatus, statusFromReceipt, createAckTracker } = require('./lib/ack');
const { createWaStore, loadSnapshot, saveSnapshot } = require('./lib/wa-store');

// Logging helper: append to temp startup log for easier debugging across restarts.
// Not under Jest — the test suite would otherwise fill the real app log.
const STARTUP_LOG = path.join(os.tmpdir(), 'icq-startup.log');
const LOG_TO_FILE = !process.env.JEST_WORKER_ID;
function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`;
  if (LOG_TO_FILE) { try { fs.appendFileSync(STARTUP_LOG, line + '\n'); } catch (e) {} }
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

// Test seam. The automated suite injects a fake Baileys namespace so the whole
// bridge can be driven — connect, history sync, messages, acks, sending — without
// ever touching the network or a real account. loadBaileys() short-circuits once BA
// is set, so this is all that is needed. Production never calls it.
function __setBaileysForTests(fake) { BA = fake; }

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
let hasCredentials = false;   // device already linked → no automatic history sync
let pairingPending = false;   // a QR was shown / pairing succeeded: the history is on its way
let readyTimer = null;        // fallback so an account without history still becomes ready
let chatsChangedTimer = null; // debounces the "reload your chat list" signal
let lidLookupTimer = null;    // debounces the LID → phone lookup in Baileys' own key store

// The list shows at most this many chats (the store keeps 300 on disk).
const MAX_LISTED_CHATS = 300;

// ── Store (Baileys v7 has no built-in store) ──────────────────────────────
// Persisted to disk, and that is not optional: WhatsApp sends the history sync ONLY
// right after a device is linked. Every later start connects with existing
// credentials and receives no history at all, so a memory-only store comes up empty
// and the chat list stays blank ("Lädt Chats…" → "No chats found").
const contacts = createContactDirectory(); // names + LID↔phone mapping
// Every chat is filed under one id per person, so the LID twin of a phone-number
// chat folds into it instead of appearing as a second entry.
const store = createWaStore({ canonical: (jid) => contacts.canonicalFor(jid) });
const chatStore = store.chats;             // canonical jid → chat record
const ackTracker = createAckTracker();     // highest delivery state seen per message
const blockedSet = new Set();

let storeFile = null;
let saveTimer = null;

function loadStore(dataDir) {
  storeFile = path.join(dataDir, 'whatsapp', 'store.json');
  const snap = loadSnapshot(storeFile, fs);
  if (!snap) { log('WA store: nothing to restore'); return false; }
  // Contacts first: their LID↔phone mappings decide which id each chat is filed
  // under, so restoring them afterwards would bring back the duplicates.
  contacts.hydrate(snap.contactDirectory);
  store.hydrate(snap);
  const listed = [...chatStore.keys()].filter(store.isListed).length;
  log('WA store restored', {
    chats: store.chatCount, listed, contacts: contacts.size, mappings: contacts.mappingCount,
  });
  return store.chatCount > 0;
}

function saveStoreNow() {
  if (!storeFile) return;
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (!saveSnapshot(storeFile, store.snapshot({ contactDirectory: contacts.toJSON() }), fs)) {
    log('WA store: save failed');
  }
}

/** Debounced — chat and message events arrive in bursts, especially during a sync. */
function scheduleStoreSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; saveStoreNow(); }, 4000);
}

function resetStore() {
  store.clear();
  contacts.clear();
  blockedSet.clear();
  ackTracker.clear();
  if (storeFile) { try { fs.rmSync(storeFile, { force: true }); } catch (e) {} }
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
  const bucket = jid ? store.messagesFor(jid) : null;
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

const tsOf = (m) => Number(m?.messageTimestamp?.low ?? m?.messageTimestamp ?? 0);

// WAMessage → the flat shape the renderer uses. mapMessageEntry normalizes the rest.
function toMessageEntry(m) {
  const type = typeOf(m);
  return mapMessageEntry({
    id: m?.key?.id,
    body: bodyOf(m),
    fromMe: !!m?.key?.fromMe,
    timestamp: tsOf(m),
    author: m?.key?.participant || m?.participant || m?.key?.remoteJid,
    type,
    isGif: !!m?.message?.videoMessage?.gifPlayback,
    ack: ackOf(m),
    hasMedia: MEDIA_TYPES.has(type),
  });
}

// Name lookup lives in lib/contact-names.js (LID↔phone handling is subtle enough to
// deserve its own tests). These thin wrappers keep the call sites readable.
const rememberContact = (c) => contacts.rememberContact(c);
const displayNameFor = (jid) => contacts.nameFor(jid);
const prettyIdFor = (jid) => contacts.prettyIdFor(jid);

function chatEntryFor(jid) {
  const c = chatStore.get(jid) || {};
  const last = store.lastRealMessage(jid);
  const isGroup = jid.endsWith('@g.us');
  // Address-book name first (it is what the phone shows), then what the chat record
  // or the contact's own pushname offers. prettyIdFor is the floor: mapChatEntry
  // would otherwise fall back to the raw JID ("4917...@s.whatsapp.net").
  const name = isGroup
    ? (c.name || c.displayName || displayNameFor(jid) || prettyIdFor(jid))
    : (displayNameFor(jid) || c.displayName || c.name || c.username || prettyIdFor(jid));
  return mapChatEntry({
    id: { _serialized: jid },
    name,
    lastMessage: last ? { body: bodyOf(last), t: tsOf(last) } : null,
    unreadCount: Math.max(0, Number(c.unreadCount) || 0),
    isGroup,
    archive: !!c.archived,
    t: store.activityOf(jid),
  });
}

/** The contact list: real conversations only, newest first. */
function listedChatEntries() {
  const entries = [];
  for (const jid of chatStore.keys()) {
    if (store.isListed(jid)) entries.push(chatEntryFor(jid));
  }
  entries.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  return entries.slice(0, MAX_LISTED_CHATS);
}

// ── Learning names and identities ─────────────────────────────────────────

/** A chat record often says which other id its person has. */
function mappingHintFromChat(c) {
  const id = normalizeJid(c?.id);
  if (isLid(id) && c.pnJid) return { lid: id, pn: c.pnJid };
  // accountLid on a phone-number chat is that contact's LID (Baileys reads it the
  // same way when it turns history chats into contacts).
  if (isPn(id) && (c.lidJid || c.accountLid)) return { lid: c.lidJid || c.accountLid, pn: id };
  return null;
}

function pairOf(a, b) {
  const x = normalizeJid(a);
  const y = normalizeJid(b);
  if (isLid(x) && isPn(y)) return { lid: x, pn: y };
  if (isPn(x) && isLid(y)) return { lid: y, pn: x };
  return null;
}

/**
 * Pull identity and name hints out of one message. Returns true when a name changed.
 *
 * Baileys v7 tags a message with the sender's other id (remoteJidAlt /
 * participantAlt) — that is how the reply under a LID is recognised as belonging to
 * the phone-number chat. The pushname on an incoming message is the only name there
 * is for someone who is not in the address book.
 */
function learnFromMessage(m) {
  const key = m?.key;
  if (!key) return false;
  const chatJid = key.remoteJid;
  const isGroup = typeof chatJid === 'string' && chatJid.endsWith('@g.us');
  if (!isGroup) {
    const pair = pairOf(chatJid, key.remoteJidAlt);
    if (pair) contacts.rememberMapping(pair);
  }
  const pPair = pairOf(key.participant, key.participantAlt);
  if (pPair) contacts.rememberMapping(pPair);

  if (key.fromMe || !m.pushName) return false;
  const sender = isGroup ? key.participant : chatJid;
  if (!sender) return false;
  return contacts.rememberContact({
    id: sender,
    notify: m.pushName,
    ...(m.verifiedBizName ? { verifiedName: m.verifiedBizName } : {}),
  });
}

/**
 * Fold chats together after new LID↔phone mappings. Cheap (a pass over ~300
 * chats), so it runs once per event batch rather than being clever about which
 * chats moved.
 */
function refileIfMappingsChanged(revisionBefore) {
  if (contacts.mappingRevision === revisionBefore) return 0;
  const moved = store.rekey();
  if (moved) log('WA merged chats', { moved });
  return moved;
}

/**
 * Some LID chats arrive without any mapping in the events, but Baileys keeps its
 * own LID↔phone table on disk (lid-mapping-*.json in the auth folder). Ask it.
 */
async function resolveUnmappedLids() {
  const lookup = sock?.signalRepository?.lidMapping;
  if (!lookup?.getPNsForLIDs) return;
  const lids = [...chatStore.keys()].filter(j => isLid(j) && !contacts.hasMapping(j));
  if (!lids.length) return;
  const rev = contacts.mappingRevision;
  try {
    const pairs = (await lookup.getPNsForLIDs(lids)) || [];
    for (const p of pairs) contacts.rememberMapping(p);
    const moved = refileIfMappingsChanged(rev);
    log('WA lid lookup', { asked: lids.length, found: pairs.length, moved });
    if (contacts.mappingRevision !== rev) {
      scheduleStoreSave();
      if (status === 'ready') signalChatsChanged();
    }
  } catch (e) {
    log('WA lid lookup failed', String(e?.message || e));
  }
}

function scheduleLidLookup() {
  clearTimeout(lidLookupTimer);
  lidLookupTimer = setTimeout(() => { lidLookupTimer = null; resolveUnmappedLids(); }, 2000);
}

// ── Store maintenance ─────────────────────────────────────────────────────

function upsertChat(c) {
  store.upsertChat(c);
  scheduleStoreSave();
}

function storeMessages(list) {
  store.putMessages(list);
  if (list?.length) scheduleStoreSave();
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

  // Restore the chat list from disk before connecting. WhatsApp will not resend the
  // history for an already-linked device, so this is the only source of chats on
  // every start after the initial pairing.
  if (!store.chatCount) loadStore(dataDir);

  let state;
  try {
    const auth = await BA.useMultiFileAuthState(authDir);
    state = auth.state;
    saveCreds = auth.saveCreds;
    // Already paired? Then no history/app-state sync will arrive by itself.
    hasCredentials = !!(state?.creds?.registered || state?.creds?.me?.id);
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
        const bucket = store.messagesFor(key?.remoteJid);
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

// Pull the chat list back from WhatsApp's app state.
//
// The history sync only ever runs right after a device is linked. On a normal
// reconnect Baileys skips the app state sync too, so a device that is already linked
// but has no local store would show an empty contact list forever. Requesting the
// app state explicitly recovers the contacts and the chat records without re-pairing.
async function recoverFromAppState() {
  if (!sock) return;
  const patches = BA.ALL_WA_PATCH_NAMES || ['critical_block', 'critical_unblock_low', 'regular_high', 'regular_low', 'regular'];
  log('WA recovery: empty store, requesting app state sync');
  try {
    await sock.resyncAppState(patches, true);
  } catch (e) {
    log('WA recovery: app state sync failed', String(e?.message || e));
  }
  log('WA recovery: app state sync finished', { chats: store.chatCount, contacts: contacts.size });
  if (store.chatCount > 0) {
    scheduleStoreSave();
    if (status === 'ready') signalChatsChanged(); else announceReady();
  } else if (connectionOpen && status !== 'ready') {
    // Nothing came back — surface the empty state rather than spinning forever.
    announceReady();
  }
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
    const { connection, lastDisconnect, qr, isNewLogin } = u;

    if (qr) {
      currentQR = qr;
      pairingPending = true;
      setStatus('qr');
      broadcast('wa:qr', qr);
      log('WA event', 'qr-generated');
    }
    // The QR was scanned. WhatsApp now restarts the connection (code 515) and only
    // then streams the history — by which time the creds already look "linked".
    if (isNewLogin) pairingPending = true;

    if (connection === 'open') {
      currentQR = null;
      reconnectAttempt = 0;
      readyAtSec = Math.floor(Date.now() / 1000);
      meId = sock.user?.id ? BA.jidNormalizedUser(sock.user.id) : null;
      connectionOpen = true;
      log('WA event', 'connected', { pushname: sock.user?.name, id: meId });

      if (pairingPending || !hasCredentials) {
        // First run after linking: Baileys opens the socket immediately and streams
        // the history in afterwards. Announcing ready now would make the UI fetch an
        // empty chat list and cache it, so wait for the first chunk — with a timeout
        // so an account that genuinely has no history still starts.
        clearTimeout(readyTimer);
        readyTimer = setTimeout(() => {
          readyTimer = null;
          pairingPending = false;
          if (!connectionOpen || status === 'ready') return;
          log('WA ready (history timeout)', { chats: chatStore.size });
          // Linked but no history came: the app state is the remaining source.
          if (!chatStore.size && hasCredentials) recoverFromAppState();
          else announceReady();
        }, 12000);
      } else if (store.chatCount > 0) {
        // We restored the chat list from disk, so there is something to show right
        // away. WhatsApp will not resend the history for an already-linked device
        // anyway — waiting for it would just stall the UI.
        announceReady();
        resolveUnmappedLids();
      } else {
        // Already linked, but nothing stored: WhatsApp replays neither the history
        // nor the app state on a normal reconnect, so the chat list would stay empty
        // forever. Ask for the app state explicitly — it carries the contacts and the
        // chat records. (This is the situation after switching to this bridge, where
        // the pairing happened before there was a store to fill.)
        recoverFromAppState();
      }

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
  sock.ev.on('messaging-history.set', ({ chats, contacts: contactList, messages, isLatest, lidPnMappings }) => {
    // Identities first: they decide which id every chat below is filed under, so a
    // LID chat and its phone-number twin land in the same place.
    const rev = contacts.mappingRevision;
    for (const m of lidPnMappings || []) contacts.rememberMapping(m);
    for (const c of chats || []) {
      const hint = mappingHintFromChat(c);
      if (hint) contacts.rememberMapping(hint);
    }
    for (const c of contactList || []) rememberContact(c);
    for (const m of messages || []) learnFromMessage(m);
    refileIfMappingsChanged(rev);

    for (const c of chats || []) upsertChat(c);
    storeMessages(messages);
    log('WA history', {
      chats: chats?.length || 0, contacts: contactList?.length || 0, messages: messages?.length || 0,
      mappings: lidPnMappings?.length || 0, isLatest: !!isLatest,
    });

    const gotSomething = (chats?.length || 0) > 0 || (contactList?.length || 0) > 0
      || (lidPnMappings?.length || 0) > 0;
    if (!gotSomething) return;
    pairingPending = false;
    scheduleStoreSave();
    scheduleLidLookup();
    // Already ready (restored from disk, or an earlier chunk released it)? Then this
    // chunk only adds to the list, so tell the UI to reload it.
    if (status === 'ready') signalChatsChanged();
    else announceReady();
  });

  const onChats = (list, { live }) => {
    const rev = contacts.mappingRevision;
    for (const c of list || []) {
      const hint = mappingHintFromChat(c);
      if (hint) contacts.rememberMapping(hint);
    }
    const moved = refileIfMappingsChanged(rev);
    for (const c of list || []) {
      if (!c?.id) continue;
      upsertChat(c);
      if (!live) continue;
      broadcast('wa:chat-update', {
        id: store.keyFor(c.id),
        archived: c.archived ?? undefined,
        unreadCount: typeof c.unreadCount === 'number' ? Math.max(0, c.unreadCount) : undefined,
      });
    }
    if (moved && status === 'ready') signalChatsChanged();
  };
  sock.ev.on('chats.upsert', (list) => onChats(list, { live: false }));
  sock.ev.on('chats.update', (list) => onChats(list, { live: true }));
  sock.ev.on('chats.delete', (ids) => {
    for (const id of ids || []) store.deleteChat(id);
  });

  const onContacts = (list) => {
    if (!list?.length) return;
    const rev = contacts.mappingRevision;
    let changed = false;
    for (const c of list) changed = rememberContact(c) || changed;
    refileIfMappingsChanged(rev);
    if (!changed) return;
    scheduleStoreSave();
    // Contact names feed the chat list — refresh it so raw numbers turn into names.
    if (status === 'ready') signalChatsChanged();
  };
  sock.ev.on('contacts.upsert', onContacts);
  sock.ev.on('contacts.update', onContacts);

  // WhatsApp can send the LID↔phone mapping separately from the contact records.
  sock.ev.on('lid-mapping.update', (m) => {
    const rev = contacts.mappingRevision;
    for (const pair of Array.isArray(m) ? m : [m]) contacts.rememberMapping(pair);
    if (contacts.mappingRevision === rev) return;
    refileIfMappingsChanged(rev);
    scheduleStoreSave();
    if (status === 'ready') signalChatsChanged();
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    const rev = contacts.mappingRevision;
    let named = false;
    for (const m of messages || []) named = learnFromMessage(m) || named;
    const moved = refileIfMappingsChanged(rev);
    storeMessages(messages);

    for (const m of messages || []) {
      const raw = m?.key?.remoteJid;
      if (!raw || raw === 'status@broadcast') continue;
      // System notices, reactions and protocol traffic carry nothing to show — they
      // used to arrive as empty bubbles and bumped the unread badge.
      if (!m.message || !isRealMessage(m)) continue;

      const jid = store.keyFor(raw);
      const entry = toMessageEntry(m);
      const ts = entry.timestamp;
      // 'append' means history/backfill; 'notify' is live. Either way, anything
      // older than our connect time is replayed backlog: no sound, no unread bump.
      const isBacklog = type !== 'notify' || isBacklogMessage(ts, readyAtSec);

      broadcast('wa:message', {
        from: m.key.fromMe ? (meId || jid) : jid,
        to: m.key.fromMe ? jid : (meId || jid),
        // The chat this belongs to, and every id an open chat window may know it by.
        chatId: jid,
        chatAliases: contacts.aliasesFor(raw),
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
    // A new name (pushname) or a merged twin changes rows the list already shows.
    if (named || moved) {
      scheduleStoreSave();
      if (status === 'ready') signalChatsChanged();
    }
  });

  sock.ev.on('messages.update', (updates) => {
    for (const u of updates || []) {
      const jid = u?.key?.remoteJid;
      const id = u?.key?.id;
      if (!jid || !id) continue;
      const bucket = store.messagesFor(jid);
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
      for (const k of item.keys) store.messagesFor(k.remoteJid)?.delete(k.id);
    } else if (item?.jid) {
      store.messages.delete(store.keyFor(item.jid));
    }
  });

  sock.ev.on('presence.update', ({ id, presences }) => {
    if (!id || !presences) return;
    const typing = Object.values(presences).some(
      p => p?.lastKnownPresence === 'composing' || p?.lastKnownPresence === 'recording',
    );
    broadcast('wa:typing', { chatId: store.keyFor(id), aliases: contacts.aliasesFor(id), typing });
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
  return listedChatEntries();
}

async function getMessages(chatId, opts = {}) {
  if (status !== 'ready') return [];
  const limit = opts.limit ?? 30;
  // The window may know the chat by an older alias (LID before the number was
  // known) — messagesFor resolves it to wherever the chat is filed now.
  const bucket = store.messagesFor(chatId);
  const all = bucket ? [...bucket.values()] : [];

  const entries = all
    .filter(m => m?.message && isRealMessage(m))
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
    const quoted = store.messagesFor(chatId)?.get(quotedMessageId);
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

/** Newest stored message of a chat, by timestamp. */
function newestMessage(chatId) {
  const bucket = store.messagesFor(chatId);
  if (!bucket || !bucket.size) return null;
  let best = null;
  for (const m of bucket.values()) if (!best || tsOf(m) >= tsOf(best)) best = m;
  return best;
}

async function setArchive(chatId, archive) {
  const s = requireSock();
  // chatModify needs the chat's latest message (newest first) to anchor the change.
  const newest = newestMessage(chatId);
  const lastMessages = newest ? [{ key: newest.key, messageTimestamp: newest.messageTimestamp }] : [];
  // Address the chat the way WhatsApp currently does (LID or number) — that is the
  // id its own record is kept under, and it is what the newest message carries.
  await s.chatModify({ archive: !!archive, lastMessages }, newest?.key?.remoteJid || chatId);
  upsertChat({ id: chatId, archived: !!archive });
  broadcast('wa:chat-update', { id: store.keyFor(chatId), archived: !!archive });
  return true;
}

async function setBlocked(contactId, blocked) {
  const s = requireSock();
  await s.updateBlockStatus(contactId, blocked ? 'block' : 'unblock');
  if (blocked) blockedSet.add(contactId); else blockedSet.delete(contactId);
  return true;
}

async function isContactBlocked(contactId) {
  return contacts.aliasesFor(contactId).some(j => blockedSet.has(j)) || blockedSet.has(contactId);
}

async function editMessage(chatId, messageId, newText) {
  const s = requireSock();
  const original = store.messagesFor(chatId)?.get(messageId);
  if (!original) throw new Error('Message not found');
  if (!original.key?.fromMe) throw new Error('Only own messages can be edited');
  await s.sendMessage(original.key.remoteJid || chatId, { text: String(newText ?? ''), edit: original.key });
  return true;
}

async function deleteMessage(chatId, messageId) {
  const s = requireSock();
  const original = store.messagesFor(chatId)?.get(messageId);
  if (!original) throw new Error('Message not found');
  if (!original.key?.fromMe) throw new Error('Only own messages can be deleted');
  await s.sendMessage(original.key.remoteJid || chatId, { delete: original.key });
  store.messagesFor(chatId)?.delete(messageId);
  return true;
}

async function markChatRead(chatId) {
  if (status !== 'ready') return;
  try {
    const bucket = store.messagesFor(chatId);
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
    const list = meta?.participants || [];
    // Group metadata pairs each member's LID with their number — learn it, so the
    // member list (and any 1:1 chat with them) can show a name instead of a LID.
    for (const p of list) {
      const pair = pairOf(p.id, p.phoneNumber || p.lid);
      if (pair) contacts.rememberMapping(pair);
    }
    return list.map(p => ({
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
  clearTimeout(readyTimer); readyTimer = null;
  clearTimeout(chatsChangedTimer); chatsChangedTimer = null;
  clearTimeout(lidLookupTimer); lidLookupTimer = null;
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
  // Flush the chat list before quitting — it is the only copy that survives, since
  // WhatsApp will not resend the history on the next start.
  saveStoreNow();
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
  // Test-only seam (see __setBaileysForTests).
  __setBaileysForTests,
};

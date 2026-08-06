/**
 * A stand-in for the Baileys library, used by the automated bridge tests.
 *
 * It lets the suite drive the real bridge through its whole lifecycle — QR, connect,
 * history sync, incoming messages, delivery receipts, sending — with no network, no
 * account and NOTHING ACTUALLY SENT. Outgoing calls are recorded so tests can assert
 * what *would* have been sent.
 *
 * Only the surface the bridge actually uses is implemented.
 */

function createEmitter() {
  const handlers = new Map();
  return {
    on(event, fn) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event).push(fn);
    },
    removeAllListeners() { handlers.clear(); },
    /** Deliver an event to the bridge, awaiting async handlers. */
    async emit(event, payload) {
      for (const fn of handlers.get(event) || []) await fn(payload);
    },
    has(event) { return (handlers.get(event) || []).length > 0; },
  };
}

/**
 * @param {object} opts
 * @param {string} opts.meId  our own JID
 */
function createFakeBaileys(opts = {}) {
  const meId = opts.meId || '4915100000000@s.whatsapp.net';
  // Everything the bridge tried to send, so tests can assert without a network.
  const sent = [];
  const calls = { readMessages: [], chatModify: [], blockStatus: [], logout: 0, end: 0 };
  let sockets = [];

  function makeSocket() {
    const ev = createEmitter();
    const sock = {
      ev,
      user: { id: meId, name: 'Test User' },
      authState: { creds: { me: { id: meId, name: 'Test User' } } },

      // — outgoing: recorded, never transmitted —
      async sendMessage(jid, content, options) {
        sent.push({ jid, content, options });
        return { key: { id: `SENT${sent.length}`, remoteJid: jid, fromMe: true } };
      },
      async readMessages(keys) { calls.readMessages.push(keys); },
      async chatModify(mod, jid) { calls.chatModify.push({ mod, jid }); },
      async updateBlockStatus(jid, action) { calls.blockStatus.push({ jid, action }); },
      async logout() { calls.logout += 1; },
      async end() { calls.end += 1; },

      // — lookups —
      async fetchBlocklist() { return opts.blocklist || []; },
      async profilePictureUrl(jid) {
        if (opts.avatars && opts.avatars[jid]) return opts.avatars[jid];
        throw new Error('no picture');
      },
      async groupMetadata(jid) {
        if (opts.groups && opts.groups[jid]) return opts.groups[jid];
        throw new Error('not a group');
      },
      async updateMediaMessage(m) { return m; },
    };
    sockets.push(sock);
    return sock;
  }

  const namespace = {
    default: makeSocket,
    useMultiFileAuthState: async () => ({
      state: { creds: { me: { id: meId } }, keys: {} },
      saveCreds: async () => {},
    }),
    makeCacheableSignalKeyStore: (keys) => keys,
    Browsers: { appropriate: (n) => ['Test', n, '1.0'] },
    DisconnectReason: {
      loggedOut: 401, connectionClosed: 428, connectionReplaced: 440,
      restartRequired: 515, timedOut: 408,
    },
    jidNormalizedUser: (j) => String(j || '').split(':')[0].replace(/@.*$/, '') + '@s.whatsapp.net',
    getContentType: (msg) => {
      if (!msg) return undefined;
      return Object.keys(msg).find(k => k.endsWith('Message') || k === 'conversation');
    },
    downloadMediaMessage: async () => Buffer.from('fake-media'),
    proto: {
      WebMessageInfo: {
        Status: { ERROR: 0, PENDING: 1, SERVER_ACK: 2, DELIVERY_ACK: 3, READ: 4, PLAYED: 5 },
      },
    },
  };

  return {
    namespace,
    meId,
    sent,
    calls,
    /** The socket the bridge most recently created. */
    get socket() { return sockets[sockets.length - 1]; },
    get socketCount() { return sockets.length; },
    reset() { sent.length = 0; sockets = []; },
  };
}

// ── Fixtures ───────────────────────────────────────────────────────────────

function makeChat(jid, over = {}) {
  return { id: jid, conversationTimestamp: 1700000000, unreadCount: 0, ...over };
}

function makeContact(id, name, over = {}) {
  return { id, name, ...over };
}

/** A plain text message. `ts` is seconds. */
function makeMessage(jid, id, text, { fromMe = false, ts = 1700000000, status } = {}) {
  return {
    key: { remoteJid: jid, id, fromMe },
    messageTimestamp: ts,
    message: { conversation: text },
    ...(status == null ? {} : { status }),
  };
}

module.exports = { createFakeBaileys, makeChat, makeContact, makeMessage };

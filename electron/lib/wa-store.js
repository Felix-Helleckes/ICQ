/**
 * Persistent chat/message store for the WhatsApp bridge.
 *
 * Baileys v7 removed makeInMemoryStore, so keeping state is the app's job — and it
 * is not optional: WhatsApp only sends the full history sync right after a device is
 * linked. On every later start the socket connects with existing credentials and no
 * history arrives at all. A memory-only store therefore comes up empty after every
 * restart, which is exactly how "Lädt Chats… / No chats found" happened.
 *
 * So the store is written to disk and reloaded on startup. It is bounded on both
 * axes (chats, and messages per chat) so the file cannot grow without limit, and it
 * is saved atomically (temp file + rename) so a crash mid-write cannot leave a
 * truncated file behind that would wipe the chat list.
 */

const DEFAULTS = {
  maxChats: 300,           // chats kept in the file, most recent first
  maxMessagesPerChat: 60,  // messages persisted per chat
  maxMessageChats: 120,    // only the most recent chats keep their messages
};

function tsOf(m) {
  const t = m?.messageTimestamp;
  return Number(t?.low ?? t ?? 0);
}

function chatTs(chat, messages) {
  const c = Number(chat?.conversationTimestamp?.low ?? chat?.conversationTimestamp ?? 0);
  if (c) return c;
  let newest = 0;
  for (const m of messages || []) {
    const t = tsOf(m);
    if (t > newest) newest = t;
  }
  return newest;
}

function createWaStore(options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const chats = new Map();     // jid → chat record
  const messages = new Map();  // jid → Map<msgId, WAMessage>

  function upsertChat(c) {
    if (!c?.id) return;
    chats.set(c.id, { ...(chats.get(c.id) || {}), ...c });
  }

  function messagesFor(jid) {
    return messages.get(jid) || null;
  }

  function putMessages(list) {
    for (const m of list || []) {
      const jid = m?.key?.remoteJid;
      const id = m?.key?.id;
      if (!jid || !id) continue;
      if (!messages.has(jid)) messages.set(jid, new Map());
      const bucket = messages.get(jid);
      bucket.set(id, { ...(bucket.get(id) || {}), ...m });
      if (bucket.size > opts.maxMessagesPerChat * 3) {
        // Trim well above the persisted cap so trimming is rare during a session.
        const sorted = [...bucket.entries()].sort((a, b) => tsOf(a[1]) - tsOf(b[1]));
        for (let i = 0; i < sorted.length - opts.maxMessagesPerChat * 3; i += 1) {
          bucket.delete(sorted[i][0]);
        }
      }
      if (!chats.has(jid)) upsertChat({ id: jid, conversationTimestamp: m.messageTimestamp });
    }
  }

  /** Chat ids, newest activity first. */
  function chatJidsByRecency() {
    return [...chats.keys()].sort((a, b) => {
      const ta = chatTs(chats.get(b), messages.get(b)?.values());
      const tb = chatTs(chats.get(a), messages.get(a)?.values());
      return ta - tb;
    });
  }

  function clear() {
    chats.clear();
    messages.clear();
  }

  /** Plain object ready for JSON. `extra` is merged in (contacts, lid mappings…). */
  function snapshot(extra = {}) {
    const order = chatJidsByRecency();
    const keptChats = order.slice(0, opts.maxChats);
    const withMessages = new Set(order.slice(0, opts.maxMessageChats));
    const msgOut = {};
    for (const jid of keptChats) {
      if (!withMessages.has(jid)) continue;
      const bucket = messages.get(jid);
      if (!bucket || !bucket.size) continue;
      msgOut[jid] = [...bucket.values()]
        .sort((a, b) => tsOf(a) - tsOf(b))
        .slice(-opts.maxMessagesPerChat);
    }
    return {
      version: 1,
      savedAt: Date.now(),
      chats: keptChats.map((jid) => chats.get(jid)),
      messages: msgOut,
      ...extra,
    };
  }

  function hydrate(data) {
    if (!data || typeof data !== 'object') return false;
    clear();
    for (const c of data.chats || []) upsertChat(c);
    for (const [jid, list] of Object.entries(data.messages || {})) {
      if (!Array.isArray(list)) continue;
      // Repair the key: a persisted message must still know its own chat.
      putMessages(list.filter((m) => m?.key?.id).map((m) => ({
        ...m,
        key: { ...m.key, remoteJid: m.key.remoteJid || jid },
      })));
    }
    return true;
  }

  return {
    chats,
    messages,
    upsertChat,
    putMessages,
    messagesFor,
    chatJidsByRecency,
    snapshot,
    hydrate,
    clear,
    get chatCount() { return chats.size; },
  };
}

/** Read a snapshot. Returns null when absent or unreadable — never throws. */
function loadSnapshot(file, fs) {
  try {
    if (!fs.existsSync(file)) return null;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data && typeof data === 'object' ? data : null;
  } catch (e) {
    return null; // corrupt file: start fresh rather than crash the bridge
  }
}

/** Write atomically so an interrupted save cannot destroy the previous snapshot. */
function saveSnapshot(file, data, fs) {
  const tmp = `${file}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, file);
    return true;
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch (e2) {}
    return false;
  }
}

module.exports = { createWaStore, loadSnapshot, saveSnapshot, DEFAULTS };

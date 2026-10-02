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
 *
 * Every chat is filed under ONE id per person (`canonical`, see contact-names.js).
 * WhatsApp addresses a person by LID or by phone number depending on the event, and
 * filing by whatever id an event carried is what put contacts in the list twice.
 * When a LID↔phone mapping is learned later, rekey() folds the twins together.
 */
const { isRealMessage, unwrapContent } = require('./message-entry');

const DEFAULTS = {
  maxChats: 300,           // chats kept in the file, most recent first
  maxMessagesPerChat: 60,  // messages persisted per chat
  maxMessageChats: 120,    // only the most recent chats keep their full messages…
  previewMessages: 1,      // …the rest keep their newest message for the preview
};

// The chat fields the app reads. A history-sync conversation carries ~40 more,
// including a copy of its newest message and the full group participant list —
// persisting all of that made up a large part of the store file.
const CHAT_FIELDS = [
  'id', 'name', 'displayName', 'username', 'archived', 'pinned', 'muteEndTime', 'readOnly',
  'unreadCount', 'markedAsUnread', 'conversationTimestamp', 'lastMessageRecvTimestamp',
  'pnJid', 'lidJid', 'accountLid',
];

function num(t) {
  return Number(t?.low ?? t ?? 0) || 0;
}

function tsOf(m) {
  return num(m?.messageTimestamp);
}

function pickChatFields(c) {
  const out = {};
  for (const k of CHAT_FIELDS) if (c[k] !== undefined) out[k] = c[k];
  return out;
}

/** Fold two records of the same chat; the newer one wins field by field. */
function mergeChatRecords(a, b) {
  if (!a) return b;
  if (!b) return a;
  const [older, newer] = num(a.conversationTimestamp) > num(b.conversationTimestamp) ? [b, a] : [a, b];
  const merged = { ...older, ...newer };
  merged.conversationTimestamp = Math.max(num(a.conversationTimestamp), num(b.conversationTimestamp)) || undefined;
  merged.unreadCount = Math.max(Number(a.unreadCount) || 0, Number(b.unreadCount) || 0);
  for (const k of ['name', 'displayName', 'username']) merged[k] = newer[k] || older[k] || undefined;
  return merged;
}

// History-sync notifications embed their whole payload (hundreds of KB) and edits,
// revokes and key shares are protocol traffic: none of it is ever shown or re-sent.
function isProtocolOnly(m) {
  const c = unwrapContent(m?.message);
  return !!(c && c.protocolMessage);
}

function createWaStore(options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const canonical = typeof opts.canonical === 'function' ? opts.canonical : (j) => j;
  const chats = new Map();     // canonical jid → chat record
  const messages = new Map();  // canonical jid → Map<msgId, WAMessage>

  const keyFor = (jid) => (jid ? canonical(jid) || jid : jid);

  function upsertChat(c) {
    if (!c?.id) return;
    const id = keyFor(c.id);
    const patch = { ...pickChatFields(c), id };
    const prev = chats.get(id);
    const next = prev ? { ...prev, ...patch } : patch;
    // An update for one alias must not drag the activity time backwards.
    if (prev) {
      const t = Math.max(num(prev.conversationTimestamp), num(patch.conversationTimestamp));
      if (t) next.conversationTimestamp = t;
    }
    chats.set(id, next);
  }

  function messagesFor(jid) {
    return messages.get(keyFor(jid)) || null;
  }

  function trim(bucket) {
    if (bucket.size <= opts.maxMessagesPerChat * 3) return;
    // Trim well above the persisted cap so trimming is rare during a session.
    const sorted = [...bucket.entries()].sort((a, b) => tsOf(a[1]) - tsOf(b[1]));
    for (let i = 0; i < sorted.length - opts.maxMessagesPerChat * 3; i += 1) {
      bucket.delete(sorted[i][0]);
    }
  }

  function putMessages(list) {
    for (const m of list || []) {
      const raw = m?.key?.remoteJid;
      const id = m?.key?.id;
      if (!raw || !id || isProtocolOnly(m)) continue;
      const jid = keyFor(raw);
      if (!messages.has(jid)) messages.set(jid, new Map());
      const bucket = messages.get(jid);
      bucket.set(id, { ...(bucket.get(id) || {}), ...m });
      trim(bucket);
      // Only real content makes a conversation. A lone "messages are end-to-end
      // encrypted" notice must not conjure a chat into the list.
      if (isRealMessage(m)) {
        const chat = chats.get(jid);
        const t = tsOf(m);
        if (!chat) chats.set(jid, { id: jid, conversationTimestamp: t || undefined });
        else if (t > num(chat.conversationTimestamp)) chats.set(jid, { ...chat, conversationTimestamp: t });
      }
    }
  }

  /**
   * Re-file everything under its current canonical id. Call after learning
   * LID↔phone mappings; returns how many entries moved.
   */
  function rekey() {
    let moved = 0;
    for (const jid of [...chats.keys()]) {
      const target = keyFor(jid);
      if (target === jid) continue;
      const rec = { ...chats.get(jid), id: target };
      chats.delete(jid);
      chats.set(target, mergeChatRecords(chats.get(target), rec));
      moved += 1;
    }
    for (const jid of [...messages.keys()]) {
      const target = keyFor(jid);
      if (target === jid) continue;
      const from = messages.get(jid);
      messages.delete(jid);
      const into = messages.get(target) || new Map();
      for (const [id, m] of from) into.set(id, { ...(into.get(id) || {}), ...m });
      messages.set(target, into);
      trim(into);
      moved += 1;
    }
    return moved;
  }

  /** Newest message that carries real content, or null. */
  function lastRealMessage(jid) {
    const bucket = messages.get(keyFor(jid));
    let best = null;
    if (bucket) {
      for (const m of bucket.values()) {
        if (isRealMessage(m) && (!best || tsOf(m) >= tsOf(best))) best = m;
      }
    }
    return best;
  }

  /** When the chat last saw real activity (seconds, 0 = unknown). */
  function activityOf(jid) {
    const c = chats.get(jid);
    return Math.max(num(c?.conversationTimestamp), tsOf(lastRealMessage(jid)));
  }

  /**
   * Belongs in the contact list? Groups always; a 1:1 chat once it has real
   * content. A chat holding only system notices does not — WhatsApp hides those
   * too — unless WhatsApp's own record (it carries the archive flag) dates it.
   * A record with nothing stored at all is what the app-state recovery delivers:
   * trusted when it has a timestamp or an archive/pin/mute state.
   */
  function isListed(jid) {
    const id = keyFor(jid);
    if (!id || id === 'status@broadcast' || id.endsWith('@newsletter') || id.endsWith('@broadcast')) return false;
    if (id.endsWith('@g.us')) return chats.has(id);
    const c = chats.get(id);
    if (!c) return false;
    if (lastRealMessage(id)) return true;
    const fromWhatsApp = c.archived != null || !!c.pinned || !!c.muteEndTime;
    const dated = !!num(c.conversationTimestamp);
    if (messages.get(id)?.size) return fromWhatsApp && dated; // only system notices
    return dated || fromWhatsApp;
  }

  /** Chat ids, newest activity first. */
  function chatJidsByRecency() {
    const ts = new Map([...chats.keys()].map(j => [j, activityOf(j)]));
    return [...chats.keys()].sort((a, b) => ts.get(b) - ts.get(a));
  }

  function deleteChat(jid) {
    const id = keyFor(jid);
    chats.delete(id);
    messages.delete(id);
  }

  function clear() {
    chats.clear();
    messages.clear();
  }

  /** Plain object ready for JSON. `extra` is merged in (contacts, lid mappings…). */
  function snapshot(extra = {}) {
    const order = chatJidsByRecency().filter(isListed);
    const keptChats = order.slice(0, opts.maxChats);
    const msgOut = {};
    keptChats.forEach((jid, i) => {
      const bucket = messages.get(jid);
      if (!bucket || !bucket.size) return;
      const sorted = [...bucket.values()].sort((a, b) => tsOf(a) - tsOf(b));
      if (i < opts.maxMessageChats) {
        msgOut[jid] = sorted.slice(-opts.maxMessagesPerChat);
      } else {
        const real = sorted.filter(isRealMessage);
        if (real.length) msgOut[jid] = real.slice(-opts.previewMessages);
      }
    });
    return {
      version: 2,
      savedAt: Date.now(),
      chats: keptChats.map((jid) => chats.get(jid)),
      messages: msgOut,
      ...extra,
    };
  }

  function hydrate(data) {
    if (!data || typeof data !== 'object') return false;
    clear();
    for (const c of data.chats || []) {
      upsertChat(c);
      // Version-1 files kept the newest message inside the chat record. Feed it in
      // so the chat still has its preview (and is recognised as a real one).
      if (Array.isArray(c?.messages)) {
        putMessages(c.messages.map(x => x?.message).filter(m => m?.key?.id).map(m => ({
          ...m, key: { ...m.key, remoteJid: m.key.remoteJid || c.id },
        })));
      }
    }
    for (const [jid, list] of Object.entries(data.messages || {})) {
      if (!Array.isArray(list)) continue;
      // Repair the key: a persisted message must still know its own chat.
      putMessages(list.filter((m) => m?.key?.id).map((m) => ({
        ...m,
        key: { ...m.key, remoteJid: m.key.remoteJid || jid },
      })));
    }
    if ((Number(data.version) || 1) < 2) dropVersion1Phantoms(data.messages || {});
    return true;
  }

  // Version-1 files filed a chat for EVERY message, protocol traffic included. That
  // is how our own account (it receives the history-sync notifications) and lone
  // encryption notices turned into "contacts". Their protocol messages are no longer
  // stored, so without this they would look like dated chats with nothing in them.
  function dropVersion1Phantoms(persisted) {
    for (const [jid, list] of Object.entries(persisted)) {
      const id = keyFor(jid);
      const c = chats.get(id);
      if (!c || id.endsWith('@g.us') || !Array.isArray(list) || !list.length) continue;
      if (list.some(isRealMessage) || lastRealMessage(id)) continue;
      if (c.archived != null || c.pinned || c.muteEndTime) continue; // WhatsApp's own record
      chats.delete(id);
      messages.delete(id);
    }
  }

  return {
    chats,
    messages,
    upsertChat,
    putMessages,
    messagesFor,
    lastRealMessage,
    activityOf,
    isListed,
    rekey,
    deleteChat,
    chatJidsByRecency,
    snapshot,
    hydrate,
    clear,
    keyFor,
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

module.exports = { createWaStore, loadSnapshot, saveSnapshot, mergeChatRecords, DEFAULTS };

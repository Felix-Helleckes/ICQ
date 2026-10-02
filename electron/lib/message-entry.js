/**
 * Message helpers shared by the WhatsApp bridge (live fetch) and the disk cache.
 *
 * mapMessageEntry tolerates BOTH shapes the bridge deals with:
 *   - a whatsapp-web.js Message instance (fast path, has media handle), and
 *   - a raw serialized message model (defensive path, from pupPage.evaluate).
 * They differ in field names (`timestamp` vs `t`, `fromMe` vs `id.fromMe`,
 * string `author`/`from` vs wid objects), so read both.
 */
const MEDIA_TYPES = ['image', 'video', 'sticker', 'audio', 'ptt', 'document'];

function mapMessageEntry(m) {
  const id = m?.id?._serialized || m?.id || null;
  const fromMe = typeof m?.fromMe === 'boolean' ? m.fromMe : !!m?.id?.fromMe;
  const author = m?.author?._serialized || m?.author || m?.from?._serialized || m?.from || null;
  const type = m?.type || 'chat';
  return {
    id: typeof id === 'string' ? id : (id ? String(id) : null),
    body: m?.body || m?.caption || '',
    fromMe,
    timestamp: Number(m?.timestamp || m?.t || 0),
    author,
    type,
    isGif: !!m?.isGif,
    ack: m?.ack ?? (fromMe ? 1 : -1),
    hasMedia: !!m?.hasMedia || MEDIA_TYPES.includes(type),
    mediaData: null,
  };
}

// A message whose timestamp lies well before the client became ready was sent
// while the app was closed/disconnected and is being REPLAYED by the sync — it
// must not trigger notification sounds or speculative unread bumps (the user
// already saw it on the phone; unread counts come with the chat list). The slack
// absorbs clock drift between WhatsApp's servers and this machine, so a genuinely
// fresh message arriving seconds after startup still notifies normally.
function isBacklogMessage(msgTs, readyAtSec, slackSec = 60) {
  const t = Number(msgTs) || 0;
  const ready = Number(readyAtSec) || 0;
  if (!t || !ready) return false;
  return t < ready - slackSec;
}

// Containers whose `.message` holds the actual content.
const WRAPPERS = [
  'ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension',
  'documentWithCaptionMessage', 'editedMessage', 'deviceSentMessage', 'botInvokeMessage',
  'associatedChildMessage', 'groupStatusMessage', 'groupStatusMessageV2', 'lottieStickerMessage',
];
// Keys that ride along with content but are no content of their own.
const NOT_CONTENT = new Set([
  'messageContextInfo', 'senderKeyDistributionMessage', 'protocolMessage', 'reactionMessage',
  'encReactionMessage', 'pollUpdateMessage', 'keepInChatMessage', 'pinInChatMessage',
  'encEventResponseMessage',
]);

function unwrapContent(message) {
  let m = message;
  for (let i = 0; i < 5 && m && typeof m === 'object'; i += 1) {
    const wrapper = WRAPPERS.find(k => m[k] && m[k].message);
    if (!wrapper) break;
    m = m[wrapper].message;
  }
  return m;
}

/**
 * Does this WAMessage carry something a person wrote or sent? Mirrors Baileys'
 * isRealMessage: system stubs ("messages are end-to-end encrypted"), reactions,
 * edits/revokes and key distribution are not.
 *
 * This is what keeps phantom chats out of the contact list. WhatsApp creates a
 * conversation with a lone E2E notice for every new encryption session — the history
 * sync delivered ~140 of them, each showing up as a bare number above the real chats.
 */
function isRealMessage(m) {
  const c = unwrapContent(m?.message);
  if (!c || typeof c !== 'object') return false;
  if (c.protocolMessage || c.reactionMessage || c.pollUpdateMessage) return false;
  return Object.keys(c).some(k => !NOT_CONTENT.has(k) && c[k] != null);
}

module.exports = { mapMessageEntry, isBacklogMessage, isRealMessage, unwrapContent };

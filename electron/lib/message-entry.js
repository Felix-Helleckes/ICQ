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

module.exports = { mapMessageEntry, isBacklogMessage };

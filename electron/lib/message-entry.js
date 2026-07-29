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

// Merge incoming messages into an existing list, de-duping by id (incoming wins,
// but a previously cached mediaData is preserved when the incoming lacks one),
// sorted ascending by timestamp.
function mergeMessages(existing, incoming) {
  const byId = new Map();
  for (const m of Array.isArray(existing) ? existing : []) {
    if (m && m.id != null) byId.set(String(m.id), m);
  }
  for (const m of Array.isArray(incoming) ? incoming : []) {
    if (!m || m.id == null) continue;
    const key = String(m.id);
    const prev = byId.get(key);
    const next = { ...(prev || {}), ...m };
    if (prev?.mediaData && m.mediaData == null) next.mediaData = prev.mediaData;
    byId.set(key, next);
  }
  return Array.from(byId.values()).sort(
    (a, b) => Number(a?.timestamp || 0) - Number(b?.timestamp || 0),
  );
}

// Keep roughly the last `days` days of messages, but never fewer than `minKeep`
// (so a quiet chat still shows history) nor more than `maxKeep` (cache bound).
function pruneMessages(messages, opts = {}) {
  const days = opts.days ?? 3;
  const minKeep = opts.minKeep ?? 20;
  const maxKeep = opts.maxKeep ?? 200;
  const nowSec = Math.floor((opts.now || Date.now()) / 1000);
  const cutoff = nowSec - days * 86400;

  const sorted = (Array.isArray(messages) ? messages : [])
    .filter(Boolean)
    .slice()
    .sort((a, b) => Number(a?.timestamp || 0) - Number(b?.timestamp || 0));

  // A message with no usable timestamp is NEVER pruned: we cannot tell its age, and
  // dropping it would silently lose messages the user can see nowhere else.
  let kept = sorted.filter((m) => {
    const t = Number(m?.timestamp || 0);
    return t <= 0 || t >= cutoff;
  });
  if (kept.length < minKeep) kept = sorted.slice(-minKeep);
  if (kept.length > maxKeep) kept = kept.slice(-maxKeep);
  return kept;
}

// True when `messages` already reach back to (or past) `sinceTs` — i.e. the cached
// window already covers the requested history, so opening a chat only needs the
// newest messages instead of paging all the way back again.
function coversSince(messages, sinceTs) {
  const list = Array.isArray(messages) ? messages : [];
  if (!list.length) return false;
  let oldest = Infinity;
  for (const m of list) {
    const t = Number(m?.timestamp) || 0;
    if (t > 0 && t < oldest) oldest = t;
  }
  return oldest <= Number(sinceTs || 0);
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

module.exports = { mapMessageEntry, mergeMessages, pruneMessages, coversSince, isBacklogMessage };

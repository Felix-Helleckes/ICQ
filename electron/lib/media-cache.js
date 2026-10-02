/**
 * Downloaded media (as data URLs) per message, shared by both bridges.
 *
 * The chat window refreshes every 8 s, and both bridges used to download every
 * photo, sticker, voice note and video of the visible messages AGAIN on each
 * refresh — per open chat. That is real traffic, and on Telegram it runs into
 * flood-wait limits. The cache is bounded by size (least recently used goes first)
 * and also remembers failures for a while, so an expired media link is not
 * re-requested from the phone on every refresh.
 */
function createMediaCache({ maxBytes = 80 * 1024 * 1024, failTtlMs = 10 * 60 * 1000, now = () => Date.now() } = {}) {
  const items = new Map();   // key → data URL (Map order = recency)
  const failed = new Map();  // key → time of failure
  let bytes = 0;

  function get(key) {
    if (!items.has(key)) return null;
    const v = items.get(key);
    items.delete(key);
    items.set(key, v); // most recently used
    return v;
  }

  function set(key, value) {
    if (!key || typeof value !== 'string') return;
    if (value.length > maxBytes) return; // a single huge video is not worth evicting everything
    if (items.has(key)) bytes -= items.get(key).length;
    items.delete(key);
    items.set(key, value);
    bytes += value.length;
    failed.delete(key);
    while (bytes > maxBytes && items.size) {
      const [oldest, v] = items.entries().next().value;
      items.delete(oldest);
      bytes -= v.length;
    }
  }

  function markFailed(key) { if (key) failed.set(key, now()); }

  function recentlyFailed(key) {
    const t = failed.get(key);
    if (t == null) return false;
    if (now() - t > failTtlMs) { failed.delete(key); return false; }
    return true;
  }

  function clear() { items.clear(); failed.clear(); bytes = 0; }

  return { get, set, markFailed, recentlyFailed, clear, get size() { return items.size; }, get bytes() { return bytes; } };
}

module.exports = { createMediaCache };

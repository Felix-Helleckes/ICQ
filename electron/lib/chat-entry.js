/**
 * Normalize a chat into the flat shape the renderer's contact list needs.
 *
 * Tolerates BOTH representations the bridge can produce:
 *   - a whatsapp-web.js Chat instance (the library fallback path), and
 *   - a raw store model (the fast metadata-free read).
 * They differ in a few field names (`archived` vs `archive`, and a last message
 * carries `.timestamp` on an instance but `.t` on a raw model), so read both.
 * The chat's own activity timestamp (`t`) is the ordering fallback for chats with
 * no last-message preview yet. Group detection also falls back to the `@g.us` id
 * suffix when `isGroup` is missing.
 */
function mapChatEntry(c) {
  const id = c?.id?._serialized || c?.id || null;
  const last = c?.lastMessage || null;
  return {
    id,
    name: c?.name || c?.formattedTitle || (typeof id === 'string' ? id : ''),
    lastMessage: last?.body || '',
    timestamp: last?.timestamp || last?.t || c?.t || c?.timestamp || 0,
    unreadCount: c?.unreadCount || 0,
    isGroup: !!c?.isGroup || (typeof id === 'string' && id.endsWith('@g.us')),
    archived: !!(c?.archived ?? c?.archive),
    avatar: null,
  };
}

module.exports = { mapChatEntry };

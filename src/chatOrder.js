/**
 * Ordering rules for the contact list.
 *
 * The list is grouped into three sections, rendered in this order:
 *   1. Gruppen      (group chats that are not archived)
 *   2. Archiviert   (everything archived, groups included)
 *   3. all remaining direct chats
 *
 * Inside every section the most recent conversation comes first.
 *
 * This used to be left to whatever order the bridge happened to return, which broke
 * as soon as a chat arrived without a timestamp (chats recovered from WhatsApp's app
 * state have none) — those then appeared in arbitrary positions.
 */

export function chatTimestamp(chat) {
  const t = Number(chat?.timestamp);
  return Number.isFinite(t) ? t : 0;
}

/** Newest first; chats without a timestamp fall back to a stable A→Z order. */
export function byRecency(a, b) {
  const diff = chatTimestamp(b) - chatTimestamp(a);
  if (diff) return diff;
  const nameA = String(a?.name || a?.id || '');
  const nameB = String(b?.name || b?.id || '');
  return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
}

/** Split the chat list into its three sections, each sorted newest first. */
export function splitChats(chats, search = '') {
  const query = String(search || '').trim().toLowerCase();
  const list = (Array.isArray(chats) ? chats : []).filter(Boolean);
  const filtered = query
    ? list.filter(c => String(c?.name || c?.id || '').toLowerCase().includes(query))
    : list;

  return {
    groups: filtered.filter(c => c.isGroup && !c.archived).sort(byRecency),
    archived: filtered.filter(c => c.archived).sort(byRecency),
    contacts: filtered.filter(c => !c.isGroup && !c.archived).sort(byRecency),
  };
}

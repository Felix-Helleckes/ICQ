/**
 * Contact name resolution for WhatsApp.
 *
 * WhatsApp addresses the same person by two different JIDs: a LID ("1234@lid") and
 * a phone JID ("4917...@s.whatsapp.net"). A chat can be keyed by one form while the
 * contact record arrives under the other, so a naive `contacts.get(chatJid)` misses
 * and the UI ends up printing raw JIDs instead of names.
 *
 * This directory therefore:
 *   - indexes every contact under all identifiers it carries (id, lid, phoneNumber),
 *   - keeps the LID↔phone mapping WhatsApp sends with the history sync, and
 *   - never lets a partial update overwrite a known name with an empty one.
 *
 * It also decides the ONE id a person's chat is filed under (canonicalFor). Without
 * that, WhatsApp's switch to LID addressing splits a conversation in two: the history
 * holds it under the phone JID, the reply arrives under the LID, and the contact
 * shows up twice in the list.
 */

const LID_SUFFIX = '@lid';
const PN_SUFFIX = '@s.whatsapp.net';

/** "4917…:12@s.whatsapp.net" → "4917…@s.whatsapp.net" (drops the device part). */
function normalizeJid(jid) {
  if (!jid || typeof jid !== 'string') return null;
  const at = jid.indexOf('@');
  if (at < 0) return jid;
  const user = jid.slice(0, at).split(':')[0];
  const server = jid.slice(at + 1);
  return `${user}@${server === 'c.us' ? 's.whatsapp.net' : server}`;
}

const isLid = (jid) => typeof jid === 'string' && jid.endsWith(LID_SUFFIX);
const isPn = (jid) => typeof jid === 'string' && jid.endsWith(PN_SUFFIX);

function createContactDirectory() {
  const contacts = new Map();  // jid (either form) → { name, notify, verifiedName, username }
  const lidToPn = new Map();
  const pnToLid = new Map();
  let mappingRevision = 0;     // bumps on every mapping change — tells callers to re-file chats

  /** Returns true when this taught us something new. */
  function rememberMapping(m) {
    const lid = normalizeJid(m?.lid);
    const pn = normalizeJid(m?.pn);
    // Junk guard: a mapping that pairs two LIDs (or two numbers) would merge two
    // different people into one chat.
    if (!isLid(lid) || !isPn(pn)) return false;
    if (lidToPn.get(lid) === pn && pnToLid.get(pn) === lid) return false;
    // A number that moved to a new LID (or the reverse) must not keep its old twin.
    const oldPn = lidToPn.get(lid);
    const oldLid = pnToLid.get(pn);
    if (oldPn && oldPn !== pn) pnToLid.delete(oldPn);
    if (oldLid && oldLid !== lid) lidToPn.delete(oldLid);
    lidToPn.set(lid, pn);
    pnToLid.set(pn, lid);
    mappingRevision += 1;
    return true;
  }

  /** Returns true when a name or mapping changed. */
  function rememberContact(c) {
    const id = normalizeJid(c?.id);
    if (!id) return false;
    let changed = false;
    for (const key of new Set([id, normalizeJid(c.lid), normalizeJid(c.phoneNumber)])) {
      if (!key) continue;
      const prev = contacts.get(key) || {};
      const next = {
        name: c.name || prev.name || null,
        notify: c.notify || prev.notify || null,
        verifiedName: c.verifiedName || prev.verifiedName || null,
        username: c.username || prev.username || null,
      };
      if (next.name !== prev.name || next.notify !== prev.notify
        || next.verifiedName !== prev.verifiedName || next.username !== prev.username) {
        changed = true;
      }
      contacts.set(key, next);
    }
    const lid = isLid(id) ? id : normalizeJid(c.lid);
    const pn = isPn(id) ? id : normalizeJid(c.phoneNumber);
    if (lid && pn && rememberMapping({ lid, pn })) changed = true;
    return changed;
  }

  function counterpart(jid) {
    const j = normalizeJid(jid);
    return lidToPn.get(j) || pnToLid.get(j) || null;
  }

  /** Saved address-book name first, then the name the contact set themselves. */
  function nameFor(jid) {
    const j = normalizeJid(jid);
    if (!j) return null;
    const direct = contacts.get(j);
    const other = counterpart(j);
    const alt = other ? contacts.get(other) : null;
    return (
      (direct && direct.name) || (alt && alt.name)
      || (direct && direct.notify) || (alt && alt.notify)
      || (direct && direct.verifiedName) || (alt && alt.verifiedName)
      || (direct && direct.username) || (alt && alt.username)
      || null
    );
  }

  /** Last resort so a raw JID never reaches the UI. */
  function prettyIdFor(jid) {
    const s = normalizeJid(jid) || String(jid || '');
    const local = s.split('@')[0];
    if (!local) return s.replace(/@/g, '');
    if (isPn(s)) return `+${local}`;
    const pn = lidToPn.get(s);
    if (pn) return `+${pn.split('@')[0]}`;
    return local; // a LID with no known number — at least drop the @lid suffix
  }

  /** What the contact list should show. */
  function displayFor(jid) {
    return nameFor(jid) || prettyIdFor(jid);
  }

  /**
   * The id a person's chat is filed under. The phone JID wins whenever it is known:
   * address-book names are keyed by it and it is the only form that can be shown
   * as a readable number. Groups and everything else stay as they are.
   */
  function canonicalFor(jid) {
    const j = normalizeJid(jid);
    if (!j) return j;
    if (isLid(j)) return lidToPn.get(j) || j;
    return j;
  }

  /** Every id the chat with this person may arrive under, canonical first. */
  function aliasesFor(jid) {
    const j = normalizeJid(jid);
    if (!j) return [];
    const canonical = canonicalFor(j);
    return [...new Set([canonical, j, counterpart(canonical)].filter(Boolean))];
  }

  function hasMapping(jid) {
    return !!counterpart(jid);
  }

  function clear() {
    contacts.clear();
    lidToPn.clear();
    pnToLid.clear();
  }

  /**
   * Names must survive a restart: WhatsApp only pushes the contact list during the
   * history sync right after linking, so without persisting these the chat list
   * would fall back to bare phone numbers on every later start.
   */
  function toJSON() {
    return {
      contacts: [...contacts.entries()]
        // An entry that knows no name at all is worthless on disk.
        .filter(([, v]) => v.name || v.notify || v.verifiedName || v.username)
        .map(([id, v]) => [id, v.name || null, v.notify || null, v.verifiedName || null, v.username || null]),
      mappings: [...lidToPn.entries()].map(([lid, pn]) => [lid, pn]),
    };
  }

  function hydrate(data) {
    if (!data || typeof data !== 'object') return false;
    for (const row of data.mappings || []) {
      if (Array.isArray(row)) rememberMapping({ lid: row[0], pn: row[1] });
    }
    for (const row of data.contacts || []) {
      if (!Array.isArray(row) || !row[0]) continue;
      rememberContact({ id: row[0], name: row[1], notify: row[2], verifiedName: row[3], username: row[4] });
    }
    return true;
  }

  return {
    rememberMapping, rememberContact, nameFor, prettyIdFor, displayFor,
    canonicalFor, aliasesFor, hasMapping, clear, toJSON, hydrate,
    get size() { return contacts.size; },
    get mappingCount() { return lidToPn.size; },
    get mappingRevision() { return mappingRevision; },
  };
}

module.exports = { createContactDirectory, normalizeJid, isLid, isPn };

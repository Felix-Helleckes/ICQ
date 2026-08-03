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
 */
function createContactDirectory() {
  const contacts = new Map();  // jid (either form) → { name, notify, verifiedName }
  const lidToPn = new Map();
  const pnToLid = new Map();

  function rememberMapping(m) {
    if (!m || !m.lid || !m.pn) return;
    lidToPn.set(m.lid, m.pn);
    pnToLid.set(m.pn, m.lid);
  }

  function rememberContact(c) {
    if (!c || !c.id) return;
    for (const key of [c.id, c.lid, c.phoneNumber]) {
      if (!key) continue;
      const prev = contacts.get(key) || {};
      contacts.set(key, {
        name: c.name || prev.name || null,
        notify: c.notify || prev.notify || null,
        verifiedName: c.verifiedName || prev.verifiedName || null,
      });
    }
    if (c.lid && c.phoneNumber) rememberMapping({ lid: c.lid, pn: c.phoneNumber });
  }

  function counterpart(jid) {
    return lidToPn.get(jid) || pnToLid.get(jid) || null;
  }

  /** Saved address-book name first, then the name the contact set themselves. */
  function nameFor(jid) {
    if (!jid) return null;
    const direct = contacts.get(jid);
    const other = counterpart(jid);
    const alt = other ? contacts.get(other) : null;
    return (
      (direct && direct.name) || (alt && alt.name)
      || (direct && direct.notify) || (alt && alt.notify)
      || (direct && direct.verifiedName) || (alt && alt.verifiedName)
      || null
    );
  }

  /** Last resort so a raw JID never reaches the UI. */
  function prettyIdFor(jid) {
    const s = String(jid || '');
    const local = s.split('@')[0];
    if (!local) return s;
    if (s.endsWith('@s.whatsapp.net')) return `+${local}`;
    const pn = lidToPn.get(s);
    if (pn) return `+${String(pn).split('@')[0]}`;
    return local; // a LID with no known number — at least drop the @lid suffix
  }

  /** What the contact list should show. */
  function displayFor(jid) {
    return nameFor(jid) || prettyIdFor(jid);
  }

  function clear() {
    contacts.clear();
    lidToPn.clear();
    pnToLid.clear();
  }

  return { rememberMapping, rememberContact, nameFor, prettyIdFor, displayFor, clear };
}

module.exports = { createContactDirectory };

const { createContactDirectory } = require('./contact-names');

const LID = '5312908161069@lid';
const PN = '491758316710@s.whatsapp.net';

test('finds the name when the chat is keyed by LID but the contact came in by phone', () => {
  const d = createContactDirectory();
  d.rememberMapping({ lid: LID, pn: PN });
  d.rememberContact({ id: PN, name: 'Anna Beispiel' });
  expect(d.nameFor(LID)).toBe('Anna Beispiel');
});

test('and the other way round — contact by LID, chat keyed by phone', () => {
  const d = createContactDirectory();
  d.rememberMapping({ lid: LID, pn: PN });
  d.rememberContact({ id: LID, name: 'Anna Beispiel' });
  expect(d.nameFor(PN)).toBe('Anna Beispiel');
});

test('a contact carrying both identifiers is indexed under both — no mapping needed', () => {
  const d = createContactDirectory();
  d.rememberContact({ id: LID, lid: LID, phoneNumber: PN, name: 'Bob' });
  expect(d.nameFor(LID)).toBe('Bob');
  expect(d.nameFor(PN)).toBe('Bob');
});

test('the saved address-book name wins over the self-set pushname', () => {
  const d = createContactDirectory();
  d.rememberContact({ id: PN, name: 'Saved Name', notify: 'pushname' });
  expect(d.nameFor(PN)).toBe('Saved Name');
});

test('falls back to notify, then verifiedName', () => {
  const d = createContactDirectory();
  d.rememberContact({ id: PN, notify: 'Pushname' });
  expect(d.nameFor(PN)).toBe('Pushname');
  const d2 = createContactDirectory();
  d2.rememberContact({ id: PN, verifiedName: 'Business GmbH' });
  expect(d2.nameFor(PN)).toBe('Business GmbH');
});

test('a partial update never wipes an already known name', () => {
  const d = createContactDirectory();
  d.rememberContact({ id: PN, name: 'Anna' });
  d.rememberContact({ id: PN, notify: 'anna_' }); // update without a name
  expect(d.nameFor(PN)).toBe('Anna');
});

test('unknown contact → no name', () => {
  const d = createContactDirectory();
  expect(d.nameFor('49999@s.whatsapp.net')).toBeNull();
});

describe('prettyIdFor — a raw JID must never reach the UI', () => {
  test('phone JID becomes a readable number', () => {
    const d = createContactDirectory();
    expect(d.prettyIdFor(PN)).toBe('+491758316710');
  });
  test('a LID resolves to its mapped number when known', () => {
    const d = createContactDirectory();
    d.rememberMapping({ lid: LID, pn: PN });
    expect(d.prettyIdFor(LID)).toBe('+491758316710');
  });
  test('an unmapped LID at least loses the @lid suffix', () => {
    const d = createContactDirectory();
    expect(d.prettyIdFor(LID)).toBe('5312908161069');
  });
  test('never returns a string containing "@"', () => {
    const d = createContactDirectory();
    for (const jid of [PN, LID, '4917@g.us']) {
      expect(d.prettyIdFor(jid)).not.toContain('@');
    }
  });
});

test('displayFor prefers the name and falls back to the pretty id', () => {
  const d = createContactDirectory();
  expect(d.displayFor(PN)).toBe('+491758316710');
  d.rememberContact({ id: PN, name: 'Anna' });
  expect(d.displayFor(PN)).toBe('Anna');
});

test('clear() drops contacts and mappings', () => {
  const d = createContactDirectory();
  d.rememberMapping({ lid: LID, pn: PN });
  d.rememberContact({ id: PN, name: 'Anna' });
  d.clear();
  expect(d.nameFor(LID)).toBeNull();
  expect(d.prettyIdFor(LID)).toBe('5312908161069');
});

// ── One chat per person ────────────────────────────────────────────────────

describe('canonicalFor — which id a person\'s chat is filed under', () => {
  test('a LID with a known number files under the number', () => {
    const d = createContactDirectory();
    d.rememberMapping({ lid: LID, pn: PN });
    expect(d.canonicalFor(LID)).toBe(PN);
    expect(d.canonicalFor(PN)).toBe(PN);
  });
  test('an unmapped LID stays a LID; groups are untouched', () => {
    const d = createContactDirectory();
    expect(d.canonicalFor(LID)).toBe(LID);
    expect(d.canonicalFor('1203630001@g.us')).toBe('1203630001@g.us');
  });
  test('device suffixes are dropped — "4917…:12@…" is the same person', () => {
    const d = createContactDirectory();
    d.rememberMapping({ lid: '5312908161069:3@lid', pn: '491758316710:0@s.whatsapp.net' });
    expect(d.canonicalFor(LID)).toBe(PN);
    expect(d.canonicalFor('491758316710:7@s.whatsapp.net')).toBe(PN);
  });
  test('aliasesFor lists every id the chat may arrive under, canonical first', () => {
    const d = createContactDirectory();
    d.rememberMapping({ lid: LID, pn: PN });
    expect(d.aliasesFor(LID)).toEqual([PN, LID]);
    expect(d.aliasesFor(PN)).toEqual([PN, LID]);
  });
});

describe('rememberMapping', () => {
  test('rejects pairs that are not LID + number — they would merge two people', () => {
    const d = createContactDirectory();
    expect(d.rememberMapping({ lid: LID, pn: '777@lid' })).toBe(false);
    expect(d.rememberMapping({ lid: PN, pn: PN })).toBe(false);
    expect(d.mappingCount).toBe(0);
  });
  test('reports only real news, and bumps the revision exactly then', () => {
    const d = createContactDirectory();
    expect(d.rememberMapping({ lid: LID, pn: PN })).toBe(true);
    const rev = d.mappingRevision;
    expect(d.rememberMapping({ lid: LID, pn: PN })).toBe(false);
    expect(d.mappingRevision).toBe(rev);
  });
  test('a LID that moves to a new number does not keep the old twin', () => {
    const d = createContactDirectory();
    d.rememberMapping({ lid: LID, pn: PN });
    d.rememberMapping({ lid: LID, pn: '4915200000000@s.whatsapp.net' });
    expect(d.canonicalFor(LID)).toBe('4915200000000@s.whatsapp.net');
    expect(d.canonicalFor(PN)).toBe(PN);
    expect(d.hasMapping(PN)).toBe(false);
  });
});

test('rememberContact says whether anything changed', () => {
  const d = createContactDirectory();
  expect(d.rememberContact({ id: PN, notify: 'Anna' })).toBe(true);
  expect(d.rememberContact({ id: PN, notify: 'Anna' })).toBe(false);
  expect(d.rememberContact({ id: PN, name: 'Anna Beispiel' })).toBe(true);
});

test('a WhatsApp username is the last name before the number', () => {
  const d = createContactDirectory();
  d.rememberContact({ id: LID, username: 'anna.b' });
  expect(d.displayFor(LID)).toBe('anna.b');
});

test('persisted directory round-trips and skips entries without any name', () => {
  const d = createContactDirectory();
  d.rememberMapping({ lid: LID, pn: PN });
  d.rememberContact({ id: PN, name: 'Anna', username: 'anna.b' });
  d.rememberContact({ id: '4916000000000@s.whatsapp.net' }); // knows nothing
  const json = JSON.parse(JSON.stringify(d.toJSON()));
  expect(json.contacts).toHaveLength(1);

  const back = createContactDirectory();
  back.hydrate(json);
  expect(back.nameFor(LID)).toBe('Anna');
  expect(back.canonicalFor(LID)).toBe(PN);
});

test('version-1 rows (four columns) still load', () => {
  const d = createContactDirectory();
  d.hydrate({ contacts: [[PN, 'Anna', null, null]], mappings: [[LID, PN]] });
  expect(d.nameFor(LID)).toBe('Anna');
});

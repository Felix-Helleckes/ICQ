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

const { createWaStore, loadSnapshot, saveSnapshot } = require('./wa-store');

const A = '491700000001@s.whatsapp.net';
const B = '491700000002@s.whatsapp.net';

const msg = (jid, id, ts, text = 'x') => ({
  key: { remoteJid: jid, id }, messageTimestamp: ts, message: { conversation: text },
});

// In-memory stand-in for fs, so the persistence logic is testable without disk.
function fakeFs() {
  const files = new Map();
  return {
    files,
    existsSync: (p) => files.has(p),
    readFileSync: (p) => {
      if (!files.has(p)) throw new Error('ENOENT');
      return files.get(p);
    },
    writeFileSync: (p, d) => { files.set(p, d); },
    renameSync: (a, b) => { files.set(b, files.get(a)); files.delete(a); },
    rmSync: (p) => { files.delete(p); },
  };
}

test('a message creates its chat, so nothing is orphaned', () => {
  const s = createWaStore();
  s.putMessages([msg(A, 'M1', 100)]);
  expect(s.chatCount).toBe(1);
  expect(s.messagesFor(A).size).toBe(1);
});

test('chats are ordered by most recent activity', () => {
  const s = createWaStore();
  s.upsertChat({ id: A, conversationTimestamp: 100 });
  s.upsertChat({ id: B, conversationTimestamp: 500 });
  expect(s.chatJidsByRecency()).toEqual([B, A]);
});

test('a snapshot round-trips chats and messages', () => {
  const s = createWaStore();
  s.upsertChat({ id: A, conversationTimestamp: 200, unreadCount: 3 });
  s.putMessages([msg(A, 'M1', 100, 'hello'), msg(A, 'M2', 200, 'world')]);

  const restored = createWaStore();
  restored.hydrate(s.snapshot());

  expect(restored.chatCount).toBe(1);
  expect(restored.chats.get(A).unreadCount).toBe(3);
  const msgs = [...restored.messagesFor(A).values()].map(m => m.message.conversation);
  expect(msgs).toEqual(['hello', 'world']);
});

test('a restored message still knows which chat it belongs to', () => {
  const s = createWaStore();
  s.putMessages([msg(A, 'M1', 100)]);
  const snap = JSON.parse(JSON.stringify(s.snapshot()));
  // Strip the remoteJid the way a hand-edited/older file might have it.
  snap.messages[A][0].key.remoteJid = undefined;

  const restored = createWaStore();
  restored.hydrate(snap);
  expect(restored.messagesFor(A).get('M1').key.remoteJid).toBe(A);
});

test('the snapshot is bounded — old chats and surplus messages are dropped', () => {
  const s = createWaStore({ maxChats: 2, maxMessagesPerChat: 2, maxMessageChats: 2 });
  for (let i = 0; i < 5; i += 1) {
    const jid = `4917000000${i}@s.whatsapp.net`;
    s.upsertChat({ id: jid, conversationTimestamp: i * 100 });
    s.putMessages([msg(jid, `${i}-a`, i * 100), msg(jid, `${i}-b`, i * 100 + 1), msg(jid, `${i}-c`, i * 100 + 2)]);
  }
  const snap = s.snapshot();
  expect(snap.chats).toHaveLength(2);
  for (const list of Object.values(snap.messages)) expect(list.length).toBeLessThanOrEqual(2);
  // The newest chat is the one kept.
  expect(snap.chats[0].id).toBe('49170000004@s.whatsapp.net');
});

test('extra data (contacts) rides along in the snapshot', () => {
  const s = createWaStore();
  s.upsertChat({ id: A });
  const snap = s.snapshot({ contactDirectory: { contacts: [[A, 'Alice', null, null]] } });
  expect(snap.contactDirectory.contacts[0][1]).toBe('Alice');
});

describe('file persistence', () => {
  test('saves and loads', () => {
    const fs = fakeFs();
    const s = createWaStore();
    s.upsertChat({ id: A, conversationTimestamp: 10 });
    expect(saveSnapshot('/store.json', s.snapshot(), fs)).toBe(true);

    const loaded = loadSnapshot('/store.json', fs);
    expect(loaded.chats[0].id).toBe(A);
  });

  test('writes atomically — the temp file is gone afterwards', () => {
    const fs = fakeFs();
    saveSnapshot('/store.json', { chats: [] }, fs);
    expect(fs.files.has('/store.json.tmp')).toBe(false);
    expect(fs.files.has('/store.json')).toBe(true);
  });

  test('a missing file loads as null instead of throwing', () => {
    expect(loadSnapshot('/nope.json', fakeFs())).toBeNull();
  });

  test('a corrupt file loads as null — the bridge must still start', () => {
    const fs = fakeFs();
    fs.writeFileSync('/store.json', '{ this is not json');
    expect(loadSnapshot('/store.json', fs)).toBeNull();
  });

  test('a failed write reports false and leaves no temp file', () => {
    const fs = fakeFs();
    fs.renameSync = () => { throw new Error('EPERM'); };
    expect(saveSnapshot('/store.json', { chats: [] }, fs)).toBe(false);
    expect(fs.files.has('/store.json.tmp')).toBe(false);
  });
});

// ── One chat per person, real chats only ──────────────────────────────────

const { createContactDirectory } = require('./contact-names');

const LID = '55500000002@lid';
const PN = '491700000002@s.whatsapp.net';

function storeWithDirectory(options) {
  const contacts = createContactDirectory();
  const s = createWaStore({ ...options, canonical: (j) => contacts.canonicalFor(j) });
  return { s, contacts };
}

const stub = (jid, id, ts) => ({ key: { remoteJid: jid, id, fromMe: true }, messageTimestamp: ts, messageStubType: 75 });

describe('canonical filing', () => {
  test('a reply under the LID lands in the phone-number chat', () => {
    const { s, contacts } = storeWithDirectory();
    contacts.rememberMapping({ lid: LID, pn: PN });
    s.upsertChat({ id: PN, conversationTimestamp: 100 });
    s.putMessages([msg(LID, 'R1', 200, 'reply')]);
    expect([...s.chats.keys()]).toEqual([PN]);
    expect(s.messagesFor(LID).get('R1').message.conversation).toBe('reply');
    expect(s.messagesFor(PN).size).toBe(1);
  });

  test('rekey() folds twins together once the mapping is learned', () => {
    const { s, contacts } = storeWithDirectory();
    s.upsertChat({ id: PN, conversationTimestamp: 100, archived: false, unreadCount: 0 });
    s.upsertChat({ id: LID, conversationTimestamp: 300, unreadCount: 2 });
    s.putMessages([msg(PN, 'A', 100), msg(LID, 'B', 300)]);
    expect(s.chatCount).toBe(2);

    contacts.rememberMapping({ lid: LID, pn: PN });
    expect(s.rekey()).toBeGreaterThan(0);

    expect([...s.chats.keys()]).toEqual([PN]);
    const chat = s.chats.get(PN);
    expect(chat.conversationTimestamp).toBe(300);
    expect(chat.unreadCount).toBe(2);
    expect([...s.messagesFor(PN).keys()].sort()).toEqual(['A', 'B']);
    expect(s.rekey()).toBe(0); // idempotent
  });

  test('an update under one alias never drags the activity time backwards', () => {
    const { s, contacts } = storeWithDirectory();
    contacts.rememberMapping({ lid: LID, pn: PN });
    s.upsertChat({ id: PN, conversationTimestamp: 500 });
    s.upsertChat({ id: LID, conversationTimestamp: 100, archived: true });
    expect(s.chats.get(PN)).toMatchObject({ conversationTimestamp: 500, archived: true });
  });
});

describe('isListed — phantom chats stay out of the contact list', () => {
  test('a lone encryption notice creates no chat at all', () => {
    const s = createWaStore();
    s.putMessages([stub(LID, 'E2E', 100)]);
    expect(s.chatCount).toBe(0);
    expect(s.isListed(LID)).toBe(false);
  });

  test('a history conversation holding only a notice and no timestamp is hidden', () => {
    const s = createWaStore();
    s.upsertChat({ id: LID, accountLid: LID });
    s.putMessages([stub(LID, 'E2E', 100)]);
    expect(s.isListed(LID)).toBe(false);
  });

  test('real content lists a chat; groups are always listed', () => {
    const s = createWaStore();
    s.putMessages([msg(A, 'M1', 100)]);
    s.upsertChat({ id: '1203630001@g.us' });
    expect(s.isListed(A)).toBe(true);
    expect(s.isListed('1203630001@g.us')).toBe(true);
  });

  test('WhatsApp\'s own dated record stays even if its newest event is a notice', () => {
    const s = createWaStore();
    s.upsertChat({ id: A, conversationTimestamp: 100, archived: false });
    s.putMessages([stub(A, 'SEC', 100)]);
    expect(s.isListed(A)).toBe(true);
  });

  test('app-state recovery records (nothing stored) are trusted', () => {
    const s = createWaStore();
    s.upsertChat({ id: A, archived: true });
    s.upsertChat({ id: B, conversationTimestamp: 100 });
    expect(s.isListed(A)).toBe(true);
    expect(s.isListed(B)).toBe(true);
  });

  test('status, broadcast and channel ids are never listed', () => {
    const s = createWaStore();
    s.putMessages([msg('status@broadcast', 'S', 1), msg('12036@newsletter', 'N', 1)]);
    expect(s.isListed('status@broadcast')).toBe(false);
    expect(s.isListed('12036@newsletter')).toBe(false);
  });
});

describe('what goes on disk', () => {
  test('protocol traffic (history-sync payloads, key shares) is not stored', () => {
    const s = createWaStore();
    s.putMessages([{
      key: { remoteJid: A, id: 'P1', fromMe: true },
      messageTimestamp: 100,
      message: { protocolMessage: { historySyncNotification: { initialHistBootstrapInlinePayload: 'x'.repeat(1000) } } },
    }]);
    expect(s.messagesFor(A)).toBeNull();
    expect(s.chatCount).toBe(0);
  });

  test('chat records keep only the fields the app reads', () => {
    const s = createWaStore();
    s.upsertChat({ id: A, conversationTimestamp: 1, messages: [{ message: {} }], participant: [{ id: 'x' }], tcToken: 'abc' });
    expect(Object.keys(s.chats.get(A)).sort()).toEqual(['conversationTimestamp', 'id']);
  });

  test('unlisted chats are not persisted; older chats keep their newest message for the preview', () => {
    const s = createWaStore({ maxMessageChats: 1, maxMessagesPerChat: 5 });
    s.putMessages([msg(A, 'A1', 100, 'old'), msg(A, 'A2', 110, 'newest of A')]);
    s.putMessages([msg(B, 'B1', 500)]);
    s.upsertChat({ id: LID });
    s.putMessages([stub(LID, 'E2E', 900)]);

    const snap = s.snapshot();
    expect(snap.chats.map(c => c.id)).toEqual([B, A]);
    expect(snap.messages[A].map(m => m.message.conversation)).toEqual(['newest of A']);
  });

  test('loading a version-1 file drops its phantoms and keeps the real chats', () => {
    const SELF_LID = '99900000009@lid';
    const v1 = {
      version: 1,
      chats: [
        // Our own account: v1 filed a chat for its history-sync notifications.
        { id: SELF_LID, conversationTimestamp: 900 },
        // History conversation with a lone notice nested inside.
        { id: LID, accountLid: LID, participant: [], messages: [{ message: stub(LID, 'E2E', 800) }] },
        // A real chat whose only copy of its newest message is the nested one.
        { id: A, conversationTimestamp: 700, archived: false, messages: [{ message: msg(A, 'N1', 700, 'nested') }] },
      ],
      messages: {
        [SELF_LID]: [{ key: { remoteJid: SELF_LID, id: 'H1', fromMe: true }, messageTimestamp: 900, message: { protocolMessage: {} } }],
      },
    };
    const s = createWaStore();
    s.hydrate(JSON.parse(JSON.stringify(v1)));
    const listed = [...s.chats.keys()].filter(s.isListed);
    expect(listed).toEqual([A]);
    expect(s.lastRealMessage(A).message.conversation).toBe('nested');
  });
});

test('a mapping learned anywhere re-files the store before its next use — no orphaned chat', () => {
  // Learned outside the store's own events (e.g. from a group's member list):
  // the chat under the LID must not vanish from the list or from the next save.
  const contacts = createContactDirectory();
  const s = createWaStore({ canonical: (j) => contacts.canonicalFor(j), revision: () => contacts.mappingRevision });
  s.putMessages([msg(LID, 'L1', 100, 'hello')]);
  contacts.rememberMapping({ lid: LID, pn: PN });

  expect(s.isListed(LID)).toBe(true);
  expect(s.isListed(PN)).toBe(true);
  expect(s.messagesFor(LID).get('L1')).toBeTruthy();
  expect(s.snapshot().chats.map(c => c.id)).toEqual([PN]);
});

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

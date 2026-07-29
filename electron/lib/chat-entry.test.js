const { mapChatEntry } = require('./chat-entry');

test('maps a whatsapp-web.js Chat instance (fast path)', () => {
  const chat = {
    id: { _serialized: '491234567890@c.us' },
    name: 'Alice',
    lastMessage: { body: 'hey', timestamp: 1700000000 },
    unreadCount: 3,
    isGroup: false,
    archived: false,
  };
  expect(mapChatEntry(chat)).toEqual({
    id: '491234567890@c.us',
    name: 'Alice',
    lastMessage: 'hey',
    timestamp: 1700000000,
    unreadCount: 3,
    isGroup: false,
    archived: false,
    avatar: null,
  });
});

test('maps a raw serialized model (defensive path) with .t / archive / formattedTitle', () => {
  const model = {
    id: { _serialized: '49999@g.us' },
    formattedTitle: 'Family',
    lastMessage: { body: 'dinner?', t: 1699999999 },
    unreadCount: 0,
    archive: true,
    // note: isGroup absent → must be inferred from the @g.us suffix
  };
  const out = mapChatEntry(model);
  expect(out.name).toBe('Family');
  expect(out.lastMessage).toBe('dinner?');
  expect(out.timestamp).toBe(1699999999);
  expect(out.isGroup).toBe(true);
  expect(out.archived).toBe(true);
});

test('minimal entry (getChatModel failed): no last message, name falls back to id', () => {
  const minimal = {
    id: { _serialized: '4977@g.us' },
    name: null,
    lastMessage: null,
    unreadCount: 2,
    isGroup: true,
    archive: false,
  };
  const out = mapChatEntry(minimal);
  expect(out.id).toBe('4977@g.us');
  expect(out.name).toBe('4977@g.us'); // no title → id used
  expect(out.lastMessage).toBe('');
  expect(out.timestamp).toBe(0);
  expect(out.isGroup).toBe(true);
  expect(out.unreadCount).toBe(2);
});

test('falls back to the chat activity timestamp when there is no last message', () => {
  // A chat whose messages have not synced yet still has to sort correctly.
  const out = mapChatEntry({ id: { _serialized: '49555@c.us' }, formattedTitle: 'Carol', lastMessage: null, t: 1700000500 });
  expect(out.timestamp).toBe(1700000500);
  expect(out.lastMessage).toBe('');
});

test('prefers the last message timestamp over the chat activity timestamp', () => {
  const out = mapChatEntry({
    id: { _serialized: '49555@c.us' }, name: 'Dave',
    lastMessage: { body: 'yo', t: 1700000999 }, t: 1700000001,
  });
  expect(out.timestamp).toBe(1700000999);
});

test('tolerates a plain-string id', () => {
  const out = mapChatEntry({ id: '123@c.us', name: 'Bob' });
  expect(out.id).toBe('123@c.us');
  expect(out.isGroup).toBe(false);
});

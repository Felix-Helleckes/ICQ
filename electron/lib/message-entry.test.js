const { mapMessageEntry, isBacklogMessage } = require('./message-entry');

describe('isBacklogMessage', () => {
  const ready = 10000; // client became ready at t=10000s

  test('a message from well before ready is backlog (sent while app was closed)', () => {
    expect(isBacklogMessage(ready - 3600, ready)).toBe(true);
  });
  test('a fresh message right after startup is NOT backlog', () => {
    expect(isBacklogMessage(ready + 5, ready)).toBe(false);
  });
  test('slack absorbs clock drift — a message 30s "old" still notifies', () => {
    expect(isBacklogMessage(ready - 30, ready)).toBe(false);
  });
  test('missing timestamp or ready time → never classified as backlog', () => {
    expect(isBacklogMessage(0, ready)).toBe(false);
    expect(isBacklogMessage(ready - 3600, 0)).toBe(false);
    expect(isBacklogMessage(undefined, undefined)).toBe(false);
  });
});

describe('mapMessageEntry', () => {
  test('maps a whatsapp-web.js Message instance', () => {
    const msg = {
      id: { _serialized: 'AAA' },
      body: 'hi',
      fromMe: true,
      timestamp: 1700000000,
      author: '49111@c.us',
      type: 'chat',
      ack: 2,
      hasMedia: false,
    };
    expect(mapMessageEntry(msg)).toEqual({
      id: 'AAA', body: 'hi', fromMe: true, timestamp: 1700000000,
      author: '49111@c.us', type: 'chat', isGif: false, ack: 2,
      hasMedia: false, mediaData: null,
    });
  });

  test('maps a raw serialized model (t / id.fromMe / wid author / media type)', () => {
    const raw = {
      id: { _serialized: 'BBB', fromMe: false },
      caption: 'look',
      t: 1699999999,
      author: { _serialized: '49222@c.us' },
      type: 'image',
    };
    const out = mapMessageEntry(raw);
    expect(out.id).toBe('BBB');
    expect(out.fromMe).toBe(false);
    expect(out.body).toBe('look');
    expect(out.timestamp).toBe(1699999999);
    expect(out.author).toBe('49222@c.us');
    expect(out.hasMedia).toBe(true); // inferred from type=image
    expect(out.ack).toBe(-1); // not fromMe, no ack → default
  });
});

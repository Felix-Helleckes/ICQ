const { mapMessageEntry, mergeMessages, pruneMessages, coversSince, isBacklogMessage } = require('./message-entry');

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

describe('coversSince', () => {
  const since = 1000;
  test('false for an empty cache — nothing is covered', () => {
    expect(coversSince([], since)).toBe(false);
    expect(coversSince(null, since)).toBe(false);
  });
  test('true when the cache reaches back past the cutoff', () => {
    expect(coversSince([{ timestamp: 900 }, { timestamp: 2000 }], since)).toBe(true);
  });
  test('false when the cache only holds newer messages', () => {
    expect(coversSince([{ timestamp: 1500 }, { timestamp: 2000 }], since)).toBe(false);
  });
  test('ignores unusable timestamps when finding the oldest', () => {
    expect(coversSince([{ timestamp: 0 }, { timestamp: 1500 }], since)).toBe(false);
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

describe('mergeMessages', () => {
  test('de-dupes by id (incoming wins) and sorts ascending', () => {
    const existing = [{ id: 'a', timestamp: 10, body: 'old' }, { id: 'b', timestamp: 20 }];
    const incoming = [{ id: 'a', timestamp: 10, body: 'new' }, { id: 'c', timestamp: 5 }];
    const out = mergeMessages(existing, incoming);
    expect(out.map((m) => m.id)).toEqual(['c', 'a', 'b']);
    expect(out.find((m) => m.id === 'a').body).toBe('new');
  });

  test('keeps already-cached mediaData when incoming has none', () => {
    const existing = [{ id: 'a', timestamp: 1, mediaData: 'data:img' }];
    const incoming = [{ id: 'a', timestamp: 1, mediaData: null }];
    expect(mergeMessages(existing, incoming)[0].mediaData).toBe('data:img');
  });
});

describe('pruneMessages', () => {
  const now = 10 * 86400 * 1000; // day 10, in ms

  test('keeps only the last 7 days when there are enough recent messages', () => {
    // Days 1..40 — deliberately no timestamp 0, which means "unknown age" (kept).
    const msgs = Array.from({ length: 40 }, (_, i) => ({ id: String(i), timestamp: (i + 1) * 86400 }));
    const kept = pruneMessages(msgs, { days: 7, minKeep: 5, now }); // now = day 10 → cutoff day 3
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.every((m) => m.timestamp >= (10 - 7) * 86400)).toBe(true);
  });

  test('keeps at least minKeep even if older than the window', () => {
    const msgs = Array.from({ length: 40 }, (_, i) => ({ id: String(i), timestamp: i })); // all ancient
    const kept = pruneMessages(msgs, { days: 7, minKeep: 20, now });
    expect(kept).toHaveLength(20);
    expect(kept[kept.length - 1].id).toBe('39'); // newest retained
  });

  test('defaults to a 3-day window', () => {
    const nowSec = now / 1000;
    const msgs = [
      ...Array.from({ length: 30 }, (_, i) => ({ id: `old${i}`, timestamp: nowSec - 5 * 86400 })), // 5 days old
      ...Array.from({ length: 30 }, (_, i) => ({ id: `new${i}`, timestamp: nowSec - 86400 })),     // 1 day old
    ];
    const kept = pruneMessages(msgs, { now }); // no `days` → default
    expect(kept).toHaveLength(30);
    expect(kept.every((m) => m.id.startsWith('new'))).toBe(true);
  });

  test('never prunes messages whose timestamp is unknown', () => {
    const nowSec = now / 1000;
    const msgs = [
      ...Array.from({ length: 30 }, (_, i) => ({ id: `t0-${i}`, timestamp: 0 })),        // unknown age
      ...Array.from({ length: 30 }, (_, i) => ({ id: `new${i}`, timestamp: nowSec - 60 })), // fresh
    ];
    const kept = pruneMessages(msgs, { days: 3, minKeep: 5, now });
    expect(kept).toHaveLength(60); // all kept — none dropped for being "old"
  });

  test('caps at maxKeep', () => {
    const msgs = Array.from({ length: 500 }, (_, i) => ({ id: String(i), timestamp: now / 1000 - i }));
    const kept = pruneMessages(msgs, { days: 7, maxKeep: 200, now });
    expect(kept.length).toBeLessThanOrEqual(200);
  });
});

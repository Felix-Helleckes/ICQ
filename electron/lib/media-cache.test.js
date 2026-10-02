const { createMediaCache } = require('./media-cache');

test('remembers downloads', () => {
  const c = createMediaCache();
  c.set('a', 'data:x');
  expect(c.get('a')).toBe('data:x');
  expect(c.get('missing')).toBeNull();
});

test('stays within its size limit, dropping the least recently used first', () => {
  const c = createMediaCache({ maxBytes: 10 });
  c.set('a', '1234');
  c.set('b', '1234');
  c.get('a');            // a is now more recent than b
  c.set('c', '1234');    // 12 bytes > 10 → b goes
  expect(c.get('b')).toBeNull();
  expect(c.get('a')).toBe('1234');
  expect(c.get('c')).toBe('1234');
  expect(c.bytes).toBeLessThanOrEqual(10);
});

test('an item larger than the whole cache is not stored (and evicts nothing)', () => {
  const c = createMediaCache({ maxBytes: 10 });
  c.set('a', '12345');
  c.set('huge', 'x'.repeat(50));
  expect(c.get('huge')).toBeNull();
  expect(c.get('a')).toBe('12345');
});

test('failures are remembered for a while, then retried', () => {
  let t = 0;
  const c = createMediaCache({ failTtlMs: 1000, now: () => t });
  c.markFailed('a');
  expect(c.recentlyFailed('a')).toBe(true);
  t = 1500;
  expect(c.recentlyFailed('a')).toBe(false);
  c.markFailed('b');
  c.set('b', 'ok');      // a later success clears the failure
  expect(c.recentlyFailed('b')).toBe(false);
});

test('replacing an entry keeps the byte count right', () => {
  const c = createMediaCache({ maxBytes: 100 });
  c.set('a', '1234');
  c.set('a', '12');
  expect(c.bytes).toBe(2);
  c.clear();
  expect(c.size).toBe(0);
  expect(c.bytes).toBe(0);
});

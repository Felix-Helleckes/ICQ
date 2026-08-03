const { normalizeStatus, ackFromStatus, statusFromReceipt, createAckTracker } = require('./ack');

describe('normalizeStatus', () => {
  test('passes proto numbers through', () => {
    expect(normalizeStatus(3)).toBe(3);
    expect(normalizeStatus(0)).toBe(0);
  });
  test('accepts the enum name', () => {
    expect(normalizeStatus('DELIVERY_ACK')).toBe(3);
    expect(normalizeStatus('read')).toBe(4);
  });
  test('accepts a numeric string', () => {
    expect(normalizeStatus('4')).toBe(4);
  });
  test('unknown or missing → null', () => {
    expect(normalizeStatus(null)).toBeNull();
    expect(normalizeStatus(undefined)).toBeNull();
    expect(normalizeStatus('NOT_A_STATUS')).toBeNull();
    expect(normalizeStatus('')).toBeNull();
  });
});

describe('ackFromStatus', () => {
  test('maps the full scale', () => {
    expect(ackFromStatus(0, true)).toBe(-1); // error
    expect(ackFromStatus(1, true)).toBe(0);  // pending → clock
    expect(ackFromStatus(2, true)).toBe(1);  // sent
    expect(ackFromStatus(3, true)).toBe(2);  // delivered
    expect(ackFromStatus(4, true)).toBe(3);  // read
    expect(ackFromStatus(5, true)).toBe(3);  // played counts as read
  });
  test('works from the enum name too', () => {
    expect(ackFromStatus('DELIVERY_ACK', true)).toBe(2);
  });
  test('no status: outgoing assumed sent, incoming needs no ack', () => {
    expect(ackFromStatus(null, true)).toBe(1);
    expect(ackFromStatus(null, false)).toBe(-1);
  });
});

describe('statusFromReceipt', () => {
  test('played beats read beats delivered', () => {
    expect(statusFromReceipt({ receiptTimestamp: 1, readTimestamp: 2, playedTimestamp: 3 })).toBe(5);
    expect(statusFromReceipt({ receiptTimestamp: 1, readTimestamp: 2 })).toBe(4);
    expect(statusFromReceipt({ receiptTimestamp: 1 })).toBe(3);
  });
  test('empty receipt → null', () => {
    expect(statusFromReceipt({})).toBeNull();
    expect(statusFromReceipt(null)).toBeNull();
  });
});

describe('createAckTracker — acks only move forward', () => {
  test('records a forward move and reports it', () => {
    const t = createAckTracker();
    expect(t.record('m1', 1)).toBe(1);
    expect(t.record('m1', 2)).toBe(2);
    expect(t.get('m1')).toBe(2);
  });

  test('a late lower ack is rejected — this is the "clock came back" bug', () => {
    const t = createAckTracker();
    t.record('m1', 2);           // delivered
    expect(t.record('m1', 0)).toBeNull(); // a stale "pending" must not win
    expect(t.get('m1')).toBe(2);
  });

  test('resolve() keeps a confirmed message confirmed when the store still says pending', () => {
    const t = createAckTracker();
    t.record('m1', 2);
    expect(t.resolve('m1', 0)).toBe(2);  // store says pending → tracker wins
    expect(t.resolve('m1', 3)).toBe(3);  // fresher value wins
    expect(t.resolve('unknown', 0)).toBe(0);
  });

  test('ignores an empty id', () => {
    const t = createAckTracker();
    expect(t.record('', 2)).toBeNull();
    expect(t.record(undefined, 2)).toBeNull();
  });

  test('stays bounded', () => {
    const t = createAckTracker(3);
    t.record('a', 1); t.record('b', 1); t.record('c', 1); t.record('d', 1);
    expect(t.size).toBeLessThanOrEqual(3);
    expect(t.get('d')).toBe(1); // newest retained
  });

  test('clear() empties it', () => {
    const t = createAckTracker();
    t.record('a', 2);
    t.clear();
    expect(t.get('a')).toBeNull();
  });
});

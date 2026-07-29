const { waitForChats } = require('./wa-chats');

// Deterministic clock: `sleep` advances virtual time so the deadline logic is
// exercised without any real waiting.
function fakeTimers() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms) => { t += ms; },
  };
}

test('returns the first non-empty result and stops polling', async () => {
  const { now, sleep } = fakeTimers();
  let calls = 0;
  const fetchChats = jest.fn(async () => (++calls < 3 ? [] : [{ id: 'a' }]));
  const chats = await waitForChats(fetchChats, () => true, { deadlineMs: 10000, intervalMs: 100, now, sleep });
  expect(chats).toEqual([{ id: 'a' }]);
  expect(fetchChats).toHaveBeenCalledTimes(3);
});

test('returns immediately (single fetch) when the store is already populated', async () => {
  const { now, sleep } = fakeTimers();
  const fetchChats = jest.fn(async () => [{ id: 'x' }, { id: 'y' }]);
  const chats = await waitForChats(fetchChats, () => true, { deadlineMs: 10000, intervalMs: 500, now, sleep });
  expect(chats).toHaveLength(2);
  expect(fetchChats).toHaveBeenCalledTimes(1);
});

test('stops polling as soon as the client is no longer ready', async () => {
  const { now, sleep } = fakeTimers();
  const fetchChats = jest.fn(async () => []);
  const chats = await waitForChats(fetchChats, () => false, { deadlineMs: 10000, intervalMs: 100, now, sleep });
  expect(chats).toEqual([]);
  expect(fetchChats).toHaveBeenCalledTimes(1);
});

test('gives up at the deadline and returns the last (empty) result', async () => {
  const { now, sleep } = fakeTimers();
  const fetchChats = jest.fn(async () => []);
  const chats = await waitForChats(fetchChats, () => true, { deadlineMs: 1000, intervalMs: 400, now, sleep });
  expect(chats).toEqual([]);
  // fetches at t=0,400,800,1200 → the 1200 check trips the deadline
  expect(fetchChats).toHaveBeenCalledTimes(4);
});

test('swallows fetch errors and keeps polling', async () => {
  const { now, sleep } = fakeTimers();
  let calls = 0;
  const fetchChats = jest.fn(async () => {
    calls += 1;
    if (calls === 1) throw new Error('Evaluation failed: context destroyed');
    return [{ id: 'later' }];
  });
  const chats = await waitForChats(fetchChats, () => true, { deadlineMs: 10000, intervalMs: 100, now, sleep });
  expect(chats).toEqual([{ id: 'later' }]);
  expect(fetchChats).toHaveBeenCalledTimes(2);
});

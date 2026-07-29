const { createConcurrencyLimiter } = require('./concurrency');

test('never runs more than `max` tasks at once', async () => {
  const run = createConcurrencyLimiter(4);
  let active = 0;
  let peak = 0;
  const task = () => async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active -= 1;
    return 'ok';
  };
  const results = await Promise.all(Array.from({ length: 20 }, () => run(task())));
  expect(results).toHaveLength(20);
  expect(results.every((r) => r === 'ok')).toBe(true);
  expect(peak).toBeLessThanOrEqual(4);
  expect(peak).toBeGreaterThan(1); // proves tasks actually overlapped
});

test('a rejected task resolves to null and does not stall the queue', async () => {
  const run = createConcurrencyLimiter(2);
  const results = await Promise.all([
    run(async () => { throw new Error('boom'); }),
    run(async () => 'second'),
  ]);
  expect(results[0]).toBeNull();
  expect(results[1]).toBe('second');
});

test('drains the whole queue in submit order when limit is 1', async () => {
  const run = createConcurrencyLimiter(1);
  const order = [];
  await Promise.all([1, 2, 3].map((n) => run(async () => { order.push(n); })));
  expect(order).toEqual([1, 2, 3]);
});

test('coerces bad limits to at least 1', async () => {
  const run = createConcurrencyLimiter(0);
  await expect(run(async () => 42)).resolves.toBe(42);
});

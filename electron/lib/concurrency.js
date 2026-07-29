/**
 * Bounded-concurrency task runner.
 *
 * WhatsApp profile-picture fetches all run inside a single headless page, so
 * firing one per visible contact (100+) at once stalls chat/message sync. This
 * caps how many tasks run simultaneously; the rest queue and start as slots free.
 *
 * Task rejections resolve to `null` instead of rejecting the returned promise —
 * callers treat "no avatar" as a non-error and one bad fetch must not stall the
 * queue.
 */
function createConcurrencyLimiter(max) {
  const limit = Math.max(1, Math.floor(Number(max)) || 1);
  let active = 0;
  const queue = [];

  const pump = () => {
    if (active >= limit) return;
    const job = queue.shift();
    if (!job) return;
    active += 1;
    Promise.resolve()
      .then(job.task)
      .then(
        (value) => job.resolve(value),
        () => job.resolve(null),
      )
      .finally(() => {
        active -= 1;
        pump();
      });
  };

  return function run(task) {
    return new Promise((resolve) => {
      queue.push({ task, resolve });
      pump();
    });
  };
}

module.exports = { createConcurrencyLimiter };

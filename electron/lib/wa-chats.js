/**
 * Poll `fetchChats` until it returns a non-empty list, the client stops being
 * ready, or the deadline passes — then return whatever the last fetch produced.
 *
 * Why: a fresh WhatsApp login keeps syncing chats from the phone *after* the
 * 'ready' event fires, so the first getChats() is often empty. Returning that
 * empty list makes the UI cache a permanent "No chats found". Waiting (bounded)
 * for the store to populate fixes that while keeping restored sessions instant
 * (they return non-empty on the first fetch and never sleep).
 *
 * `now` and `sleep` are injectable so this is unit-testable without real timers.
 */
async function waitForChats(fetchChats, isReady, opts = {}) {
  const deadlineMs = opts.deadlineMs ?? 15000;
  const intervalMs = opts.intervalMs ?? 500;
  const now = opts.now || Date.now;
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));

  const deadline = now() + deadlineMs;
  let chats = [];
  for (;;) {
    try {
      chats = await fetchChats();
    } catch (e) {
      chats = [];
    }
    const hasChats = Array.isArray(chats) && chats.length > 0;
    if (hasChats || !isReady() || now() >= deadline) break;
    await sleep(intervalMs);
  }
  return Array.isArray(chats) ? chats : [];
}

module.exports = { waitForChats };

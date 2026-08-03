/**
 * Delivery-state (ack) handling for WhatsApp messages.
 *
 * The UI renders a small scale: -1 error, 0 pending (clock), 1 sent, 2 delivered,
 * 3 read. WhatsApp reports this as proto.WebMessageInfo.Status, which reaches us on
 * two different event paths (`messages.update` carries a status, per-recipient
 * receipts carry timestamps) and sometimes as the enum NAME rather than its number.
 *
 * On top of that the renderer re-reads messages from the store every few seconds, so
 * a confirmed message must never fall back to "pending" just because one path lagged.
 * The tracker therefore keeps a per-message high-water mark: acks only move forward.
 */

// proto.WebMessageInfo.Status → UI scale.
// ERROR=0, PENDING=1, SERVER_ACK=2, DELIVERY_ACK=3, READ=4, PLAYED=5
const STATUS_TO_ACK = { 0: -1, 1: 0, 2: 1, 3: 2, 4: 3, 5: 3 };
const STATUS_BY_NAME = { ERROR: 0, PENDING: 1, SERVER_ACK: 2, DELIVERY_ACK: 3, READ: 4, PLAYED: 5 };

/** Accepts the proto number, a numeric string, or the enum name. */
function normalizeStatus(s) {
  if (s == null) return null;
  if (typeof s === 'number') return Number.isFinite(s) ? s : null;
  const n = Number(s);
  if (String(s).trim() !== '' && !Number.isNaN(n)) return n;
  const byName = STATUS_BY_NAME[String(s).toUpperCase()];
  return byName == null ? null : byName;
}

/**
 * Map a status to the UI ack. With no usable status we assume an outgoing message
 * at least reached the server (1) and an incoming one needs no ack (-1).
 */
function ackFromStatus(status, fromMe) {
  const s = normalizeStatus(status);
  if (s == null) return fromMe ? 1 : -1;
  const mapped = STATUS_TO_ACK[s];
  return mapped == null ? (fromMe ? 1 : -1) : mapped;
}

/** Per-recipient receipt timestamps → status. */
function statusFromReceipt(receipt) {
  const r = receipt || {};
  if (r.playedTimestamp) return 5;
  if (r.readTimestamp) return 4;
  if (r.receiptTimestamp) return 3;
  return null;
}

/**
 * Remembers the highest ack seen per message id, bounded so a long session cannot
 * grow it without limit.
 */
function createAckTracker(maxEntries = 5000) {
  const seen = new Map();

  return {
    /** Returns the new ack when it moved forward, otherwise null. */
    record(id, ack) {
      if (!id) return null;
      const prev = seen.get(id);
      if (prev != null && ack <= prev) return null;
      if (seen.size >= maxEntries) seen.delete(seen.keys().next().value);
      seen.set(id, ack);
      return ack;
    },
    /** The stored ack, or the computed one when it is further along. */
    resolve(id, computed) {
      const prev = seen.get(id);
      return prev != null && prev > computed ? prev : computed;
    },
    get(id) {
      const v = seen.get(id);
      return v == null ? null : v;
    },
    clear() { seen.clear(); },
    get size() { return seen.size; },
  };
}

module.exports = { normalizeStatus, ackFromStatus, statusFromReceipt, createAckTracker };

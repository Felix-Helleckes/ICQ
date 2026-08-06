/**
 * Automated tests for the WhatsApp bridge core flows.
 *
 * These drive the REAL bridge against a fake Baileys socket: connecting, the history
 * sync, restoring after a restart, loading chats and messages, incoming messages,
 * delivery receipts and sending.
 *
 * NOTHING IS EVER SENT. There is no network and no account involved — the fake
 * records what the bridge *would* have transmitted so we can assert on it.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createFakeBaileys, makeChat, makeContact, makeMessage } = require('./lib/fake-baileys');

// Capture everything the bridge broadcasts to the renderer.
global.__waBroadcasts = [];
jest.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [{
      isDestroyed: () => false,
      webContents: { send: (channel, data) => global.__waBroadcasts.push({ channel, data }) },
    }],
  },
}));

const ALICE = '491700000001@s.whatsapp.net';
const BOB_LID = '55500000002@lid';
const BOB_PN = '491700000002@s.whatsapp.net';
const GROUP = '120363000000000001@g.us';

let dataDir;

function freshDataDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-bridge-test-'));
  fs.mkdirSync(path.join(d, 'whatsapp'), { recursive: true });
  return d;
}

let live = []; // bridges booted by the current test, shut down in afterEach

/** A fresh module instance per test — the bridge keeps module-level state. */
function loadBridge() {
  let mod;
  jest.isolateModules(() => { mod = require('./whatsapp-bridge'); });
  live.push(mod);
  return mod;
}

function broadcastsOn(channel) {
  return global.__waBroadcasts.filter(b => b.channel === channel).map(b => b.data);
}

/** Boot the bridge with the fake socket and open the connection. */
async function connect(bridge, fake, { history } = {}) {
  bridge.__setBaileysForTests(fake.namespace);
  await bridge.init(null, dataDir);
  await fake.socket.ev.emit('connection.update', { connection: 'open' });
  if (history) await fake.socket.ev.emit('messaging-history.set', history);
  return fake.socket;
}

beforeEach(() => {
  global.__waBroadcasts = [];
  live = [];
  dataDir = freshDataDir();
});

afterEach(async () => {
  // Shut every bridge down first: it clears the pending save/ready timers, which
  // would otherwise fire after the test and write into an already-deleted dir.
  for (const b of live) { try { await b.shutdown(); } catch (e) {} }
  live = [];
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) {}
});

// ── Contact list ──────────────────────────────────────────────────────────

test('fresh link: the chat list is populated from the history sync', async () => {
  const bridge = loadBridge();
  const fake = createFakeBaileys();
  await connect(bridge, fake, {
    history: {
      chats: [makeChat(ALICE), makeChat(GROUP)],
      contacts: [makeContact(ALICE, 'Alice Example')],
      messages: [makeMessage(ALICE, 'M1', 'hello there')],
      isLatest: true,
    },
  });

  expect(bridge.getStatus()).toBe('ready');
  const chats = await bridge.getChats();
  expect(chats).toHaveLength(2);

  const alice = chats.find(c => c.id === ALICE);
  expect(alice.name).toBe('Alice Example');
  expect(alice.lastMessage).toBe('hello there');
  expect(chats.find(c => c.id === GROUP).isGroup).toBe(true);
});

test('ready is withheld until the history arrives, so the UI never caches an empty list', async () => {
  const bridge = loadBridge();
  const fake = createFakeBaileys();
  bridge.__setBaileysForTests(fake.namespace);
  await bridge.init(null, dataDir);
  await fake.socket.ev.emit('connection.update', { connection: 'open' });

  // Connection is up, but no history yet: must NOT be ready.
  expect(bridge.getStatus()).not.toBe('ready');
  expect(await bridge.getChats()).toEqual([]);

  await fake.socket.ev.emit('messaging-history.set', {
    chats: [makeChat(ALICE)], contacts: [], messages: [], isLatest: true,
  });
  expect(bridge.getStatus()).toBe('ready');
});

test('RESTART: the chat list survives, even though WhatsApp sends no history', async () => {
  // This is the regression guard for the "Lädt Chats… / No chats found" bug: after
  // the initial pairing WhatsApp never resends the history, so a memory-only store
  // came up empty on every later start.
  const first = loadBridge();
  const fake1 = createFakeBaileys();
  await connect(first, fake1, {
    history: {
      chats: [makeChat(ALICE), makeChat(GROUP)],
      contacts: [makeContact(ALICE, 'Alice Example')],
      messages: [makeMessage(ALICE, 'M1', 'see you tomorrow')],
      isLatest: true,
    },
  });
  await first.shutdown(); // flushes the store to disk

  expect(fs.existsSync(path.join(dataDir, 'whatsapp', 'store.json'))).toBe(true);

  // Second run: same data dir, connection opens, NO history sync at all.
  global.__waBroadcasts = [];
  const second = loadBridge();
  const fake2 = createFakeBaileys();
  second.__setBaileysForTests(fake2.namespace);
  await second.init(null, dataDir);
  await fake2.socket.ev.emit('connection.update', { connection: 'open' });

  expect(second.getStatus()).toBe('ready'); // ready immediately, no 12s stall
  const chats = await second.getChats();
  expect(chats.map(c => c.id).sort()).toEqual([GROUP, ALICE].sort());
  expect(chats.find(c => c.id === ALICE).name).toBe('Alice Example'); // names survive too
  expect(chats.find(c => c.id === ALICE).lastMessage).toBe('see you tomorrow');
});

test('contacts found under the LID name a chat keyed by the phone JID', async () => {
  const bridge = loadBridge();
  const fake = createFakeBaileys();
  await connect(bridge, fake, {
    history: {
      chats: [makeChat(BOB_PN)],
      contacts: [makeContact(BOB_LID, 'Bob Builder', { lid: BOB_LID, phoneNumber: BOB_PN })],
      messages: [],
      isLatest: true,
    },
  });
  const chat = (await bridge.getChats()).find(c => c.id === BOB_PN);
  expect(chat.name).toBe('Bob Builder');
});

test('a chat with no contact record shows a readable number, never a raw JID', async () => {
  const bridge = loadBridge();
  const fake = createFakeBaileys();
  await connect(bridge, fake, {
    history: { chats: [makeChat(ALICE)], contacts: [], messages: [], isLatest: true },
  });
  const chat = (await bridge.getChats())[0];
  expect(chat.name).toBe('+491700000001');
  expect(chat.name).not.toContain('@');
});

// ── Messages ──────────────────────────────────────────────────────────────

test('opening a chat returns its messages, oldest first', async () => {
  const bridge = loadBridge();
  const fake = createFakeBaileys();
  await connect(bridge, fake, {
    history: {
      chats: [makeChat(ALICE)],
      contacts: [],
      messages: [
        makeMessage(ALICE, 'M2', 'second', { ts: 1700000200 }),
        makeMessage(ALICE, 'M1', 'first', { ts: 1700000100 }),
      ],
      isLatest: true,
    },
  });
  const msgs = await bridge.getMessages(ALICE, { skipMedia: true });
  expect(msgs.map(m => m.body)).toEqual(['first', 'second']);
  expect(msgs[0].id).toBe('M1');
});

test('an incoming message reaches the renderer and lands in the chat', async () => {
  const bridge = loadBridge();
  const fake = createFakeBaileys();
  const sock = await connect(bridge, fake, {
    history: { chats: [makeChat(ALICE)], contacts: [], messages: [], isLatest: true },
  });

  const now = Math.floor(Date.now() / 1000);
  await sock.ev.emit('messages.upsert', {
    type: 'notify',
    messages: [makeMessage(ALICE, 'NEW1', 'are you there?', { ts: now })],
  });

  const msg = broadcastsOn('wa:message').find(m => m.id === 'NEW1');
  expect(msg).toBeTruthy();
  expect(msg.body).toBe('are you there?');
  expect(msg.isBacklog).toBe(false); // live message → notifies normally

  const msgs = await bridge.getMessages(ALICE, { skipMedia: true });
  expect(msgs.some(m => m.id === 'NEW1')).toBe(true);
});

test('messages replayed after startup are flagged as backlog (no sound, no unread bump)', async () => {
  const bridge = loadBridge();
  const fake = createFakeBaileys();
  const sock = await connect(bridge, fake, {
    history: { chats: [makeChat(ALICE)], contacts: [], messages: [], isLatest: true },
  });

  const longAgo = Math.floor(Date.now() / 1000) - 3600;
  await sock.ev.emit('messages.upsert', {
    type: 'notify',
    messages: [makeMessage(ALICE, 'OLD1', 'sent while you were away', { ts: longAgo })],
  });

  expect(broadcastsOn('wa:message').find(m => m.id === 'OLD1').isBacklog).toBe(true);
});

// ── Delivery state ────────────────────────────────────────────────────────

test('delivery receipts move the tick forward and never backwards', async () => {
  const bridge = loadBridge();
  const fake = createFakeBaileys();
  const sock = await connect(bridge, fake, {
    history: {
      chats: [makeChat(ALICE)], contacts: [],
      messages: [makeMessage(ALICE, 'S1', 'hi', { fromMe: true, status: 1 })],
      isLatest: true,
    },
  });

  await sock.ev.emit('messages.update', [{ key: { remoteJid: ALICE, id: 'S1', fromMe: true }, update: { status: 3 } }]);
  expect(broadcastsOn('wa:ack').pop()).toEqual({ id: 'S1', ack: 2 }); // delivered

  // A stale "pending" must not undo it — this is the clock-came-back bug.
  await sock.ev.emit('messages.update', [{ key: { remoteJid: ALICE, id: 'S1', fromMe: true }, update: { status: 1 } }]);
  expect(broadcastsOn('wa:ack').pop()).toEqual({ id: 'S1', ack: 2 });

  // Read receipts arrive on the other event path.
  await sock.ev.emit('message-receipt.update', [
    { key: { remoteJid: ALICE, id: 'S1', fromMe: true }, receipt: { readTimestamp: 1700000500 } },
  ]);
  expect(broadcastsOn('wa:ack').pop()).toEqual({ id: 'S1', ack: 3 }); // read

  const msgs = await bridge.getMessages(ALICE, { skipMedia: true });
  expect(msgs.find(m => m.id === 'S1').ack).toBe(3); // survives a re-read of the store
});

// ── Sending (recorded, never transmitted) ─────────────────────────────────

test('sending hands the right payload to WhatsApp — and nothing goes out for real', async () => {
  const bridge = loadBridge();
  const fake = createFakeBaileys();
  await connect(bridge, fake, {
    history: { chats: [makeChat(ALICE)], contacts: [], messages: [], isLatest: true },
  });

  await bridge.sendMessage(ALICE, 'hello world');
  expect(fake.sent).toHaveLength(1);
  expect(fake.sent[0].jid).toBe(ALICE);
  expect(fake.sent[0].content).toEqual({ text: 'hello world' });
});

test('a send is never retried, and a failure does not tear down the connection', async () => {
  const bridge = loadBridge();
  const fake = createFakeBaileys();
  const sock = await connect(bridge, fake, {
    history: { chats: [makeChat(ALICE)], contacts: [], messages: [], isLatest: true },
  });

  let attempts = 0;
  sock.sendMessage = async () => { attempts += 1; throw new Error('Connection Closed'); };

  await expect(bridge.sendMessage(ALICE, 'boom')).rejects.toThrow();
  expect(attempts).toBe(1);              // exactly once — a retry could double-send
  expect(bridge.getStatus()).toBe('ready'); // no reconnect cascade
});

test('marking a chat read acknowledges only incoming messages', async () => {
  const bridge = loadBridge();
  const fake = createFakeBaileys();
  await connect(bridge, fake, {
    history: {
      chats: [makeChat(ALICE)], contacts: [],
      messages: [
        makeMessage(ALICE, 'IN1', 'from them'),
        makeMessage(ALICE, 'OUT1', 'from me', { fromMe: true }),
      ],
      isLatest: true,
    },
  });

  await bridge.markChatRead(ALICE);
  const keys = fake.calls.readMessages.flat();
  expect(keys.map(k => k.id)).toEqual(['IN1']);
});

// ── Connection handling ───────────────────────────────────────────────────

test('an unexpected disconnect goes to loading, not to an error state', async () => {
  const bridge = loadBridge();
  const fake = createFakeBaileys();
  const sock = await connect(bridge, fake, {
    history: { chats: [makeChat(ALICE)], contacts: [], messages: [], isLatest: true },
  });

  await sock.ev.emit('connection.update', {
    connection: 'close',
    lastDisconnect: { error: { output: { statusCode: 428 } } },
  });
  expect(bridge.getStatus()).toBe('loading');
  await bridge.shutdown();
});

test('a QR code is published while waiting for the scan', async () => {
  const bridge = loadBridge();
  const fake = createFakeBaileys();
  bridge.__setBaileysForTests(fake.namespace);
  await bridge.init(null, dataDir);

  await fake.socket.ev.emit('connection.update', { qr: 'QR-PAYLOAD' });
  expect(bridge.getStatus()).toBe('qr');
  expect(await bridge.getQR()).toBe('QR-PAYLOAD');
  expect(broadcastsOn('wa:qr')).toContain('QR-PAYLOAD');
});

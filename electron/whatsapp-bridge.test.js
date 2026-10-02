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

const { createFakeBaileys, makeChat, makeContact, makeMessage, makeStub } = require('./lib/fake-baileys');

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
  const fake = createFakeBaileys({ registered: false });
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

test('fresh pairing: ready is withheld until the history arrives, so the UI never caches an empty list', async () => {
  const bridge = loadBridge();
  // registered:false → this is the first pairing, where a history sync really is
  // on its way. (An already-linked device takes the app-state recovery path instead.)
  const fake = createFakeBaileys({ registered: false });
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

test('already linked with an empty store: the chat list is recovered from the app state', async () => {
  // WhatsApp replays neither the history nor the app state on a normal reconnect, so
  // a device linked before this bridge existed would otherwise show nothing at all.
  const bridge = loadBridge();
  const fake = createFakeBaileys({
    appState: {
      contacts: [makeContact(ALICE, 'Alice Example')],
      chats: [{ id: ALICE, conversationTimestamp: 1700000300 }, { id: GROUP, conversationTimestamp: 1700000200 }],
    },
  });
  bridge.__setBaileysForTests(fake.namespace);
  await bridge.init(null, dataDir);
  await fake.socket.ev.emit('connection.update', { connection: 'open' });
  await new Promise(r => setImmediate(r)); // recovery runs detached from the handler

  expect(fake.calls.resyncAppState).toHaveLength(1);
  expect(fake.calls.resyncAppState[0].isInitialSync).toBe(true);

  const chats = await bridge.getChats();
  expect(chats.map(c => c.id).sort()).toEqual([GROUP, ALICE].sort());
  expect(chats.find(c => c.id === ALICE).name).toBe('Alice Example');
  expect(bridge.getStatus()).toBe('ready');
});

test('recovery is skipped when the store already holds chats', async () => {
  const bridge = loadBridge();
  const fake = createFakeBaileys();
  await connect(bridge, fake, {
    history: { chats: [makeChat(ALICE)], contacts: [], messages: [], isLatest: true },
  });
  await bridge.shutdown();

  const second = loadBridge();
  const fake2 = createFakeBaileys();
  second.__setBaileysForTests(fake2.namespace);
  await second.init(null, dataDir);
  await fake2.socket.ev.emit('connection.update', { connection: 'open' });
  await new Promise(r => setImmediate(r));

  expect(fake2.calls.resyncAppState).toHaveLength(0); // nothing to recover
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

// ── One entry per person, names from every source ─────────────────────────
// Regression guards for "the list shows only numbers" and "people appear twice
// once I write with them" (WhatsApp addressing a person by LID and by number).

const SELF_LID = '99900000009@lid';
const now = () => Math.floor(Date.now() / 1000);

test('a reply arriving under the LID joins the phone-number chat — no duplicate entry', async () => {
  const bridge = loadBridge();
  const fake = createFakeBaileys();
  const sock = await connect(bridge, fake, {
    history: {
      chats: [makeChat(BOB_PN)],
      contacts: [makeContact(BOB_PN, 'Bob Builder')],
      messages: [makeMessage(BOB_PN, 'OUT1', 'hi bob', { fromMe: true })],
      isLatest: true,
    },
  });

  // Baileys v7 delivers the reply under the LID and names the number as the alt id.
  await sock.ev.emit('messages.upsert', {
    type: 'notify',
    messages: [makeMessage(BOB_LID, 'IN1', 'hi back', { ts: now(), alt: BOB_PN })],
  });

  const chats = await bridge.getChats();
  expect(chats.map(c => c.id)).toEqual([BOB_PN]);
  expect(chats[0].name).toBe('Bob Builder');
  expect(chats[0].lastMessage).toBe('hi back');

  const msg = broadcastsOn('wa:message').find(m => m.id === 'IN1');
  expect(msg.from).toBe(BOB_PN); // the list patches the row it already has
  expect(msg.chatAliases).toEqual(expect.arrayContaining([BOB_PN, BOB_LID]));

  // A chat window opened under either id sees the whole conversation.
  for (const id of [BOB_PN, BOB_LID]) {
    const msgs = await bridge.getMessages(id, { skipMedia: true });
    expect(msgs.map(m => m.id)).toEqual(['OUT1', 'IN1']);
  }
});

test('a LID twin learned later is folded into the existing chat', async () => {
  const bridge = loadBridge();
  const fake = createFakeBaileys();
  const sock = await connect(bridge, fake, {
    history: {
      chats: [makeChat(BOB_PN), makeChat(BOB_LID, { conversationTimestamp: 1700000500 })],
      contacts: [makeContact(BOB_PN, 'Bob Builder')],
      messages: [makeMessage(BOB_LID, 'L1', 'from the lid side', { ts: 1700000500 })],
      isLatest: true,
    },
  });
  expect((await bridge.getChats()).length).toBe(2); // mapping not known yet

  await sock.ev.emit('lid-mapping.update', { lid: BOB_LID, pn: BOB_PN });

  const chats = await bridge.getChats();
  expect(chats.map(c => c.id)).toEqual([BOB_PN]);
  expect(chats[0].name).toBe('Bob Builder');
  expect(chats[0].lastMessage).toBe('from the lid side');
});

test('history phantoms (a lone encryption notice) never reach the contact list', async () => {
  const bridge = loadBridge();
  const fake = createFakeBaileys();
  const PHANTOM = '55500000077@lid';
  await connect(bridge, fake, {
    history: {
      chats: [makeChat(ALICE), { id: PHANTOM, accountLid: PHANTOM, participant: [] }],
      contacts: [],
      messages: [makeMessage(ALICE, 'M1', 'real'), makeStub(PHANTOM, 'E2E1')],
      isLatest: true,
    },
  });
  expect((await bridge.getChats()).map(c => c.id)).toEqual([ALICE]);
});

test("the sender's pushname names a contact that is not in the address book", async () => {
  const bridge = loadBridge();
  const fake = createFakeBaileys();
  const sock = await connect(bridge, fake, {
    history: { chats: [makeChat(ALICE)], contacts: [], messages: [], isLatest: true },
  });
  expect((await bridge.getChats())[0].name).toBe('+491700000001');

  await sock.ev.emit('messages.upsert', {
    type: 'notify',
    messages: [makeMessage(ALICE, 'P1', 'hey', { ts: now(), pushName: 'Alice from Ads' })],
  });
  expect((await bridge.getChats())[0].name).toBe('Alice from Ads');
});

test("our own pushname on outgoing messages is not taken as the contact's name", async () => {
  const bridge = loadBridge();
  const fake = createFakeBaileys();
  const sock = await connect(bridge, fake, {
    history: { chats: [makeChat(ALICE)], contacts: [], messages: [], isLatest: true },
  });
  await sock.ev.emit('messages.upsert', {
    type: 'notify',
    messages: [makeMessage(ALICE, 'O1', 'yo', { ts: now(), fromMe: true, pushName: 'Me Myself' })],
  });
  expect((await bridge.getChats())[0].name).toBe('+491700000001');
});

test('reactions and protocol traffic are not forwarded as empty messages', async () => {
  const bridge = loadBridge();
  const fake = createFakeBaileys();
  const sock = await connect(bridge, fake, {
    history: { chats: [makeChat(ALICE)], contacts: [], messages: [], isLatest: true },
  });
  await sock.ev.emit('messages.upsert', {
    type: 'notify',
    messages: [
      { key: { remoteJid: ALICE, id: 'R1', fromMe: false }, messageTimestamp: now(), message: { reactionMessage: { text: 'x' } } },
      { key: { remoteJid: ALICE, id: 'P1', fromMe: true }, messageTimestamp: now(), message: { protocolMessage: { type: 0 } } },
    ],
  });
  expect(broadcastsOn('wa:message')).toHaveLength(0);
  expect(await bridge.getMessages(ALICE, { skipMedia: true })).toHaveLength(0);
});

test('RESTART with an old store: duplicates are merged and phantoms dropped on load', async () => {
  const PHANTOM = '55500000077@lid';
  // A version-1 store.json as earlier builds wrote it.
  fs.writeFileSync(path.join(dataDir, 'whatsapp', 'store.json'), JSON.stringify({
    version: 1,
    chats: [
      { id: BOB_PN, conversationTimestamp: 1700000100, archived: false },
      { id: BOB_LID, conversationTimestamp: 1700000200 },
      { id: SELF_LID, conversationTimestamp: 1700000300 },
      { id: PHANTOM, accountLid: PHANTOM, participant: [], messages: [{ message: makeStub(PHANTOM, 'E2E1') }] },
    ],
    messages: {
      [BOB_PN]: [makeMessage(BOB_PN, 'A', 'first', { ts: 1700000100 })],
      [BOB_LID]: [makeMessage(BOB_LID, 'B', 'second', { ts: 1700000200 })],
      [SELF_LID]: [{ key: { remoteJid: SELF_LID, id: 'H', fromMe: true }, messageTimestamp: 1700000300, message: { protocolMessage: {} } }],
    },
    contactDirectory: { contacts: [[BOB_PN, 'Bob Builder', null, null]], mappings: [[BOB_LID, BOB_PN]] },
  }));

  const bridge = loadBridge();
  const fake = createFakeBaileys();
  bridge.__setBaileysForTests(fake.namespace);
  await bridge.init(null, dataDir);
  await fake.socket.ev.emit('connection.update', { connection: 'open' });

  expect(bridge.getStatus()).toBe('ready'); // names are there at once, no waiting
  const chats = await bridge.getChats();
  expect(chats.map(c => c.id)).toEqual([BOB_PN]);
  expect(chats[0]).toMatchObject({ name: 'Bob Builder', lastMessage: 'second' });
  const msgs = await bridge.getMessages(BOB_PN, { skipMedia: true });
  expect(msgs.map(m => m.id)).toEqual(['A', 'B']);
});

test("an unmapped LID chat is resolved through Baileys' own LID table on connect", async () => {
  const first = loadBridge();
  const fake1 = createFakeBaileys();
  await connect(first, fake1, {
    history: {
      chats: [makeChat(BOB_LID)],
      contacts: [makeContact(BOB_PN, 'Bob Builder')],
      messages: [makeMessage(BOB_LID, 'L1', 'hello')],
      isLatest: true,
    },
  });
  expect((await first.getChats())[0].name).toBe('55500000002'); // nothing better known
  await first.shutdown();

  const second = loadBridge();
  const fake2 = createFakeBaileys({ lidMap: { [BOB_LID]: BOB_PN } });
  second.__setBaileysForTests(fake2.namespace);
  await second.init(null, dataDir);
  await fake2.socket.ev.emit('connection.update', { connection: 'open' });
  await new Promise(r => setImmediate(r));

  expect(fake2.calls.lidLookups).toEqual([[BOB_LID]]);
  const chats = await second.getChats();
  expect(chats.map(c => c.id)).toEqual([BOB_PN]);
  expect(chats[0].name).toBe('Bob Builder');
});

test('after a QR scan the history is awaited even though the creds already look linked', async () => {
  // Real pairing: QR → scan → WhatsApp restarts the socket (515) → the new socket
  // opens with registered creds, and only then does the history stream in.
  const bridge = loadBridge();
  const fake = createFakeBaileys(); // registered: the post-515 state
  bridge.__setBaileysForTests(fake.namespace);
  await bridge.init(null, dataDir);
  await fake.socket.ev.emit('connection.update', { qr: 'QR' });
  await fake.socket.ev.emit('connection.update', { isNewLogin: true });
  await fake.socket.ev.emit('connection.update', { connection: 'open' });
  await new Promise(r => setImmediate(r));

  expect(bridge.getStatus()).not.toBe('ready');
  expect(fake.calls.resyncAppState).toHaveLength(0); // no competing recovery sync

  await fake.socket.ev.emit('messaging-history.set', {
    chats: [makeChat(ALICE)], contacts: [makeContact(ALICE, 'Alice Example')], messages: [], isLatest: true,
  });
  expect(bridge.getStatus()).toBe('ready');
  expect((await bridge.getChats())[0].name).toBe('Alice Example');
});

test("archiving addresses the chat the way WhatsApp keys it (newest message's id)", async () => {
  const bridge = loadBridge();
  const fake = createFakeBaileys();
  const sock = await connect(bridge, fake, {
    history: {
      chats: [makeChat(BOB_PN)],
      contacts: [makeContact(BOB_PN, 'Bob', { lid: BOB_LID })],
      messages: [makeMessage(BOB_PN, 'A', 'old', { ts: 1700000100 })],
      isLatest: true,
    },
  });
  await sock.ev.emit('messages.upsert', {
    type: 'notify', messages: [makeMessage(BOB_LID, 'B', 'new', { ts: now() })],
  });
  await bridge.setArchive(BOB_PN, true);
  expect(fake.calls.chatModify[0].jid).toBe(BOB_LID);
  expect((await bridge.getChats())[0].archived).toBe(true);
});

test('sending still goes exactly once to the id the window was opened with', async () => {
  const bridge = loadBridge();
  const fake = createFakeBaileys();
  await connect(bridge, fake, {
    history: {
      chats: [makeChat(BOB_PN)], contacts: [makeContact(BOB_PN, 'Bob', { lid: BOB_LID })], messages: [], isLatest: true,
    },
  });
  await bridge.sendMessage(BOB_LID, 'via the old window');
  expect(fake.sent).toHaveLength(1);
  expect(fake.sent[0].jid).toBe(BOB_LID);
});

// ── Every start catches up; unread counts; several computers ──────────────

/** Pair once, persist, then start a second time like a normal app start. */
async function restartWithStore(history, fakeOpts = {}) {
  const first = loadBridge();
  await connect(first, createFakeBaileys(), { history });
  await first.shutdown();
  global.__waBroadcasts = [];
  const bridge = loadBridge();
  const fake = createFakeBaileys(fakeOpts);
  bridge.__setBaileysForTests(fake.namespace);
  await bridge.init(null, dataDir);
  await fake.socket.ev.emit('connection.update', { connection: 'open' });
  return { bridge, fake, sock: fake.socket };
}

test('every start catches up once the offline backlog is through (like WhatsApp Desktop)', async () => {
  const { bridge, fake, sock } = await restartWithStore({
    chats: [makeChat(ALICE)], contacts: [makeContact(ALICE, 'Alice')], messages: [], isLatest: true,
  });
  expect(bridge.getStatus()).toBe('ready');                // the stored list shows at once
  expect(broadcastsOn('wa:sync')).toEqual([{ active: true }]);
  expect(fake.calls.resyncAppState).toHaveLength(0);       // not before the backlog

  await sock.ev.emit('connection.update', { receivedPendingNotifications: true });
  await new Promise(r => setImmediate(r));

  expect(fake.calls.resyncAppState).toEqual([
    { collections: expect.arrayContaining(['critical_unblock_low', 'regular_low']), isInitialSync: false },
  ]);
  expect(broadcastsOn('wa:sync').pop()).toEqual({ active: false });

  await sock.ev.emit('connection.update', { receivedPendingNotifications: true });
  await new Promise(r => setImmediate(r));
  expect(fake.calls.resyncAppState).toHaveLength(1);       // once per connection
});

test('a fresh pairing gets no extra catch-up sync (Baileys runs its own full one)', async () => {
  const bridge = loadBridge();
  const fake = createFakeBaileys();
  bridge.__setBaileysForTests(fake.namespace);
  await bridge.init(null, dataDir);
  await fake.socket.ev.emit('connection.update', { qr: 'QR' });
  await fake.socket.ev.emit('connection.update', { connection: 'open' });
  await fake.socket.ev.emit('messaging-history.set', {
    chats: [makeChat(ALICE)], contacts: [], messages: [makeMessage(ALICE, 'M', 'x')], isLatest: true,
  });
  await fake.socket.ev.emit('connection.update', { receivedPendingNotifications: true });
  await new Promise(r => setImmediate(r));
  expect(fake.calls.resyncAppState).toHaveLength(0);
});

test('unread counts add up — Baileys reports +1 per incoming message, not a total', async () => {
  const bridge = loadBridge();
  const fake = createFakeBaileys();
  const sock = await connect(bridge, fake, {
    history: { chats: [makeChat(ALICE, { unreadCount: 2 })], contacts: [], messages: [makeMessage(ALICE, 'M', 'x')], isLatest: true },
  });
  const unread = async () => (await bridge.getChats())[0].unreadCount;
  expect(await unread()).toBe(2);

  await sock.ev.emit('chats.update', [{ id: ALICE, unreadCount: 1 }]);
  await sock.ev.emit('chats.update', [{ id: ALICE, unreadCount: 1 }]);
  expect(await unread()).toBe(4);

  await sock.ev.emit('chats.update', [{ id: ALICE, unreadCount: null, archived: false }]);
  expect(await unread()).toBe(4);                          // null = no change

  await sock.ev.emit('chats.update', [{ id: ALICE, unreadCount: 0 }]);
  expect(await unread()).toBe(0);                          // read elsewhere

  await sock.ev.emit('chats.update', [{ id: ALICE, unreadCount: -1 }]);
  expect(await unread()).toBe(1);                          // "marked as unread" on the phone
});

test('reading a chat on the phone clears the badge here (1:1 and group)', async () => {
  const bridge = loadBridge();
  const fake = createFakeBaileys();
  const sock = await connect(bridge, fake, {
    history: {
      chats: [makeChat(ALICE, { unreadCount: 3 }), makeChat(GROUP, { unreadCount: 5 })],
      contacts: [],
      messages: [makeMessage(ALICE, 'IN1', 'hi'), makeMessage(GROUP, 'G1', 'hey')],
      isLatest: true,
    },
  });
  // Our phone read Alice's message: a READ status on a message that is not ours.
  await sock.ev.emit('messages.update', [{ key: { remoteJid: ALICE, id: 'IN1', fromMe: false }, update: { status: 4 } }]);
  // In a group it arrives as our own read receipt.
  await sock.ev.emit('message-receipt.update', [{
    key: { remoteJid: GROUP, id: 'G1', fromMe: false },
    receipt: { userJid: fake.meId, readTimestamp: 1700000600 },
  }]);

  const chats = await bridge.getChats();
  expect(chats.find(c => c.id === ALICE).unreadCount).toBe(0);
  expect(chats.find(c => c.id === GROUP).unreadCount).toBe(0);
  expect(broadcastsOn('chat:read-broadcast').map(b => b.chatId).sort()).toEqual([GROUP, ALICE].sort());
  expect(broadcastsOn('wa:ack')).toHaveLength(0);          // not mistaken for a delivery tick
});

test('the same login running on another computer (440) does not start a reconnect ping-pong', async () => {
  const logSpy = jest.spyOn(console, 'log');
  try {
    const bridge = loadBridge();
    const fake = createFakeBaileys();
    const sock = await connect(bridge, fake, {
      history: { chats: [makeChat(ALICE)], contacts: [], messages: [], isLatest: true },
    });
    await sock.ev.emit('connection.update', {
      connection: 'close', lastDisconnect: { error: { output: { statusCode: 440 } } },
    });
    expect(bridge.getStatus()).toBe('conflict');
    expect(logSpy.mock.calls.some(c => String(c[0]).includes('reconnect scheduled'))).toBe(false);
    await expect(bridge.sendMessage(ALICE, 'x')).rejects.toThrow(); // nothing goes out
    expect(fake.sent).toHaveLength(0);
  } finally {
    logSpy.mockRestore();
  }
});

test('"pair this computer separately" drops only the local login — the other computer stays linked', async () => {
  const bridge = loadBridge();
  const fake = createFakeBaileys();
  const sock = await connect(bridge, fake, {
    history: { chats: [makeChat(ALICE)], contacts: [], messages: [], isLatest: true },
  });
  const authDir = path.join(dataDir, 'whatsapp', 'baileys-auth');
  fs.writeFileSync(path.join(authDir, 'creds.json'), '{}');
  await sock.ev.emit('connection.update', {
    connection: 'close', lastDisconnect: { error: { output: { statusCode: 440 } } },
  });

  await bridge.pairAsNewDevice();

  expect(fake.calls.logout).toBe(0);                       // never unlink the shared device
  expect(fs.existsSync(path.join(authDir, 'creds.json'))).toBe(false);
  expect(fake.socketCount).toBe(2);                        // a fresh socket, waiting for a QR
  expect((await bridge.getChats())).toEqual([]);           // not ready until paired
});

test('each computer pairs under a recognisable name ("Retrogram (Windows)" etc.)', async () => {
  const bridge = loadBridge();
  const fake = createFakeBaileys();
  bridge.__setBaileysForTests(fake.namespace);
  await bridge.init(null, dataDir);
  const [name, kind] = fake.lastConfig.browser;
  expect(name).toMatch(/^Retrogram \((Windows|macOS|Linux|\w+)\)$/);
  expect(kind).toBe('Desktop');                            // keeps the desktop device type
});

// ── Voice messages ────────────────────────────────────────────────────────

const VOICE_WEBM_B64 = fs.readFileSync(path.join(__dirname, 'lib', 'fixtures', 'voice-chromium.webm')).toString('base64');

test('a recorded voice note goes out once, as Ogg/Opus with duration and waveform', async () => {
  const bridge = loadBridge();
  const fake = createFakeBaileys();
  await connect(bridge, fake, {
    history: { chats: [makeChat(ALICE)], contacts: [], messages: [], isLatest: true },
  });
  await bridge.sendVoice(ALICE, VOICE_WEBM_B64, 'audio/webm;codecs=opus', Array.from({ length: 64 }, (_, i) => i));

  expect(fake.sent).toHaveLength(1);
  const { jid, content } = fake.sent[0];
  expect(jid).toBe(ALICE);
  expect(content.ptt).toBe(true);
  expect(content.mimetype).toBe('audio/ogg; codecs=opus');
  expect(content.audio.toString('ascii', 0, 4)).toBe('OggS');   // no longer Chromium's WebM
  expect(content.seconds).toBe(2);
  expect(content.waveform).toBeInstanceOf(Uint8Array);
  expect(content.waveform).toHaveLength(64);
  // Our own voice note is playable at once.
  expect(broadcastsOn('wa:media')[0]).toEqual({ msgId: 'SENT1', mediaData: expect.stringMatching(/^data:audio\/ogg;base64,T2dnUw/) });
});

test('a recording that cannot become a voice note is refused — nothing is sent', async () => {
  const bridge = loadBridge();
  const fake = createFakeBaileys();
  await connect(bridge, fake, {
    history: { chats: [makeChat(ALICE)], contacts: [], messages: [], isLatest: true },
  });
  await expect(bridge.sendVoice(ALICE, Buffer.from('garbage').toString('base64'), 'audio/mpeg')).rejects.toThrow();
  expect(fake.sent).toHaveLength(0);
  expect(bridge.getStatus()).toBe('ready');
});

// ── Findings from the QA review ───────────────────────────────────────────

test('two inits at once (double click on "reconnect") open ONE socket', async () => {
  const bridge = loadBridge();
  const fake = createFakeBaileys();
  bridge.__setBaileysForTests(fake.namespace);
  await Promise.all([bridge.init(null, dataDir), bridge.init(null, dataDir)]);
  expect(fake.socketCount).toBe(1);
});

test('a read receipt does not move the message to the receipt time (chat stays in place)', async () => {
  const bridge = loadBridge();
  const fake = createFakeBaileys();
  const sock = await connect(bridge, fake, {
    history: {
      chats: [makeChat(ALICE), makeChat(BOB_PN)],
      contacts: [],
      messages: [
        makeMessage(ALICE, 'OLD', 'from yesterday', { fromMe: true, ts: 1700000000 }),
        makeMessage(BOB_PN, 'NEWER', 'later chat', { ts: 1700005000 }),
      ],
      isLatest: true,
    },
  });
  // Baileys puts the receipt's own time into messageTimestamp.
  await sock.ev.emit('messages.update', [{ key: { remoteJid: ALICE, id: 'OLD', fromMe: true }, update: { status: 4, messageTimestamp: 1700099999 } }]);

  const msgs = await bridge.getMessages(ALICE, { skipMedia: true });
  expect(msgs[0].timestamp).toBe(1700000000);
  expect(msgs[0].ack).toBe(3);
  expect((await bridge.getChats()).map(c => c.id)).toEqual([BOB_PN, ALICE]);
});

test('media is downloaded once, then served from the cache on every refresh', async () => {
  const bridge = loadBridge();
  const fake = createFakeBaileys();
  const img = { key: { remoteJid: ALICE, id: 'IMG', fromMe: false }, messageTimestamp: 1700000000, message: { imageMessage: { mimetype: 'image/jpeg', caption: 'pic' } } };
  await connect(bridge, fake, { history: { chats: [makeChat(ALICE)], contacts: [], messages: [img], isLatest: true } });

  await bridge.getMessages(ALICE);
  await new Promise(r => setImmediate(r));
  const second = await bridge.getMessages(ALICE);
  await bridge.getMessages(ALICE);
  await new Promise(r => setImmediate(r));

  expect(fake.calls.downloads).toBe(1);
  expect(second[0].mediaData).toMatch(/^data:image\/jpeg;base64,/);
});

test('media inside a disappearing-messages chat is recognised as media, not an empty bubble', async () => {
  const bridge = loadBridge();
  const fake = createFakeBaileys();
  const wrapped = {
    key: { remoteJid: ALICE, id: 'EPH', fromMe: false }, messageTimestamp: 1700000000,
    message: { ephemeralMessage: { message: { imageMessage: { mimetype: 'image/jpeg', caption: 'secret' } } } },
  };
  await connect(bridge, fake, { history: { chats: [makeChat(ALICE)], contacts: [], messages: [wrapped], isLatest: true } });
  const [m] = await bridge.getMessages(ALICE, { skipMedia: true });
  expect(m.type).toBe('image');
  expect(m.hasMedia).toBe(true);
});

test('group messages carry the sender\'s name — never a raw JID', async () => {
  const bridge = loadBridge();
  const fake = createFakeBaileys();
  const sock = await connect(bridge, fake, {
    history: { chats: [makeChat(GROUP, { name: 'Family' })], contacts: [makeContact(ALICE, 'Alice Example')], messages: [], isLatest: true },
  });
  const m = makeMessage(GROUP, 'G1', 'hi all', { ts: now() });
  m.key.participant = ALICE;
  const unknown = makeMessage(GROUP, 'G2', 'me too', { ts: now() });
  unknown.key.participant = '491799999999@s.whatsapp.net';
  await sock.ev.emit('messages.upsert', { type: 'notify', messages: [m, unknown] });

  const live = broadcastsOn('wa:message');
  expect(live.find(x => x.id === 'G1').senderName).toBe('Alice Example');
  expect(live.find(x => x.id === 'G2').senderName).toBe('+491799999999');
  const stored = await bridge.getMessages(GROUP, { skipMedia: true });
  expect(stored.map(x => x.senderName)).toEqual(['Alice Example', '+491799999999']);
});

test('the catch-up sync cannot zero a chat that just got new messages from the backlog', async () => {
  const { bridge, sock } = await restartWithStore({
    chats: [makeChat(ALICE)], contacts: [], messages: [makeMessage(ALICE, 'M0', 'old')], isLatest: true,
  });
  // Offline backlog: a new message (+1) …
  await sock.ev.emit('messages.upsert', { type: 'append', messages: [makeMessage(ALICE, 'NEW', 'while you were away', { ts: now() - 600 })] });
  await sock.ev.emit('chats.update', [{ id: ALICE, unreadCount: 1 }]);
  // … then the app-state catch-up replays a read from BEFORE that message.
  await sock.ev.emit('chats.update', [{ id: ALICE, unreadCount: 0 }]);
  expect((await bridge.getChats())[0].unreadCount).toBe(1);

  // The phone really reading the new message (read receipt) still clears it.
  await sock.ev.emit('messages.update', [{ key: { remoteJid: ALICE, id: 'NEW', fromMe: false }, update: { status: 4 } }]);
  expect((await bridge.getChats())[0].unreadCount).toBe(0);
});

test('groups without a title get it from WhatsApp once, after the catch-up', async () => {
  const { bridge, fake, sock } = await restartWithStore(
    { chats: [makeChat(GROUP)], contacts: [], messages: [makeMessage(GROUP, 'G', 'x')], isLatest: true },
    { groups: { [GROUP]: { id: GROUP, subject: 'Climbing Crew', participants: [] } } },
  );
  expect((await bridge.getChats())[0].name).toBe('120363000000000001');
  await sock.ev.emit('connection.update', { receivedPendingNotifications: true });
  await new Promise(r => setTimeout(r, 20));
  expect((await bridge.getChats())[0].name).toBe('Climbing Crew');
  expect(fake.calls.groupMetadata).toEqual([GROUP]);
});

test('editing one of my messages sends one edit to the chat the message lives in', async () => {
  const bridge = loadBridge();
  const fake = createFakeBaileys();
  await connect(bridge, fake, {
    history: {
      chats: [makeChat(BOB_PN)], contacts: [makeContact(BOB_PN, 'Bob', { lid: BOB_LID })],
      messages: [makeMessage(BOB_LID, 'MINE', 'typo', { fromMe: true }), makeMessage(BOB_LID, 'THEIRS', 'hi')],
      isLatest: true,
    },
  });
  await bridge.editMessage(BOB_PN, 'MINE', 'fixed');
  expect(fake.sent).toHaveLength(1);
  expect(fake.sent[0].jid).toBe(BOB_LID);
  expect(fake.sent[0].content).toEqual({ text: 'fixed', edit: { remoteJid: BOB_LID, id: 'MINE', fromMe: true } });
  await expect(bridge.editMessage(BOB_PN, 'THEIRS', 'nope')).rejects.toThrow(/own messages/);
  expect(fake.sent).toHaveLength(1);
});

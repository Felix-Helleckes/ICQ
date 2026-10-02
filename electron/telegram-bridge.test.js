/**
 * The Telegram bridge against a fake gramjs client: login (phone + code, 2FA),
 * sending stickers and voice notes, logout. No network, no account, nothing sent —
 * the fake records what WOULD have gone to Telegram.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Api } = require('telegram');
const { RPCError } = require('telegram/errors');
const { CustomFile } = require('telegram/client/uploads');

global.__tgBroadcasts = [];
jest.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [{
      isDestroyed: () => false,
      webContents: { send: (channel, data) => global.__tgBroadcasts.push({ channel, data }) },
    }],
  },
}));

function fakeClient({ authorized = false, invoke, sendFile, history = {}, participants = [], dialogs = [], downloadDelay = 0 } = {}) {
  const calls = { invoke: [], sendFile: [], signInWithPassword: 0, destroy: 0, handlers: 0, downloads: [], profilePhotos: 0 };
  const client = {
    calls,
    handler: null,
    // gramjs answers newest first.
    async getMessages(peer) { return [...(history[String(peer)] || [])].sort((a, b) => b.date - a.date); },
    async downloadMedia(m) {
      calls.downloads.push(m.id);
      if (downloadDelay) await new Promise(r => setTimeout(r, downloadDelay));
      return Buffer.from(`media-${m.id}`);
    },
    async getParticipants() { return participants; },
    async getDialogs() { return dialogs; },
    session: { save: () => 'SESSION-STRING' },
    async connect() {},
    async isUserAuthorized() { return authorized; },
    async sendCode() { return { phoneCodeHash: 'HASH' }; },
    async invoke(req) { calls.invoke.push(req); if (invoke) return invoke(req); return {}; },
    async signInWithPassword(_creds, { password }) {
      calls.signInWithPassword += 1;
      const pw = await password('my hint');
      if (pw !== 'secret') throw new Error('PASSWORD_HASH_INVALID');
      return {};
    },
    async getMe() { return { firstName: 'Test', lastName: 'User' }; },
    async downloadProfilePhoto() { calls.profilePhotos += 1; return null; },
    addEventHandler(fn) { calls.handlers += 1; client.handler = fn; },
    async sendFile(peer, opts) { calls.sendFile.push({ peer, opts }); if (sendFile) return sendFile(opts); return { id: 42, date: 1700000000 }; },
    async destroy() { calls.destroy += 1; },
  };
  return client;
}

let dataDir;
let clients;
let live = [];

function loadBridge(clientOpts) {
  let mod;
  jest.isolateModules(() => { mod = require('./telegram-bridge'); });
  clients = [];
  // Like the real thing: a client is only authorized if its session string holds a
  // login (the bridge passes what telegram.session contains).
  mod.__setTelegramForTests({
    clientFactory: (session) => {
      const hasLogin = !!session?.save?.() || (clientOpts?.authorized && clients.length === 0);
      const c = fakeClient({ ...clientOpts, authorized: hasLogin });
      clients.push(c);
      return c;
    },
  });
  live.push(mod);
  return mod;
}

const broadcastsOn = (ch) => global.__tgBroadcasts.filter(b => b.channel === ch).map(b => b.data);
const tick = () => new Promise(r => setImmediate(r));

beforeEach(() => {
  global.__tgBroadcasts = [];
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-bridge-test-'));
});
afterEach(async () => {
  for (const b of live) { try { await b.shutdown(); } catch (e) {} }
  live = [];
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('phone + code login works — gramjs has no client.signIn, the raw API is used', async () => {
  const bridge = loadBridge();
  await bridge.init(null, null, dataDir);
  expect(bridge.getStatus()).toBe('needs-auth');

  const hash = await bridge.requestCode('+491700000001');
  await bridge.signIn('+491700000001', '12345', hash);

  const req = clients[0].calls.invoke[0];
  expect(req).toBeInstanceOf(Api.auth.SignIn);
  expect(req.phoneCode).toBe('12345');
  expect(req.phoneCodeHash).toBe('HASH');
  expect(bridge.getStatus()).toBe('ready');
  expect(fs.readFileSync(path.join(dataDir, 'telegram.session'), 'utf8')).toBe('SESSION-STRING');
  expect(broadcastsOn('tg:ready')[0]).toMatchObject({ name: 'Test User' });
});

test('with two-step verification the login asks for the password and retries a wrong one', async () => {
  const bridge = loadBridge({
    invoke: (req) => { if (req instanceof Api.auth.SignIn) throw new RPCError('SESSION_PASSWORD_NEEDED', req, 401); return {}; },
  });
  await bridge.init(null, null, dataDir);
  const done = bridge.signIn('+491700000001', '12345', 'HASH');

  await tick();
  expect(broadcastsOn('tg:2fa-needed')).toEqual([{ hint: 'my hint' }]);
  bridge.submit2FA('secret');
  await done;

  expect(clients[0].calls.signInWithPassword).toBe(1);
  expect(bridge.getStatus()).toBe('ready');
});

test('a number without a Telegram account gets a clear message', async () => {
  const bridge = loadBridge({ invoke: () => new Api.auth.AuthorizationSignUpRequired({}) });
  await bridge.init(null, null, dataDir);
  await expect(bridge.signIn('+491700000001', '12345', 'HASH')).rejects.toThrow(/kein Telegram-Konto/);
  expect(bridge.getStatus()).not.toBe('ready');
});

describe('sending (recorded, never transmitted)', () => {
  async function readyBridge(opts) {
    const bridge = loadBridge({ authorized: true, ...opts });
    await bridge.init(null, null, dataDir);
    expect(bridge.getStatus()).toBe('ready');
    return bridge;
  }

  test('a .webp goes out as a sticker, anything else as a picture — each exactly once', async () => {
    const bridge = await readyBridge();
    await bridge.sendSticker('123', 'C:/x/sticker.webp');
    await bridge.sendSticker('123', 'C:/x/funny.png');
    const [webp, png] = clients[0].calls.sendFile;
    expect(webp.opts.attributes[0]).toBeInstanceOf(Api.DocumentAttributeSticker);
    expect(png.opts.attributes).toBeUndefined();
    expect(clients[0].calls.sendFile).toHaveLength(2);
  });

  test('a failed sticker send is NOT resent as a file (it may have arrived already)', async () => {
    const bridge = await readyBridge({ sendFile: () => { throw new Error('timeout'); } });
    await expect(bridge.sendSticker('123', 'C:/x/sticker.webp')).rejects.toThrow('timeout');
    expect(clients[0].calls.sendFile).toHaveLength(1);
  });

  test('a voice note goes out as voice.ogg with a voice attribute', async () => {
    const bridge = await readyBridge();
    const webm = fs.readFileSync(path.join(__dirname, 'lib', 'fixtures', 'voice-chromium.webm')).toString('base64');
    await bridge.sendVoice('123', webm, 'audio/webm;codecs=opus', Array(64).fill(40));
    const [{ opts }] = clients[0].calls.sendFile;
    expect(opts.file).toBeInstanceOf(CustomFile);
    expect(opts.file.name).toBe('voice.ogg');
    expect(opts.attributes[0].voice).toBe(true);
    expect(clients[0].calls.sendFile).toHaveLength(1);
  });
});

test('logout ends the session on the server and retires the old client', async () => {
  const bridge = loadBridge({ authorized: true });
  await bridge.init(null, null, dataDir);
  fs.writeFileSync(path.join(dataDir, 'telegram.session'), 'SESSION-STRING');

  await bridge.logout();

  const old = clients[0];
  expect(old.calls.invoke.some(r => r instanceof Api.auth.LogOut)).toBe(true);
  expect(old.calls.destroy).toBe(1);                  // no zombie client pushing messages
  expect(fs.existsSync(path.join(dataDir, 'telegram.session'))).toBe(false);
  expect(clients).toHaveLength(2);                    // a fresh client for the next login
});

// ── Opening chats, group members, live updates ────────────────────────────

const bigInt = require('big-integer');

/** A gramjs-like message. */
function tgMsg(id, date, { text = '', out = false, photo = false, voice = false, sender, peer } = {}) {
  return {
    id, date, message: text, out,
    photo: photo ? { id: 1 } : undefined,
    document: voice ? { mimeType: 'audio/ogg', attributes: [{ className: 'DocumentAttributeAudio', voice: true }] } : undefined,
    senderId: sender ? bigInt(sender.id) : undefined,
    sender,
    isPrivate: false,
    peerId: peer,
    async getSender() { return sender; },
  };
}

const alice = { id: 11, firstName: 'Alice', lastName: 'Example' };
const GROUP_ID = '-1001234';

async function readyWith(opts) {
  const bridge = loadBridge({ authorized: true, ...opts });
  await bridge.init(null, null, dataDir);
  return bridge;
}

test('opening a chat returns at once, oldest first — media follows in the background', async () => {
  const bridge = await readyWith({
    downloadDelay: 30,
    history: {
      [GROUP_ID]: [
        tgMsg(1, 100, { text: 'first', sender: alice }),
        tgMsg(2, 200, { photo: true, sender: alice }),
        tgMsg(3, 300, { voice: true, sender: alice }),
      ],
    },
  });
  const msgs = await bridge.getMessages(GROUP_ID, { limit: 50 });
  expect(msgs.map(m => m.id)).toEqual(['1', '2', '3']);          // not newest first
  expect(msgs.map(m => m.type)).toEqual(['text', 'image', 'ptt']);
  expect(msgs[0].senderName).toBe('Alice Example');
  expect(msgs[1].mediaData).toBeFalsy();                         // not waited for

  await new Promise(r => setTimeout(r, 120));
  const media = broadcastsOn('tg:media');
  expect(media.map(x => x.msgId).sort()).toEqual(['2', '3']);
  expect(media.every(x => x.chatId === GROUP_ID)).toBe(true);

  // Reopened: straight from the cache, no second download.
  const again = await bridge.getMessages(GROUP_ID, { limit: 50 });
  expect(again[1].mediaData).toMatch(/^data:image\/jpeg;base64,/);
  expect(clients[0].calls.downloads.sort()).toEqual([2, 3]);
});

test('media of the same message id in two chats is kept apart', async () => {
  const bridge = await readyWith({
    history: { 100: [tgMsg(5, 10, { photo: true })], 200: [tgMsg(5, 10, { photo: true })] },
  });
  await bridge.getMessages('100');
  await bridge.getMessages('200');
  await new Promise(r => setTimeout(r, 20));
  expect(broadcastsOn('tg:media').map(x => x.chatId).sort()).toEqual(['100', '200']);
  expect(clients[0].calls.downloads).toEqual([5, 5]);
});

test('group members come with ids, names and roles (gramjs returns users)', async () => {
  const { Api: A } = require('telegram');
  const bridge = await readyWith({
    participants: [
      { id: bigInt(11), firstName: 'Alice', lastName: 'Example', participant: new A.ChannelParticipantCreator({ userId: bigInt(11), adminRights: new A.ChatAdminRights({}) }), status: new A.UserStatusOnline({ expires: 0 }) },
      { id: bigInt(12), username: 'bob_b', participant: new A.ChannelParticipant({ userId: bigInt(12), date: 0 }) },
      { id: bigInt(13), phone: '491700000003' },
    ],
  });
  const members = await bridge.getParticipants(GROUP_ID);
  expect(members).toEqual([
    { id: '11', name: 'Alice Example', isAdmin: true, online: true },
    { id: '12', name: 'bob_b', isAdmin: false, online: false },
    { id: '13', name: '+491700000003', isAdmin: false, online: false },
  ]);
});

test('live: a group message arrives with its sender; own messages from the phone come through too', async () => {
  const { Api: A } = require('telegram');
  await readyWith();
  const handler = clients[0].handler;
  const peer = new A.PeerChannel({ channelId: bigInt(1234) });
  const noCachedSender = { ...tgMsg(7, 500, { text: 'hi all', sender: alice, peer }), sender: undefined };
  await handler({ message: noCachedSender });
  await handler({ message: tgMsg(8, 501, { text: 'sent from my phone', out: true, peer }) });

  const live = broadcastsOn('tg:message');
  expect(live[0]).toMatchObject({ chatId: '-1001234', id: '7', body: 'hi all' });
  expect(live.find(m => m.id === '7' && m.senderName === 'Alice Example')).toBeTruthy(); // looked up after
  expect(live.find(m => m.id === '8')).toMatchObject({ fromMe: true });
  // The chat update only says what it knows — no fake archived:false any more.
  const upd = broadcastsOn('tg:chat-update')[0];
  expect(upd).toEqual({ id: '-1001234', lastMessage: 'hi all', timestamp: 500 });
});

test('the chat list loads each avatar once per session, not on every reload', async () => {
  const dialogs = [{ id: bigInt(1), name: 'A', entity: {} }, { id: bigInt(2), name: 'B', entity: {} }];
  const bridge = await readyWith({ dialogs });
  await bridge.getDialogs();
  await bridge.getDialogs();
  await new Promise(r => setTimeout(r, 20));
  expect(clients[0].calls.profilePhotos - 1).toBe(2); // minus getMe's own picture
});

test('one message handler per client — logging in again does not double every message', async () => {
  await readyWith();
  expect(clients[0].calls.handlers).toBe(1);
});

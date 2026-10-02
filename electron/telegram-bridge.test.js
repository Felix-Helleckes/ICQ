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

function fakeClient({ authorized = false, invoke, sendFile } = {}) {
  const calls = { invoke: [], sendFile: [], signInWithPassword: 0, destroy: 0, handlers: 0 };
  const client = {
    calls,
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
    async downloadProfilePhoto() { return null; },
    addEventHandler() { calls.handlers += 1; },
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

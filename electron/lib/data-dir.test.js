const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveDataDir, findLegacyDataDir, migrateLegacyData, hasLoginData } = require('./data-dir');

// Minimal fake fs: records calls and simulates a writable / read-only target.
function fakeFs(writable) {
  const calls = { mkdir: [], access: [] };
  return {
    calls,
    mkdirSync: (p) => { calls.mkdir.push(p); },
    accessSync: (p) => {
      calls.access.push(p);
      if (!writable) { const e = new Error('EACCES: permission denied'); e.code = 'EACCES'; throw e; }
    },
    constants: { W_OK: 2 },
  };
}

test('portable build: data lives in ICQ-Data next to the .exe', () => {
  const r = resolveDataDir({ portableExecDir: path.join('D:', 'usb', 'icq'), fs: fakeFs(true) });
  expect(r).toEqual({
    userDataDir: path.join('D:', 'usb', 'icq', 'ICQ-Data'),
    sessionDataDir: path.join('D:', 'usb', 'icq', 'ICQ-Data', 'session'),
    source: 'portable-env',
  });
});

test('portable build on a read-only medium: keep default (null)', () => {
  expect(resolveDataDir({ portableExecDir: path.join('E:', 'readonly'), fs: fakeFs(false) })).toBeNull();
});

test('installed build: the OS user-data folder, never the install folder — updates delete that', () => {
  // Even a writable install folder (per-user Windows setup, /Applications) is not used.
  const f = fakeFs(true);
  expect(resolveDataDir({ portableExecDir: undefined, fs: f })).toBeNull();
  expect(f.calls.mkdir).toHaveLength(0);
});

// ── Migration from the old layout (real temp folders) ─────────────────────

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'icq-datadir-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

function write(file, content = 'x') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/** An old-layout ICQ-Data folder with a WhatsApp + Telegram login and a Chromium profile. */
function makeLegacy(dir) {
  write(path.join(dir, 'whatsapp', 'baileys-auth', 'creds.json'), '{"me":{"id":"4917@s.whatsapp.net"}}');
  write(path.join(dir, 'whatsapp', 'baileys-auth', 'session-1.json'), 'sess');
  write(path.join(dir, 'whatsapp', 'store.json'), '{}');
  write(path.join(dir, 'telegram.session'), 'tg');
  write(path.join(dir, 'avatars', 'a.img'), 'img');
  write(path.join(dir, 'session', 'Local Storage', 'leveldb', '000003.log'), 'skin=classic');
  write(path.join(dir, 'session', 'Cache', 'big.bin'), 'cache');
}

describe('findLegacyDataDir', () => {
  test('finds ICQ-Data next to the executable of an installed build', () => {
    const installDir = path.join(tmp, 'Programs', 'ICQ Messenger');
    makeLegacy(path.join(installDir, 'ICQ-Data'));
    const found = findLegacyDataDir({
      isPackaged: true, execPath: path.join(installDir, 'ICQ Messenger.exe'),
      userDataDir: path.join(tmp, 'AppData', 'ICQ Messenger'), fs,
    });
    expect(found).toBe(path.join(installDir, 'ICQ-Data'));
  });

  test('prefers what the Windows installer rescued before the update deleted the install folder', () => {
    const userData = path.join(tmp, 'AppData', 'ICQ Messenger');
    makeLegacy(path.join(userData, 'legacy-ICQ-Data'));
    const found = findLegacyDataDir({ isPackaged: true, execPath: path.join(tmp, 'x', 'app.exe'), userDataDir: userData, fs });
    expect(found).toBe(path.join(userData, 'legacy-ICQ-Data'));
  });

  test('portable and dev builds never migrate; an empty leftover folder is ignored', () => {
    const installDir = path.join(tmp, 'app');
    fs.mkdirSync(path.join(installDir, 'ICQ-Data', 'session'), { recursive: true });
    const base = { execPath: path.join(installDir, 'app.exe'), userDataDir: path.join(tmp, 'ud'), fs };
    expect(findLegacyDataDir({ ...base, isPackaged: true })).toBeNull();
    makeLegacy(path.join(installDir, 'ICQ-Data'));
    expect(findLegacyDataDir({ ...base, isPackaged: true, portableExecDir: installDir })).toBeNull();
    expect(findLegacyDataDir({ ...base, isPackaged: false })).toBeNull();
  });
});

describe('migrateLegacyData', () => {
  test('moves logins, chat list, avatars and settings; leaves caches; retires the source', () => {
    const from = path.join(tmp, 'install', 'ICQ-Data');
    const to = path.join(tmp, 'userData');
    makeLegacy(from);

    expect(migrateLegacyData({ from, to, fs })).toEqual({ migrated: true, reason: 'ok' });

    expect(fs.readFileSync(path.join(to, 'whatsapp', 'baileys-auth', 'creds.json'), 'utf8')).toBe('{"me":{"id":"4917@s.whatsapp.net"}}');
    expect(fs.existsSync(path.join(to, 'whatsapp', 'baileys-auth', 'session-1.json'))).toBe(true);
    expect(fs.existsSync(path.join(to, 'telegram.session'))).toBe(true);
    expect(fs.existsSync(path.join(to, 'avatars', 'a.img'))).toBe(true);
    // The old Chromium profile (ICQ-Data/session) folds into the user-data root.
    expect(fs.existsSync(path.join(to, 'Local Storage', 'leveldb', '000003.log'))).toBe(true);
    expect(fs.existsSync(path.join(to, 'Cache'))).toBe(false);
    // Retired, so an older version cannot pick up the stale copy.
    expect(fs.existsSync(from)).toBe(false);
    expect(hasLoginData(`${from}.migrated`, fs)).toBe(true);
    expect(fs.existsSync(`${to}.migrating`)).toBe(false);
  });

  test('never overwrites a login that already exists in the target — decided per messenger', () => {
    const from = path.join(tmp, 'old');
    const to = path.join(tmp, 'userData');
    makeLegacy(from);
    write(path.join(to, 'telegram.session'), 'current');

    // Telegram is already logged in here, WhatsApp is not: only WhatsApp moves.
    expect(migrateLegacyData({ from, to, fs }).migrated).toBe(true);
    expect(fs.readFileSync(path.join(to, 'telegram.session'), 'utf8')).toBe('current');
    expect(fs.existsSync(path.join(to, 'whatsapp', 'baileys-auth', 'creds.json'))).toBe(true);

    // Both logins present → nothing to do, the old folder stays untouched.
    const from2 = path.join(tmp, 'old2');
    makeLegacy(from2);
    expect(migrateLegacyData({ from: from2, to, fs }).migrated).toBe(false);
    expect(fs.existsSync(from2)).toBe(true);
  });

  test('an unpaired creds.json (Baileys writes one on every start) is not a login', () => {
    const dir = path.join(tmp, 'unpaired');
    write(path.join(dir, 'whatsapp', 'baileys-auth', 'creds.json'), '{"registered":false,"noiseKey":{}}');
    expect(hasLoginData(dir, fs)).toBe(false);
    // QR-linked devices keep registered=false; me.id is what marks them paired.
    write(path.join(dir, 'whatsapp', 'baileys-auth', 'creds.json'), '{"registered":false,"me":{"id":"4917:3@s.whatsapp.net"}}');
    expect(hasLoginData(dir, fs)).toBe(true);
  });

  test('an interrupted copy leaves no half-copied session behind', () => {
    const from = path.join(tmp, 'old');
    const to = path.join(tmp, 'userData');
    makeLegacy(from);
    const broken = { ...fs, copyFileSync: (a, b) => { if (a.endsWith('session-1.json')) throw new Error('disk full'); return fs.copyFileSync(a, b); } };

    expect(() => migrateLegacyData({ from, to, fs: broken })).toThrow('disk full');
    expect(hasLoginData(to, fs)).toBe(false);          // nothing half-done in place
    expect(fs.existsSync(`${to}.migrating`)).toBe(false);
    expect(hasLoginData(from, fs)).toBe(true);         // the source is untouched

    // The next start simply tries again.
    expect(migrateLegacyData({ from, to, fs }).migrated).toBe(true);
  });
});

test('finds the installer\'s rescue folder even when Electron uses another folder name', () => {
  // Electron names the user-data folder after package.json "name" (icq-messenger),
  // the installer only knows the product name (ICQ Messenger).
  const rescued = path.join(tmp, 'Roaming', 'ICQ Messenger', 'legacy-ICQ-Data');
  makeLegacy(rescued);
  const found = findLegacyDataDir({
    isPackaged: true, execPath: path.join(tmp, 'Programs', 'app.exe'),
    userDataDir: path.join(tmp, 'Roaming', 'icq-messenger'), extraCandidates: [rescued], fs,
  });
  expect(found).toBe(rescued);
});

test('a target that already has a Chromium profile and a login-less chat list still gets the login', () => {
  const from = path.join(tmp, 'old');
  const to = path.join(tmp, 'userData');
  makeLegacy(from);
  write(path.join(to, 'Local Storage', 'leveldb', 'CURRENT'), 'new-profile');
  write(path.join(to, 'whatsapp', 'store.json'), '{"fresh":true}');

  expect(migrateLegacyData({ from, to, fs }).migrated).toBe(true);
  expect(fs.readFileSync(path.join(to, 'whatsapp', 'baileys-auth', 'creds.json'), 'utf8')).toBe('{"me":{"id":"4917@s.whatsapp.net"}}');
  // The existing LevelDB is left alone — no mix of two databases.
  expect(fs.readFileSync(path.join(to, 'Local Storage', 'leveldb', 'CURRENT'), 'utf8')).toBe('new-profile');
  expect(fs.existsSync(path.join(to, 'Local Storage', 'leveldb', '000003.log'))).toBe(false);
});

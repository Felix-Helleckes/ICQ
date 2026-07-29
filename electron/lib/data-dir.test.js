const path = require('path');
const { resolveDataDir } = require('./data-dir');

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
  const fs = fakeFs(true);
  const r = resolveDataDir({
    portableExecDir: path.join('D:', 'usb', 'icq'),
    isPackaged: true,
    execPath: path.join('D:', 'usb', 'icq', 'ICQ.exe'),
    fs,
  });
  expect(r).toEqual({
    userDataDir: path.join('D:', 'usb', 'icq', 'ICQ-Data'),
    sessionDataDir: path.join('D:', 'usb', 'icq', 'ICQ-Data', 'session'),
    source: 'portable-env',
  });
});

test('portable build on a read-only medium: keep default (null)', () => {
  const fs = fakeFs(false);
  const r = resolveDataDir({
    portableExecDir: path.join('E:', 'readonly'),
    isPackaged: true,
    execPath: path.join('E:', 'readonly', 'ICQ.exe'),
    fs,
  });
  expect(r).toBeNull();
});

test('installed build in a writable dir: ICQ-Data fallback next to the exe', () => {
  const fs = fakeFs(true);
  const r = resolveDataDir({
    portableExecDir: undefined,
    isPackaged: true,
    execPath: path.join('C:', 'Users', 'me', 'ICQ', 'ICQ.exe'),
    fs,
  });
  expect(r.source).toBe('portable-fallback');
  expect(r.userDataDir).toBe(path.join('C:', 'Users', 'me', 'ICQ', 'ICQ-Data'));
});

test('installed to Program Files (read-only): keep default userData (null)', () => {
  const fs = fakeFs(false);
  const r = resolveDataDir({
    portableExecDir: undefined,
    isPackaged: true,
    execPath: path.join('C:', 'Program Files', 'ICQ Messenger', 'ICQ Messenger.exe'),
    fs,
  });
  expect(r).toBeNull();
  // it did probe writability before giving up
  expect(fs.calls.access.length).toBe(1);
});

test('dev / unpackaged: never touches the filesystem, keeps default (null)', () => {
  const fs = fakeFs(true);
  const r = resolveDataDir({
    portableExecDir: undefined,
    isPackaged: false,
    execPath: path.join('C:', 'whatever', 'electron.exe'),
    fs,
  });
  expect(r).toBeNull();
  expect(fs.calls.mkdir).toHaveLength(0);
  expect(fs.calls.access).toHaveLength(0);
});

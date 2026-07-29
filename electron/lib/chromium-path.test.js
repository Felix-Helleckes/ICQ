const path = require('path');
const { resolveChromiumExecutable } = require('./chromium-path');

const CHROME_MAC = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

test('macOS prefers system Google Chrome', () => {
  const exe = resolveChromiumExecutable({
    platform: 'darwin',
    existsSync: (p) => p === CHROME_MAC,
    readdirSync: () => { throw new Error('unused'); },
  });
  expect(exe).toBe(CHROME_MAC);
});

test('macOS returns null when no browser is installed', () => {
  const exe = resolveChromiumExecutable({
    platform: 'darwin',
    existsSync: () => false,
    readdirSync: () => { throw new Error('unused'); },
  });
  expect(exe).toBeNull();
});

test('Windows prefers the bundled Chrome over system/dev', () => {
  const RES = path.join('C:', 'app', 'resources');
  const bundled = path.join(RES, 'chrome', '120.0.6099.71', 'chrome-win64', 'chrome.exe');
  const exe = resolveChromiumExecutable({
    platform: 'win32',
    resourcesPath: RES,
    env: { ProgramFiles: 'C:\\Program Files' },
    existsSync: (p) => p === bundled, // system paths deliberately "missing"
    readdirSync: (dir) => (dir === path.join(RES, 'chrome') ? ['120.0.6099.71'] : []),
  });
  expect(exe).toBe(bundled);
});

test('Linux falls back to system Chrome when nothing is bundled', () => {
  const exe = resolveChromiumExecutable({
    platform: 'linux',
    resourcesPath: '/opt/app/resources',
    env: {},
    existsSync: (p) => p === '/usr/bin/google-chrome',
    readdirSync: () => { throw new Error('no bundled chrome dir'); },
  });
  expect(exe).toBe('/usr/bin/google-chrome');
});

test('falls back to Puppeteer Chromium in dev when nothing else exists', () => {
  const exe = resolveChromiumExecutable({
    platform: 'linux',
    existsSync: (p) => p === '/home/dev/.cache/puppeteer/chrome',
    readdirSync: () => { throw new Error('no bundled'); },
    puppeteerPath: () => '/home/dev/.cache/puppeteer/chrome',
  });
  expect(exe).toBe('/home/dev/.cache/puppeteer/chrome');
});

test('returns null when no executable can be found anywhere', () => {
  const exe = resolveChromiumExecutable({
    platform: 'linux',
    existsSync: () => false,
    readdirSync: () => { throw new Error('no bundled'); },
    puppeteerPath: () => null,
  });
  expect(exe).toBeNull();
});

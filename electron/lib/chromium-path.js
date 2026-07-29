const path = require('path');

/**
 * Resolve which Chrome/Chromium/Edge executable the WhatsApp bridge should
 * drive, in priority order. Pure and fully injectable so the packaged-vs-dev
 * path logic (the part that differs between builds) is unit-testable.
 *
 * Priority:
 *   macOS  → system Google Chrome, then Chromium, then Edge.
 *   win/linux → 1. bundled Chrome (extraResources → resources/chrome/<v>/…),
 *               2. system Chrome/Edge, 3. Puppeteer's downloaded Chromium (dev).
 *
 * Returns the executable path, or null when nothing is found. Side effects
 * (chmod on posix) stay in the caller.
 *
 * deps: { platform, resourcesPath, env, existsSync, readdirSync, puppeteerPath }
 */
function resolveChromiumExecutable(deps) {
  const {
    platform,
    resourcesPath,
    env = {},
    existsSync,
    readdirSync,
    puppeteerPath = () => null,
  } = deps;

  const win = platform === 'win32';
  const mac = platform === 'darwin';

  if (mac) {
    const macCandidates = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ];
    for (const p of macCandidates) {
      if (existsSync(p)) return p;
    }
    return null;
  }

  // 1. Bundled Chromium (resources/chrome/<version>/chrome-*/chrome[.exe])
  if (resourcesPath) {
    try {
      const chromeDir = path.join(resourcesPath, 'chrome');
      const versions = readdirSync(chromeDir);
      for (const v of versions) {
        const vDir = path.join(chromeDir, v);
        const candidates = [
          path.join(vDir, 'chrome-win64', 'chrome.exe'),
          path.join(vDir, 'chrome-win32', 'chrome.exe'),
          path.join(vDir, 'chrome-linux64', 'chrome'),
          path.join(vDir, 'chrome-linux', 'chrome'),
          path.join(vDir, 'chrome-mac-x64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
          path.join(vDir, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
        ];
        for (const exe of candidates) {
          if (existsSync(exe)) return exe;
        }
      }
    } catch (e) { /* no bundled chrome */ }
  }

  // 2. System Chrome / Edge
  const sysCandidates = win ? [
    path.join(env['ProgramFiles'] || '', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(env['ProgramFiles(x86)'] || '', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(env['LOCALAPPDATA'] || '', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(env['ProgramFiles'] || '', 'Microsoft\\Edge\\Application\\msedge.exe'),
    path.join(env['ProgramFiles(x86)'] || '', 'Microsoft\\Edge\\Application\\msedge.exe'),
  ] : [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/snap/bin/chromium',
  ];
  for (const p of sysCandidates) {
    if (p && existsSync(p)) return p;
  }

  // 3. Dev fallback: Puppeteer's own downloaded Chromium
  try {
    const p = puppeteerPath();
    if (p && existsSync(p)) return p;
  } catch (e) { /* puppeteer not installed */ }

  return null;
}

module.exports = { resolveChromiumExecutable };

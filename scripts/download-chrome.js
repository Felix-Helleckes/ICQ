/**
 * Downloads the Chromium binary used by Puppeteer into ./puppeteer_cache/
 * so electron-builder can bundle it as extraResources.
 *
 * Run manually:  node scripts/download-chrome.js
 * Run via npm:   npm run download-chrome
 *
 * The download is ~150-300 MB and should NOT be committed to git.
 * electron-builder copies puppeteer_cache/chrome → resources/chrome in the packaged app.
 */

const { execSync } = require('child_process');
const path = require('path');
const fs   = require('fs');

const cacheDir = path.join(__dirname, '..', 'puppeteer_cache');
const chromeDir = path.join(cacheDir, 'chrome');

// Check if any chrome executable already exists in the cache
function hasChrome(dir) {
  if (!fs.existsSync(dir)) return false;
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.isDirectory()) { if (walk(path.join(d, entry.name))) return true; }
      else if (entry.name === 'chrome.exe' || entry.name === 'chrome') return true;
    }
    return false;
  };
  return walk(dir);
}

if (hasChrome(chromeDir)) {
  console.log('[download-chrome] Chrome already present in puppeteer_cache/chrome — skipping download.');
  process.exit(0);
}

console.log('[download-chrome] Downloading Chrome into puppeteer_cache/ …');
console.log('[download-chrome] This is a one-time ~200 MB download.\n');

try {
  execSync('npx puppeteer browsers install chrome', {
    stdio: 'inherit',
    env: { ...process.env, PUPPETEER_CACHE_DIR: cacheDir },
    cwd: path.join(__dirname, '..'),
  });
  console.log('\n[download-chrome] Done. Chrome is now at puppeteer_cache/chrome/');
} catch (err) {
  console.error('[download-chrome] Failed:', err.message);
  process.exit(1);
}

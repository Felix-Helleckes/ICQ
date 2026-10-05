/**
 * Build the store variants of the app: Retrogram name, original icon, no ICQ /
 * WhatsApp / Telegram logos. The regular release builds are not affected.
 *
 *   node scripts/build-store.js renderer   # only the renderer (build/)
 *   node scripts/build-store.js win        # MSIX for the Microsoft Store -> dist/Retrogram-<v>.appx
 *   node scripts/build-store.js mas [...]  # Mac App Store pkg (macOS only), extra args go to electron-builder
 *
 * Why an overlay: the renderer references /icq-logo.png, /whatsapp-logo.svg and
 * /telegram-logo.svg. Instead of branching in every component, the store build replaces
 * those files in build/ by neutral ones from store/brand/public (same file names).
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const target = process.argv[2];
const extra = process.argv.slice(3);

function run(cmd, args, env) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: true, env: { ...process.env, ...env } });
  if (r.status !== 0) process.exit(r.status || 1);
}

if (!['renderer', 'win', 'mas'].includes(target)) {
  console.error('usage: node scripts/build-store.js renderer|win|mas [electron-builder args]');
  process.exit(2);
}

// 1. Renderer with the store switch (src/brand.js reads REACT_APP_STORE).
run('npx', ['react-scripts', 'build'], { REACT_APP_STORE: '1', CI: 'false' });

// 2. Overlay neutral artwork onto build/.
const build = path.join(root, 'build');
const brand = path.join(root, 'store', 'brand', 'public');
for (const f of fs.readdirSync(brand)) fs.copyFileSync(path.join(brand, f), path.join(build, f));
for (const f of ['store-icons', 'Chatwindow.png', 'Contacts.png', 'icon.svg']) {
  fs.rmSync(path.join(build, f), { recursive: true, force: true });
}
const indexPath = path.join(build, 'index.html');
fs.writeFileSync(indexPath, fs.readFileSync(indexPath, 'utf8').replace('<title>ICQ Messenger</title>', '<title>Retrogram</title>'));

// 3. Package.
if (target === 'win') {
  run('npx', ['electron-builder', '--config', 'store/builder.store.js', '--win', 'appx', '--publish', 'never', ...extra]);
} else if (target === 'mas') {
  run('npx', ['electron-builder', '--config', 'store/builder.store.js', '--mac', 'mas', '--universal', '--publish', 'never', ...extra]);
}

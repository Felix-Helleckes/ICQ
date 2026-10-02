const nodePath = require('path');

/**
 * Decide where the app stores its user data (WhatsApp session, Telegram session,
 * chat list, avatars).
 *
 *   - Portable build  → PORTABLE_EXECUTABLE_DIR is set by electron-builder;
 *                       data lives in `ICQ-Data` next to the .exe so the login
 *                       travels with the folder.
 *   - Installed build → Electron's default user-data folder, named after
 *                       package.json "name":
 *                         Windows  %APPDATA%\icq-messenger
 *                         macOS    ~/Library/Application Support/icq-messenger
 *                         Linux    ~/.config/icq-messenger
 *   - Dev / unpackaged → the default as well.
 *
 * Installed builds used to put `ICQ-Data` next to the executable whenever that
 * folder was writable. That is the install folder — and every update deletes it:
 * the Windows installer wipes its directory before installing the new version,
 * and on macOS an update replaces the whole .app bundle. Each update therefore
 * logged the user out of WhatsApp AND Telegram, and every lost WhatsApp login left
 * a dead "linked device" on the phone until WhatsApp's device limit was reached.
 * findLegacyDataDir/migrateLegacyData bring such data over once.
 *
 * Returns { userDataDir, sessionDataDir, source } or null (= keep default).
 */
function resolveDataDir(opts) {
  const { portableExecDir, fs, path = nodePath } = opts;
  if (!portableExecDir) return null;

  const userDataDir = path.join(portableExecDir, 'ICQ-Data');
  const sessionDataDir = path.join(userDataDir, 'session');
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.mkdirSync(sessionDataDir, { recursive: true });
    fs.accessSync(userDataDir, fs.constants.W_OK);
    return { userDataDir, sessionDataDir, source: 'portable-env' };
  } catch (e) {
    return null; // read-only medium → caller keeps default userData
  }
}

/**
 * A linked WhatsApp device. Baileys writes creds.json on every start, paired or not,
 * so the file alone means nothing; a paired device has `me.id` (`registered` stays
 * false for QR-linked devices).
 */
function waLoggedIn(dir, fs, path = nodePath) {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(dir, 'whatsapp', 'baileys-auth', 'creds.json'), 'utf8'));
    return !!(c && (c.registered || (c.me && c.me.id)));
  } catch (e) {
    return false;
  }
}

function tgLoggedIn(dir, fs, path = nodePath) {
  try { return fs.statSync(path.join(dir, 'telegram.session')).size > 0; } catch (e) { return false; }
}

/** Does this folder hold a login worth keeping? */
function hasLoginData(dir, fs, path = nodePath) {
  if (!dir) return false;
  return waLoggedIn(dir, fs, path) || tgLoggedIn(dir, fs, path);
}

/**
 * Where an installed build may still have data from the old layout:
 *   - `legacy-ICQ-Data` inside the user-data folder — the Windows installer moves
 *     the old install folder's ICQ-Data there before the update deletes it
 *     (installer/installer.nsh);
 *   - `ICQ-Data` next to the executable — the old location itself.
 */
function findLegacyDataDir(opts) {
  const { portableExecDir, isPackaged, execPath, userDataDir, extraCandidates = [], fs, path = nodePath } = opts;
  if (portableExecDir || !isPackaged || !userDataDir) return null;
  const candidates = [
    path.join(userDataDir, 'legacy-ICQ-Data'),
    // The installer cannot know Electron's folder name (it follows package.json
    // "name", not the product name), so it rescues to a fixed place — see main.js.
    ...extraCandidates,
    execPath ? path.join(path.dirname(execPath), 'ICQ-Data') : null,
  ];
  return candidates.find(c => c && hasLoginData(c, fs, path)) || null;
}

// Chromium caches are rebuilt on demand — not worth copying. Only ever applied to
// the top level of the data folder and of the Chromium profile, never inside the
// WhatsApp session.
const SKIP = /cache|crashpad/i;

function copyTree(from, to, fs, path, skipChromiumCaches = false) {
  const stat = fs.statSync(from);
  if (stat.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(from)) {
      if (skipChromiumCaches && SKIP.test(name)) continue;
      copyTree(path.join(from, name), path.join(to, name), fs, path);
    }
  } else if (!fs.existsSync(to)) {
    fs.copyFileSync(from, to);
  }
}

/**
 * Bring old-layout data into the user-data folder, once.
 *
 * The old layout kept app data in ICQ-Data and the Chromium profile (settings such
 * as the skin) in ICQ-Data/session; the default layout keeps both in one folder.
 * Never overwrites: if the target already holds a login, nothing happens. The copy
 * goes to a staging folder first and is moved into place only when complete, so an
 * interrupted migration can never leave a half-copied WhatsApp session behind. The
 * source is renamed afterwards so an older version cannot pick up the stale copy.
 */
const TELEGRAM_FILES = new Set(['telegram.session', 'telegram-credentials.json']);

function migrateLegacyData(opts) {
  const { from, to, fs, path = nodePath } = opts;
  if (!from || !to) return { migrated: false, reason: 'nothing-to-do' };
  // Decided per messenger: a Telegram login already in the target must not keep
  // the WhatsApp login from moving over (or the other way round).
  const moveWa = waLoggedIn(from, fs, path) && !waLoggedIn(to, fs, path);
  const moveTg = tgLoggedIn(from, fs, path) && !tgLoggedIn(to, fs, path);
  if (!moveWa && !moveTg) return { migrated: false, reason: 'target-has-login' };

  const staging = `${to}.migrating`;
  fs.rmSync(staging, { recursive: true, force: true });
  try {
    for (const name of fs.readdirSync(from)) {
      if (SKIP.test(name)) continue;
      const src = path.join(from, name);
      // The old Chromium profile folder folds into the user-data root.
      if (name === 'session') copyTree(src, staging, fs, path, true);
      else copyTree(src, path.join(staging, name), fs, path);
    }
    if ((moveWa && !waLoggedIn(staging, fs, path)) || (moveTg && !tgLoggedIn(staging, fs, path))) {
      throw new Error('copy incomplete');
    }

    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(staging)) {
      const src = path.join(staging, name);
      const dst = path.join(to, name);
      if (name === 'whatsapp' || TELEGRAM_FILES.has(name)) {
        // The target's copy holds no login of its own (checked above) — at most a
        // chat list or an unpaired session. The old folder's login is what matters.
        if (name === 'whatsapp' ? !moveWa : !moveTg) continue;
        fs.rmSync(dst, { recursive: true, force: true });
        fs.renameSync(src, dst);
      } else if (!fs.existsSync(dst)) {
        fs.renameSync(src, dst);
      } else if (name === 'avatars') {
        copyTree(src, dst, fs, path); // adds the missing pictures
      }
      // Anything else that exists already (a Chromium profile) stays as it is:
      // mixing two LevelDB folders would corrupt both.
    }
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }

  try { fs.renameSync(from, `${from}.migrated`); } catch (e) { /* read-only: harmless */ }
  return { migrated: true, reason: 'ok' };
}

module.exports = { resolveDataDir, findLegacyDataDir, migrateLegacyData, hasLoginData };

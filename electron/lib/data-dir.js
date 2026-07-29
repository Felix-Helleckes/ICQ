const nodePath = require('path');

/**
 * Decide where the app stores its user data (WhatsApp session, avatars).
 *
 * This is the one place packaged builds genuinely diverge:
 *   - Portable build  → PORTABLE_EXECUTABLE_DIR is set by electron-builder;
 *                       data lives in `ICQ-Data` next to the .exe so the login
 *                       travels with the folder.
 *   - Installed build → no PORTABLE_EXECUTABLE_DIR; we still try `ICQ-Data`
 *                       next to the executable, but when the install location
 *                       (e.g. Program Files) isn't writable we return null so
 *                       the caller keeps Electron's default userData (%APPDATA%).
 *   - Dev / unpackaged → return null (keep the default).
 *
 * The directory creation + writability probe use the injected `fs`, so the
 * decision is unit-testable with a fake filesystem. The caller applies
 * app.setPath() and performs any avatar migration based on `source`.
 *
 * Returns { userDataDir, sessionDataDir, source } or null (= keep default).
 * source ∈ 'portable-env' | 'portable-fallback'.
 */
function resolveDataDir(opts) {
  const {
    portableExecDir,
    isPackaged,
    execPath,
    fs,
    path = nodePath,
  } = opts;

  const tryBase = (baseDir, source) => {
    if (!baseDir) return null;
    const userDataDir = path.join(baseDir, 'ICQ-Data');
    const sessionDataDir = path.join(userDataDir, 'session');
    try {
      fs.mkdirSync(userDataDir, { recursive: true });
      fs.mkdirSync(sessionDataDir, { recursive: true });
      fs.accessSync(userDataDir, fs.constants.W_OK);
      return { userDataDir, sessionDataDir, source };
    } catch (e) {
      return null; // not writable → caller keeps default userData
    }
  };

  if (portableExecDir) {
    return tryBase(portableExecDir, 'portable-env');
  }
  if (isPackaged) {
    return tryBase(path.dirname(execPath || '.'), 'portable-fallback');
  }
  return null;
}

module.exports = { resolveDataDir };

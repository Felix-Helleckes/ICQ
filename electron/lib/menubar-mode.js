/**
 * macOS "menu bar mode": the contact list lives behind an icon in the menu bar
 * (top right) instead of the Dock. macOS has exactly one Dock icon per app, so
 * "only the chat windows in the Dock" means: no Dock icon while no chat is open,
 * the icon appears with the first chat window, and its Dock menu lists every open
 * chat. Pure logic here; electron/main.js wires Tray, Dock and windows.
 */
const path = require('path');

const PREFS_FILE = 'prefs.json';

function loadPrefs(dir, fs) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, PREFS_FILE), 'utf8'));
    return { menuBarMode: raw && raw.menuBarMode === true };
  } catch (e) {
    return { menuBarMode: false };
  }
}

function savePrefs(dir, prefs, fs) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, PREFS_FILE), JSON.stringify(prefs, null, 2), 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

// Normal mode always keeps the Dock icon. Menu bar mode shows it only while
// at least one chat window is open.
function dockShouldShow({ menuBarMode, chatCount }) {
  if (!menuBarMode) return true;
  return chatCount > 0;
}

// Top-left corner for the contact list so it hangs centred below the menu bar
// icon, clamped to the work area of that display.
function windowPositionUnderTray(trayBounds, winSize, workArea) {
  const gap = 4;
  let x = Math.round(trayBounds.x + trayBounds.width / 2 - winSize.width / 2);
  const y = Math.round(Math.max(trayBounds.y + trayBounds.height, workArea.y) + gap);
  const minX = workArea.x + gap;
  const maxX = workArea.x + workArea.width - winSize.width - gap;
  x = Math.min(Math.max(x, minX), Math.max(minX, maxX));
  return { x, y };
}

module.exports = { loadPrefs, savePrefs, dockShouldShow, windowPositionUnderTray, PREFS_FILE };

const path = require('path');
const { loadPrefs, savePrefs, dockShouldShow, windowPositionUnderTray, PREFS_FILE } = require('./menubar-mode');

function memFs(files = {}) {
  return {
    files,
    readFileSync: (p) => {
      if (!(p in files)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
      return files[p];
    },
    writeFileSync: (p, data) => { files[p] = data; },
    mkdirSync: () => {},
  };
}

test('prefs default to normal mode when the file is missing or broken', () => {
  expect(loadPrefs('/d', memFs())).toEqual({ menuBarMode: false });
  expect(loadPrefs('/d', memFs({ [path.join('/d', PREFS_FILE)]: '{nope' }))).toEqual({ menuBarMode: false });
  // Only a real boolean true switches it on.
  expect(loadPrefs('/d', memFs({ [path.join('/d', PREFS_FILE)]: '{"menuBarMode":"yes"}' }))).toEqual({ menuBarMode: false });
});

test('prefs survive a save/load round trip', () => {
  const fs = memFs();
  expect(savePrefs('/d', { menuBarMode: true }, fs)).toBe(true);
  expect(loadPrefs('/d', fs)).toEqual({ menuBarMode: true });
});

test('a failing write is reported, not thrown', () => {
  const fs = { ...memFs(), writeFileSync: () => { throw new Error('EACCES'); } };
  expect(savePrefs('/d', { menuBarMode: true }, fs)).toBe(false);
});

test('Dock icon: always in normal mode, only with open chats in menu bar mode', () => {
  expect(dockShouldShow({ menuBarMode: false, chatCount: 0 })).toBe(true);
  expect(dockShouldShow({ menuBarMode: true, chatCount: 0 })).toBe(false);
  expect(dockShouldShow({ menuBarMode: true, chatCount: 2 })).toBe(true);
});

const workArea = { x: 0, y: 25, width: 1440, height: 875 };

test('contact list hangs centred below the menu bar icon', () => {
  const pos = windowPositionUnderTray({ x: 1000, y: 0, width: 24, height: 24 }, { width: 270, height: 580 }, workArea);
  expect(pos).toEqual({ x: 1012 - 135, y: 29 });
});

test('contact list is clamped to the screen when the icon sits at the far right', () => {
  const pos = windowPositionUnderTray({ x: 1420, y: 0, width: 24, height: 24 }, { width: 270, height: 580 }, workArea);
  expect(pos.x).toBe(1440 - 270 - 4);
});

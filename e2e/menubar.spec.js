/**
 * macOS menu bar mode (electron/lib/menubar-mode.js): contact list behind a menu
 * bar icon, Dock icon only while chat windows are open, Dock menu lists them.
 * Real Electron app in ICQ_E2E mode (no bridges); macOS only, Dock APIs exist nowhere else.
 */
const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const os = require('os');
const fs = require('fs');

test.skip(process.platform !== 'darwin', 'Dock and menu bar only exist on macOS');

let app;
let win;
let userDataDir;

const dockVisible = () => app.evaluate(({ app: a }) => a.dock.isVisible());
const dockLabels = () => app.evaluate(({ app: a }) => (a.dock.getMenu()?.items || []).map(i => i.label));
const visibleWindows = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(w => w.isVisible()).length);

test.beforeAll(async () => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'icq-e2e-menubar-'));
  fs.writeFileSync(path.join(userDataDir, 'prefs.json'), JSON.stringify({ menuBarMode: true }));
  app = await electron.launch({
    args: [path.join(__dirname, '..'), `--user-data-dir=${userDataDir}`],
    env: { ...process.env, ICQ_E2E: '1' },
  });
  win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await app?.close();
});

test('menu bar mode: no Dock icon while no chat is open', async () => {
  await expect.poll(dockVisible).toBe(false);
  await expect(win.locator('.svc-tab')).toHaveCount(2);
});

test('a chat window brings the Dock icon, listed by name in the Dock menu', async () => {
  const chatOpened = app.waitForEvent('window');
  await win.evaluate(() => window.api.openChat({ chatId: 'e2e-anna', chatName: 'Anna', service: 'whatsapp', isGroup: false }));
  await chatOpened;
  await expect.poll(dockVisible).toBe(true);
  await expect.poll(dockLabels).toContain('Anna');

  // Like the ✕ in the chat title bar (window:close → BrowserWindow.close()).
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() !== 'ICQ Kontaktliste' && w.webContents.getURL().includes('mode=chat')).close());
  await expect.poll(dockVisible).toBe(false);
  await expect.poll(dockLabels).not.toContain('Anna');
});

test('closing the contact list only hides it — the app keeps running', async () => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await expect.poll(visibleWindows).toBe(0);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
});

test('switching the mode off from the app menu restores Dock and contact list, and is saved', async () => {
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('menubar-mode').click());
  await expect.poll(dockVisible).toBe(true);
  await expect.poll(visibleWindows).toBe(1);
  const saved = JSON.parse(fs.readFileSync(path.join(userDataDir, 'prefs.json'), 'utf8'));
  expect(saved.menuBarMode).toBe(false);
});

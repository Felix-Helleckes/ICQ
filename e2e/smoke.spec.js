/**
 * End-to-end smoke test — launches the real Electron app (headless via the
 * CI's display server) and asserts it boots and is interactive on every OS.
 *
 * Runs in ICQ_E2E mode: the messenger bridges are skipped, so this needs no
 * WhatsApp/Telegram session and is fully deterministic. A fresh --user-data-dir
 * keeps localStorage clean between runs.
 *
 * This is the layer that catches "white screen on Linux" / "crashes on boot
 * on Windows" — the cross-platform regressions unit tests can't see.
 */
const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const os = require('os');
const fs = require('fs');

let app;
let win;

test.beforeAll(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'icq-e2e-'));
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

test('contact window boots and renders both service tabs', async () => {
  await expect(win.locator('.svc-tab')).toHaveCount(2);
  await expect(win.locator('.svc-tab', { hasText: 'WhatsApp' })).toBeVisible();
  await expect(win.locator('.svc-tab', { hasText: 'Telegram' })).toBeVisible();
});

test('shows the WhatsApp login panel while no session is connected', async () => {
  // E2E mode skips the messenger bridges, so WhatsApp stays disconnected and the
  // login panel — not a chat list — must render. This guards the gate that keeps
  // the app from rendering an empty contact list before a session exists.
  await expect(win.locator('.login-panel')).toBeVisible();
  await expect(win.locator('.login-header')).toContainText('WhatsApp Login');
  // The contact-list "No chats found" placeholder must NOT show pre-login.
  await expect(win.locator('.no-contacts')).toHaveCount(0);
});

test('toolbar buttons use line icons, not emoji', async () => {
  // The app chrome (sound, games, skins, logout) used to be emoji, which render
  // differently per platform and clash with the retro look. They are inline SVGs
  // now — assert that so they cannot creep back in.
  const buttons = ['Sound aus', 'Spiele', 'Skin wählen', 'Logout'];
  for (const title of buttons) {
    const btn = win.locator(`button[title="${title}"]`);
    await expect(btn, `${title} button exists`).toHaveCount(1);
    await expect(btn.locator('svg.icon'), `${title} renders an icon`).toHaveCount(1);
    // No leftover emoji glyph next to the icon.
    expect(await btn.innerText(), `${title} has no emoji label`).toBe('');
  }
});

test('the default skin is applied to the document', async () => {
  const skin = await win.evaluate(() => document.documentElement.getAttribute('data-skin'));
  expect(skin).toBe('retro-teal');
});

test('switching skin re-themes the whole renderer end-to-end', async () => {
  await win.locator('button[title="Skin wählen"]').click();
  await win.locator('.sidebar-game-menu-item', { hasText: 'ICQ Classic' }).click();

  await expect
    .poll(() => win.evaluate(() => document.documentElement.getAttribute('data-skin')))
    .toBe('icq-green');

  const bg = await win.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--icq-bg').trim()
  );
  expect(bg.toUpperCase()).toBe('#E8ECF0');
});

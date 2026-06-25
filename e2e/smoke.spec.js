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

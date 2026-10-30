/**
 * Demo mode for App Review (electron/lib/demo-mode.js): Telegram sign-in with the
 * demo number fills both networks with invented chats, and sending gets an answer.
 * Real Electron app in ICQ_E2E mode — no WhatsApp or Telegram connection.
 */
const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const os = require('os');
const fs = require('fs');

let app;
let win;

test.beforeAll(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'icq-e2e-demo-'));
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

test('the demo number signs in to invented chats on both networks', async () => {
  await win.locator('.svc-tab').nth(1).click();
  await win.locator('.method-tab', { hasText: 'Phone' }).click();
  await win.locator('input[type="tel"]').fill('+1 555 555 0123');
  await win.getByRole('button', { name: 'Send Code' }).click();
  await win.locator('input[placeholder="12345"]').fill('24680');
  await win.getByRole('button', { name: 'Sign In' }).click();

  await expect(win.locator('.contact-name', { hasText: 'Nora Linden' })).toBeVisible({ timeout: 10000 });
  await win.locator('.svc-tab').nth(0).click();
  await expect(win.locator('.contact-name', { hasText: 'Mia Summer' })).toBeVisible({ timeout: 10000 });
});

test('a sent message is answered', async () => {
  const opened = app.waitForEvent('window');
  await win.locator('.contact-name', { hasText: 'Mia Summer' }).click();
  const chat = await opened;
  await chat.waitForLoadState('domcontentloaded');
  await expect(chat.getByText('Meet at seven?')).toBeVisible({ timeout: 10000 });
  await chat.locator('textarea').first().fill('Perfect, see you!');
  await chat.locator('.send-btn').click();
  await expect(chat.getByText('Perfect, see you!')).toBeVisible();
  await expect(chat.getByText('Got it 👍')).toBeVisible({ timeout: 10000 });
});

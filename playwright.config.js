const { defineConfig } = require('@playwright/test');

/**
 * Playwright config for the Electron E2E smoke tests.
 * Electron tests drive the app's own bundled Electron — no browser download
 * is needed (so `playwright install` is not required in CI).
 */
module.exports = defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
});

/**
 * Rasterize the social-kit SVGs to pixel-perfect PNGs.
 *
 * Uses Playwright's Chromium (already a devDependency), which renders to an
 * offscreen surface of any size — so tall 9:16 art (1080×1920) works fine,
 * unlike a real window capped by the physical screen height.
 *
 *   npx playwright install chromium   # one-time
 *   node scripts/rasterize-social.js
 */
const { chromium } = require('@playwright/test');
const path = require('path');

const dir = path.join(__dirname, '..', 'marketing', 'social');
const TARGETS = [
  ['landscape-1600x900', 1600, 900],
  ['portrait-1080x1920', 1080, 1920],
  ['square-1080x1080', 1080, 1080],
  ['og-1200x630', 1200, 630],
];

(async () => {
  const browser = await chromium.launch();
  try {
    for (const [name, w, h] of TARGETS) {
      const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
      const fileUrl = 'file://' + path.join(dir, `${name}.svg`).replace(/\\/g, '/');
      await page.goto(fileUrl);
      await page.waitForTimeout(400); // let fonts/emoji settle
      await page.screenshot({ path: path.join(dir, `${name}.png`), clip: { x: 0, y: 0, width: w, height: h } });
      await page.close();
      console.log(`wrote ${name}.png (${w}x${h})`);
    }
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });

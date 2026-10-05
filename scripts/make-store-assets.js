/**
 * Render the store artwork (original Retrogram icon, no third-party logos) from the
 * SVGs in store/brand/ to the PNG/ICO/ICNS files the store builds ship.
 *
 *   node scripts/make-store-assets.js
 *
 * Uses Playwright's Chromium (devDependency) like scripts/rasterize-social.js.
 * The generated files are committed, so this only needs to run when the art changes.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');
const png2icons = require('png2icons');

const root = path.join(__dirname, '..', 'store');
const brand = path.join(root, 'brand');
const pub = path.join(brand, 'public');
const appx = path.join(root, 'res', 'appx');

const svg = (name) => fs.readFileSync(path.join(brand, name), 'utf8');

async function render(browser, html, width, height, file, transparent) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(`<style>html,body{margin:0;background:${transparent ? 'transparent' : '#0A3A3A'}}svg,img{display:block}</style>${html}`);
  await page.screenshot({ path: file, omitBackground: !!transparent, clip: { x: 0, y: 0, width, height } });
  await page.close();
  console.log(`wrote ${path.relative(path.join(__dirname, '..'), file)} (${width}x${height})`);
}

const sized = (markup, w, h) => markup.replace(/width="\d+" height="\d+"/, `width="${w}" height="${h}"`);

(async () => {
  fs.mkdirSync(pub, { recursive: true });
  fs.mkdirSync(appx, { recursive: true });
  const icon = svg('icon.svg');
  const mark = svg('mark.svg');
  const browser = await chromium.launch();
  try {
    await render(browser, sized(icon, 1024, 1024), 1024, 1024, path.join(pub, 'icon.png'), true);
    await render(browser, sized(mark, 256, 256), 256, 256, path.join(pub, 'icq-logo.png'), true);

    // MSIX tiles. The wide tile centres the icon on the brand teal.
    await render(browser, sized(icon, 50, 50), 50, 50, path.join(appx, 'StoreLogo.png'), true);
    await render(browser, sized(icon, 44, 44), 44, 44, path.join(appx, 'Square44x44Logo.png'), true);
    await render(browser, sized(icon, 150, 150), 150, 150, path.join(appx, 'Square150x150Logo.png'), true);
    await render(browser, sized(icon, 310, 310), 310, 310, path.join(appx, 'Square310x310Logo.png'), true);
    await render(browser,
      `<div style="width:310px;height:150px;display:flex;align-items:center;justify-content:center;background:#0A3A3A">${sized(icon, 120, 120)}</div>`,
      310, 150, path.join(appx, 'Wide310x150Logo.png'), false);
  } finally {
    await browser.close();
  }

  const png = fs.readFileSync(path.join(pub, 'icon.png'));
  const ico = png2icons.createICO(png, png2icons.BICUBIC, 0, false, true);
  const icns = png2icons.createICNS(png, png2icons.BICUBIC, 0);
  if (!ico || !icns) throw new Error('icon conversion failed');
  fs.writeFileSync(path.join(pub, 'icon.ico'), ico);
  fs.writeFileSync(path.join(pub, 'icon.icns'), icns);
  console.log('wrote icon.ico, icon.icns');
})().catch((e) => { console.error(e); process.exit(1); });

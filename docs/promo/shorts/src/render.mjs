// Deterministic frame renderer: node render.mjs <scene> [--only f,f,f] [--every N]
// Needs playwright-core (NODE_PATH or a node_modules next to this file) and system Chrome.
// Output: $OUT_DIR/<scene>/frames/f0000.jpg … and events.json (sound/UI events for audio.py).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");

const FPS = 30;
const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const name = args[0];
if (!name) { console.error("usage: node render.mjs <scene> [--only f,f] [--every N]"); process.exit(2); }
const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",").map(Number) : null;
const every = args.includes("--every") ? Number(args[args.indexOf("--every") + 1]) : 1;
const outRoot = process.env.OUT_DIR || path.join(here, "out");
const out = path.join(outRoot, name);
const frames = path.join(out, "frames");
fs.rmSync(frames, { recursive: true, force: true });
fs.mkdirSync(frames, { recursive: true });

const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const browser = await chromium.launch({
  executablePath: fs.existsSync(chromePath) ? chromePath : undefined, channel: fs.existsSync(chromePath) ? undefined : "chrome",
  headless: true,
  args: ["--allow-file-access-from-files", "--autoplay-policy=no-user-gesture-required", "--force-device-scale-factor=1",
         "--disable-features=IsolateOrigins,site-per-process", "--font-render-hinting=none", "--lang=en-US"],
});
const ctx = await browser.newContext({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1, locale: "en-US", timezoneId: "Europe/Berlin" });
const page = await ctx.newPage();
page.on("pageerror", e => console.error("PAGE ERROR", e.message));
page.on("console", m => { if (m.type() === "error" && !/Tahoma|fonts.googleapis|ERR_|favicon/.test(m.text())) console.error("CONSOLE", m.text()); });

// The landing page asks GitHub for the latest release; answer offline with the real v1.1.1 asset list.
const release = JSON.parse(fs.readFileSync(path.join(here, "release-latest.json"), "utf8"));
await ctx.route(/api\.github\.com\/repos\/.*\/releases\/latest/, r => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(release) }));
// No live network dependencies inside the app frames (twemoji CDN, Google Fonts): fail fast.
await ctx.route(/fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net|googletagmanager|google-analytics/, r => r.abort());

await page.addInitScript({ path: path.join(here, "shim.js") });
await page.clock.install({ time: new Date("2026-10-13T19:04:00+02:00") });
await page.goto(pathToFileURL(path.join(here, "stage.html")).href + "?scene=" + encodeURIComponent(name));
await page.waitForFunction(() => typeof window.__step === "function", null, { timeout: 15000 });
await page.evaluate(() => document.fonts.ready);

async function settle(maxMs = 6000) {
  // let React flush (MessageChannel task after its own) and wait for loading iframes / QR generation
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const busy = await page.evaluate(() => window.__busy());
    if (!busy) break;
    await new Promise(r => setTimeout(r, 25));
  }
  await page.evaluate(() => new Promise(r => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); }));
  await page.evaluate(() => new Promise(r => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); }));
}
await settle(10000);
// the app's own first renders (status poll, chat list) need a little fake time before frame 0
await page.clock.runFor(120);
await settle();

const meta = await page.evaluate(() => window.__meta);
const N = Math.round(FPS * meta.dur);
console.log(name, "dur", meta.dur, "frames", N);

const t0 = Date.now();
for (let f = 0; f < N; f++) {
  await page.evaluate(f => window.__step(f), f);
  await page.clock.runFor(f % 3 === 2 ? 34 : 33);
  await settle();
  // layout again: actions may have created windows after the first layout of this frame
  await page.evaluate(f => window.__step.relayout && window.__step.relayout(f), f);
  const save = only ? only.includes(f) : (f % every === 0);
  if (save) await page.screenshot({ path: path.join(frames, `f${String(f).padStart(4, "0")}.jpg`), type: "jpeg", quality: 94 });
  if (f % 150 === 0) console.log("frame", f, ((Date.now() - t0) / 1000).toFixed(1) + "s");
}
const events = await page.evaluate(() => window.__events);
fs.writeFileSync(path.join(out, "events.json"), JSON.stringify({ name, dur: meta.dur, audio: meta.audio, events }));
console.log("events", events.length, "done in", ((Date.now() - t0) / 1000).toFixed(1) + "s");
await browser.close();

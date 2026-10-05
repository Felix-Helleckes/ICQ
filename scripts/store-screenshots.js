/**
 * Store listing screenshots (1280x800) from the *store build* in build/, filled with
 * invented demo data — no real contacts, no third-party logos.
 *
 *   node scripts/build-store.js renderer     # store renderer into build/
 *   node scripts/store-screenshots.js        # -> store/screenshots/*.png
 *
 * The renderer talks to Electron through window.api; here a stub with made-up chats
 * replaces it, then the contact list and a chat window are captured and composed onto
 * a branded canvas. Run `npm run build` again afterwards for regular builds/E2E, because
 * the store build overwrites build/.
 */
/* global window */ // installStub() runs inside the page, not in Node
const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');

const root = path.join(__dirname, '..');
const buildIndex = 'file://' + path.join(root, 'build', 'index.html').replace(/\\/g, '/');
const outDir = path.join(root, 'store', 'screenshots');

const now = Math.floor(Date.now() / 1000);
const min = (n) => now - n * 60;

function initials(name) { return name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase(); }
function avatar(name, hue) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="hsl(${hue} 45% 42%)"/><text x="32" y="41" font-family="Arial" font-size="26" font-weight="700" text-anchor="middle" fill="#fff">${initials(name)}</text></svg>`;
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}

const WA_CHATS = [
  { id: 'demo-mia', name: 'Mia Sommer', lastMessage: 'Treffen wir uns um sieben?', timestamp: min(2), unreadCount: 2, isGroup: false, avatar: avatar('Mia Sommer', 330) },
  { id: 'demo-familie', name: 'Familie', lastMessage: 'Oma: Der Kuchen ist fertig 🎂', timestamp: min(9), unreadCount: 5, isGroup: true, avatar: avatar('Familie', 25) },
  { id: 'demo-jonas', name: 'Jonas Berg', lastMessage: 'Danke dir, bis später!', timestamp: min(34), unreadCount: 0, isGroup: false, avatar: avatar('Jonas Berg', 200) },
  { id: 'demo-lena', name: 'Lena Wolf', lastMessage: 'Foto kommt gleich', timestamp: min(75), unreadCount: 0, isGroup: false, avatar: avatar('Lena Wolf', 150) },
  { id: 'demo-crew', name: 'Wochenend-Crew', lastMessage: 'Wer bringt die Boxen mit?', timestamp: min(140), unreadCount: 0, isGroup: true, avatar: avatar('Wochenend Crew', 270) },
  { id: 'demo-tom', name: 'Tom Fischer', lastMessage: 'Passt, machen wir so.', timestamp: min(300), unreadCount: 0, isGroup: false, avatar: avatar('Tom Fischer', 95) },
];
const TG_CHATS = [
  { id: 'demo-nora', name: 'Nora Lindner', lastMessage: 'Schau mal, das Konzert ist im Mai!', timestamp: min(6), unreadCount: 1, isGroup: false, avatar: avatar('Nora Lindner', 300) },
  { id: 'demo-lesekreis', name: 'Lesekreis', lastMessage: 'Nächstes Buch: Kapitel 1–5', timestamp: min(48), unreadCount: 0, isGroup: true, avatar: avatar('Lese Kreis', 40) },
  { id: 'demo-ben', name: 'Ben Keller', lastMessage: 'Läuft. Ich melde mich morgen.', timestamp: min(190), unreadCount: 0, isGroup: false, avatar: avatar('Ben Keller', 210) },
];
const MESSAGES = [
  { id: 'm1', body: 'Hast du heute Abend schon etwas vor?', fromMe: false, timestamp: min(41), type: 'chat' },
  { id: 'm2', body: 'Noch nichts. Was schwebt dir vor?', fromMe: true, timestamp: min(40), ack: 3, type: 'chat' },
  { id: 'm3', body: 'Neues Lieblingsrestaurant, Tisch für zwei? 🍝', fromMe: false, timestamp: min(38), type: 'chat' },
  { id: 'm4', body: 'Klingt super. Ich reserviere gleich.', fromMe: true, timestamp: min(36), ack: 3, type: 'chat' },
  { id: 'm5', body: 'Treffen wir uns um sieben?', fromMe: false, timestamp: min(2), type: 'chat' },
  { id: 'm6', body: 'Perfekt, bis dann! ✿', fromMe: true, timestamp: min(1), ack: 2, type: 'chat' },
];

const MESSAGES_TG = [
  { id: '101', body: 'Hast du schon gesehen, wer im Mai spielt?', fromMe: false, timestamp: min(30), type: 'chat' },
  { id: '102', body: 'Nein, erzähl!', fromMe: true, timestamp: min(29), ack: 3, type: 'chat' },
  { id: '103', body: 'Die Band von letztem Sommer, wieder bei uns in der Stadt.', fromMe: false, timestamp: min(27), type: 'chat' },
  { id: '104', body: 'Starker Tipp. Kauf mir gleich eine Karte mit.', fromMe: true, timestamp: min(25), ack: 3, type: 'chat' },
  { id: '105', body: 'Schau mal, das Konzert ist im Mai!', fromMe: false, timestamp: min(6), type: 'chat' },
  { id: '106', body: 'Ich bin dabei. ✿', fromMe: true, timestamp: min(5), ack: 2, type: 'chat' },
];

// Runs in the page before any app code: replaces the Electron bridge with demo data.
function installStub({ wa, tg, messages, skin }) {
  const noopUnsub = () => () => {};
  const wrap = (obj) => new Proxy(obj, {
    get(t, k) {
      if (k in t) return t[k];
      if (typeof k !== 'string') return undefined;
      return /^on[A-Z]/.test(k) ? noopUnsub : () => Promise.resolve(null);
    },
  });
  window.api = wrap({
    wa: wrap({
      getStatus: () => Promise.resolve('ready'),
      getChats: () => Promise.resolve(wa),
      getMyProfile: () => Promise.resolve({ name: 'Alex Beispiel', avatar: null }),
      getMessages: () => Promise.resolve(messages),
      getSync: () => Promise.resolve(false),
      getParticipants: () => Promise.resolve([]),
    }),
    tg: wrap({
      getStatus: () => Promise.resolve('ready'),
      getDialogs: () => Promise.resolve(tg),
      getMe: () => Promise.resolve({ name: 'Alex Beispiel', avatar: null }),
      getMessages: () => Promise.resolve(messages),
      getParticipants: () => Promise.resolve([]),
    }),
    window: wrap({}),
    appVersion: '1.1.1',
    getStoredAvatar: () => Promise.resolve(null),
    getStoredParticipants: () => Promise.resolve([]),
  });
  try { window.localStorage.setItem('icq-skin', skin); window.localStorage.setItem('icq-sound', 'off'); } catch (e) { /* none */ }
}

const SHOTS = [
  { file: '1-alle-chats', skin: 'retro-teal', headline: 'Alle Chats in einem Fenster', sub: 'Kontaktliste und Gespräche im Retro-Look', service: 'whatsapp' },
  { file: '2-klassisch', skin: 'icq-green', headline: 'Klassisch hell, wie früher', sub: 'Mehrere Designs zur Auswahl', service: 'whatsapp' },
  { file: '3-blau', skin: 'msn-blue', headline: 'Dein Stil, dein Fenster', sub: 'Jedes Gespräch in einem eigenen Fenster', service: 'telegram' },
];

async function capture(browser, params, size, stub) {
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.addInitScript(installStub, stub);
  await page.goto(buildIndex + params);
  await page.waitForTimeout(900);
  const buf = await page.screenshot();
  await ctx.close();
  return 'data:image/png;base64,' + buf.toString('base64');
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const s of SHOTS) {
      const stub = { wa: WA_CHATS, tg: TG_CHATS, messages: s.service === 'telegram' ? MESSAGES_TG : MESSAGES, skin: s.skin };
      const list = await capture(browser, '', { width: 330, height: 600 }, stub);
      // The service tab is chosen by clicking, so capture the list page by hand for Telegram.
      let listImg = list;
      if (s.service === 'telegram') {
        const ctx = await browser.newContext({ viewport: { width: 330, height: 600 }, deviceScaleFactor: 2 });
        const page = await ctx.newPage();
        await page.addInitScript(installStub, stub);
        await page.goto(buildIndex);
        await page.waitForTimeout(500);
        await page.locator('.svc-tab').nth(1).click();
        await page.waitForTimeout(700);
        listImg = 'data:image/png;base64,' + (await page.screenshot()).toString('base64');
        await ctx.close();
      }
      const chatName = s.service === 'telegram' ? 'Nora Lindner' : 'Mia Sommer';
      const chat = await capture(browser,
        `?mode=chat&chatId=${s.service === 'telegram' ? 'demo-nora' : 'demo-mia'}&chatName=${encodeURIComponent(chatName)}&service=${s.service}&isGroup=0`,
        { width: 560, height: 600 }, stub);

      const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
      await page.setContent(`<!doctype html><meta charset="utf-8"><style>
        *{box-sizing:border-box} body{margin:0;width:1280px;height:800px;overflow:hidden;font-family:'Segoe UI',Arial,sans-serif;color:#F4FFFE;
          background:radial-gradient(900px 600px at 20% 0%,#1E9C97 0%,#0F5555 45%,#082C2C 100%)}
        h1{margin:0;position:absolute;left:0;right:0;top:46px;text-align:center;font-size:46px;font-weight:700;letter-spacing:.2px}
        p{margin:0;position:absolute;left:0;right:0;top:108px;text-align:center;font-size:22px;opacity:.82}
        .row{position:absolute;left:0;right:0;top:170px;display:flex;justify-content:center;gap:34px;align-items:flex-start}
        img{height:600px;border-radius:10px;box-shadow:0 22px 50px rgba(0,0,0,.45)}
      </style><h1>${s.headline}</h1><p>${s.sub}</p><div class="row"><img src="${listImg}"><img src="${chat}"></div>`);
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(outDir, `${s.file}.png`) });
      await page.close();
      console.log(`wrote store/screenshots/${s.file}.png`);
    }
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });

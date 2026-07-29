/**
 * WhatsApp bridge using whatsapp-web.js
 * Runs in the Electron main process.
 */
const { Client, LocalAuth } = require('whatsapp-web.js');
const { BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const { createConcurrencyLimiter } = require('./lib/concurrency');
const { waitForChats } = require('./lib/wa-chats');
const { resolveChromiumExecutable } = require('./lib/chromium-path');
const { mapChatEntry } = require('./lib/chat-entry');
const { mapMessageEntry, isBacklogMessage } = require('./lib/message-entry');

// Logging helper: append to temp startup log for easier debugging across restarts
const STARTUP_LOG = path.join(os.tmpdir(), 'icq-startup.log');
function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`;
  try { fs.appendFileSync(STARTUP_LOG, line + '\n'); } catch (e) {}
  try { console.log(...args); } catch (e) {}
}

let client = null;
let status = 'disconnected';
let currentQR = null;
let onAvatarCb = null;
let lastDataDir = null;
let lastClientId = null;
let loadingWatchdog = null;
let waRetryUsed = false;
let waManualLogout = false; // true only when logout() was explicitly called — prevents auto-reconnect
let readyAtSec = 0; // when the client last became ready — used to tag replayed backlog messages

const WA_LOADING_TIMEOUT_MS = 180000;     // 180s startup budget (packaged app + Chrome cold start)
const WA_POST_AUTH_TIMEOUT_MS = 90000;   // 90s post-auth: packaged apps need more time than dev

function broadcast(channel, data) {
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed()) w.webContents.send(channel, data);
  });
  // Notify main.js avatar cache if registered
  if (channel === 'wa:avatar' && onAvatarCb) onAvatarCb(data.id, data.avatar);
}

function clearLoadingWatchdog() {
  if (loadingWatchdog) {
    clearTimeout(loadingWatchdog);
    loadingWatchdog = null;
  }
}

function armLoadingWatchdog(reason) {
  clearLoadingWatchdog();
  // Use shorter timeout for post-auth (typically <5s), fallback to normal for startup
  const timeout = reason === 'post-auth' ? WA_POST_AUTH_TIMEOUT_MS : WA_LOADING_TIMEOUT_MS;
  loadingWatchdog = setTimeout(async () => {
    // Only recover when WA is still not ready and a client exists.
    if (!client || status === 'ready') return;
    if (waRetryUsed) {
      console.error(`[WA watchdog] still stuck after retry (${reason})`);
      status = 'error';
      broadcast('wa:status', 'error');
      return;
    }

    waRetryUsed = true;
    console.warn(`[WA watchdog] timeout (${reason}) -> retry init`);
    const stuckClient = client;
    client = null;
    await closeClientBrowser(stuckClient);
    currentQR = null;
    status = 'loading';
    broadcast('wa:status', 'loading');
    init(onAvatarCb, lastDataDir, { isRetry: true });
  }, timeout);
}

// Last resort — only for a browser that is STILL running after a graceful close.
// Never call this directly on a live client: see closeClientBrowser.
function hardKillClientBrowser(c) {
  try {
    const proc = c?.pupBrowser?.process?.();
    if (proc && !proc.killed && proc.exitCode === null) {
      log('WA teardown: browser still alive after graceful close -> SIGKILL');
      proc.kill('SIGKILL');
    }
  } catch (e) {}
}

// Close a client's browser, clean shutdown first.
//
// WhatsApp keeps its session credentials in Chrome's IndexedDB/LevelDB, which is
// flushed on close. Killing the process before that finishes corrupts the store and
// WhatsApp refuses the NEXT login ("Login zurzeit nicht möglich") until the session
// folder is deleted. So destroy() always gets a real window here. The kill is only
// the fallback for a hung browser — one that lingers holds the profile lock and
// makes the next start hang at "WhatsApp startet…".
async function closeClientBrowser(c, graceMs = 4500) {
  if (!c) return;
  try {
    await Promise.race([c.destroy(), new Promise(r => setTimeout(r, graceMs))]);
  } catch (e) { /* destroy throws when the page is already gone — fine */ }
  hardKillClientBrowser(c);
}

// A Chrome from a previous app run can outlive a fast exit (before-quit only waits
// 1.5s) and keep the profile locked — the main cause of a restart hanging forever.
// Kill ONLY processes whose command line references OUR session profile directory;
// the user's normal Chrome windows have a different profile and are never touched.
function killOrphanedChrome(dataDir) {
  return new Promise((resolve) => {
    if (!dataDir) return resolve();
    const marker = path.join(dataDir, 'whatsapp');
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(bound);
      log('WA init: orphan-chrome sweep done');
      resolve();
    };
    const bound = setTimeout(done, 9000); // absolute upper bound — never block startup
    try {
      if (process.platform === 'win32') {
        const esc = marker.replace(/'/g, "''");
        const cmd = `Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe' or Name = 'msedge.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${esc}') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
        const child = execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { timeout: 8000 }, () => done());
        child.on('error', () => done());
      } else {
        const esc = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const child = execFile('pkill', ['-f', esc], { timeout: 5000 }, () => done());
        child.on('error', () => done());
      }
    } catch (e) { done(); }
  });
}

function cleanupStaleSessionLocks(dataDir) {
  const lockNames = ['lockfile', 'SingletonLock', 'SingletonCookie', 'SingletonSocket', 'DevToolsActivePort'];
  const waDir = path.join(dataDir, 'whatsapp');
  // Clean all session-* subdirs (covers both default 'session' and clientId-based 'session-*')
  const dirsToClean = [];
  try {
    const entries = fs.readdirSync(waDir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory() && e.name.startsWith('session')) dirsToClean.push(path.join(waDir, e.name));
    }
  } catch (e) {}
  for (const sessionDir of dirsToClean) {
    for (const name of lockNames) {
      const fp = path.join(sessionDir, name);
      if (fs.existsSync(fp)) { try { fs.rmSync(fp, { force: true }); } catch (e) {} }
    }
  }
}

const WA_CONNECTED_STATES = new Set(['CONNECTED', 'OPENING', 'PAIRING']);

async function getClientStateSafe() {
  if (!client) return null;
  try {
    return await client.getState();
  } catch (e) {
    return null;
  }
}

function shouldReconnectOnError(err) {
  const text = String(err?.message || err || '').toLowerCase();
  if (!text) return false;
  return (
    text.includes('promise was collected') ||
    text.includes('target closed') ||
    text.includes('session closed') ||
    text.includes('execution context was destroyed') ||
    text.includes('protocol error') ||
    text.includes('not connected') ||
    text.includes('not ready') ||
    text.includes('evaluation failed')
  );
}

async function ensureOperationalForSend() {
  if (!client || status !== 'ready') {
    throw new Error('WhatsApp not ready');
  }
  const state = await getClientStateSafe();
  if (state && !WA_CONNECTED_STATES.has(String(state))) {
    throw new Error(`WhatsApp not connected (${state})`);
  }
}

function triggerRecovery(reason) {
  if (waManualLogout) return;
  console.warn('[WA recovery]', reason);
  status = 'loading';
  broadcast('wa:status', 'loading');
  reconnect(lastDataDir);
}

async function waitForReady(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (status === 'ready' && client) {
      const state = await getClientStateSafe();
      if (!state || WA_CONNECTED_STATES.has(String(state))) return true;
    }
    await new Promise(resolve => setTimeout(resolve, 450));
  }
  return false;
}

// For IDEMPOTENT operations only (archive, block, edit, delete): re-running them
// after a reconnect is harmless. Never use this for sending — see runSendOnce.
async function runWithRecovery(opName, handler) {
  await ensureOperationalForSend();
  try {
    return await handler();
  } catch (e) {
    if (!shouldReconnectOnError(e)) throw e;

    triggerRecovery(`${opName} failed: ${e?.message || e}`);
    const recovered = await waitForReady(35000);
    if (!recovered) throw e;

    await ensureOperationalForSend();
    return await handler();
  }
}

// Lightweight readiness gate for sends. Unlike ensureOperationalForSend it does NOT
// call getState() (another in-page round-trip that can hang) and, crucially, never
// triggers a reconnect. A send must never tear down the connection: doing so used to
// cascade — one flaky send reconnected the client, then every following send failed
// with "not ready" until it recovered, so sending looked completely broken.
function assertReadyToSend() {
  if (!client || !client.pupPage || status !== 'ready') throw new Error('WhatsApp not ready');
}

// All sends go through the library's client.sendMessage.
//
// It normalizes the options into the exact shape WhatsApp Web expects (parseVCards,
// isCaptionByUser, waitUntilMsgSent, media/sticker handling) before the in-page call
// spreads them into the outgoing message. Bypassing it and calling the in-page
// sendMessage directly with a hand-built options object produced messages that were
// added to the chat but never transmitted — stuck at ack 0, i.e. the clock icon.
//
// What we deliberately do NOT do here is retry, or trigger a reconnect:
//   - The library serializes the sent message afterwards (getMessageModel), and that
//     step can throw AFTER the message was already delivered. Retrying then sends it
//     a second time for real — the recipient sees two copies, unfixable.
//   - Tearing down the connection from a send error cascaded: every following send
//     failed with "not ready" until recovery finished, so sending looked dead.
// Real connection loss is still caught by the health check and the disconnect event.
// A failure the user can repeat beats a message they cannot take back.
async function runSendOnce(opName, handler) {
  assertReadyToSend();
  try {
    return await handler();
  } catch (e) {
    log('WA send failed', opName, String(e?.message || e));
    throw e;
  }
}

function getPlatformTag() {
  if (process.platform === 'win32') return 'win';
  if (process.platform === 'darwin') return 'mac';
  return 'linux';
}

function sanitizeToken(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'node';
}

function getDeviceIdentity() {
  const platform = getPlatformTag();
  const host = sanitizeToken(os.hostname());
  return {
    clientId: `retrogram-${platform}-${host}`,
  };
}

function resolveClientIdForLocalAuth(dataDir) {
  // If an existing session folder exists, reuse its clientId to preserve sessions across restarts.
  try {
    const waDir = path.join(dataDir, 'whatsapp');
    const entries = fs.readdirSync(waDir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name === 'session') return null; // legacy default session folder — no clientId
      if (e.name.startsWith('session-')) return e.name.slice('session-'.length);
    }
  } catch (e) {
    // ignore
  }
  // No existing session found: return a stable id based on platform only (avoid hostname volatility)
  return `retrogram-${getPlatformTag()}`;
}

function restoreFromBackups(dataDir) {
  try {
    const waDir = path.join(dataDir, 'whatsapp');
    if (!fs.existsSync(waDir)) return;
    const entries = fs.readdirSync(waDir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const name = e.name;
      const marker = '.corrupt-backup-';
      if (!name.includes(marker)) continue;
      // Original session folder name is the prefix before the marker
      const sessionFolder = name.split(marker)[0];
      const backupDir = path.join(waDir, name);
      const targetDefault = path.join(waDir, sessionFolder, 'Default');
      log('WA restore: found backup', backupDir, 'target', targetDefault);
      try {
        fs.mkdirSync(targetDefault, { recursive: true });
        const files = fs.readdirSync(backupDir, { withFileTypes: true });
        for (const f of files) {
          const src = path.join(backupDir, f.name);
          const dest = path.join(targetDefault, f.name.replace(/\s+/g, '_'));
          if (fs.existsSync(dest)) {
            log('WA restore: dest exists, skipping', dest);
            continue;
          }
          try { fs.renameSync(src, dest); log('WA restore: moved', src, '->', dest); } catch (e) { try { fs.copyFileSync(src, dest); fs.rmSync(src, { force: true }); log('WA restore: copied then removed', src, '->', dest); } catch (err) { log('WA restore: failed to move/copy', src, String(err)); } }
        }
        // After moving files, remove backup dir if empty
        try { const rem = fs.readdirSync(backupDir); if (rem.length === 0) fs.rmdirSync(backupDir); } catch (e) {}
        broadcast('wa:backup-restored', { sessionFolder, path: targetDefault });
      } catch (e) { log('WA restore error', String(e)); }
    }
  } catch (e) { log('WA restore scan error', String(e)); }
}

// Find a usable Chrome/Edge/Chromium on the host system.
// Priority: 1. bundled extraResources chrome, 2. system Chrome/Edge, 3. puppeteer cache (dev)
function ensureExecutable(filePath) {
  if (!filePath || process.platform === 'win32') return filePath;
  try { fs.chmodSync(filePath, 0o755); } catch (e) {}
  return filePath;
}

function findChromiumExecutable() {
  const exe = resolveChromiumExecutable({
    platform: process.platform,
    resourcesPath: process.resourcesPath,
    env: process.env,
    existsSync: fs.existsSync,
    readdirSync: fs.readdirSync,
    puppeteerPath: () => {
      try { return require('puppeteer').executablePath?.() || null; } catch (e) { return null; }
    },
  });
  if (!exe && process.platform === 'darwin') {
    console.error('[WA init] Kein Google Chrome auf macOS gefunden! Bitte Chrome installieren.');
  }
  return exe ? ensureExecutable(exe) : null;
}

async function init(avatarCallback, dataDir, opts = {}) {
  const { isRetry = false } = opts;
  if (avatarCallback) onAvatarCb = avatarCallback;
  lastDataDir = dataDir;
  if (!isRetry) waRetryUsed = false;

  clearLoadingWatchdog();
  status = 'loading';
  broadcast('wa:status', 'loading');

  // Attempt to restore any previous corrupt-backup files before cleaning locks
  restoreFromBackups(dataDir);

  // Sweep Chrome processes a previous run left behind BEFORE touching lock files —
  // deleting SingletonLock while the old Chrome still lives corrupts the profile.
  await killOrphanedChrome(dataDir);

  // Setup installs keep persistent AppData state; stale Chromium lock files can block startup.
  cleanupStaleSessionLocks(dataDir);

  const executablePath = findChromiumExecutable();

  if (!executablePath && process.platform === 'linux') {
    status = 'error';
    currentQR = null;
    clearLoadingWatchdog();
    broadcast('wa:status', 'error');
    console.error('[WA init] No Chrome/Chromium executable found on Linux. Install chromium or google-chrome and restart.');
    return;
  }

  const isMac = process.platform === 'darwin';
  const resolvedClientId = resolveClientIdForLocalAuth(dataDir);
  lastClientId = resolvedClientId;

  const localAuthOpts = { dataPath: path.join(dataDir, 'whatsapp') };
  if (resolvedClientId) localAuthOpts.clientId = resolvedClientId;

  // Log init details for debugging session reuse issues
  try {
    const sessionFolder = resolvedClientId ? `session-${resolvedClientId}` : 'session';
    log('WA init', { dataDir, resolvedClientId, sessionFolder, executablePath: executablePath || null });
  } catch (e) { log('WA init log error', String(e)); }

  client = new Client({
    authStrategy: new LocalAuth(localAuthOpts),
    puppeteer: {
      ...(executablePath ? { executablePath } : {}),
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        // --disable-gpu: needed on Windows + Linux for headless stability
        // On macOS with Chrome 112+ it causes post-auth rendering failures → skip on mac
        ...(!isMac ? ['--disable-gpu'] : []),
        '--disable-extensions',
        // --disable-background-networking blocks WhatsApp's post-QR WebSocket auth flow
        // Removed: causes QR scan to succeed but session never becomes ready
        '--disable-default-apps',
        '--disable-sync',
        '--disable-translate',
        '--metrics-recording-only',
        '--no-first-run',
        '--safebrowsing-disable-auto-update',
      ],
    },
  });

  client.on('qr', (qr) => {
    currentQR = qr;
    status = 'qr';
    clearLoadingWatchdog();
    broadcast('wa:qr', qr);
    log('WA event', 'qr-generated');
  });

  client.on('authenticated', () => {
    // After QR scan/auth, WA can still hang before ready in rare cases.
    status = 'loading';
    broadcast('wa:status', 'loading');
    armLoadingWatchdog('post-auth');
    log('WA event', 'authenticated');
  });

  // Offline sync progress (0→100). Logged so a stuck initial sync is visible in
  // icq-startup.log — the 'ready' event only fires once this completes.
  try {
    client.on('loading_screen', (percent, message) => {
      log('WA event', 'loading_screen', { percent, message });
    });
  } catch (e) { /* older whatsapp-web.js without the event */ }

  client.on('ready', () => {
    status = 'ready';
    currentQR = null;
    readyAtSec = Math.floor(Date.now() / 1000);
    clearLoadingWatchdog();
    broadcast('wa:status', 'ready');
    broadcast('wa:ready', { name: client.info?.pushname });
    startHealthCheck();
    log('WA event', 'ready', { pushname: client.info?.pushname });
  });

  client.on('message', async (msg) => {
    // Messages sent/received while the app was closed get replayed by the sync
    // right after startup. Tag them so the UI can skip sounds and unread bumps —
    // and don't eagerly download their media (a burst of 50 replays used to
    // hammer the page; media loads when the chat is opened).
    const isBacklog = isBacklogMessage(msg.timestamp, readyAtSec);
    let mediaData = null;
    if (!isBacklog && msg.hasMedia && (msg.type === 'sticker' || msg.type === 'image' || msg.type === 'video' || msg.type === 'ptt' || msg.type === 'audio')) {
      try {
        const media = await msg.downloadMedia();
        if (media) mediaData = `data:${media.mimetype};base64,${media.data}`;
      } catch (e) { /* ignore download errors */ }
    }
    broadcast('wa:message', {
      from: msg.from,
      to: msg.to,
      body: msg.body || '',
      timestamp: msg.timestamp,
      id: msg.id._serialized,
      type: msg.type,
      isGif: msg.isGif || false,
      fromMe: msg.fromMe,
      ack: msg.ack ?? 0,
      mediaData,
      isBacklog,
    });
    // Also emit a chat-update so the UI can react immediately (ordering, lastMessage, archived)
    // NOTE: no archived lookup here. This fires on EVERY incoming message and used
    // to call getChatById() — i.e. a groupMetadata network round-trip per group
    // message, which throttled the whole client. The sidebar updates from
    // 'wa:message'; archived state comes from the chat list.
    try {
      const chatId = msg.from || msg.to;
        broadcast('wa:chat-update', {
          id: chatId,
          lastMessage: msg.body || '',
          timestamp: msg.timestamp || Math.floor(Date.now()/1000),
          unreadCount: undefined,
          isGroup: msg.isGroup || false,
        });
    } catch (e) {}
  });

  // Ausgehende Nachrichten (eigene) auch broadcasten für Badge-Update
  client.on('message_create', async (msg) => {
    if (!msg.fromMe) return;
    broadcast('wa:message', {
      from: msg.from,
      to: msg.to,
      body: msg.body || '',
      timestamp: msg.timestamp,
      id: msg.id._serialized,
      type: msg.type,
      fromMe: true,
      ack: msg.ack ?? 0,
      mediaData: null,
      isBacklog: isBacklogMessage(msg.timestamp, readyAtSec),
    });
    try {
      const chatId = msg.to || msg.from;
        broadcast('wa:chat-update', {
          id: chatId,
          lastMessage: msg.body || '',
          timestamp: msg.timestamp || Math.floor(Date.now()/1000),
          unreadCount: 0,
          isGroup: msg.isGroup || false,
        });
    } catch (e) {}
  });

  // Ack-Updates (gesendet/zugestellt/gelesen)
  client.on('message_ack', (msg, ack) => {
    broadcast('wa:ack', { id: msg.id._serialized, ack });
  });

  // Tipp-Indikator
  client.on('contact_changed', () => {}); // keep alive
  try {
    client.on('typing', ({ chatId }) => broadcast('wa:typing', { chatId, typing: true }));
    client.on('stop_typing', ({ chatId }) => broadcast('wa:typing', { chatId, typing: false }));
  } catch (e) { /* older whatsapp-web.js versions may not have these events */ }

  client.on('disconnected', (reason) => {
    clearLoadingWatchdog();
    console.warn('[WA disconnected]', reason);
    log('WA event', 'disconnected', reason);
    if (waManualLogout) {
      // User explicitly logged out — don't reconnect
      status = 'disconnected';
      currentQR = null;
      broadcast('wa:status', 'disconnected');
      return;
    }
    // Auto-reconnect: destroy old client and re-initialize after short delay
    status = 'loading';
    broadcast('wa:status', 'loading');
    const oldClient = client;
    client = null;
    currentQR = null;
    setTimeout(async () => {
      await closeClientBrowser(oldClient);
      if (!waManualLogout) {
        waRetryUsed = false;
        init(onAvatarCb, lastDataDir);
      }
    }, 3000);
  });

  client.on('auth_failure', (msg) => {
    console.error('[WA auth_failure]', msg);
    log('WA event', 'auth_failure', msg);
    clearLoadingWatchdog();
    // Attempt safe recovery: move suspicious storage files to a backup folder instead of deleting them.
    try {
      const sessionBase = path.join(lastDataDir, 'whatsapp');
      const sessionFolder = lastClientId ? `session-${lastClientId}` : 'session';
      const sessionDir = path.join(sessionBase, sessionFolder, 'Default');
      if (fs.existsSync(sessionDir)) {
        const backupDir = path.join(sessionBase, `${sessionFolder}.corrupt-backup-${Date.now()}`);
        fs.mkdirSync(backupDir, { recursive: true });
        const files = ['Cookies', 'Local Storage', 'Session Storage', 'IndexedDB'];
        files.forEach(f => {
          const fp = path.join(sessionDir, f);
          if (!fs.existsSync(fp)) return;
          try {
            const dest = path.join(backupDir, f.replace(/\s+/g, '_'));
            fs.renameSync(fp, dest);
            log('WA auth_failure: moved', fp, '->', dest);
          } catch (e) {
            try { fs.rmSync(fp, { recursive: true, force: true }); log('WA auth_failure: removed fallback', fp); } catch (err) { log('WA auth_failure: remove failed', fp, String(err)); }
          }
        });
        log('WA auth_failure: backup created', backupDir);
      }
    } catch (e) { log('WA auth_failure cleanup error', String(e)); }
    // Reinit to show QR again instead of stuck error screen. The failed client was
    // previously just dropped (client = null) — its Chrome kept running and held
    // the profile lock. Destroy + hard-kill it before re-initializing.
    const failedClient = client;
    client = null;
    currentQR = null;
    waRetryUsed = false;
    status = 'loading';
    broadcast('wa:status', 'loading');
    (async () => { await closeClientBrowser(failedClient); })();
    setTimeout(() => init(onAvatarCb, lastDataDir), 2000);
  });

  armLoadingWatchdog('startup');
  client.initialize().catch((err) => {
    status = 'error';
    clearLoadingWatchdog();
    broadcast('wa:status', 'error');
    console.error('[WA initialize error]', err.message || err);
  });
}

async function getQR() { return currentQR; }
function getStatus() {
  return status;
}

// Background health check — runs every 30s, never blocks the poll path.
let healthCheckTimer = null;
function startHealthCheck() {
  if (healthCheckTimer) return;
  healthCheckTimer = setInterval(async () => {
    if (status !== 'ready') return;
    if (!client) { triggerRecovery('ready-without-client'); return; }
    const state = await getClientStateSafe();
    if (state && !WA_CONNECTED_STATES.has(String(state))) {
      triggerRecovery(`health-check state=${state}`);
    }
  }, 30000);
}
function stopHealthCheck() {
  if (healthCheckTimer) { clearInterval(healthCheckTimer); healthCheckTimer = null; }
}

// Fast, metadata-free chat list read straight from the WhatsApp store.
//
// whatsapp-web.js's getChats() serializes every chat through getChatModel, which
// for GROUPS awaits a network groupMetadata.update() and touches newer WA-Web
// modules. That is both slow (a round-trip per group) and throws on some builds —
// and because the library wraps it all in one Promise.all, a single bad chat blanks
// the entire list. The contact list needs none of that: just id, title, last
// message, unread count and archived. Reading those fields directly is fast and
// cannot fail on the group-metadata path. Group metadata is fetched lazily, only
// when a group chat is actually opened.
async function fetchChatsLight() {
  if (!client || !client.pupPage) return { chats: [], skipped: 0, error: 'no-page' };
  return client.pupPage.evaluate(() => {
    const out = { chats: [], skipped: 0, error: null };
    let coll;
    try {
      coll = window.require('WAWebCollections').Chat.getModelsArray();
    } catch (e) {
      out.error = 'collection: ' + ((e && e.message) || String(e));
      return out;
    }
    for (const chat of coll) {
      try {
        const id = chat && chat.id ? chat.id._serialized : null;
        if (!id) { out.skipped += 1; continue; }
        let title = null;
        try { title = chat.formattedTitle || null; } catch (e) {}
        // Last-message preview: resolve via lastReceivedKey against the global Msg
        // collection (what the library does), because a chat's own msgs buffer is
        // empty until that chat has been opened — which would leave most previews
        // blank right after login. Falls back to the buffer, and stays fully
        // synchronous (no network) either way.
        let last = null;
        try {
          const key = chat.lastReceivedKey;
          const serialized = key && (key._serialized || key);
          if (serialized) {
            const m = window.require('WAWebCollections').Msg.get(String(serialized));
            if (m && !m.isNotification) last = { body: m.body || m.caption || '', t: m.t || 0 };
          }
        } catch (e) {}
        if (!last) {
          try {
            const arr = (chat.msgs && chat.msgs.getModelsArray) ? chat.msgs.getModelsArray() : [];
            for (let i = arr.length - 1; i >= 0; i -= 1) {
              const m = arr[i];
              if (m && !m.isNotification) { last = { body: m.body || m.caption || '', t: m.t || 0 }; break; }
            }
          } catch (e) {}
        }
        out.chats.push({
          id: { _serialized: id },
          name: title,
          formattedTitle: title,
          lastMessage: last,
          unreadCount: (() => { try { return chat.unreadCount || 0; } catch (e) { return 0; } })(),
          isGroup: String(id).endsWith('@g.us'),
          archive: (() => { try { return !!chat.archive; } catch (e) { return false; } })(),
          t: (() => { try { return chat.t || 0; } catch (e) { return 0; } })(),
        });
      } catch (e) { out.skipped += 1; }
    }
    return out;
  });
}

async function getChats() {
  if (status !== 'ready') return [];

  // Primary: the fast metadata-free read. Only if that yields nothing (store shape
  // moved) do we pay for the library's heavyweight path. On a fresh login the store
  // fills gradually after 'ready', so wrap it in a bounded wait that returns as soon
  // as chats appear.
  const attempt = async () => {
    const light = await fetchChatsLight().catch(e => ({ chats: [], skipped: 0, error: String(e?.message || e) }));
    if (light?.error) log('WA getChats light error', light.error);
    if (light?.chats?.length) {
      if (light.skipped) log('WA getChats light skipped', { skipped: light.skipped });
      return light.chats;
    }
    try {
      const chats = await client.getChats();
      log('WA getChats via library', { count: chats?.length || 0 });
      return Array.isArray(chats) ? chats : [];
    } catch (e) {
      log('WA getChats library threw', String(e?.message || e));
      return [];
    }
  };

  const chats = await waitForChats(attempt, () => status === 'ready', { deadlineMs: 20000, intervalMs: 700 });
  log('WA getChats result', { count: chats.length });

  // Return base data only (no avatars). Profile pictures are loaded lazily and
  // throttled by getContactAvatar so they never compete with this first sync.
  return chats.slice(0, 100).map(mapChatEntry);
}

// Defensive message fetch that runs inside the page and NEVER calls getChatModel
// (getAsModel:false), so group chats whose metadata sync fails still return their
// messages. Mirrors whatsapp-web.js's own fetchMessages internals.
//
// Two modes:
//   - count-based (`limit`): page back until we have N messages. Used by the cheap
//     periodic reconcile.
//   - time-based (`sinceTs` > 0): page back until the history actually reaches that
//     timestamp — that is what makes "the last 3 days" real instead of a fixed 30.
//     Bounded by `maxCount` (busy groups) and never returns fewer than `minCount`
//     (a quiet chat still shows history older than the window).
async function fetchMessagesRaw(chatId, opts = {}) {
  if (!client || !client.pupPage) return { messages: [], error: 'no-page' };
  const sinceTs = Number(opts.sinceTs) || 0;
  const limit = Number(opts.limit) || 30;
  const maxCount = Number(opts.maxCount) || 300;
  const minCount = Number(opts.minCount) || 25;
  return client.pupPage.evaluate(async (chatId, sinceTs, limit, maxCount, minCount) => {
    const out = { messages: [], error: null, pages: 0 };
    const keep = (m) => m && !m.isNotification;
    let chat;
    try {
      chat = await window.WWebJS.getChat(chatId, { getAsModel: false });
    } catch (e) { out.error = 'getChat: ' + ((e && e.message) || String(e)); return out; }
    if (!chat) { out.error = 'chat-not-found'; return out; }

    let msgs = [];
    try { msgs = chat.msgs.getModelsArray().filter(keep); } catch (e) { out.error = 'msgs: ' + ((e && e.message) || String(e)); }
    out.buffered = msgs.length; // chat-list sync keeps only the preview message here

    const oldestT = () => {
      let o = Infinity;
      for (const m of msgs) { const t = m.t || 0; if (t && t < o) o = t; }
      return o;
    };
    const target = sinceTs > 0 ? maxCount : limit;

    // Paging strategies. whatsapp-web.js calls loadEarlierMsgs({ chat }); WhatsApp
    // Web's module API drifts, so when that yields nothing we try the older direct
    // signature, the chat model's own method, and finally scan the module for any
    // loadEarlier-style function. The first strategy that returns messages is
    // locked in for the remaining pages; every failure is recorded for the log.
    out.attempts = [];
    out.strategy = null;
    const strategies = [
      ['module-obj', async () => window.require('WAWebChatLoadMessages').loadEarlierMsgs({ chat })],
      ['module-direct', async () => window.require('WAWebChatLoadMessages').loadEarlierMsgs(chat)],
      ['chat-method', async () => (chat.loadEarlierMsgs ? chat.loadEarlierMsgs() : null)],
      ['module-scan', async () => {
        const mod = window.require('WAWebChatLoadMessages');
        for (const k of Object.keys(mod)) {
          if (!/loadearlier/i.test(k) || typeof mod[k] !== 'function' || k === 'loadEarlierMsgs') continue;
          try { const r = await mod[k]({ chat }); if (r && r.length) return r; } catch (e) {}
          try { const r = await mod[k](chat); if (r && r.length) return r; } catch (e) {}
        }
        return null;
      }],
    ];
    const loadOlder = async () => {
      if (out.strategy) {
        const s = strategies.find((x) => x[0] === out.strategy);
        try { return await s[1](); } catch (e) { return null; }
      }
      for (const [name, fn] of strategies) {
        try {
          const r = await fn();
          if (r && r.length) { out.strategy = name; return r; }
          out.attempts.push(name + ':empty');
        } catch (e) {
          out.attempts.push(name + ':' + ((e && e.message) || 'err').slice(0, 80));
        }
      }
      return null;
    };

    try {
      let guard = 0;
      while (guard < 40) {
        guard += 1;
        if (msgs.length >= target) break;
        // Time-based: stop once the history reaches past the cutoff and we have a
        // sane minimum. Otherwise keep paging backwards.
        if (sinceTs > 0 && msgs.length >= minCount && oldestT() <= sinceTs) break;
        const loaded = await loadOlder();
        if (!loaded || !loaded.length) break; // start of chat, or no strategy works
        out.pages += 1;
        msgs = [...loaded.filter(keep), ...msgs];
      }
    } catch (e) { /* keep whatever we already have */ }

    // When nothing paged, record what the module actually exposes — that pins the
    // API drift precisely in the startup log.
    if (!out.strategy && out.pages === 0) {
      try { out.attempts.push('keys:' + Object.keys(window.require('WAWebChatLoadMessages')).join('|').slice(0, 200)); }
      catch (e) { out.attempts.push('module-missing:' + ((e && e.message) || 'err').slice(0, 80)); }
    }

    msgs.sort((a, b) => (a.t || 0) - (b.t || 0));

    if (sinceTs > 0) {
      const recent = msgs.filter((m) => (m.t || 0) >= sinceTs);
      msgs = recent.length >= minCount ? recent : msgs.slice(-minCount);
      if (msgs.length > maxCount) msgs = msgs.slice(-maxCount);
    } else if (msgs.length > limit) {
      msgs = msgs.slice(-limit);
    }

    for (const m of msgs) {
      try { out.messages.push(window.WWebJS.getMessageModel(m)); } catch (e) { /* skip bad msg */ }
    }
    return out;
  }, chatId, sinceTs, limit, maxCount, minCount);
}

const MEDIA_MSG_TYPES = ['sticker', 'image', 'video', 'ptt', 'audio'];

// Download media for already-mapped message entries in the background and push each
// one to the UI as it lands. Uses getMessageById, which reads the message store
// directly (no chat model), so it works for group chats too. Sequential on purpose —
// this is background work and must not compete with the foreground.
function downloadMediaInBackground(entries) {
  const targets = (entries || []).filter(m => m.hasMedia && MEDIA_MSG_TYPES.includes(m.type));
  if (!targets.length) return;
  (async () => {
    for (const entry of targets) {
      if (status !== 'ready') return;
      try {
        const msg = await client.getMessageById(entry.id);
        if (!msg) continue;
        const media = await msg.downloadMedia();
        if (media) {
          broadcast('wa:media', { msgId: entry.id, mediaData: `data:${media.mimetype};base64,${media.data}` });
        }
      } catch (e) { /* ignore media load errors */ }
    }
  })();
}

async function getMessages(chatId, opts = {}) {
  if (status !== 'ready') return [];
  const limit = opts.limit ?? 30; // count-based fallback / reconcile depth

  // Primary: raw fetch. The library route (getChatById → fetchMessages) builds the
  // full chat model first — a groupMetadata.update() round-trip on every open that
  // also throws for groups on some WA-Web builds, which left the window empty. The
  // raw path skips the model entirely (getAsModel:false), so it is faster AND works
  // for groups. It also supports paging back to a timestamp (opts.sinceTs), which
  // the library API cannot do at all. Only if it yields nothing do we try the
  // library path.
  const raw = await fetchMessagesRaw(chatId, {
    sinceTs: opts.sinceTs,
    limit,
    maxCount: opts.maxCount,
    minCount: opts.minCount,
  }).catch(e => ({ messages: [], error: String(e?.message || e) }));
  if (raw?.error) log('WA getMessages raw error', chatId, raw.error);
  log('WA getMessages paging', {
    chatId,
    buffered: raw?.buffered ?? -1,
    pages: raw?.pages || 0,
    strategy: raw?.strategy || null,
    attempts: raw?.attempts?.length ? raw.attempts : undefined,
    count: raw?.messages?.length || 0,
  });

  let result = (raw?.messages || []).map(mapMessageEntry);

  // The chat-list sync leaves only the preview message in each chat's buffer, so a
  // result this small means paging didn't work (module drift) — not that the chat
  // is empty. Give the library path a shot and keep whichever found more.
  if (result.length < Math.min(limit, 10)) {
    try {
      const chat = await client.getChatById(chatId);
      const msgs = await chat.fetchMessages({ limit });
      const viaLib = msgs.map(mapMessageEntry);
      if (viaLib.length > result.length) {
        result = viaLib;
        log('WA getMessages via library', { chatId, count: result.length });
      }
    } catch (e) {
      log('WA getMessages library threw', chatId, String(e?.message || e));
    }
  }

  // Load media in background (don't block UI).
  if (!opts.skipMedia) downloadMediaInBackground(result);

  log('WA getMessages', { chatId, count: result.length });
  return result;
}

async function sendMessage(chatId, text, quotedMessageId = null) {
  return runSendOnce('sendMessage', async () => {
    // If the message contains a URL, disable automatic link preview generation to
    // avoid waiting for the preview fetch, which slows the send down.
    const options = {};
    if (/https?:\/\/\S+/i.test(String(text || ''))) options.linkPreview = false;
    if (quotedMessageId) options.quotedMessageId = quotedMessageId;
    await client.sendMessage(chatId, text, options);
    return true;
  });
}

async function markChatRead(chatId) {
  if (status !== 'ready') return;
  // client.sendSeen() resolves the chat with getAsModel:false — no groupMetadata
  // round-trip, unlike getChatById().sendSeen().
  try { await client.sendSeen(chatId); } catch (e) { /* ignore */ }
}

async function sendFile(chatId, filePath) {
  const { MessageMedia } = require('whatsapp-web.js');
  const media = MessageMedia.fromFilePath(filePath);
  return runSendOnce('sendFile', async () => {
    await client.sendMessage(chatId, media);
    return true;
  });
}

async function sendSticker(chatId, filePath) {
  const { MessageMedia } = require('whatsapp-web.js');
  const media = MessageMedia.fromFilePath(filePath);
  return runSendOnce('sendSticker', async () => {
    await client.sendMessage(chatId, media, { sendMediaAsSticker: true });
    return true;
  });
}

async function sendVoice(chatId, base64Data, mimeType) {
  return runSendOnce('sendVoice', async () => {
    const { MessageMedia } = require('whatsapp-web.js');
    const mt = mimeType || 'audio/ogg';
    const filename = mt.includes('ogg') ? 'voice.ogg' : 'voice.webm';
    const media = new MessageMedia(mt, String(base64Data || ''), filename);
    await client.sendMessage(chatId, media, { sendAudioAsVoice: true });
    return true;
  });
}

async function setArchive(chatId, archive) {
  return runWithRecovery('setArchive', async () => {
    try {
      if (archive) await client.archiveChat(chatId);
      else await client.unarchiveChat(chatId);
      // Broadcast the state we just set — re-reading it via getChatById() built the
      // full chat model, which threw for groups and silently skipped this update.
      broadcast('wa:chat-update', { id: chatId, archived: !!archive });
    } catch (e) { throw e; }
    return true;
  });
}

// Block / unblock a contact — propagates to WhatsApp servers via the
// linked-device protocol (the contact really gets blocked on your account).
async function setBlocked(contactId, blocked) {
  return runWithRecovery('setBlocked', async () => {
    const contact = await client.getContactById(contactId);
    if (!contact) throw new Error('Contact not found');
    if (blocked) await contact.block();
    else await contact.unblock();
    return true;
  });
}

async function isContactBlocked(contactId) {
  if (status !== 'ready') return false;
  try {
    const contact = await client.getContactById(contactId);
    return !!contact?.isBlocked;
  } catch (e) { return false; }
}

async function editMessage(chatId, messageId, newText) {
  return runWithRecovery('editMessage', async () => {
    if (!messageId) throw new Error('Missing message id');
    const msg = await client.getMessageById(messageId);
    if (!msg) throw new Error('Message not found');
    if (!msg.fromMe) throw new Error('Only own messages can be edited');
    await msg.edit(newText);
    return true;
  });
}

async function deleteMessage(chatId, messageId, forEveryone = true) {
  return runWithRecovery('deleteMessage', async () => {
    if (!messageId) throw new Error('Missing message id');
    const msg = await client.getMessageById(messageId);
    if (!msg) throw new Error('Message not found');
    if (!msg.fromMe) throw new Error('Only own messages can be deleted');
    await msg.delete(Boolean(forEveryone));
    return true;
  });
}

async function getMyProfile() {
  if (status !== 'ready') return null;
  try {
    const contact = await client.getContactById(client.info.wid._serialized);
    let avatar = null;
    try { avatar = await contact.getProfilePicUrl(); } catch (e) {}
    return { name: client.info.pushname || contact.pushname || contact.name, avatar };
  } catch (e) {
    return { name: client.info?.pushname || 'Me', avatar: null };
  }
}

async function getParticipants(chatId) {
  if (status !== 'ready') return [];
  try {
    const ch = await client.getChatById(chatId);
    const parts = [];
    // whatsapp-web.js may expose participants in several ways
    const list = ch?.participants || ch?.groupMetadata?.participants || [];
    for (const p of list) {
      try {
        // p can be Contact objects or IDs
        let id = null;
        if (p?.id) id = p.id?._serialized || p.id;
        else if (typeof p === 'string') id = p;
        else if (p?._serialized) id = p._serialized;
        if (!id) continue;
        const contact = await client.getContactById(id).catch(() => null);
        const isOnline = !!(contact?.isOnline || contact?.presence === 'online' || contact?.presence?.lastKnownPresence === 'online');
        parts.push({
          id: id,
          name: contact?.pushname || contact?.name || (contact ? `${contact?.number || ''}` : id),
          pushname: contact?.pushname || null,
          isAdmin: !!(p?.isAdmin || (p?.admin === true)),
          online: isOnline,
        });
      } catch (e) {}
    }
    return parts;
  } catch (e) { return []; }
}

// Profile-picture fetches all run inside WhatsApp's single headless page, so
// firing 100 of them at once (one per visible contact) stalls chat/message sync.
// Cap concurrency to keep avatar loading fully in the background.
const runAvatarTask = createConcurrencyLimiter(4);

async function getContactAvatar(id) {
  if (status !== 'ready') return null;
  return runAvatarTask(async () => {
    const contact = await client.getContactById(id);
    return await contact.getProfilePicUrl() || null;
  });
}

async function logout() {
  waManualLogout = true;
  clearLoadingWatchdog();
  const oldClient = client;
  try { await oldClient?.logout(); } catch (e) {}
  await closeClientBrowser(oldClient);
  client = null;
  status = 'disconnected';
  currentQR = null;
  broadcast('wa:status', 'disconnected');
  // After explicit logout, start a clean session init so QR login is immediately possible.
  setTimeout(() => {
    waManualLogout = false;
    reconnect(lastDataDir);
  }, 700);
}

async function shutdown() {
  stopHealthCheck();
  clearLoadingWatchdog();
  const c = client;
  client = null;
  // Generous grace window: Chrome must finish flushing the session store, otherwise
  // the next login is refused. before-quit allows 7s total, so 5s here leaves
  // headroom for the Telegram bridge and the final exit.
  await closeClientBrowser(c, 5000);
  status = 'disconnected';
}

function reconnect(dataDir) {
  stopHealthCheck();
  clearLoadingWatchdog();
  const oldClient = client;
  client = null;
  currentQR = null;
  waRetryUsed = false;
  waManualLogout = false;
  status = 'loading';
  broadcast('wa:status', 'loading');
  setTimeout(async () => {
    await closeClientBrowser(oldClient);
    init(onAvatarCb, dataDir || lastDataDir);
  }, 500);
}

module.exports = {
  init,
  getQR,
  getStatus,
  getChats,
  getMessages,
  sendMessage,
  sendFile,
  sendSticker,
  sendVoice,
  setArchive,
  setBlocked,
  isContactBlocked,
  editMessage,
  deleteMessage,
  markChatRead,
  getMyProfile,
  getContactAvatar,
  getParticipants,
  logout,
  reconnect,
  shutdown,
};

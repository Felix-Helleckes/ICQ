/**
 * Telegram bridge using GramJS (telegram npm package)
 * Runs in the Electron main process.
 * Supports both phone+code login AND QR code login (with optional 2FA).
 */
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const { BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const API_ID   = parseInt(process.env.TG_API_ID   || '0', 10);
const API_HASH =          process.env.TG_API_HASH  || '';

const SESSION_FILE = path.join(__dirname, '../data/telegram.session');

let tgClient = null;
let mainWin  = null;  // kept for compat but not used for sends
let status   = 'disconnected';
let phoneHash = null;
let pending2FAResolve = null;
let pending2FAReject  = null;

function broadcast(channel, data) {
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed()) w.webContents.send(channel, data);
  });
}

function loadSession() {
  try { return fs.readFileSync(SESSION_FILE, 'utf8').trim(); } catch { return ''; }
}
function saveSession(str) {
  fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
  fs.writeFileSync(SESSION_FILE, str, 'utf8');
}

async function init(win) {
  mainWin = win;
  if (!API_ID || !API_HASH) {
    console.warn('[Telegram] No API credentials set. Set TG_API_ID and TG_API_HASH env vars.');
    status = 'no-credentials';
    return;
  }

  const session = new StringSession(loadSession());
  tgClient = new TelegramClient(session, API_ID, API_HASH, {
    connectionRetries: 5,
  });

  await tgClient.connect();
  if (await tgClient.isUserAuthorized()) {
    status = 'ready';
    saveSession(tgClient.session.save());
    listenForMessages();
  } else {
    status = 'needs-auth';
  }
}

// ── Phone + code login ────────────────────────────────────────
async function requestCode(phone) {
  if (!tgClient) throw new Error('Telegram not initialized');
  const result = await tgClient.sendCode({ apiId: API_ID, apiHash: API_HASH }, phone);
  phoneHash = result.phoneCodeHash;
  return result.phoneCodeHash;
}

async function signIn(phone, code, hash) {
  await tgClient.signIn({ phoneNumber: phone, phoneCode: code, phoneCodeHash: hash || phoneHash });
  saveSession(tgClient.session.save());
  status = 'ready';
  listenForMessages();
  return { success: true };
}

// ── QR code login ─────────────────────────────────────────────
async function startQRLogin() {
  if (!tgClient) throw new Error('Telegram not initialized');
  status = 'qr';

  try {
    await tgClient.signInUserWithQrCode(
      { apiId: API_ID, apiHash: API_HASH },
      {
        // Called every time a new QR token is issued (~30s expiry)
        qrCode: async ({ token }) => {
          const tokenB64 = Buffer.from(token).toString('base64url');
          const qrLink   = `tg://login?token=${tokenB64}`;
          broadcast('tg:qr', qrLink);
        },
        password: async (hint) => {
          broadcast('tg:2fa-needed', { hint: hint || '' });
          return new Promise((resolve, reject) => {
            pending2FAResolve = resolve;
            pending2FAReject  = reject;
          });
        },
        onError: async (err) => {
          console.error('[TG QR]', err.message);
          // Return false = keep trying; true = stop
          return false;
        },
      }
    );

    saveSession(tgClient.session.save());
    status = 'ready';
    broadcast('tg:ready', {});
    listenForMessages();
  } catch (err) {
    status = 'needs-auth';
    throw err;
  }
}

// Called from IPC when the user submits their 2FA password
function submit2FA(password) {
  if (pending2FAResolve) {
    pending2FAResolve(password);
    pending2FAResolve = null;
    pending2FAReject  = null;
  }
}

function listenForMessages() {
  tgClient.addEventHandler(async (event) => {
    const msg = event.message;
    broadcast('tg:message', {
      chatId: msg.peerId?.channelId?.toString() || msg.peerId?.userId?.toString() || msg.chatId?.toString(),
      body: msg.message,
      fromMe: msg.out,
      timestamp: msg.date,
      id: msg.id?.toString(),
    });
  }, new NewMessage({}));
}

function getStatus() { return status; }

async function getDialogs() {
  if (status !== 'ready') return [];
  const dialogs = await tgClient.getDialogs({ limit: 50 });
  return dialogs.map(d => ({
    id: d.id?.toString(),
    name: d.name || d.title,
    lastMessage: d.message?.message || '',
    timestamp: d.message?.date || 0,
    unreadCount: d.unreadCount,
    isGroup: d.isGroup || d.isChannel,
  }));
}

async function getMessages(chatId) {
  if (status !== 'ready') return [];
  const messages = await tgClient.getMessages(chatId, { limit: 50 });
  return messages.map(m => ({
    id: m.id?.toString(),
    body: m.message,
    fromMe: m.out,
    timestamp: m.date,
    author: m.fromId?.userId?.toString() || '',
  }));
}

async function sendMessage(chatId, text) {
  if (status !== 'ready') throw new Error('Telegram not ready');
  await tgClient.sendMessage(chatId, { message: text });
}

module.exports = { init, requestCode, signIn, startQRLogin, submit2FA, getStatus, getDialogs, getMessages, sendMessage };

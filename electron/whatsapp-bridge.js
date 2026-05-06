/**
 * WhatsApp bridge using whatsapp-web.js
 * Runs in the Electron main process.
 */
const { Client, LocalAuth } = require('whatsapp-web.js');
const { BrowserWindow } = require('electron');

let client = null;
let status = 'disconnected';
let currentQR = null;
let onAvatarCb = null;

function broadcast(channel, data) {
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed()) w.webContents.send(channel, data);
  });
  // Notify main.js avatar cache if registered
  if (channel === 'wa:avatar' && onAvatarCb) onAvatarCb(data.id, data.avatar);
}

function init(avatarCallback) {
  if (avatarCallback) onAvatarCb = avatarCallback;
  status = 'loading';
  broadcast('wa:status', 'loading');

  client = new Client({
    authStrategy: new LocalAuth({ dataPath: './data/whatsapp' }),
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-background-networking',
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
    broadcast('wa:qr', qr);
  });

  client.on('ready', () => {
    status = 'ready';
    currentQR = null;
    broadcast('wa:ready', { name: client.info?.pushname });
  });

  client.on('message', async (msg) => {
    let mediaData = null;
    if (msg.hasMedia && (msg.type === 'sticker' || msg.type === 'image' || msg.type === 'video')) {
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
    });
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
    });
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

  client.on('disconnected', () => { status = 'disconnected'; });

  client.initialize().catch(console.error);
}

async function getQR() { return currentQR; }
function getStatus() { return status; }

async function getChats() {
  if (status !== 'ready') return [];
  const chats = await client.getChats();
  // Sofort die Basisdaten zurückgeben (ohne Avatare)
  const result = chats.slice(0, 50).map(c => ({
    id: c.id._serialized,
    name: c.name,
    lastMessage: c.lastMessage?.body || '',
    timestamp: c.lastMessage?.timestamp || 0,
    unreadCount: c.unreadCount,
    isGroup: c.isGroup,
    avatar: null,
  }));
  // Avatare im Hintergrund nachladen und einzeln broadcasten
  (async () => {
    for (const c of chats.slice(0, 50)) {
      try {
        const contact = await c.getContact();
        const pic = await contact.getProfilePicUrl();
        if (pic) broadcast('wa:avatar', { id: c.id._serialized, avatar: pic });
      } catch (e) { /* no pic */ }
    }
  })();
  return result;
}

async function getMessages(chatId) {
  if (status !== 'ready') return [];
  const chat = await client.getChatById(chatId);
  const msgs = await chat.fetchMessages({ limit: 50 });
  const result = await Promise.all(msgs.map(async m => {
    let mediaData = null;
    if (m.hasMedia && (m.type === 'sticker' || m.type === 'image' || m.type === 'video')) {
      try {
        const media = await m.downloadMedia();
        if (media) mediaData = `data:${media.mimetype};base64,${media.data}`;
      } catch (e) { /* ignore */ }
    }
    return {
      id: m.id._serialized,
      body: m.body || '',
      fromMe: m.fromMe,
      timestamp: m.timestamp,
      author: m.author || m.from,
      type: m.type,
      isGif: m.isGif || false,
      ack: m.ack ?? (m.fromMe ? 1 : -1),
      mediaData,
    };
  }));
  return result;
}

async function sendMessage(chatId, text) {
  if (status !== 'ready') throw new Error('WhatsApp not ready');
  await client.sendMessage(chatId, text);
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

async function getContactAvatar(id) {
  if (status !== 'ready') return null;
  try {
    const contact = await client.getContactById(id);
    return await contact.getProfilePicUrl() || null;
  } catch (e) { return null; }
}

async function logout() {
  try { await client.logout(); } catch (e) {}
  status = 'disconnected';
}

module.exports = { init, getQR, getStatus, getChats, getMessages, sendMessage, getMyProfile, getContactAvatar, logout };

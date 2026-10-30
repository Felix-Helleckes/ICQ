/**
 * Demo mode for App Review: both bridges replaced by invented chats.
 *
 * WhatsApp has no test accounts (linking always needs a phone scanning the QR),
 * and Apple asked for "a demo account or a demonstration mode". Signing in to
 * Telegram with DEMO_PHONE + DEMO_CODE switches the app here; nothing is sent to
 * WhatsApp or Telegram. Sending, receipts, replies, archiving, editing and deleting
 * all work on the demo data, so every screen can be reviewed.
 *
 * createDemo() returns { wa, tg } with the same surface as whatsapp-bridge.js and
 * telegram-bridge.js. `broadcast(channel, data)` reaches the renderer windows.
 */

const DEMO_PHONE = '+1 555 555 0123';
const DEMO_CODE = '24680';
const DEMO_HASH = 'retrogram-demo';

const digits = (s) => String(s || '').replace(/\D/g, '');
const isDemoPhone = (phone) => digits(phone) === digits(DEMO_PHONE);
const isDemoCode = (code) => digits(code) === DEMO_CODE;

function initials(name) {
  return name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}
function avatarFor(name, hue) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="hsl(${hue} 45% 42%)"/><text x="32" y="41" font-family="Arial" font-size="26" font-weight="700" text-anchor="middle" fill="#fff">${initials(name)}</text></svg>`;
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}

// [id, name, hue, isGroup, members, [[minutesAgo, fromMe, text, author?], ...]]
const WA_SEED = [
  ['demo-wa-mia', 'Mia Summer', 330, false, null, [
    [41, false, 'Any plans for tonight?'],
    [40, true, 'Nothing yet. What do you have in mind?'],
    [38, false, 'New favourite restaurant, table for two? 🍝'],
    [36, true, 'Sounds great. I will book it.'],
    [2, false, 'Meet at seven?'],
  ]],
  ['demo-wa-family', 'Family', 25, true, ['Grandma', 'Dad', 'Lea'], [
    [70, false, 'Who is coming on Sunday?', 'Dad'],
    [66, true, 'Count me in!'],
    [12, false, 'I am baking a cake 🎂', 'Grandma'],
    [9, false, 'The cake is ready!', 'Grandma'],
  ]],
  ['demo-wa-jonas', 'Jonas Berg', 200, false, null, [
    [50, true, 'Thanks for the help today.'],
    [34, false, 'Any time, see you later!'],
  ]],
  ['demo-wa-crew', 'Weekend Crew', 270, true, ['Tom', 'Lena', 'Sam'], [
    [160, false, 'Picnic on Saturday?', 'Lena'],
    [150, false, 'Who brings the speakers?', 'Tom'],
  ]],
];
const TG_SEED = [
  ['demo-tg-nora', 'Nora Linden', 300, false, null, [
    [30, false, 'Did you see who is playing in May?'],
    [29, true, 'No, tell me!'],
    [27, false, 'The band from last summer, back in town.'],
    [6, false, 'The concert is in May!'],
  ]],
  ['demo-tg-books', 'Book Club', 40, true, ['Ava', 'Noah'], [
    [90, false, 'Next book: chapters 1–5', 'Ava'],
    [48, false, 'Meeting Thursday at 8', 'Noah'],
  ]],
  ['demo-tg-ben', 'Ben Keller', 210, false, null, [
    [200, true, 'How is the move going?'],
    [190, false, 'Going well. I will call you tomorrow.'],
  ]],
];

const REPLIES = [
  'Got it 👍',
  'Sounds good!',
  'Haha, nice.',
  'Let me check and get back to you.',
  'See you then!',
];

function seedChats(seed, now) {
  const chats = new Map();
  let n = 0;
  for (const [id, name, hue, isGroup, members, msgs] of seed) {
    const messages = msgs.map(([ago, fromMe, body, author]) => ({
      id: `${id}-${++n}`,
      body,
      fromMe,
      timestamp: now - ago * 60,
      type: 'chat',
      ack: fromMe ? 3 : undefined,
      senderName: isGroup && !fromMe ? author : null,
    }));
    const unread = messages.filter((m, i) => !m.fromMe && i >= messages.length - 2 && now - m.timestamp < 15 * 60).length;
    chats.set(id, { id, name, isGroup, members: members || [], avatar: avatarFor(name, hue), archived: false, pinned: false, unreadCount: unread, messages });
  }
  return chats;
}

function createDemo({ broadcast, onLogout, setTimer = setTimeout } = {}) {
  const now = () => Math.floor(Date.now() / 1000);
  const t0 = now();
  const nets = {
    wa: { chats: seedChats(WA_SEED, t0), prefix: 'wa' },
    tg: { chats: seedChats(TG_SEED, t0), prefix: 'tg' },
  };
  let seq = 0;
  let replyIndex = 0;

  const listOf = (net) => [...nets[net].chats.values()].map((c) => {
    const last = c.messages[c.messages.length - 1];
    return {
      id: c.id,
      name: c.name,
      lastMessage: last ? last.body : '',
      timestamp: last ? last.timestamp : 0,
      unreadCount: c.unreadCount,
      isGroup: c.isGroup,
      archived: c.archived,
      pinned: c.pinned,
      avatar: c.avatar,
    };
  });
  const chatOf = (net, id) => {
    const c = nets[net].chats.get(String(id));
    if (!c) throw new Error('Unknown demo chat');
    return c;
  };

  function pushMessage(net, chat, msg) {
    chat.messages.push(msg);
    if (net === 'wa') {
      broadcast('wa:message', { from: msg.fromMe ? 'me' : chat.id, to: msg.fromMe ? chat.id : 'me', chatId: chat.id, chatAliases: [], ...msg, isBacklog: false });
    } else {
      broadcast('tg:message', { chatId: chat.id, ...msg });
    }
    broadcast(`${net}:chat-update`, { id: chat.id, lastMessage: msg.body, timestamp: msg.timestamp, isGroup: chat.isGroup });
  }

  // Receipts move forward like the real ones (sent → delivered → read), then the
  // other side types and answers, so the reviewer sees a live conversation.
  function afterSend(net, chat, msg) {
    if (net === 'wa') {
      setTimer(() => { msg.ack = 2; broadcast('wa:ack', { id: msg.id, ack: 2 }); }, 800);
      setTimer(() => { msg.ack = 3; broadcast('wa:ack', { id: msg.id, ack: 3 }); }, 1600);
      setTimer(() => broadcast('wa:typing', { chatId: chat.id, aliases: [], typing: true }), 1800);
    }
    setTimer(() => {
      if (net === 'wa') broadcast('wa:typing', { chatId: chat.id, aliases: [], typing: false });
      const reply = {
        id: `${chat.id}-r${++seq}`,
        body: REPLIES[replyIndex++ % REPLIES.length],
        fromMe: false,
        timestamp: now(),
        type: 'chat',
        senderName: chat.isGroup ? chat.members[seq % chat.members.length] : null,
      };
      pushMessage(net, chat, reply);
    }, 3500);
  }

  function makeOwn(chat, fields) {
    return { id: `${chat.id}-s${++seq}`, fromMe: true, timestamp: now(), type: 'chat', body: '', ack: 1, ...fields };
  }

  function bridge(net) {
    const send = (chatId, fields) => {
      const chat = chatOf(net, chatId);
      const msg = makeOwn(chat, fields);
      pushMessage(net, chat, msg);
      afterSend(net, chat, msg);
      return net === 'wa' ? true : { id: msg.id, timestamp: msg.timestamp, body: msg.body, fromMe: true, type: msg.type, mediaData: msg.mediaData };
    };
    const fileName = (p) => String(p || '').split(/[\\/]/).pop();
    const common = {
      demo: true,
      init: async () => {},
      getStatus: () => 'ready',
      getMessages: async (chatId) => chatOf(net, chatId).messages.map((m) => ({ ...m })),
      sendMessage: async (chatId, text) => send(chatId, { body: String(text) }),
      sendFile: async (chatId, p) => send(chatId, { body: fileName(p), type: 'document' }),
      sendSticker: async (chatId) => send(chatId, { body: '', type: 'sticker' }),
      sendVoice: async (chatId, base64, mime) => send(chatId, { type: 'ptt', mediaData: `data:${mime || 'audio/ogg'};base64,${base64}` }),
      setArchive: async (chatId, archive) => {
        chatOf(net, chatId).archived = !!archive;
        broadcast(`${net}:chat-update`, { id: String(chatId), archived: !!archive });
        if (net === 'wa') broadcast('wa:chats-updated', { count: nets.wa.chats.size });
        return true;
      },
      setBlocked: async () => true,
      isContactBlocked: () => false,
      editMessage: async (chatId, messageId, newText) => {
        const m = chatOf(net, chatId).messages.find((x) => x.id === messageId);
        if (m) m.body = String(newText);
        return true;
      },
      deleteMessage: async (chatId, messageId) => {
        const c = chatOf(net, chatId);
        c.messages = c.messages.filter((x) => x.id !== messageId);
        return true;
      },
      markChatRead: async (chatId) => { const c = nets[net].chats.get(String(chatId)); if (c) c.unreadCount = 0; return true; },
      getContactAvatar: async (id) => nets[net].chats.get(String(id))?.avatar || null,
      getParticipants: async (chatId) => {
        const c = nets[net].chats.get(String(chatId));
        return c?.isGroup ? c.members.map((name, i) => ({ id: `${c.id}-m${i}`, name, pushname: name })) : [];
      },
      logout: async () => { if (onLogout) await onLogout(); return true; },
      shutdown: async () => {},
    };
    return common;
  }

  const wa = {
    ...bridge('wa'),
    getQR: () => null,
    getChats: async () => listOf('wa'),
    getMyProfile: async () => ({ name: 'App Review (Demo)', avatar: null }),
    getSyncState: () => false,
    pairAsNewDevice: async () => {},
    reconnect: async () => {},
  };
  const tg = {
    ...bridge('tg'),
    requestCode: async () => DEMO_HASH,
    signIn: async () => ({ success: true }),
    startQRLogin: async () => {},
    submit2FA: async () => {},
    getDialogs: async () => listOf('tg'),
    getRecentStickers: async () => [],
    getMe: async () => ({ name: 'App Review (Demo)', avatar: null }),
    setCredentials: async () => {},
  };
  return { wa, tg };
}

module.exports = { createDemo, isDemoPhone, isDemoCode, DEMO_PHONE, DEMO_CODE, DEMO_HASH };

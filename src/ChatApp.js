import React, { useState, useEffect } from 'react';
import TitleBar from './components/TitleBar';
import ChatWindow from './components/ChatWindow';
import './App.css';

const api = window.api;

export default function ChatApp({ chatId, chatName, service }) {
  const [messages, setMessages] = useState([]);
  const [chatAvatar, setChatAvatar] = useState(null);
  const [isTyping, setIsTyping] = useState(false);
  const typingTimer = React.useRef(null);
  const latestTgMsgIdRef = React.useRef(0);

  const mergeById = React.useCallback((base, incoming) => {
    const merged = [...base];
    const indexById = new Map();
    for (let i = 0; i < merged.length; i += 1) {
      const id = merged[i]?.id;
      if (id) indexById.set(String(id), i);
    }
    for (const msg of incoming || []) {
      const id = msg?.id;
      if (id && indexById.has(String(id))) {
        merged[indexById.get(String(id))] = { ...merged[indexById.get(String(id))], ...msg };
      } else {
        if (id) indexById.set(String(id), merged.length);
        merged.push(msg);
      }
    }
    merged.sort((a, b) => {
      const ta = Number(a?.timestamp || 0);
      const tb = Number(b?.timestamp || 0);
      if (ta !== tb) return ta - tb;
      return Number(a?.id || 0) - Number(b?.id || 0);
    });
    return merged;
  }, []);

  const refreshTelegramDelta = React.useCallback(async () => {
    if (!api || !chatId || service !== 'telegram') return;
    try {
      const latestId = latestTgMsgIdRef.current || 0;
      const delta = await api.tg.getMessages(chatId, { limit: 20, minId: latestId });
      if (delta && delta.length) {
        setMessages(prev => mergeById(prev, delta));
      }
    } catch (e) { /* keep UI responsive on transient network errors */ }
  }, [chatId, mergeById, service]);

  useEffect(() => {
    if (service !== 'telegram') return;
    const latest = messages.length ? Number(messages[messages.length - 1]?.id || 0) : 0;
    latestTgMsgIdRef.current = latest;
  }, [messages, service]);

  useEffect(() => {
    async function loadMessages() {
      if (!api || !chatId) return;
      try {
        const msgs = service === 'whatsapp'
          ? await api.wa.getMessages(chatId, { refresh: true })
          : await api.tg.getMessages(chatId, { limit: 50 });
        setMessages(msgs || []);
      } catch (e) { console.error('[ChatApp load]', e); }
    }
    loadMessages();
    // Avatar aus Main-Process-Cache holen (wurde beim Öffnen des Chats gecacht)
    if (api?.getStoredAvatar && chatId) {
      api.getStoredAvatar(chatId).then(a => { if (a) setChatAvatar(a); }).catch(() => {});
    }
  }, [chatId, service]);

  useEffect(() => {
    if (service !== 'telegram' || !chatId) return undefined;
    const onFocus = () => { refreshTelegramDelta(); };
    window.addEventListener('focus', onFocus);
    // Also do one quick delayed delta refresh after initial load.
    const t = setTimeout(() => { refreshTelegramDelta(); }, 1200);
    return () => {
      window.removeEventListener('focus', onFocus);
      clearTimeout(t);
    };
  }, [chatId, refreshTelegramDelta, service]);

  useEffect(() => {
    if (!api) return;
    const removeWa = api.wa.onMessage(msg => {
      if (service !== 'whatsapp') return;
      // Handle both inbound and outbound messages for this open chat.
      // Outbound WA events are needed for accurate ack/media updates.
      const sameChat = msg.fromMe
        ? String(msg.to) === String(chatId)
        : String(msg.from) === String(chatId);
      if (sameChat) setMessages(prev => mergeById(prev, [msg]));
    });
    const removeWaMedia = service === 'whatsapp' && api.wa.onMedia
      ? api.wa.onMedia(({ msgId, mediaData }) => {
          setMessages(prev => prev.map(m => 
            m.id === msgId ? { ...m, mediaData } : m
          ));
        })
      : null;
    const removeTg = api.tg.onMessage(msg => {
      // fromMe-Nachrichten werden optimistisch beim Senden eingefügt → kein Duplikat
      if (service === 'telegram' && String(msg.chatId) === String(chatId) && !msg.fromMe)
        setMessages(prev => mergeById(prev, [msg]));
    });
    const removeAck = service === 'whatsapp'
      ? api.wa.onAck(({ id, ack }) => {
          setMessages(prev => prev.map(m => m.id === id ? { ...m, ack } : m));
        })
      : null;
    const removeTyping = service === 'whatsapp' && api.wa.onTyping
      ? api.wa.onTyping(({ chatId: tid, typing }) => {
          if (tid !== chatId) return;
          setIsTyping(typing);
          if (typing) {
            clearTimeout(typingTimer.current);
            typingTimer.current = setTimeout(() => setIsTyping(false), 8000);
          }
        })
      : null;
    return () => { removeWa?.(); removeWaMedia?.(); removeTg?.(); removeAck?.(); removeTyping?.(); };
  }, [chatId, mergeById, service]);

  const sendMessage = async (text) => {
    if (!text.trim() || !api) return;
    try {
      if (service === 'whatsapp') await api.wa.sendMessage(chatId, text);
      else {
        await api.tg.sendMessage(chatId, text);
        const ts = Math.floor(Date.now() / 1000);
        const localMsg = { id: Date.now().toString(), body: text, fromMe: true, timestamp: ts };
        setMessages(prev => [...prev, localMsg]);
      }
      // Sidebar sofort benachrichtigen
      const ts = Math.floor(Date.now() / 1000);
      api.notifySent?.({ chatId, body: text, timestamp: ts, service });
    } catch (e) { console.error('[ChatApp send]', e); }
  };

  const sendFile = async (filePath) => {
    if (!filePath || !api) return;
    try {
      if (service === 'whatsapp') await api.wa.sendFile(chatId, filePath);
      else {
        await api.tg.sendFile(chatId, filePath);
        const ts = Math.floor(Date.now() / 1000);
        const name = filePath.split(/[\\/]/).pop();
        const localMsg = { id: Date.now().toString(), body: `📎 ${name}`, fromMe: true, timestamp: ts };
        setMessages(prev => [...prev, localMsg]);
      }
      const ts = Math.floor(Date.now() / 1000);
      const name = filePath.split(/[\\/]/).pop();
      api.notifySent?.({ chatId, body: `📎 ${name}`, timestamp: ts, service });
    } catch (e) { console.error('[ChatApp sendFile]', e); }
  };

  const sendSticker = async (filePath) => {
    if (!filePath || !api) return;
    try {
      if (service === 'whatsapp') await api.wa.sendSticker(chatId, filePath);
      else {
        await api.tg.sendSticker(chatId, filePath);
        const ts = Math.floor(Date.now() / 1000);
        const localMsg = {
          id: Date.now().toString(),
          body: '',
          fromMe: true,
          timestamp: ts,
          type: 'sticker',
          mediaData: null,
        };
        setMessages(prev => [...prev, localMsg]);
      }
      const ts = Math.floor(Date.now() / 1000);
      api.notifySent?.({ chatId, body: 'Sticker', timestamp: ts, service });
    } catch (e) { console.error('[ChatApp sendSticker]', e); }
  };

  return (
    <div className="app-root">
      <TitleBar title={`${service === 'whatsapp' ? 'WhatsApp' : 'Telegram'} — ${chatName || 'Chat'}`} />
      <ChatWindow
        chat={{ id: chatId, name: chatName, service, avatar: chatAvatar }}
        messages={messages}
        onSend={sendMessage}
        onSendFile={sendFile}
        onSendSticker={sendSticker}
        isTyping={isTyping}
      />
    </div>
  );
}

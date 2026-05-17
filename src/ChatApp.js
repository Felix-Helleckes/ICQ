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
  const lastReadAtRef = React.useRef(0);

  const markChatReadNow = React.useCallback(() => {
    if (!api || !chatId || !service) return;
    const now = Date.now();
    if (now - lastReadAtRef.current < 600) return;
    lastReadAtRef.current = now;
    if (service === 'whatsapp') api.wa.markRead?.(chatId).catch(() => {});
    else api.tg.markRead?.(chatId).catch(() => {});
    api.notifyRead?.({ chatId: String(chatId), service, timestamp: Math.floor(now / 1000) });
  }, [chatId, service]);

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
        markChatReadNow();
      } catch (e) { console.error('[ChatApp load]', e); }
    }
    loadMessages();
    // Avatar aus Main-Process-Cache holen (wurde beim Öffnen des Chats gecacht)
    if (api?.getStoredAvatar && chatId) {
      api.getStoredAvatar(chatId).then(a => { if (a) setChatAvatar(a); }).catch(() => {});
    }
  }, [chatId, markChatReadNow, service]);

  useEffect(() => {
    if (service !== 'telegram' || !chatId) return undefined;
    const onFocus = () => { refreshTelegramDelta(); markChatReadNow(); };
    window.addEventListener('focus', onFocus);
    // Also do one quick delayed delta refresh after initial load.
    const t = setTimeout(() => { refreshTelegramDelta(); markChatReadNow(); }, 1200);
    return () => {
      window.removeEventListener('focus', onFocus);
      clearTimeout(t);
      markChatReadNow();
    };
  }, [chatId, markChatReadNow, refreshTelegramDelta, service]);

  useEffect(() => {
    const onFocus = () => markChatReadNow();
    const onBeforeUnload = () => markChatReadNow();
    window.addEventListener('focus', onFocus);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('beforeunload', onBeforeUnload);
      markChatReadNow();
    };
  }, [markChatReadNow]);

  useEffect(() => {
    if (!api) return;
    const removeWa = api.wa.onMessage(msg => {
      if (service !== 'whatsapp') return;
      // Handle both inbound and outbound messages for this open chat.
      // Outbound WA events are needed for accurate ack/media updates.
      const sameChat = msg.fromMe
        ? String(msg.to) === String(chatId)
        : String(msg.from) === String(chatId);
      if (sameChat) {
        setMessages(prev => mergeById(prev, [msg]));
        if (!msg.fromMe) markChatReadNow();
      }
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
      if (service === 'telegram' && String(msg.chatId) === String(chatId) && !msg.fromMe) {
        setMessages(prev => mergeById(prev, [msg]));
        markChatReadNow();
      }
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
  }, [chatId, markChatReadNow, mergeById, service]);

  const sendMessage = async (text) => {
    if (!text.trim() || !api) return;
    try {
      if (service === 'whatsapp') await api.wa.sendMessage(chatId, text);
      else {
        const sent = await api.tg.sendMessage(chatId, text);
        const ts = sent?.timestamp || Math.floor(Date.now() / 1000);
        const localMsg = {
          id: sent?.id || Date.now().toString(),
          body: sent?.body || text,
          fromMe: true,
          timestamp: ts,
          type: 'text',
        };
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
        const sent = await api.tg.sendFile(chatId, filePath);
        const ts = sent?.timestamp || Math.floor(Date.now() / 1000);
        const name = filePath.split(/[\\/]/).pop();
        const localMsg = {
          id: sent?.id || Date.now().toString(),
          body: sent?.body || `📎 ${name}`,
          fromMe: true,
          timestamp: ts,
          type: 'file',
        };
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
        const sent = await api.tg.sendSticker(chatId, filePath);
        const ts = sent?.timestamp || Math.floor(Date.now() / 1000);
        const localMsg = {
          id: sent?.id || Date.now().toString(),
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

  const editMessage = async (message, newText) => {
    if (!api || !message?.id) return;
    const next = (newText || '').trim();
    if (!next) return;
    try {
      if (service === 'whatsapp') await api.wa.editMessage(chatId, message.id, next);
      else await api.tg.editMessage(chatId, message.id, next);
      setMessages(prev => prev.map(m => (
        String(m.id) === String(message.id)
          ? { ...m, body: next, edited: true, type: 'text', mediaData: null }
          : m
      )));
    } catch (e) {
      console.error('[ChatApp edit]', e);
    }
  };

  const deleteMessage = async (message, forEveryone = true) => {
    if (!api || !message?.id) return;
    try {
      if (service === 'whatsapp') await api.wa.deleteMessage(chatId, message.id, forEveryone);
      else await api.tg.deleteMessage(chatId, message.id, forEveryone);
      setMessages(prev => prev.filter(m => String(m.id) !== String(message.id)));
    } catch (e) {
      console.error('[ChatApp delete]', e);
    }
  };

  const forwardMessage = async (message, targetChatId) => {
    if (!api || !message || !targetChatId) return false;
    const payload = (message.body || '').trim();
    if (!payload) return false;
    try {
      if (service === 'whatsapp') await api.wa.sendMessage(targetChatId, payload);
      else await api.tg.sendMessage(targetChatId, payload);
      return true;
    } catch (e) {
      console.error('[ChatApp forward]', e);
      return false;
    }
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
        onEditMessage={editMessage}
        onDeleteMessage={deleteMessage}
        onForwardMessage={forwardMessage}
        isTyping={isTyping}
      />
    </div>
  );
}

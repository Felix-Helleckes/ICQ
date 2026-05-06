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

  useEffect(() => {
    async function loadMessages() {
      if (!api || !chatId) return;
      try {
        const msgs = service === 'whatsapp'
          ? await api.wa.getMessages(chatId)
          : await api.tg.getMessages(chatId);
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
    if (!api) return;
    const removeWa = api.wa.onMessage(msg => {
      if (service === 'whatsapp' && String(msg.from) === String(chatId) && !msg.fromMe)
        setMessages(prev => [...prev, msg]);
    });
    const removeTg = api.tg.onMessage(msg => {
      // fromMe-Nachrichten werden optimistisch beim Senden eingefügt → kein Duplikat
      if (service === 'telegram' && String(msg.chatId) === String(chatId) && !msg.fromMe)
        setMessages(prev => [...prev, msg]);
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
    return () => { removeWa?.(); removeTg?.(); removeAck?.(); removeTyping?.(); };
  }, [chatId, service]);

  const sendMessage = async (text) => {
    if (!text.trim() || !api) return;
    try {
      if (service === 'whatsapp') await api.wa.sendMessage(chatId, text);
      else await api.tg.sendMessage(chatId, text);
      const ts = Math.floor(Date.now() / 1000);
      const localMsg = { id: Date.now().toString(), body: text, fromMe: true, timestamp: ts };
      setMessages(prev => [...prev, localMsg]);
      // Sidebar sofort benachrichtigen
      api.notifySent?.({ chatId, body: text, timestamp: ts, service });
    } catch (e) { console.error('[ChatApp send]', e); }
  };

  return (
    <div className="app-root">
      <TitleBar title={`${service === 'whatsapp' ? 'WhatsApp' : 'Telegram'} — ${chatName || 'Chat'}`} />
      <ChatWindow
        chat={{ id: chatId, name: chatName, service, avatar: chatAvatar }}
        messages={messages}
        onSend={sendMessage}
        isTyping={isTyping}
      />
    </div>
  );
}

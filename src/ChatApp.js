import React, { useState, useEffect } from 'react';
import TitleBar from './components/TitleBar';
import ChatWindow from './components/ChatWindow';
import './App.css';

const api = window.api;

export default function ChatApp({ chatId, chatName, service }) {
  const [messages, setMessages] = useState([]);

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
  }, [chatId, service]);

  useEffect(() => {
    if (!api) return;
    const removeWa = api.wa.onMessage(msg => {
      if (service === 'whatsapp' && msg.from === chatId)
        setMessages(prev => [...prev, msg]);
    });
    const removeTg = api.tg.onMessage(msg => {
      if (service === 'telegram' && msg.chatId === chatId)
        setMessages(prev => [...prev, msg]);
    });
    return () => { removeWa?.(); removeTg?.(); };
  }, [chatId, service]);

  const sendMessage = async (text) => {
    if (!text.trim() || !api) return;
    try {
      if (service === 'whatsapp') await api.wa.sendMessage(chatId, text);
      else await api.tg.sendMessage(chatId, text);
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        body: text,
        fromMe: true,
        timestamp: Math.floor(Date.now() / 1000),
      }]);
    } catch (e) { console.error('[ChatApp send]', e); }
  };

  return (
    <div className="app-root">
      <TitleBar title={chatName || 'Chat'} />
      <ChatWindow
        chat={{ id: chatId, name: chatName }}
        messages={messages}
        onSend={sendMessage}
      />
    </div>
  );
}

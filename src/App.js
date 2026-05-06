import React, { useState, useEffect } from 'react';
import TitleBar from './components/TitleBar';
import Sidebar from './components/Sidebar';
import LoginPanel from './components/LoginPanel';
import './App.css';

const api = window.api;

export default function App() {
  const [waStatus, setWaStatus] = useState('disconnected');
  const [tgStatus, setTgStatus] = useState('disconnected');
  const [waQR, setWaQR]         = useState(null);
  const [tgQR, setTgQR]         = useState(null);
  const [tg2FA, setTg2FA]       = useState(null);
  const [activeService, setActiveService] = useState('whatsapp');
  const [chats, setChats]       = useState([]);

  // Poll statuses
  useEffect(() => {
    if (!api) return;
    const poll = async () => {
      setWaStatus(await api.wa.getStatus());
      setTgStatus(await api.tg.getStatus());
    };
    poll();
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, []);

  // IPC event listeners + live contact-list updates
  useEffect(() => {
    if (!api) return;
    api.wa.onQR(qr  => setWaQR(qr));
    api.wa.onReady(() => { setWaStatus('ready'); setWaQR(null); });
    api.tg.onQR(qr  => setTgQR(qr));
    api.tg.onReady(() => { setTgStatus('ready'); setTgQR(null); });
    api.tg.on2FANeeded(data => setTg2FA(data));

    // Update lastMessage + unreadCount on incoming messages
    const removeWaMsg = api.wa.onMessage(msg => {
      setChats(prev => prev.map(c =>
        c.id === msg.from
          ? { ...c, lastMessage: msg.body, unreadCount: (c.unreadCount || 0) + 1 }
          : c
      ));
    });
    const removeTgMsg = api.tg.onMessage(msg => {
      setChats(prev => prev.map(c =>
        c.id === String(msg.chatId)
          ? { ...c, lastMessage: msg.body, unreadCount: (c.unreadCount || 0) + 1 }
          : c
      ));
    });
    return () => { removeWaMsg?.(); removeTgMsg?.(); };
  }, []);

  // Load chats when service / status changes
  useEffect(() => {
    if (!api) return;
    async function load() {
      if (activeService === 'whatsapp' && waStatus === 'ready')
        setChats(await api.wa.getChats() || []);
      else if (activeService === 'telegram' && tgStatus === 'ready')
        setChats(await api.tg.getDialogs() || []);
      else
        setChats([]);
    }
    load();
  }, [activeService, waStatus, tgStatus]);

  // Open a separate chat window (ICQ 5 style) + clear unread badge
  const openChat = (chat) => {
    setChats(prev => prev.map(c => c.id === chat.id ? { ...c, unreadCount: 0 } : c));
    api?.openChat({ chatId: chat.id, chatName: chat.name || chat.id, service: activeService });
  };

  const currentStatus = activeService === 'whatsapp' ? waStatus : tgStatus;
  const needsLogin = ['disconnected', 'qr', 'needs-auth', 'no-credentials'].includes(currentStatus);

  // Login panel is rendered inside the sidebar when not connected
  const loginPanel = needsLogin ? (
    <LoginPanel
      service={activeService}
      waStatus={waStatus}
      tgStatus={tgStatus}
      waQR={waQR}
      tgQR={tgQR}
      tg2FA={tg2FA}
      onTg2FASubmit={async pw => { await api.tg.submit2FA(pw); setTg2FA(null); }}
      onTgAuth={async (phone, code, hash) => {
        if (!code) { const h = await api.tg.requestCode(phone); return h; }
        await api.tg.signIn(phone, code, hash);
        setTgStatus('ready');
      }}
      onTgQRLogin={async () => {
        setTgStatus('qr');
        try { await api.tg.startQRLogin(); }
        catch (e) { setTgStatus('needs-auth'); }
      }}
    />
  ) : null;

  return (
    <div className="app-root">
      <TitleBar />
      <Sidebar
        activeService={activeService}
        setActiveService={s => { setActiveService(s); setChats([]); }}
        waStatus={waStatus}
        tgStatus={tgStatus}
        chats={chats}
        onSelectChat={openChat}
        loginPanel={loginPanel}
      />
    </div>
  );
}

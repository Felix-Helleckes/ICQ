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
  const [chatsLoading, setChatsLoading] = useState(false);
  const [myProfile, setMyProfile] = useState({ name: null, avatar: null });
  const [soundEnabled, setSoundEnabled] = useState(() => {
    return localStorage.getItem('icq-sound') !== 'off';
  });
  const soundEnabledRef = React.useRef(soundEnabled);
  useEffect(() => { soundEnabledRef.current = soundEnabled; localStorage.setItem('icq-sound', soundEnabled ? 'on' : 'off'); }, [soundEnabled]);

  const [waGroupSound, setWaGroupSound] = useState(() => localStorage.getItem('icq-wa-group-sound') !== 'off');
  const [tgGroupSound, setTgGroupSound] = useState(() => localStorage.getItem('icq-tg-group-sound') !== 'off');
  const waGroupSoundRef = React.useRef(waGroupSound);
  const tgGroupSoundRef = React.useRef(tgGroupSound);
  useEffect(() => { waGroupSoundRef.current = waGroupSound; localStorage.setItem('icq-wa-group-sound', waGroupSound ? 'on' : 'off'); }, [waGroupSound]);
  useEffect(() => { tgGroupSoundRef.current = tgGroupSound; localStorage.setItem('icq-tg-group-sound', tgGroupSound ? 'on' : 'off'); }, [tgGroupSound]);

  // Chats-Ref damit Nachrichten-Handler immer aktuelle Daten haben
  const chatsRef = React.useRef(chats);
  useEffect(() => { chatsRef.current = chats; }, [chats]);

  const playMessageSound = (chatId, service) => {
    if (!soundEnabledRef.current) return;
    // Gruppen-Sound-Check
    if (chatId) {
      const chat = chatsRef.current.find(c => c.id === String(chatId));
      if (chat?.isGroup) {
        const groupSoundOn = service === 'telegram' ? tgGroupSoundRef.current : waGroupSoundRef.current;
        if (!groupSoundOn) return;
      }
    }
    try { new Audio(process.env.PUBLIC_URL + '/sounds/icq-message.mp3').play().catch(() => {}); } catch (e) {}
  };

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
    api.wa.onReady(async (data) => {
      setWaStatus('ready');
      setWaQR(null);
      const profile = await api.wa.getMyProfile().catch(() => null);
      if (profile) setMyProfile(profile);
      else if (data?.name) setMyProfile(p => ({ ...p, name: data.name }));
    });
    api.tg.onQR(qr  => setTgQR(qr));
    api.tg.onReady(async (data) => {
      setTgStatus('ready');
      setTgQR(null);
      if (data?.name) setMyProfile({ name: data.name, avatar: data.avatar || null });
    });
    api.tg.on2FANeeded(data => setTg2FA(data));

    // Update lastMessage + unreadCount on incoming messages
    // Debounced reload for unknown chats
    let reloadTimer = null;
    const scheduleReload = (service) => {
      if (reloadTimer) return; // already scheduled
      reloadTimer = setTimeout(async () => {
        reloadTimer = null;
        if (service === 'whatsapp') {
          const result = await api.wa.getChats().catch(() => null);
          if (result) setChats(result.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)));
        } else {
          const result = await api.tg.getDialogs().catch(() => null);
          if (result) setChats(result.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)));
        }
      }, 800);
    };

    const removeWaMsg = api.wa.onMessage(msg => {
      const now = msg.timestamp || Math.floor(Date.now() / 1000);
      if (msg.fromMe) {
        // Eigene Nachricht → Badge leeren, lastMessage + timestamp aktualisieren + nach oben sortieren
        setChats(prev => {
          const updated = prev.map(c =>
            (c.id === msg.to || c.id === msg.from)
              ? { ...c, lastMessage: msg.body, timestamp: now, unreadCount: 0 }
              : c
          );
          return updated.slice().sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        });
        return;
      }
      playMessageSound(msg.from, 'whatsapp');
      const knownChat = chatsRef.current.some(c => c.id === msg.from);
      if (!knownChat) {
        // Chat nicht in der Liste → neu laden
        scheduleReload('whatsapp');
        return;
      }
      setChats(prev => {
        const updated = prev.map(c =>
          c.id === msg.from
            ? { ...c, lastMessage: msg.body, timestamp: now, unreadCount: (c.unreadCount || 0) + 1 }
            : c
        );
        return updated.slice().sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      });
    });
    // Avatare nachträglich einspielen (werden im Hintergrund geladen)
    const removeWaAvatar = api.wa.onAvatar(({ id, avatar }) => {
      setChats(prev => prev.map(c => c.id === id ? { ...c, avatar } : c));
    });
    const removeTgAvatar = api.tg.onAvatar(({ id, avatar }) => {
      setChats(prev => prev.map(c => c.id === id ? { ...c, avatar } : c));
    });
    const removeTgMsg = api.tg.onMessage(msg => {
      const chatId = String(msg.chatId);
      const knownChat = chatsRef.current.some(c => c.id === chatId);
      if (!knownChat) {
        if (!msg.fromMe) { playMessageSound(chatId, 'telegram'); }
        scheduleReload('telegram');
        return;
      }
      setChats(prev => {
        const updated = prev.map(c => {
          if (c.id !== chatId) return c;
          if (msg.fromMe) return { ...c, lastMessage: msg.body, timestamp: msg.timestamp, unreadCount: 0 };
          playMessageSound(chatId, 'telegram');
          return { ...c, lastMessage: msg.body, timestamp: msg.timestamp, unreadCount: (c.unreadCount || 0) + 1 };
        });
        return updated.slice().sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      });
    });
    // Direkt gesendete Nachrichten aus Chat-Fenstern (sofortiges Sidebar-Update)
    const removeSent = api.onSent?.((msg) => {
      setChats(prev => {
        const updated = prev.map(c =>
          c.id === msg.chatId
            ? { ...c, lastMessage: msg.body, timestamp: msg.timestamp, unreadCount: 0 }
            : c
        );
        return updated.slice().sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      });
    });
    return () => { removeWaMsg?.(); removeWaAvatar?.(); removeTgAvatar?.(); removeTgMsg?.(); removeSent?.(); if (reloadTimer) clearTimeout(reloadTimer); };
  }, []);

  // Load chats when service / status changes
  useEffect(() => {
    if (!api) return;
    async function load() {
      if (activeService === 'whatsapp' && waStatus === 'ready') {
        setChatsLoading(true);
        // Profile und Chats parallel laden
        const [chatsResult, profile] = await Promise.all([
          api.wa.getChats().catch(() => []),
          api.wa.getMyProfile().catch(() => null),
        ]);
        if (profile) setMyProfile(profile);
        setChats(chatsResult || []);
        setChatsLoading(false);
      } else if (activeService === 'telegram' && tgStatus === 'ready') {
        setChatsLoading(true);
        const [dialogs, me] = await Promise.all([
          api.tg.getDialogs().catch(() => []),
          api.tg.getMe().catch(() => null),
        ]);
        if (me) setMyProfile(me);
        setChats((dialogs || []).slice().sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)));
        setChatsLoading(false);
      } else {
        setChats([]);
        setChatsLoading(false);
      }
    }
    load();
  }, [activeService, waStatus, tgStatus]);

  // Open a separate chat window (ICQ 5 style) + clear unread badge
  const openChat = (chat) => {
    setChats(prev => prev.map(c => c.id === chat.id ? { ...c, unreadCount: 0 } : c));
    // Serverseitig als gelesen markieren
    if (activeService === 'whatsapp') api?.wa.markRead?.(chat.id).catch(() => {});
    else api?.tg.markRead?.(chat.id).catch(() => {});
    api?.openChat({ chatId: chat.id, chatName: chat.name || chat.id, service: activeService, avatar: chat.avatar || null });
  };

  const sendFromSidebar = (chatId, text) => {
    // Badge leeren wenn Nutzer antwortet
    setChats(prev => prev.map(c => c.id === chatId ? { ...c, unreadCount: 0 } : c));
  };

  const markGroupsRead = () => {
    const groups = chats.filter(c => c.isGroup && (c.unreadCount || 0) > 0);
    setChats(prev => prev.map(c => c.isGroup ? { ...c, unreadCount: 0 } : c));
    // Auf den Servern als gelesen markieren
    groups.forEach(c => {
      if (activeService === 'whatsapp') api?.wa.markRead?.(c.id).catch(() => {});
      else api?.tg.markRead?.(c.id).catch(() => {});
    });
  };

  const handleLogout = async () => {
    if (activeService === 'whatsapp') {
      await api?.wa.logout().catch(() => {});
      setWaStatus('disconnected');
    } else {
      await api?.tg.logout().catch(() => {});
      setTgStatus('needs-auth');
    }
    setChats([]);
    setMyProfile({ name: null, avatar: null });
  };

  const currentStatus = activeService === 'whatsapp' ? waStatus : tgStatus;
  const needsLogin = ['disconnected', 'loading', 'qr', 'needs-auth'].includes(currentStatus);

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
      onTgSetCredentials={async (apiId, apiHash) => {
        setTgStatus('disconnected');
        await api.tg.setCredentials(apiId, apiHash);
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
        chatsLoading={chatsLoading}
        onSelectChat={openChat}
        loginPanel={loginPanel}
        myProfile={myProfile}
        onLogout={handleLogout}
        soundEnabled={soundEnabled}
        onToggleSound={() => setSoundEnabled(v => !v)}
        waGroupSound={waGroupSound}
        tgGroupSound={tgGroupSound}
        onToggleWaGroupSound={() => setWaGroupSound(v => !v)}
        onToggleTgGroupSound={() => setTgGroupSound(v => !v)}
        onMarkGroupsRead={markGroupsRead}
      />
    </div>
  );
}

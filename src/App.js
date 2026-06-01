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
  const [contactScale, setContactScale] = useState(() => {
    const saved = Number(localStorage.getItem('icq-contact-scale'));
    return Number.isFinite(saved) && saved > 0 ? saved : 1;
  });
  useEffect(() => {
    localStorage.setItem('icq-contact-scale', String(contactScale));
  }, [contactScale]);

  // Per-service chat cache — so switching services is instant (no reload)
  const waCacheRef = React.useRef(null);   // null = not loaded yet
  const tgCacheRef = React.useRef(null);
  const waProfileRef = React.useRef(null);
  const tgProfileRef = React.useRef(null);
  const activeServiceRef = React.useRef(activeService);
  useEffect(() => { activeServiceRef.current = activeService; }, [activeService]);

  // Helper: write into the right cache and update visible list if active
  const setCacheAndChats = (service, list) => {
    const sorted = list.slice().sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    if (service === 'whatsapp') waCacheRef.current = sorted;
    else tgCacheRef.current = sorted;
    if (activeServiceRef.current === service) setChats(sorted);
  };

  // Update a single chat entry in the cache (live updates from messages)
  const patchChat = (service, id, patch) => {
    const cache = service === 'whatsapp' ? waCacheRef.current : tgCacheRef.current;
    if (!cache) return;
    const updated = cache.map(c => c.id === id ? { ...c, ...patch } : c)
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    if (service === 'whatsapp') waCacheRef.current = updated;
    else tgCacheRef.current = updated;
    if (activeServiceRef.current === service) setChats(updated);
  };
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

  // Play startup sound once when first service connects
  const startupSoundPlayedRef = React.useRef(false);
  useEffect(() => {
    const bothReady = waStatus === 'ready' || tgStatus === 'ready';
    if (bothReady && !startupSoundPlayedRef.current) {
      startupSoundPlayedRef.current = true;
      try {
        const startupAudio = new Audio(process.env.PUBLIC_URL + '/sounds/Startup.wav');
        startupAudio.volume = 0.3;
        startupAudio.play().catch(() => {});
      } catch (e) {}
    }
  }, [waStatus, tgStatus]);

  const playMessageSound = (chatId, service) => {
    if (!soundEnabledRef.current) return;
    // Gruppen-Sound-Check — immer den service-eigenen Cache nutzen, nicht chatsRef
    // (chatsRef enthält nur den aktiv angezeigten Service)
    if (chatId) {
      const cache = service === 'telegram' ? tgCacheRef.current : waCacheRef.current;
      const chat = cache?.find(c => c.id === String(chatId));
      // If the chat is archived, always stay silent
      if (chat?.archived) return;
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
      const newWaStatus = await api.wa.getStatus();
      setWaStatus(newWaStatus);
      // Race condition fix: if status is qr but we missed the event, fetch QR directly
      if (newWaStatus === 'qr') {
        const qr = await api.wa.getQR();
        if (qr) setWaQR(qr);
      }
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
      if (profile) { waProfileRef.current = profile; if (activeServiceRef.current === 'whatsapp') setMyProfile(profile); }
      else if (data?.name) { waProfileRef.current = p => ({ ...p, name: data.name }); if (activeServiceRef.current === 'whatsapp') setMyProfile(p => ({ ...p, name: data.name })); }
      // Force reload WA cache on reconnect
      waCacheRef.current = null;
    });
    api.tg.onQR(qr  => setTgQR(qr));
    api.tg.onReady(async (data) => {
      setTgStatus('ready');
      setTgQR(null);
      if (data?.name) { tgProfileRef.current = { name: data.name, avatar: data.avatar || null }; if (activeServiceRef.current === 'telegram') setMyProfile(tgProfileRef.current); }
      // Force reload TG cache on reconnect
      tgCacheRef.current = null;
    });
    api.tg.on2FANeeded(data => setTg2FA(data));

    // Update lastMessage + unreadCount on incoming messages
    // Debounced reload for unknown chats
    let reloadTimer = null;
    const scheduleReload = (service) => {
      if (reloadTimer) return;
      reloadTimer = setTimeout(async () => {
        reloadTimer = null;
        if (service === 'whatsapp') {
          const result = await api.wa.getChats().catch(() => null);
          if (result) setCacheAndChats('whatsapp', result);
        } else {
          const result = await api.tg.getDialogs().catch(() => null);
          if (result) setCacheAndChats('telegram', result);
        }
      }, 800);
    };

    const removeWaMsg = api.wa.onMessage(msg => {
      const now = msg.timestamp || Math.floor(Date.now() / 1000);
      if (msg.fromMe) {
        patchChat('whatsapp', msg.to || msg.from, { lastMessage: msg.body, timestamp: now, unreadCount: 0 });
        return;
      }
      const cache = waCacheRef.current;
      const knownChat = cache?.some(c => c.id === msg.from);
      if (!knownChat) { scheduleReload('whatsapp'); return; }
      playMessageSound(msg.from, 'whatsapp');
      patchChat('whatsapp', msg.from, { lastMessage: msg.body, timestamp: now, unreadCount: (cache.find(c=>c.id===msg.from)?.unreadCount || 0) + 1 });
    });
    // Avatare nachträglich einspielen (werden im Hintergrund geladen)
    const removeWaAvatar = api.wa.onAvatar(({ id, avatar }) => {
      patchChat('whatsapp', id, { avatar });
    });
    const removeTgAvatar = api.tg.onAvatar(({ id, avatar }) => {
      patchChat('telegram', id, { avatar });
    });
    const removeTgMsg = api.tg.onMessage(msg => {
      const chatId = String(msg.chatId);
      const cache = tgCacheRef.current;
      const knownChat = cache?.some(c => c.id === chatId);
      if (!knownChat) {
        scheduleReload('telegram');
        return;
      }
      if (msg.fromMe) { patchChat('telegram', chatId, { lastMessage: msg.body, timestamp: msg.timestamp, unreadCount: 0 }); return; }
      playMessageSound(chatId, 'telegram');
      patchChat('telegram', chatId, { lastMessage: msg.body, timestamp: msg.timestamp, unreadCount: (cache.find(c=>c.id===chatId)?.unreadCount || 0) + 1 });
    });
    // Direkt gesendete Nachrichten aus Chat-Fenstern (sofortiges Sidebar-Update)
    const removeSent = api.onSent?.((msg) => {
      const service = msg.service || activeServiceRef.current;
      patchChat(service, msg.chatId, { lastMessage: msg.body, timestamp: msg.timestamp, unreadCount: 0 });
    });
    const removeRead = api.onRead?.((msg) => {
      const service = msg.service || activeServiceRef.current;
      if (!msg?.chatId) return;
      patchChat(service, String(msg.chatId), { unreadCount: 0 });
    });
    return () => { removeWaMsg?.(); removeWaAvatar?.(); removeTgAvatar?.(); removeTgMsg?.(); removeSent?.(); removeRead?.(); if (reloadTimer) clearTimeout(reloadTimer); };
  }, []);

  // Load chats when service / status changes — use cache if available
  useEffect(() => {
    if (!api) return;
    async function load() {
      if (activeService === 'whatsapp' && waStatus === 'ready') {
        // Restore cached profile
        if (waProfileRef.current) setMyProfile(waProfileRef.current);
        // Show cache immediately if available
        if (waCacheRef.current) { setChats(waCacheRef.current); return; }
        setChatsLoading(true);
        const [chatsResult, profile] = await Promise.all([
          api.wa.getChats().catch(() => []),
          api.wa.getMyProfile().catch(() => null),
        ]);
        if (profile) { waProfileRef.current = profile; setMyProfile(profile); }
        // Keep the order provided by the service (server-side ordering)
        waCacheRef.current = (chatsResult || []).slice();
        setChats(waCacheRef.current);
        setChatsLoading(false);
      } else if (activeService === 'telegram' && tgStatus === 'ready') {
        if (tgProfileRef.current) setMyProfile(tgProfileRef.current);
        if (tgCacheRef.current) { setChats(tgCacheRef.current); return; }
        setChatsLoading(true);
        const [dialogs, me] = await Promise.all([
          api.tg.getDialogs().catch(() => []),
          api.tg.getMe().catch(() => null),
        ]);
        if (me) { tgProfileRef.current = me; setMyProfile(me); }
        // Keep the order provided by the service (server-side ordering)
        tgCacheRef.current = (dialogs || []).slice();
        setChats(tgCacheRef.current);
        setChatsLoading(false);
      } else {
        setChats([]);
        setChatsLoading(false);
      }
    }
    load();
    // Background: prefetch participants for top groups so names resolve without opening chats
    (async () => {
      try {
        const cache = activeService === 'whatsapp' ? waCacheRef.current : tgCacheRef.current;
        if (!cache || cache.length === 0) return;
        // Pick top N group chats to limit load
        const groups = cache.filter(c => c.isGroup).slice(0, 12);
        for (const g of groups) {
          try {
            const existing = await api.getStoredParticipants?.(g.id);
            if (existing && existing.length) continue;
            const list = activeService === 'whatsapp' ? await api.wa.getParticipants(g.id) : await api.tg.getParticipants(g.id);
            const arr = Array.isArray(list) ? list : [];
            // fetch and attach avatars where possible
            const withAvatars = await Promise.all(arr.map(async (m) => {
              let avatar = null;
              try { avatar = activeService === 'whatsapp' ? await api.wa.getAvatar(m.id) : await api.tg.getAvatar(m.id); } catch (e) { avatar = null; }
              return { ...m, avatar };
            }));
            if (withAvatars && withAvatars.length) await api.setStoredParticipants?.(g.id, withAvatars);
          } catch (e) { /* ignore individual failures */ }
        }
      } catch (e) {}
    })();
  }, [activeService, waStatus, tgStatus]);

  // Open a separate chat window (ICQ 5 style) + clear unread badge
  const openChat = (chat) => {
    patchChat(activeService, chat.id, { unreadCount: 0 });
    if (activeService === 'whatsapp') api?.wa.markRead?.(chat.id).catch(() => {});
    else api?.tg.markRead?.(chat.id).catch(() => {});
    api?.openChat({ chatId: chat.id, chatName: chat.name || chat.id, service: activeService, avatar: chat.avatar || null, isGroup: !!chat.isGroup });
  };

  const sendFromSidebar = (chatId, text) => {
    // Badge leeren wenn Nutzer antwortet
    setChats(prev => prev.map(c => c.id === chatId ? { ...c, unreadCount: 0 } : c));
  };

  const markGroupsRead = () => {
    const groups = chats.filter(c => c.isGroup && (c.unreadCount || 0) > 0);
    groups.forEach(c => {
      patchChat(activeService, c.id, { unreadCount: 0 });
      if (activeService === 'whatsapp') api?.wa.markRead?.(c.id).catch(() => {});
      else api?.tg.markRead?.(c.id).catch(() => {});
    });
  };

  const handleLogout = async () => {
    if (activeService === 'whatsapp') {
      await api?.wa.logout().catch(() => {});
      setWaStatus('disconnected');
      waCacheRef.current = null;
      waProfileRef.current = null;
    } else {
      await api?.tg.logout().catch(() => {});
      setTgStatus('needs-auth');
      tgCacheRef.current = null;
      tgProfileRef.current = null;
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
      <TitleBar title="ICQ Messenger" showVersion />
      <div className="main-layout">
        <Sidebar
          activeService={activeService}
          setActiveService={setActiveService}
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
          contactScale={contactScale}
          onDecreaseContactScale={() => setContactScale(v => Math.max(0.85, Number((v - 0.05).toFixed(2))))}
          onIncreaseContactScale={() => setContactScale(v => Math.min(1.45, Number((v + 0.05).toFixed(2))))}
        />
      </div>
    </div>
  );
}

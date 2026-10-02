import React, { useState, useEffect } from 'react';
import TitleBar from './components/TitleBar';
import ChatWindow from './components/ChatWindow';
import './App.css';

const api = window.api;

/**
 * Member pictures, four requests at a time. Firing all of them at once (up to 200
 * in a big group) ran into the messengers' rate limits and slowed everything else.
 */
async function withMemberAvatars(members, service, concurrency = 4) {
  const out = members.map(m => ({ ...m, avatar: m.avatar || null }));
  let next = 0;
  const worker = async () => {
    while (next < out.length) {
      const i = next++;
      if (out[i].avatar || !out[i].id) continue;
      try {
        out[i].avatar = (service === 'whatsapp' ? await api.wa.getAvatar(out[i].id) : await api.tg.getAvatar(out[i].id)) || null;
      } catch (e) { out[i].avatar = null; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, out.length) }, worker));
  return out;
}

export default function ChatApp({ chatId, chatName, service, isGroup }) {
  const [messages, setMessages] = useState([]);
  const [chatAvatar, setChatAvatar] = useState(null);
  const [members, setMembers] = useState([]);
  const [isTyping, setIsTyping] = useState(false);
  const typingTimer = React.useRef(null);
  const latestTgMsgIdRef = React.useRef(0);
  const lastReadAtRef = React.useRef(0);
  const readTimerRef = React.useRef(null);
  // Deleted here — a refresh that still carries them must not bring them back.
  const deletedIdsRef = React.useRef(new Set());

  const markChatReadNow = React.useCallback(() => {
    if (!api || !chatId || !service) return;
    // Read means seen: a window behind others does not send blue ticks. The focus
    // handler below marks the chat read once the user actually looks at it.
    if (typeof document !== 'undefined' && document.hasFocus && !document.hasFocus()) return;
    const now = Date.now();
    const wait = 600 - (now - lastReadAtRef.current);
    if (wait > 0) {
      // Throttled — but the second of two quick messages must still get read.
      if (!readTimerRef.current) {
        readTimerRef.current = setTimeout(() => { readTimerRef.current = null; markChatReadNow(); }, wait);
      }
      return;
    }
    lastReadAtRef.current = now;
    if (service === 'whatsapp') api.wa.markRead?.(chatId).catch(() => {});
    else api.tg.markRead?.(chatId).catch(() => {});
    api.notifyRead?.({ chatId: String(chatId), service, timestamp: Math.floor(now / 1000) });
  }, [chatId, service]);

  useEffect(() => () => clearTimeout(readTimerRef.current), []);

  const mergeById = React.useCallback((base, incoming) => {
    const merged = [...base];
    const indexById = new Map();
    for (let i = 0; i < merged.length; i += 1) {
      const id = merged[i]?.id;
      if (id) indexById.set(String(id), i);
    }
    for (const msg of incoming || []) {
      const id = msg?.id;
      if (id && deletedIdsRef.current.has(String(id))) continue;
      if (id && indexById.has(String(id))) {
        const idx = indexById.get(String(id));
        const prev = merged[idx] || {};
        const next = { ...prev, ...msg };
        // Background refreshes may return mediaData=null; keep already loaded media.
        if (prev.mediaData && (msg?.mediaData == null)) next.mediaData = prev.mediaData;
        // Ticks only move forward: a refresh taken before the last receipt must not
        // turn blue ticks grey again.
        if (typeof prev.ack === 'number' && typeof msg?.ack === 'number') next.ack = Math.max(prev.ack, msg.ack);
        merged[idx] = next;
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
        // Through mergeById: it sorts oldest first and keeps anything that arrived
        // live while the load was running (Telegram answers newest first).
        setMessages(prev => mergeById(prev, msgs || []));
        markChatReadNow();
      } catch (e) { console.error('[ChatApp load]', e); }
    }
    loadMessages();
    // Avatar aus Main-Process-Cache holen (wurde beim Öffnen des Chats gecacht)
    if (api?.getStoredAvatar && chatId) {
      api.getStoredAvatar(chatId).then(a => { if (a) setChatAvatar(a); }).catch(() => {});
    }
    // Load participants for groups
    if (isGroup && api && chatId) {
      (async () => {
        try {
          // Try stored participants from main process cache first
          let stored = null;
          try { stored = await api.getStoredParticipants?.(chatId); } catch (e) { stored = null; }
          if (stored && Array.isArray(stored) && stored.length) {
            setMembers(stored);
            // Still refresh in background
            (async () => {
              try {
                const list = service === 'whatsapp' ? await api.wa.getParticipants(chatId) : await api.tg.getParticipants(chatId);
                // Keep the pictures we already have; only new members are fetched.
                const known = new Map(stored.map(m => [String(m.id), m.avatar]));
                const arr = (Array.isArray(list) ? list : []).map(m => ({ ...m, avatar: known.get(String(m.id)) || null }));
                const withAvatars = await withMemberAvatars(arr, service);
                setMembers(withAvatars);
                try { await api.setStoredParticipants?.(chatId, withAvatars); } catch (e) {}
              } catch (e) {}
            })();
            return;
          }

          const list = service === 'whatsapp' ? await api.wa.getParticipants(chatId) : await api.tg.getParticipants(chatId);
          const arr = Array.isArray(list) ? list : [];
          // Names first, pictures as they come in.
          setMembers(arr);
          const withAvatars = await withMemberAvatars(arr, service);
          setMembers(withAvatars);
          try { await api.setStoredParticipants?.(chatId, withAvatars); } catch (e) {}
        } catch (e) { setMembers([]); }
      })();
    }
  }, [chatId, markChatReadNow, service]);

  useEffect(() => {
    if (!api || !chatId || !service) return undefined;
    let stopped = false;
    const reconcile = async () => {
      try {
        const fresh = service === 'whatsapp'
          ? await api.wa.getMessages(chatId, { limit: 40 })
          : await api.tg.getMessages(chatId, { limit: 40 });
        if (!stopped && Array.isArray(fresh) && fresh.length) {
          setMessages(prev => mergeById(prev, fresh));
        }
      } catch (e) { /* keep UI responsive on transient bridge errors */ }
    };
    const warmup = setTimeout(reconcile, 2200);
    // WhatsApp answers from the local store; Telegram asks the server each time,
    // and its live events already deliver new messages — poll it far less often.
    const interval = setInterval(reconcile, service === 'telegram' ? 30000 : 8000);
    return () => {
      stopped = true;
      clearTimeout(warmup);
      clearInterval(interval);
    };
  }, [chatId, mergeById, service]);

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
      // chatAliases: WhatsApp addresses a person by LID or by number; this window
      // may have been opened under either, the bridge files the chat under one.
      const sameChat = (msg.chatAliases || []).includes(String(chatId)) || (msg.fromMe
        ? String(msg.to) === String(chatId)
        : String(msg.from) === String(chatId));
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
      if (service !== 'telegram' || String(msg.chatId) !== String(chatId)) return;
      // Own messages too: sent from the phone they only showed up after a refresh.
      // What this window sent itself merges by id, so nothing appears twice.
      setMessages(prev => mergeById(prev, [msg]));
      if (!msg.fromMe) markChatReadNow();
    });
    // Telegram media follows its message (downloaded in the background). Message ids
    // are only unique per chat, so match the chat too.
    const removeTgMedia = service === 'telegram' && api.tg.onMedia
      ? api.tg.onMedia(({ chatId: cid, msgId, mediaData }) => {
          if (String(cid) !== String(chatId)) return;
          setMessages(prev => prev.map(m => (String(m.id) === String(msgId) ? { ...m, mediaData } : m)));
        })
      : null;
    const removeAck = service === 'whatsapp'
      ? api.wa.onAck(({ id, ack }) => {
          setMessages(prev => prev.map(m => m.id === id ? { ...m, ack } : m));
        })
      : null;
    const removeTyping = service === 'whatsapp' && api.wa.onTyping
      ? api.wa.onTyping(({ chatId: tid, aliases, typing }) => {
          if (tid !== chatId && !(aliases || []).includes(chatId)) return;
          setIsTyping(typing);
          if (typing) {
            clearTimeout(typingTimer.current);
            typingTimer.current = setTimeout(() => setIsTyping(false), 8000);
          }
        })
      : null;
    return () => { removeWa?.(); removeWaMedia?.(); removeTg?.(); removeTgMedia?.(); removeAck?.(); removeTyping?.(); };
  }, [chatId, markChatReadNow, mergeById, service]);

  // Returns true when the message really went out. WhatsApp sends are never
  // auto-retried (a retry can deliver the message twice), so a failure has to be
  // reported back — the composer restores the text instead of eating it.
  const sendMessage = async (text, replyToMsgId = null) => {
    if (!text.trim() || !api) return false;
    try {
      let sent;
      if (service === 'whatsapp') {
        await api.wa.sendMessage(chatId, text, replyToMsgId);
      } else {
        sent = await api.tg.sendMessage(chatId, text, replyToMsgId);
        const localMsg = {
          id: sent?.id || Date.now().toString(),
          body: sent?.body || text,
          fromMe: true,
          timestamp: sent?.timestamp || Math.floor(Date.now() / 1000),
          type: 'text',
        };
        setMessages(prev => mergeById(prev, [localMsg]));
      }
      // Sidebar sofort benachrichtigen
      const ts = Math.floor(Date.now() / 1000);
      api.notifySent?.({ chatId, body: text, timestamp: ts, service });
      return true;
    } catch (e) { console.error('[ChatApp send]', e); return false; }
  };

  const sendFile = async (filePath) => {
    if (!filePath || !api) return;
    try {
      // Create a local preview for image files so sent photos show a preview immediately
      const ext = (filePath.split('.').pop() || '').toLowerCase();
      const isImage = ['jpg','jpeg','png','gif','webp','bmp','svg'].includes(ext);
      let preview = null;
      if (isImage && api.readFileDataUrl) {
        try { preview = await api.readFileDataUrl(filePath); } catch (e) { preview = null; }
      }

      if (service === 'whatsapp') {
        await api.wa.sendFile(chatId, filePath);
      } else {
        const sent = await api.tg.sendFile(chatId, filePath);
        const ts = sent?.timestamp || Math.floor(Date.now() / 1000);
        const name = filePath.split(/[\\/]/).pop();
        const localMsg = {
          id: sent?.id || Date.now().toString(),
          body: sent?.body || `📎 ${name}`,
          fromMe: true,
          timestamp: ts,
          type: isImage ? 'image' : 'file',
          mediaData: preview,
          isGif: ext === 'gif',
        };
        setMessages(prev => mergeById(prev, [localMsg]));
      }
      const ts = Math.floor(Date.now() / 1000);
      const name = filePath.split(/[\\/]/).pop();
      api.notifySent?.({ chatId, body: `📎 ${name}`, timestamp: ts, service });
    } catch (e) { console.error('[ChatApp sendFile]', e); }
  };

  // Voice note from the mic button. Sent exactly once — on failure the user is told
  // (it used to fail silently) and can simply record again.
  const sendVoice = async (base64, mime, waveform) => {
    if (!base64 || !api) return;
    const ts = Math.floor(Date.now() / 1000);
    try {
      if (service === 'whatsapp') {
        // The message itself arrives through the bridge's echo (with its media).
        await api.wa.sendVoice(chatId, base64, mime, waveform);
      } else {
        const sent = await api.tg.sendVoice(chatId, base64, mime, waveform);
        setMessages(prev => mergeById(prev, [{
          id: sent?.id || Date.now().toString(),
          body: '',
          fromMe: true,
          timestamp: sent?.timestamp || ts,
          type: 'ptt',
          // The recording plays fine locally as it was recorded.
          mediaData: `data:${mime || 'audio/webm'};base64,${base64}`,
        }]));
      }
      api.notifySent?.({ chatId, body: '🎤 Sprachnachricht', timestamp: ts, service });
    } catch (e) {
      console.error('[ChatApp sendVoice]', e);
      window.alert(`Sprachnachricht konnte nicht gesendet werden.\n${e?.message || e}`);
    }
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
        setMessages(prev => mergeById(prev, [localMsg]));
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
      deletedIdsRef.current.add(String(message.id));
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
        chat={{ id: chatId, name: chatName, service, avatar: chatAvatar, members, isGroup: !!isGroup }}
        messages={messages}
        onSend={sendMessage}
        onSendFile={sendFile}
        onSendVoice={sendVoice}
        onSendSticker={sendSticker}
        onEditMessage={editMessage}
        onDeleteMessage={deleteMessage}
        onForwardMessage={forwardMessage}
        isTyping={isTyping}
      />
    </div>
  );
}

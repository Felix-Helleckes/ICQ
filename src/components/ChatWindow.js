import React, { useState, useRef, useEffect } from 'react';
import './ChatWindow.css';

function formatTime(ts) {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDateSep(ts) {
  const d = new Date(ts * 1000);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today - 86400000);
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (msgDay.getTime() === today.getTime()) return 'Heute';
  if (msgDay.getTime() === yesterday.getTime()) return 'Gestern';
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function dayKey(ts) {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// ── Games ──────────────────────────────────────────────────
const GAMES = [
  { id: '8ball', name: '8 Ball Pool',   icon: '🎱', url: 'https://bloob.io/de/8ballpool' },
  { id: 'lama',  name: 'Slide-A-Lama',  icon: '🦙', url: 'https://slidealama.eu/' },
];

const EMOJIS = [
  '😀','😂','😍','😎','😭','😅','🥺','😊','😇','🤔','😴','😜','🥳','😬','🤩',
  '👍','👎','👋','🙏','💪','🤝','👀','❤️','💔','🔥','✨','🎉','💯','🌹','🎶',
  '😤','😡','🤯','😱','🤗','😏','🙄','😒','😩','😫',
];

const URL_REGEX = /(https?:\/\/[^\s<>"]+)/g;

function linkify(text) {
  if (!text) return text;
  // Split on newlines first to preserve paragraph breaks, then linkify each line
  return text.split('\n').map((line, lineIdx, lines) => {
    const parts = line.split(URL_REGEX);
    const linked = parts.map((part, i) =>
      URL_REGEX.test(part)
        ? <a key={i} href={part} onClick={e => { e.preventDefault(); window.api?.openExternal?.(part); }} style={{ color: '#4fc3f7', wordBreak: 'break-all' }}>{part}</a>
        : part
    );
    return lineIdx < lines.length - 1 ? [...linked, <br key={`br-${lineIdx}`} />] : linked;
  });
}

// ack: -1=error, 0=pending, 1=sent, 2=delivered, 3=read
function AckIcon({ ack }) {
  if (ack === 0)  return <span className="ack ack-pending" title="Ausstehend">🕐</span>;
  if (ack === -1) return <span className="ack ack-error"   title="Fehler">!</span>;
  if (ack === 3)  return <span className="ack ack-read"    title="Gelesen">✓✓</span>;
  if (ack === 2)  return <span className="ack ack-delivered" title="Zugestellt">✓✓</span>;
  return               <span className="ack ack-sent"    title="Gesendet">✓</span>;
}

function emojiToTwemojiUrl(emoji) {
  const cps = [];
  for (const char of emoji) {
    const cp = char.codePointAt(0);
    if (cp !== undefined) cps.push(cp.toString(16));
  }
  return `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/${cps.join('-')}.png`;
}

function TwemojiEmoji({ emoji, size = 22 }) {
  const [err, setErr] = React.useState(false);
  if (err) return <span style={{ fontSize: size * 0.85, lineHeight: 1 }}>{emoji}</span>;
  return (
    <img
      src={emojiToTwemojiUrl(emoji)}
      alt={emoji}
      width={size}
      height={size}
      draggable={false}
      style={{ verticalAlign: 'middle', display: 'inline-block' }}
      onError={() => setErr(true)}
    />
  );
}

function VoicePlayer({ src }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const fmt = (s) => {
    const t = isFinite(s) ? Math.floor(s) : 0;
    const m = Math.floor(t / 60);
    const sec = t % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) { el.pause(); } else { el.play(); }
  };

  const seek = (e) => {
    const el = audioRef.current;
    if (!el || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    el.currentTime = ratio * duration;
    setCurrentTime(el.currentTime);
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="voice-player">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={e => setDuration(e.target.duration)}
        onTimeUpdate={e => setCurrentTime(e.target.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setCurrentTime(0); if (audioRef.current) audioRef.current.currentTime = 0; }}
      />
      <button className="voice-play-btn" onClick={toggle} title={playing ? 'Pause' : 'Play'}>
        {playing ? '⏸' : '▶'}
      </button>
      <div className="voice-progress-wrap" onClick={seek}>
        <div className="voice-progress-bg">
          <div className="voice-progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <div className="voice-bubbles">
          {Array.from({ length: 28 }, (_, i) => (
            <div
              key={i}
              className="voice-bubble"
              style={{
                height: `${18 + Math.sin(i * 1.3) * 9 + Math.cos(i * 0.7) * 5}px`,
                opacity: (i / 28) * 100 < progress ? 1 : 0.35,
              }}
            />
          ))}
        </div>
      </div>
      <span className="voice-time">{playing || currentTime > 0 ? fmt(currentTime) : fmt(duration)}</span>
    </div>
  );
}

export default function ChatWindow({ chat, messages, onSend, onSendFile, onEditMessage, onDeleteMessage, onForwardMessage, isTyping }) {
  const [text, setText] = useState('');
  const [groupWidth, setGroupWidth] = useState(() => {
    const v = parseInt(localStorage.getItem('group-members-width') || '220', 10);
    return Number.isFinite(v) ? v : 220;
  });
  const resizingRef = useRef(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showGameMenu, setShowGameMenu] = useState(false);
  const gameBtnRef = useRef(null);
  const gameMenuRef = useRef(null);
  const [lightbox, setLightbox] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const [clipboardImage, setClipboardImage] = useState(null); // { dataUrl, ext }
  const [replyToMsgId, setReplyToMsgId] = useState(null);
  const [sendFailed, setSendFailed] = useState(false);
// messageContext removed: use native context menu via main process
  const [editDialog, setEditDialog] = useState({ open: false, msg: null, text: '' });
  const [forwardDialog, setForwardDialog] = useState({ open: false, msg: null, chats: [], loading: false, query: '' });
  // Resizable split: inputHeight in px (min 80, max 400)
  const [inputHeight, setInputHeight] = useState(110);
  const dividerDragRef = useRef(null);
  const bottomRef = useRef(null);
  const inputRef  = useRef(null);
  const emojiRef  = useRef(null);
  const emojiBtnRef = useRef(null);

  // Font-size (shared via localStorage with sidebar)
  const [fontSize, setFontSize] = useState(() => {
    const saved = localStorage.getItem('icq-font-size');
    return saved ? parseInt(saved, 10) : 13;
  });
  useEffect(() => {
    document.documentElement.style.fontSize = fontSize + 'px';
    localStorage.setItem('icq-font-size', fontSize);
  }, [fontSize]);
  const smaller = () => setFontSize(f => Math.max(10, f - 1));
  const larger  = () => setFontSize(f => Math.min(20, f + 1));

  // Resizable divider drag
  useEffect(() => {
    const onMouseMove = (e) => {
      if (resizingRef.current) {
        const win = document.querySelector('.chat-window')?.getBoundingClientRect();
        if (!win) return;
        const newW = Math.max(140, Math.min(420, e.clientX - win.left));
        setGroupWidth(newW);
        return;
      }
      if (!dividerDragRef.current) return;
      const container = dividerDragRef.current.closest('.chat-window');
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const newH = rect.bottom - e.clientY - 1;
      setInputHeight(Math.min(400, Math.max(80, newH)));
    };
    const onMouseUp = () => { dividerDragRef.current = null; };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => { window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('mouseup', onMouseUp); };
  }, []);

  useEffect(() => {
    const onMouseUp = () => { if (resizingRef.current) { resizingRef.current = false; localStorage.setItem('group-members-width', String(groupWidth)); } };
    const onMouseMove = (e) => {
      if (!resizingRef.current) return;
      const win = document.querySelector('.chat-window')?.getBoundingClientRect();
      if (!win) return;
      const newW = Math.max(140, Math.min(420, e.clientX - win.left));
      setGroupWidth(newW);
    };
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('mousemove', onMouseMove);
    return () => { window.removeEventListener('mouseup', onMouseUp); window.removeEventListener('mousemove', onMouseMove); };
  }, [groupWidth]);

  const startResizing = (e) => { e.preventDefault(); resizingRef.current = true; };

  const handleMemberClick = (member) => {
    // open a chat/profile for this user
    if (!member || !member.id) return;
    const svc = chat?.service || 'whatsapp';
    api.openChat({ chatId: member.id, chatName: member.name || member.id, service: svc, avatar: member.avatar || null, isGroup: false });
  };

  const getSenderName = (msg) => {
    if (!msg) return 'Unbekannt';
    if (msg.fromMe) return 'Du';
    if (msg.senderName) return msg.senderName;
    if (msg.author) return msg.author;
    const fromId = String(msg.from || msg.sender || msg.participant || msg.author || '');
    if (chat?.members && fromId) {
      const found = chat.members.find(m => String(m.id) === fromId || String(m.id) === String(msg.participant) || String(m.id) === String(msg.sender));
      if (found) return found.name || found.pushname || found.id;
    }
    return msg.pushName || msg.pushname || fromId || 'Unbekannt';
  };

  // Header avatar: ensure we show stored/fetched avatar for the chat (works for 1:1 chats)
  const [headerAvatar, setHeaderAvatar] = useState(chat?.avatar || null);
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        if (!chat?.id) return;
        if (chat?.avatar) { setHeaderAvatar(chat.avatar); return; }
        const stored = await window.api.getStoredAvatar?.(chat.id).catch(() => null);
        if (mounted && stored) { setHeaderAvatar(stored); return; }
        // fetch from bridge
        let fetched = null;
        try {
          if (chat?.service === 'whatsapp') fetched = await window.api.wa.getAvatar(chat.id);
          else fetched = await window.api.tg.getAvatar(chat.id);
        } catch (e) { fetched = null; }
        if (mounted && fetched) {
          setHeaderAvatar(fetched);
          try { await window.api.setStoredAvatar?.(chat.id, fetched); } catch (e) {}
        }
      } catch (e) {}
    };
    load();
    return () => { mounted = false; };
  }, [chat?.id, chat?.avatar, chat?.service]);

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-focus input when chat changes
  useEffect(() => {
    if (chat) inputRef.current?.focus();
  }, [chat?.id]);

  // Close emoji picker when clicking outside
  useEffect(() => {
    if (!showEmoji) return;
    const onDown = (e) => {
      // Don't close when clicking the toggle button itself — onClick handles that
      if (emojiBtnRef.current?.contains(e.target)) return;
      if (emojiRef.current && !emojiRef.current.contains(e.target)) setShowEmoji(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showEmoji]);

  // Close game menu when clicking outside
  useEffect(() => {
    if (!showGameMenu) return;
    const onDown = (e) => {
      if (gameBtnRef.current?.contains(e.target)) return;
      if (gameMenuRef.current && !gameMenuRef.current.contains(e.target)) setShowGameMenu(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showGameMenu]);

  // ESC closes the current chat window.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.defaultPrevented) return;
      if (clipboardImage) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendClipboardImage();
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setClipboardImage(null);
          return;
        }
      }
      if (e.key === 'Escape') {
        if (lightbox) {
          setLightbox(null);
          return;
        }
        if (forwardDialog.open) {
          setForwardDialog({ open: false, msg: null, chats: [], loading: false, query: '' });
          return;
        }
        if (editDialog.open) {
          setEditDialog({ open: false, msg: null, text: '' });
          return;
        }
        e.preventDefault();
        window.api?.window?.close?.();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [clipboardImage, editDialog.open, forwardDialog.open, lightbox]);

  // Listen for native message context actions from main process
  useEffect(() => {
    const handler = (d) => {
      if (!d || !d.action) return;
      const msg = messages.find(m => String(m.id) === String(d.msgId));
      if (!msg) return;
      if (d.action === 'copy') handleCopyMessage(msg);
      if (d.action === 'reply') handleReplyMessage(msg);
      if (d.action === 'forward') handleForwardMessage(msg);
      if (d.action === 'edit') handleEditMessage(msg);
      if (d.action === 'delete') handleDeleteMessage(msg, true);
    };
    const off = window.api?.onMessageContextAction?.((d) => handler(d));
    return () => { if (off) off(); };
  }, [messages]);

  const handleSend = async () => {
    if (!text.trim()) return;
    const pending = text;
    const pendingReply = replyToMsgId;
    // Clear optimistically so typing feels instant…
    setText('');
    setReplyToMsgId(null);
    setSendFailed(false);
    inputRef.current?.focus();

    const ok = await onSend(pending, pendingReply);
    // …but a send is never retried automatically (a retry can deliver the message
    // twice). If it failed, give the text back rather than silently losing it —
    // unless the user already started typing something new.
    if (ok === false) {
      setText(prev => (prev ? prev : pending));
      setReplyToMsgId(prev => (prev ? prev : pendingReply));
      setSendFailed(true);
      inputRef.current?.focus();
    }
  };

  const handleKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (clipboardImage) { setClipboardImage(null); return; }
      if (lightbox) { setLightbox(null); return; }
      if (forwardDialog.open) { setForwardDialog({ open: false, msg: null, chats: [], loading: false, query: '' }); return; }
      if (editDialog.open) { setEditDialog({ open: false, msg: null, text: '' }); return; }
      window.api?.window?.close?.();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (clipboardImage) {
        sendClipboardImage();
        return;
      }
      handleSend();
    }
  };

  const insertEmoji = (emoji) => {
    setText(t => t + emoji);
    setShowEmoji(false);
    inputRef.current?.focus();
  };

  const handleFileBtn = async () => {
    const filePath = await window.api?.openFileDialog?.();
    if (filePath) onSendFile?.(filePath);
  };

  const startRecording = async () => {
    if (isRecording) return;
    try {
      // Try to pick a stable default microphone explicitly so recordings
      // always come from the expected input device (helps portable setups)
      let constraints = { audio: true };
      try {
        if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const firstAudio = devices.find(d => d.kind === 'audioinput');
          if (firstAudio && firstAudio.deviceId) {
            constraints = { audio: { deviceId: { exact: firstAudio.deviceId } } };
          }
        }
      } catch (e) { /* ignore enumerate errors and fallback to default */ }

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      // Choose best available mime type for voice notes (prefer opus/webm or ogg)
      let mime = '';
      try {
        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) mime = 'audio/webm;codecs=opus';
        else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) mime = 'audio/ogg;codecs=opus';
        else if (MediaRecorder.isTypeSupported('audio/ogg')) mime = 'audio/ogg';
        else if (MediaRecorder.isTypeSupported('audio/webm')) mime = 'audio/webm';
      } catch (e) {}
      const mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      const chunks = [];
      mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      mr.onstop = async () => {
        try {
          const blob = new Blob(chunks, { type: chunks[0]?.type || 'audio/ogg' });
          const array = await blob.arrayBuffer();
          let base64 = '';
          const bytes = new Uint8Array(array);
          let binary = '';
          for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
          base64 = btoa(binary);
          const mime = blob.type || 'audio/ogg';
          // Send to appropriate bridge based on chat.service
          if (chat?.service === 'telegram') {
            try { await window.api?.tg?.sendVoice?.(chat.id, base64, mime); } catch (e) { console.error('[tg sendVoice]', e); }
          } else {
            try { await window.api?.wa?.sendVoice?.(chat.id, base64, mime); } catch (e) { console.error('[wa sendVoice]', e); }
          }
        } catch (e) { console.error('[record stop]', e); }
        // cleanup
        try { streamRef.current?.getTracks()?.forEach(t => t.stop()); } catch (e) {}
        streamRef.current = null;
        recorderRef.current = null;
        setIsRecording(false);
      };
      recorderRef.current = mr;
      mr.start();
      setIsRecording(true);
    } catch (e) {
      console.error('[startRecording]', e);
      alert('Mikrofon-Zugriff benötigt');
    }
  };

  const stopRecording = () => {
    if (!isRecording) return;
    try { recorderRef.current?.stop(); } catch (e) {}
  };

  const handlePaste = (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const blob = item.getAsFile();
        if (!blob) return;
        const ext = item.type === 'image/png' ? 'png' : item.type === 'image/jpeg' ? 'jpg' : 'png';
        const reader = new FileReader();
        reader.onload = () => setClipboardImage({ dataUrl: reader.result, ext });
        reader.readAsDataURL(blob);
        return;
      }
    }
  };

  const sendClipboardImage = async () => {
    if (!clipboardImage) return;
    const base64 = clipboardImage.dataUrl.split(',')[1];
    try {
      const tmpPath = await window.api.saveTempImage(base64, clipboardImage.ext);
      onSendFile?.(tmpPath);
    } catch (e) { console.error('[paste send]', e); }
    setClipboardImage(null);
  };

  // Drag & Drop
  const handleDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = () => setIsDragging(false);
  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const filePath = window.api?.getFilePath?.(file) || file.path;
    if (filePath) onSendFile?.(filePath);
  };

  const openMessageContext = (e, msg) => {
    e.preventDefault();
    e.stopPropagation();
    if (window.api?.showMessageContext) window.api.showMessageContext({ chatId: chat.id, msg, service: chat.service });
  };

  const canEditMessage = (msg) => Boolean(msg?.id && msg?.fromMe && msg?.type === 'text' && (msg?.body || '').trim());

  const handleEditMessage = (msg) => {
    if (!canEditMessage(msg)) return;
    const initial = msg.body || '';
    setEditDialog({ open: true, msg, text: initial });
  };

  const submitEditDialog = async () => {
    const msg = editDialog.msg;
    const next = (editDialog.text || '').trim();
    const initial = (msg?.body || '').trim();
    if (!msg || !next || next === initial) {
      setEditDialog({ open: false, msg: null, text: '' });
      return;
    }
    await onEditMessage?.(msg, next);
    setEditDialog({ open: false, msg: null, text: '' });
  };

  const handleDeleteMessage = async (msg, forEveryone) => {
    if (!msg?.fromMe || !msg?.id) return;
    const text = forEveryone ? 'Diese Nachricht fuer alle loeschen?' : 'Diese Nachricht nur fuer dich loeschen?';
    if (!window.confirm(text)) return;
    await onDeleteMessage?.(msg, forEveryone);
  };

  const handleCopyMessage = async (msg) => {
    const value = (msg?.body || '').trim() || `[${msg?.type || 'message'}]`;
    try {
      await navigator.clipboard.writeText(value);
    } catch (e) {}
  };

  const handleReplyMessage = (msg) => {
    const body = (msg?.body || '').trim();
    if (!body) return;

    // Include sender information for received messages
    const senderInfo = msg.fromMe ? '' : `${msg.senderName || 'Unbekannt'}: `;
    const quote = `> ${senderInfo}${body.replace(/\\n/g, '\\n> ')}\\n`;

    setText(prev => (prev ? `${quote}${prev}` : quote));
    setReplyToMsgId(msg.id);
    inputRef.current?.focus();
  };

  const handleForwardMessage = async (msg) => {
    if (!msg?.body?.trim()) return;
    setForwardDialog({ open: true, msg, chats: [], loading: true, query: '' });
    try {
      const list = chat?.service === 'telegram'
        ? await window.api?.tg?.getDialogs?.()
        : await window.api?.wa?.getChats?.();
      setForwardDialog(prev => ({ ...prev, chats: Array.isArray(list) ? list : [], loading: false }));
    } catch (e) {
      setForwardDialog(prev => ({ ...prev, chats: [], loading: false }));
    }
  };

  const closeForwardDialog = () => setForwardDialog({ open: false, msg: null, chats: [], loading: false, query: '' });

  const chooseForwardTarget = async (targetChat) => {
    if (!targetChat?.id || !forwardDialog.msg) return;
    const ok = await onForwardMessage?.(forwardDialog.msg, String(targetChat.id));
    if (!ok) {
      window.alert('Failed to forward message.');
      return;
    }
    closeForwardDialog();
  };

  const filteredForwardChats = forwardDialog.chats
    .filter(c => String(c.id) !== String(chat?.id))
    .filter(c => {
      const q = (forwardDialog.query || '').trim().toLowerCase();
      if (!q) return true;
      const name = String(c.name || '').toLowerCase();
      const id = String(c.id || '').toLowerCase();
      return name.includes(q) || id.includes(q);
    })
    .slice(0, 120);

  const deleteForAllLabel = chat?.service === 'telegram' ? 'Delete for all' : 'Delete for everyone';
  const deleteForMeLabel = chat?.service === 'telegram' ? 'Delete for me only' : 'Delete for me only';

  if (!chat) {
    return (
      <div className="chat-empty">
        <div className="chat-empty-inner">
          <img src={process.env.PUBLIC_URL + '/icq-logo.png'} className="icq-big-logo" alt="ICQ" />
          <p>Select a conversation to start chatting</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`chat-window${isDragging ? ' drag-over' : ''}`}>
      <div className="chat-layout">
        {chat?.isGroup && Array.isArray(chat?.members) && (
          <div className="group-members" style={{ width: groupWidth }}>
            <div className="group-members-title">Mitglieder</div>
            <div className="group-members-list">
              {chat.members.map(m => (
                <div key={m.id} className="member-item" onClick={() => handleMemberClick(m)} title={m.name || m.id}>
                  <div className="member-avatar">{m.avatar ? <img src={m.avatar} alt="" /> : (m.name||'?')[0]}</div>
                  <div className="member-name">{m.name || m.pushname || m.id}</div>
                  <div className="member-badges">
                    {m.isAdmin && <span className="badge admin" title="Admin">★</span>}
                    {m.online && <span className="badge online" title="Online">●</span>}
                  </div>
                </div>
              ))}
            </div>
            <div className="members-resizer" onMouseDown={startResizing} />
          </div>
        )}
        <div className="chat-main" onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      {/* Drag overlay */}
      {isDragging && (
        <div className="drag-overlay">
          <div className="drag-overlay-inner">📎 Datei hier ablegen</div>
        </div>
      )}

      {/* Chat header */}
      <div className="chat-header">
        <div className="chat-header-avatar">
          {headerAvatar
            ? <img src={headerAvatar} alt="" className="chat-header-avatar-img" />
            : (chat.name || '?')[0].toUpperCase()}
        </div>
        <div className="chat-header-info">
          <div className="chat-header-name-row">
            <span className="chat-header-name">{chat.name || chat.id}</span>
            {isTyping && <span className="chat-typing-indicator">tippt…</span>}
          </div>
        </div>
      </div>
      {/* Message area */}
      <div className="message-area win98-sunken">
        {messages.map((msg, i) => {
          const showDate = msg.timestamp && (
            i === 0 || dayKey(msg.timestamp) !== dayKey(messages[i - 1].timestamp)
          );
          return (
          <React.Fragment key={msg.id || i}>
            {showDate && (
              <div className="date-separator">
                <span>{formatDateSep(msg.timestamp)}</span>
              </div>
            )}
          <div className={`message-row ${msg.fromMe ? 'me' : 'them'}`}>
            {chat?.isGroup && (
              <div className="message-author-row">
                {!msg.fromMe && (
                  <div className="message-author-avatar">
                    {
                      ((): any => {
                        const fromId = String(msg.from || msg.sender || msg.participant || msg.author || '');
                        const found = chat?.members?.find(m => String(m.id) === fromId || String(m.id) === String(msg.participant) || String(m.id) === String(msg.sender));
                        if (found && found.avatar) return <img src={found.avatar} alt={found.name || ''} />;
                        return <span className="author-initial">{(getSenderName(msg)||'?')[0]}</span>;
                      })()
                    }
                  </div>
                )}
                <div className="message-author">{getSenderName(msg)}</div>
              </div>
            )}
            <div className="message-bubble" onContextMenu={(e) => openMessageContext(e, msg)}>
              {msg.mediaData
                ? (msg.type === 'ptt' || msg.type === 'audio')
                  ? <VoicePlayer src={msg.mediaData} />
                : (msg.type === 'video' || msg.isGif)
                  ? <video
                      src={msg.mediaData}
                      className="msg-video"
                      autoPlay={msg.isGif}
                      loop={msg.isGif}
                      controls={!msg.isGif}
                      muted={msg.isGif}
                      playsInline
                      onClick={!msg.isGif ? () => setLightbox({ src: msg.mediaData, isVideo: true }) : undefined}
                      style={!msg.isGif ? { cursor: 'zoom-in' } : undefined}
                    />
                  : <img src={msg.mediaData} alt={msg.type || 'media'}
                      className={msg.type === 'sticker' ? 'msg-sticker' : 'msg-image'}
                      onClick={msg.type !== 'sticker' ? () => setLightbox({ src: msg.mediaData, isVideo: false }) : undefined}
                      style={msg.type !== 'sticker' ? { cursor: 'zoom-in' } : undefined} />
                : <span className="message-text">{linkify(msg.body) || (msg.type ? `[${msg.type}]` : '')}</span>
              }
              <span className="message-time">
                {formatTime(msg.timestamp)}
                {msg.fromMe && msg.ack !== undefined && <AckIcon ack={msg.ack} />}
              </span>
            </div>
          </div>
          </React.Fragment>
          );
        })}
        <div ref={bottomRef} />
      </div>
      </div>
    </div>

      {/* Resizable divider */}
      <div
        className="chat-divider"
        onMouseDown={(e) => { e.preventDefault(); dividerDragRef.current = e.target; }}
        title="Ziehen um Chatbereich zu vergrößern"
      />

      {/* Input area */}
      <div className="input-area" style={{ height: inputHeight, flexShrink: 0 }}>
        <div className="input-toolbar" style={{ position: 'relative' }}>
          <button className="toolbar-btn font-btn" title="Schrift größer" onClick={larger}>A+</button>
          <button className="toolbar-btn font-btn" title="Schrift kleiner" onClick={smaller}>A-</button>
          <button
            ref={emojiBtnRef}
            className={`toolbar-btn${showEmoji ? ' active' : ''}`}
            title="Emoji"
            onClick={() => setShowEmoji(v => !v)}
          ><TwemojiEmoji emoji="😊" size={18} /></button>
          <button className="toolbar-btn" title="Datei senden" onClick={handleFileBtn}>📎</button>
          <button
            ref={gameBtnRef}
            className={`toolbar-btn${showGameMenu ? ' active' : ''}`}
            title="Spiele"
            onClick={() => setShowGameMenu(v => !v)}
          >🎮</button>

          {showGameMenu && (
            <div className="game-menu" ref={gameMenuRef}>
              <div className="game-menu-title">🎮 ICQ Spiele</div>
              {GAMES.map(g => (
                <button
                  key={g.id}
                  className="game-menu-item"
                  onClick={() => { window.api?.openGame?.(g.url, g.name); setShowGameMenu(false); }}
                >
                  <span className="game-menu-icon">{g.icon}</span>
                  <span>{g.name}</span>
                </button>
              ))}
            </div>
          )}

          {showEmoji && (
            <div className="emoji-picker" ref={emojiRef}>
              {EMOJIS.map(e => (
                <button key={e} className="emoji-btn" onClick={() => insertEmoji(e)} title={e}>
                  <TwemojiEmoji emoji={e} size={24} />
                </button>
              ))}
            </div>
          )}

        </div>
        {sendFailed && (
          <div className="send-failed" role="alert">
            ⚠ Nachricht konnte nicht gesendet werden — Text steht noch da, bitte erneut senden.
          </div>
        )}
        <div className="input-row">
          <textarea
            ref={inputRef}
            className="msg-input"
            value={text}
            onChange={e => { setText(e.target.value); if (sendFailed) setSendFailed(false); }}
            onKeyDown={handleKey}
            onPaste={handlePaste}
            placeholder="Nachricht eingeben..."
            rows={2}
            style={{ fontSize: '0.80rem' }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <button
              className={`win98-btn record-btn${isRecording ? ' active' : ''}`}
              title={isRecording ? 'Stop Recording' : 'Voice Message'}
              onClick={() => isRecording ? stopRecording() : startRecording()}
            >{isRecording ? '■' : '🎤'}</button>
            <button className="win98-btn send-btn" onClick={handleSend}>Send</button>
          </div>
        </div>
      </div>

      {/* Clipboard image paste preview */}
      {clipboardImage && (
        <div className="lightbox-overlay" onClick={() => setClipboardImage(null)}>
          <div className="paste-preview" onClick={e => e.stopPropagation()}>
            <p className="paste-preview-title">Bild senden?</p>
            <img src={clipboardImage.dataUrl} alt="Vorschau" className="paste-preview-img" />
            <div className="paste-preview-actions">
              <button className="win98-btn" onClick={sendClipboardImage}>Senden</button>
              <button className="win98-btn" onClick={() => setClipboardImage(null)}>Abbrechen</button>
            </div>
          </div>
        </div>
      )}

      {/* native context menu is used instead of in-UI menu */}

      {editDialog.open && (
        <div className="lightbox-overlay" onClick={() => setEditDialog({ open: false, msg: null, text: '' })}>
          <div className="edit-dialog" onClick={e => e.stopPropagation()}>
            <div className="edit-dialog-title">Nachricht bearbeiten</div>
            <textarea
              className="edit-dialog-input"
              value={editDialog.text}
              onChange={e => setEditDialog(prev => ({ ...prev, text: e.target.value }))}
              rows={4}
              autoFocus
            />
            <div className="edit-dialog-actions">
              <button className="win98-btn" onClick={() => setEditDialog({ open: false, msg: null, text: '' })}>Abbrechen</button>
              <button className="win98-btn" onClick={submitEditDialog}>Speichern</button>
            </div>
          </div>
        </div>
      )}

      {forwardDialog.open && (
        <div className="lightbox-overlay" onClick={closeForwardDialog}>
          <div className="forward-dialog" onClick={e => e.stopPropagation()}>
            <div className="forward-dialog-title">Weiterleiten an...</div>
            <input
              className="forward-search-input"
              value={forwardDialog.query}
              onChange={e => setForwardDialog(prev => ({ ...prev, query: e.target.value }))}
              placeholder="Chat suchen..."
              autoFocus
            />
            <div className="forward-list">
              {forwardDialog.loading && <div className="picker-info">Chats werden geladen...</div>}
              {!forwardDialog.loading && filteredForwardChats.length === 0 && (
                <div className="picker-info">Keine passenden Chats gefunden.</div>
              )}
              {!forwardDialog.loading && filteredForwardChats.map(item => (
                <button key={item.id} className="forward-item" onClick={() => chooseForwardTarget(item)}>
                  <span className="forward-item-name">{item.name || item.id}</span>
                  <span className="forward-item-id">{item.id}</span>
                </button>
              ))}
            </div>
            <div className="edit-dialog-actions">
              <button className="win98-btn" onClick={closeForwardDialog}>Abbrechen</button>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div className="lightbox-overlay" onClick={() => setLightbox(null)}>
          {lightbox.isVideo
            ? <video src={lightbox.src} className="lightbox-img" controls autoPlay
                onClick={e => e.stopPropagation()} />
            : <img src={lightbox.src} className="lightbox-img" alt="Vollbild"
                onClick={e => e.stopPropagation()} />}
          <button className="lightbox-close" onClick={() => setLightbox(null)}>✕</button>
        </div>
      )}
    </div>
  );
}

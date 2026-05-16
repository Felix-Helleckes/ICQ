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

export default function ChatWindow({ chat, messages, onSend, onSendFile, onSendSticker, onEditMessage, onDeleteMessage, onForwardMessage, isTyping }) {
  const [text, setText] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [showStickerPicker, setShowStickerPicker] = useState(false);
  const [stickerTab, setStickerTab] = useState('stickers');
  const [tgStickers, setTgStickers] = useState([]);
  const [tgStickersLoading, setTgStickersLoading] = useState(false);
  const [gifQuery, setGifQuery] = useState('');
  const [gifResults, setGifResults] = useState([]);
  const [gifLoading, setGifLoading] = useState(false);
  const [gifError, setGifError] = useState('');
  const [gifSearched, setGifSearched] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [clipboardImage, setClipboardImage] = useState(null); // { dataUrl, ext }
  const [messageContext, setMessageContext] = useState(null); // { x, y, msg }
  const [editDialog, setEditDialog] = useState({ open: false, msg: null, text: '' });
  const [forwardDialog, setForwardDialog] = useState({ open: false, msg: null, chats: [], loading: false, query: '' });
  // Resizable split: inputHeight in px (min 80, max 400)
  const [inputHeight, setInputHeight] = useState(110);
  const dividerDragRef = useRef(null);
  const bottomRef = useRef(null);
  const inputRef  = useRef(null);
  const emojiRef  = useRef(null);
  const stickerRef = useRef(null);

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
      if (emojiRef.current && !emojiRef.current.contains(e.target)) setShowEmoji(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showEmoji]);

  // Close sticker picker when clicking outside
  useEffect(() => {
    if (!showStickerPicker) return;
    const onDown = (e) => {
      if (stickerRef.current && !stickerRef.current.contains(e.target)) setShowStickerPicker(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showStickerPicker]);

  // ESC closes the current chat window.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (forwardDialog.open) {
          setForwardDialog({ open: false, msg: null, chats: [], loading: false, query: '' });
          return;
        }
        if (editDialog.open) {
          setEditDialog({ open: false, msg: null, text: '' });
          return;
        }
        if (messageContext) {
          setMessageContext(null);
          return;
        }
        e.preventDefault();
        window.api?.window?.close?.();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editDialog.open, forwardDialog.open, messageContext]);

  useEffect(() => {
    if (!messageContext) return undefined;
    const close = () => setMessageContext(null);
    window.addEventListener('mousedown', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [messageContext]);

  const handleSend = () => {
    if (!text.trim()) return;
    onSend(text);
    setText('');
    inputRef.current?.focus();
  };

  const handleKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      window.api?.window?.close?.();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
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

  const loadTelegramStickers = async () => {
    if (chat?.service !== 'telegram') return;
    setTgStickersLoading(true);
    try {
      const items = await window.api?.tg?.getRecentStickers?.(24);
      setTgStickers(Array.isArray(items) ? items : []);
    } catch (e) {
      setTgStickers([]);
    } finally {
      setTgStickersLoading(false);
    }
  };

  const searchGifs = async (q) => {
    const query = (q || gifQuery || '').trim();
    if (!query) {
      setGifResults([]);
      setGifError('');
      setGifSearched(false);
      return;
    }
    setGifSearched(true);
    setGifLoading(true);
    setGifError('');
    try {
      const key = process.env.REACT_APP_GIPHY_API_KEY || 'dc6zaTOxFJmzC';
      const url = `https://api.giphy.com/v1/gifs/search?api_key=${key}&q=${encodeURIComponent(query)}&limit=24&offset=0&rating=pg-13&lang=de`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`GIF search failed (${res.status})`);
      const data = await res.json();
      const items = (data?.data || []).map(r => {
        const preview = r?.images?.fixed_width?.url || r?.images?.downsized_small?.mp4;
        const full = r?.images?.original?.url || r?.images?.downsized?.url || preview;
        return preview || full ? { id: r.id, previewUrl: preview || full, downloadUrl: full } : null;
      }).filter(Boolean);
      setGifResults(items);
    } catch (e) {
      setGifError('GIF-Suche nicht verfuegbar.');
      setGifResults([]);
    } finally {
      setGifLoading(false);
    }
  };

  const handleStickerBtn = async () => {
    const next = !showStickerPicker;
    setShowStickerPicker(next);
    setShowEmoji(false);
    if (!next) return;

    if (chat?.service === 'telegram') {
      if (!tgStickers.length && !tgStickersLoading) loadTelegramStickers();
      setStickerTab('stickers');
    } else {
      setStickerTab('gifs');
    }
  };

  const pickTelegramSticker = (item) => {
    if (!item?.filePath) return;
    onSendSticker?.(item.filePath);
    setShowStickerPicker(false);
    inputRef.current?.focus();
  };

  const pickGif = async (item) => {
    if (!item?.downloadUrl || !window.api?.downloadTempFromUrl) return;
    try {
      const filePath = await window.api.downloadTempFromUrl(item.downloadUrl, 'gif');
      if (filePath) onSendFile?.(filePath);
      setShowStickerPicker(false);
      inputRef.current?.focus();
    } catch (e) {
      console.error('[gif send]', e);
    }
  };

  const openStickerFileDialog = async () => {
    const filePath = await window.api?.openStickerDialog?.();
    if (filePath) onSendSticker?.(filePath);
    setShowStickerPicker(false);
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
    if (!msg?.fromMe) return;
    e.preventDefault();
    setMessageContext({ x: e.clientX, y: e.clientY, msg });
  };

  const canEditMessage = (msg) => Boolean(msg?.id && msg?.fromMe && msg?.type === 'text' && (msg?.body || '').trim());

  const handleEditMessage = (msg) => {
    setMessageContext(null);
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
    setMessageContext(null);
    if (!msg?.fromMe || !msg?.id) return;
    const text = forEveryone ? 'Diese Nachricht fuer alle loeschen?' : 'Diese Nachricht nur fuer dich loeschen?';
    if (!window.confirm(text)) return;
    await onDeleteMessage?.(msg, forEveryone);
  };

  const handleCopyMessage = async (msg) => {
    setMessageContext(null);
    const value = (msg?.body || '').trim() || `[${msg?.type || 'message'}]`;
    try {
      await navigator.clipboard.writeText(value);
    } catch (e) {}
  };

  const handleReplyMessage = (msg) => {
    setMessageContext(null);
    const body = (msg?.body || '').trim();
    if (!body) return;
    const quote = `> ${body.replace(/\n/g, '\n> ')}\n`;
    setText(prev => (prev ? `${quote}${prev}` : quote));
    inputRef.current?.focus();
  };

  const handleForwardMessage = async (msg) => {
    setMessageContext(null);
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
      window.alert('Weiterleiten fehlgeschlagen.');
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

  const deleteForAllLabel = chat?.service === 'telegram' ? 'Bei allen loeschen' : 'Fuer alle loeschen';
  const deleteForMeLabel = chat?.service === 'telegram' ? 'Nur bei mir loeschen' : 'Nur fuer mich loeschen';

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
    <div
      className={`chat-window${isDragging ? ' drag-over' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDragging && (
        <div className="drag-overlay">
          <div className="drag-overlay-inner">📎 Datei hier ablegen</div>
        </div>
      )}

      {/* Chat header */}
      <div className="chat-header">
        <div className="chat-header-avatar">
          {chat.avatar
            ? <img src={chat.avatar} alt="" className="chat-header-avatar-img" />
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
            <div className="message-bubble" onContextMenu={(e) => openMessageContext(e, msg)}>
              {msg.mediaData
                ? (msg.type === 'ptt' || msg.type === 'audio')
                  ? <audio
                      controls
                      src={msg.mediaData}
                      className="msg-audio"
                      preload="metadata"
                    />
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
            className={`toolbar-btn${showEmoji ? ' active' : ''}`}
            title="Emoji"
            onClick={() => setShowEmoji(v => !v)}
          >😊</button>
          <button className={`toolbar-btn${showStickerPicker ? ' active' : ''}`} title="Sticker / GIF" onClick={handleStickerBtn}>🧩</button>
          <button className="toolbar-btn" title="Datei senden" onClick={handleFileBtn}>📎</button>

          {showEmoji && (
            <div className="emoji-picker" ref={emojiRef}>
              {EMOJIS.map(e => (
                <button key={e} className="emoji-btn" onClick={() => insertEmoji(e)}>{e}</button>
              ))}
            </div>
          )}

          {showStickerPicker && (
            <div className="sticker-picker" ref={stickerRef}>
              <div className="sticker-picker-head">
                {chat?.service === 'telegram' && (
                  <button
                    className={`sticker-tab-btn${stickerTab === 'stickers' ? ' active' : ''}`}
                    onClick={() => {
                      setStickerTab('stickers');
                      if (!tgStickers.length) loadTelegramStickers();
                    }}
                  >Telegram Stickers</button>
                )}
                <button
                  className={`sticker-tab-btn${stickerTab === 'gifs' ? ' active' : ''}`}
                  onClick={() => {
                    setStickerTab('gifs');
                  }}
                >GIFs</button>
                <button className="sticker-local-btn" onClick={openStickerFileDialog}>Datei…</button>
              </div>

              {stickerTab === 'gifs' && (
                <div className="gif-search-row">
                  <input
                    className="gif-search-input"
                    value={gifQuery}
                    onChange={e => setGifQuery(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') searchGifs(gifQuery); }}
                    placeholder="GIF suchen..."
                  />
                  <button className="win98-btn" onClick={() => searchGifs(gifQuery)} disabled={gifLoading}>Go</button>
                </div>
              )}

              <div className="sticker-grid">
                {stickerTab === 'stickers' && chat?.service === 'telegram' && tgStickersLoading && (
                  <div className="picker-info">Sticker werden geladen…</div>
                )}
                {stickerTab === 'stickers' && chat?.service === 'telegram' && !tgStickersLoading && tgStickers.length === 0 && (
                  <div className="picker-info">Keine Telegram-Sticker gefunden.</div>
                )}
                {stickerTab === 'stickers' && chat?.service === 'telegram' && tgStickers.map(item => (
                  <button key={item.id} className="sticker-item" onClick={() => pickTelegramSticker(item)} title={item.emoji || 'Sticker'}>
                    {item.type === 'video'
                      ? <video src={item.previewData} className="sticker-thumb" muted loop autoPlay playsInline />
                      : <img src={item.previewData} className="sticker-thumb" alt={item.emoji || 'Sticker'} />}
                    {item.emoji ? <span className="sticker-emoji">{item.emoji}</span> : null}
                  </button>
                ))}

                {stickerTab === 'gifs' && gifLoading && <div className="picker-info">GIFs werden geladen…</div>}
                {stickerTab === 'gifs' && !gifLoading && gifError && (
                  <div className="picker-info">{gifError}</div>
                )}
                {stickerTab === 'gifs' && !gifLoading && !gifError && !gifSearched && (
                  <div className="picker-info">GIF suchen und Enter druecken.</div>
                )}
                {stickerTab === 'gifs' && !gifLoading && gifSearched && !gifError && gifResults.length === 0 && (
                  <div className="picker-info">Keine GIFs gefunden.</div>
                )}
                {stickerTab === 'gifs' && gifResults.map(item => (
                  <button key={item.id} className="sticker-item" onClick={() => pickGif(item)} title="GIF senden">
                    <img src={item.previewUrl} className="sticker-thumb" alt="GIF" loading="lazy" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="input-row">
          <textarea
            ref={inputRef}
            className="msg-input"
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={handleKey}
            onPaste={handlePaste}
            placeholder="Nachricht eingeben..."
            rows={2}
            style={{ fontSize: '0.80rem' }}
          />
          <button className="win98-btn send-btn" onClick={handleSend}>Send</button>
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

      {messageContext && (
        <div
          className="message-context-menu"
          style={{ left: messageContext.x, top: messageContext.y }}
          onMouseDown={e => e.stopPropagation()}
        >
          <button className="message-context-item" onClick={() => handleCopyMessage(messageContext.msg)}>
            Kopieren
          </button>
          {!!(messageContext.msg?.body || '').trim() && (
            <button className="message-context-item" onClick={() => handleReplyMessage(messageContext.msg)}>
              Antworten
            </button>
          )}
          {!!(messageContext.msg?.body || '').trim() && (
            <button className="message-context-item" onClick={() => handleForwardMessage(messageContext.msg)}>
              Weiterleiten
            </button>
          )}
          {canEditMessage(messageContext.msg) && (
            <button className="message-context-item" onClick={() => handleEditMessage(messageContext.msg)}>
              Nachricht bearbeiten
            </button>
          )}
          <button className="message-context-item danger" onClick={() => handleDeleteMessage(messageContext.msg, true)}>
            {deleteForAllLabel}
          </button>
          <button className="message-context-item" onClick={() => handleDeleteMessage(messageContext.msg, false)}>
            {deleteForMeLabel}
          </button>
        </div>
      )}

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

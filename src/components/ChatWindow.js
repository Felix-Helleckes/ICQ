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
  const parts = text.split(URL_REGEX);
  return parts.map((part, i) =>
    URL_REGEX.test(part)
      ? <a key={i} href={part} onClick={e => { e.preventDefault(); window.api?.openExternal?.(part); }} style={{ color: '#4fc3f7', wordBreak: 'break-all' }}>{part}</a>
      : part
  );
}

// ack: -1=error, 0=pending, 1=sent, 2=delivered, 3=read
function AckIcon({ ack }) {
  if (ack === 0)  return <span className="ack ack-pending" title="Ausstehend">🕐</span>;
  if (ack === -1) return <span className="ack ack-error"   title="Fehler">!</span>;
  if (ack === 3)  return <span className="ack ack-read"    title="Gelesen">✓✓</span>;
  if (ack === 2)  return <span className="ack ack-delivered" title="Zugestellt">✓✓</span>;
  return               <span className="ack ack-sent"    title="Gesendet">✓</span>;
}

export default function ChatWindow({ chat, messages, onSend, onSendFile, onSendSticker, isTyping }) {
  const [text, setText] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [showStickerPicker, setShowStickerPicker] = useState(false);
  const [stickerTab, setStickerTab] = useState('stickers');
  const [tgStickers, setTgStickers] = useState([]);
  const [tgStickersLoading, setTgStickersLoading] = useState(false);
  const [gifQuery, setGifQuery] = useState('funny cat');
  const [gifResults, setGifResults] = useState([]);
  const [gifLoading, setGifLoading] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [clipboardImage, setClipboardImage] = useState(null); // { dataUrl, ext }
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
        e.preventDefault();
        window.api?.window?.close?.();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

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
    if (!query) return;
    setGifLoading(true);
    try {
      const key = 'LIVDSRZULELA'; // Tenor demo key
      const url = `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(query)}&key=${key}&limit=24&media_filter=gif,tinygif`;
      const res = await fetch(url);
      const data = await res.json();
      const items = (data?.results || []).map(r => {
        const tiny = r?.media_formats?.tinygif?.url;
        const full = r?.media_formats?.gif?.url || tiny;
        return tiny || full ? { id: r.id, previewUrl: tiny || full, downloadUrl: full } : null;
      }).filter(Boolean);
      setGifResults(items);
    } catch (e) {
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
    if (!gifResults.length) searchGifs(gifQuery);
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
            <div className="message-bubble">
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
                    if (!gifResults.length) searchGifs(gifQuery);
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
                {stickerTab === 'gifs' && !gifLoading && gifResults.length === 0 && (
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

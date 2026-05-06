import React, { useState, useRef, useEffect } from 'react';
import './ChatWindow.css';

function formatTime(ts) {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const EMOJIS = [
  '😀','😂','😍','😎','😭','😅','🥺','😊','😇','🤔','😴','😜','🥳','😬','🤩',
  '👍','👎','👋','🙏','💪','🤝','👀','❤️','💔','🔥','✨','🎉','💯','🌹','🎶',
  '😤','😡','🤯','😱','🤗','😏','🙄','😒','😩','😫',
];

// ack: -1=error, 0=pending, 1=sent, 2=delivered, 3=read
function AckIcon({ ack }) {
  if (ack === 0)  return <span className="ack ack-pending" title="Ausstehend">🕐</span>;
  if (ack === -1) return <span className="ack ack-error"   title="Fehler">!</span>;
  if (ack === 3)  return <span className="ack ack-read"    title="Gelesen">✓✓</span>;
  if (ack === 2)  return <span className="ack ack-delivered" title="Zugestellt">✓✓</span>;
  return               <span className="ack ack-sent"    title="Gesendet">✓</span>;
}

export default function ChatWindow({ chat, messages, onSend, isTyping }) {
  const [text, setText] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [lightbox, setLightbox] = useState(null); // src string or null
  const bottomRef = useRef(null);
  const inputRef  = useRef(null);
  const emojiRef  = useRef(null);

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

  const handleSend = () => {
    if (!text.trim()) return;
    onSend(text);
    setText('');
    inputRef.current?.focus();
  };

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const insertEmoji = (emoji) => {
    setText(t => t + emoji);
    setShowEmoji(false);
    inputRef.current?.focus();
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
    <div className="chat-window">
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
        {messages.map((msg, i) => (
          <div key={msg.id || i} className={`message-row ${msg.fromMe ? 'me' : 'them'}`}>
            <div className="message-bubble">
              {msg.mediaData
                ? (msg.type === 'video' || msg.isGif)
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
                : <span className="message-text">{msg.body || (msg.type ? `[${msg.type}]` : '')}</span>
              }
              <span className="message-time">
                {formatTime(msg.timestamp)}
                {msg.fromMe && msg.ack !== undefined && <AckIcon ack={msg.ack} />}
              </span>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="input-area">
        <div className="input-toolbar" style={{ position: 'relative' }}>
          <button
            className={`toolbar-btn${showEmoji ? ' active' : ''}`}
            title="Emoji"
            onClick={() => setShowEmoji(v => !v)}
          >😊</button>
          <button className="toolbar-btn" title="Bold" style={{ fontWeight: 'bold' }}>B</button>
          <button className="toolbar-btn" title="Italic" style={{ fontStyle: 'italic' }}>I</button>
          <span className="toolbar-sep" />
          <button className="toolbar-btn font-btn" title="Schrift kleiner" onClick={smaller}>A-</button>
          <button className="toolbar-btn font-btn" title="Schrift größer" onClick={larger}>A+</button>

          {showEmoji && (
            <div className="emoji-picker" ref={emojiRef}>
              {EMOJIS.map(e => (
                <button key={e} className="emoji-btn" onClick={() => insertEmoji(e)}>{e}</button>
              ))}
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
            placeholder="Nachricht eingeben..."
            rows={2}
          />
          <button className="win98-btn send-btn" onClick={handleSend}>Send</button>
        </div>
      </div>

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

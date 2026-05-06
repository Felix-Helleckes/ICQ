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

export default function ChatWindow({ chat, messages, onSend }) {
  const [text, setText] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const bottomRef = useRef(null);
  const inputRef  = useRef(null);
  const emojiRef  = useRef(null);

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
          <div className="icq-big-flower">✿</div>
          <p>Select a conversation to start chatting</p>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-window">
      {/* Chat header */}
      <div className="chat-header">
        <div className="chat-header-avatar">{(chat.name || '?')[0].toUpperCase()}</div>
        <div className="chat-header-name">{chat.name || chat.id}</div>
      </div>

      {/* Message area */}
      <div className="message-area win98-sunken">
        {messages.map((msg, i) => (
          <div key={msg.id || i} className={`message-row ${msg.fromMe ? 'me' : 'them'}`}>
            <div className="message-bubble">
              {msg.mediaData
                ? <img src={msg.mediaData} alt={msg.type || 'media'}
                    className={msg.type === 'sticker' ? 'msg-sticker' : 'msg-image'} />
                : <span className="message-text">{msg.body || (msg.type ? `[${msg.type}]` : '')}</span>
              }
              <span className="message-time">{formatTime(msg.timestamp)}</span>
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
    </div>
  );
}

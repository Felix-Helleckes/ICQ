import React, { useState, useEffect } from 'react';
import './Sidebar.css';

const STATUS_COLOR = {
  ready: '#44DD44', 'needs-auth': '#F5C400', 'no-credentials': '#F5C400',
  disconnected: '#CC3333', qr: '#F5C400',
};

function statusLabel(s) {
  return { ready: 'Online', 'needs-auth': 'Login needed', 'no-credentials': 'No API key', disconnected: 'Offline', qr: 'Scan QR' }[s] || s;
}

function ContactItem({ chat, onSelect }) {
  return (
    <div className="contact-item" onClick={() => onSelect(chat)}>
      <div className="contact-avatar">
        {chat.avatar
          ? <img src={chat.avatar} alt={chat.name} className="contact-avatar-img" />
          : (chat.name || '?')[0].toUpperCase()
        }
      </div>
      <div className="contact-info">
        <div className="contact-name">{chat.name || chat.id}</div>
        <div className="contact-last">{chat.lastMessage || '\u00a0'}</div>
      </div>
      {chat.unreadCount > 0 && (
        <div className="unread-badge">{chat.unreadCount}</div>
      )}
    </div>
  );
}

function GroupSection({ groups, onSelect, groupSound, onToggleGroupSound }) {
  const [expanded, setExpanded] = useState(false);
  const totalUnread = groups.reduce((s, c) => s + (c.unreadCount || 0), 0);

  return (
    <div className="group-section">
      <div className="group-header" onClick={() => setExpanded(v => !v)}>
        <span className="group-arrow">{expanded ? '▾' : '▸'}</span>
        <span className="group-label">Gruppen</span>
        {groups.length > 0 && <span className="group-count">({groups.length})</span>}
        {totalUnread > 0 && <span className="group-unread-badge">{totalUnread}</span>}
        <button
          className={`group-sound-btn${groupSound ? '' : ' muted'}`}
          title={groupSound ? 'Gruppen-Sound aus' : 'Gruppen-Sound an'}
          onClick={e => { e.stopPropagation(); onToggleGroupSound(); }}
        >{groupSound ? '🔔' : '🔕'}</button>
      </div>
      {expanded && groups.map(chat => (
        <ContactItem key={chat.id} chat={chat} onSelect={onSelect} />
      ))}
    </div>
  );
}

export default function Sidebar({
  activeService, setActiveService,
  waStatus, tgStatus,
  chats, chatsLoading, onSelectChat,
  loginPanel,
  myProfile,
  onLogout,
  soundEnabled, onToggleSound,
  waGroupSound, tgGroupSound,
  onToggleWaGroupSound, onToggleTgGroupSound,
}) {
  const [search, setSearch] = useState('');
  const currentStatus = activeService === 'whatsapp' ? waStatus : tgStatus;
  const groupSound = activeService === 'whatsapp' ? waGroupSound : tgGroupSound;
  const onToggleGroupSound = activeService === 'whatsapp' ? onToggleWaGroupSound : onToggleTgGroupSound;

  // ── Font-size scaling ──────────────────────────────────────
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
  // ──────────────────────────────────────────────────────────

  const filtered = chats.filter(c =>
    !search || (c.name || '').toLowerCase().includes(search.toLowerCase())
  );
  const groups   = filtered.filter(c => c.isGroup);
  const contacts = filtered.filter(c => !c.isGroup);

  return (
    <div className="sidebar">
      {/* ICQ 5 user header */}
      <div className="user-header">
        <div className="user-avatar">
          {myProfile?.avatar
            ? <img src={myProfile.avatar} className="contact-avatar-img" alt="" />
            : '✿'}
        </div>
        <div className="user-info">
          <div className="user-name">{myProfile?.name || 'ICQ Messenger'}</div>
          <div className="user-status" style={{ color: STATUS_COLOR[currentStatus] }}>
            ● {statusLabel(currentStatus)}
          </div>
        </div>
        {onToggleSound && (
          <button
            className={`sound-btn${soundEnabled ? '' : ' muted'}`}
            onClick={onToggleSound}
            title={soundEnabled ? 'Sound aus' : 'Sound an'}
          >{soundEnabled ? '🔔' : '🔕'}</button>
        )}
        {onLogout && (
          <button className="logout-btn" onClick={onLogout} title="Logout">⏏</button>
        )}
      </div>

      {/* Service tabs */}
      <div className="service-tabs">
        <button
          className={`svc-tab ${activeService === 'whatsapp' ? 'active' : ''}`}
          onClick={() => setActiveService('whatsapp')}
          title="WhatsApp"
        >
          <img src="/whatsapp-logo.svg" className="svc-logo" alt="WhatsApp" />
          <span className="svc-label">WhatsApp</span>
          <span className="svc-dot" style={{ background: STATUS_COLOR[waStatus] }} />
        </button>
        <button
          className={`svc-tab ${activeService === 'telegram' ? 'active' : ''}`}
          onClick={() => setActiveService('telegram')}
          title="Telegram"
        >
          <img src="/telegram-logo.svg" className="svc-logo" alt="Telegram" />
          <span className="svc-label">Telegram</span>
          <span className="svc-dot" style={{ background: STATUS_COLOR[tgStatus] }} />
        </button>
      </div>

      {/* Main area: login OR contact list */}
      {loginPanel ? loginPanel : (
        <>
          {/* Search bar */}
          <div className="search-bar">
            <input
              className="search-input"
              type="text"
              placeholder="Search contacts..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          {/* Contact list */}
          <div className="contact-list">
            {chatsLoading && (
              <div className="no-contacts loading">Lädt Chats…</div>
            )}
            {!chatsLoading && filtered.length === 0 && (
              <div className="no-contacts">
                {currentStatus === 'ready' ? 'No chats found' : 'Not connected yet'}
              </div>
            )}
            {/* Collapsible groups section */}
            {!chatsLoading && groups.length > 0 && (
              <GroupSection
                groups={groups}
                onSelect={onSelectChat}
                groupSound={groupSound}
                onToggleGroupSound={onToggleGroupSound}
              />
            )}
            {/* Direct chats */}
            {contacts.map(chat => (
              <ContactItem key={chat.id} chat={chat} onSelect={onSelectChat} />
            ))}
          </div>
        </>
      )}

      {/* Bottom toolbar */}
      <div className="sidebar-toolbar">
        <button className="toolbar-btn" title="Add Contact">➕</button>
        <button className="toolbar-btn" title="Settings">⚙️</button>
        <button className="toolbar-btn" title="Status">✿</button>
        <div className="toolbar-sep" />
        <button className="toolbar-btn font-btn" title="Schrift kleiner" onClick={smaller}>A-</button>
        <button className="toolbar-btn font-btn" title="Schrift größer"  onClick={larger}>A+</button>
      </div>
    </div>
  );
}
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

function GroupSection({ groups, onSelect, groupSound, onToggleGroupSound, onMarkGroupsRead }) {
  const [expanded, setExpanded] = useState(false);
  const [ctxMenu, setCtxMenu] = useState(null);
  const totalUnread = groups.reduce((s, c) => s + (c.unreadCount || 0), 0);

  const handleContextMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  };

  const closeMenu = () => setCtxMenu(null);

  return (
    <div className="group-section">
      <div className="group-header" onClick={() => setExpanded(v => !v)} onContextMenu={handleContextMenu}>
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
      {ctxMenu && (
        <>
          <div className="ctx-overlay" onClick={closeMenu} />
          <div className="ctx-menu" style={{ top: ctxMenu.y, left: ctxMenu.x }}>
            <button className="ctx-item" onClick={() => { onMarkGroupsRead?.(); closeMenu(); }}>
              ✓ Alle als gelesen markieren
            </button>
          </div>
        </>
      )}
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
  onMarkGroupsRead,
}) {
  const [search, setSearch] = useState('');
  const currentStatus = activeService === 'whatsapp' ? waStatus : tgStatus;
  const groupSound = activeService === 'whatsapp' ? waGroupSound : tgGroupSound;
  const onToggleGroupSound = activeService === 'whatsapp' ? onToggleWaGroupSound : onToggleTgGroupSound;

  // Skalierung wirkt auf gesamte Sidebar inkl. Buttons, Header, Toolbar
  const [listScale, setListScale] = useState(() => {
    const saved = Number(localStorage.getItem('icq-contact-scale'));
    return Number.isFinite(saved) && saved > 0 ? saved : 1;
  });
  useEffect(() => {
    localStorage.setItem('icq-contact-scale', String(listScale));
  }, [listScale]);
  const smaller = () => setListScale(v => Math.max(0.85, Number((v - 0.05).toFixed(2))));
  const larger  = () => setListScale(v => Math.min(1.45, Number((v + 0.05).toFixed(2))));

  const filtered = chats.filter(c =>
    !search || (c.name || '').toLowerCase().includes(search.toLowerCase())
  );
  const groups   = filtered.filter(c => c.isGroup);
  const contacts = filtered.filter(c => !c.isGroup);

  return (
    <div className="sidebar" style={{ '--contact-scale': listScale }}>
      {/* ICQ 5 user header */}
      <div className="user-header">
        <div className="user-avatar">
          {myProfile?.avatar
            ? <img src={myProfile.avatar} className="contact-avatar-img" alt="" />
            : '✿'}
        </div>
        <div className="user-info">
          <div className="user-name">{myProfile?.name || 'Retrogram'}</div>
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
        <button className="scale-btn" title="Kontakte kleiner" onClick={smaller}>A-</button>
        <button className="scale-btn" title="Kontakte größer" onClick={larger}>A+</button>
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
          <img src={process.env.PUBLIC_URL + '/whatsapp-logo.svg'} className="svc-logo" alt="WhatsApp" />
          <span className="svc-label">WhatsApp</span>
          <span className="svc-dot" style={{ background: STATUS_COLOR[waStatus] }} />
        </button>
        <button
          className={`svc-tab ${activeService === 'telegram' ? 'active' : ''}`}
          onClick={() => setActiveService('telegram')}
          title="Telegram"
        >
          <img src={process.env.PUBLIC_URL + '/telegram-logo.svg'} className="svc-logo" alt="Telegram" />
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
                onMarkGroupsRead={onMarkGroupsRead}
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
      </div>
    </div>
  );
}
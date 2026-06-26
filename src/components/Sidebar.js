import React, { useState, useRef, useEffect } from 'react';
import './Sidebar.css';
import { SKINS, setSkin, getSavedSkinId } from '../skins';

const GAMES = [
  { id: '8ball', name: '8 Ball Pool',  icon: '🎱', url: 'https://bloob.io/de/8ballpool' },
  { id: 'lama',  name: 'Slide-A-Lama', icon: '🦙', url: 'https://slidealama.eu/' },
];

// Where the in-app "support" button sends people.
const DONATE_URL = 'https://paypal.me/sparky512';

const STATUS_COLOR = {
  ready: '#44DD44', 'needs-auth': '#F5C400', 'no-credentials': '#F5C400',
  disconnected: '#CC3333', qr: '#F5C400',
};

function statusLabel(s) {
  return {
    ready: 'Online',
    loading: 'Reconnecting…',
    'needs-auth': 'Login needed',
    'no-credentials': 'No API key',
    disconnected: 'Offline',
    qr: 'Scan QR',
  }[s] || s;
}

function ContactItem({ chat, onSelect, service }) {
  // Only use chat.avatar as initial state if it's already a data URL (Telegram).
  // HTTP(S) URLs from WhatsApp expire and are written as broken files — always
  // prefer the persisted disk cache; fall back to bridge fetch if nothing stored.
  const [avatar, setAvatar] = React.useState(
    chat.avatar && chat.avatar.startsWith('data:') ? chat.avatar : null
  );

  const handleContext = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (window.api?.showContactContext) window.api.showContactContext({ id: chat.id, service, archived: !!chat.archived, name: chat.name, isGroup: !!chat.isGroup });
  };

  React.useEffect(() => {
    let mounted = true;
    const load = async () => {
      if (avatar) return;
      try {
        const stored = await window.api.getStoredAvatar?.(chat.id);
        if (mounted && stored) { setAvatar(stored); return; }
        // fetch from bridge
        let fetched = null;
        try {
          if (service === 'whatsapp') fetched = await window.api.wa.getAvatar(chat.id);
          else fetched = await window.api.tg.getAvatar(chat.id);
        } catch (e) { fetched = null; }
        if (mounted && fetched) {
          setAvatar(fetched);
          try { await window.api.setStoredAvatar?.(chat.id, fetched); } catch (e) {}
        }
      } catch (e) {}
    };
    load();
    return () => { mounted = false; };
  }, [chat.id, service, avatar]);
  return (
    <div className="contact-item" onClick={() => onSelect(chat)} onContextMenu={handleContext}>
      <div className="contact-avatar">
        {avatar
          ? <img src={avatar} alt={chat.name} className="contact-avatar-img" />
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

function ArchivedSection({ archived, onSelect, onMarkArchivedRead, service }) {
  const [expanded, setExpanded] = useState(false);
  const [ctxMenu, setCtxMenu] = useState(null);
  const totalUnread = archived.reduce((s, c) => s + (c.unreadCount || 0), 0);

  const handleContextMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  };
  const closeMenu = () => setCtxMenu(null);

  if (!archived || archived.length === 0) return null;
  return (
    <div className="group-section">
      <div className="group-header" onClick={() => setExpanded(v => !v)} onContextMenu={handleContextMenu}>
        <span className="group-arrow">{expanded ? '▾' : '▸'}</span>
        <span className="group-label">Archiviert</span>
        {archived.length > 0 && <span className="group-count">({archived.length})</span>}
        {totalUnread > 0 && <span className="group-unread-badge">{totalUnread}</span>}
      </div>
      {expanded && archived.map(chat => (
        <ContactItem key={chat.id} chat={chat} onSelect={onSelect} service={service} />
      ))}
      {ctxMenu && (
        <>
          <div className="ctx-overlay" onClick={closeMenu} />
          <div className="ctx-menu" style={{ top: ctxMenu.y, left: ctxMenu.x }}>
            <button className="ctx-item" onClick={() => { onMarkArchivedRead?.(); closeMenu(); }}>
              ✓ Alle als gelesen markieren
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function GroupSection({ groups, onSelect, groupSound, onToggleGroupSound, onMarkGroupsRead, service }) {
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
        <ContactItem key={chat.id} chat={chat} onSelect={onSelect} service={service} />
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
  onMarkArchivedRead,
  contactScale,
  onDecreaseContactScale,
  onIncreaseContactScale,
}) {
  const [search, setSearch] = useState('');
  const [showGameMenu, setShowGameMenu] = useState(false);
  const gameBtnRef = useRef(null);
  const gameMenuRef = useRef(null);
  const [showSkinMenu, setShowSkinMenu] = useState(false);
  const [skinId, setSkinId] = useState(() => getSavedSkinId());
  const skinBtnRef = useRef(null);
  const skinMenuRef = useRef(null);

  useEffect(() => {
    if (!showGameMenu) return;
    const onDown = (e) => {
      if (gameBtnRef.current?.contains(e.target)) return;
      if (gameMenuRef.current && !gameMenuRef.current.contains(e.target)) setShowGameMenu(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showGameMenu]);

  useEffect(() => {
    if (!showSkinMenu) return;
    const onDown = (e) => {
      if (skinBtnRef.current?.contains(e.target)) return;
      if (skinMenuRef.current && !skinMenuRef.current.contains(e.target)) setShowSkinMenu(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showSkinMenu]);

  const chooseSkin = (id) => {
    setSkin(id);
    setSkinId(id);
    setShowSkinMenu(false);
  };

  const currentStatus = activeService === 'whatsapp' ? waStatus : tgStatus;
  const groupSound = activeService === 'whatsapp' ? waGroupSound : tgGroupSound;
  const onToggleGroupSound = activeService === 'whatsapp' ? onToggleWaGroupSound : onToggleTgGroupSound;

  const filtered = chats.filter(c =>
    !search || (c.name || '').toLowerCase().includes(search.toLowerCase())
  );
  const groups   = filtered.filter(c => c.isGroup && !c.archived);
  const archived = filtered.filter(c => c.archived);
  const contacts = filtered.filter(c => !c.isGroup && !c.archived);

  return (
    <div className="sidebar" style={{ '--contact-scale': contactScale ?? 1 }}>
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
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button
            ref={gameBtnRef}
            className={`sound-btn${showGameMenu ? ' active' : ''}`}
            title="Spiele"
            onClick={() => setShowGameMenu(v => !v)}
          >🎮</button>
          {showGameMenu && (
            <div className="sidebar-game-menu" ref={gameMenuRef}>
              <div className="sidebar-game-menu-title">🎮 ICQ Spiele</div>
              {GAMES.map(g => (
                <button
                  key={g.id}
                  className="sidebar-game-menu-item"
                  onClick={() => { window.api?.openGame?.(g.url, g.name); setShowGameMenu(false); }}
                >
                  <span>{g.icon}</span>
                  <span>{g.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button
            ref={skinBtnRef}
            className={`sound-btn${showSkinMenu ? ' active' : ''}`}
            title="Skin wählen"
            onClick={() => setShowSkinMenu(v => !v)}
          >🎨</button>
          {showSkinMenu && (
            <div className="sidebar-game-menu" ref={skinMenuRef}>
              <div className="sidebar-game-menu-title">🎨 Skin</div>
              {SKINS.map(s => (
                <button
                  key={s.id}
                  className={`sidebar-game-menu-item${s.id === skinId ? ' active' : ''}`}
                  onClick={() => chooseSkin(s.id)}
                >
                  <span className="skin-swatch" style={{ background: s.swatch }} />
                  <span>{s.name}</span>
                  {s.id === skinId && <span style={{ marginLeft: 'auto' }}>✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        <button className="scale-btn" title="Kontakte kleiner" onClick={onDecreaseContactScale}>A-</button>
        <button className="scale-btn" title="Kontakte größer" onClick={onIncreaseContactScale}>A+</button>
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
            {activeService === 'whatsapp' && currentStatus === 'loading' && (
              <div className="service-reconnecting" role="status" aria-live="polite">
                WhatsApp verbindet neu…
              </div>
            )}
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
                service={activeService}
              />
            )}
            {/* Collapsible archived section (like groups) */}
            {!chatsLoading && archived.length > 0 && (
              <ArchivedSection archived={archived} onSelect={onSelectChat} onMarkArchivedRead={onMarkArchivedRead} service={activeService} />
            )}
            {/* Direct chats */}
            {contacts.map(chat => (
              <ContactItem key={chat.id} chat={chat} onSelect={onSelectChat} service={activeService} />
            ))}
          </div>
        </>
      )}

      {/* Support / donate footer — opens the donation page in the browser */}
      <button
        className="donate-footer"
        onClick={() => window.api?.openExternal?.(DONATE_URL)}
        title="Projekt unterstützen"
      >
        <span className="donate-heart">♥</span>
        <span>Projekt unterstützen</span>
      </button>
    </div>
  );
}
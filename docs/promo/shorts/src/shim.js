/* Injected into every frame before the app's own scripts (Playwright addInitScript).
   Inside the app frames (build/index.html) it provides the window.api that the real
   preload.js would expose in Electron, backed by the demo state the stage keeps in
   window.top.__ICQ. The top-level stage page is left alone.
   Note: Chrome reuses an iframe's initial about:blank Window for the first same-origin
   navigation, so this script may run while location is still about:blank — everything
   that depends on the URL therefore waits for DOMContentLoaded. */
(function () {
  if (window === window.top) return;
  var T = window.top;
  var S;
  try { S = T.__ICQ; } catch (e) { return; }
  if (!S) return;

  // Every window starts with the skin the scene asks for (the app reads it before first paint).
  try { localStorage.setItem('icq-skin', S.initialSkin || 'retro-teal'); } catch (e) {}
  try { localStorage.setItem('icq-sound', 'on'); } catch (e) {}
  try { localStorage.removeItem('icq-contact-scale'); } catch (e) {}
  try { localStorage.setItem('icq-consent', 'no'); } catch (e) {}   // landing page: no cookie banner, no analytics

  var listeners = {};
  function on(ev) {
    return function (cb) {
      (listeners[ev] = listeners[ev] || []).push(cb);
      return function () { listeners[ev] = (listeners[ev] || []).filter(function (f) { return f !== cb; }); };
    };
  }
  function emit(ev, data) {
    (listeners[ev] || []).slice().forEach(function (cb) { try { cb(data); } catch (e) { console.error(e); } });
  }
  window.__emit = emit;

  function P(v) { return Promise.resolve(v); }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  window.api = {
    wa: {
      getQR: function () { return P(S.wa.qr); },
      getChats: function () { return P(clone(S.wa.chats)); },
      getMessages: function (id) { return P(clone(S.wa.messages[id] || [])); },
      sendMessage: function (id, text) { S.send('whatsapp', id, text); return P(true); },
      sendFile: function () { return P(); }, sendSticker: function () { return P(); }, sendVoice: function () { return P(); },
      getParticipants: function () { return P([]); },
      editMessage: function () { return P(); }, deleteMessage: function () { return P(); },
      markRead: function () { return P(true); },
      getStatus: function () { return P(S.wa.status); },
      getMyProfile: function () { return P(clone(S.wa.profile)); },
      getAvatar: function () { return P(null); },
      logout: function () { return P(); }, reconnect: function () { return P(); }, pairNewDevice: function () { return P(); },
      getSync: function () { return P(false); },
      onSync: on('wa:sync'), onQR: on('wa:qr'), onReady: on('wa:ready'), onMessage: on('wa:message'),
      onAvatar: on('wa:avatar'), onChatUpdate: on('wa:chat-update'), onChatsUpdated: on('wa:chats-updated'),
      onMedia: on('wa:media'), onAck: on('wa:ack'), onTyping: on('wa:typing'),
      showContactContext: function () { return P(); }, showMessageContext: function () { return P(); },
      onMessageContextAction: on('message-context-action'),
    },
    tg: {
      requestCode: function () { return P('hash'); }, signIn: function () { return P(); },
      startQRLogin: function () { S.tgQRLogin(); return P(); },
      submit2FA: function () { return P(); },
      getDialogs: function () { return P(clone(S.tg.chats)); },
      getMessages: function (id) { return P(clone(S.tg.messages[id] || [])); },
      sendMessage: function (id, text) { return P(S.send('telegram', id, text)); },
      sendFile: function () { return P(); }, sendSticker: function () { return P(); }, sendVoice: function () { return P(); },
      getParticipants: function () { return P([]); },
      editMessage: function () { return P(); }, deleteMessage: function () { return P(); },
      getRecentStickers: function () { return P([]); },
      markRead: function () { return P(true); },
      getStatus: function () { return P(S.tg.status); },
      getMe: function () { return P(clone(S.tg.profile)); },
      getAvatar: function () { return P(null); },
      logout: function () { return P(); }, setCredentials: function () { return P(); },
      onMessage: on('tg:message'), onAvatar: on('tg:avatar'), onChatUpdate: on('tg:chat-update'), onMedia: on('tg:media'),
      onQR: on('tg:qr'), onReady: on('tg:ready'), on2FANeeded: on('tg:2fa-needed'),
    },
    openChat: function (p) { S.openChat(p); return P(); },
    getStoredAvatar: function () { return P(null); },
    notifySent: function (m) { S.broadcast('chat:sent-broadcast', m); },
    notifyRead: function (m) { S.broadcast('chat:read-broadcast', m); },
    onSent: on('chat:sent-broadcast'), onRead: on('chat:read-broadcast'),
    showContactContext: function () { return P(); }, showMessageContext: function () { return P(); },
    onMessageContextAction: on('message-context-action'),
    window: { minimize: function () {}, maximize: function () {}, close: function () { S.closeWindow(window); } },
    openExternal: function () {},
    openGame: function (url, title) { S.openGame(url, title); return P(); },
    setSkin: function (id) { S.setSkin(id, window); },
    onSkinChange: on('skin:changed'),
    openFileDialog: function () { return P(null); },
    saveTempImage: function () { return P(null); }, readFileDataUrl: function () { return P(null); },
    setStoredAvatar: function () { return P(); }, setStoredParticipants: function () { return P(); },
    getStoredParticipants: function () { return P(null); },
    appVersion: '1.1.1',
    getFilePath: function () { return null; },
  };

  // The app plays its sounds through new Audio(src).play(); log them for the soundtrack instead.
  var RealAudio = window.Audio;
  window.Audio = function (src) {
    var a = new RealAudio();
    if (src) a.src = src;
    a.play = function () { S.logSound(String(a.src || src || '')); return Promise.resolve(); };
    return a;
  };

  // The chat window scrolls to its newest message with behaviour "smooth". That animation
  // runs on the real clock, which page.clock.install() has frozen, so a message sent or
  // received mid-clip would never scroll into view. Jump straight there instead.
  var realScrollIntoView = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function (arg) {
    if (arg && typeof arg === 'object') arg = Object.assign({}, arg, { behavior: 'instant' });
    return realScrollIntoView.call(this, arg);
  };

  // Registration has to survive Chrome reusing an iframe's initial about:blank Window for
  // the first same-origin navigation: in that case DOMContentLoaded has already fired by
  // the time this script runs, so waiting for it would silently never register the frame
  // and the stage could not push messages into it. Register from whichever hook comes
  // first; registerFrame() in the engine ignores a window it already knows.
  var booted = false;
  function boot() {
    if (booted || !document.head || /^about:/.test(location.href)) return;
    booted = true;
    var isApp = /build[\\/]index\.html/.test(location.href);
    var params = new URLSearchParams(location.search);
    window.__frameName = isApp ? (params.get('mode') === 'chat' ? ('chat:' + params.get('chatId')) : 'cl') : 'site';
    S.registerFrame(window, window.__frameName);
    // Kill CSS transitions (they run on the real clock, not the stepped one). Keyframe
    // animations stay; the stage pauses and positions them per frame.
    var st = document.createElement('style');
    st.textContent = isApp
      ? '*{transition:none!important} .wa-spinner,.no-contacts.loading{animation-play-state:paused!important}'
      : '*{transition:none!important; animation-play-state:paused!important}';
    document.head.appendChild(st);
  }
  window.__register = boot;                       // the window manager calls this on iframe load
  document.addEventListener('DOMContentLoaded', boot);
  document.addEventListener('readystatechange', boot);
  if (document.readyState !== 'loading') boot();
})();

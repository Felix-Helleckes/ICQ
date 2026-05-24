const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // WhatsApp
  wa: {
    getQR:       ()              => ipcRenderer.invoke('wa:get-qr'),
    getChats:    ()              => ipcRenderer.invoke('wa:get-chats'),
    getMessages: (chatId, opts)  => ipcRenderer.invoke('wa:get-messages', chatId, opts),
    sendMessage: (chatId, text)  => ipcRenderer.invoke('wa:send-message', chatId, text),
    sendFile:    (chatId, path)  => ipcRenderer.invoke('wa:send-file', chatId, path),
    sendSticker: (chatId, path)  => ipcRenderer.invoke('wa:send-sticker', chatId, path),
    sendVoice:   (chatId, base64, mime) => ipcRenderer.invoke('wa:send-voice', chatId, base64, mime),
    editMessage: (chatId, messageId, newText) => ipcRenderer.invoke('wa:edit-message', chatId, messageId, newText),
    deleteMessage: (chatId, messageId, forEveryone = true) => ipcRenderer.invoke('wa:delete-message', chatId, messageId, forEveryone),
    markRead:    (chatId)        => ipcRenderer.invoke('wa:mark-read', chatId),
    getStatus:   ()              => ipcRenderer.invoke('wa:status'),
    getMyProfile:()              => ipcRenderer.invoke('wa:get-my-profile'),
    getAvatar:   (id)            => ipcRenderer.invoke('wa:get-avatar', id),
    logout:      ()              => ipcRenderer.invoke('wa:logout'),
    reconnect:   ()              => ipcRenderer.invoke('wa:reconnect'),
    onQR:        (cb)            => ipcRenderer.on('wa:qr', (_, data) => cb(data)),
    onReady:     (cb)            => ipcRenderer.on('wa:ready', (_, data) => cb(data)),
    onMessage:   (cb)            => {
      const handler = (_, data) => cb(data);
      ipcRenderer.on('wa:message', handler);
      return () => ipcRenderer.removeListener('wa:message', handler);
    },
    onAvatar:    (cb)            => {
      const handler = (_, data) => cb(data);
      ipcRenderer.on('wa:avatar', handler);
      return () => ipcRenderer.removeListener('wa:avatar', handler);
    },
    onChatUpdate: (cb)            => {
      const handler = (_, data) => cb(data);
      ipcRenderer.on('wa:chat-update', handler);
      return () => ipcRenderer.removeListener('wa:chat-update', handler);
    },
    onMedia:     (cb)            => {
      const handler = (_, data) => cb(data);
      ipcRenderer.on('wa:media', handler);
      return () => ipcRenderer.removeListener('wa:media', handler);
    },
    onAck:       (cb)            => {
      const handler = (_, data) => cb(data);
      ipcRenderer.on('wa:ack', handler);
      return () => ipcRenderer.removeListener('wa:ack', handler);
    },
    onTyping:    (cb)            => {
      const handler = (_, data) => cb(data);
      ipcRenderer.on('wa:typing', handler);
      return () => ipcRenderer.removeListener('wa:typing', handler);
    },
  },
  // Telegram
  tg: {
    requestCode:  (phone)            => ipcRenderer.invoke('tg:request-code', phone),
    signIn:       (phone, code, hash)=> ipcRenderer.invoke('tg:sign-in', phone, code, hash),
    startQRLogin: ()                 => ipcRenderer.invoke('tg:start-qr-login'),
    submit2FA:    (password)         => ipcRenderer.invoke('tg:2fa-password', password),
    getDialogs:   ()                 => ipcRenderer.invoke('tg:get-dialogs'),
    getMessages:  (chatId, opts)     => ipcRenderer.invoke('tg:get-messages', chatId, opts),
    sendMessage:  (chatId, text)     => ipcRenderer.invoke('tg:send-message', chatId, text),
    sendFile:     (chatId, path)     => ipcRenderer.invoke('tg:send-file', chatId, path),
    sendSticker:  (chatId, path)     => ipcRenderer.invoke('tg:send-sticker', chatId, path),
    sendVoice:    (chatId, base64, mime) => ipcRenderer.invoke('tg:send-voice', chatId, base64, mime),
    editMessage:  (chatId, messageId, newText) => ipcRenderer.invoke('tg:edit-message', chatId, messageId, newText),
    deleteMessage:(chatId, messageId, revoke = true) => ipcRenderer.invoke('tg:delete-message', chatId, messageId, revoke),
    getRecentStickers: (limit)       => ipcRenderer.invoke('tg:get-recent-stickers', limit),
    markRead:     (chatId)           => ipcRenderer.invoke('tg:mark-read', chatId),
    getStatus:    ()                 => ipcRenderer.invoke('tg:status'),
    getMe:        ()                 => ipcRenderer.invoke('tg:get-me'),
    getAvatar:    (id)               => ipcRenderer.invoke('tg:get-avatar', id),
    logout:       ()                 => ipcRenderer.invoke('tg:logout'),
    setCredentials: (id, hash)       => ipcRenderer.invoke('tg:set-credentials', id, hash),
    onMessage:    (cb)               => {
      const handler = (_, d) => cb(d);
      ipcRenderer.on('tg:message', handler);
      return () => ipcRenderer.removeListener('tg:message', handler);
    },
    onAvatar:     (cb)               => {
      const handler = (_, d) => cb(d);
      ipcRenderer.on('tg:avatar', handler);
      return () => ipcRenderer.removeListener('tg:avatar', handler);
    },
    onChatUpdate: (cb)               => {
      const handler = (_, d) => cb(d);
      ipcRenderer.on('tg:chat-update', handler);
      return () => ipcRenderer.removeListener('tg:chat-update', handler);
    },
    onQR:         (cb)               => ipcRenderer.on('tg:qr',       (_, d) => cb(d)),
    onReady:      (cb)               => ipcRenderer.on('tg:ready',    (_, d) => cb(d)),
    on2FANeeded:  (cb)               => ipcRenderer.on('tg:2fa-needed',(_, d) => cb(d)),
  },
  // Chat windows
  openChat: (params) => ipcRenderer.invoke('open-chat', params),
  getStoredAvatar: (id) => ipcRenderer.invoke('get-stored-avatar', id),
  notifySent: (msg) => ipcRenderer.send('chat:sent', msg),
  notifyRead: (msg) => ipcRenderer.send('chat:read', msg),
  onSent: (cb) => {
    const handler = (_, d) => cb(d);
    ipcRenderer.on('chat:sent-broadcast', handler);
    return () => ipcRenderer.removeListener('chat:sent-broadcast', handler);
  },
  onRead: (cb) => {
    const handler = (_, d) => cb(d);
    ipcRenderer.on('chat:read-broadcast', handler);
    return () => ipcRenderer.removeListener('chat:read-broadcast', handler);
  },
  // Window controls
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close:    () => ipcRenderer.send('window:close'),
  },
  openExternal: (url) => ipcRenderer.send('open-external', url),
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  saveTempImage: (base64, ext) => ipcRenderer.invoke('app:save-temp-image', base64, ext),
  appVersion: process.env.npm_package_version || require('../package.json').version,
  // Get real file system path from a dropped File object (Electron 29+)
  getFilePath: (file) => {
    try { return webUtils.getPathForFile(file); } catch (e) { return file?.path || null; }
  },
});

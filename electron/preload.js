const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // WhatsApp
  wa: {
    getQR:       ()              => ipcRenderer.invoke('wa:get-qr'),
    getChats:    ()              => ipcRenderer.invoke('wa:get-chats'),
    getMessages: (chatId)        => ipcRenderer.invoke('wa:get-messages', chatId),
    sendMessage: (chatId, text)  => ipcRenderer.invoke('wa:send-message', chatId, text),
    getStatus:   ()              => ipcRenderer.invoke('wa:status'),
    onQR:        (cb)            => ipcRenderer.on('wa:qr', (_, data) => cb(data)),
    onReady:     (cb)            => ipcRenderer.on('wa:ready', (_, data) => cb(data)),
    onMessage:   (cb)            => {
      const handler = (_, data) => cb(data);
      ipcRenderer.on('wa:message', handler);
      return () => ipcRenderer.removeListener('wa:message', handler);
    },
  },
  // Telegram
  tg: {
    requestCode:  (phone)            => ipcRenderer.invoke('tg:request-code', phone),
    signIn:       (phone, code, hash)=> ipcRenderer.invoke('tg:sign-in', phone, code, hash),
    startQRLogin: ()                 => ipcRenderer.invoke('tg:start-qr-login'),
    submit2FA:    (password)         => ipcRenderer.invoke('tg:2fa-password', password),
    getDialogs:   ()                 => ipcRenderer.invoke('tg:get-dialogs'),
    getMessages:  (chatId)           => ipcRenderer.invoke('tg:get-messages', chatId),
    sendMessage:  (chatId, text)     => ipcRenderer.invoke('tg:send-message', chatId, text),
    getStatus:    ()                 => ipcRenderer.invoke('tg:status'),
    onMessage:    (cb)               => {
      const handler = (_, d) => cb(d);
      ipcRenderer.on('tg:message', handler);
      return () => ipcRenderer.removeListener('tg:message', handler);
    },
    onQR:         (cb)               => ipcRenderer.on('tg:qr',       (_, d) => cb(d)),
    onReady:      (cb)               => ipcRenderer.on('tg:ready',    (_, d) => cb(d)),
    on2FANeeded:  (cb)               => ipcRenderer.on('tg:2fa-needed',(_, d) => cb(d)),
  },
  // Chat windows
  openChat: (params) => ipcRenderer.invoke('open-chat', params),
  // Window controls
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    close:    () => ipcRenderer.send('window:close'),
  }
});

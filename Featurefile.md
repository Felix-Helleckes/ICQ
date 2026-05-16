# Retrogram Features

A retro ICQ-style multi-messenger desktop application supporting WhatsApp and Telegram with cross-platform support.

---

## Core Features

### Messaging
- **Message Editing** - Edit your sent messages in real-time on WhatsApp and Telegram
- **Message Deletion** - Delete messages with option to remove for everyone or just yourself
- **Message Context Menu** - Right-click menu for copy, reply, forward, edit, and delete actions
- **Forward Messages** - Forward messages to other chats with searchable contact list
- **Reply to Messages** - Quote and reply to specific messages with inline reference
- **Unread Indicators** - Persistent unread message counters per chat

### Search & Discovery
- **Unified Search** - Single search field searching across WhatsApp and Telegram simultaneously
  - Filters: Media, Links, Files
  - Real-time results
  - Cross-service support

### Chat Management
- **Snooze/Do Not Disturb** - Mute individual chats for 1h/8h/24h without disabling global notifications
- **Chat List** - Contact and group list with status indicators

### Notifications & Alerts
- **Better Notifications** - Native desktop notifications featuring:
  - Contact avatar display
  - Message preview
  - Quick actions (Mark as read, Reply)
- **Notification Sounds** - Customizable sound alerts for incoming messages
- **Tray Integration** - System tray icon with click-to-show functionality

### Productivity & Shortcuts
- **Global Hotkey** - Open window with Ctrl+Shift+I and jump directly to search (future implementation)
- **Mini Command Palette** - Ctrl+K for quick actions:
  - Open chat
  - Mute group
  - Send file
  - Switch service

### Media & Stickers
- **GIF Search** - Giphy integration for GIF insertion into chats
- **Sticker Support** - Send and receive stickers from both services
- **Media Gallery** - View and share images, videos, and documents

### UI/UX
- **Retro Theme** - Windows 98 / ICQ 5 inspired interface
- **Dark Mode** - Optimized dark theme for reduced eye strain
- **Window Snapping** - Native Windows edge-snap support for productivity
- **Custom Titlebar** - Minimalist draggable header with close/minimize buttons
- **Resizable Interface** - Flexible window sizing to fit your workspace

### Cross-Platform
- **Windows Support** - Native executable (.exe) and portable build
- **macOS Support** - Native application with menubar integration
- **Linux Support** - AppImage, .deb, and .rpm packages

### Development & Debugging
- **Startup Diagnostics** - Comprehensive logging for troubleshooting
- **Console Error Tracking** - Automatic error reporting for crashes
- **Bridge APIs** - WhatsApp and Telegram API bridges for reliable service integration

---

## Technical Specifications

- **Framework**: Electron 29.0.0 (cross-platform desktop)
- **Frontend**: React 18.2.0 with custom CSS styling
- **Backend**: Node.js with IPC communication
- **WhatsApp API**: whatsapp-web.js 1.23.0 (headless browser automation)
- **Telegram API**: GramJS 2.22.2 (native TDLib wrapper)
- **Packaging**: electron-builder 24.9.1 for multi-platform builds
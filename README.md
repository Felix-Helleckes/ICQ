[![Watch Live](https://img.shields.io/badge/▶_Watch_Live-YouTube-red?style=for-the-badge&logo=youtube)](https://www.youtube.com/@TheEfficientDev)
[![Trading Bot](https://img.shields.io/badge/Trading_Bot-GitHub-181717?style=for-the-badge&logo=github)](https://github.com/felix-helleckes/TradingBot)
[![Portfolio](https://img.shields.io/badge/Portfolio-felix--helleckes.github.io-0a66c2?style=for-the-badge&logo=github)](https://felix-helleckes.github.io/)

# ICQ Messenger

A retro **ICQ 5**-style multi-messenger desktop app built with **Electron + React**.  
Supports **WhatsApp** (via whatsapp-web.js) and **Telegram** (via GramJS).  
Dark teal skin, separate floating chat windows per contact — just like ICQ 5.

![ICQ Dark Teal Skin](public/icon.png)

---

## Features

- **ICQ 5 dark teal skin** — faithful recreation with CSS variables (`--icq-bg`, `--icq-teal`, `--icq-yellow`)
- **Separate chat windows** per contact (true ICQ 5 behavior, each in its own `BrowserWindow`)
- **💬 WhatsApp** — QR login, persistent session, stickers & images, profile pictures
- **✈️ Telegram** — MTProto via GramJS, QR + phone login, 2FA support, profile pictures
- **Emoji picker** — 40 emojis, click-outside-to-close, inserted at cursor position
- **Font size controls** — A− / A+ buttons, persisted in localStorage, range 10–20px (all sizes in `rem`)
- **Live contact list** — real-time unread badges, last message preview, auto-reset on open
- **Frameless window** with custom ICQ-style title bar (minimize / close)
- **Contact profile pictures** — loaded from WhatsApp CDN / Telegram, with letter fallback
- **Sticker & image display** — inline in chat, downloaded as base64 data URLs
- **Windows installer** — NSIS `.exe` and portable build via electron-builder

---

## Requirements

- **Node.js** 18+ (LTS recommended)
- **npm** 9+
- A Chromium-compatible system (for Puppeteer / WhatsApp headless)

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Telegram API credentials *(optional — only needed for Telegram)*

1. Go to [https://my.telegram.org](https://my.telegram.org)
2. Log in with your phone number
3. Click **API development tools**
4. Create an app → note your **App api_id** and **App api_hash**

Set them as environment variables before starting:

**Windows (PowerShell):**
```powershell
$env:TG_API_ID   = "12345678"
$env:TG_API_HASH = "your_api_hash_here"
```

**Linux / macOS:**
```bash
export TG_API_ID=12345678
export TG_API_HASH=your_api_hash_here
```

Or create a `.env` file in the project root:

```
TG_API_ID=12345678
TG_API_HASH=your_api_hash_here
```

---

## Running in Development

```bash
npm start
```

Starts the React dev server and Electron simultaneously. No browser tab opens.

---

## Building a distributable (.exe)

```bash
# NSIS installer
npm run dist:win

# Portable .exe (no install needed)
npm run dist:portable
```

Output is in the `dist/` folder.

---

## Project Structure

```
├── electron/
│   ├── main.js              # Main process, IPC handlers, multi-window management
│   ├── preload.js           # contextBridge — exposes window.api with cleanup
│   ├── whatsapp-bridge.js   # WhatsApp (whatsapp-web.js + Puppeteer)
│   └── telegram-bridge.js   # Telegram MTProto (GramJS)
├── src/
│   ├── App.js               # Main contact-list window (polls status, live updates)
│   ├── ChatApp.js           # Per-contact chat window entry point
│   ├── index.css            # Global ICQ 5 dark teal styles, CSS vars, rem units
│   └── components/
│       ├── TitleBar.js      # Frameless title bar with minimize/close
│       ├── Sidebar.js       # Service tabs, contact list, A−/A+ font controls
│       ├── ChatWindow.js    # Messages, emoji picker, sticker/image display
│       └── LoginPanel.js    # QR code / phone login for both services
├── scripts/
│   └── make-icon.js         # Generates icon.ico + icon.png via Jimp
├── public/
│   ├── icon.ico             # App icon (electron-builder)
│   └── icon.png
└── package.json
```

---

## Architecture Notes

- **Multi-window**: each chat opens a separate `BrowserWindow` via `open-chat` IPC. Windows are tracked in a `Map` and reused on re-open.
- **Broadcast pattern**: `BrowserWindow.getAllWindows().forEach(w => w.webContents.send(...))` keeps all windows in sync.
- **IPC cleanup**: `onMessage` returns a cleanup function (`ipcRenderer.removeListener`) used in `useEffect` — no listener leaks.
- **Font scaling**: `html { font-size }` set at runtime, all component sizes in `rem`.

---

## Windows SmartScreen Warning

When running the `.exe` for the first time, Windows SmartScreen may show a warning ("Windows protected your PC").  
This is expected — the app is not code-signed. It is **not malware**.

To run it anyway:
1. Click **"More info"**
2. Click **"Run anyway"**

Alternatively: right-click the `.exe` → **Properties** → check **"Unblock"** → OK.

---

## Notes

- WhatsApp session is persisted in `data/whatsapp/` (gitignored)
- Telegram session is stored in `data/telegram.session` (gitignored)
- Never commit your session files or `.env`

---

## Legal

This project uses the **unofficial** WhatsApp Web API via whatsapp-web.js.  
Use at your own risk. WhatsApp may block accounts that violate their Terms of Service.  
Telegram usage is via the **official** MTProto protocol with your own developer credentials.

# ICQ Messenger

A retro ICQ-style multi-messenger desktop app built with Electron + React.  
Supports **WhatsApp** (via whatsapp-web.js) and **Telegram** (via GramJS).

![ICQ Retro Style](public/icq-icon.png)

---

## Features

- 🌼 Authentic ICQ look & feel (Windows 98 / Win2000 style UI)
- 💬 WhatsApp Web — scan QR code, no official API needed
- ✈️ Telegram — MTProto via your own API credentials
- Custom frameless window with retro title bar
- Contact list with unread badges
- Real-time message updates

---

## Requirements

- **Node.js** 18+ (LTS recommended)
- **npm** 9+
- A Chromium-compatible system (for Puppeteer/WhatsApp)

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

Or create a `.env` file and load it (add a `dotenv` call in `electron/main.js` if you prefer).

---

## Running in Development

```bash
npm start
```

This starts the React dev server and Electron simultaneously.

---

## Building a distributable

```bash
npm run pack
```

Output is in the `dist/` folder.

---

## Project Structure

```
├── electron/
│   ├── main.js              # Electron main process
│   ├── preload.js           # Context bridge (IPC)
│   ├── whatsapp-bridge.js   # WhatsApp integration
│   └── telegram-bridge.js   # Telegram integration
├── src/
│   ├── App.js               # Root React component
│   ├── index.css            # Global ICQ retro styles
│   └── components/
│       ├── TitleBar.js      # Custom frameless title bar
│       ├── Sidebar.js       # Service tabs + contact list
│       ├── ChatWindow.js    # Message view + input
│       └── LoginPanel.js    # QR / phone auth
├── public/
│   └── index.html
└── package.json
```

---

## Notes

- WhatsApp session is persisted in `data/whatsapp/`
- Telegram session is stored in `data/telegram.session`
- Both are gitignored — never commit your session files

---

## Legal

This project uses unofficial WhatsApp APIs.  
Use at your own risk. WhatsApp may block accounts that violate their Terms of Service.  
Telegram usage is via official MTProto with your own developer credentials.

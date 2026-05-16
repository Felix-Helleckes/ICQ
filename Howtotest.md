
---

## How to Test / Debug Branch Directly

### macOS

```bash
git clone https://github.com/dein-user/ICQ.git
cd ICQ
npm install
npm run dist                    # Generates .dmg + signed for macOS
# or
npm run dist:portable          # macOS Portable
```

**Verification:**
- Tray icon visible in macOS menubar
- Icon displays correctly in Dock
- Edge-snap on macOS (Four-Corner-Snap works)

### Linux

```bash
git clone https://github.com/dein-user/ICQ.git
cd ICQ
npm install
npm run dist                    # Generates .AppImage, .deb, .rpm for Linux
# or
npm run dist:portable          # Linux Portable
```

**Verification:**
- WhatsApp and Telegram QR code displays (no error)
- Login is possible
- Chat windows loading
- Tray icon visible in system tray
- A+ A- works in Chatwindow
- A+ A- works in Contactlist
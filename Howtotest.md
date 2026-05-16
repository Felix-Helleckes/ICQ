
---

## How to Test / Debug Branch Directly

### macOS

```bash
git clone https://github.com/dein-user/ICQ.git
cd ICQ
npm install
npm run dist                    # Generiert .dmg + signed für macOS
# oder
npm run dist:portable          # macOS-Portable
```

**Verifizieren:**
- Tray-Icon in macOS Menubar sichtbar
- Icon im Dock korrekt
- Edge-Snap auf macOS (Four-Corner-Snap funktioniert)

### Linux

```bash
git clone https://github.com/dein-user/ICQ.git
cd ICQ
npm install
npm run dist                    # Generiert .AppImage, .deb, .rpm für Linux
# oder
npm run dist:portable          # Linux-Portable
```

**Test Plan:**
- WhatsApp QR-Code wird angezeigt (kein Error)
- Tray-Icon sichtbar in Systemtray
- Chromium/Chrome gefunden und ausgeführt
- Message Edit/Delete funktioniert
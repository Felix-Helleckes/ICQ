# Testing

## Was automatisch läuft (nicht manuell nachtesten)

| Ebene | Wo | Deckt ab |
|-------|-----|----------|
| Renderer-Unit-Tests | `npm run test:unit` (CRA/Jest, `src/**`) | UI-Logik, Skins |
| Electron-Helper-Unit-Tests | `npm run test:electron` (`electron/lib/**`) | `getChats`-Retry, Avatar-Concurrency-Cap, Chrome-Pfad-Auflösung, Portable/Setup-Datenverzeichnis |
| Main-Prozess-Syntax | `npm run check:electron` | Boot-Fehler im Main-Prozess |
| E2E-Boot-Smoke | `npm run test:e2e` (Playwright + Electron) | App bootet, beide Service-Tabs, Login-Panel, kein White-Screen — auf **ubuntu + windows + macos** |
| Cross-Platform-Builds | `.github/workflows/release.yml` (bei `v*`-Tag) | Win **Setup + Portable**, macOS dmg, Linux AppImage + deb |

CI (`.github/workflows/ci.yml`) fährt Unit + Electron-Unit + Build + E2E bei jedem Push/PR auf allen drei OS.

## Die harte Grenze

Der **echte Login** (WhatsApp: QR mit Handy scannen; Telegram: SMS-Code) lässt sich **nicht** automatisieren. Der E2E-Smoke läuft absichtlich im `ICQ_E2E`-Modus (Bridges übersprungen). Der Login-→-Chats-Flow braucht daher pro Release **einen** manuellen Durchlauf.

## Manueller Release-Smoke

Nur die Punkte, die die Automation nicht erreicht. Pro Plattform der Reihe nach.

### Windows — Setup (NSIS)  ⬅️ wichtigster manueller Test
1. `npm run dist:nsis`, ins **Standard-Verzeichnis (Program Files)** installieren.
2. Starten → **WhatsApp QR-Login** durchführen.
   - Prüft den `%APPDATA%`-Fallback-Pfad (Program Files ist nicht schreibbar → Daten landen in `%APPDATA%\ICQ Messenger`). Das ist der Pfad, den der Portable-Build **nie** durchläuft.
3. Nach dem Login: **durchgehend „Lädt Chats…", dann Chatliste** — **kein** „No chats found". Avatare tröpfeln **erst nach** der Liste rein.
4. Nachricht senden **und** empfangen.
5. App **beenden und neu starten** → Session bleibt erhalten (kein erneuter QR).
6. `%TEMP%\icq-startup.log` sollte `Data dir active (portable-fallback)` **oder** `Using default userData` zeigen.

### Windows — Portable
1. `npm run dist:portable`, aus einem **schreibbaren** Ordner (z. B. Desktop) starten.
2. WhatsApp QR-Login → Chatliste erscheint (wie oben, kein „No chats found").
3. Beenden, **den ganzen Ordner** (exe + `ICQ-Data`) woandershin kopieren, von dort starten → **noch eingeloggt**.
4. `icq-startup.log` zeigt `Data dir active (portable-env)`.

### macOS (dmg, arm64)
1. Nicht notarisiert → einmalig `xattr -cr "/Applications/ICQ Messenger.app"`.
2. WhatsApp-Login (nutzt System-Chrome — muss installiert sein), Chatliste, Neustart → Session hält.

### Linux (AppImage + deb)
1. Chromium vorhanden? (`chromium`/`google-chrome`). Fehlt es → Login-Panel zeigt die Chrome-Installieren-Hilfe.
2. Login, Chatliste, Neustart → Session hält.

### Quer über alle Plattformen (die gefixten Bugs)
- Nach frischem Login **nie** „No chats found" während noch synchronisiert wird — es muss der „Lädt Chats…"-Indikator stehen.
- Nach dem QR-Scan lädt **nur** die Kontaktliste — kein Avatar-/Teilnehmer-/Nachrichten-Prefetch nebenher.
- Die Liste soll **zügig** kommen und Namen **inkl. Last-Message-Vorschau** zeigen (nicht nur Namen).
- Chat öffnen → zeigt Nachrichten (nicht leer), **auch bei Gruppen**.
- Chat erneut öffnen / nach App-Neustart → **sofort** da (Disk-Cache, ~3 Tage).

## Wenn etwas hakt
- **Startup-/Bridge-Log:** `%TEMP%\icq-startup.log` (Win) bzw. `$TMPDIR/icq-startup.log` — zeigt gewähltes Datenverzeichnis und jedes WA-Event (`qr`, `authenticated`, `ready`, `disconnected`).
- **Renderer-Konsole:** DevTools im Fenster.

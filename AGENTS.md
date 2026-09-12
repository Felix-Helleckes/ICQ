# ICQ Retrogram — Agent-Briefing

Electron-Desktop-App: WhatsApp + Telegram in einer ICQ-5-Oberfläche.
Win/macOS/Linux, MIT, Autor Felix Helleckes. Website: `site/` (Netlify).

**Diese Datei wird in jeden Chat geladen — halte sie kurz.** Details gehören in
`docs/` (nur bei Bedarf lesen) oder in Code-Kommentare am Ort der Entscheidung.

## Karte

```
electron/main.js            Fenster, IPC, Datenverzeichnis, WA-Nachrichten-Cache
electron/whatsapp-bridge.js WhatsApp via Baileys (KEIN Browser)
electron/telegram-bridge.js Telegram via gramjs (MTProto)
electron/preload.js         contextBridge → window.api
electron/lib/*.js           reine, getestete Logik (jede Datei hat .test.js)
src/App.js                  Kontaktlisten-Fenster
src/ChatApp.js              einzelnes Chat-Fenster (eigenes BrowserWindow)
src/components/Icon.js      Linien-Icons (KEINE Emojis in Bedienelementen)
src/chatOrder.js            Reihenfolge: Gruppen → Archiviert → Rest, je neueste zuerst
site/index.html             Landing Page (statisch, kein Build)
```

## Harte Regeln (teuer erkauft — nicht rückgängig machen)

**Senden wird NIE wiederholt.** `client.sendMessage` kann nach erfolgreichem
Versand werfen. Ein Retry stellt die Nachricht ein zweites Mal zu — nicht
zurücknehmbar. Ein Sendefehler darf auch **keinen Reconnect** auslösen (sonst
scheitert alles Folgende mit „not ready"). Fehler wird gemeldet, UI gibt den Text
zurück.

**Baileys ist ESM.** Electrons Node kann kein `require()` davon → lazy
`await import()` (`loadBaileys()`), und `asarUnpack` in package.json. Nie zu
`require` zurückbauen.

**Der Store MUSS auf Platte.** WhatsApp sendet den History-Sync **nur beim
Koppeln**. Jeder spätere Start bekommt nichts → ohne `lib/wa-store.js` bleibt die
Kontaktliste leer. Drei Fälle in `connection.update`:
- Store gefüllt → sofort `announceReady()`
- gekoppelt + Store leer → `recoverFromAppState()` (`resyncAppState`)
- Erstkopplung → auf History warten (12 s Timeout)

**Acks laufen nur vorwärts.** Zwei Ereignispfade (`messages.update` +
`message-receipt.update`), und die UI liest alle 8 s neu aus dem Store. Ohne
Höchststand-Marke fällt ein Haken zurück auf die Uhr. Siehe `lib/ack.js`.

**Kontaktnamen: LID ≠ Telefon-JID.** Dieselbe Person hat zwei JIDs. Kontakte unter
**allen** Kennungen indizieren + LID↔Telefon-Mapping. Sonst stehen rohe JIDs in der
Liste. Siehe `lib/contact-names.js`. Es darf **nie** ein String mit `@` in die UI.

**Emojis nur als Inhalt.** Bedienelemente nutzen `Icon.js`. Emoji-Picker,
Chat-Emojis, Spiele-Einträge und die Marken-Blume `✿` bleiben. E2E-Test wacht.

## Validieren (alle müssen grün sein)

```
npm run lint          # fängt undefinierte Variablen — der Build allein tut das NICHT
npm run check:electron
npm run test:electron # 72 Tests, inkl. Bridge-Durchlauf gegen lib/fake-baileys.js
npm run test:unit     # 24 Tests (Renderer)
npm run build
npx playwright test   # 5 E2E, startet echte Electron-App
```

**Bridge testen ohne echtes Konto:** `electron/whatsapp-bridge.test.js` fährt die
echte Bridge gegen `lib/fake-baileys.js` (Seam: `__setBaileysForTests`).
**Es wird nie real gesendet** — ausgehende Aufrufe werden nur aufgezeichnet.
Neue Bridge-Logik dort abdecken, nicht manuell testen.

## Fallen

- **E2E läuft mit `ICQ_E2E=1`** → Bridges übersprungen, immer Login-Panel. Die
  Kontaktlisten-Zweige sind dort **nicht** abgedeckt.
- **CRA-Build meldet keine undefinierten Variablen** — deshalb `npm run lint`.
  Nachgemessen: ohne Lint kompiliert `undefinedVar123` anstandslos.
- **Echter Login (QR/SMS) ist nicht automatisierbar.** Ein manueller Smoke pro
  Release bleibt nötig → `TESTING.md`.
- **Log:** `%TEMP%\icq-startup.log`. Zeigt `WA store restored`, `WA history`,
  `WA recovery`, `WA ack`, `WA send failed`. **Immer zuerst lesen** statt raten —
  in diesem Projekt hat Raten wiederholt Regressionen erzeugt.
- **Vor `dist:*` die laufende App schließen**, sonst sperrt sie `dist/`.

## Release

Push auf `main` mit **erhöhter** Version in `package.json` → Workflow taggt
`v<version>` und veröffentlicht Win (Setup+Portable), macOS dmg, Linux
AppImage+deb. Ohne Versionsbump passiert bewusst nichts. Tests sind Gate.
**Vor dem Bump testen — der Release geht sofort an Nutzer.**

## Daten (nicht löschen beim Debuggen)

`ICQ-Data/` (portable: neben der .exe, Setup: `%APPDATA%`):
`telegram.session` (Telegram-Login!), `whatsapp/baileys-auth/` (WA-Session),
`whatsapp/store.json` (Chatliste), `avatars/`.
Nur `store.json` ist gefahrlos löschbar.

## Offen / bekannt

- Sticker: nur echte `.webp` gehen als Sticker raus, sonst als Bild.
- `resyncAppState` liefert Kontakte zuverlässig, Chats nur teilweise. Vollständige
  Liste bekommt man sicher nur durch einmaliges Neu-Koppeln.
- Medien/Randfunktionen (archivieren, blockieren, bearbeiten, löschen) sind am
  wenigsten erprobt — neue Baileys-Pfade.
- PR-Material in `presse/`, fertige Reddit-Posts in `marketing/reddit-kit.md`,
  Bewertung der Monetarisierung in `docs/premium-konzept.md`.

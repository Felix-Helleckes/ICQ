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
site/index.html             Landing Page (statisch); site/de.html daraus generiert:
                            npm run site:build (Lint prüft, dass sie aktuell ist)
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
**Ein Chat pro Person:** der Store legt alles unter `canonicalFor()` ab (Telefon-JID
gewinnt), neues Mapping → `store.rekey()`. Sonst doppelte Einträge, sobald die
Antwort unter der LID kommt. Mapping-Quellen: History, `remoteJidAlt`, Chat-Felder
(`pnJid`/`accountLid`), Baileys' eigene `lid-mapping-*.json`.
**Phantom-Chats:** die History liefert ~100+ Chats mit nur einem E2E-Hinweis — die
erschienen als nackte Nummern. Gelistet wird nur, was `store.isListed()` sagt.

**Sprachnachrichten = Ogg/Opus.** Chromium nimmt WebM auf; WhatsApp und Telegram
spielen nur Ogg/Opus als Sprachnachricht. `lib/ogg-opus.js` packt verlustfrei um.
Telegram: gramjs erkennt Audio nur am Dateinamen → `lib/tg-voice.js` (voice.ogg).

**Ungelesen-Zähler von Baileys sind Deltas** (`chats.update`: >0 = +N, 0 = gelesen,
-1 = als ungelesen markiert, null = nichts). Siehe `withResolvedUnread`.

**Emojis nur als Inhalt.** Bedienelemente nutzen `Icon.js`. Emoji-Picker,
Chat-Emojis, Spiele-Einträge und die Marken-Blume `✿` bleiben. E2E-Test wacht.

## Validieren (alle müssen grün sein)

```
npm run lint          # fängt undefinierte Variablen — der Build allein tut das NICHT
npm run check:electron
npm run test:electron # 167 Tests, inkl. beider Bridges gegen Fakes (fake-baileys, Fake-gramjs)
npm run test:unit     # 30 Tests (Renderer)
npm run build
npx playwright test   # 6 E2E, echte Electron-App, inkl. Sprachnachricht mit Fake-Mikrofon
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

Bevorzugt **lokal** (Windows) + nur macOS/Linux in CI → `docs/release.md`.
Vollautomatik als Fallback: Push auf `main` mit **erhöhter** Version → `release.yml`
baut alles. Ohne Versionsbump passiert bewusst nichts. Tests sind Gate.
**Vor dem Bump testen — der Release geht sofort an Nutzer.**
Die Landingpage holt die Download-Links selbst aus `releases/latest`.

## Daten (nicht löschen beim Debuggen)

Portable: `ICQ-Data/` neben der .exe. Installiert (Setup, macOS, Linux): Electrons
userData — `%APPDATA%\icq-messenger`, `~/Library/Application Support/icq-messenger`,
`~/.config/icq-messenger`. **Nie** der Installationsordner: Updates löschen ihn
(alte Daten dort werden einmalig übernommen, siehe `lib/data-dir.js`).
Inhalt: `telegram.session` (Telegram-Login!), `whatsapp/baileys-auth/` (WA-Session),
`whatsapp/store.json` (Chatliste), `avatars/`. Nur `store.json` ist gefahrlos löschbar.
**Ein Login-Ordner pro Rechner:** kopiertes `ICQ-Data` parallel → WhatsApp 440
(„Anderswo aktiv"), die App reconnectet dann bewusst nicht.

## Offen / bekannt

- Sticker: nur echte `.webp` gehen als Sticker raus, sonst als Bild.
- `resyncAppState` liefert Kontakte zuverlässig, Chats nur teilweise. Vollständige
  Liste bekommt man sicher nur durch einmaliges Neu-Koppeln.
- Medien/Randfunktionen (archivieren, blockieren, bearbeiten, löschen) sind am
  wenigsten erprobt — neue Baileys-Pfade.
- **Website, Marketing, Monetarisierung → `docs/stand-marketing.md`.** Dort zuerst
  nachsehen: Stand, offene Punkte mit genauen Schritten, und Entscheidungen, die
  bewusst so sind (leere GA-Mess-ID, auskommentiertes `github:` in FUNDING.yml,
  absolute Basis-URLs). Daneben `presse/` (PR-Material),
  `marketing/reddit-kit.md` (fertige Posts), `docs/premium-konzept.md`.

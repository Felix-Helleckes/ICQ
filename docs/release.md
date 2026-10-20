# Release-Ablauf (lokal bauen, wenig CI)

Seit 1.1.0. Ziel: Windows lokal bauen, nur macOS/Linux in GitHub Actions (geht
technisch nicht anders: DMG nur auf einem Mac, AppImage/deb brauchen Linux-Tools).
Das Repo ist öffentlich — Standard-Runner kosten dort keine Minuten.

Die Landingpage braucht **keine** Änderung pro Release: Die Download-Buttons lesen
`releases/latest` per GitHub-API und wählen die Dateien nach Namen
(`Setup*.exe`, `Portable*.exe`, `*arm64.dmg`, `*x64.dmg`, `*.AppImage`).
Nur `softwareVersion` im JSON-LD von `site/index.html` mitziehen und danach
`npm run site:build` (die deutsche Seite `site/de.html` wird daraus erzeugt).

## Schritte

1. **Alles grün** (siehe CLAUDE.md → Validieren), inkl. `npx playwright test`.
2. Version in `package.json` (+ `package-lock.json`) erhöhen, Commit mit
   **`[skip ci]`** in der Nachricht — sonst baut `release.yml` alles selbst in CI.
   Pushen.
3. Windows lokal bauen (laufende App vorher schließen):
   `npm run build && npx electron-builder --win nsis portable --publish never`
4. Draft-Release mit den Windows-Dateien:
   `gh release create v<version> --draft --target main --title "ICQ Messenger v<version>" --notes-file <notes> dist/ICQ-Messenger-Setup-<version>.exe dist/ICQ-Messenger-<version>-Portable.exe`
5. macOS + Linux in CI bauen und anhängen lassen (Tests laufen dort als Gate;
   Release vom Mac aus: `-f platforms=win,linux`, DMGs lokal signiert hochladen):
   `gh workflow run build-platforms.yml -f tag=v<version>`
6. Wenn alle sechs Dateien dran sind: veröffentlichen
   `gh release edit v<version> --draft=false --latest`
7. Seite deployen: `gh workflow run deploy-pages.yml`

`release.yml` bleibt als Vollautomatik für den Fall, dass ohne `[skip ci]`
gepusht wird; existiert das Tag schon, tut es nichts.

## macOS: signiert + notarisiert (seit 1.1.2)

Bis 1.1.1 war die DMG nur ad-hoc signiert → nach dem Download meldet macOS
„beschädigt" (Quarantäne). Jetzt: Developer ID `Felix Helleckes (5Y4L8J23FQ)`,
Hardened Runtime (`store/mac/entitlements.mac.plist` — ohne `audio-input` keine
Sprachnachrichten!) und Notarisierung über notarytool.

**Lokal auf dem Mac** (Zertifikat liegt im Schlüsselbund, API-Key unter
`~/.appstoreconnect/private_keys/`):

```
APPLE_API_KEY=~/.appstoreconnect/private_keys/AuthKey_3UPD3SJ67A.p8 \
APPLE_API_KEY_ID=3UPD3SJ67A APPLE_API_ISSUER=7ec7cedf-030a-4f7a-a715-76355c7ed6b0 \
npx electron-builder --mac dmg --arm64 --x64 --publish never
spctl -a -vvv -t exec "dist/mac-arm64/ICQ Messenger.app"   # → accepted, Notarized Developer ID
```

Ohne die drei `APPLE_*`-Variablen signiert electron-builder nur und überspringt die
Notarisierung mit einer Warnung — so eine DMG **nicht** veröffentlichen.

**In CI** brauchen `build-platforms.yml`/`release.yml` diese Secrets (sonst bricht
der Mac-Job bewusst ab):
`MAC_DEVID_CERT_P12` (base64 der aus dem Schlüsselbund exportierten
„Developer ID Application"-.p12), `MAC_DEVID_CERT_PASSWORD`,
`APPLE_API_KEY_P8` (base64 der `AuthKey_3UPD3SJ67A.p8`), `APPLE_API_KEY_ID`,
`APPLE_API_ISSUER`. Setzen in einem Rutsch (selbst ausführen, Anleitung im Kopf des Skripts):
`scripts/set-mac-secrets.sh <exportierte Developer-ID.p12>` — setzt auch die
`MAS_API_*`-Secrets für den App-Store-Upload.

## Windows-Update rettet den Login

Bis 1.0.37 lag `ICQ-Data` bei der Setup-Version im Installationsordner, und jedes
Update löscht diesen Ordner. `installer/installer.nsh` verschiebt ihn vorher nach
`%APPDATA%\ICQ Messenger\legacy-ICQ-Data`; die App übernimmt ihn beim ersten Start
nach `%APPDATA%\icq-messenger` (`electron/lib/data-dir.js`). Am 2026-10-02 mit dem
echten Setup durchgespielt: Installieren → Altdaten anlegen → Update → Start.

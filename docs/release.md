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
5. macOS + Linux in CI bauen und anhängen lassen (Tests laufen dort als Gate):
   `gh workflow run build-platforms.yml -f tag=v<version>`
6. Wenn alle sechs Dateien dran sind: veröffentlichen
   `gh release edit v<version> --draft=false --latest`
7. Seite deployen: `gh workflow run deploy-pages.yml`

`release.yml` bleibt als Vollautomatik für den Fall, dass ohne `[skip ci]`
gepusht wird; existiert das Tag schon, tut es nichts.

## Windows-Update rettet den Login

Bis 1.0.37 lag `ICQ-Data` bei der Setup-Version im Installationsordner, und jedes
Update löscht diesen Ordner. `installer/installer.nsh` verschiebt ihn vorher nach
`%APPDATA%\ICQ Messenger\legacy-ICQ-Data`; die App übernimmt ihn beim ersten Start
nach `%APPDATA%\icq-messenger` (`electron/lib/data-dir.js`). Am 2026-10-02 mit dem
echten Setup durchgespielt: Installieren → Altdaten anlegen → Update → Start.

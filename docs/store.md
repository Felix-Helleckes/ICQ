# Microsoft Store + Mac App Store

Stand 2026-10-05. Beide Store-Builds sind **zusätzlich** zu Portable/Setup/DMG, nicht
ersetzend. Store-Name überall: **Retrogram - Multi Messenger** (ohne „ICQ" — Marke).

## Die Store-Variante (ohne ICQ- und Fremdlogos)

Beide Store-Builds laufen als **Retrogram** mit eigenem Icon; WhatsApp, Telegram und ICQ
erscheinen nur als Text. Die normalen Builds (Portable, Setup, DMG, Linux) bleiben unverändert.

- `scripts/build-store.js renderer|win|mas` baut die Oberfläche mit `REACT_APP_STORE=1`
  (`src/brand.js`: Titel „Retrogram", „Spiele" statt „ICQ Spiele", Skinnamen ohne „ICQ",
  **kein Spenden-Link** — Apple/Microsoft lehnen Spendenaufrufe ab), legt `store/brand/public/*`
  über die Logos in `build/` und startet danach electron-builder mit `store/builder.store.js`.
- Eigenes Icon und Kacheln: `store/brand/*.svg` → `node scripts/make-store-assets.js`
  → `store/brand/public/` (App-Icon, Flaggen-Ersatz für die Dienst-Reiter) und
  `store/res/appx/` (MSIX-Kacheln). Die erzeugten Dateien sind eingecheckt.
- Das gepackte `package.json` trägt `storeBuild: true`; `electron/main.js` setzt damit die
  Fenstertitel.
- Screenshots: `node scripts/build-store.js renderer && node scripts/store-screenshots.js`
  → `store/screenshots/` (erfundene Demo-Daten, keine echten Kontakte). Texte: `store/listing.md`.
- **Achtung:** Ein Store-Build überschreibt `build/`. Vor Portable/Setup/E2E einmal
  `npm run build` laufen lassen (die `dist:*`-Skripte tun das ohnehin).

## Microsoft Store (MSIX)

- Partner Center: Produkt `9NP6VGRMZ19V`, Typ MSIX/PWA, Identität
  `FelixHelleckes.Retrogram-MultiMessenger`, Publisher `CN=5AA07313-…`
  (steht in `package.json` → `build.appx`).
- Der erste Anlauf als EXE/MSI-App war eine Sackgasse: dafür muss der Installer
  code-signiert sein. MSIX signiert der Store selbst — kein Zertifikat nötig.
- Bauen (lokal, laufende App vorher schließen): `npm run dist:store`
  → `dist/Retrogram-<version>.appx` (unsigniert, das ist richtig; ruft `build-store.js win` auf).
- Hochladen: Partner Center → Produkt → Übermittlung → Pakete. Die Datei ist >100 MB und
  geht nur per Hand (Drag & Drop), nicht per Browser-Automatisierung.
- MSIX-Version ist immer `x.y.z.0`; für jede Einreichung `package.json` erhöhen.

## Mac App Store (MAS)

- Apple-Konto Team `5Y4L8J23FQ`, Bundle-ID `de.helleckes.retrogram`
  (nur im Store-Build, gesetzt in `store/builder.store.js`; die globale `appId`
  bleibt, sonst erkennt das Windows-Setup alte Installationen nicht mehr).
- Sandbox-Rechte: `store/mas/entitlements.mas*.plist` (Netz ausgehend, Mikrofon,
  Dateien nach Auswahl). Mikrofon-Text steht in `build.mas.extendInfo`.
- Bauen läuft nur auf macOS → `gh workflow run build-mas.yml`
  (`-f upload=true` lädt zusätzlich zu App Store Connect hoch).
- Secrets (Repo): `MAS_APP_CERT_P12`, `MAS_INSTALLER_CERT_P12`, `MAS_CERT_PASSWORD`,
  `MAS_PROVISIONING_PROFILE`, `MAS_TEAM_ID`; für den Upload `MAS_API_KEY_P8`
  (base64 der `AuthKey_*.p8`), `MAS_API_KEY_ID`, `MAS_API_ISSUER_ID`.
- **Seit 2026-10-20 lokal gebaut und hochgeladen** (Mac mit Schlüsselbund):
  Profil „Retrogram MAS" hängt jetzt am Zertifikat **Apple Distribution**
  (läuft bis **2027-07-02**), dessen Schlüssel im Schlüsselbund liegt. Vorher hing es an
  „3rd Party Mac Developer Application" — dessen Schlüssel gab es nur im Secret, und
  `MAS_CERT_PASSWORD` passte nicht mehr zu `MAS_APP_CERT_P12` (CI-Import schlug fehl).
  **`build-mas.yml` ist damit bis auf Weiteres kaputt**: Secrets `MAS_APP_CERT_P12` (Apple
  Distribution als .p12), `MAS_CERT_PASSWORD` und `MAS_PROVISIONING_PROFILE` müssten neu.
  Lokal:
  ```
  # Profil: developer.apple.com → Profiles → Retrogram MAS → Download → store/mas/embedded.provisionprofile
  MAS_BUILD_VERSION=<+1> MAS_IDENTITY="Felix Helleckes (5Y4L8J23FQ)" node scripts/build-store.js mas
  xcrun altool --upload-app -f dist/mas-universal/Retrogram-<v>-universal.pkg -t macos \
    --apiKey 3UPD3SJ67A --apiIssuer 7ec7cedf-030a-4f7a-a715-76355c7ed6b0
  ```
  `MAS_BUILD_VERSION` (CFBundleVersion) muss bei jedem Upload steigen.
- Zertifikate „3rd Party Mac Developer Application/Installer" laufen am **2027-10-05** ab.
  Danach neu anlegen (Apple-Portal → Certificates/Profiles) und die Secrets ersetzen.
- Der private Schlüssel liegt nur in den Secrets (als .p12). Geht er verloren:
  neues CSR, neue Zertifikate.

## Offene Risiken (vor der ersten Einreichung klären)

- **Marke/Logos:** App-Oberfläche zeigt ICQ-, WhatsApp- und Telegram-Logos. Apple 5.2 und
  Microsoft 10.1 prüfen das; Store-Texte und -Screenshots ohne Fremdlogos halten.
- **WhatsApp:** Baileys ist ein inoffizieller Client (Nutzungsbedingungen von WhatsApp).
  Reviewer brauchen einen Test-Zugang — den gibt es nicht.
- **Electron 29** ist alt; Apple verlangt aktuelle SDKs beim Upload. Wenn der Upload daran
  scheitert, hilft nur ein Electron-Update (riskant, siehe CLAUDE.md).
- **Exportrecht (Apple):** Signal-Verschlüsselung muss bei App Store Connect als
  Verschlüsselung deklariert werden (`ITSAppUsesNonExemptEncryption` bewusst nicht gesetzt).

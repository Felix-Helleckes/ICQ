# Microsoft Store + Mac App Store

Stand 2026-10-05. Beide Store-Builds sind **zusätzlich** zu Portable/Setup/DMG, nicht
ersetzend. Store-Name überall: **Retrogram - Multi Messenger** (ohne „ICQ" — Marke).

## Microsoft Store (MSIX)

- Partner Center: Produkt `9NP6VGRMZ19V`, Typ MSIX/PWA, Identität
  `FelixHelleckes.Retrogram-MultiMessenger`, Publisher `CN=5AA07313-…`
  (steht in `package.json` → `build.appx`).
- Der erste Anlauf als EXE/MSI-App war eine Sackgasse: dafür muss der Installer
  code-signiert sein. MSIX signiert der Store selbst — kein Zertifikat nötig.
- Bauen (lokal, laufende App vorher schließen): `npm run dist:store`
  → `dist/Retrogram-<version>.appx` (unsigniert, das ist richtig).
- Hochladen: Partner Center → Produkt → Übermittlung → Pakete. Die Datei ist >100 MB und
  geht nur per Hand (Drag & Drop), nicht per Browser-Automatisierung.
- MSIX-Version ist immer `x.y.z.0`; für jede Einreichung `package.json` erhöhen.

## Mac App Store (MAS)

- Apple-Konto Team `5Y4L8J23FQ`, Bundle-ID `de.helleckes.retrogram`
  (nur im MAS-Build, `build-mas.yml` setzt sie per `-c.appId`; die globale `appId`
  bleibt, sonst erkennt das Windows-Setup alte Installationen nicht mehr).
- Sandbox-Rechte: `store/mas/entitlements.mas*.plist` (Netz ausgehend, Mikrofon,
  Dateien nach Auswahl). Mikrofon-Text steht in `build.mas.extendInfo`.
- Bauen läuft nur auf macOS → `gh workflow run build-mas.yml`
  (`-f upload=true` lädt zusätzlich zu App Store Connect hoch).
- Secrets (Repo): `MAS_APP_CERT_P12`, `MAS_INSTALLER_CERT_P12`, `MAS_CERT_PASSWORD`,
  `MAS_PROVISIONING_PROFILE`, `MAS_TEAM_ID`; für den Upload `MAS_API_KEY_P8`
  (base64 der `AuthKey_*.p8`), `MAS_API_KEY_ID`, `MAS_API_ISSUER_ID`.
- Zertifikate laufen am **2027-10-05** ab, das Provisioning Profile am 2027-10-05.
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

# Stand: Marketing, Website, Monetarisierung

Übergabe-Dokument. Es soll genügen, um in einem neuen Chat weiterzumachen, ohne
die vorherige Unterhaltung zu kennen.

**Stand:** 01.10.2026 · **Branch:** in `main` gemerged · **Version:** 1.0.37 (veröffentlicht)
**Hosting:** im Umzug von Netlify zu Cloudflare Pages → `https://icq-retrogram.pages.dev`

---

## Karte der neuen Dateien

```
site/privacy.html            Datenschutzerklärung, zweisprachig (DE/EN)
site/robots.txt              + sitemap.xml
site/shots/contacts.png      echter Screenshot auf der Landing Page
scripts/set-site-url.js      Basis-URL an 15 Stellen umschalten
wrangler.toml                Cloudflare Pages: Ausgabeverzeichnis site/
.github/workflows/deploy-pages.yml  Deploy nach Cloudflare, braucht 2 Secrets
site/_headers                Sicherheits- und Cache-Header (ersetzt netlify.toml)
netlify.toml                 Übergang: 301-Weiterleitung, noch auskommentiert
marketing/reddit-kit.md      fertige Posts + vorbereitete Kommentar-Antworten
docs/premium-konzept.md      Bewertung: warum keine Bezahlversion
docs/stand-marketing.md      diese Datei
.github/FUNDING.yml          Sponsor-Knopf
```

---

## Offen — hier weitermachen

Nach Priorität. Die ersten drei blockieren den Reddit-Start.

### 1. GA4 scharfschalten
`site/index.html`, Konstante `GA_MEASUREMENT_ID` (derzeit `''`). GA4-Property auf
`https://icq-retrogram.pages.dev` anlegen, Mess-ID im Format `G-XXXXXXXXXX`
eintragen. **Solange die Konstante leer ist, lädt bewusst nichts** — auch nicht
bei Zustimmung. Das ist kein Versehen.

### 2. ~~Platzhalter~~ — erledigt
`site/privacy.html` ist vollständig: Verantwortlicher mit Anschrift, Kontakt und
Datum. Im README steht der Zertifikatsbetrag. Es sind keine Platzhalter mehr im
Repo. Damit hängt das Scharfschalten von GA nur noch an Punkt 1.

### 3. Zwei Cloudflare-Secrets hinterlegen
Settings → Secrets and variables → Actions → New repository secret:

- `CLOUDFLARE_API_TOKEN` — Token mit der Berechtigung *Cloudflare Pages: Edit*
  (Cloudflare → My Profile → API Tokens → Create Token)
- `CLOUDFLARE_ACCOUNT_ID` — steht in der Cloudflare-Seitenleiste bzw. in der
  Dashboard-URL hinter `dash.cloudflare.com/`

Mehr nicht. `.github/workflows/deploy-pages.yml` legt das Pages-Projekt beim
ersten Lauf selbst an und deployt bei jeder Änderung unter `site/`. Ohne die
Secrets überspringt der Workflow den Deploy mit einem Hinweis, statt rot zu
werden. Ein Besuch im Cloudflare-Dashboard ist für das Anlegen nicht nötig.

### 4. Umzug abschließen
Im Repo ist alles umgestellt: alle 15 Basis-URLs zeigen auf
`https://icq-retrogram.pages.dev`, dazu `wrangler.toml`, `site/_headers` und der
Deploy-Workflow. (`icq.pages.dev` war bereits vergeben, daher dieser Name.)
Nach Punkt 3, **in dieser Reihenfolge**:

1. Prüfen, dass `https://icq-retrogram.pages.dev` wirklich ausliefert.
2. **Erst dann** den Weiterleitungsblock am Ende von `netlify.toml`
   entkommentieren und pushen. Vorher wäre die Seite tot — Netlify leitete auf
   einen Host weiter, den es noch nicht gibt.
3. Website-Feld in den GitHub-Repo-Settings von Hand auf die neue URL setzen.
   Über die API geht es nicht, der Proxy sperrt Repo-Settings-Schreibzugriffe.
4. Netlify-Projekt löschen — aber **nicht sofort**. Die 301-Weiterleitung sagt
   Google und jedem, der den alten Link kennt, wohin die Seite gezogen ist. Ein
   gelöschtes Projekt antwortet mit 404, und jeder gesetzte Link läuft ins
   Leere. Ein paar Monate laufen lassen.

Bei späterer eigener Domain:

    node scripts/set-site-url.js https://neue-domain.de

Ändert 15 Stellen in `site/index.html`, `robots.txt`, `sitemap.xml` und schreibt
die Konstante `CURRENT` im Skript selbst fort. Nicht erfasst und von Hand
nachzuziehen: Search-Console-Property, GA4-Datenstream, Website-Feld am Repo,
`presse/pitch-mail.md`, `marketing/reddit-kit.md`, der Projektname in
`wrangler.toml` und `.github/workflows/deploy-pages.yml`, sowie die
Retrogram-Einträge in den Repos `Felix-Helleckes` (readme.md) und
`felix-helleckes.github.io` (gitprofile.config.ts und index.html, dort zweimal).

### 5. Search Console
Zwei Wege, beide im `<head>` von `site/index.html` dokumentiert. Der bequeme:
sobald GA4 läuft, in der Search Console „Google Analytics" als
Verifizierungsmethode wählen — keine Dateiänderung nötig.

### 6. GitHub Sponsors freischalten, dann `github:` eintragen
github.com/sponsors → Antrag, Stripe-Connect-Konto, Steuerformular. Danach in
**allen elf** `.github/FUNDING.yml` die Zeile `# github: Felix-Helleckes`
entkommentieren. Betroffen: ICQ plus Felix-Helleckes, Shopify_eu_label_manager,
hotsndots, WorldClockLive-releases, gruener-faktencheck, MithrilUI, TradingBot,
dataprivacy, tedstream, WindowsDownloadOrganizer.

Eleganter wäre ein Repo `Felix-Helleckes/.github` mit **einer** `FUNDING.yml`
darin (Pfad: `.github/FUNDING.yml` innerhalb dieses Repos). Die gilt als Vorgabe
für alle Repos des Kontos, auch künftige, und wird von repo-eigenen Dateien
überschrieben. Dann könnten die elf Einzeldateien weg.

### 7. Reddit-Posts absenden
`marketing/reddit-kit.md`. Ein Post pro Tag, nie derselbe Text in zwei Subs.
Danach eine Woche warten und die Zahlen unten vergleichen.

---

## Entscheidungen, die nicht versehentlich sind

Wer hier etwas „repariert", macht es kaputt.

**`GA_MEASUREMENT_ID` ist leer.** Kein vergessener Platzhalter. Verhindert, dass
GA still mitläuft, solange die Datenschutzseite noch Platzhalter hat.

**Consent Mode steht auf `denied`, bevor irgendein Tag lädt.** `gtag.js` wird
erst nach aktivem Klick nachgeladen. Nicht auf „bequemer" umbauen.

**Ablehnen und Einverstanden sehen identisch aus.** Ein optisch hervorgehobener
Zustimmen-Knopf ist genau das Nudging, das die Datenschutzkonferenz beanstandet.
Absicht, kein Designfehler.

**`github:` in FUNDING.yml ist auskommentiert.** Ohne Sponsors-Freischaltung
führt der Knopf auf eine 404-Seite — schlechter als kein Knopf.

**Alle Basis-URLs sind absolut.** OG-Scraper (Facebook, LinkedIn, Slack) und
Google verwerfen relative Pfade. Nie auf relativ zurückbauen; ändern nur über
`scripts/set-site-url.js`, sonst bleibt ein `canonical` stehen und erklärt die
neue Domain zum Duplikat.

**i18n: HTML im String braucht `data-i18n-html`.** `applyLang()` setzt sonst
`textContent`, und `<b>uh-oh!</b>` steht wörtlich auf der Seite. Genau dieser
Fehler war live. Gleiches gilt für Entities: ein `&amp;` in einem
textContent-String erscheint wörtlich, also im Dictionary ein rohes `&`.

**`public/Chatwindow.png` ist bewusst nicht auf der Seite.** Die Schwärzungen
verdecken fast das ganze Fenster, das hätte geschadet. Ein sauberer Ersatz-Shot
kann nach `site/shots/` und als zweite `<figure>` in die Screenshot-Sektion.

**Es gibt keine Premium-Version, und das ist eine Entscheidung.** Begründung in
`docs/premium-konzept.md`. Kurz: MIT macht jeden Lizenzcheck wirkungslos, Geld
nehmen verschiebt die rechtliche Position bei einer inoffiziellen
WhatsApp-Anbindung, und die Ertragsrechnung trägt den Aufwand nicht.

---

## Prüfen

`site/` ist in `.eslintrc.json` ignoriert und von keiner Test-Suite abgedeckt.
Was stattdessen hilft:

```bash
# Seite in beiden Sprachen rendern (Chromium liegt unter /opt/pw-browsers)
chrome --headless=new --window-size=1280,3400 --virtual-time-budget=6000 \
  --screenshot=page.png "file://$PWD/site/index.html"
# ?lang=de für die deutsche Fassung

# i18n-Vollständigkeit: alle data-i18n-Keys müssen in EN und DE existieren
# (Stand zuletzt: 51/51 in beiden)
```

`scripts/set-site-url.js` liegt im Lint-Bereich (`eslint src electron scripts
e2e`) und läuft in CI mit. Bei Änderungen daran `npm run lint`.

**CI und Release:** `ci.yml` läuft bei jedem Push auf `main` (Lint, Tests, Build
auf drei Systemen). `release.yml` läuft ebenfalls, ist aber ohne erhöhte
`version` in `package.json` ein No-op. Website-Änderungen lösen also kein Release
aus.

---

## Ausgangszahlen — Vergleichsbasis für nach dem Reddit-Post

Stand vor jeder Promo-Aktion, 12.09.2026:

| | |
|---|---|
| Stars / Forks / Watcher | 9 / 3 / 0 |
| Downloads, alle Releases zusammen | 172 |
| Neuestes Release v1.0.36 | ~30 |

Abrufbar über `https://api.github.com/repos/Felix-Helleckes/ICQ/releases`,
Feld `download_count` je Asset aufsummieren.

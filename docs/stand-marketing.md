# Stand: Marketing, Website, Monetarisierung

Übergabe-Dokument. Es soll genügen, um in einem neuen Chat weiterzumachen, ohne
die vorherige Unterhaltung zu kennen.

**Stand:** 02.10.2026 · **Branch:** in `main` gemerged · **Version:** 1.1.0 (veröffentlicht)
**Hosting:** Umzug abgeschlossen. `https://icq-retrogram.pages.dev` liefert aus
(Cloudflare Pages, Secrets hinterlegt, Deploy-Workflow grün). GA4 läuft, Search
Console verifiziert, Sitemap eingereicht, Repo-Website-Feld zeigt auf die neue
URL. Netlify wird nicht mehr gebraucht — Entscheidung: kein Übergangs-Redirect,
Netlify-Projekt direkt gelöscht, `netlify.toml` aus dem Repo entfernt. Alle
bekannten Außenlinks (GitHub-Profil, Portfolio-Seite) zeigten beim Prüfen
bereits auf `icq-retrogram.pages.dev`.

---

## Karte der neuen Dateien

```
site/privacy.html            Datenschutzerklärung, zweisprachig (DE/EN)
site/robots.txt              + sitemap.xml
site/shots/contacts.png      echter Screenshot auf der Landing Page
scripts/set-site-url.js      Basis-URL an 15 Stellen umschalten
wrangler.toml                Cloudflare Pages: Ausgabeverzeichnis site/
.github/workflows/deploy-pages.yml  Deploy nach Cloudflare, braucht 2 Secrets
site/_headers                Sicherheits- und Cache-Header (ersetzt netlify.toml,
                              das aus dem Repo entfernt wurde)
marketing/reddit-kit.md      fertige Posts + vorbereitete Kommentar-Antworten
docs/premium-konzept.md      Bewertung: warum keine Bezahlversion
docs/stand-marketing.md      diese Datei
.github/FUNDING.yml          Sponsor-Knopf
```

---

## Offen — hier weitermachen

### 1. ~~GA4 scharfschalten~~ — erledigt
Property „ICQ Retrogram" + Datenstream für `https://icq-retrogram.pages.dev`
angelegt, Mess-ID `G-WFQNRSXPWR` in `GA_MEASUREMENT_ID` eingetragen, deployt.

### 2. ~~Platzhalter~~ — erledigt
`site/privacy.html` ist vollständig: Verantwortlicher mit Anschrift, Kontakt und
Datum. Im README steht der Zertifikatsbetrag. Es sind keine Platzhalter mehr im
Repo.

### 3. ~~Zwei Cloudflare-Secrets hinterlegen~~ — erledigt
`CLOUDFLARE_API_TOKEN` (Account/Cloudflare Pages/Edit) und
`CLOUDFLARE_ACCOUNT_ID` liegen als Repo-Secrets. Workflow hat das
Pages-Projekt `icq-retrogram` selbst angelegt und deployt grün bei jeder
Änderung unter `site/`.

### 4. ~~Umzug~~ — erledigt, Netlify komplett abgeschaltet
Im Repo ist alles umgestellt: alle 15 Basis-URLs zeigen auf
`https://icq-retrogram.pages.dev`, dazu `wrangler.toml`, `site/_headers` und der
Deploy-Workflow. (`icq.pages.dev` war bereits vergeben, daher dieser Name.)

1. ✅ `https://icq-retrogram.pages.dev` liefert aus, geprüft.
2. ✅ Website-Feld in den GitHub-Repo-Settings auf die neue URL gesetzt.
3. ✅ Geprüft, wo außerhalb des Repos noch auf die Seite verlinkt wird:
   `Felix-Helleckes/readme.md` und `felix-helleckes.github.io`
   (`index.html`, `gitprofile.config.ts`) zeigten beim Nachsehen bereits auf
   `icq-retrogram.pages.dev` — nichts zu ändern.
4. ✅ **Entscheidung geändert:** Netlify wird nicht mehr gebraucht, daher kein
   301-Übergangs-Redirect mehr. Grund für den Kurswechsel: Netlifys
   Production-Deploys liefen ohnehin auf „operational credits" und waren
   pausiert (`Skipped due to account credit usage exceeded`) — der Redirect
   wäre also gar nicht live gegangen, ohne dass zusätzlich Geld investiert
   wird. Da alle bekannten Links bereits auf Cloudflare zeigen, lohnt sich das
   nicht mehr. `netlify.toml` aus dem Repo entfernt, Netlify-Projekt
   `icq-remake` gelöscht. Wer über einen alten, nicht bekannten
   `icq-remake.netlify.app`-Link kommt, bekommt jetzt ein 404 statt einer
   Weiterleitung — akzeptiertes Risiko laut Felix, da keine aktiven Backlinks
   bekannt sind.

Bei späterer eigener Domain:

    node scripts/set-site-url.js https://neue-domain.de

Ändert 15 Stellen in `site/index.html`, `robots.txt`, `sitemap.xml` und schreibt
die Konstante `CURRENT` im Skript selbst fort. Nicht erfasst und von Hand
nachzuziehen: Search-Console-Property, GA4-Datenstream, Website-Feld am Repo,
`presse/pitch-mail.md`, `marketing/reddit-kit.md`, der Projektname in
`wrangler.toml` und `.github/workflows/deploy-pages.yml`, sowie die
Retrogram-Einträge in den Repos `Felix-Helleckes` (readme.md) und
`felix-helleckes.github.io` (gitprofile.config.ts und index.html, dort zweimal).

### 5. ~~Search Console~~ — erledigt, aber anders als geplant
Property für `https://icq-retrogram.pages.dev` angelegt (URL-Präfix, nicht
Domain — Cloudflare erlaubt uns keine DNS-TXT-Bestätigung auf `pages.dev`),
Sitemap `sitemap.xml` eingereicht.

Die „Google Analytics"-Verifizierungsmethode ist **nicht** der bequeme Weg,
den dieser Absatz früher versprach — sie scheitert mit „Auf der Indexseite
wurden keine Tracking-Codes gefunden". Grund: Consent Mode lädt `gtag.js`
erst nach aktivem Klick nach, also steht beim Crawl kein statisches
`<script src=.../gtag/js>` im `<head>`. Das ist dieselbe Absicht wie bei
`GA_MEASUREMENT_ID` — nicht reparieren. Stattdessen HTML-Tag-Methode
verwendet: Token in `site/index.html` als
`<meta name="google-site-verification">` eingetragen, verifiziert.

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

### 7. SEO — Stand 02.10.2026 und was noch fehlt
Erledigt: deutsche Seite `/de` (siehe Entscheidungen), „ICQ" in H1 und Titel,
FAQ-Frage zur ICQ-Abschaltung 2024 („ICQ Alternative"/„ICQ eingestellt"),
Sitemap mit `/de`, `/privacy` und `lastmod`, `reel.html` auf `noindex`.

Geprüft am 02.10.2026 (Search Console + GA4 im Konto):
- `/` ist indexiert („URL ist auf Google"), HTTPS ok. Berichte zeigen noch „Daten
  werden verarbeitet" (Property neu).
- Sitemap neu eingereicht; Status stand noch auf „Konnte nicht abgerufen werden"
  (vom Umzugstag). Technisch ok: liefert auch für Googlebot-UA 200 + gültiges XML.
- GA4 zählt nachweislich: Test mit Zustimmung → Echtzeit 1 Nutzer, `page_view`.
  **Felix' eigener Chrome zählt nie** — uBlock Origin Lite und ein zweiter
  Blocker ersetzen gtag.js durch eine Attrappe. Zum Testen einen Browser ohne
  Blocker nehmen.

Offen, in dieser Reihenfolge:
1. **Search Console:** `/de` → „URL-Prüfung" → „Indexierung beantragen". Am
   02.10. abgelehnt mit „Kontingent überschritten" (Tageslimit) — ab 03.10.
   erneut. Danach Sitemap-Status und Bericht „Seiten" ansehen.
2. **Eigene Domain** (z. B. `icq-retrogram.de`). Eine `pages.dev`-Subdomain rankt
   schwach und sammelt keine eigene Autorität. Umstellen mit
   `node scripts/set-site-url.js https://…` (baut `de.html` mit).
3. **Backlinks.** Für den nackten Suchbegriff „ICQ" ist Platz 1 unrealistisch
   (ICQ selbst, Wikipedia, News zur Abschaltung). Erreichbar sind Long-Tail-
   Suchen („ICQ für WhatsApp", „ICQ Alternative", „ICQ 5 Nachbau") — und die
   hängen an Links: Reddit-Posts (Punkt 8), Pressemail an Seiten, die über das
   Fanprojekt „ICQ Reborn" berichtet haben (digitec/galaxus, ifun.de), Hacker
   News „Show HN", AlternativeTo-Eintrag.

### 8. Reddit-Posts absenden
`marketing/reddit-kit.md`. Ein Post pro Tag, nie derselbe Text in zwei Subs.
Danach eine Woche warten und die Zahlen unten vergleichen.

---

## Entscheidungen, die nicht versehentlich sind

Wer hier etwas „repariert", macht es kaputt.

**GA zählt nur, wer zustimmt.** `GA_MEASUREMENT_ID` ist seit dem 02.10.2026
gesetzt (`G-WFQNRSXPWR`), `gtag.js` lädt aber erst nach „Einverstanden" (Basic
Consent Mode). Die GA-Zahlen liegen deshalb deutlich unter den echten Besuchen —
für Vergleiche über die Zeit taugen sie, als absolute Zahl nicht. Die
Download-Zahlen der Releases (siehe unten) sind die verlässlichere Kennzahl.

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

**Deutsch ist eine eigene Seite: `site/de.html` (URL `/de`), generiert.** Früher
war Deutsch nur `?lang=de` mit `canonical` auf die englische Seite — Google wertet
das als Duplikat, deutsche Suchen fanden die Seite nie. Jetzt erzeugt
`npm run site:build` aus `index.html` + `I18N.de` eine statische deutsche Seite
mit eigenem canonical, Titel, Description und FAQ-Schema; das FAQ-Schema beider
Seiten wird dabei aus dem Wörterbuch neu geschrieben (muss dem sichtbaren Text
entsprechen). **Nie `de.html` von Hand ändern** — `npm run lint` (CI) schlägt bei
veralteter `de.html` fehl. Kopf-Texte stehen als `meta.title`, `meta.desc`,
`og.title`, `og.desc` im Wörterbuch; Bild-Alt-Texte über `data-i18n-alt`.
Sprachwahl = URL; die Links EN/DE sind echte Links (crawlbar), gespeichert wird
nur eine aktive Wahl (`icq-lang`), die `/` dann nach `/de` weiterleitet.

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

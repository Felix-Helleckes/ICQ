# Premium für ICQ Retrogram — Konzept und Bewertung

Entscheidungspapier, kein Umsetzungsplan. Es beantwortet eine Frage: Lässt sich
mit diesem Projekt in seiner jetzigen Form Geld verdienen, und wenn ja, wie ohne
sich dabei angreifbar zu machen.

**Kein Rechts- oder Steuerrat.** Die rechtlichen Punkte unten sind Hinweise
darauf, wo etwas zu klären ist, nicht die Klärung selbst.

---

## 1. Ausgangslage

| | |
|---|---|
| Stars / Forks | 9 / 3 |
| Downloads, alle Releases zusammen | 172 |
| Neuestes Release (v1.0.36) | ~30 |
| Lizenz | MIT |
| Monetarisierung heute | ein PayPal.me-Link, sonst nichts |
| Codebasis | ~5.700 Zeilen, zwei Bridges, drei Skins |

Die Zahlen sind der Stand vor jeder Promo-Aktion. Jede Rechnung weiter unten
sollte nach dem ersten Reddit-Post mit echten Zahlen wiederholt werden — vorher
ist alles Schätzung.

---

## 2. Drei Sperren, bevor es um Features geht

Das sind keine Detailfragen. Jede davon kann das Modell allein kippen.

### 2.1 MIT erlaubt jedem, den Lizenzcheck zu entfernen

Der komplette Quellcode liegt offen unter einer Lizenz, die Weiterverbreitung
und Veränderung ausdrücklich gestattet. Ein clientseitiger Lizenzcheck ist damit
kein Schutz, sondern eine Unbequemlichkeit: Fork, Check raus, neu bauen.

Drei mögliche Antworten:

- **Lizenz ändern** — geht nur für künftige Versionen, der bisherige Stand
  bleibt für immer MIT und forkbar. Kostet die Glaubwürdigkeit, die in der
  Presse-Pitch ausdrücklich als Argument geführt wird („Open Source unter MIT,
  mit Klarnamen").
- **Open Core** — Kern bleibt MIT, Zusatzmodule in einem privaten Repo. Sauber
  trennbar, aber es verdoppelt den Wartungsaufwand und die Build-Pipeline.
- **Etwas verkaufen, das nicht im Binary liegt** — ein Dienst, den ein Fork
  nicht mitkopieren kann. Siehe Weg E.

### 2.2 Geld nehmen verändert die rechtliche Position

Heute: eine Privatperson veröffentlicht kostenlos einen Client, der eine
inoffizielle WhatsApp-Schnittstelle nutzt. Das verstößt gegen WhatsApps
Nutzungsbedingungen, mehr aber auch nicht — es gibt kein Vertragsverhältnis mit
Nutzern und keinen wirtschaftlichen Vorteil.

Mit Bezahlung: ein gewerblicher Anbieter erzielt Umsatz mit einem Zugang, den
der Plattformbetreiber nicht gestattet. Das ist eine andere Ausgangslage, und
Meta ist gegen Anbieter modifizierter WhatsApp-Clients in der Vergangenheit
vorgegangen. Ob und wie schnell das ein Hobbyprojekt dieser Größe trifft, kann
niemand seriös vorhersagen — aber der Unterschied zwischen „kostenlos" und
„kostenpflichtig" ist genau die Grenze, an der die Risikobewertung kippt.

Dazu kommt der deutsche Verwaltungsteil, der bei Bezahlung greift: Gewerbe,
Umsatzsteuer auf digitale Güter am Wohnsitz des Kunden (der Grund, warum
Solo-Entwickler fast immer über einen Merchant of Record wie Paddle,
Lemon Squeezy oder FastSpring verkaufen statt direkt über Stripe), und das
Widerrufsrecht bei digitalen Inhalten, das vor dem Download ausdrücklich
abbedungen werden muss.

### 2.3 Zahlende Nutzer mit gesperrtem Konto

Das FAQ auf der Website sagt es bereits offen: Eine Sperre des WhatsApp-Kontos
ist möglich. Bei einem kostenlosen Projekt ist das ein Hinweis. Bei einem
bezahlten Produkt ist es eine Erwartung an eine Gegenleistung — mit Rückfragen,
Rückerstattungen und, im schlechtesten Fall, mit einer öffentlichen Diskussion
darüber, ob hier jemand Geld für etwas genommen hat, das Konten kostet.

Das ist der Punkt, der am meisten unterschätzt wird und am wenigsten mit Technik
zu lösen ist.

---

## 3. Was wäre überhaupt abgrenzbar?

Ehrliche Bestandsaufnahme. Premium braucht etwas, das man weglassen kann, ohne
die Gratisversion unbrauchbar zu machen — und das gleichzeitig wertvoll genug
ist, dass jemand zahlt.

**Vorhanden, aber schlecht als Bezahlschranke geeignet:**

- *Drei Skins.* Kosmetik ist die klassische Antwort, und sie ist hier ungeeignet:
  Der Look **ist** das Produkt. Wer den ICQ-Skin hinter eine Schranke legt,
  verkauft die Gratisversion nicht mehr.
- *Spiele.* Sind zwei externe Links (bloob.io, slidealama.eu), kein eigener
  Inhalt. Nichts, was man verkaufen kann.
- *WhatsApp oder Telegram einzeln.* Der Mehrwert ist gerade, dass beide in einem
  Fenster liegen. Eins davon kostenpflichtig zu machen zerstört den Kern.

**Denkbar, mit echtem Wert und ohne den Kern zu beschädigen:**

- *Mehrere Konten pro Dienst.* Zwei WhatsApp- oder Telegram-Konten parallel.
  Klarer Nutzen, klar abgrenzbar, technisch ein echter Umbau (Datenverzeichnis,
  Bridge-Instanzen, Fensterverwaltung).
- *Chat-Backup und -Export.* Lokales, durchsuchbares Archiv über die Grenzen der
  Messenger hinweg. Das ist ein Feature, für das Menschen erfahrungsgemäß eher
  zahlen als für Aussehen.
- *Die offenen Punkte aus `Featurefile.md`* — globaler Hotkey, Command Palette,
  dienstübergreifende Suche mit Filtern. Steht dort als „future implementation",
  wäre also ohnehin neu zu bauen.

Nüchtern: Das ist dünn. Keiner dieser Punkte ist heute fertig, und jeder ist
mehrere Wochenenden Arbeit.

---

## 4. Fünf Wege, bewertet

| Weg | Aufwand | Realistischer Ertrag | Risiko | Urteil |
|-----|---------|---------------------|--------|--------|
| **A** GitHub Sponsors + besseres Spenden-Framing | Stunden | gering, aber echt | keins | **Jetzt machen** |
| **B** Bezahl-Skins / Kosmetik | mittel | gering | mittel | Nein — der Look ist das Produkt |
| **C** Pro-Features (Multi-Konto, Backup, Suche) | Wochen | mittel | hoch (2.1–2.3 alle drei) | Nur nach A und mit Zahlen |
| **D** Microsoft Store, kostenpflichtig | mittel | unklar | hoch | Store-Review ist die Wand |
| **E** Entkoppeln: Retro-Shell auf offiziellen APIs | Monate | offen nach oben | gering | Der einzige tragfähige Weg |

### A — Spenden ordentlich aufstellen

Der PayPal-Link steht in der Sidebar und zweimal auf der Website. Was fehlt:
**GitHub Sponsors** (sichtbar direkt am Repo, dort wo Entwickler sind, mit
monatlich wiederkehrender Option statt Einmalzahlung), und ein Grund. „Unterstütze
das Projekt" trägt nicht. „Das Code-Signing-Zertifikat kostet X im Jahr, damit
Windows nicht mehr vor jedem Download warnt" ist ein konkretes Ziel, das jeder
versteht, der die SmartScreen-Warnung gerade weggeklickt hat.

Kein Rechtsproblem, kein Gewerbe, keine Umsatzsteuer, keine Erwartungshaltung
zahlender Kunden. Das ist der einzige Weg auf dieser Liste, der heute ohne
Vorbehalt umsetzbar ist.

### E — Der Weg, der tatsächlich trägt

Das Asset dieses Projekts ist **nicht** die WhatsApp-Anbindung. Die ist der
riskanteste Teil und jederzeit von Meta kündbar. Das Asset ist die
originalgetreue ICQ-5-Oberfläche mit eigenen Chat-Fenstern, drei Skins und dem
Sound — 5.700 Zeilen, in denen echte Arbeit steckt und die niemand sonst hat.

Diese Shell auf offiziellen Schnittstellen läuft ohne die Sperren aus Abschnitt 2:
Telegram hat eine dokumentierte, erlaubte API. Für WhatsApp gibt es die offizielle
Business Cloud API — anderer Anwendungsfall, aber legitim.

Konkret: Der Baileys-Pfad bleibt kostenlos, quelloffen und ausdrücklich als
Hobby-Experiment markiert. Was verkauft wird, ist die Version auf offizieller
Basis. Damit löst sich 2.2 vollständig und 2.3 weitgehend auf.

Der Preis: Das ist Monate Arbeit und ein anderes Produkt mit einer anderen
Zielgruppe. Es ist kein Feature-Flag, das man an einem Abend einbaut.

---

## 5. Die Rechnung, damit niemand sich etwas vormacht

Grobe Größenordnung, **keine Prognose**. Setze eigene Zahlen ein, sobald nach
dem ersten Reddit-Post echte vorliegen.

Angenommen ein wirklich guter Post, der die Downloads um den Faktor 50 hebt —
also grob 8.000 statt 172. Angenommen weiter, ein Viertel davon nutzt die App
länger als eine Woche: 2.000 aktive Nutzer.

- **Spenden** liegen bei kostenlosen Werkzeugen erfahrungsgemäß im Bereich von
  Bruchteilen eines Prozents der Nutzer. Bei 2.000 Aktiven sind das
  Größenordnung *einige* Zahlungen, nicht hunderte. Monatlich: zweistellig, wenn
  es gut läuft.
- **Bezahlversion**, freemium, einmalig 10 €: Konversionsraten von 1–3 % sind
  bei Desktop-Software ein üblicher Rahmen. Das wären 20–60 Käufe, also
  **200–600 € einmalig** — nicht pro Monat. Davon gehen Zahlungsdienstleister,
  Umsatzsteuer und, falls nötig, ein Code-Signing-Zertifikat ab.

Dem steht gegenüber: Gewerbeanmeldung, Umsatzsteuerabwicklung über einen
Merchant of Record, eine Widerrufsbelehrung, Support für zahlende Kunden, und
das Risiko aus Abschnitt 2.2.

**Das ist das eigentliche Ergebnis dieses Papiers.** Der Aufwand für ein
Premium-Modell steht bei dieser Projektgröße in keinem Verhältnis zum Ertrag.
Was sich lohnt, ist Reichweite — und Reichweite zahlt in diesem Projekt auf
etwas anderes ein als auf Umsatz: auf ein vorzeigbares Portfolio-Stück mit
echten Nutzerzahlen.

---

## 6. Empfehlung

**Jetzt:**
1. GitHub Sponsors einrichten, Spendenziel konkret benennen (Zertifikat).
2. Reddit-Posts absenden (`marketing/reddit-kit.md`).
3. Eine Woche später die Zahlen ansehen: Downloads, Stars, Analytics. Erst dann
   ist diese Tabelle mehr als eine Schätzung.

**Wenn die Zahlen überraschen** — mehrere tausend Downloads, aktive Issues,
Nutzer die von sich aus nach Features fragen:
4. Weg E ernsthaft prüfen. Nicht Weg C — ein Premium-Flag auf dem Baileys-Pfad
   kauft dir alle drei Sperren auf einmal ein, für wenige hundert Euro.

**Wenn die Zahlen nicht überraschen:**
5. Dann war die Antwort auf die Ausgangsfrage: Bekanntheit ja, Geld nein. Das
   ist kein schlechtes Ergebnis für ein Hobbyprojekt — es ist nur ein anderes
   als erhofft.

---

## 7. Wovon ich abrate

- **Lizenzcheck im Client bei bestehender MIT-Lizenz.** Kostet Arbeit, schützt
  nichts, und die erste Reaktion auf Reddit wird ein Link zum Fork ohne Check
  sein.
- **Spendenaufruf in der App aufdringlicher machen.** Der dezente Herz-Footer in
  der Sidebar ist genau richtig. Ein Dialog beim Start kostet mehr Wohlwollen,
  als er einbringt.
- **Geld nehmen, bevor das FAQ-Versprechen zur Kontosperre geklärt ist.** Solange
  die Antwort „kann passieren, keine Garantie" lautet, ist eine Bezahlversion
  auf diesem Pfad ein Versprechen, das nicht gehalten werden kann.

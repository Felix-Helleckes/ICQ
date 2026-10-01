# Reddit-Kit — ICQ Retrogram

Fertige Posts zum Selbstabschicken. Ein Post pro Tag, **nie** derselbe Text in
zwei Subs (Reddit erkennt das und wertet ab).

> **Vor jedem Post die Sidebar-Regeln des Subs lesen.** Die Einschätzungen unten
> sind Erfahrungswerte, keine Garantie — Subreddit-Regeln ändern sich, und ein
> Regelverstoß kostet dich den Account, nicht nur den Post.

---

## Grundregeln

1. **Account vorbereiten.** Ein Account ohne Historie, dessen erster Post ein
   eigenes Projekt bewirbt, wird von der Spam-Erkennung und von Moderatoren
   gleichermaßen aussortiert. Vorher ein paar Wochen normal kommentieren.
2. **Nostalgie ist der Aufhänger, nicht die Technik.** „Ich habe einen Electron-
   Multi-Messenger gebaut" stirbt. „ICQ ist tot, also habe ich seine Oberfläche
   über mein WhatsApp gelegt" funktioniert.
3. **Die ersten zwei Stunden entscheiden.** Poste nur, wenn du danach zwei
   Stunden Zeit hast, jeden Kommentar zu beantworten. Frühe Antwortdichte ist
   das, was Reddit nach oben sortiert.
4. **Den WhatsApp-Haken selbst ansprechen.** Wenn du es nicht tust, tut es der
   erste Kommentar — und dann steht es als Vorwurf da statt als Transparenz.
5. **Nicht posten in** r/privacy, r/privacytoolsIO, r/WhatsApp. Ein inoffizieller
   Client wird dort zerlegt bzw. verstößt gegen die Sub-Regeln. Das ist kein
   „schlechtes Publikum", das ist das falsche Publikum.

**Timing:** Dienstag–Donnerstag. Englische Subs 13–16 Uhr UTC, deutsche Subs
18–20 Uhr MEZ.

---

## Subreddits — Reihenfolge zum Abarbeiten

| # | Subreddit | Warum | Format | Anmerkung |
|---|-----------|-------|--------|-----------|
| 1 | r/SideProject | Freundlichstes Publikum, Eigenwerbung ausdrücklich erwünscht. Guter Testlauf. | Text + Bild | Niedriges Risiko — hier zuerst, um Kommentar-Antworten zu üben |
| 2 | r/coolgithubprojects | Genau dafür gemacht | Link auf GitHub | Flair `Javascript` setzen |
| 3 | r/electronjs | Der Baileys-statt-Browser-Umbau ist dort echter Gesprächsstoff | Text | Technisch schreiben, nicht werblich |
| 4 | r/opensource | MIT + Klarname zählen dort | Text | Kein Marketing-Ton, sonst Gegenwind |
| 5 | r/software | Größte Reichweite der Liste | Text | Regeln vorher genau lesen, oft Flair-Pflicht |
| 6 | r/de oder r/Datenschutz-freie deutsche Tech-Subs | Deutscher Text, ICQ-Nostalgie sitzt hier besonders tief | Text | r/de hat strenge Eigenwerbungsregeln — erst prüfen |

r/nostalgia und r/2000s haben das beste Publikum, verbieten aber in der Regel
jede Form von Eigenwerbung. Nur mit ausdrücklicher Mod-Freigabe versuchen.

---

## Post 1 — r/SideProject

**Titel:** ICQ shut down for good, so I put its 2003 interface on top of my WhatsApp and Telegram

**Text:**

> When ICQ finally shut down I went looking for a replacement and found the same
> problem in every revival project: a brand new network with nobody in it. So I
> went the other way around. I did not rebuild ICQ's servers — I rebuilt ICQ 5's
> interface and put it on top of the messengers I already use.
>
> So you get the 2003 contact list, a separate floating window per contact, and
> the uh-oh sound — but you are talking to the people you already talk to. Nobody
> has to be talked into installing anything.
>
> Built with Electron and React. WhatsApp goes through its multi-device protocol
> directly over a WebSocket (no headless browser in the background), Telegram
> through MTProto. Windows, macOS and Linux, MIT licensed, free.
>
> Being upfront about the catch: the WhatsApp side uses an unofficial interface,
> like every third-party client does. That can violate WhatsApp's Terms of
> Service and I cannot rule out account bans. It is on the website and in the
> README, and I would rather say it here than have it be the top comment.
>
> Site: https://icq-retrogram.pages.dev/
> Source: https://github.com/Felix-Helleckes/ICQ
>
> Happy to answer anything about the Baileys migration — ripping the browser out
> halved the download size and was the single biggest win in the project.

*Bild anhängen:* `marketing/social/landscape-1600x900.png`

---

## Post 2 — r/electronjs

**Titel:** Replaced a headless browser with WhatsApp's multi-device protocol in my Electron app — half the bundle, and a pile of lessons about ESM in Electron

**Text:**

> My app is an ICQ-5-style client for WhatsApp and Telegram. It used to drive a
> headless browser for the WhatsApp side. I moved it to Baileys, which speaks the
> multi-device protocol directly over a WebSocket. Roughly half the download size
> and a much faster cold start.
>
> Three things that cost me real time, in case they save someone else some:
>
> **Baileys is ESM, Electron's Node cannot `require()` it.** Lazy `await import()`
> plus `asarUnpack` in the electron-builder config, otherwise it breaks only in
> the packaged build and not in dev.
>
> **WhatsApp sends the history sync exactly once, when you pair.** Every later
> start receives nothing. Without persisting the store to disk, the contact list
> comes up empty on the second launch and you will be convinced your code is
> broken.
>
> **Never retry a send.** `sendMessage` can throw *after* the message went out. A
> retry delivers it twice and you cannot take that back. A send failure must also
> not trigger a reconnect, or everything after it fails with "not ready".
>
> Source, MIT: https://github.com/Felix-Helleckes/ICQ
>
> The WhatsApp interface is unofficial — worth knowing before anyone builds on it.

---

## Post 3 — r/opensource

**Titel:** ICQ Retrogram — an MIT-licensed ICQ 5 interface for WhatsApp and Telegram, no server of mine involved

**Text:**

> Every ICQ revival I looked at had two problems: an empty network, and no clear
> answer to who runs the servers. This one avoids both by not being a network at
> all. It is a desktop client that recreates ICQ 5's interface and connects to
> WhatsApp and Telegram directly from your machine. There is no backend of mine,
> nothing is routed through me, and your session data stays in a local folder.
>
> MIT, real name on it, the full source is on GitHub. Windows, macOS, Linux.
>
> Honest limitation: the WhatsApp connection uses an unofficial interface, which
> may violate their Terms of Service. The Telegram side uses MTProto, which is
> documented and permitted. If that trade-off is not acceptable to you, the
> Telegram half works on its own.
>
> https://github.com/Felix-Helleckes/ICQ

---

## Post 4 — deutscher Sub

**Titel:** ICQ ist abgeschaltet — also habe ich die Oberfläche von 2003 über mein WhatsApp gelegt

**Text:**

> Alle ICQ-Neuauflagen haben dasselbe Problem: ein nagelneues Netzwerk, in dem
> niemand ist. Ich habe es deshalb andersherum gemacht und nicht ICQs Server
> nachgebaut, sondern ICQs Oberfläche — und die über WhatsApp und Telegram gelegt.
>
> Heißt: Kontaktliste von 2003, ein eigenes Fenster pro Chat, der uh-oh-Sound —
> aber du schreibst mit den Leuten, mit denen du sowieso schreibst. Niemand muss
> überredet werden, irgendwas zu installieren.
>
> Kostenlos, Open Source unter MIT, Windows/macOS/Linux. Kein Server von mir
> dazwischen, die App verbindet sich direkt von deinem Rechner aus.
>
> Der ehrliche Haken: Die WhatsApp-Anbindung ist inoffiziell, wie bei jedem
> Drittanbieter-Client. Das kann gegen die WhatsApp-AGB verstoßen, Sperren kann
> ich nicht ausschließen. Steht so auch auf der Seite.
>
> https://icq-retrogram.pages.dev/

---

## Vorbereitete Antworten

Diese Fragen kommen. Sie im Voraus zu haben ist der Unterschied zwischen einem
Post, der oben landet, und einem, der untergeht.

**„Wirst du dafür nicht gebannt / werde ich gebannt?"**
> Möglich, ja. Ich kann es nicht ausschließen und behaupte es auch nirgends. Es
> ist dieselbe Protokollebene, die alle Drittanbieter-Clients nutzen. Wer ein
> Konto hat, dessen Verlust weh täte, sollte es lassen — das steht so auch im FAQ
> auf der Seite.

**„Woher weiß ich, dass das nicht meine Nachrichten abgreift?"**
> Weil du es nachlesen kannst. Kompletter Quellcode unter MIT auf GitHub, kein
> Server von mir beteiligt, die Verbindung geht direkt von deinem Rechner zu
> WhatsApp und Telegram. Die Releases werden per GitHub Actions aus genau diesem
> Repo gebaut.

**„Warum nicht einfach WhatsApp Desktop?"**
> Weil WhatsApp Desktop nicht wie ICQ aussieht und Telegram nicht kann. Genau das
> ist der ganze Punkt. Wenn dir der Look egal ist, ist das hier nichts für dich.

**„Electron, also 200 MB für einen Chat."**
> Berechtigt. Es war vorher deutlich schlimmer — da lief ein kompletter Browser
> im Hintergrund, nur um WhatsApp zu sprechen. Der ist raus, das Protokoll läuft
> jetzt direkt über WebSocket, der Download hat sich ungefähr halbiert.

**„Windows warnt vor der Datei."**
> Nicht signiert, ein Zertifikat kostet Geld, das ein Hobbyprojekt nicht hat.
> „Weitere Informationen" → „Trotzdem ausführen". Wer das nicht will: Repo klonen
> und selbst bauen, der Build-Befehl steht im README.

**„Ist das offiziell / hat AOL zugestimmt?"**
> Nein, und das behaupte ich auch nirgends. Unabhängiges Projekt, keine Verbindung
> zu ICQ oder AOL, es wird kein ICQ-Netzwerk wiederbelebt. Nur die Oberfläche.

---

## Nach dem Post

- Antworte in den ersten zwei Stunden auf **jeden** Kommentar, auch die
  unfreundlichen. Ruhig und ohne Verteidigungshaltung.
- Nachtrag als Kommentar statt als Edit, wenn eine Frage mehrfach kommt.
- Auf keinen Fall selbst upvoten lassen oder Freunde bitten — Reddit erkennt
  Vote-Ringe zuverlässig und das kostet den Account.
- Am Tag danach in GitHub die Release-Download-Zahlen notieren. Das ist deine
  einzige verlässliche Erfolgsmessung, wenn Analytics nur die Website misst.

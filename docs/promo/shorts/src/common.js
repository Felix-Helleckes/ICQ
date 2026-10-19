/* Demo data (invented names, no real chats) and shared caption blocks for the scene files. */
(function () {
  var T = Math.floor(new Date("2026-10-13T19:04:00+02:00").getTime() / 1000); // the stage clock starts here
  function chat(id, name, last, ago, unread, isGroup) {
    return { id: id, name: name, lastMessage: last, timestamp: T - ago, unreadCount: unread || 0, isGroup: !!isGroup, archived: false, pinned: false, avatar: null };
  }
  function m(id, body, fromMe, ago, ack) {
    return { id: id, body: body, fromMe: !!fromMe, timestamp: T - ago, type: "chat", ack: fromMe ? (ack == null ? 3 : ack) : -1, hasMedia: false, mediaData: null };
  }
  window.DEMO = {
    T: T,
    // A pretend pairing string. Not a real session, just enough for the QR renderer.
    qr: "2@RETROGRAM-DEMO-PAIRING-STRING-NOT-A-REAL-SESSION,icq-retrogram.pages.dev,DEMO",
    wa: {
      chats: [
        chat("anna@demo", "Anna", "see you later!", 540),
        chat("mom@demo", "Mom", "Coming over on Sunday?", 2400),
        chat("lukas@demo", "Lukas", "hahaha insane", 5100),
        chat("sarah@demo", "Sarah", "📎 vacation.jpg", 9000),
        chat("jonas@demo", "Jonas", "see you at 8", 14000),
        chat("mia@demo", "Mia", "Did you get the tickets?", 30000),
        chat("tom@demo", "Tom", "ok 👍", 52000),
        chat("team@demo", "Team Retro 🦙", "Ben: build is out", 3600, 0, true),
        chat("family@demo", "Family", "Dad: 📷 Photo", 80000, 0, true)
      ],
      messages: {
        "anna@demo": [
          m("a1", "hey, you around tonight?", false, 700),
          m("a2", "yep, from 8", true, 650),
          m("a3", "see you later!", false, 540)
        ],
        "mom@demo": [
          m("b1", "Coming over on Sunday?", false, 2400)
        ],
        "lukas@demo": [
          m("c1", "look what I found in the attic", false, 5400),
          m("c2", "a Nokia 3310. still charges", true, 5300),
          m("c3", "hahaha insane", false, 5100)
        ],
        "sarah@demo": [
          m("d1", "📎 vacation.jpg", false, 9000)
        ],
        "jonas@demo": [
          m("e1", "pool tonight?", true, 14100),
          m("e2", "see you at 8", false, 14000)
        ],
        "mia@demo": [
          m("f1", "Did you get the tickets?", false, 30000)
        ],
        "tom@demo": [
          m("g1", "sending the file now", true, 52200),
          m("g2", "ok 👍", false, 52000)
        ]
      }
    },
    tg: {
      chats: [
        chat("tg-ben", "Ben", "ping me when you're back", 1200),
        chat("tg-lea", "Lea", "🎤 voice message", 4400),
        chat("tg-noah", "Noah", "🎉", 8800),
        chat("tg-emma", "Emma", "lunch tomorrow?", 20000),
        chat("tg-club", "Retro Club", "Lea: who still knows their number?", 2000, 0, true)
      ],
      messages: {
        "tg-ben": [
          m("t1", "deploy went through", true, 1300),
          m("t2", "ping me when you're back", false, 1200)
        ],
        "tg-lea": [
          m("t5", "found my old ICQ number", false, 4500),
          m("t6", "🎤 voice message", false, 4400)
        ],
        "tg-emma": [
          m("t3", "lunch tomorrow?", false, 20000)
        ],
        "tg-noah": [
          m("t7", "we actually won 🎉", false, 8800)
        ]
      }
    }
  };

  function deep(v) { return JSON.parse(JSON.stringify(v)); }

  // Pristine copy taken before any scene runs: the scene hands DEMO's own arrays to the
  // stage, and incoming messages mutate them, so resetting from DEMO itself would restore
  // the already-changed state.
  var PRISTINE = deep({ wa: window.DEMO.wa, tg: window.DEMO.tg });

  /* Put the demo state back the way it started so the last frame equals the first. */
  window.resetChats = function (S) {
    S.wa.chats = deep(PRISTINE.wa.chats);
    S.wa.messages = deep(PRISTINE.wa.messages);
    S.tg.chats = deep(PRISTINE.tg.chats);
    S.tg.messages = deep(PRISTINE.tg.messages);
    S.emitAll("wa:chats-updated");
    S.emitAll("tg:chats-updated");
  };

  /* Call to action: one line of benefit, the URL as a bright pill, platform/price, link hint.
     Every line sits clear of the safe zones (top 120 px, bottom 350 px, right 150 px). */
  window.CTA = {
    caps: function (t0, t1, topHtml) {
      return [
        { t0: t0, t1: t1, y: 1050, size: 84, html: topHtml || "Your WhatsApp.<br><em>ICQ style.</em>" },
        { t0: t0 + 0.35, t1: t1, y: 1250, size: 54, html: "<span class=\"pill\">icq-retrogram.pages.dev</span>" },
        { t0: t0 + 0.75, t1: t1, y: 1366, size: 52, cls: "soft", html: "Free &middot; Windows, macOS, Linux" },
        { t0: t0 + 1.15, t1: t1, y: 1462, size: 46, cls: "soft", html: "<em>Link in the description</em>" }
      ];
    },
    /* Camera keys that lift the app into the top third so the CTA block below stays readable. */
    cam: function (tIn, tOut, focus, scale) {
      return [
        { t: tIn, s: scale || 1.24, f: focus || "cl", sx: 540, sy: 620 },
        { t: tOut, s: scale || 1.24, f: focus || "cl", sx: 540, sy: 620 }
      ];
    }
  };
})();

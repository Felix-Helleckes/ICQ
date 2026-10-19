/* Day 1 — "You know this sound."
   The sound lands in the first frames, the contact list is on screen from frame 0, then
   every message opens its own floating window. */
(function () {
  var D = window.DEMO;
  var POS = {
    "anna@demo":  { x: 250, y: 120, w: 330, h: 330 },
    "lukas@demo": { x: 200, y: 330, w: 330, h: 330 }
  };
  window.SCENE = {
    name: "day1", dur: 19.0,
    audio: { music: true, prog: "A", bpm: 84, start: 2.2, music_db: -16.5, seed: 11 },
    skin: "retro-teal",
    wa: { status: "ready", chats: D.wa.chats, messages: D.wa.messages },
    tg: { status: "needs-auth", chats: D.tg.chats, messages: D.tg.messages },
    windows: [{ id: "cl", kind: "app", w: 280, h: 500, x: 0, y: 0, pop: false }],
    chatPos: function (p) { return POS[p.chatId] || { x: 220, y: 180, w: 340, h: 280 }; },

    actions: [
      { t: 0.16, msg: ["whatsapp", "anna@demo", "you around? 🙂"] },
      { t: 2.25, click: ["cl", ".contact-item", 0] },
      { t: 3.60, type: ["chat:anna@demo", ".msg-input", "hey! still have your ICQ number?"], cps: 17 },
      { t: 5.70, key: ["chat:anna@demo", ".msg-input", "Enter"] },
      { t: 5.95, ack: ["last", 1] }, { t: 6.25, ack: ["last", 2] }, { t: 6.60, ack: ["last", 3] },
      { t: 6.90, msg: ["whatsapp", "lukas@demo", "uh-oh. still the best sound 😄"] },
      { t: 7.80, click: ["cl", ".contact-item", 0] },
      { t: 12.40, close: "all-chats" },
      { t: 12.45, run: function (S) { window.resetChats(S); } }
    ],

    camera: [
      { t: 0.0,  s: 2.56, f: "cl", sx: 540, sy: 1040 },
      { t: 2.30, s: 2.56, f: "cl", sx: 540, sy: 1040 },
      { t: 3.10, s: 2.33, f: [415, 285], sx: 540, sy: 1000 },
      { t: 7.90, s: 2.33, f: [415, 285], sx: 540, sy: 1000 },
      { t: 8.90, s: 1.33, f: [290, 330], sx: 540, sy: 990 },
      { t: 12.50, s: 1.33, f: [290, 330], sx: 540, sy: 990 }
    ].concat(window.CTA.cam(13.30, 17.70), [
      { t: 18.60, s: 2.56, f: "cl", sx: 540, sy: 1040 }
    ]),

    caps: [
      { t0: 0.30, t1: 2.60, y: 265, size: 108, cls: "boxed", html: "<span>You know<br>this sound.</span>" },
      { t0: 3.20, t1: 5.80, y: 300, size: 94, html: "A chat window.<br><em>Like 2003.</em>" },
      { t0: 6.20, t1: 9.00, y: 300, size: 90, html: "Every contact<br>gets a window." },
      { t0: 9.40, t1: 12.20, y: 330, size: 92, html: "WhatsApp.<br><em>Telegram.</em> Both." }
    ].concat(window.CTA.caps(13.10, 17.60, "Your WhatsApp.<br><em>Like it's 2003.</em>"))
  };
})();

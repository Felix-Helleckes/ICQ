/* Day 2 — "Your WhatsApp. In 2003."
   QR login on screen from frame 0, the contact list fills with demo contacts, one chat
   opens. The last shot resets to the QR screen so the clip loops. */
(function () {
  var D = window.DEMO;
  window.SCENE = {
    name: "day2", dur: 20.0,
    audio: { music: true, prog: "C", bpm: 84, start: 0.0, music_db: -16.0, seed: 22 },
    skin: "retro-teal",
    wa: { status: "qr", qr: D.qr, chats: [], messages: {} },
    tg: { status: "needs-auth", chats: [], messages: {} },
    windows: [{ id: "cl", kind: "app", w: 280, h: 500, x: 0, y: 0, pop: false }],
    chatPos: function () { return { x: 250, y: 150, w: 330, h: 330 }; },

    actions: [
      // Pairing goes through: the list fills with the demo contacts.
      { t: 4.30, run: function (S) { S.wa.chats = JSON.parse(JSON.stringify(window.DEMO.wa.chats)); S.wa.messages = JSON.parse(JSON.stringify(window.DEMO.wa.messages)); } },
      { t: 4.35, wa: "ready" },
      { t: 8.60, msg: ["whatsapp", "anna@demo", "you're back on ICQ?! 😄"] },
      { t: 9.80, click: ["cl", ".contact-item", 0] },
      { t: 11.40, type: ["chat:anna@demo", ".msg-input", "same contacts, 2003 window"], cps: 17 },
      { t: 13.10, key: ["chat:anna@demo", ".msg-input", "Enter"] },
      { t: 13.35, ack: ["last", 2] }, { t: 13.80, ack: ["last", 3] },
      // Back to the login screen for the loop.
      { t: 18.90, close: "all-chats" },
      { t: 18.95, run: function (S) { S.wa.chats = []; S.wa.messages = {}; } },
      { t: 19.00, wa: "qr", qr: D.qr }
    ],

    camera: [
      { t: 0.0,  s: 2.56, f: "cl", sx: 540, sy: 1040 },
      { t: 8.00, s: 2.56, f: "cl", sx: 540, sy: 1040 },
      { t: 9.00, s: 2.33, f: [415, 315], sx: 540, sy: 1000 },
      { t: 14.30, s: 2.33, f: [415, 315], sx: 540, sy: 1000 }
    ].concat(window.CTA.cam(15.20, 18.60), [
      { t: 19.40, s: 2.56, f: "cl", sx: 540, sy: 1040 }
    ]),

    caps: [
      { t0: 0.30, t1: 2.60, y: 265, size: 92, cls: "boxed", html: "<span>Your WhatsApp.<br>In 2003.</span>" },
      { t0: 3.00, t1: 5.60, y: 265, size: 84, cls: "boxed", html: "<span>Scan once.<br><em>That's the setup.</em></span>" },
      { t0: 6.10, t1: 8.40, y: 265, size: 88, cls: "boxed", html: "<span>Your real chats.<br>Not a mockup.</span>" },
      { t0: 10.40, t1: 14.10, y: 300, size: 90, html: "Same messages.<br><em>Older window.</em>" }
    ].concat(window.CTA.caps(15.00, 18.50, "Log in once.<br><em>Chat like 2003.</em>"))
  };
})();

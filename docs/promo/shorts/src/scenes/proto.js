/* Prototype scene for pipeline checks: list ready, message arrives, click opens a chat window, type and send. */
(function () {
  var D = window.DEMO;
  window.SCENE = {
    name: "proto", dur: 6.0,
    audio: { music: false },
    skin: "retro-teal",
    wa: { status: "ready", chats: D.wa.chats, messages: D.wa.messages },
    tg: { status: "needs-auth", chats: D.tg.chats, messages: D.tg.messages },
    windows: [ { id: "cl", kind: "app", w: 270, h: 580, x: 60, y: 80 } ],
    chatPos: function () { return { x: 300, y: 200 }; },
    actions: [
      { t: 1.0, msg: ["whatsapp", "anna@demo", "So — who is online? 😎"] },
      { t: 2.0, click: ["cl", ".contact-item", 0] },
      { t: 3.2, type: ["chat:anna@demo", ".msg-input", "Me. Feels like 2003 🌼"], cps: 20 },
      { t: 4.6, key: ["chat:anna@demo", ".msg-input", "Enter"] },
      { t: 4.9, ack: ["last", 1] }, { t: 5.3, ack: ["last", 2] }, { t: 5.7, ack: ["last", 3] }
    ],
    camera: [
      { t: 0, s: 2.6, f: "cl", o: [0.5, 0.45] },
      { t: 1.8, s: 2.6, f: "cl", o: [0.5, 0.45] },
      { t: 2.6, s: 1.5, f: [440, 420] }
    ],
    caps: [
      { t0: 0.3, t1: 1.9, y: 230, size: 118, cls: "boxed", html: "<span>You know<br>this sound.</span>" },
      { t0: 2.8, t1: 5.9, y: 210, size: 100, html: "One chat.<br><em>One window.</em>" }
    ]
  };
})();

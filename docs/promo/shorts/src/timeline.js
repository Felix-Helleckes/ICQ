/* Boots window.SCENE on the stage: initial demo state, windows, actions, camera, cursor,
   captions. window.__step(frame) advances everything deterministically. */
(function () {
  "use strict";
  var E = window.__engine, S = E.S, WM = E.WM, FPS = E.FPS;
  var SC = window.SCENE;
  if (!SC) throw new Error("window.SCENE missing");

  // Initial state -------------------------------------------------------------
  if (SC.skin) S.initialSkin = SC.skin;
  ["wa", "tg"].forEach(function (k) {
    if (!SC[k]) return;
    Object.keys(SC[k]).forEach(function (key) {
      S[k][key] = SC[k][key];
    });
  });
  (SC.windows || []).forEach(function (d) {
    var o = Object.assign({ kind: "app", pop: false }, d);
    if (o.kind === "app" && !o.url) o.url = S.APP_URL + (o.query ? "?" + o.query : "");
    if (o.kind === "site" && !o.url) o.url = S.SITE_URL;
    WM.create(o);
  });

  // Actions ------------------------------------------------------------------
  var fires = [], clicks = [];
  function fire(t, fn, kind) { fires.push({ t: t, run: fn, kind: kind || "action" }); }
  (SC.actions || []).forEach(function (a) {
    if (a.msg) {            // {t, msg:[service, chatId, body], opts}
      fire(a.t, function () { S.incoming(a.msg[0], a.msg[1], a.msg[2], a.opts); });
    } else if (a.ack) {     // {t, ack:[id|'last', n]}
      fire(a.t, function () { var id = a.ack[0] === "last" ? (S.lastSent && S.lastSent.id) : a.ack[0]; if (id) S.ack(id, a.ack[1]); });
    } else if (a.typing) {  // {t, typing:[chatId, bool]}
      fire(a.t, function () { S.typing(a.typing[0], a.typing[1]); });
    } else if (a.wa) {      // {t, wa:'ready'|'qr'|..., qr}
      fire(a.t, function () { S.setWa(a.wa, a.qr); });
    } else if (a.tg) {
      fire(a.t, function () { S.setTg(a.tg, a.qr); });
    } else if (a.click) {   // {t, click:[winId, selector, index], o:[ox,oy]}
      var target = S.targetOf(a.click[0], a.click[1], a.click[2], a.o);
      clicks.push({ t: a.t, target: target });
      fire(a.t, function () { var el = WM.el(a.click[0], a.click[1], a.click[2]); if (!el) console.error("click target missing", a.click); S.click(el); });
    } else if (a.type) {    // {t, type:[winId, selector, text], cps}
      var cps = a.cps || 14, text = a.type[2];
      for (var i = 1; i <= text.length; i++) {
        (function (i) {
          fire(a.t + (i - 1) / cps, function () {
            var el = WM.el(a.type[0], a.type[1]); if (!el) return;
            S.setValue(el, text.slice(0, i));
            S.log("key");
          }, "key");
        })(i);
      }
    } else if (a.key) {     // {t, key:[winId, selector, 'Enter']}
      fire(a.t, function () { var el = WM.el(a.key[0], a.key[1]); if (el) { S.key(el, a.key[2]); S.log("enter"); } });
    } else if (a.read) {    // {t, read:'whatsapp'}
      fire(a.t, function () { S.markAllRead(a.read); });
    } else if (a.close) {   // {t, close:'chat:id'|'all-chats'}
      fire(a.t, function () {
        if (a.close === "all-chats") WM.list.slice().forEach(function (w) { if (w.id.indexOf("chat:") === 0 || w.id === "game") WM.remove(w); });
        else WM.remove(WM.byId[a.close]);
      });
    } else if (a.move) {    // {t, move:[winId, x, y]} (instant)
      fire(a.t, function () { var w = WM.byId[a.move[0]]; if (w) { w.x = a.move[1]; w.y = a.move[2]; } });
    } else if (a.run) {
      fire(a.t, function () { a.run(S, WM); });
    }
  });
  fires.sort(function (x, y) { return x.t - y.t; });

  // Camera / captions ----------------------------------------------------------
  var camKeys = (SC.camera || [{ t: 0, s: 1, f: "cl" }]).slice().sort(function (a, b) { return a.t - b.t; });
  var CAPS = SC.caps || [];
  E.buildCaps(CAPS);

  window.__meta = { name: SC.name, dur: SC.dur, audio: SC.audio || {} };
  window.__events = S.events;

  var lastT = -1;
  window.__step = function (frame) {
    var t = frame / FPS;
    S.t = t;
    for (var i = 0; i < fires.length; i++) {
      var e = fires[i];
      if (e.t > lastT && e.t <= t) { try { e.run(); } catch (err) { console.error("action failed", e.t, err); } }
    }
    lastT = t;
    E.camera(t, camKeys);
    E.layout(t);
    E.cursorAt(t, clicks);
    E.captionsAt(t, CAPS);
    E.animationsAt(t);
  };
  window.__step.relayout = function (frame) { var t = frame / FPS; E.layout(t); E.cursorAt(t, clicks); E.animationsAt(t); };
  // true while an iframe is still loading or a QR code is still being generated
  window.__busy = function () {
    if (WM.pending > 0) return true;
    for (var i = 0; i < WM.list.length; i++) {
      var w = WM.list[i]; if (!w.iframe) continue;
      var d = w.iframe.contentDocument;
      if (!d || !d.body) return true;
      if (d.querySelector(".qr-loading")) return true;
      if (d.getElementById("root") && !d.getElementById("root").firstChild) return true;
    }
    return false;
  };
  // run frame 0 layout immediately so the first screenshot is composed
  E.camera(0, camKeys); E.layout(0);
})();

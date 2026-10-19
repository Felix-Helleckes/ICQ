/* Stage engine: demo state for the app frames (window.__ICQ), window manager, camera,
   cursor and captions. Loaded before the scene file; timeline.js boots the scene. */
(function () {
  "use strict";
  var FPS = 30;
  var APP_URL = new URL("../../../../build/index.html", location.href).href;
  var SITE_URL = new URL("../../../../site/index.html", location.href).href;
  var world = document.getElementById("world");

  // ------------------------------------------------------------ Demo state shared with the app frames
  var seq = 1000;
  var S = window.__ICQ = {
    t: 0, frames: [], events: [], initialSkin: "retro-teal",
    APP_URL: APP_URL, SITE_URL: SITE_URL,
    wa: { status: "disconnected", qr: null, chats: [], messages: {}, profile: { name: "Felix", avatar: null } },
    tg: { status: "disconnected", qr: null, chats: [], messages: {}, profile: { name: "Felix", avatar: null } },
  };
  function svc(service) { return service === "telegram" ? S.tg : S.wa; }
  function nowSec() { return Math.floor(Date.now() / 1000); }
  function findChat(service, id) { return svc(service).chats.find(function (c) { return c.id === id; }); }

  S.registerFrame = function (win, name) {
    if (S.frames.some(function (f) { return f.win === win; })) return;   // boot() can fire from several hooks
    S.frames.push({ win: win, name: name });
  };
  S.unregisterFrame = function (win) { S.frames = S.frames.filter(function (f) { return f.win !== win; }); };
  S.emitAll = S.broadcast = function (ev, data) {
    S.frames.forEach(function (f) { try { if (f.win.__emit) f.win.__emit(ev, data); } catch (e) {} });
  };
  S.log = function (kind, extra) { S.events.push(Object.assign({ t: S.t, kind: kind }, extra || {})); };
  S.logSound = function (src) {
    S.log(/icq-message/.test(src) ? "uhoh" : /Startup/i.test(src) ? "startup" : "sound");
  };
  // Incoming message as the bridge would deliver it.
  S.incoming = function (service, chatId, body, opts) {
    opts = opts || {};
    var chat = findChat(service, chatId);
    var msg = { id: "m" + (seq++), body: body, fromMe: false, timestamp: opts.timestamp || nowSec(), type: "chat",
                ack: -1, hasMedia: false, mediaData: null, isBacklog: false };
    if (service === "whatsapp") { msg.from = chatId; msg.to = "me"; msg.author = chatId; }
    else { msg.chatId = chatId; msg.from = chatId; }
    if (opts.sender) { msg.author = opts.sender; msg.senderName = opts.sender; }
    (svc(service).messages[chatId] = svc(service).messages[chatId] || []).push(msg);
    if (chat) { chat.lastMessage = body; chat.timestamp = msg.timestamp; chat.unreadCount = (chat.unreadCount || 0) + 1; }
    S.emitAll(service === "whatsapp" ? "wa:message" : "tg:message", msg);
    return msg;
  };
  // Outgoing message (called by the app's sendMessage through the shim).
  S.send = function (service, chatId, text) {
    var chat = findChat(service, chatId);
    var msg = { id: "m" + (seq++), body: text, fromMe: true, timestamp: nowSec(), type: "chat", ack: 0, hasMedia: false, mediaData: null };
    if (service === "whatsapp") { msg.from = "me"; msg.to = chatId; }
    else { msg.chatId = chatId; }
    (svc(service).messages[chatId] = svc(service).messages[chatId] || []).push(msg);
    if (chat) { chat.lastMessage = text; chat.timestamp = msg.timestamp; chat.unreadCount = 0; }
    S.emitAll(service === "whatsapp" ? "wa:message" : "tg:message", msg);
    S.log("send");
    S.lastSent = msg;
    return { id: msg.id, body: text, timestamp: msg.timestamp };
  };
  S.ack = function (id, ack) {
    Object.keys(S.wa.messages).forEach(function (k) {
      S.wa.messages[k].forEach(function (m) { if (m.id === id) m.ack = ack; });
    });
    S.emitAll("wa:ack", { id: id, ack: ack });
  };
  S.typing = function (chatId, typing) { S.emitAll("wa:typing", { chatId: chatId, aliases: [], typing: !!typing }); };
  S.setWa = function (status, qr) {
    S.wa.status = status;
    if (qr !== undefined) { S.wa.qr = qr; if (qr) S.emitAll("wa:qr", qr); }
    if (status === "ready") S.emitAll("wa:ready", { name: S.wa.profile.name });
  };
  S.setTg = function (status, qr) {
    S.tg.status = status;
    if (qr !== undefined) { S.tg.qr = qr; if (qr) S.emitAll("tg:qr", qr); }
    if (status === "ready") S.emitAll("tg:ready", { name: S.tg.profile.name });
  };
  S.tgQRLogin = function () { /* the scene drives tg status itself */ };
  S.setSkin = function (id, fromWin) {
    S.initialSkin = id;
    S.frames.forEach(function (f) { if (f.win !== fromWin) { try { f.win.__emit("skin:changed", id); } catch (e) {} } });
    S.log("skin");
  };
  S.markAllRead = function (service) {
    svc(service).chats.forEach(function (c) {
      if (c.unreadCount) { c.unreadCount = 0; S.emitAll(service === "whatsapp" ? "wa:chat-update" : "tg:chat-update", { id: c.id, unreadCount: 0 }); }
    });
  };

  // ------------------------------------------------------------ Window manager
  var WM = window.WM = { list: [], byId: {}, pending: 0, cascade: 0 };
  WM.create = function (o) {
    var el = document.createElement("div");
    el.className = "win " + (o.kind || "app");
    el.style.width = o.w + "px"; el.style.height = o.h + "px";
    var iframe = null, bodyH = o.h;
    if (o.kind === "game") {
      var chrome = document.createElement("div");
      chrome.className = "chrome";
      chrome.innerHTML = '<img src="' + new URL("../../../../public/icon.png", location.href).href + '" alt=""><span class="ttl">' +
        (o.title || "") + '</span><div class="btns"><span>&#x2500;</span><span>&#x25A1;</span><span>&#x2715;</span></div>';
      el.appendChild(chrome);
      bodyH = o.h - 32;
      var body = document.createElement("div");
      body.className = "body"; body.style.width = o.w + "px"; body.style.height = bodyH + "px";
      if (o.image) { var img = document.createElement("img"); img.src = o.image; body.appendChild(img); }
      el.appendChild(body);
    }
    if (o.url) {
      iframe = document.createElement("iframe");
      iframe.name = o.id; iframe.width = o.w; iframe.height = bodyH;
      iframe.style.width = o.w + "px"; iframe.style.height = bodyH + "px";
      WM.pending++;
      iframe.addEventListener("load", function () {
        WM.pending--;
        // Second chance for the shim to register this frame (see the note in shim.js).
        try { iframe.contentWindow.__register && iframe.contentWindow.__register(); } catch (e) {}
      });
      iframe.src = o.url;
      el.appendChild(iframe);
    }
    var win = { id: o.id, kind: o.kind || "app", el: el, iframe: iframe, x: o.x, y: o.y, w: o.w, h: o.h,
                born: o.pop === false ? -10 : S.t, opacity: 1, scale: 1, meta: o };
    WM.list.push(win); WM.byId[o.id] = win; world.appendChild(el);
    return win;
  };
  WM.raise = function (win) { world.appendChild(win.el); };
  WM.remove = function (win) {
    if (!win) return;
    try { if (win.iframe) S.unregisterFrame(win.iframe.contentWindow); } catch (e) {}
    WM.list = WM.list.filter(function (w) { return w !== win; });
    delete WM.byId[win.id];
    if (win.el.parentNode) win.el.parentNode.removeChild(win.el);
  };
  WM.closeByWin = function (cw) {
    var win = WM.list.find(function (w) { return w.iframe && w.iframe.contentWindow === cw; });
    WM.remove(win);
  };
  WM.doc = function (id) { var w = WM.byId[id]; return w && w.iframe ? w.iframe.contentDocument : null; };
  WM.el = function (id, sel, index) {
    var d = WM.doc(id); if (!d) return null;
    var list = d.querySelectorAll(sel);
    return list[index || 0] || null;
  };
  WM.openChat = function (p) {
    var id = "chat:" + p.chatId;
    if (WM.byId[id]) { WM.raise(WM.byId[id]); return; }
    var w = p.isGroup ? 1000 : 520, h = 440;
    var pos = (window.SCENE && window.SCENE.chatPos) ? window.SCENE.chatPos(p, WM) : { x: 330 + WM.cascade * 30, y: 140 + WM.cascade * 30 };
    WM.cascade++;
    var q = new URLSearchParams({ mode: "chat", chatId: p.chatId, chatName: p.chatName || "", service: p.service, isGroup: p.isGroup ? "1" : "0" });
    WM.create({ id: id, kind: "app", url: APP_URL + "?" + q.toString(), w: pos.w || w, h: pos.h || h, x: pos.x, y: pos.y });
    S.log("pop");
  };
  WM.openGame = function (url, title) {
    var id = "game";
    if (WM.byId[id]) { WM.raise(WM.byId[id]); return; }
    var g = (window.SCENE && window.SCENE.gameWindow) || {};
    WM.create({ id: id, kind: "game", title: title || "ICQ Spiele", url: g.url || null, image: g.image || null,
                w: g.w || 1100, h: g.h || 780, x: g.x || 120, y: g.y || 60 });
    S.log("pop");
  };

  S.openChat = function (p) { WM.openChat(p); };
  S.openGame = function (url, title) { WM.openGame(url, title); };
  S.closeWindow = function (cw) { WM.closeByWin(cw); };

  // ------------------------------------------------------------ DOM interaction helpers (real events into the React app)
  function mouse(el, type) {
    var r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: el.ownerDocument.defaultView,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 }));
  }
  S.click = function (el) { if (!el) return false; mouse(el, "mousedown"); mouse(el, "mouseup"); mouse(el, "click"); S.log("click"); return true; };
  S.setValue = function (el, value) {
    var proto = el.tagName === "TEXTAREA" ? el.ownerDocument.defaultView.HTMLTextAreaElement.prototype : el.ownerDocument.defaultView.HTMLInputElement.prototype;
    var setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };
  S.key = function (el, key) {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: key, bubbles: true, cancelable: true }));
  };

  // ------------------------------------------------------------ Camera
  var CAM = { s: 1, fx: 0, fy: 0, sx: 540, sy: 960 };
  function ease(x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
  function lerp(a, b, u) { return a + (b - a) * u; }
  function resolveFocus(k) {
    if (Array.isArray(k.f)) return { x: k.f[0], y: k.f[1] };
    var w = WM.byId[k.f] || (window.SCENE.windows || []).find(function (d) { return d.id === k.f; });
    if (!w) return { x: 540, y: 960 };
    var o = k.o || [0.5, 0.5];
    return { x: w.x + w.w * o[0] + (k.dx || 0), y: w.y + w.h * o[1] + (k.dy || 0) };
  }
  function camera(t, keys) {
    var a = keys[0], b = keys[0];
    if (t >= keys[keys.length - 1].t) { a = b = keys[keys.length - 1]; }
    else {
      for (var i = 0; i < keys.length - 1; i++) {
        if (t >= keys[i].t && t <= keys[i + 1].t) { a = keys[i]; b = keys[i + 1]; break; }
      }
    }
    var u = b.t === a.t ? 1 : ease(Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))));
    var fa = resolveFocus(a), fb = resolveFocus(b);
    CAM.s = lerp(a.s, b.s, u);
    CAM.fx = lerp(fa.x, fb.x, u); CAM.fy = lerp(fa.y, fb.y, u);
    CAM.sx = lerp(a.sx == null ? 540 : a.sx, b.sx == null ? 540 : b.sx, u);
    CAM.sy = lerp(a.sy == null ? 960 : a.sy, b.sy == null ? 960 : b.sy, u);
  }
  function toScreen(wx, wy) { return { x: CAM.sx + (wx - CAM.fx) * CAM.s, y: CAM.sy + (wy - CAM.fy) * CAM.s }; }
  function backOut(x) { var c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); }
  function layout(t) {
    WM.list.forEach(function (w) {
      var age = t - w.born, k = 1, op = 1;
      if (age >= 0 && age < 0.3) { var u = age / 0.3; k = 0.9 + 0.1 * backOut(u); op = Math.min(1, u * 2.2); }
      var s = CAM.s * k * w.scale;
      var cx = w.x + w.w / 2, cy = w.y + w.h / 2;
      var p = toScreen(cx, cy);
      var left = p.x - w.w * s / 2, top = p.y - w.h * s / 2;
      w.el.style.transform = "translate(" + left.toFixed(2) + "px," + top.toFixed(2) + "px) scale(" + s.toFixed(4) + ")";
      w.el.style.opacity = (op * w.opacity).toFixed(3);
    });
  }

  // ------------------------------------------------------------ Cursor
  var cursorEl = document.getElementById("cursor");
  var cur = { x: 900, y: 1500, has: false };  // world coords
  var MOVE = 0.45;
  function cursorAt(t, clicks) {
    // clicks: [{t, target(): {x,y} world, resolved}]
    var next = null, prev = null;
    for (var i = 0; i < clicks.length; i++) {
      var c = clicks[i];
      if (c.t >= t - 0.001 && (!next || c.t < next.t)) next = c;
      if (c.t < t && (!prev || c.t > prev.t)) prev = c;
    }
    var pos = null, op = 0, press = 1;
    if (prev && prev.pos) { pos = prev.pos; op = Math.max(0, 1 - Math.max(0, t - prev.t - 0.9) / 0.5); }
    if (next && t >= next.t - MOVE) {
      if (!next.pos) { var p = next.target(); if (p) next.pos = p; }
      if (next.pos) {
        var from = prev && prev.pos ? prev.pos : { x: next.pos.x + 140, y: next.pos.y + 220 };
        var u = ease(Math.min(1, (t - (next.t - MOVE)) / MOVE));
        pos = { x: lerp(from.x, next.pos.x, u), y: lerp(from.y, next.pos.y, u) };
        op = prev && prev.pos ? 1 : Math.min(1, u * 3);
      }
    }
    if (next && !next.pos && (!prev || !prev.pos)) op = 0;
    if (prev && t < prev.t + 0.14) { var d = Math.abs(t - prev.t - 0.05); press = 0.82 + 0.18 * Math.min(1, d / 0.09); }
    if (!pos) { cursorEl.style.opacity = 0; return; }
    var sp = toScreen(pos.x, pos.y);
    cursorEl.style.opacity = op.toFixed(3);
    cursorEl.style.transform = "translate(" + (sp.x - 6).toFixed(1) + "px," + (sp.y - 4).toFixed(1) + "px) scale(" + press.toFixed(3) + ")";
  }
  // world position of an element inside an app window
  S.targetOf = function (winId, sel, index, offset) {
    return function () {
      var w = WM.byId[winId]; var el = WM.el(winId, sel, index);
      if (!w || !el) return null;
      var r = el.getBoundingClientRect();
      var top = w.kind === "game" ? 32 : 0;
      return { x: w.x + r.left + r.width * (offset ? offset[0] : 0.5), y: w.y + top + r.top + r.height * (offset ? offset[1] : 0.5) };
    };
  };

  // ------------------------------------------------------------ Captions
  var capsRoot = document.getElementById("caps");
  var IN = 0.22, OUT = 0.14;
  function buildCaps(CAPS) {
    CAPS.forEach(function (c) {
      var el = document.createElement("div");
      el.className = "cap" + (c.cls ? " " + c.cls : "");
      el.innerHTML = c.html;
      el.style.fontSize = c.size + "px";
      el.style.top = c.y + "px";
      capsRoot.appendChild(el);
      c.el = el;
    });
  }
  function captionsAt(t, CAPS) {
    CAPS.forEach(function (c) {
      var el = c.el, op = 0, k = 1, dy = 0;
      if (t >= c.t0 && t <= c.t1 + OUT) {
        if (t < c.t0 + IN) { var u = (t - c.t0) / IN; op = Math.min(1, u * 1.6); k = 0.84 + 0.16 * backOut(u); dy = (1 - u) * 18; }
        else if (t > c.t1) { var v = (t - c.t1) / OUT; op = 1 - v; k = 1 + 0.05 * v; dy = -v * 12; }
        else { op = 1; }
      }
      el.style.opacity = op.toFixed(3);
      el.style.transform = "translateY(-50%) translateY(" + dy.toFixed(1) + "px) scale(" + k.toFixed(4) + ")";
    });
  }

  // ------------------------------------------------------------ CSS animations inside app frames, positioned per frame
  function animationsAt(t) {
    WM.list.forEach(function (w) {
      if (!w.iframe) return;
      var d = w.iframe.contentDocument; if (!d) return;
      d.querySelectorAll(".wa-spinner").forEach(function (el) { el.style.animationDelay = (-(t % 0.9)).toFixed(3) + "s"; });
      d.querySelectorAll(".no-contacts.loading").forEach(function (el) { el.style.animationDelay = (-(t % 1.2)).toFixed(3) + "s"; });
    });
  }

  window.__engine = { FPS: FPS, S: S, WM: WM, CAM: CAM, camera: camera, layout: layout, cursorAt: cursorAt,
    buildCaps: buildCaps, captionsAt: captionsAt, animationsAt: animationsAt, toScreen: toScreen, ease: ease, lerp: lerp };
})();

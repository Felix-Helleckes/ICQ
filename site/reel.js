/* ──────────────────────────────────────────────────────────
   ICQ Retrogram — shared reel engine (EN/DE).
   Builds the animated ICQ scene into every .icq-reel mount,
   scales it to fit, loops it, and plays the classic "uh-oh"
   sound in sync with each incoming message.

   Language: window.__ICQ_LANG, ?lang=, <html lang>, else 'en'.
   Call window.ICQReel.setLang('de'|'en') to switch live.
   ────────────────────────────────────────────────────────── */
(function () {
  var TEXT = {
    en: {
      clTitle: 'ICQ — Retrogram', user: 'Felix', online: '● Online',
      search: '🔍 Search contacts…', skin: '🎨 Skin',
      waTitle: 'WhatsApp — Anna', typing: 'typing…', input: 'Type a message…', send: 'Send',
      contacts: [
        ['A', 'Anna', 'So — who is online? 😎', '1'],
        ['M', 'Mom', 'Coming over on Sunday?', ''],
        ['T', 'Team Retro 🦙', 'Ben: build is out', ''],
        ['L', 'Lukas', 'hahaha insane', ''],
        ['S', 'Sarah', '📎 vacation.jpg', '']
      ],
      m1: 'So — who is online? 😎', m2: 'Me. Feels like 2003 🌼', m3: 'WAIT — is that ICQ?! 😂',
      cap1: ['Your WhatsApp. Like it’s 2003.', 'uh-oh! 🌼'],
      cap2: ['WhatsApp + Telegram — in one window.', 'Separate chat windows. True ICQ style.'],
      cap3: ['Skins: ICQ · MSN · Telegram.', 'One click. Fully re-skinned.'],
      skins: ['ICQ Retro Dark', 'ICQ Retro Light', 'MSN Messenger'],
      endH1: 'ICQ · Retrogram', endH2: 'WhatsApp & Telegram — ICQ style', endDl: '▼ Download free',
      sndOn: 'Sound on', sndOff: 'Sound off'
    },
    de: {
      clTitle: 'ICQ — Retrogram', user: 'Felix', online: '● Online',
      search: '🔍 Kontakte suchen…', skin: '🎨 Skin',
      waTitle: 'WhatsApp — Anna', typing: 'tippt…', input: 'Nachricht eingeben…', send: 'Send',
      contacts: [
        ['A', 'Anna', 'Na, wer ist online? 😎', '1'],
        ['M', 'Mama', 'Kommst du Sonntag?', ''],
        ['T', 'Team Retro 🦙', 'Ben: push ist raus', ''],
        ['L', 'Lukas', 'hahaha krass', ''],
        ['S', 'Sarah', '📎 urlaub.jpg', '']
      ],
      m1: 'Na, wer ist online? 😎', m2: 'Ich. Fühlt sich an wie 2003 🌼', m3: 'WARTE — ist das ICQ?! 😂',
      cap1: ['Dein WhatsApp. Als wäre es 2003.', 'uh-oh! 🌼'],
      cap2: ['WhatsApp + Telegram — in einem Fenster.', 'Eigene Chat-Fenster. Echter ICQ-Style.'],
      cap3: ['Skins: ICQ · MSN · Telegram.', 'Ein Klick. Komplett umgefärbt.'],
      skins: ['ICQ Retro Dark', 'ICQ Retro Light', 'MSN Messenger'],
      endH1: 'ICQ · Retrogram', endH2: 'WhatsApp & Telegram — im ICQ-Look', endDl: '▼ Kostenlos laden',
      sndOn: 'Ton an', sndOff: 'Ton aus'
    }
  };
  var COLORS = [['#b5651d', '#7a3d0d'], ['#3a6', '#163'], ['#759', '#427'], ['#b47', '#824'], ['#36c', '#249']];
  var SWATCH = ['#0D6B6B', '#5CA52E', '#2E86DE'];

  function param(name) {
    try { return new URLSearchParams(window.location.search).get(name); } catch (e) { return null; }
  }
  function pickLang(l) { return /^de/i.test(l || '') ? 'de' : 'en'; }

  var LANG = pickLang(window.__ICQ_LANG || param('lang') || document.documentElement.getAttribute('lang') || 'en');

  function ci(i, t) {
    var c = t.contacts[i], col = COLORS[i];
    return '<div class="ci" data-i="' + i + '">' +
      '<div class="av" style="background:linear-gradient(135deg,' + col[0] + ',' + col[1] + ')">' + c[0] +
      '<span class="flw"></span></div>' +
      '<div class="meta"><div class="nm">' + c[1] + '</div><div class="lm">' + c[2] + '</div></div>' +
      (c[3] ? '<div class="badge">' + c[3] + '</div>' : '') + '</div>';
  }

  function buildHTML(t) {
    return '' +
      '<div class="sndbtn" data-snd>🔇 <span data-snd-label>' + t.sndOn + '</span></div>' +
      '<div class="win" id="cl">' +
        '<div class="titlebar"><span class="flower">✿</span> ' + t.clTitle +
          '<span class="dotset"><i class="tb"></i><i class="tb"></i><i class="tb"></i></span></div>' +
        '<div class="userbar"><div class="ava">✿</div>' +
          '<div><div class="uname">' + t.user + '</div><div class="ustat">' + t.online + '</div></div>' +
          '<div class="tools"><div class="tbtn">🔔</div><div class="tbtn">🎨</div>' +
            '<div class="skinpop" id="skinpop"><div class="h">' + t.skin + '</div>' +
              '<div class="it"><span class="sw" style="background:' + SWATCH[0] + '"></span> ' + t.skins[0] + '</div>' +
              '<div class="it sel" id="sk2"><span class="sw" style="background:' + SWATCH[1] + '"></span> ' + t.skins[1] + '</div>' +
              '<div class="it"><span class="sw" style="background:' + SWATCH[2] + '"></span> ' + t.skins[2] + '</div>' +
            '</div></div></div>' +
        '<div class="tabs"><div class="tab active"><span class="svc" style="background:#25D366"></span> WhatsApp</div>' +
          '<div class="tab"><span class="svc" style="background:#29A9EB"></span> Telegram</div></div>' +
        '<div class="search">' + t.search + '</div>' +
        '<div class="list">' + ci(0, t) + ci(1, t) + ci(2, t) + ci(3, t) + ci(4, t) + '</div></div>' +
      '<div class="win" id="cw">' +
        '<div class="titlebar"><span class="flower">✿</span> ' + t.waTitle +
          '<span class="dotset"><i class="tb"></i><i class="tb"></i><i class="tb"></i></span></div>' +
        '<div class="chead"><div class="av">A</div><div>' +
          '<div style="font-weight:bold">Anna</div><div style="opacity:.85;font-size:11px" id="typing">' + t.typing + '</div></div></div>' +
        '<div class="msgs">' +
          '<div class="row them"><div class="bub" id="m1">' + t.m1 + '<div class="t">21:14</div></div></div>' +
          '<div class="row me"><div class="bub" id="m2">' + t.m2 + '<div class="t">21:14 ✓✓</div></div></div>' +
          '<div class="row them"><div class="bub" id="m3">' + t.m3 + '<div class="t">21:15</div></div></div>' +
        '</div>' +
        '<div class="composer"><div class="inp">' + t.input + '</div><div class="send">' + t.send + '</div></div></div>' +
      '<div class="cap" id="cap1">' + t.cap1[0] + '<small>' + t.cap1[1] + '</small></div>' +
      '<div class="cap" id="cap2">' + t.cap2[0] + '<small>' + t.cap2[1] + '</small></div>' +
      '<div class="cap" id="cap3">' + t.cap3[0] + '<small>' + t.cap3[1] + '</small></div>' +
      '<div id="end"><div class="logo">✿</div><div class="h1">' + t.endH1 + '</div>' +
        '<div class="h2">' + t.endH2 + '</div><div class="dl">' + t.endDl + '</div></div>';
  }

  function initReel(mount) {
    var t = TEXT[LANG];
    var soundSrc = mount.getAttribute('data-sound') || 'icq-message.mp3';
    var forced = mount.getAttribute('data-format') || param('format') || 'auto';

    var stage = document.createElement('div');
    stage.className = 'stage';
    stage.innerHTML = buildHTML(t);
    mount.innerHTML = '';
    mount.appendChild(stage);

    var $ = function (id) { return stage.querySelector('#' + id); };
    var alive = true;
    var timers = [];

    function resolveFormat() {
      if (forced === 'portrait' || forced === 'landscape') return forced;
      return mount.clientWidth >= mount.clientHeight ? 'landscape' : 'portrait';
    }
    function fit() {
      if (!alive) return;
      stage.setAttribute('data-format', resolveFormat());
      var sw = stage.offsetWidth, sh = stage.offsetHeight;
      var k = Math.min(mount.clientWidth / sw, mount.clientHeight / sh);
      stage.style.transform = 'translate(-50%,-50%) scale(' + (k || 0.01) + ')';
    }

    /* ── Sound ── */
    var soundOn = false;
    var snd = new Audio(soundSrc);
    snd.preload = 'auto';
    function uhoh() { if (soundOn) { try { snd.currentTime = 0; snd.play().catch(function () {}); } catch (e) {} } }
    var btn = stage.querySelector('[data-snd]');
    var label = stage.querySelector('[data-snd-label]');
    function setBtn() {
      btn.firstChild.textContent = soundOn ? '🔊 ' : '🔇 ';
      label.textContent = soundOn ? t.sndOff : t.sndOn;
    }
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      soundOn = !soundOn; setBtn();
      if (soundOn) {
        try { snd.play().then(function () { snd.pause(); snd.currentTime = 0; }).catch(function () {}); } catch (e2) {}
        restart();
      }
    });

    /* ── Timeline ── */
    function clearTimers() { timers.forEach(clearTimeout); timers = []; }
    function at(ms, fn) { timers.push(setTimeout(fn, ms)); }
    var set = function (el, css) { Object.assign(el.style, css); };
    function show(el, on, extra) {
      set(el, Object.assign({ opacity: on ? '1' : '0', transition: 'opacity .6s ease, transform .6s ease' }, extra || {}));
    }
    function play() {
      if (!alive) return;
      stage.classList.remove('theme-green');
      show($('cl'), false, { transform: 'translateY(20px) scale(.96)' });
      show($('cw'), false, { transform: 'translateY(24px) scale(.95)' });
      stage.querySelectorAll('.ci').forEach(function (c) { set(c, { opacity: '0', transform: 'translateX(-14px)', transition: 'none' }); });
      stage.querySelectorAll('.ci .badge').forEach(function (b) { set(b, { transform: 'scale(0)', transition: 'none' }); });
      ['m1', 'm2', 'm3'].forEach(function (id) { set($(id), { opacity: '0', transform: 'translateY(8px)', transition: 'none' }); });
      ['cap1', 'cap2', 'cap3'].forEach(function (id) { show($(id), false); });
      show($('end'), false);
      set($('skinpop'), { opacity: '0', transform: 'translateY(-6px) scale(.96)' });
      set($('typing'), { opacity: '1' });

      at(300, function () { show($('cl'), true, { transform: 'translateY(0) scale(1)' }); });
      stage.querySelectorAll('.ci').forEach(function (c, i) {
        at(900 + i * 160, function () { set(c, { opacity: '1', transform: 'translateX(0)', transition: 'opacity .45s ease, transform .45s ease' }); });
      });
      at(1500, function () { show($('cap1'), true); });
      at(2600, function () {
        var b = stage.querySelector('.ci[data-i="0"] .badge');
        set(b, { transform: 'scale(1)', transition: 'transform .35s cubic-bezier(.2,1.6,.4,1)' });
        $('cl').classList.add('shake'); uhoh();
      });
      at(3150, function () { $('cl').classList.remove('shake'); });
      at(3300, function () { show($('cap1'), false); });
      at(3500, function () { show($('cw'), true, { transform: 'translateY(0) scale(1)' }); });
      at(4300, function () { set($('m1'), { opacity: '1', transform: 'translateY(0)', transition: 'opacity .4s ease, transform .4s ease' }); });
      at(4500, function () { show($('cap2'), true); });
      at(5200, function () { set($('typing'), { opacity: '0' }); set($('m2'), { opacity: '1', transform: 'translateY(0)', transition: 'opacity .4s ease, transform .4s ease' }); });
      at(6100, function () { set($('m3'), { opacity: '1', transform: 'translateY(0)', transition: 'opacity .4s ease, transform .4s ease' }); uhoh(); });
      at(7000, function () { show($('cap2'), false); });
      at(7500, function () { set($('skinpop'), { opacity: '1', transform: 'translateY(0) scale(1)', transition: 'opacity .35s ease, transform .35s ease' }); });
      at(8100, function () { $('sk2').style.outline = '2px solid var(--teal)'; });
      at(8500, function () { stage.classList.add('theme-green'); show($('cap3'), true); });
      at(9400, function () { set($('skinpop'), { opacity: '0', transform: 'translateY(-6px) scale(.96)', transition: 'opacity .3s ease' }); $('sk2').style.outline = 'none'; });
      at(10600, function () { show($('cap3'), false); });
      at(11200, function () { show($('cl'), false); show($('cw'), false); });
      at(11600, function () { show($('end'), true); });
      at(14600, function () { show($('end'), false); });
      at(15200, function () { play(); });
    }
    function restart() { clearTimers(); play(); }

    setBtn(); fit(); play();
    return { fit: fit, destroy: function () { alive = false; clearTimers(); } };
  }

  var registry = [];
  function boot() {
    document.querySelectorAll('.icq-reel').forEach(function (m) {
      registry.push({ mount: m, inst: initReel(m) });
    });
  }
  window.addEventListener('resize', function () { registry.forEach(function (e) { e.inst.fit(); }); });
  window.ICQReel = {
    setLang: function (l) {
      LANG = pickLang(l);
      document.documentElement.setAttribute('lang', LANG);
      registry.forEach(function (e) { e.inst.destroy(); e.inst = initReel(e.mount); });
    },
    getLang: function () { return LANG; }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

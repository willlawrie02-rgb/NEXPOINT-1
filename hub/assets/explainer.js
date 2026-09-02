/* Global Hub explainer — the global-overview animation (spec §8 as
   superseded by Chris's 24 Aug briefs: map-and-community).
   Hand-built SVG/CSS/JS, no libraries. Rides portal.js's land mask so
   the map matches the hero globe and finder. Bails out — leaving the
   static storyboard in place — under prefers-reduced-motion, when the
   mask helpers are absent, or on any page without the mount. */
(function () {
  'use strict';
  var mount = document.getElementById('explainer');
  if (!mount) return;
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (typeof isLand !== 'function' || typeof mapX !== 'function' || typeof mapY !== 'function') return;

  var NS = 'http://www.w3.org/2000/svg';
  var W = MAP_W, H = MAP_H; // 720 x 340

  /* Anchor points (lat, lon) — the founding example is Australia to the US. */
  var PT = {
    aus: [-25, 134], us: [39, -98], uk: [52, -1.5], de: [51, 10],
    ca: [56, -106], br: [-10, -55], jp: [36, 138], za: [-29, 24]
  };
  var xy = function (k) { return [mapX(PT[k][1]), mapY(PT[k][0])]; };

  var CAPTIONS = [
    ['Pick your hub', 'Print, mill or opportunities. Each door shows real, current capacity: anonymised on the page, verified by us in person.'],
    ['Introduce yourself', "Introduce yourself once and you're a member: who you are, where you are, what you're after. Chris or Will reads every profile personally."],
    ['A person weighs the fit', "One of us reviews every request, usually within two working days. If it isn't right, we say why and keep looking."],
    ['A personal introduction', 'When both sides agree, we introduce you directly: names, faces, facilities. The conversation is yours; we stay close to help it land.']
  ];
  var DUR = [5500, 5500, 5500, 8500]; // scene 4 includes the ~3s end-card hold

  function el(name, attrs, parent) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  /* ── build the component ── */
  var root = document.createElement('div');
  root.className = 'xp';
  root.setAttribute('data-scene', '0');
  root.setAttribute('aria-label', 'How the Global Hub works — animated overview');
  var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, 'aria-hidden': 'true', 'class': 'xp-stage' });
  root.appendChild(svg);

  /* map: one path of dotted land, same loop portal.js's buildMap uses */
  var d = '';
  for (var lat = LAT_TOP; lat >= LAT_BOT; lat -= LAND_STEP) {
    for (var lon = -180; lon < 180; lon += LAND_STEP) {
      if (isLand(lat, lon)) d += 'M' + mapX(lon).toFixed(1) + ' ' + mapY(lat).toFixed(1) + 'h0';
    }
  }
  el('path', { d: d, 'class': 'xp-land' }, svg);

  /* persistent pins (visible from scene 2 onwards via their scene groups; the
     Australia and US pins live on the base layer so scene 4 can pulse them) */
  var pinAus = el('circle', { cx: xy('aus')[0], cy: xy('aus')[1], r: 4, 'class': 'xp-pin', opacity: 0 }, svg);
  var pinUs = el('circle', { cx: xy('us')[0], cy: xy('us')[1], r: 4, 'class': 'xp-pin', opacity: 0 }, svg);

  /* scene groups (2 and 3 filled by Task 3) */
  var scenes = [];
  for (var i = 0; i < 4; i++) scenes.push(el('g', { 'class': 'xp-scene xp-s' + i }, svg));

  /* ── scene 1: three doors + pointer ── */
  (function (g) {
    var doors = [['PRINT HUB', 120], ['MILL HUB', 290], ['OPPORTUNITIES', 460]];
    var doorEls = doors.map(function (dd, idx) {
      var dg = el('g', { 'class': 'xp-door', transform: 'translate(' + dd[1] + ',96)' }, g);
      el('rect', { x: 0, y: 0, width: 140, height: 64, rx: 8 }, dg);
      var t = el('text', { x: 70, y: 37, 'text-anchor': 'middle' }, dg);
      t.textContent = dd[0];
      return dg;
    });
    var ptr = el('circle', { cx: 360, cy: 260, r: 6, 'class': 'xp-ptr' }, g);
    g._timers = [];
    g._enter = function () {
      g._timers.forEach(clearTimeout);
      g._timers = [];
      doorEls.forEach(function (dEl) { dEl.classList.remove('is-picked'); });
      /* .xp-ptr carries a persistent 1.1s CSS transition, so a straight reset
         would animate a visible backward glide on every revisit. Kill the
         transition for the reset, force a reflow so the browser commits the
         transition-less state, then restore it before scheduling the move. */
      ptr.style.transition = 'none';
      ptr.style.transform = 'translate(0,0)';
      void ptr.getBoundingClientRect();
      ptr.style.transition = '';
      g._timers.push(setTimeout(function () { ptr.style.transform = 'translate(' + (190 - 360) + 'px,' + (128 - 260) + 'px)'; }, 700));
      g._timers.push(setTimeout(function () { doorEls[0].classList.add('is-picked'); }, 1900));
    };
  })(scenes[0]);

  /* ── scene 2: questionnaire card fills itself, over the UK pin ── */
  (function (g) {
    var uk = xy('uk');
    el('circle', { cx: uk[0], cy: uk[1], r: 4, 'class': 'xp-pin' }, g);
    var card = el('g', { 'class': 'xp-cardg', transform: 'translate(' + (uk[0] - 220) + ',' + (uk[1] - 30) + ')' }, g);
    el('rect', { x: 0, y: 0, width: 170, height: 92, rx: 10, 'class': 'xp-card' }, card);
    el('line', { x1: 18, y1: 26, x2: 130, y2: 26, 'class': 'xp-line' }, card);
    el('line', { x1: 18, y1: 47, x2: 148, y2: 47, 'class': 'xp-line' }, card);
    el('line', { x1: 18, y1: 68, x2: 112, y2: 68, 'class': 'xp-line' }, card);
    /* card-frame coordinates (card is translated to (uk[0]-220, uk[1]-30), so
       card-local (0,0) is world (uk[0]-220, uk[1]-30)): x1=170 is the card's
       own right edge; the UK pin above is drawn in world space at (uk[0],
       uk[1]), which in this card-local frame is exactly (220, 30) — so y=30
       is the pin's card-frame y, and x2=216 stops right at the pin's edge
       (pin centre x=220, radius 4). Must stay a child of `card`, not `g`, or
       these local coordinates land nowhere near the card or the pin. */
    el('line', { x1: 170, y1: 30, x2: 216, y2: 30, 'class': 'xp-land', opacity: 0.6 }, card);
    g._timers = [];
    g._enter = function () {
      g._timers.forEach(clearTimeout);
      g._timers = [];
      card.classList.remove('is-on');
      void card.getBoundingClientRect();
      g._timers.push(setTimeout(function () { card.classList.add('is-on'); }, 500));
    };
  })(scenes[1]);

  /* ── scene 3: a person weighs the fit — two sides, a human, a verified tick ── */
  (function (g) {
    var cx = W / 2, cy = 130;
    var card = el('g', { 'class': 'xp-cardg', transform: 'translate(' + (cx - 130) + ',' + (cy - 56) + ')' }, g);
    el('rect', { x: 0, y: 0, width: 260, height: 112, rx: 12, 'class': 'xp-card' }, card);
    el('circle', { cx: 42, cy: 46, r: 5, 'class': 'xp-pin' }, card);
    el('circle', { cx: 62, cy: 62, r: 4, 'class': 'xp-pin', opacity: 0.55 }, card);
    el('circle', { cx: 218, cy: 46, r: 5, 'class': 'xp-pin' }, card);
    el('circle', { cx: 198, cy: 62, r: 4, 'class': 'xp-pin', opacity: 0.55 }, card);
    /* the person: head + shoulders, hairline strokes */
    el('circle', { cx: 130, cy: 42, r: 11, 'class': 'xp-person' }, card);
    el('path', { d: 'M112 78 q18 -18 36 0', 'class': 'xp-person' }, card);
    /* verified tick, pops in via .is-on. Circle + tickmark share one group
       (the class moved from the bare circle onto this wrapping <g>) so the
       scale-in transition carries both together — a lone circle scaling in
       under a static tickmark path let the tick render before its circle did. */
    var tick = el('g', { transform: 'translate(148,64)' }, card);
    var tickG = el('g', { 'class': 'xp-tick' }, tick);
    el('circle', { cx: 0, cy: 0, r: 10 }, tickG);
    el('path', { d: 'M-4 0 l3 3 l6 -7', 'class': 'xp-tickmark' }, tickG);
    g._timers = [];
    g._enter = function () {
      g._timers.forEach(clearTimeout);
      g._timers = [];
      card.classList.remove('is-on');
      void card.getBoundingClientRect();
      g._timers.push(setTimeout(function () { card.classList.add('is-on'); }, 500));
    };
    g._exit = function () {
      g._timers.forEach(clearTimeout);
      g._timers = [];
    };
  })(scenes[2]);

  /* ── scene 4: one introduction, then the community — Australia to the US,
     then the wider one-to-many the network exists for ── */
  (function (g) {
    function arc(a, b, cls) {
      var p1 = xy(a), p2 = xy(b);
      var mx = (p1[0] + p2[0]) / 2, my = Math.min(p1[1], p2[1]) - 55;
      var path = el('path', { d: 'M' + p1[0] + ' ' + p1[1] + ' Q' + mx + ' ' + my + ' ' + p2[0] + ' ' + p2[1], 'class': cls }, g);
      var len = Math.ceil(path.getTotalLength());
      path.style.setProperty('--len', len);
      return path;
    }
    var main = arc('aus', 'us', 'xp-arc');
    var faint = [arc('uk', 'us', 'xp-arc xp-arc--faint'), arc('de', 'br', 'xp-arc xp-arc--faint'),
                 arc('jp', 'aus', 'xp-arc xp-arc--faint'), arc('ca', 'uk', 'xp-arc xp-arc--faint')];
    var pins = [xy('uk'), xy('de'), xy('ca'), xy('br'), xy('jp'), xy('za')].map(function (p) {
      return el('circle', { cx: p[0], cy: p[1], r: 3, 'class': 'xp-pin', opacity: 0.5 }, g);
    });
    g._timers = [];
    g._enter = function () {
      g._timers.forEach(clearTimeout);
      g._timers = [];
      var rp = root._pins;
      [main].concat(faint).forEach(function (p) { p.classList.remove('is-drawn'); });
      rp.aus.setAttribute('opacity', 1); rp.us.setAttribute('opacity', 1);
      rp.aus.classList.add('xp-pin--pulse'); rp.us.classList.add('xp-pin--pulse');
      void main.getBoundingClientRect();
      g._timers.push(setTimeout(function () { main.classList.add('is-drawn'); }, 600));
      faint.forEach(function (p, idx) {
        g._timers.push(setTimeout(function () { p.classList.add('is-drawn'); }, 2100 + idx * 350));
      });
      g._timers.push(setTimeout(root._goEnd, 5000)); /* end card holds for the scene's last ~3.5s */
    };
    g._exit = function () {
      g._timers.forEach(clearTimeout);
      g._timers = [];
      var rp = root._pins;
      rp.aus.classList.remove('xp-pin--pulse'); rp.us.classList.remove('xp-pin--pulse');
      rp.aus.setAttribute('opacity', 0); rp.us.setAttribute('opacity', 0);
    };
  })(scenes[3]);

  /* captions + dots + end card (HTML, below/over the stage) */
  var cap = document.createElement('div'); cap.className = 'xp-caption';
  var capT = document.createElement('span'); capT.className = 'xp-cap-title'; cap.appendChild(capT);
  var capB = document.createElement('p'); capB.className = 'xp-cap-body'; cap.appendChild(capB);
  root.appendChild(cap);
  var dotsWrap = document.createElement('div'); dotsWrap.className = 'xp-dots';
  var dots = CAPTIONS.map(function (c, idx) {
    var b = document.createElement('button');
    b.className = 'xp-dot'; b.type = 'button';
    b.setAttribute('aria-label', 'Scene ' + (idx + 1) + ': ' + c[0]);
    b.addEventListener('click', function () { goTo(idx, true); });
    dotsWrap.appendChild(b); return b;
  });
  root.appendChild(dotsWrap);
  var end = document.createElement('div'); end.className = 'xp-end';
  var endP = document.createElement('p'); endP.textContent = 'Introduced, not sold.'; end.appendChild(endP);
  root.appendChild(end);

  /* ── the clock ── */
  var current = -1, timer = null;
  function goTo(i, manual) {
    clearTimeout(timer);
    if (current >= 0 && scenes[current] && scenes[current]._exit) scenes[current]._exit();
    current = i;
    root.setAttribute('data-scene', String(i));
    root.classList.remove('is-end');
    dots.forEach(function (b, idx) { b.classList.toggle('is-on', idx === i); });
    capT.textContent = CAPTIONS[i][0];
    capB.textContent = CAPTIONS[i][1];
    var g = scenes[i];
    if (g._enter) g._enter();
    timer = setTimeout(next, DUR[i] + (manual ? 1500 : 0));
  }
  function next() { goTo((current + 1) % 4, false); }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) clearTimeout(timer);
    else { clearTimeout(timer); timer = setTimeout(next, 1500); }
  });

  root._pins = { aus: pinAus, us: pinUs }; // scene 4 (Task 3) uses these
  root._scenes = scenes;
  root._goEnd = function () { root.classList.add('is-end'); };

  mount.innerHTML = '';
  mount.appendChild(root);
  goTo(0, false);
})();

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
    g._enter = function () {
      doorEls.forEach(function (dEl) { dEl.classList.remove('is-picked'); });
      ptr.style.transform = 'translate(0,0)';
      setTimeout(function () { ptr.style.transform = 'translate(' + (190 - 360) + 'px,' + (128 - 260) + 'px)'; }, 700);
      setTimeout(function () { doorEls[0].classList.add('is-picked'); }, 1900);
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
    /* card-local coordinates: (uk[0]-220) is the card's own translate-x, so
       these expressions net out to the card's right edge (170) and a point
       just short of the pin (214) — this must be a child of `card`, not `g`,
       or the offsets cancel against the wrong origin and the line lands
       nowhere near the card or the pin. */
    el('line', { x1: uk[0] - 50 - (uk[0] - 220), y1: 46, x2: uk[0] - (uk[0] - 220) - 6, y2: 46, 'class': 'xp-land', opacity: 0.6 }, card);
    g._enter = function () { card.classList.remove('is-on'); void card.getBoundingClientRect(); setTimeout(function () { card.classList.add('is-on'); }, 500); };
  })(scenes[1]);

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

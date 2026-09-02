/* Global Opportunities Hub infomercial (Chris's 24 Aug product-hub brief;
   naming settled 2026-09-02). Engine mirrors hub/assets/explainer.js.
   This page does not load portal.js, so the land mask and projection are
   carried here, OX_-prefixed — copied VERBATIM from hub/assets/portal.js
   (Natural Earth 110m rasterised at 1.2 degrees; update both if ever
   regenerated). Bails to the static storyboard under reduced motion. */
(function () {
  'use strict';
  var mount = document.getElementById('oppsExplainer');
  if (!mount) return;
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  /* ── map data (see header comment) ── */
  var OX_STEP = 1.2, OX_ROWS = 118, OX_LAT_TOP = 84, OX_LAT_BOT = -58;
  var OX_W = 720, OX_H = 340;
  var OX_LAND = [
    [[117,127]],
    [[77,97],[107,108],[111,122]],
    [[71,73],[75,93],[96,137],[228,230]],
    [[70,76],[78,90],[95,134],[160,160],[163,164],[167,171],[227,232]],
    [[56,58],[63,65],[68,69],[72,75],[77,86],[90,133],[160,165],[234,237]],
    [[50,52],[77,83],[94,133],[162,164],[236,237]],
    [[48,50],[53,55],[58,59],[65,68],[72,73],[92,132],[201,206],[232,243]],
    [[56,60],[66,67],[69,71],[73,82],[101,132],[196,200],[222,243],[265,269],[272,274]],
    [[47,52],[66,66],[70,73],[103,132],[195,197],[218,243],[268,268]],
    [[46,50],[52,56],[58,58],[60,61],[65,68],[70,71],[75,77],[79,82],[85,85],[104,130],[194,195],[208,210],[212,212],[217,256],[266,269]],
    [[0,0],[47,49],[51,62],[67,67],[70,71],[75,87],[89,89],[105,131],[193,196],[206,209],[211,212],[214,257],[260,263],[265,275]],
    [[15,26],[43,43],[54,64],[70,73],[78,92],[104,128],[168,174],[206,210],[212,282]],
    [[13,34],[36,51],[55,59],[63,64],[69,69],[71,75],[79,81],[86,93],[107,127],[164,180],[201,204],[207,210],[212,290],[292,299]],
    [[0,2],[13,54],[58,58],[60,64],[68,75],[78,81],[86,86],[89,95],[105,122],[162,183],[187,188],[191,210],[213,299]],
    [[0,3],[5,6],[15,80],[89,97],[105,120],[161,177],[179,183],[187,209],[211,299]],
    [[3,5],[10,78],[88,93],[96,96],[106,116],[131,137],[160,167],[171,178],[183,299]],
    [[16,75],[78,81],[89,95],[107,115],[131,136],[158,166],[169,179],[181,297]],
    [[13,73],[91,93],[95,95],[108,114],[156,164],[168,298]],
    [[12,71],[83,83],[85,89],[109,114],[154,163],[168,285],[287,295]],
    [[12,22],[24,25],[28,70],[85,91],[112,113],[154,164],[168,279],[283,283],[285,292]],
    [[15,21],[24,24],[34,70],[85,91],[95,96],[154,164],[170,273],[276,278],[284,285]],
    [[19,21],[37,72],[85,97],[145,146],[159,163],[170,266],[282,284]],
    [[18,19],[21,21],[39,74],[86,98],[145,147],[157,158],[160,163],[168,265],[280,285]],
    [[15,17],[40,77],[86,99],[145,147],[157,157],[159,159],[161,161],[168,263],[280,284]],
    [[13,13],[41,80],[84,101],[143,144],[147,148],[157,157],[164,263],[280,283]],
    [[39,39],[42,81],[84,102],[142,144],[146,149],[155,266],[268,268],[280,282]],
    [[40,40],[43,81],[84,103],[142,143],[146,150],[153,268],[280,281]],
    [[44,100],[102,102],[146,150],[152,266],[268,269]],
    [[44,93],[96,96],[102,103],[150,266],[268,269]],
    [[46,46],[48,91],[93,95],[101,105],[146,266],[268,268]],
    [[46,90],[92,95],[105,105],[148,265],[268,268]],
    [[47,95],[97,97],[99,99],[149,174],[177,178],[182,264],[268,268]],
    [[47,93],[96,97],[149,159],[161,174],[178,179],[181,263],[268,268]],
    [[47,91],[95,95],[149,156],[159,160],[163,173],[183,262],[268,270]],
    [[46,90],[143,152],[157,157],[159,161],[165,172],[185,258],[267,269]],
    [[47,89],[143,151],[161,163],[166,173],[176,180],[184,257]],
    [[46,87],[143,149],[157,157],[162,163],[166,169],[173,249],[252,256],[267,267]],
    [[47,86],[142,149],[163,163],[167,168],[172,247],[254,256],[267,267]],
    [[48,85],[143,148],[160,162],[168,168],[172,248],[254,256],[266,266]],
    [[48,86],[145,145],[151,158],[168,168],[174,174],[176,178],[180,250],[255,257],[264,266]],
    [[49,86],[145,145],[149,158],[180,249],[255,257],[260,266]],
    [[51,84],[144,157],[180,249],[259,261],[263,263]],
    [[52,83],[143,159],[179,250],[258,260]],
    [[53,81],[142,162],[167,170],[179,251],[259,259]],
    [[53,53],[56,81],[142,164],[166,250]],
    [[54,54],[56,70],[74,75],[81,81],[142,189],[192,251]],
    [[55,55],[57,68],[81,82],[140,189],[193,250]],
    [[55,56],[58,68],[81,82],[139,177],[180,190],[194,249]],
    [[56,56],[59,68],[82,82],[138,178],[181,192],[198,249]],
    [[57,57],[60,68],[137,178],[181,192],[195,196],[206,248],[251,251]],
    [[58,58],[61,68],[137,179],[182,198],[207,246],[250,250]],
    [[62,68],[82,84],[136,180],[183,199],[208,224],[227,244]],
    [[19,19],[62,68],[75,77],[85,86],[136,180],[183,198],[209,209],[211,222],[227,238],[241,241]],
    [[20,20],[62,69],[75,76],[89,90],[136,180],[184,197],[211,220],[228,237],[241,241]],
    [[64,70],[73,76],[90,92],[136,180],[184,196],[211,219],[228,237],[241,241]],
    [[66,75],[136,181],[185,195],[211,218],[229,238],[250,251]],
    [[68,75],[136,182],[186,193],[211,217],[229,229],[231,239],[250,251]],
    [[73,80],[136,183],[186,191],[212,216],[231,240],[250,250]],
    [[75,79],[136,184],[186,189],[212,216],[232,240],[251,252]],
    [[77,79],[136,185],[212,216],[232,232],[235,240]],
    [[78,79],[89,89],[92,92],[137,185],[191,192],[213,216],[232,232],[236,240],[252,252],[254,254]],
    [[79,80],[87,89],[91,94],[96,98],[138,191],[213,215],[232,232],[237,238],[252,252]],
    [[80,80],[83,84],[86,98],[139,191],[214,214],[217,217],[232,232],[237,237]],
    [[82,82],[85,100],[139,191],[216,217],[233,233],[252,254]],
    [[85,101],[141,190],[217,217],[233,234],[247,247],[253,254]],
    [[85,105],[142,149],[154,190],[229,229],[234,235],[246,248]],
    [[85,106],[157,189],[230,231],[234,235],[245,247]],
    [[85,107],[158,188],[231,232],[234,235],[244,247]],
    [[84,107],[158,187],[232,234],[236,236],[241,247],[256,256]],
    [[83,107],[158,185],[233,235],[241,247],[250,253],[256,256]],
    [[83,108],[157,184],[233,235],[241,247],[260,260]],
    [[83,112],[158,183],[234,236],[242,246],[249,250],[260,261],[264,264]],
    [[83,116],[158,182],[235,237],[242,246],[249,249],[251,251],[257,257],[260,261],[263,267],[276,276]],
    [[82,117],[159,182],[235,237],[251,251],[262,270],[276,277]],
    [[82,120],[160,181],[237,237],[249,249],[252,252],[265,271],[276,276]],
    [[83,120],[160,182],[238,239],[242,242],[265,272],[279,279]],
    [[84,120],[161,182],[241,244],[265,269],[271,272],[282,282]],
    [[84,120],[161,182],[247,247],[254,254],[267,268],[272,273]],
    [[85,119],[161,182],[250,250],[253,253],[274,274]],
    [[85,118],[161,183],[260,260],[268,268]],
    [[86,117],[161,183],[259,263],[268,268]],
    [[86,117],[160,183],[190,191],[258,262],[268,269]],
    [[87,117],[160,183],[189,191],[254,262],[268,270]],
    [[89,117],[160,182],[187,190],[254,264],[268,270],[289,289]],
    [[90,116],[160,181],[187,190],[252,265],[267,271]],
    [[91,116],[160,179],[187,190],[251,271]],
    [[92,116],[161,178],[187,190],[250,272]],
    [[92,115],[161,178],[187,189],[247,273],[287,287]],
    [[91,114],[162,179],[186,189],[245,274]],
    [[91,112],[162,179],[186,189],[245,275]],
    [[91,110],[162,178],[187,188],[245,276]],
    [[91,109],[162,176],[245,277]],
    [[91,109],[163,176],[245,277]],
    [[91,108],[163,176],[245,277]],
    [[90,108],[164,175],[246,277]],
    [[90,107],[165,174],[246,277]],
    [[90,106],[165,173],[246,256],[260,276]],
    [[90,105],[165,172],[246,253],[262,275]],
    [[90,100],[102,104],[166,167],[246,249],[263,263],[265,275]],
    [[90,101],[265,274],[294,294]],
    [[89,102],[266,274],[295,295]],
    [[89,101],[267,273],[296,296],[298,298]],
    [[89,97],[295,297]],
    [[89,97],[296,296]],
    [[88,95],[271,273],[293,294]],
    [[88,96],[271,272],[293,294]],
    [[89,95],[291,293]],
    [[88,94],[289,292]],
    [[87,93],[289,291]],
    [[88,94]],
    [[87,93]],
    [[87,93]],
    [[87,91]],
    [[88,92],[99,100]],
    [[88,92]],
    [[90,94]],
    [],
    []
  ];
  function OX_isLand(lat, lon) {
    var row = Math.floor((OX_LAT_TOP - lat) / OX_STEP);
    var col = Math.floor((lon + 180) / OX_STEP);
    if (row < 0 || row >= OX_ROWS || col < 0 || col >= 300) return false;
    var segs = OX_LAND[row];
    for (var i = 0; i < segs.length; i++) if (col >= segs[i][0] && col <= segs[i][1]) return true;
    return false;
  }
  function OX_mapX(lon) { return (lon + 180) / 360 * OX_W; }
  function OX_mapY(lat) { return (OX_LAT_TOP - lat) / (OX_LAT_TOP - OX_LAT_BOT) * OX_H; }

  var NS = 'http://www.w3.org/2000/svg';
  var PT = { ca: [56, -106], eu: [51, 10], aus: [-25, 134], us: [39, -98], uk: [52, -1.5], br: [-10, -55], jp: [36, 138] };
  var xy = function (k) { return [OX_mapX(PT[k][1]), OX_mapY(PT[k][0])]; };

  var CAPTIONS = [
    ['The old way', 'A product proven at home used to mean years of exhibitions, business cards and interviews before it sold abroad.'],
    ['We know both ends', 'A company in Canada, a distributor in Europe — NexPoint knows people at both ends, thinks of the fit, and introduces you directly.'],
    ['More than listings', "Partner discounts we've negotiated on scanners and materials live inside the hub, and the quarterly programmes put what's new in front of the whole community."],
    ['A go-to place', 'Products, services, materials and technologies from across the world — browse what might suit you, under no pressure whatsoever.']
  ];
  var DUR = [5500, 5500, 5500, 8500];

  function el(name, attrs, parent) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function txt(node, s) { node.textContent = s; return node; }

  var root = document.createElement('div');
  root.className = 'ox';
  root.setAttribute('data-scene', '0');
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', 'What the Global Opportunities Hub does — animated overview');
  var svg = el('svg', { viewBox: '0 0 ' + OX_W + ' ' + OX_H, 'aria-hidden': 'true', 'class': 'ox-stage' });
  root.appendChild(svg);

  /* the persistent dotted world */
  var d = '';
  for (var lat = OX_LAT_TOP; lat >= OX_LAT_BOT; lat -= OX_STEP) {
    for (var lon = -180; lon < 180; lon += OX_STEP) {
      if (OX_isLand(lat, lon)) d += 'M' + OX_mapX(lon).toFixed(1) + ' ' + OX_mapY(lat).toFixed(1) + 'h0';
    }
  }
  el('path', { d: d, 'class': 'ox-land' }, svg);

  var scenes = [];
  for (var i = 0; i < 4; i++) scenes.push(el('g', { 'class': 'ox-scene ox-s' + i }, svg));

  /* ── scene 1: the old way — a product at home, the legwork abroad ── */
  (function (g) {
    g._timers = [];
    var ca = xy('ca');
    var prod = el('g', { transform: 'translate(' + (ca[0] - 34) + ',' + (ca[1] - 22) + ')' }, g);
    el('rect', { x: 0, y: 0, width: 68, height: 44, rx: 8, 'class': 'ox-card' }, prod);
    txt(el('text', { x: 34, y: 19, 'text-anchor': 'middle', 'class': 'ox-label' }, prod), 'PRODUCT');
    txt(el('text', { x: 34, y: 33, 'text-anchor': 'middle', 'class': 'ox-sub' }, prod), 'proven at home');
    /* the tangle: one wandering dashed path from the product across the ocean */
    var eu = xy('eu');
    el('path', { d: 'M' + (ca[0] + 34) + ' ' + ca[1] +
      ' q60 -46 120 -18 q50 24 40 58 q-14 40 56 30 q60 -8 ' + (eu[0] - (ca[0] + 250)) + ' ' + (eu[1] - ca[1] - 70), 'class': 'ox-tangle' }, g);
    /* scattered business cards across Europe */
    var scat = el('g', { 'class': 'ox-scatter' }, g);
    [[-38, -30], [12, -44], [44, -12], [-10, 8], [30, 22], [-44, 18]].forEach(function (o) {
      el('rect', { x: eu[0] + o[0], y: eu[1] + o[1], width: 26, height: 16, rx: 3 }, scat);
    });
    g._enter = function () { g._timers.forEach(clearTimeout); g._timers = []; };
  })(scenes[0]);

  /* ── scene 2: we know both ends — the tangle becomes one clean arc ── */
  (function (g) {
    g._timers = [];
    var ca = xy('ca'), eu = xy('eu');
    var pinCa = el('circle', { cx: ca[0], cy: ca[1], r: 4, 'class': 'ox-pin' }, g);
    var pinEu = el('circle', { cx: eu[0], cy: eu[1], r: 4, 'class': 'ox-pin' }, g);
    var mx = (ca[0] + eu[0]) / 2, my = Math.min(ca[1], eu[1]) - 60;
    var arc = el('path', { d: 'M' + ca[0] + ' ' + ca[1] + ' Q' + mx + ' ' + my + ' ' + eu[0] + ' ' + eu[1], 'class': 'ox-arc' }, g);
    var a2 = xy('aus'), u2 = xy('us');
    var arc2 = el('path', { d: 'M' + a2[0] + ' ' + a2[1] + ' Q' + ((a2[0] + u2[0]) / 2) + ' ' + (Math.min(a2[1], u2[1]) - 55) + ' ' + u2[0] + ' ' + u2[1], 'class': 'ox-arc ox-arc--faint' }, g);
    [arc, arc2].forEach(function (p) { /* --len set at build; groups are opacity-hidden, so getTotalLength is safe */
      p.style.setProperty('--len', Math.ceil(p.getTotalLength()));
    });
    /* the fit, confirmed: tick at the arc's apex */
    var wrap = el('g', { 'class': 'ox-cardg' }, g);
    var tickg = el('g', { transform: 'translate(' + mx + ',' + (my + 34) + ')', 'class': 'ox-tick' }, wrap);
    el('circle', { cx: 0, cy: 0, r: 10 }, tickg);
    el('path', { d: 'M-4 0 l3 3 l6 -7', 'class': 'ox-tickmark' }, tickg);
    g._enter = function () {
      g._timers.forEach(clearTimeout); g._timers = [];
      [arc, arc2].forEach(function (p) { p.classList.remove('is-drawn'); });
      wrap.classList.remove('is-on');
      void g.getBoundingClientRect();
      g._timers.push(setTimeout(function () { arc.classList.add('is-drawn'); wrap.classList.add('is-on'); }, 500));
      g._timers.push(setTimeout(function () { arc2.classList.add('is-drawn'); }, 1600));
      pinCa.classList.add('ox-pin--pulse'); pinEu.classList.add('ox-pin--pulse');
    };
    g._exit = function () {
      g._timers.forEach(clearTimeout); g._timers = [];
      pinCa.classList.remove('ox-pin--pulse'); pinEu.classList.remove('ox-pin--pulse');
    };
  })(scenes[1]);

  /* captions, dots, end card */
  var cap = document.createElement('div'); cap.className = 'ox-caption';
  var capT = document.createElement('span'); capT.className = 'ox-cap-title'; cap.appendChild(capT);
  var capB = document.createElement('p'); capB.className = 'ox-cap-body'; cap.appendChild(capB);
  root.appendChild(cap);
  var dotsWrap = document.createElement('div'); dotsWrap.className = 'ox-dots';
  var dots = CAPTIONS.map(function (c, idx) {
    var b = document.createElement('button');
    b.className = 'ox-dot'; b.type = 'button';
    b.setAttribute('aria-label', 'Scene ' + (idx + 1) + ': ' + c[0]);
    b.addEventListener('click', function () { goTo(idx, true); });
    dotsWrap.appendChild(b); return b;
  });
  root.appendChild(dotsWrap);
  var end = document.createElement('div'); end.className = 'ox-end';
  var endP = document.createElement('p'); endP.textContent = 'Under no pressure whatsoever.'; end.appendChild(endP);
  root.appendChild(end);

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

  root._goEnd = function () { root.classList.add('is-end'); };
  root._scenes = scenes;

  mount.innerHTML = '';
  mount.appendChild(root);
  goTo(0, false);
})();

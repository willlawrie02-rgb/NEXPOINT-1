/* NexPoint world map: one dotted equirectangular map, drawn as SVG, used in
   two ways.

     show  the main site's Network section: green pins at the markets we
           cover, a label beside each, nothing moving.
     pick  the listing form's "where you ship" picker: the nine regions are
           hit areas, a click toggles the matching chip, the chips stay the
           source of truth.

   Standalone: no portal.js, no library, no build step, ES2018. Exposes
   window.NPWorldMap = { mount, isLand, REGIONS, LAND } and mounts every
   [data-world-map="show"] element on DOMContentLoaded.

   The land mask below is copied verbatim from hub/assets/portal.js, which
   keeps its own copy for the pair map; check/sweep.mjs asserts the two stay
   identical, so change both or neither.

   Geometry: viewBox 0 0 640 252, 360 degrees wide, 141.6 degrees tall (lat
   84 north to 57.6 south, the mask's own window, so no Antarctic smear):
     x = (lon + 180) * 640 / 360
     y = (84 - lat) * 252 / 141.6
*/
(function () {
  'use strict';

/* Land mask rasterised from Natural Earth 110m land polygons at 1.2 degrees, over the map's
   own latitude window (84N to 58S, so no Antarctic smear along the bottom). Each row is a
   list of inclusive column runs. The previous mask was 24x60, which turned every coastline
   into a stair-step; this is the same structure at roughly 25 times the resolution. */
const LAND_STEP = 1.2, LAND_COLS = 300, LAND_ROWS = 118, LAND_LAT_TOP = 84;
const LAND = [
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
function isLand(lat, lon){
  const row = Math.floor((LAND_LAT_TOP - lat) / LAND_STEP);
  const col = Math.floor((lon + 180) / LAND_STEP);
  if (row < 0 || row >= LAND_ROWS || col < 0 || col >= LAND_COLS) return false;
  const segs = LAND[row];
  for (let i = 0; i < segs.length; i++) if (col >= segs[i][0] && col <= segs[i][1]) return true;
  return false;
}

  /* ───────────────────────── projection ───────────────────────── */
  const VW = 640, VH = 252, LAT_SPAN = 141.6;
  const px = (lon) => (lon + 180) * VW / 360;
  const py = (lat) => (LAND_LAT_TOP - lat) * VH / LAT_SPAN;
  const NS = 'http://www.w3.org/2000/svg';
  const BLUE = '#005CC8', GREEN = '#8BC53F', INK = '#0E1626', MUTED = '#5A6474';

  /* ───────────────────────── regions ──────────────────────────────
     The nine geographic terms of the hub vocabulary (hub/assets/vocab.js),
     each a lat/lon polygon. A dot is classified by the first polygon that
     contains it, in the order below, so the small or contested ones come
     first: Ireland before the UK (they overlap by design, both padded out
     to sea so they can be clicked), the Middle East before Europe, Africa
     and Asia (it carves Turkey, the Levant, Arabia and Iran out of all
     three), Europe before Africa and Asia (Russia west of the Urals,
     Iceland, Cyprus, the Mediterranean islands), the Americas before
     Oceania (Hawaii is left to the Pacific). Oceania and Asia (Chukotka)
     cross the antimeridian, so their polygons run past 180 and points are
     tested at lon and lon + 360. */
  const REGIONS = [
    { term: 'ireland', label: 'Ireland', labelAt: { lat: 41.5, lon: -25 },
      polygon: [[49.5, -12.5], [50.8, -6.3], [52.5, -5.6], [54.3, -5.4], [55.3, -5.9], [56.2, -7.2], [56.5, -9.5], [55.5, -12.5]] },
    { term: 'uk', label: 'UK', labelAt: { lat: 61.5, lon: -3 },
      polygon: [[50.5, -9.0], [49.5, -5.5], [49.9, -2.5], [50.6, 2.0], [52.0, 3.0], [55.0, 2.0], [61.5, 0.5], [62.0, -3.5], [59.0, -9.5]] },
    { term: 'middle_east', label: 'Middle East', labelAt: { lat: 17, lon: 47.5 },
      polygon: [[42.2, 26.3], [41.6, 43.8], [39.5, 44.8], [38.6, 48.5], [38.0, 54.0], [36.5, 61.5], [29.5, 63.3], [25.0, 61.5], [15.5, 56.0], [13.5, 52.0], [12.3, 43.3], [26.5, 34.8], [29.8, 32.3], [31.5, 32.4], [35.8, 34.0], [36.8, 35.5], [36.0, 29.5], [39.6, 26.2]] },
    { term: 'europe', label: 'Europe', labelAt: { lat: 56, lon: 30 },
      polygon: [[36.5, -30], [35.95, -5.6], [37.5, 3], [38.0, 10.5], [36.3, 12], [34.5, 20], [35.3, 28], [34.5, 34.5], [37.5, 36], [43.2, 41], [43.5, 47.5], [46.2, 48], [51.2, 50.5], [51.5, 61], [58.0, 60.5], [67.5, 66], [77.5, 69], [84, 40], [84, -8], [72, -20], [60, -30]] },
    { term: 'africa', label: 'Africa', labelAt: { lat: 5, lon: 20 },
      polygon: [[37.5, -30], [37.5, 12], [32.5, 32], [26, 36], [12, 44], [11, 56], [-12, 60], [-36, 60], [-40, 15], [-20, -5], [5, -30]] },
    { term: 'asia', label: 'Asia', labelAt: { lat: 55, lon: 95 },
      polygon: [[84, 40], [84, 191], [65.3, 191], [60, 180], [30, 180], [25, 150], [25, 132], [5, 131], [0, 141], [-9.5, 141], [-11, 125], [-8, 104], [-2, 60], [30, 60], [40, 40]] },
    { term: 'north_america', label: 'North America', labelAt: { lat: 60, lon: -110 },
      polygon: [[84, -180], [84, -5], [62, -30], [40, -50], [25, -55], [12, -57], [12.6, -69], [12.8, -72], [9, -77.8], [6.5, -82], [12, -93], [16, -108], [25, -125], [45, -140], [50, -180]] },
    { term: 'south_america', label: 'South America', labelAt: { lat: -18, lon: -58 },
      polygon: [[5, -95], [15, -75], [15, -55], [0, -30], [-58, -30], [-58, -95]] },
    { term: 'oceania', label: 'Oceania', labelAt: { lat: -22, lon: 134 },
      polygon: [[-10, 105], [-10.5, 141], [2, 141], [26, 150], [26, 232], [-58, 232], [-58, 105]] }
  ];

  /* ray casting; vertices are [lat, lon] */
  function inside(poly, lat, lon) {
    let hit = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const yi = poly[i][0], xi = poly[i][1], yj = poly[j][0], xj = poly[j][1];
      if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  }
  function regionOf(lat, lon) {
    for (let i = 0; i < REGIONS.length; i++) {
      const p = REGIONS[i].polygon;
      if (inside(p, lat, lon) || inside(p, lat, lon + 360)) return REGIONS[i].term;
    }
    return '';
  }

  /* ───────────────────────── dots ──────────────────────────────────
     The mask is sampled in blocks of `stride` cells a side (3 by default:
     3.6 degrees, one dot per block); a block is land when at least four of
     its nine cells are, so a coastline reads as a line rather than a fringe
     of stragglers. */
  function dotsByRegion(stride) {
    const n = stride || 3, need = n === 3 ? 4 : Math.ceil(n * n * 0.4);
    const groups = {};
    for (let r0 = 0; r0 < LAND_ROWS; r0 += n) {
      for (let c0 = 0; c0 < LAND_COLS; c0 += n) {
        let land = 0;
        for (let r = r0; r < r0 + n && r < LAND_ROWS; r++) {
          const segs = LAND[r];
          for (let s = 0; s < segs.length; s++) {
            const a = Math.max(segs[s][0], c0), b = Math.min(segs[s][1], c0 + n - 1);
            if (b >= a) land += b - a + 1;
          }
        }
        if (land < need) continue;
        const lat = LAND_LAT_TOP - (r0 + n / 2) * LAND_STEP;
        const lon = -180 + (c0 + n / 2) * LAND_STEP;
        const term = regionOf(lat, lon);
        (groups[term] = groups[term] || []).push([lat, lon]);
      }
    }
    return groups;
  }

  /* ───────────────────────── svg helpers ─────────────────────────── */
  function node(name, attrs, text) {
    const e = document.createElementNS(NS, name);
    for (const k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) e.setAttribute(k, attrs[k]);
    if (text !== undefined) e.textContent = text;
    return e;
  }
  const f1 = (v) => (Math.round(v * 10) / 10).toString();
  function pathOf(poly, shift) {
    return poly.map((v, i) => (i ? 'L' : 'M') + f1(px(v[1] + (shift || 0))) + ' ' + f1(py(v[0]))).join(' ') + 'Z';
  }
  /* a rough width for a 10px uppercase label, to keep it inside the frame */
  const labelWidth = (s) => s.length * 7.6;
  const clampX = (x, w) => Math.max(w / 2 + 4, Math.min(VW - w / 2 - 4, x));

  const STYLE =
    '.wm-dots circle{opacity:.38;transition:opacity 200ms cubic-bezier(.2,.8,.2,1)}' +
    'g[data-hover] .wm-dots circle{opacity:.6}' +
    'g[data-on] .wm-dots circle{opacity:1}' +
    '.wm-label{font:600 10px Inter,system-ui,sans-serif;text-transform:uppercase;letter-spacing:.08em;fill:' + MUTED + ';pointer-events:none}' +
    '.wm-pin-label{font:600 10px Inter,system-ui,sans-serif;text-transform:uppercase;letter-spacing:.08em;fill:' + INK + ';pointer-events:none}' +
    '.wm-hit{fill:transparent;stroke:none}' +
    'svg[data-mode="pick"] .wm-hit{cursor:pointer}';

  function buildSvg(opts) {
    const svg = node('svg', { viewBox: '0 0 ' + VW + ' ' + VH, 'data-mode': opts.mode, xmlns: NS });
    svg.style.display = 'block';
    svg.style.width = '100%';
    svg.style.height = 'auto';
    svg.appendChild(node('style', {}, STYLE));
    const groups = dotsByRegion(opts.step ? Math.max(1, Math.round(opts.step / LAND_STEP)) : 3);
    const byTerm = {};
    /* drawn in reverse precedence, so the region that wins a point in
       regionOf is also the hit path on top of it (Ireland over the UK over
       Europe) */
    const order = [''].concat(REGIONS.map((r) => r.term).reverse());
    order.forEach((term) => {
      const g = node('g', { 'data-region': term });
      const region = REGIONS.filter((r) => r.term === term)[0];
      if (region) {
        /* the hit area first, under the dots; Oceania's twice, once each side of the antimeridian */
        g.appendChild(node('path', { class: 'wm-hit', d: pathOf(region.polygon), 'pointer-events': opts.mode === 'pick' ? 'fill' : 'none' }));
        if (region.polygon.some((v) => v[1] > 180)) {
          g.appendChild(node('path', { class: 'wm-hit', d: pathOf(region.polygon, -360), 'pointer-events': opts.mode === 'pick' ? 'fill' : 'none' }));
        }
      }
      const dots = node('g', { class: 'wm-dots', fill: BLUE });
      (groups[term] || []).forEach((d) => dots.appendChild(node('circle', { cx: f1(px(d[1])), cy: f1(py(d[0])), r: '1.9' })));
      g.appendChild(dots);
      svg.appendChild(g);
      byTerm[term] = g;
    });
    /* region labels, above the dots of every group */
    const labels = node('g', { class: 'wm-labels' });
    REGIONS.forEach((r) => {
      const w = labelWidth(r.label);
      labels.appendChild(node('text', { class: 'wm-label', x: f1(clampX(px(r.labelAt.lon), w)), y: f1(py(r.labelAt.lat)), 'text-anchor': 'middle' }, r.label));
    });
    svg.appendChild(labels);
    return { svg: svg, byTerm: byTerm };
  }

  /* ───────────────────────── show mode ───────────────────────────── */
  function drawPins(svg, pins) {
    const g = node('g', { class: 'wm-pins' });
    (pins || []).forEach((p) => {
      const x = px(p.lon), y = py(p.lat);
      const at = p.at || (x > VW - 80 ? 'left' : 'right');
      const w = labelWidth(p.label || '');
      let tx = x + 8, ty = y + 3.5, anchor = 'start';
      if (at === 'left') { tx = x - 8; anchor = 'end'; }
      else if (at === 'above') { tx = clampX(x, w); ty = y - 8; anchor = 'middle'; }
      else if (at === 'below') { tx = clampX(x, w); ty = y + 14; anchor = 'middle'; }
      g.appendChild(node('circle', { cx: f1(x), cy: f1(y), r: '4', fill: GREEN, stroke: '#fff', 'stroke-width': '1.5' }));
      g.appendChild(node('text', { class: 'wm-pin-label', x: f1(tx), y: f1(ty), 'text-anchor': anchor }, p.label || ''));
    });
    svg.appendChild(g);
  }

  /* ───────────────────────── pick mode ───────────────────────────── */
  const GEO = REGIONS.map((r) => r.term);
  function boxOf(group, term) {
    return group ? group.querySelector('input[type="checkbox"][data-region="' + term + '"]') : null;
  }
  function setBox(box, on) {
    if (!box || box.checked === on) return;
    box.checked = on;
    box.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function mount(opts) {
    opts = opts || {};
    const el = typeof opts.el === 'string' ? document.querySelector(opts.el) : opts.el;
    if (!el) return null;
    const mode = opts.mode === 'pick' ? 'pick' : 'show';
    el.innerHTML = '';
    const built = buildSvg({ mode: mode, step: opts.step });
    const svg = built.svg, byTerm = built.byTerm;
    el.appendChild(svg);

    if (mode === 'show') {
      drawPins(svg, opts.pins);
      svg.setAttribute('role', 'img');
      const names = (opts.pins || []).map((p) => p.label).filter(Boolean).join(', ');
      svg.setAttribute('aria-label', names ? 'Global network: ' + names : 'World map');
      return { svg: svg, sync: function () {} };
    }

    /* pick */
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const group = typeof opts.group === 'string' ? document.querySelector(opts.group) : opts.group;

    const pills = document.createElement('div');
    pills.className = 'wm-pills';
    const worldPill = document.createElement('button');
    worldPill.type = 'button';
    worldPill.className = 'wm-pill';
    worldPill.textContent = 'Worldwide';
    pills.appendChild(worldPill);
    let ownPill = null;
    if (typeof opts.onOwn === 'function') {
      ownPill = document.createElement('button');
      ownPill.type = 'button';
      ownPill.className = 'wm-pill';
      ownPill.textContent = 'Own country only';
      pills.appendChild(ownPill);
    }
    el.appendChild(pills);

    function sync() {
      let all = true;
      GEO.forEach((term) => {
        const box = boxOf(group, term), on = !!(box && box.checked);
        if (!on) all = false;
        const g = byTerm[term];
        if (g) { if (on) g.setAttribute('data-on', ''); else g.removeAttribute('data-on'); }
      });
      const world = boxOf(group, 'worldwide');
      worldPill.classList.toggle('is-on', all || !!(world && world.checked));
    }

    svg.addEventListener('click', (ev) => {
      const g = ev.target.closest ? ev.target.closest('g[data-region]') : null;
      const term = g && g.getAttribute('data-region');
      if (!term || GEO.indexOf(term) === -1) return;
      const box = boxOf(group, term);
      if (!box) return;
      setBox(box, !box.checked);
      /* unticking a region after Worldwide unticks Worldwide (synced below) */
    });
    svg.addEventListener('mouseover', (ev) => {
      const g = ev.target.closest ? ev.target.closest('g[data-region]') : null;
      if (g && g.getAttribute('data-region')) g.setAttribute('data-hover', '');
    });
    svg.addEventListener('mouseout', (ev) => {
      const g = ev.target.closest ? ev.target.closest('g[data-region]') : null;
      if (g) g.removeAttribute('data-hover');
    });
    worldPill.addEventListener('click', () => {
      GEO.forEach((term) => setBox(boxOf(group, term), true));
      setBox(boxOf(group, 'worldwide'), true);
      sync();
    });
    if (ownPill) ownPill.addEventListener('click', () => { opts.onOwn(); sync(); });
    if (group) group.addEventListener('change', (ev) => {
      const t = ev.target;
      if (t && t.matches && t.matches('input[data-region]') && !t.checked && GEO.indexOf(t.getAttribute('data-region')) !== -1) {
        setBox(boxOf(group, 'worldwide'), false);
      }
      sync();
    });
    sync();
    return { svg: svg, sync: sync };
  }

  /* ───────────────────────── auto-mount ──────────────────────────── */
  /* Only the show maps mount themselves, from data-pins (a JSON array of
     {label, lat, lon, at?}). A data-world-map="pick" element is mounted by
     the listing form (hub/assets/listing-form.js), which owns the chips the
     map toggles, so it is left alone here. */
  function auto() {
    const els = document.querySelectorAll('[data-world-map="show"]');
    for (let i = 0; i < els.length; i++) {
      let pins = [];
      try { pins = JSON.parse(els[i].getAttribute('data-pins') || '[]'); } catch (e) { pins = []; }
      mount({ el: els[i], mode: 'show', pins: pins });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', auto);
  else auto();

  window.NPWorldMap = { mount: mount, isLand: isLand, REGIONS: REGIONS, LAND: LAND };
})();

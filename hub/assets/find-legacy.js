/* NexPoint Global Hub - the find page as it stands today.
   This is the placeholder capacity map and matcher that used to sit inside
   portal.js, lifted out unchanged so the shared module carries only what every
   page needs. It is the find page's module until the find rebuild replaces it
   with a real search over listings; nothing else loads it.

   What it shows is deliberately empty: no print node is certified yet, so the
   counts are zero and the matcher answers with the desk rather than inventing
   capacity. The hub's own words come from NP.config(), which is why there is
   one copy of this file rather than one per hub.                          */

const findCfg = (window.NP && NP.config()) || null;

/* Zero everywhere, deliberately (2026-09-03 truthfulness sweep): no print node
   is verified yet, and the map must never claim capacity that does not exist.
   Real counts return here as real nodes are certified. */
const NODE_COUNT = {
  'North America': 0, 'UK & Ireland': 0, 'Europe': 0,
  'Middle East': 0, 'Asia': 0, 'Australia & New Zealand': 0, 'South America': 0
};

/* Capacity is described by process and material, never by machine brand or model.
   Machine allowlist is deliberate: only platforms we have verified first-hand
   (Chris, 14 Aug review).
   `near` = miles when the seeker is in the same country as the node,
   `far`  = miles when they are elsewhere in the region.                      */
const PRINT_NODES = {};  /* placeholder listings removed 2026-09-03; entries return only for first-hand-verified nodes */

/* The Mill Hub runs on one verified manufacturer with cells on two continents,
   so every region can be served today; two regions are getting their own cell. */
const MILL_PLAN = {
  'Europe': 'next',
  'Australia & New Zealand': 'next'
};

/* ═══════════ the map ═══════════
   Dot-matrix world drawn from the same land mask as the hero globe, so the map
   and the globe speak the same language. No external tiles, no libraries.     */
const MAP_W = 720, MAP_H = 340, LAT_TOP = 84, LAT_BOT = -58;
function mapX(lon){ return (lon + 180) / 360 * MAP_W; }
function mapY(lat){ return (LAT_TOP - lat) / (LAT_TOP - LAT_BOT) * MAP_H; }

/* lon/lat bounds per region, deliberately non-overlapping so every click is unambiguous */
const REGION_BOX = {
  'North America':          { lon:[-168,-52], lat:[14,72]  },
  'South America':          { lon:[-84,-33],  lat:[-55,13] },
  'UK & Ireland':           { lon:[-44,2.5],  lat:[49,61]  },
  'Europe':                 { lon:[3,32],     lat:[35,62]  },
  'Middle East':            { lon:[33,62],    lat:[12,41]  },
  'Asia':                   { lon:[63,150],   lat:[3,56]   },
  'Australia & New Zealand':{ lon:[112,179],  lat:[-50,-9] }
};
/* UK & Ireland is only ~27px of coastline at this projection: too narrow to hold its own
   label or to be a fair click target. Its box is extended west into empty Atlantic so the
   label and count sit inside it, the way an inset callout does. No other region reaches there. */
const REGION_LABEL = {
  /* the box reaches out to New Zealand, so its centre lands in the Coral Sea, so pull the
     chip back over the Australian landmass, where the nodes actually are */
  'Australia & New Zealand': { dx:-24, dy:-6 }
};

/* a few illustrative node pins per region, in lon/lat */
const REGION_PINS = {
  'North America': [[-118,34],[-96,41],[-79,44],[-74,40],[-104,39]],
  'UK & Ireland': [[-2,53],[-0.2,51.5],[-6,53]],
  'Europe': [[5,52]],
  'Middle East': [[55,25]],
  'Asia': [[104,1.4]],
  'Australia & New Zealand': [[151,-34],[145,-38],[175,-41]],
  'South America': []
};

/* mode 'print' → node counts per region. mode 'mill' → there is ONE verified node
   serving everywhere, so counting it per region would be a lie; regions show whether
   they are served today or getting their own cell next. */
function buildMap(mountId, onPick, mode){
  const mount = document.getElementById(mountId);
  if (!mount) return;
  const isMill = mode === 'mill';
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${MAP_W} ${MAP_H}`);
  svg.setAttribute('role', 'group');
  svg.setAttribute('aria-label', 'Choose your region on the map');

  /* Land, split per region. Keeping each region's dots in their own path is what lets a
     region light up its own landmass on hover, far better than drawing a box over it. */
  const inBox = (lat, lon) => Object.keys(REGION_BOX).find(n => {
    const b = REGION_BOX[n];
    return lon >= b.lon[0] && lon <= b.lon[1] && lat >= b.lat[0] && lat <= b.lat[1];
  }) || null;
  const dots = { world: '' };
  for (let lat = LAT_TOP; lat >= LAT_BOT; lat -= LAND_STEP){
    for (let lon = -180; lon < 180; lon += LAND_STEP){
      if (!isLand(lat, lon)) continue;
      const seg = `M${mapX(lon).toFixed(1)} ${mapY(lat).toFixed(1)}h0`;
      const r = inBox(lat, lon);
      if (r) dots[r] = (dots[r] || '') + seg; else dots.world += seg;
    }
  }
  const land = document.createElementNS(NS, 'g');
  land.setAttribute('class', 'map-land');
  land.setAttribute('aria-hidden', 'true');
  const landEls = {};
  Object.keys(dots).forEach(k => {
    if (!dots[k]) return;
    const pa = document.createElementNS(NS, 'path');
    pa.setAttribute('d', dots[k]);
    if (k !== 'world') landEls[k] = pa;
    land.appendChild(pa);
  });
  svg.appendChild(land);

  /* 'hot' follows the cursor, 'sel' sticks to the chosen region */
  const setHot = (name, on, cls) => {
    if (landEls[name]) landEls[name].classList.toggle(cls, on);
  };
  const clearSel = () => Object.values(landEls).forEach(el => el.classList.remove('is-sel'));

  /* regions */
  Object.keys(REGION_BOX).forEach(name => {
    const b = REGION_BOX[name];
    const x = mapX(b.lon[0]), y = mapY(b.lat[1]);
    const w = mapX(b.lon[1]) - x, h = mapY(b.lat[0]) - y;
    const count = NODE_COUNT[name] || 0;

    const millNext = MILL_PLAN[name] === 'next';
    const empty = isMill ? false : !count;
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'map-region' + (empty ? ' is-empty' : ''));
    g.setAttribute('tabindex', '0');
    g.setAttribute('role', 'button');
    g.setAttribute('data-region', name);
    g.setAttribute('aria-label', isMill
      ? `${name}: ${millNext ? 'served today, dedicated cell next' : 'served today'}`
      : `${name}: ${count ? count + ' certified node' + (count > 1 ? 's' : '') : 'founding nodes joining now'}`);

    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('class', 'map-hit');
    rect.setAttribute('x', x.toFixed(1)); rect.setAttribute('y', y.toFixed(1));
    rect.setAttribute('width', w.toFixed(1)); rect.setAttribute('height', h.toFixed(1));
    rect.setAttribute('rx', '8');
    g.appendChild(rect);

    /* pins are the print network's certified nodes; the mill hub has no per-region pins */
    (isMill ? [] : (REGION_PINS[name] || [])).forEach(p => {
      const cx = mapX(p[0]).toFixed(1), cy = mapY(p[1]).toFixed(1);
      const halo = document.createElementNS(NS, 'circle');
      halo.setAttribute('class', 'map-node-halo');
      halo.setAttribute('cx', cx); halo.setAttribute('cy', cy); halo.setAttribute('r', '5.4');
      g.appendChild(halo);
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('class', 'map-node');
      c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', '2.3');
      g.appendChild(c);
    });

    const cfg = REGION_LABEL[name] || {};
    const anchor = cfg.anchor || 'middle';
    const tx = (anchor === 'end' ? x : x + w / 2) + (cfg.dx || 0);
    const ty = y + h / 2 + (cfg.dy || 0);

    const label = document.createElementNS(NS, 'text');
    label.setAttribute('class', 'map-name');
    label.setAttribute('x', tx.toFixed(1)); label.setAttribute('y', ty.toFixed(1));
    label.setAttribute('text-anchor', anchor);
    label.textContent = cfg.short || (name === 'Australia & New Zealand' ? 'Australia & NZ' : name);
    g.appendChild(label);

    const pick = () => {
      svg.querySelectorAll('.map-region').forEach(r => r.classList.remove('is-active'));
      g.classList.add('is-active');
      clearSel(); setHot(name, true, 'is-sel');
      onPick(name);
    };
    ['mouseenter', 'focus'].forEach(e => g.addEventListener(e, () => setHot(name, true, 'is-hot')));
    ['mouseleave', 'blur'].forEach(e => g.addEventListener(e, () => setHot(name, false, 'is-hot')));
    g.addEventListener('click', pick);
    g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); pick(); } });
    svg.appendChild(g);
  });

  mount.innerHTML = '';
  mount.appendChild(svg);

  /* Chip widths vary by mode ('9' vs 'Cell next'), so a chip centred in a narrow box can
     hang over its neighbour. Pull anything that would fit back inside its own box, moving
     chip and label together so they stay aligned. Anything genuinely wider than its box
     (the 'Middle East' label) is left centred: overhanging evenly reads as map labelling,
     overhanging to one side reads as a mistake. */
  svg.querySelectorAll('.map-region').forEach(g => {
    const hit = g.querySelector('.map-hit');
    const bx = +hit.getAttribute('x'), bw = +hit.getAttribute('width');
    const movers = [g.querySelector('.map-name')].filter(Boolean);
    let shift = 0;
    movers.forEach(el => {
      const b = el.getBBox();
      if (b.width > bw) return;
      let s = 0;
      if (b.x < bx) s = bx - b.x;
      else if (b.x + b.width > bx + bw) s = (bx + bw) - (b.x + b.width);
      if (Math.abs(s) > Math.abs(shift)) shift = s;
    });
    if (shift) movers.forEach(el => el.setAttribute('x', (+el.getAttribute('x') + shift).toFixed(1)));
  });
  return svg;
}
function markMapRegion(region){
  document.querySelectorAll('.map-region').forEach(r => {
    r.classList.toggle('is-active', r.getAttribute('data-region') === region);
  });
}

/* ═══════════ find capacity: print ═══════════ */
let chosenRegion = '';

function onRegionPicked(region){
  chosenRegion = region;
  const step2 = document.getElementById('step2');
  const sel = document.getElementById('locCountry');
  const heading = document.getElementById('step2Region');
  if (heading) heading.textContent = region;
  if (sel){
    sel.innerHTML = '<option value="">Choose a country</option>';
    (REGIONS[region] || []).forEach(c => {
      const o = document.createElement('option'); o.value = c; o.textContent = c; sel.appendChild(o);
    });
    sel.disabled = false;
  }
  if (step2){
    step2.hidden = false;
    step2.scrollIntoView({ behavior:'smooth', block:'center' });
  }
}

function showMatches(){
  const country = (document.getElementById('locCountry') || {}).value || '';
  const town = ((document.getElementById('locTown') || {}).value || '').trim();
  const intro = document.getElementById('matchIntro');
  const grid = document.getElementById('capGrid');
  const step3 = document.getElementById('step3');
  if (!chosenRegion || !grid) return;

  saveLoc(chosenRegion, country, town);

  const all = PRINT_NODES[chosenRegion] || [];
  /* same country first: the thing Chris actually cares about is where the work lands */
  const nodes = all.slice().sort((a, b) => {
    const am = a.country === country ? 0 : 1, bm = b.country === country ? 0 : 1;
    if (am !== bm) return am - bm;
    return (a.country === country ? a.near : a.far) - (b.country === country ? b.near : b.far);
  }).slice(0, 3);

  const n = NODE_COUNT[chosenRegion];
  const place = town || country || chosenRegion;
  if (step3) step3.hidden = false;

  if (!nodes.length){
    const empty = (findCfg && findCfg.emptyState) || HUB_CONFIG.print.emptyState;
    const deskRef = (findCfg && findCfg.deskRef) || HUB_CONFIG.print.deskRef;
    intro.style.display = 'none';
    grid.innerHTML = `
      <div class="cap-empty" style="grid-column:1/-1">
        <h3>${escapeHtml(empty.heading)}</h3>
        <p>${escapeHtml(empty.body.replace('{region}', chosenRegion))}</p>
        <button class="btn btn-primary" onclick="openIntro('${escapeHtml(deskRef)} · ${escapeHtml(chosenRegion).toUpperCase()}','${escapeHtml(empty.cta)}')">${escapeHtml(empty.cta)}</button>
      </div>`;
    if (step3) step3.scrollIntoView({ behavior:'smooth', block:'nearest' });
    return;
  }

  intro.style.display = 'block';
  intro.innerHTML = `<b>${n} certified node${n > 1 ? 's' : ''} in ${escapeHtml(chosenRegion)}.</b> Nearest to ${escapeHtml(place)} first. Illustrative of live network capacity; an introduction confirms current availability.`;

  grid.innerHTML = nodes.map((o, i) => {
    const same = o.country === country;
    const miles = same ? o.near : o.far;
    const cross = (country && !same)
      ? `<span class="xborder"><span class="material-symbols-outlined" style="font-size:12px" aria-hidden="true">flag</span>Crosses a border</span>` : '';
    return `
    <div class="cap reveal" style="animation-delay:${i * 90}ms">
      <div class="cap__top">
        <span class="cap__opt">Option ${i + 1}</span>
        <span class="cap__badge">${escapeHtml(o.badge)}</span>
      </div>
      <h3>${escapeHtml(o.proc)}</h3>
      <dl>
        <div><dt>Distance</dt><dd>Within ~${miles} miles</dd></div>
        <div><dt>Country</dt><dd><span class="flag-row">${escapeHtml(o.country)}${cross}</span></dd></div>
        <div><dt>Materials</dt><dd>${escapeHtml(o.mat)}</dd></div>
        <div><dt>Price</dt><dd class="price">One standard network price</dd></div>
        <div><dt>Capacity</dt><dd>${escapeHtml(o.cap)}</dd></div>
        <div><dt>Minimum</dt><dd>${escapeHtml(o.min)}</dd></div>
      </dl>
      <button class="btn btn-primary" onclick="openIntro('PRINT HUB · OPTION ${i + 1} · ${escapeHtml(o.proc)}, ${escapeHtml(o.country)}','Ask us to introduce you')">Ask us to introduce you</button>
    </div>`;
  }).join('');
  if (step3) step3.scrollIntoView({ behavior:'smooth', block:'nearest' });
}

/* ═══════════ find capacity: mill ═══════════ */
function showMill(){
  const country = (document.getElementById('locCountry') || {}).value || '';
  const town = ((document.getElementById('locTown') || {}).value || '').trim();
  const out = document.getElementById('millResult');
  const step3 = document.getElementById('step3');
  if (!chosenRegion || !out) return;

  saveLoc(chosenRegion, country, town);
  if (step3) step3.hidden = false;

  const planned = MILL_PLAN[chosenRegion] === 'next';
  const place = town || country || chosenRegion;
  out.innerHTML = `
    <div id="matchIntro" style="margin-bottom:20px;font-size:14px;color:var(--on-surface)">
      <b>One verified node serves ${escapeHtml(place)} today.</b>
      ${planned
        ? `A dedicated cell for ${escapeHtml(chosenRegion)} is next in the roadmap. Until it opens, work runs from the verified node and ships to you.`
        : `Production is mirrored across cells on two continents, so a shutdown in one region never reaches your customers.`}
    </div>
    <div class="cap reveal" style="cursor:default;max-width:520px">
      <div class="cap__top">
        <span class="cap__opt">Mill node 01 · verified first-hand</span>
        <span class="cap__badge">Accepting introductions</span>
      </div>
      <h3>Established multi-site manufacturer, cells on two continents</h3>
      <dl>
        <div><dt>Products</dt><dd>Direct-milled &amp; moulded insoles</dd></div>
        <div><dt>Combined capacity</dt><dd>~1,000 pairs a day</dd></div>
        <div><dt>Finish</dt><dd>Coated, branded &amp; packaged to your standard</dd></div>
        <div><dt>Design work</dt><dd>Included where needed</dd></div>
        <div><dt>Serving</dt><dd>${escapeHtml(chosenRegion)}${planned ? ' · local cell next' : ''}</dd></div>
        <div><dt>Track record</dt><dd>Never closed, even through COVID</dd></div>
      </dl>
      <button class="btn btn-primary" onclick="openIntro('MILL NODE 01 · ${escapeHtml(chosenRegion).toUpperCase()}','Ask us to introduce you')">Ask us to introduce you</button>
      <div class="locked">
        <span class="label"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>Shared in a personal introduction only</span>
        <ul>
          <li>Partner identity &amp; facilities <span class="blurval">██████ ██████</span></li>
          <li>Per-pair pricing <span class="blurval">one standard network price</span></li>
          <li>Reference customers <span class="blurval">██████</span></li>
        </ul>
        <div class="note">Identities, pricing and references are never published. They are shared only when both sides agree to meet.</div>
      </div>
    </div>`;
  if (step3) step3.scrollIntoView({ behavior:'smooth', block:'nearest' });
}

/* ═══════════ find-page boot ═══════════ */
function initFindPage(){
  const mount = document.getElementById('mapMount');
  if (!mount) return;
  const isMill = document.body.dataset.hub === 'mill';
  buildMap('mapMount', onRegionPicked, isMill ? 'mill' : 'print');

  /* if they already told us where they are, pick up where they left off */
  const l = loadLoc();
  if (l && REGIONS[l.region]){
    onRegionPicked(l.region);
    markMapRegion(l.region);
    const cs = document.getElementById('locCountry'), ts = document.getElementById('locTown');
    if (cs && l.country) cs.value = l.country;
    if (ts && l.town) ts.value = l.town;
    if (l.country || l.town) isMill ? showMill() : showMatches();
  }
}

/* ?demo=match | ?demo=intro | ?demo=offer: pre-filled state for walkthroughs */
function runDemo(){
  const demo = new URLSearchParams(location.search).get('demo');
  if (!demo) return;
  if (document.getElementById('mapMount')){
    onRegionPicked('North America');
    markMapRegion('North America');
    const cs = document.getElementById('locCountry'), ts = document.getElementById('locTown');
    if (cs) cs.value = 'Canada';
    if (ts) ts.value = 'Toronto';
    document.body.dataset.hub === 'mill' ? showMill() : showMatches();
    if (demo === 'intro') openIntro('PRINT HUB · OPTION 1','Ask us to introduce you');
  }
}

/* The shared module starts this once its loader chain and the DOM are both
   ready - see bootPageModules in portal.js. */
window.NPFind = { init: function () { initFindPage(); runDemo(); } };

/* NexPoint User Portal v3 — shared behaviour. Front-end only: nothing is stored or sent.
   v3 (2026-08-15) rebuilds the location layer after Chris's 14 Aug review:
     · the map is the way in, not a dropdown list
     · capacity actually varies by region and by country
     · every card names its country, and flags when it is across a border
     · location is asked once and carried into every downstream form         */

function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* ═══════════ location, remembered ═══════════
   Chris, on being asked for his country a second time: "You've led me to an
   action… but you asked me to type my bloody country in again."             */
const LOC_KEY = 'np_loc';
function saveLoc(region, country, town){
  try { sessionStorage.setItem(LOC_KEY, JSON.stringify({ region, country, town })); } catch(e){}
}
function loadLoc(){
  try { const v = JSON.parse(sessionStorage.getItem(LOC_KEY)); return (v && v.region) ? v : null; } catch(e){ return null; }
}
function clearLoc(){
  try { sessionStorage.removeItem(LOC_KEY); } catch(e){}
  location.reload();
}
function locLabel(l){
  if (!l) return '';
  return [l.town, l.country || l.region].filter(Boolean).join(', ');
}

/* ═══════════ the network ═══════════ */
const REGIONS = {
  'North America': ['United States','Canada','Mexico'],
  'UK & Ireland': ['United Kingdom','Ireland'],
  'Europe': ['Spain','Germany','France','Netherlands','Italy','Poland'],
  'Middle East': ['Israel','United Arab Emirates','Saudi Arabia'],
  'Asia': ['Singapore','Japan','South Korea','India'],
  'Australia & New Zealand': ['Australia','New Zealand'],
  'South America': ['Brazil','Chile','Argentina','Colombia']
};
const NODE_COUNT = {
  'North America': 9, 'UK & Ireland': 4, 'Europe': 1,
  'Middle East': 1, 'Asia': 1, 'Australia & New Zealand': 5, 'South America': 0
};

/* Capacity is described by process and material, never by machine brand or model.
   Chris, 14 Aug: "I like the way that you are not promoting one company or one
   product… I don't want MultiJet. We don't know if MJF is going to work with us,
   HP. We don't know if anything's going to happen with Formlabs."
   `near` = miles when the member is in the same country as the node,
   `far`  = miles when they are elsewhere in the region.                      */
const PRINT_NODES = {
  'North America': [
    { proc:'SLS',                 mat:'Nylon 11 & Nylon 12',  cap:'1,000 pairs / month', min:'200 pairs / month', country:'United States', near:180, far:640,  badge:'High volume' },
    { proc:'Powder-bed fusion',   mat:'TPU & Nylon 12',       cap:'400 pairs / month',   min:'50 pairs / month',  country:'United States', near:260, far:820,  badge:'Multi-material' },
    { proc:'Resin',               mat:'Rigid & semi-rigid',   cap:'60 pairs / month',    min:'10 pairs / month',  country:'Canada',        near:210, far:700,  badge:'Small batch' },
    { proc:'SLS',                 mat:'Nylon 12 Tough',       cap:'250 pairs / month',   min:'40 pairs / month',  country:'Mexico',        near:190, far:900,  badge:'Onboarding · Nov 2026' }
  ],
  'UK & Ireland': [
    { proc:'SLS',                 mat:'Nylon 11',             cap:'600 pairs / month',   min:'100 pairs / month', country:'United Kingdom', near:90,  far:320, badge:'High volume' },
    { proc:'Powder-bed fusion',   mat:'TPU & Nylon 12',       cap:'300 pairs / month',   min:'40 pairs / month',  country:'United Kingdom', near:140, far:380, badge:'Multi-material' },
    { proc:'Resin',               mat:'Rigid & semi-rigid',   cap:'40 pairs / month',    min:'10 pairs / month',  country:'Ireland',        near:70,  far:290, badge:'Small batch' }
  ],
  'Europe': [
    { proc:'SLS',                 mat:'Nylon 12',             cap:'350 pairs / month',   min:'60 pairs / month',  country:'Netherlands',    near:120, far:560, badge:'Founding node' }
  ],
  'Middle East': [
    { proc:'SLS',                 mat:'Nylon 11',             cap:'200 pairs / month',   min:'40 pairs / month',  country:'United Arab Emirates', near:110, far:620, badge:'Founding node' }
  ],
  'Asia': [
    { proc:'Powder-bed fusion',   mat:'TPU & Nylon 12',       cap:'500 pairs / month',   min:'80 pairs / month',  country:'Singapore',      near:100, far:1400, badge:'Founding node' }
  ],
  'Australia & New Zealand': [
    { proc:'SLS',                 mat:'Nylon 11 & Nylon 12',  cap:'1,000 pairs / month', min:'200 pairs / month', country:'Australia',      near:250, far:1340, badge:'High volume' },
    { proc:'Resin',               mat:'Rigid & semi-rigid',   cap:'20 pairs / month',    min:'10 pairs / month',  country:'Australia',      near:420, far:1480, badge:'Small batch' },
    { proc:'SLS',                 mat:'Nylon 11',             cap:'30 pairs / month',    min:'10 pairs / month',  country:'New Zealand',    near:180, far:1340, badge:'Onboarding · Nov 2026' }
  ],
  'South America': []
};

/* The Mill Hub runs on one verified manufacturer with cells on two continents,
   so every region can be served today; two regions are getting their own cell. */
const MILL_PLAN = {
  'Europe': 'next',
  'Australia & New Zealand': 'next'
};

/* ═══════════ the map ═══════════
   Dot-matrix world drawn from the same land mask as the hero globe, so the map
   and the globe speak the same language. No external tiles, no libraries.     */
const LAND = [
  [[9,19],[23,28],[39,55]],
  [[3,6],[8,21],[23,29],[30,33],[37,57]],
  [[3,7],[8,22],[23,29],[29,34],[36,58]],
  [[4,7],[8,23],[25,28],[28,35],[36,58]],
  [[7,22],[28,29],[30,36],[37,58]],
  [[8,21],[29,36],[37,57]],
  [[9,21],[29,35],[36,54],[56,57]],
  [[9,21],[28,34],[40,47],[48,55],[56,57]],
  [[10,20],[28,40],[41,47],[48,55]],
  [[13,19],[28,41],[42,47],[48,54]],
  [[14,19],[28,41],[43,47],[49,53]],
  [[16,20],[28,41],[43,46],[49,54]],
  [[17,20],[27,41],[43,45],[50,55]],
  [[18,21],[27,40],[45,46],[50,56]],
  [[18,26],[29,40],[49,56]],
  [[17,27],[30,40],[50,56]],
  [[18,28],[31,39],[51,55]],
  [[18,28],[31,39],[50,57]],
  [[19,28],[32,38],[49,58]],
  [[19,27],[32,38],[49,58]],
  [[20,26],[33,37],[50,57]],
  [[20,25],[33,36],[51,56],[58,59]],
  [[21,25],[58,59]],
  [[21,24]]
];
function isLand(lat, lon){
  let row = Math.floor((90 - lat) / 180 * 24);
  let col = Math.floor((lon + 180) / 360 * 60);
  if (row < 0) row = 0; if (row > 23) row = 23;
  if (col < 0) col = 0; if (col > 59) col = 59;
  const segs = LAND[row];
  for (let i = 0; i < segs.length; i++) if (col >= segs[i][0] && col <= segs[i][1]) return true;
  return false;
}

const MAP_W = 720, MAP_H = 340, LAT_TOP = 84, LAT_BOT = -58;
function mapX(lon){ return (lon + 180) / 360 * MAP_W; }
function mapY(lat){ return (LAT_TOP - lat) / (LAT_TOP - LAT_BOT) * MAP_H; }

/* lon/lat bounds per region — deliberately non-overlapping so every click is unambiguous */
const REGION_BOX = {
  'North America':          { lon:[-168,-52], lat:[14,72]  },
  'South America':          { lon:[-84,-33],  lat:[-55,13] },
  'UK & Ireland':           { lon:[-11,2.5],  lat:[49,61]  },
  'Europe':                 { lon:[3,32],     lat:[35,62]  },
  'Middle East':            { lon:[33,62],    lat:[12,41]  },
  'Asia':                   { lon:[63,150],   lat:[3,56]   },
  'Australia & New Zealand':{ lon:[112,179],  lat:[-50,-9] }
};
/* UK & Ireland is only ~27px wide at this projection, so its label would sit on top of
   Europe's. It gets pushed out over the Atlantic instead, right-aligned to its own box. */
const REGION_LABEL = {
  'UK & Ireland': { anchor:'end', dx:-9, short:'UK & Ireland' }
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

  /* land */
  const land = document.createElementNS(NS, 'g');
  land.setAttribute('class', 'map-land');
  land.setAttribute('aria-hidden', 'true');
  let d = '';
  for (let lat = LAT_TOP; lat >= LAT_BOT; lat -= 2.6){
    for (let lon = -180; lon < 180; lon += 2.6){
      if (!isLand(lat, lon)) continue;
      const x = mapX(lon).toFixed(1), y = mapY(lat).toFixed(1);
      d += `M${x} ${y}m-1.05 0a1.05 1.05 0 1 0 2.1 0a1.05 1.05 0 1 0 -2.1 0`;
    }
  }
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', d);
  land.appendChild(path);
  svg.appendChild(land);

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
      ? `${name} — ${millNext ? 'served today, dedicated cell next' : 'served today'}`
      : `${name} — ${count ? count + ' certified node' + (count > 1 ? 's' : '') : 'founding nodes joining now'}`);

    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('class', 'map-hit');
    rect.setAttribute('x', x.toFixed(1)); rect.setAttribute('y', y.toFixed(1));
    rect.setAttribute('width', w.toFixed(1)); rect.setAttribute('height', h.toFixed(1));
    rect.setAttribute('rx', '8');
    g.appendChild(rect);

    /* pins are the print network's certified nodes; the mill hub has no per-region pins */
    (isMill ? [] : (REGION_PINS[name] || [])).forEach(p => {
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('class', 'map-node');
      c.setAttribute('cx', mapX(p[0]).toFixed(1));
      c.setAttribute('cy', mapY(p[1]).toFixed(1));
      c.setAttribute('r', '2.6');
      g.appendChild(c);
    });

    const cfg = REGION_LABEL[name] || {};
    const anchor = cfg.anchor || 'middle';
    const tx = (anchor === 'end' ? x : x + w / 2) + (cfg.dx || 0);
    const ty = y + h / 2 + (cfg.dy || 0);

    const num = document.createElementNS(NS, 'text');
    num.setAttribute('class', isMill ? 'map-status' + (millNext ? ' is-next' : '') : 'map-count');
    num.setAttribute('x', tx.toFixed(1)); num.setAttribute('y', (ty - 6).toFixed(1));
    num.setAttribute('text-anchor', anchor);
    num.textContent = isMill ? (millNext ? 'Cell next' : 'Served') : (count ? String(count) : '—');
    g.appendChild(num);

    const label = document.createElementNS(NS, 'text');
    label.setAttribute('class', 'map-name');
    label.setAttribute('x', tx.toFixed(1)); label.setAttribute('y', (ty + 16).toFixed(1));
    label.setAttribute('text-anchor', anchor);
    label.textContent = cfg.short || (name === 'Australia & New Zealand' ? 'Australia & NZ' : name);
    g.appendChild(label);

    const pick = () => {
      svg.querySelectorAll('.map-region').forEach(r => r.classList.remove('is-active'));
      g.classList.add('is-active');
      onPick(name);
    };
    g.addEventListener('click', pick);
    g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); pick(); } });
    svg.appendChild(g);
  });

  mount.innerHTML = '';
  mount.appendChild(svg);

  /* A count sitting bare on the map reads as decoration. Give each one a chip so it reads
     as data. Sized from the rendered text, so it fits '9' and 'Cell next' alike — which
     means it has to happen after the svg is in the document, or getBBox returns zeroes. */
  svg.querySelectorAll('.map-count,.map-status').forEach(txt => {
    const b = txt.getBBox(), padX = 9, padY = 5.5;
    const chip = document.createElementNS(NS, 'rect');
    chip.setAttribute('class', 'map-chip');
    chip.setAttribute('x', (b.x - padX).toFixed(1));
    chip.setAttribute('y', (b.y - padY).toFixed(1));
    chip.setAttribute('width', (b.width + padX * 2).toFixed(1));
    chip.setAttribute('height', (b.height + padY * 2).toFixed(1));
    chip.setAttribute('rx', ((b.height + padY * 2) / 2).toFixed(1));
    txt.parentNode.insertBefore(chip, txt);
  });
  return svg;
}
function markMapRegion(region){
  document.querySelectorAll('.map-region').forEach(r => {
    r.classList.toggle('is-active', r.getAttribute('data-region') === region);
  });
}

/* ═══════════ find capacity — print ═══════════ */
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
  /* same country first — the thing Chris actually cares about is where the work lands */
  const nodes = all.slice().sort((a, b) => {
    const am = a.country === country ? 0 : 1, bm = b.country === country ? 0 : 1;
    if (am !== bm) return am - bm;
    return (a.country === country ? a.near : a.far) - (b.country === country ? b.near : b.far);
  }).slice(0, 3);

  const n = NODE_COUNT[chosenRegion];
  const place = town || country || chosenRegion;
  if (step3) step3.hidden = false;

  if (!nodes.length){
    intro.style.display = 'none';
    grid.innerHTML = `
      <div class="cap-empty" style="grid-column:1/-1">
        <h3>Founding nodes are joining in ${escapeHtml(chosenRegion)} now.</h3>
        <p>Nothing certified in your region yet. Tell the desk what you need and we will route it through the nearest live node while ${escapeHtml(chosenRegion)} comes online.</p>
        <button class="btn btn-primary" onclick="openIntro('PRINT HUB · ${escapeHtml(chosenRegion).toUpperCase()}','Ask the desk to route your work')">Ask the desk to route your work</button>
      </div>`;
    if (step3) step3.scrollIntoView({ behavior:'smooth', block:'nearest' });
    return;
  }

  intro.style.display = 'block';
  intro.innerHTML = `<b>${n} certified node${n > 1 ? 's' : ''} in ${escapeHtml(chosenRegion)}.</b> Nearest to ${escapeHtml(place)} first. Illustrative of live network capacity — an introduction confirms current availability.`;

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
        <div><dt>Price</dt><dd class="price">US$35 + shipping</dd></div>
        <div><dt>Capacity</dt><dd>${escapeHtml(o.cap)}</dd></div>
        <div><dt>Minimum</dt><dd>${escapeHtml(o.min)}</dd></div>
      </dl>
      <button class="btn btn-primary" onclick="openIntro('PRINT HUB · OPTION ${i + 1} · ${escapeHtml(o.proc)}, ${escapeHtml(o.country)}','Ask us to introduce you')">Ask us to introduce you</button>
    </div>`;
  }).join('');
  if (step3) step3.scrollIntoView({ behavior:'smooth', block:'nearest' });
}

/* ═══════════ find capacity — mill ═══════════ */
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
        ? `A dedicated cell for ${escapeHtml(chosenRegion)} is next in the roadmap — until it opens, work runs from the verified node and ships to you.`
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
          <li>Per-pair pricing <span class="blurval">$██ per pair</span></li>
          <li>Reference customers <span class="blurval">██████</span></li>
        </ul>
        <div class="note">Identities, pricing and references are never published. They are shared only when both sides agree to meet.</div>
      </div>
    </div>`;
  if (step3) step3.scrollIntoView({ behavior:'smooth', block:'nearest' });
}

/* ═══════════ offer pages — never ask twice ═══════════ */
function initOfferPage(){
  const recall = document.getElementById('locRecall');
  if (!recall) return;
  const l = loadLoc();
  const cIn = document.getElementById('jCountry'), tIn = document.getElementById('jTown');
  const rSel = document.getElementById('jRegion');

  if (rSel){
    rSel.innerHTML = '<option value="">Choose a region</option>';
    Object.keys(REGIONS).forEach(r => {
      const o = document.createElement('option'); o.value = r; o.textContent = r; rSel.appendChild(o);
    });
  }
  if (l){
    if (rSel) rSel.value = l.region || '';
    if (cIn) cIn.value = l.country || '';
    if (tIn) tIn.value = l.town || '';
    recall.hidden = false;
    const txt = document.getElementById('locRecallText');
    if (txt) txt.innerHTML = `We already have you in <b>${escapeHtml(locLabel(l) || l.region)}</b> — carried over, so you don't type it twice.`;
  } else {
    recall.hidden = true;
  }
}

/* ═══════════ modals ═══════════ */
function openIntro(ref, heading){
  const l = loadLoc();
  const where = locLabel(l);
  const c = document.getElementById('introContent');
  c.innerHTML = `
    ${ref ? `<span class="ref">${escapeHtml(ref)}</span>` : ''}
    <h2>${escapeHtml(heading || 'Ask us to introduce you')}</h2>
    <p class="body">Two minutes, in confidence. One of us reads every request personally.</p>
    <form onsubmit="return introSubmit(event)">
      <div class="form-grid">
        <div class="field"><label for="iName">Your name</label><input id="iName" required placeholder="Full name"></div>
        <div class="field"><label for="iCompany">Company</label><input id="iCompany" required placeholder="Held in confidence"></div>
        <div class="field"><label for="iEmail">Email</label><input id="iEmail" type="email" required placeholder="you@company.com"></div>
        <div class="field"><label for="iMobile">Mobile (optional)</label><input id="iMobile" placeholder="+44"></div>
        <div class="field full"><label for="iWhere">Where you are</label><input id="iWhere" value="${escapeHtml(where)}" placeholder="Town, country"></div>
        <div class="field full"><label for="iNotes">What should we know?</label><textarea id="iNotes" placeholder="Volumes, systems, timing — anything that helps us weigh the fit"></textarea></div>
      </div>
      <div class="privacy"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5a8f1d" stroke-width="2" aria-hidden="true"><path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z"/><path d="M9 12l2 2 4-4"/></svg> Seen by NexPoint only. Never shared without your say-so. Introductions carry the network's simple terms, so both sides know where they stand.</div>
      <div class="modal-actions"><button class="btn btn-primary" type="submit">Request the introduction</button></div>
    </form>`;
  openOverlay('introOverlay');
}
function introSubmit(e){
  e.preventDefault();
  document.getElementById('introContent').innerHTML = `
    <div class="success">
      <div class="ok"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M4 12l6 6L20 6"/></svg></div>
      <h2>Received, in confidence.</h2>
      <p>Chris or Will reads every request personally — expect to hear from one of us within two working days. <br><br><em>(Draft note: nothing was actually sent.)</em></p>
      <div class="modal-actions" style="justify-content:center"><button class="btn btn-outline" onclick="closeAll()">Back to the portal</button></div>
    </div>`;
  return false;
}
function joinSubmit(e){
  e.preventDefault();
  document.getElementById('introContent').innerHTML = `
    <div class="success">
      <div class="ok"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M4 12l6 6L20 6"/></svg></div>
      <h2>Received, in confidence.</h2>
      <p>We'll confirm your account by email, then verify equipment, materials and standards with you directly. Founding places are limited to twenty laboratories. <br><br><em>(Draft note: nothing was actually sent.)</em></p>
      <div class="modal-actions" style="justify-content:center"><button class="btn btn-outline" onclick="closeAll()">Back to the portal</button></div>
    </div>`;
  openOverlay('introOverlay');
  return false;
}
function openSignIn(){ openOverlay('signOverlay'); }
function signMock(){
  document.getElementById('signContent').innerHTML = `
    <div class="success">
      <div class="ok"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M4 12l6 6L20 6"/></svg></div>
      <h2>Accounts arrive with the full build</h2>
      <p>In this draft the whole portal is open — no sign-in needed. In the full build, members land on a board already matched to their profile.</p>
      <div class="modal-actions" style="justify-content:center"><button class="btn btn-outline" onclick="closeAll()">Back to the portal</button></div>
    </div>`;
}
let lastFocus = null;
function openOverlay(id){
  lastFocus = document.activeElement;
  const ov = document.getElementById(id);
  ov.classList.add('open');
  document.body.style.overflow = 'hidden';
  const modal = ov.querySelector('.modal');
  if (modal){ modal.setAttribute('tabindex','-1'); modal.focus(); }
}
function closeAll(){
  document.querySelectorAll('.overlay').forEach(o => o.classList.remove('open'));
  document.body.style.overflow = '';
  if (lastFocus && lastFocus.focus){ lastFocus.focus(); lastFocus = null; }
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAll(); });

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

/* ?demo=match | ?demo=intro | ?demo=offer — pre-filled state for walkthroughs */
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

/* ═══════════ hero globe (landing only) — dotted Earth with live connection arcs ═══════════ */
(function initGlobe() {
  const canvas = document.getElementById('globeCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const reduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false;

  const TILT = -0.41;
  const cosT = Math.cos(TILT), sinT = Math.sin(TILT);
  let Lx = -0.55, Ly = 0.42, Lz = 0.72;
  const Ln = Math.hypot(Lx, Ly, Lz); Lx /= Ln; Ly /= Ln; Lz /= Ln;

  function toVec(lat, lon) {
    const la = lat * Math.PI / 180, lo = lon * Math.PI / 180;
    const x0 = Math.cos(la) * Math.sin(lo);
    const y0 = Math.sin(la);
    const z0 = Math.cos(la) * Math.cos(lo);
    return { x: x0, y: y0 * cosT - z0 * sinT, z: y0 * sinT + z0 * cosT };
  }

  const pts = [];
  for (let lat = -87; lat <= 87; lat += 3) {
    const cosLat = Math.cos(lat * Math.PI / 180);
    const step = 3 / Math.max(0.22, cosLat);
    for (let lon = -180; lon < 180; lon += step) {
      const v = toVec(lat, lon);
      v.land = isLand(lat, lon);
      pts.push(v);
    }
  }

  const HUBS = [
    { lat: 40, lon: -96 }, { lat: 54, lon: -2 }, { lat: 50, lon: 12 },
    { lat: 25, lon: 45 }, { lat: 28, lon: 112 }, { lat: -25, lon: 134 }, { lat: -41, lon: 173 },
  ].map(h => toVec(h.lat, h.lon));

  function slerp(a, b, t) {
    let d = a.x * b.x + a.y * b.y + a.z * b.z;
    d = Math.max(-1, Math.min(1, d));
    const om = Math.acos(d);
    if (om < 1e-4) return { x: a.x, y: a.y, z: a.z };
    const s = Math.sin(om), w1 = Math.sin((1 - t) * om) / s, w2 = Math.sin(t * om) / s;
    return { x: a.x * w1 + b.x * w2, y: a.y * w1 + b.y * w2, z: a.z * w1 + b.z * w2 };
  }

  let W = 0, H = 0, cx = 0, cy = 0, R = 0, dpr = 1;
  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = rect.width; H = rect.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx = W / 2; cy = H / 2; R = Math.min(W, H) * 0.44;
  }

  const arcs = [];
  let lastSpawn = 0;

  function spawnArc(now) {
    if (arcs.length >= 4) return;
    const front = [];
    for (let i = 0; i < HUBS.length; i++) if (HUBS[i]._z > 0.22) front.push(i);
    if (front.length < 2) return;
    const i = front[(Math.random() * front.length) | 0];
    let j = front[(Math.random() * front.length) | 0], guard = 0;
    while (j === i && guard++ < 6) j = front[(Math.random() * front.length) | 0];
    if (i === j) return;
    const A = HUBS[i], B = HUBS[j];
    if (A.x * B.x + A.y * B.y + A.z * B.z < 0) return;
    arcs.push({ a: i, b: j, t0: now, dur: 2600 });
  }

  function frame(now, rot) {
    if (!W) return;
    const cosA = Math.cos(rot), sinA = Math.sin(rot);
    const edge = Math.min(W, H) * 0.5;
    ctx.clearRect(0, 0, W, H);

    const atmo = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, edge);
    atmo.addColorStop(0, 'rgba(61,142,235,0)');
    atmo.addColorStop(0.8, 'rgba(61,142,235,0)');
    atmo.addColorStop(0.93, 'rgba(61,142,235,0.18)');
    atmo.addColorStop(1, 'rgba(61,142,235,0)');
    ctx.fillStyle = atmo; ctx.beginPath(); ctx.arc(cx, cy, edge, 0, Math.PI * 2); ctx.fill();

    const body = ctx.createRadialGradient(cx - R * 0.4, cy - R * 0.44, R * 0.1, cx, cy, R);
    body.addColorStop(0, 'rgba(32,60,98,0.68)');
    body.addColorStop(0.6, 'rgba(12,26,48,0.5)');
    body.addColorStop(1, 'rgba(5,10,20,0.32)');
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fillStyle = body; ctx.fill();

    for (let k = 0; k < pts.length; k++) {
      const p = pts[k];
      const z2 = -p.x * sinA + p.z * cosA;
      if (z2 <= 0) continue;
      const x2 = p.x * cosA + p.z * sinA, y2 = p.y;
      let nl = x2 * Lx + y2 * Ly + z2 * Lz;
      if (nl < 0) nl = 0;
      const b = (0.12 + 0.88 * nl) * (0.30 + 0.70 * z2);
      const sx = cx + x2 * R, sy = cy - y2 * R;
      if (p.land) {
        ctx.fillStyle = 'rgba(139,197,63,' + (0.16 + 0.74 * b) + ')';
        const s = 1.0 + 1.5 * b;
        ctx.fillRect(sx - s / 2, sy - s / 2, s, s);
      } else {
        ctx.fillStyle = 'rgba(86,150,224,' + (0.03 + 0.17 * b) + ')';
        ctx.fillRect(sx - 0.6, sy - 0.6, 1.2, 1.2);
      }
    }

    for (let i = 0; i < HUBS.length; i++) {
      const h = HUBS[i];
      h._z = -h.x * sinA + h.z * cosA;
      h._sx = cx + (h.x * cosA + h.z * sinA) * R;
      h._sy = cy - h.y * R;
    }

    for (let ai = arcs.length - 1; ai >= 0; ai--) {
      const arc = arcs[ai];
      const life = (now - arc.t0) / arc.dur;
      if (life >= 1) { arcs.splice(ai, 1); continue; }
      const A = HUBS[arc.a], B = HUBS[arc.b];
      const env = life < 0.15 ? life / 0.15 : life > 0.7 ? (1 - life) / 0.3 : 1;
      const drawTo = Math.min(1, life / 0.35);
      let started = false;
      ctx.beginPath();
      for (let s = 0; s <= 40; s++) {
        const t = s / 40;
        if (t > drawTo) break;
        const sp = slerp(A, B, t);
        if (-sp.x * sinA + sp.z * cosA < -0.08) break;
        const lift = 1 + 0.42 * Math.sin(Math.PI * t);
        const sx = cx + (sp.x * lift * cosA + sp.z * lift * sinA) * R;
        const sy = cy - sp.y * lift * R;
        if (!started) { ctx.moveTo(sx, sy); started = true; } else ctx.lineTo(sx, sy);
      }
      ctx.strokeStyle = 'rgba(61,142,235,' + (0.62 * env) + ')';
      ctx.lineWidth = 1.6; ctx.stroke();

      if (life > 0.2 && life < 0.95) {
        const pt = Math.min(1, (life - 0.2) / 0.72);
        const sp = slerp(A, B, pt);
        if (-sp.x * sinA + sp.z * cosA >= -0.08) {
          const lift = 1 + 0.42 * Math.sin(Math.PI * pt);
          const sx = cx + (sp.x * lift * cosA + sp.z * lift * sinA) * R;
          const sy = cy - sp.y * lift * R;
          ctx.save();
          ctx.shadowBlur = 11; ctx.shadowColor = 'rgba(139,197,63,0.9)';
          ctx.fillStyle = '#9CD850';
          ctx.beginPath(); ctx.arc(sx, sy, 2.8, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }
      }
    }

    for (let i = 0; i < HUBS.length; i++) {
      const h = HUBS[i];
      if (h._z <= 0.05) continue;
      const a = 0.32 + 0.68 * h._z;
      const pulse = ((now / 1000 + i * 0.5) % 2.6) / 2.6;
      ctx.strokeStyle = 'rgba(139,197,63,' + (0.5 * (1 - pulse) * a) + ')';
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(h._sx, h._sy, 3.2 + pulse * 10, 0, Math.PI * 2); ctx.stroke();
      ctx.save();
      ctx.shadowBlur = 9; ctx.shadowColor = 'rgba(139,197,63,0.95)';
      ctx.fillStyle = 'rgba(156,216,80,' + a + ')';
      ctx.beginPath(); ctx.arc(h._sx, h._sy, 3.2, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  resize();

  if (reduce) {
    const drawStatic = () => {
      resize();
      arcs.length = 0;
      arcs.push({ a: 1, b: 0, t0: 200, dur: 2600 });
      arcs.push({ a: 2, b: 4, t0: 200, dur: 2600 });
      frame(1500, 0.35);
    };
    drawStatic();
    window.addEventListener('resize', drawStatic);
    if (window.ResizeObserver) new ResizeObserver(drawStatic).observe(canvas);
    return;
  }

  let raf = 0, running = false, rotation = 0.35, lastT = null;
  const ROT_SPEED = (2 * Math.PI) / 52000;
  function loop(ts) {
    if (lastT == null) lastT = ts;
    rotation += ROT_SPEED * (ts - lastT); lastT = ts;
    if (ts - lastSpawn > 950) { spawnArc(ts); lastSpawn = ts; }
    frame(ts, rotation);
    if (running) raf = requestAnimationFrame(loop);
  }
  function start() { if (running) return; running = true; lastT = null; raf = requestAnimationFrame(loop); }
  function stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }

  window.addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
  if (window.IntersectionObserver) {
    new IntersectionObserver((ents) => { ents.forEach(e => e.isIntersecting ? start() : stop()); }, { threshold: 0.05 }).observe(canvas);
  } else { start(); }
  document.addEventListener('visibilitychange', () => { document.hidden ? stop() : start(); });
})();

/* ═══════════ entrances (ported verbatim from the live site) ═══════════ */
(function initEntrances(){
  const root = document.documentElement;
  const reduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false;
  if (!reduce && 'IntersectionObserver' in window) {
    root.classList.add('js-motion');
    const io = new IntersectionObserver((entries, obs) => {
      entries.forEach(en => {
        if (en.isIntersecting) { en.target.classList.add('is-in'); obs.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.15 });
    document.querySelectorAll('.enter').forEach(el => io.observe(el));
  }
})();

document.addEventListener('DOMContentLoaded', () => { initFindPage(); initOfferPage(); runDemo(); });

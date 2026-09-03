/* NexPoint Global Hub v3 — shared behaviour.
   v3 (2026-08-15) rebuilds the location layer after Chris's 14 Aug review:
     · the map is the way in, not a dropdown list
     · capacity actually varies by region and by country
     · every card names its country, and flags when it is across a border
     · location is asked once and carried into every downstream form
   2026-09-01: the desk forms are live — submissions post to the capture
   worker's /requests route and land in the web_requests queue.            */

function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* ═══════════ live capture — the Cloudflare worker's /requests route ═══════════ */
/* Live capture endpoint (deployed 2026-09-01) —
   `npx wrangler deploy` (Plan B Task 3 Step 4). The forms fail safe (error
   message + button re-enabled) until this points at the deployed worker.
   2026-09-02: shares the accounts API host (Task 7), so anonymous submissions
   and signed-in requests land on the same worker. */
const API_BASE = /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
  ? 'http://localhost:8787' : 'https://api.nexpoint.co.uk';
const CAPTURE_REQUESTS_URL = API_BASE + '/requests';

function hubOfPage(){
  const h = location.hostname;
  if (h.startsWith('printhub')) return 'print';
  if (h.startsWith('millhub')) return 'mill';
  if (h.startsWith('opportunities')) return 'opportunities';
  /* local preview / pre-cutover paths: */
  if (location.pathname.includes('print')) return 'print';
  if (location.pathname.includes('mill')) return 'mill';
  return 'print';
}

function serializeForm(form){
  const out = {};
  form.querySelectorAll('input, textarea, select').forEach(el => {
    if (!el.id || el.type === 'submit') return;
    out[el.id] = el.value.trim();
  });
  return out;
}

async function sendRequest(body, onOk, onFail){
  try {
    const r = await fetch(CAPTURE_REQUESTS_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'include', body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok && data.ok) onOk(); else onFail();
  } catch { onFail(); }
}

function formSendingState(form){
  const btn = form.querySelector('button[type="submit"]');
  const orig = btn ? btn.textContent : '';
  if (btn){ btn.disabled = true; btn.textContent = 'Sending your request'; }
  return { btn, orig };
}

function formFailState(form, { btn, orig }){
  if (btn){ btn.disabled = false; btn.textContent = orig; }
  let err = form.querySelector('.form-error');
  if (!err){
    err = document.createElement('p');
    err.className = 'form-error';
    err.style.cssText = 'color:#E5484D;font-size:13px;margin-top:10px';
    form.appendChild(err);
  }
  err.textContent = 'That did not go through — please try again, or email hello@nexpoint.co.uk.';
}

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
/* Zero everywhere, deliberately (Will, 2026-09-01): no print node is verified
   yet, and the map must never claim capacity that does not exist. Real counts
   return here as real nodes are certified. */
const NODE_COUNT = {
  'North America': 0, 'UK & Ireland': 0, 'Europe': 0,
  'Middle East': 0, 'Asia': 0, 'Australia & New Zealand': 0, 'South America': 0
};

/* Capacity is described by process and material, never by machine brand or model.
   Chris, 14 Aug: "I like the way that you are not promoting one company or one
   product… I don't want MultiJet. We don't know if MJF is going to work with us,
   HP. We don't know if anything's going to happen with Formlabs."
   `near` = miles when the seeker is in the same country as the node,
   `far`  = miles when they are elsewhere in the region.                      */
const PRINT_NODES = {};  /* placeholder listings removed 2026-09-01 — entries return only for first-hand-verified nodes */

const MILL_PLAN = {
  'Europe': 'next',
  'Australia & New Zealand': 'next'
};

/* ═══════════ the map ═══════════
   Dot-matrix world drawn from the same land mask as the hero globe, so the map
   and the globe speak the same language. No external tiles, no libraries.     */
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

const MAP_W = 720, MAP_H = 340, LAT_TOP = 84, LAT_BOT = -58;
function mapX(lon){ return (lon + 180) / 360 * MAP_W; }
function mapY(lat){ return (LAT_TOP - lat) / (LAT_TOP - LAT_BOT) * MAP_H; }

/* lon/lat bounds per region — deliberately non-overlapping so every click is unambiguous */
const REGION_BOX = {
  'North America':          { lon:[-168,-52], lat:[14,72]  },
  'South America':          { lon:[-84,-33],  lat:[-55,13] },
  'UK & Ireland':           { lon:[-44,2.5],  lat:[49,61]  },
  'Europe':                 { lon:[3,32],     lat:[35,62]  },
  'Middle East':            { lon:[33,62],    lat:[12,41]  },
  'Asia':                   { lon:[63,150],   lat:[3,56]   },
  'Australia & New Zealand':{ lon:[112,179],  lat:[-50,-9] }
};
/* UK & Ireland is only ~27px of coastline at this projection — too narrow to hold its own
   label or to be a fair click target. Its box is extended west into empty Atlantic so the
   label and count sit inside it, the way an inset callout does. No other region reaches there. */
const REGION_LABEL = {
  /* the box reaches out to New Zealand, so its centre lands in the Coral Sea — pull the
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
     region light up its own landmass on hover — far better than drawing a box over it. */
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
     (the 'Middle East' label) is left centred — overhanging evenly reads as map labelling,
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
        <h3>Founding print nodes are joining the network now.</h3>
        <p>No node is certified in ${escapeHtml(chosenRegion)} yet — every node is verified first-hand before it appears here. Tell the desk what you need and you will be matched the moment capacity comes online.</p>
        <button class="btn btn-primary" onclick="openIntro('PRINT HUB · ${escapeHtml(chosenRegion).toUpperCase()}','Tell the desk what you need')">Tell the desk what you need</button>
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
        <div><dt>Price</dt><dd class="price">One standard network price</dd></div>
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
          <li>Per-pair pricing <span class="blurval">one standard network price</span></li>
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

  /* Signed-in hosts never retype what's already on their profile.
     The listener is registered unconditionally — it's a plain document event
     that needs nothing loaded — because on the subdomain pages hub-account.js
     arrives via an async, dynamically-injected loader that can land after
     DOMContentLoaded. If we gated the listener behind `window.NPAccount`, a
     late-loading module would never get subscribed and a signed-in host's
     profile would silently never prefill. The module always dispatches
     npaccount:change after its initial /auth/me refresh, so a late load is
     still caught; ready.then covers the case where it was already loaded and
     resolved by the time we get here. fillProfile no-ops without a user. */
  const fillProfile = () => {
    const u = window.NPAccount && NPAccount.user; if (!u) return;
    const set = (id, v) => { const el = document.getElementById(id); if (el && !el.value && v) el.value = v; };
    set('jName', u.name); set('jCompany', u.company); set('jEmail', u.email);
    set('jCountry', u.country); set('jTown', u.town);
  };
  document.addEventListener('npaccount:change', fillProfile);
  if (window.NPAccount) NPAccount.ready.then(fillProfile);
}

/* ═══════════ modals ═══════════ */
function openIntro(ref, heading){
  if (window.NPAccount && typeof NPAccount.gate === 'function'){
    NPAccount.gate({ hub: hubOfPage(), side: ref ? 'request_intro' : 'request_capacity',
      brief_ref: ref || '', heading: heading || 'Ask us to introduce you', payload: {} });
    return;
  }
  /* fallback: original anonymous desk form, unchanged below */
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
  const form = e.target;
  const fields = serializeForm(form);
  const state = formSendingState(form);
  const ref = (document.querySelector('#introContent .ref') || {}).textContent || '';
  sendRequest({
    hub: hubOfPage(),
    side: ref ? 'request_intro' : 'request_capacity',
    company: fields.iCompany || '', contact_name: fields.iName || '',
    email: fields.iEmail || '', phone: fields.iMobile || '',
    location: fields.iWhere || '', brief_ref: ref,
    payload: { notes: fields.iNotes || '' }, company_url: '',
  }, () => {
    document.getElementById('introContent').innerHTML = `
      <div class="success">
        <div class="ok"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M4 12l6 6L20 6"/></svg></div>
        <h2>Received, in confidence.</h2>
        <p>Chris or Will reads every request personally — expect to hear from one of us within two working days.</p>
        <div class="modal-actions" style="justify-content:center"><button class="btn btn-outline" onclick="closeAll()">Back to the Global Hub</button></div>
      </div>`;
  }, () => {
    formFailState(form, state);
  });
  return false;
}
function openEducationList(){
  const c = document.getElementById('introContent');
  c.innerHTML = `
    <h2>Put me on the Education Hub list</h2>
    <p class="body">Name and email — nothing else. We'll write when the first courses open.</p>
    <form onsubmit="return eduSubmit(event)">
      <div class="form-grid" style="grid-template-columns:1fr">
        <div class="field"><label for="eName">Your name</label><input id="eName" required placeholder="Full name"></div>
        <div class="field"><label for="eEmail">Email</label><input id="eEmail" type="email" required placeholder="you@company.com"></div>
      </div>
      <div class="modal-actions"><button class="btn btn-primary" type="submit">Put me on the list</button></div>
    </form>`;
  openOverlay('introOverlay');
}
function eduSubmit(e){
  e.preventDefault();
  const form = e.target, fields = serializeForm(form), state = formSendingState(form);
  sendRequest({ hub: 'education', side: 'join_list', company: '', contact_name: fields.eName || '',
    email: fields.eEmail || '', phone: '', location: '', brief_ref: '', payload: {}, company_url: '' },
  () => {
    document.getElementById('introContent').innerHTML = `
      <div class="success">
        <div class="ok"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M4 12l6 6L20 6"/></svg></div>
        <h2>You're on the list.</h2>
        <p>We'll write the moment the first courses open — nothing else lands in your inbox.</p>
        <div class="modal-actions" style="justify-content:center"><button class="btn btn-outline" onclick="closeAll()">Back to the Global Hub</button></div>
      </div>`;
  }, () => formFailState(form, state));
  return false;
}
function joinSubmit(e){
  e.preventDefault();
  const form = e.target;
  const fields = serializeForm(form);
  const state = formSendingState(form);
  sendRequest({
    hub: hubOfPage(),
    side: 'offer_capacity',
    company: fields.jCompany || '', contact_name: fields.jName || '',
    email: fields.jEmail || '', phone: '',
    location: [fields.jTown, fields.jCountry].filter(Boolean).join(', ') || (fields.jRegion || ''),
    brief_ref: '',
    payload: {
      website: fields.jWebsite || '', region: fields.jRegion || '',
      machines: fields.jPrinters || '', capacity: fields.jCapacity || '',
      notes: fields.jNotes || '',
    },
    company_url: '',
  }, () => {
    document.getElementById('introContent').innerHTML = `
      <div class="success">
        <div class="ok"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M4 12l6 6L20 6"/></svg></div>
        <h2>Received, in confidence.</h2>
        <p>We'll confirm your account by email, then verify equipment, materials and standards with you directly. Founding places are limited to twenty laboratories.</p>
        <div class="modal-actions" style="justify-content:center"><button class="btn btn-outline" onclick="closeAll()">Back to the Global Hub</button></div>
      </div>`;
    openOverlay('introOverlay');
  }, () => {
    formFailState(form, state);
  });
  return false;
}
function openSignIn(){ openOverlay('signOverlay'); }
async function signSubmit(){
  const email = (document.getElementById('sEmail') || {}).value || '';
  const pass = (document.getElementById('sPass') || {}).value || '';
  const err = document.querySelector('#signContent .np-sign-error');
  if (!window.NPAccount){ if (err){ err.style.display = 'block'; err.textContent = 'Accounts are briefly unavailable — email hello@nexpoint.co.uk and we will help directly.'; } return; }
  const d = await NPAccount.signIn(email.trim(), pass);
  if (d.ok){
    document.getElementById('signContent').innerHTML = `
      <div class="success">
        <div class="ok"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M4 12l6 6L20 6"/></svg></div>
        <h2>Welcome back, ${escapeHtml((NPAccount.user && (NPAccount.user.name || NPAccount.user.email)) || '')}.</h2>
        <p>You're signed in across every hub. Requests you make now arrive with your profile attached.</p>
        <div class="modal-actions" style="justify-content:center"><button class="btn btn-outline" onclick="closeAll()">Back to the Global Hub</button></div>
      </div>`;
  } else if (err){
    err.style.display = 'block';
    err.textContent = d.error === 'network'
      ? 'That didn\'t send — check your connection and try again.'
      : 'That email and password don\'t match an account. Check them, or create your hub account below.';
  }
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

/* Flip every .enter inside a container on the same frame. Shared, so the scroll observer
   and the hero handoff can each fire a group at the moment they choose, and so firing
   twice is harmless. */
function fireEnterGroup(el){
  if (!el || el.dataset.entered) return;
  el.dataset.entered = '1';
  if (el.classList.contains('enter')) el.classList.add('is-in');
  el.querySelectorAll('.enter').forEach(n => n.classList.add('is-in'));
}

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

    /* A grid fires as one unit. Observing each card separately meant the top row of a 2x2
       crossed the threshold long before the bottom row, and each card then added its own
       --d on top — two ragged waves instead of one sequence. Grouped, every card flips on
       the same frame and --d alone spaces them, so the stagger is the same every time.
       threshold 0 with a bottom margin keys off the container's top edge, which stays
       predictable however tall the group is. */
    const wideEnough = window.matchMedia('(min-width:961px)').matches;
    document.querySelectorAll('[data-enter-group]').forEach(group => {
      if (wideEnough && group.hasAttribute('data-enter-handoff')) return;
      new IntersectionObserver((entries, obs) => {
        entries.forEach(en => {
          if (!en.isIntersecting) return;
          obs.unobserve(en.target);
          fireEnterGroup(en.target);
        });
      }, { rootMargin: '0px 0px -60% 0px', threshold: 0 }).observe(group);
    });

    /* everything outside a group keeps the per-element behaviour */
    document.querySelectorAll('.enter').forEach(el => {
      if (el.closest('[data-enter-group]')) return;
      io.observe(el);
    });
  }
})();

document.addEventListener('DOMContentLoaded', () => { initFindPage(); initOfferPage(); runDemo(); });

/* ═══════════ hero handoff — the globe launches, the doors take the frame ═══════════
   Progress is derived from scrollY alone (no per-frame layout reads), written once per
   rAF into custom properties that CSS turns into transform/opacity/filter. Nothing here
   animates a layout property, so the whole sequence stays on the compositor. */
(function initHeroHandoff(){
  const root  = document.documentElement;
  const stage = document.querySelector('.hero-stage');
  const nextSection = document.querySelector('.hero-next');
  const head  = document.querySelector('header');
  if (!stage || !nextSection || !root.classList.contains('js-motion')) return;

  const wide = window.matchMedia('(min-width:961px)');
  const still = window.matchMedia('(prefers-reduced-motion:reduce)');
  const VARS = ['--copy-o','--globe-y','--globe-s','--globe-b','--globe-o'];

  let span = 1, queued = false, live = false, wasFlying = false;

  const clamp  = v => v < 0 ? 0 : v > 1 ? 1 : v;
  /* smoothstep: eases both ends of a fade so nothing snaps on or off */
  const ramp   = (v, a, b) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };

  function measure(){
    const h = head ? head.offsetHeight : 0;
    root.style.setProperty('--header-h', h + 'px');
    /* distance from rest to the doors meeting the header — the whole handoff */
    span = Math.max(1, nextSection.getBoundingClientRect().top + window.scrollY - h);
  }

  function frame(){
    queued = false;
    const p = clamp(window.scrollY / span);
    const g = p * p;                 /* squared: it accelerates away rather than drifting */
    const s = stage.style;
    s.setProperty('--copy-o',  (1 - ramp(p, .05, .62)).toFixed(3));
    s.setProperty('--globe-y', (-g * 155).toFixed(2) + 'vh');
    s.setProperty('--globe-s', (1 - g * .18).toFixed(3));
    s.setProperty('--globe-b', (ramp(p, .22, 1) * 6).toFixed(2) + 'px');
    s.setProperty('--globe-o', (1 - ramp(p, .12, .72)).toFixed(3));

    /* Only what is in frame when the hero gives way belongs to the handoff. Bands further
       down earn their own entrance from the scroll observer, or they would play unseen. */
    if (p >= .5) nextSection.querySelectorAll('[data-enter-handoff]').forEach(fireEnterGroup);

    const flying = p > 0 && p < 1;
    if (flying !== wasFlying){ stage.classList.toggle('is-flight', flying); wasFlying = flying; }
  }

  function clear(){
    VARS.forEach(k => stage.style.removeProperty(k));
    stage.classList.remove('is-flight');
    wasFlying = false;
  }

  function onScroll(){ if (live && !queued){ queued = true; requestAnimationFrame(frame); } }

  function sync(){
    live = wide.matches && !still.matches;
    if (live){ measure(); frame(); return; }
    /* handoff is off (narrow, or reduced motion switched on mid-session). It owns the
       doors' entrance, so hand it back rather than leaving them hidden forever. */
    clear();
    nextSection.querySelectorAll('[data-enter-handoff]').forEach(fireEnterGroup);
  }

  addEventListener('scroll', onScroll, { passive:true });
  addEventListener('resize', sync,     { passive:true });
  const watch = (mq, fn) => mq.addEventListener ? mq.addEventListener('change', fn) : mq.addListener(fn);
  watch(wide, sync); watch(still, sync);
  /* images settle after load and can move the doors; re-measure once they have */
  addEventListener('load', sync);
  sync();
})();

/* NexPoint Global Hub - the shared portal module.
   One copy, served from the apex at /hub/assets/portal.js. Every hub page
   loads this file, the subdomains by absolute URL, so printhub and millhub
   run exactly the code the Global Hub runs. It carries only what every page
   needs: which hub the page belongs to, the desk forms, the sign-in modal,
   the overlays, the globe and the entrances. Anything that belongs to one
   page lives in that page's own module and is started from the boot at the
   bottom.
   2026-09-07: the three forked copies (hub, printhub, millhub) were collapsed
   into this one, and the placeholder capacity map moved out to the find
   page's own module ahead of the find rebuild.                            */

function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* live capture + accounts share one API host (Task 7). The forms fail safe
   (error message + button re-enabled) if it is unreachable. */
const API_BASE = /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
  ? 'http://localhost:8787' : 'https://api.nexpoint.co.uk';
const CAPTURE_REQUESTS_URL = API_BASE + '/requests';

/* One page, one hub. The page declares it on <body data-hub>, so nothing has
   to read the hostname twice or guess from a path. HUB_CONFIG is the only
   place a hub's own words live: the fork these three files used to be was
   three copies of one module differing in a label and an empty state. */
const HUB = document.body.dataset.hub || '';
const HUB_CONFIG = {
  print: {
    label: 'Global Print Hub',
    deskRef: 'PRINT HUB',
    machineNoun: 'printer',
    siteNoun: 'site',
    emptyState: {
      heading: 'Founding print nodes are joining the network now.',
      body: 'No node is certified in {region} yet. Every node is verified first-hand before it appears here. Tell the desk what you need and you will be matched the moment capacity comes online.',
      cta: 'Tell the desk what you need',
    },
  },
  mill: {
    label: 'Global Mill Hub',
    deskRef: 'MILL HUB',
    machineNoun: 'milling cell',
    siteNoun: 'cell',
    emptyState: {
      heading: 'Founding milling cells are joining the network now.',
      body: 'No cell is certified in {region} yet. Every cell is verified first-hand before it appears here. Tell the desk what you need and you will be matched the moment capacity comes online.',
      cta: 'Tell the desk what you need',
    },
  },
};
function hubConfig(){ return HUB_CONFIG[HUB] || null; }

function hubOfPage(){
  if (HUB) return HUB;
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
  err.textContent = 'That did not go through. Please try again, or email hello@nexpoint.co.uk.';
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
function locLabel(l){
  if (!l) return '';
  return [l.town, l.country || l.region].filter(Boolean).join(', ');
}

/* ═══════════ the shared fetch ═══════════
   Every page module talks to the worker through this: cookies travel, the
   body comes back parsed, and a dropped connection is an error value rather
   than an exception nobody caught. An acting route refuses an unconfirmed
   account with 403 {error:"email_unconfirmed"}; that is handed straight back
   so the caller can put the confirm card up instead of a generic failure.
   An error body also carries http_status, because "this route is not
   deployed yet" (404) and "this route refused me" read the same otherwise,
   and a page that falls back on 404 has to be able to tell them apart. */
async function npApi(path, opts){
  let r;
  try {
    r = await fetch(API_BASE + path, Object.assign({ credentials: 'include' }, opts || {}));
  } catch (e) { return { error: 'network' }; }
  const d = await r.json().catch(() => ({}));
  if (r.ok) return d;
  return (d && d.error)
    ? Object.assign({ http_status: r.status }, d)
    : { error: 'http_' + r.status, http_status: r.status };
}

/* ═══════════ the terms reader ═══════════
   Markdown as the worker serves it, in the small subset of HTML a terms
   scroll needs: headings, bullets, paragraphs and the two inline marks.
   One copy for the three pages that render a terms layer - the find flow,
   the listing form and the provider's accept page - because three copies
   of a reader that turns text into markup is three places for one of them
   to stop escaping first. Escaped first it is: nothing a terms body
   carries can arrive as markup of its own.                              */
function markdownLite(md){
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
  let html = '', inList = false;
  const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
  const inline = (s) => escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>');
  lines.forEach((raw) => {
    const line = raw.trim();
    if (!line) { closeList(); return; }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) { closeList(); const lvl = Math.min(h[1].length + 2, 6); html += '<h' + lvl + '>' + inline(h[2]) + '</h' + lvl + '>'; return; }
    const li = /^[-*]\s+(.*)$/.exec(line);
    if (li) { if (!inList) { html += '<ul>'; inList = true; } html += '<li>' + inline(li[1]) + '</li>'; return; }
    closeList();
    html += '<p>' + inline(line) + '</p>';
  });
  closeList();
  return html;
}

/* Turnstile on the register form (Will, 2026-09-07 23:15): empty until Will creates
   the widget in Cloudflare and sets this. Deploy order matters - set the site key
   here on the website FIRST, then set the matching worker secret second, or the
   worker will start rejecting registrations the form is not yet sending a token
   for. Empty means the questionnaire renders nothing extra and the register body
   is unchanged, so the live site keeps working either side of that gap. */
const NP = {
  api: npApi,
  markdownLite: markdownLite,
  hub: HUB,
  config: hubConfig,
  saveLoc: saveLoc,
  loadLoc: loadLoc,
  TURNSTILE_SITE_KEY: '',
};
window.NP = NP;

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

/* ═══════════ modals ═══════════ */
/* `payload` is what a page has already collected and should not make anyone
   type again: the find page's no-match route hands the desk the whole search.
   The anonymous fallback below has no structured payload of its own, so it
   is only carried on the account path. */
function openIntro(ref, heading, payload){
  if (window.NPAccount && typeof NPAccount.gate === 'function'){
    NPAccount.gate({ hub: hubOfPage(), side: ref ? 'request_intro' : 'request_capacity',
      brief_ref: ref || '', heading: heading || 'Ask us to introduce you',
      payload: payload || {} });
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
        <div class="field full"><label for="iNotes">What should we know?</label><textarea id="iNotes" placeholder="Volumes, systems, timing: anything that helps us weigh the fit"></textarea></div>
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
        <p>Chris or Will reads every request personally. Expect to hear from one of us within two working days.</p>
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
    <p class="body">Name and email, nothing else. We'll write when the first courses open.</p>
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
        <p>We'll write the moment the first courses open. Nothing else lands in your inbox.</p>
        <div class="modal-actions" style="justify-content:center"><button class="btn btn-outline" onclick="closeAll()">Back to the Global Hub</button></div>
      </div>`;
  }, () => formFailState(form, state));
  return false;
}
function openSignIn(){ openOverlay('signOverlay'); }
async function signSubmit(){
  const email = (document.getElementById('sEmail') || {}).value || '';
  const pass = (document.getElementById('sPass') || {}).value || '';
  const err = document.querySelector('#signContent .np-sign-error');
  if (!window.NPAccount){ if (err){ err.style.display = 'block'; err.textContent = 'Accounts are briefly unavailable. Email hello@nexpoint.co.uk and we will help directly.'; } return; }
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
      ? 'That did not send. Check your connection and try again.'
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

/* ═══════════ the clicks that arrived before this file did ═══════════
   The subdomain pages render their header CTAs immediately but load this
   module from the apex, over a sequential chain of cross-origin requests:
   two round trips on the doors, five on find and offer. A click in that gap
   used to throw a ReferenceError and do nothing, so each of those pages
   defines a stub in its inline head script that records the call instead.
   The declarations above have already replaced those stubs by the time any
   of this runs, so the queue is drained once and never refilled.
   It is drained after the account has settled, because what openIntro puts
   up depends on whether anyone is signed in, and the click that queued it
   happened before /auth/me could possibly have answered. */
(function replayQueuedCalls(){
  const queue = window.NP_QUEUE;
  if (!Array.isArray(queue)) return;
  window.NP_QUEUE = null;
  /* Object.create(null) plus an explicit own-property check: `call.name` is a
     string off a stub's own recording, so nothing stops it being "constructor"
     or "__proto__" - a plain object literal would hand one of those back a
     function or Object.prototype rather than undefined. */
  const fns = Object.create(null);
  fns.openSignIn = openSignIn; fns.openIntro = openIntro;
  fns.openEducationList = openEducationList; fns.closeAll = closeAll;
  const run = () => queue.forEach(call => {
    const name = call && call.name;
    const fn = (name && Object.prototype.hasOwnProperty.call(fns, name)) ? fns[name] : null;
    if (typeof fn === 'function') fn.apply(null, call.args || []);
  });
  if (window.NPAccount && NPAccount.ready && NPAccount.ready.then) NPAccount.ready.then(run, run);
  else run();
})();

/* ═══════════ hero globe (landing only): dotted Earth with live connection arcs ═══════════ */
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
       --d on top, so two ragged waves instead of one sequence. Grouped, every card flips on
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

/* ═══════════ pending replay ═══════════
   A pending action lives in NPPending, on localStorage, on whichever origin
   the visitor started on (see hub-account.js). The confirm page cannot see
   it - it usually lives on a different host - so it only sends the visitor
   back here; this is the one place that can actually offer to send it,
   because this is the page it was saved from. Every hub page loads
   portal.js, so every hub page gets the offer. `kind:'request'` goes through
   the same submitRequest() path the desk forms already use; `kind:'listing'`
   goes back through the offer page's own module, which is why that kind is
   only offered on a page that has NPListing loaded.

   Two different things are held under `kind:'request'`: a desk request from
   the questionnaire, which carries a `payload`, and a seeker's find request,
   which carries the `search` it was built from and the sites picked. They
   post to different routes, so `kindFor()` tells them apart by that field
   rather than by inventing a second word for "request". */
const PENDING_KINDS = {
  request: {
    line: 'You started a request before confirming your email. Send it now?',
    send: 'Send it',
    done: '<strong>Received, in confidence.</strong> Chris or Will reads every request personally. Expect to hear within two working days.',
    already: '<strong>Already sent.</strong> Chris or Will reads every request personally. Expect to hear within two working days.',
    ready: () => !!(window.NPAccount && NPAccount.replayPending),
    submit: () => NPAccount.replayPending(),
  },
  listing: {
    line: 'You filled in your listing before confirming your email. Send it for review now?',
    send: 'Send it for review',
    done: '<strong>Received.</strong> Nothing is listed until we have checked it; you will get an email when it is live.',
    already: '<strong>Already sent.</strong> Nothing is listed until we have checked it; you will get an email when it is live.',
    ready: () => !!(window.NPListing && NPListing.submitPayload),
    alreadyError: 'listing_locked_pending',
    submit: (p) => NPListing.submitPayload(p.payload).then(d => {
      if (d && d.ok && window.NPListing.reload) NPListing.reload();
      return d;
    }),
  },
  /* Getters, not strings: the Mill Hub calls a provider a cell where the
     Print Hub calls it a site, and the card is only built once the page
     (and so the hub) is known. */
  find_request: {
    get line(){ return 'You picked ' + pendingSiteNoun() + ' before confirming your email. Send the request now?'; },
    send: 'Send it',
    /* No `done`: NPFind.submitPending paints the page's own success card on
       the way back, and a second Received under the header would be the same
       news twice. A card with no `done` simply clears itself. */
    done: null,
    get already(){ return '<strong>Already sent.</strong> ' + pendingSentLine(); },
    ready: () => !!(window.NPFind && NPFind.submitPending),
    alreadyError: 'picks_already_made',
    submit: (p) => NPFind.submitPending(p),
    /* The find module already writes one sentence per worker refusal; the
       card says the same thing rather than flattening eight answers into
       "that did not send". */
    errorText: (d) => (window.NPFind && NPFind.errorText) ? NPFind.errorText(d) : '',
  },
};

function pendingSiteNoun(){
  const c = hubConfig();
  return ((c && c.siteNoun) || 'site') + 's';
}
function pendingSentLine(){
  return 'We check every request personally and put it to the ' + pendingSiteNoun() +
    ' you picked. You can follow it on your account.';
}

/* `pending.kind` is a string off localStorage, so it can be anything at all,
   including "constructor" or "__proto__" - and a plain object lookup would
   hand one of those back a function or Object.prototype and throw on the
   `.ready()` below, killing the replay check for a pending that is perfectly
   good. Own keys only. */
function kindFor(pending){
  if (pending.kind === 'request' && pending.search) return PENDING_KINDS.find_request;
  return Object.prototype.hasOwnProperty.call(PENDING_KINDS, pending.kind)
    ? PENDING_KINDS[pending.kind] : null;
}

function checkPendingReplay(){
  if (!window.NPAccount || !window.NPPending) return;
  if (!NPAccount.user || !NPAccount.confirmed()) return;
  const p = NPPending.load();
  if (!p) return;
  const kind = kindFor(p);
  if (!kind || !kind.ready()) return;
  if (p.hub && p.hub !== hubOfPage()) return;
  renderPendingCard(p, kind);
}

function renderPendingCard(pending, kind){
  if (document.getElementById('npPendingCard')) return;
  const wrap = document.createElement('div');
  wrap.className = 'container';
  wrap.style.marginTop = '16px';
  wrap.innerHTML =
    '<div class="notice-warn notice-warn--block" id="npPendingCard">' +
      '<span>' + escapeHtml(kind.line) + '</span>' +
      '<button class="btn btn-primary" type="button" data-np-pending-send>' + escapeHtml(kind.send) + '</button>' +
      '<button class="btn btn-outline" type="button" data-np-pending-skip>Not now</button>' +
    '</div>';
  const header = document.querySelector('header');
  if (header && header.parentNode) header.parentNode.insertBefore(wrap, header.nextSibling);
  else document.body.insertBefore(wrap, document.body.firstChild);

  const card = wrap.querySelector('#npPendingCard');
  card.querySelector('[data-np-pending-send]').addEventListener('click', async (e) => {
    const btn = e.target;
    btn.disabled = true; btn.textContent = 'Sending…';
    const d = await kind.submit(pending);
    if (d && d.ok){
      NPPending.clear();
      /* The page said it itself: get out of the way rather than say it again. */
      if (!kind.done){ wrap.remove(); return; }
      card.innerHTML = '<span>' + kind.done + '</span>';
      return;
    }
    if (d && (d.error === 'no_pending' || (kind.alreadyError && d.error === kind.alreadyError))){
      /* Already sent elsewhere (e.g. the modal completed the send while this
         card sat on screen from before it opened) - not a failure. */
      card.innerHTML = '<span>' + kind.already + '</span>';
      return;
    }
    /* The module dropped the held action while handling this: it has taken
       the seeker on somewhere else in the page (stale terms wanting a fresh
       tick), so the card no longer stands for anything. */
    if (window.NPPending && !NPPending.load()){ wrap.remove(); return; }
    btn.disabled = false; btn.textContent = kind.send;
    let err = card.querySelector('.pending-error');
    if (!err){
      err = document.createElement('span');
      err.className = 'pending-error';
      err.style.cssText = 'color:#E5484D;font-size:13px';
      card.appendChild(err);
    }
    err.textContent = (kind.errorText && kind.errorText(d)) ||
      'That did not send. Try again, or email hello@nexpoint.co.uk.';
  });
  card.querySelector('[data-np-pending-skip]').addEventListener('click', () => {
    NPPending.clear();
    wrap.remove();
  });
}

if (window.NPAccount) NPAccount.ready.then(checkPendingReplay);
document.addEventListener('npaccount:change', checkPendingReplay);

/* ═══════════ boot ═══════════
   The loader in each page fires np:modules once its whole chain has loaded and
   the document is ready, so a page module is always started after both it and
   the DOM exist. A page with no module of its own simply never fires it. */
function bootPageModules(){
  if (window.NPFind) NPFind.init();
  if (window.NPListing) NPListing.init();
  if (window.NPDashboard) NPDashboard.init();
  if (window.NPAccept) NPAccept.init();
  /* the page's own module may be what a held action replays through, and it
     only exists now, so the offer is re-checked once the modules are up */
  checkPendingReplay();
}
document.addEventListener('np:modules', bootPageModules, { once: true });

/* ═══════════ hero handoff: the globe launches, the doors take the frame ═══════════
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
    /* distance from rest to the doors meeting the header, the whole handoff */
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

/* NexPoint User Portal v2 — shared behaviour. Front-end only: nothing is stored or sent. */

/* ---------- modals ---------- */
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function openIntro(ref, heading){
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
  const c = document.getElementById('introContent');
  c.innerHTML = `
    <div class="success">
      <div class="ok"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M4 12l6 6L20 6"/></svg></div>
      <h2>Received, in confidence.</h2>
      <p>We'll confirm your account by email, then verify equipment, materials and standards with you directly. Founding places are limited to twenty laboratories. <br><br><em>(Draft note: nothing was actually sent.)</em></p>
      <div class="modal-actions" style="justify-content:center"><button class="btn btn-outline" onclick="closeAll()">Back to the portal</button></div>
    </div>`;
  openOverlay('introOverlay');
  return false;
}
function openSignIn(){
  openOverlay('signOverlay');
}
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

/* ---------- print hub: location capture + capacity matching (illustrative) ---------- */
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
const OPTIONS = [
  { tech:'HP Multi Jet Fusion', mat:'TPU & Nylon 11', cap:'1,000 pairs / month', min:'200 pairs / month', dist: 250, badge:'High volume' },
  { tech:'Formlabs Fuse 1', mat:'Nylon 12 Tough', cap:'20 pairs / month', min:'10 pairs / month', dist: 420, badge:'Small batch' },
  { tech:'Formlabs Fuse X1', mat:'Nylon 11', cap:'30 pairs / month', min:'10 pairs / month', dist: 600, badge:'Onboarding · Nov 2026' },
];
function initLocPicker(){
  const sel = document.getElementById('locRegion');
  if (!sel) return;
  Object.keys(REGIONS).forEach(r => {
    const o = document.createElement('option'); o.value = r; o.textContent = r; sel.appendChild(o);
  });
}
function fillCountries(){
  const r = document.getElementById('locRegion').value;
  const sel = document.getElementById('locCountry');
  sel.innerHTML = '<option value="">Choose a country</option>';
  if (!r){ sel.disabled = true; return; }
  sel.disabled = false;
  REGIONS[r].forEach(c => {
    const o = document.createElement('option'); o.value = c; o.textContent = c; sel.appendChild(o);
  });
}
function showMatches(){
  const region = document.getElementById('locRegion').value;
  const town = document.getElementById('locTown').value.trim();
  const intro = document.getElementById('matchIntro');
  const grid = document.getElementById('capGrid');
  if (!region){ intro.style.display = 'block'; intro.innerHTML = '<b>Choose a region first</b> — matching and logistics start with where you are.'; grid.innerHTML=''; return; }
  const n = NODE_COUNT[region];
  const place = town || region;
  intro.style.display = 'block';
  intro.innerHTML = n > 0
    ? `<b>${n} certified node${n>1?'s':''} in ${region}.</b> Illustrative of live network capacity near ${escapeHtml(place)} — an introduction confirms current availability.`
    : `<b>Founding nodes are joining in ${region} now.</b> Ask the desk and we'll route your work through the nearest live node in the meantime.`;
  grid.innerHTML = OPTIONS.map((o,i) => `
    <div class="cap reveal" style="animation-delay:${i*90}ms">
      <div class="cap__top">
        <span class="cap__opt">Option ${i+1}</span>
        <span class="cap__badge">${o.badge}</span>
      </div>
      <h3>${o.tech}</h3>
      <dl>
        <div><dt>Location</dt><dd>${n>0 ? 'Within ~'+o.dist+' miles' : 'Nearest live region'}</dd></div>
        <div><dt>Materials</dt><dd>${o.mat}</dd></div>
        <div><dt>Price</dt><dd class="price">US$35 + shipping</dd></div>
        <div><dt>Capacity</dt><dd>${o.cap}</dd></div>
        <div><dt>Minimum</dt><dd>${o.min}</dd></div>
      </dl>
      <button class="btn btn-primary" onclick="openIntro('PRINT HUB · OPTION ${i+1} · ${o.tech.replace(/'/g,'')}','Ask us to introduce you')">Ask us to introduce you</button>
    </div>`).join('');
  grid.scrollIntoView({behavior:'smooth', block:'nearest'});
}

/* ---------- ?demo=match | ?demo=intro — pre-filled state for walkthroughs ---------- */
function runDemo(){
  const demo = new URLSearchParams(location.search).get('demo');
  if (!demo || !document.getElementById('locRegion')) return;
  document.getElementById('locRegion').value = 'North America';
  fillCountries();
  document.getElementById('locCountry').value = 'Canada';
  document.getElementById('locTown').value = 'Vancouver';
  showMatches();
  if (demo === 'intro') openIntro('PRINT HUB · OPTION 1 · HP Multi Jet Fusion','Ask us to introduce you');
}

/* ---------- hero globe (landing only) — dotted Earth with live connection arcs ---------- */
(function initGlobe() {
  const canvas = document.getElementById('globeCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const reduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false;

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
    [[21,24]],
  ];
  function isLand(lat, lon) {
    let row = Math.floor((90 - lat) / 180 * 24);
    let col = Math.floor((lon + 180) / 360 * 60);
    if (row < 0) row = 0; if (row > 23) row = 23;
    if (col < 0) col = 0; if (col > 59) col = 59;
    const segs = LAND[row];
    for (let i = 0; i < segs.length; i++) if (col >= segs[i][0] && col <= segs[i][1]) return true;
    return false;
  }

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

/* ---------- entrances (ported verbatim from the live site) ----------
   The pre-state only exists once JS confirms motion is welcome, so no-JS and
   reduced-motion visitors never meet hidden content. */
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

document.addEventListener('DOMContentLoaded', () => { initLocPicker(); runDemo(); });

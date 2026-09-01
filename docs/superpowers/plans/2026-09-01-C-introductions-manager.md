# Plan C — Introductions Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The admin workspace gains a Dashboard and three hub pages (Print, Mill, Opportunities) where Will and Chris review incoming requests, approve or decline them, pair approved requests into introductions, and track each introduction through to commission paid.

**Architecture:** Static pages in `admin/` following the exact pattern of the existing `admin/leads.html` (supabase-js v2 from CDN, publishable key, `signInWithPassword`, allowlist UI gate with RLS as the real gate, `esc()` for all rendered data). One shared stylesheet + one shared logic module drive all three hub pages, each configured by a small per-page `HUB` object. Reads/writes go straight to `web_requests` and `introductions` (admin RLS from Plan B allows it). The approved UI is the design canvas at https://claude.ai/code/artifact/2eddcfa3-2da6-4627-8710-b19e0616b501 — light canvas, existing admin chrome. **Nothing here sends email or connects companies — approving records a decision; Will/Chris make the introduction themselves from Outlook.**

**Tech Stack:** Vanilla JS, supabase-js v2 (CDN), static HTML on GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-09-01-platform-admin-design.md` (website repo)

## Global Constraints

- Website repo `/Users/willlawrie/Documents/Claude/Projects/Nexpoint/website`, branch `claude/introductions-manager`; push only `origin claude/*`; Will merges.
- Supabase: `https://synywukadvjpjjxjylwk.supabase.co`, publishable key `sb_publishable_a2-WFA1i5tqkoHy52_aGzQ_6Yx3xtNo`, admin allowlist `willlawrie@nexpoint.co.uk` / `chris@nexpoint.co.uk`.
- Depends on Plan B Task 2 (tables `web_requests`, `introductions`). Build everything regardless; until the migration runs, pages show the same "Could not read…" banner pattern `leads.html` uses. Coordinate testing after B's migration gate.
- Brand hard rules (`brand/design-system.md`): light canvas `#F5F7FA` (the approved mocks are light — new pages are light-first, no theme toggle needed), Montserrat/Inter/Material Symbols, no emoji, British English, verb-first CTAs, colours only from: blue `#005CC8` (+`#0A63D0` links), green `#8BC53F`, amber `#E8B23A`, danger `#E5484D`, greys `#0E1626/#2C3444/#5A6474/#9aa0a6`, borders `#E3E7ED`, surface `#FFFFFF`.
- Escape EVERY database value with `esc()` before inserting into HTML (pattern in leads.html line 164).
- `admin/index.html` (Briefs board), `leads.html`, `tasks.html`, `health.html` keep their internals — only their `nav.boards` block changes (Task 4).

## Table shapes consumed (created by Plan B — copy for reference)

`web_requests`: `id, created_at, hub('print'|'mill'|'opportunities'), side('offer_capacity'|'request_capacity'|'list_opportunity'|'request_intro'), company, contact_name, email, phone, location, brief_ref, payload jsonb, status('new'|'reviewing'|'approved'|'declined'|'archived'), reviewed_by, review_note, synced_at`

`introductions`: `id, ref, hub, request_a, request_b, brief_id, stage('approved'|'introduced'|'in_discussion'|'deal_done'|'dead'|'invoiced'|'paid'), commission_basis, commission_amount, commission_currency, invoiced_at, paid_at, created_by, created_at, updated_at, notes, synced_at`

---

### Task 1: Shared chrome and logic

**Files:**
- Create: `admin/assets/admin-light.css`, `admin/assets/hub-board.js`

- [ ] **Step 1: Write `admin/assets/admin-light.css`** — the light chrome from the approved mocks, class names matching the existing admin pages so markup stays familiar:

```css
/* NexPoint admin — light chrome (the approved workspace mocks). */
:root{--bg:#F5F7FA;--surface:#FFFFFF;--line:#E3E7ED;--ink:#2C3444;--head:#0E1626;
  --mut:rgba(44,52,68,.62);--subtle:#5A6474;--blue:#005CC8;--blue-link:#0A63D0;
  --green:#8BC53F;--amber:#E8B23A;--red:#E5484D;
  --font-d:'Montserrat',system-ui,sans-serif;--font-b:'Inter',system-ui,sans-serif}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--ink);font-family:var(--font-b);font-size:15px;line-height:1.55;-webkit-font-smoothing:antialiased}
a{color:var(--blue-link)}
h1,h2,h3{font-family:var(--font-d);color:var(--head)}
.wrap{max-width:1180px;margin:0 auto;padding:0 24px}
header{position:sticky;top:0;z-index:10;background:rgba(255,255,255,.95);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.bar{display:flex;align-items:center;justify-content:space-between;height:64px;gap:16px}
.brand{font:700 17px/1 var(--font-d);color:var(--head)}
.brand span{color:var(--green)}
.who{font-size:13px;color:var(--mut)}
.btn{display:inline-flex;align-items:center;gap:6px;font-family:var(--font-b);font-weight:600;font-size:12.5px;padding:7px 12px;border-radius:5px;border:none;cursor:pointer;transition:all .15s}
.btn-pri{background:var(--blue);color:#fff}.btn-pri:hover{background:#0066DC}
.btn-gh{background:transparent;color:var(--mut);border:1px solid var(--line)}.btn-gh:hover{color:var(--head);border-color:rgba(14,22,38,.3)}
.btn-grn{background:rgba(139,197,63,.16);color:#4d7317;border:1px solid rgba(139,197,63,.35)}.btn-grn:hover{background:rgba(139,197,63,.26)}
.btn-amb{background:rgba(232,178,58,.14);color:#8a6a1c;border:1px solid rgba(232,178,58,.45)}
.btn-danger{background:transparent;color:#B3262B;border:1px solid rgba(229,72,77,.35)}
.btn:disabled{opacity:.5;cursor:not-allowed}
nav.boards{display:flex;gap:4px;border-bottom:1px solid var(--line);margin:20px 0 0;flex-wrap:wrap}
nav.boards a{padding:10px 14px;font-size:13.5px;font-weight:600;color:var(--mut);text-decoration:none;border-bottom:2px solid transparent}
nav.boards a:hover{color:var(--head)}
nav.boards a[aria-current="page"]{color:var(--head);border-bottom-color:var(--blue)}
#login{max-width:380px;margin:14vh auto 0;text-align:center}
#login h1{font-size:24px;margin-bottom:6px}
#login p{color:var(--mut);font-size:14px;margin-bottom:26px}
#login input{width:100%;background:#fff;border:1px solid var(--line);border-radius:5px;color:var(--ink);font-family:var(--font-b);font-size:15px;padding:12px 14px;margin-bottom:12px;outline:none}
#login input:focus{border-color:var(--blue)}
#login .btn-pri{width:100%;justify-content:center;padding:12px}
.err{color:var(--red);font-size:13px;margin-top:10px;min-height:18px}
.eyebrow{font:600 12px/1 var(--font-b);letter-spacing:.14em;text-transform:uppercase;color:var(--blue);margin:0 0 14px;display:flex;align-items:center;gap:10px}
.eyebrow::before{content:"";width:24px;height:1.5px;background:currentColor;display:inline-block}
.toolbar{display:flex;align-items:center;justify-content:space-between;margin:28px 0 18px;gap:12px;flex-wrap:wrap}
.toolbar h1{font:600 20px/1.3 var(--font-d)}
.filters{display:flex;gap:8px;flex-wrap:wrap}
.chip{font:600 12.5px/1 var(--font-b);padding:7px 13px;border-radius:9999px;border:1px solid var(--line);background:transparent;color:var(--mut);cursor:pointer}
.chip.on{background:rgba(0,92,200,.12);border-color:var(--blue);color:var(--blue-link)}
.cols{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;margin-bottom:34px}
@media(max-width:900px){.cols{grid-template-columns:1fr}}
.req{background:var(--surface);border:1px solid var(--line);border-left:4px solid var(--line);border-radius:9px;padding:16px 18px;margin-bottom:12px}
.req.s-new{border-left-color:var(--blue)}.req.s-reviewing{border-left-color:var(--amber)}
.req.s-approved{border-left-color:var(--green)}.req.s-declined{border-left-color:#9aa0a6}
.req-top{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-bottom:5px}
.badge{font:700 10px/1 var(--font-b);letter-spacing:.07em;padding:4px 8px;border-radius:3px}
.b-new{background:var(--blue);color:#fff}.b-reviewing{background:var(--amber);color:#0d0e0f}
.b-approved{background:var(--green);color:#0d0e0f}.b-declined{background:#9aa0a6;color:#fff}
.ref{font:600 12px/1 var(--font-b);color:var(--mut);letter-spacing:.04em}
.req h3{font:600 16px/1.3 var(--font-d);margin:2px 0 4px}
.req .meta{font-size:12.5px;color:var(--subtle)}
.req .acts{display:flex;gap:7px;margin-top:12px;flex-wrap:wrap;align-items:center}
.pill{font:600 10.5px/1 var(--font-b);letter-spacing:.05em;padding:4px 8px;border-radius:3px}
.p-blue{background:rgba(0,92,200,.12);color:var(--blue-link)}.p-amber{background:rgba(232,178,58,.16);color:#8a6a1c}
.p-green{background:rgba(139,197,63,.16);color:#4d7317}.p-red{background:rgba(229,72,77,.10);color:#B3262B}
.p-grey{background:rgba(14,22,38,.06);color:var(--subtle)}
.table{background:var(--surface);border:1px solid var(--line);border-radius:9px;overflow-x:auto;margin-bottom:60px}
.table table{width:100%;border-collapse:collapse;font-size:13.5px}
.table th{font:600 11px/1 var(--font-b);letter-spacing:.08em;text-transform:uppercase;color:var(--subtle);text-align:left;padding:11px 14px;border-bottom:1px solid var(--line);background:var(--bg);white-space:nowrap}
.table td{padding:13px 14px;border-bottom:1px solid rgba(14,22,38,.055);vertical-align:middle}
.table tr:last-child td{border-bottom:none}
.empty{background:var(--surface);border:1px dashed var(--line);border-radius:9px;padding:36px;text-align:center;color:var(--mut);margin-bottom:12px}
.banner{background:rgba(232,178,58,.1);border:1px solid rgba(232,178,58,.3);color:#8a6a1c;border-radius:6px;padding:11px 14px;font-size:13.5px;margin:18px 0}
.note-box{background:#ECEFF3;border:1px dashed var(--line);border-radius:9px;padding:14px 17px;margin-bottom:12px;font-size:12.5px;color:var(--subtle)}
.overlay{position:fixed;inset:0;background:rgba(14,22,38,.45);display:none;align-items:flex-start;justify-content:center;overflow-y:auto;padding:40px 16px;z-index:50}
.overlay.open{display:flex}
.modal{background:var(--surface);border:1px solid var(--line);border-radius:12px;width:100%;max-width:640px;padding:26px 28px}
.modal h2{font-size:19px;margin-bottom:14px}
.modal label{display:block;font-size:12px;font-weight:600;color:var(--mut);margin:12px 0 5px}
.modal input,.modal select,.modal textarea{width:100%;background:#fff;border:1px solid var(--line);border-radius:5px;color:var(--ink);font-family:var(--font-b);font-size:14px;padding:9px 12px;outline:none}
.modal input:focus,.modal select:focus,.modal textarea:focus{border-color:var(--blue)}
.modal-acts{display:flex;justify-content:flex-end;gap:10px;margin-top:18px;border-top:1px solid var(--line);padding-top:16px}
.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-bottom:28px}
@media(max-width:900px){.stats{grid-template-columns:repeat(2,minmax(0,1fr))}}
.stat{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:18px 20px}
.stat .lab{font:600 11px/1 var(--font-b);letter-spacing:.08em;text-transform:uppercase;color:var(--subtle);margin-bottom:10px}
.stat .num{font:700 28px/1 var(--font-d);color:var(--head)}
.stat .sub{font-size:12.5px;color:var(--subtle);margin-top:8px}
```

- [ ] **Step 2: Write `admin/assets/hub-board.js`** — everything the three hub pages share. Each page defines `window.HUB = {...}` before loading this file:

```js
/* Shared logic for the hub request boards. Page contract:
   window.HUB = {
     hub: 'print',                       // web_requests.hub value
     title: 'Print Hub',
     left:  { side: 'offer_capacity',  title: 'Hosts — offering capacity',   approveLabel: 'Approve as host' },
     right: { side: 'request_capacity', title: 'Seekers — requesting capacity', approveLabel: 'Approve request' },
   }
   Opportunities overrides sides/titles/labels; everything else is identical. */
const SUPABASE_URL = 'https://synywukadvjpjjxjylwk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_a2-WFA1i5tqkoHy52_aGzQ_6Yx3xtNo';
const ADMIN_EMAILS = ['willlawrie@nexpoint.co.uk', 'chris@nexpoint.co.uk']; // UI gate; real gate is database RLS
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const isAdmin = e => ADMIN_EMAILS.includes((e || '').toLowerCase());
let me = null, requests = [], intros = [], filter = 'all';

const SIDE_PREFIX = { offer_capacity:'H', request_capacity:'S', list_opportunity:'L', request_intro:'I' };
const STAGES = ['approved','introduced','in_discussion','deal_done','dead','invoiced','paid'];
const STAGE_LABEL = { approved:'APPROVED', introduced:'INTRODUCED', in_discussion:'IN DISCUSSION',
  deal_done:'DEAL DONE', dead:'DEAD', invoiced:'INVOICED', paid:'PAID' };
const STAGE_PILL = { approved:'p-grey', introduced:'p-blue', in_discussion:'p-amber',
  deal_done:'p-green', dead:'p-grey', invoiced:'p-blue', paid:'p-green' };
const reqRef = r => `${HUB.hub[0].toUpperCase()}${SIDE_PREFIX[r.side] || 'R'}-${String(r.id).padStart(4,'0')}`;

async function boot(){
  const { data } = await sb.auth.getSession();
  const s = data && data.session;
  if (s && isAdmin(s.user.email)) showAdmin(s.user); else showLogin(s);
}
function showLogin(session){
  $('login').style.display = 'block'; $('admin').style.display = 'none';
  if (session && !isAdmin(session.user.email))
    $('loginErr').textContent = `${session.user.email} is signed in but not an admin.`;
}
async function doLogin(){
  $('loginErr').textContent = '';
  const { data, error } = await sb.auth.signInWithPassword({ email: $('email').value.trim(), password: $('pw').value });
  if (error) { $('loginErr').textContent = error.message; return; }
  if (!isAdmin(data.user.email)) { $('loginErr').textContent = 'This account is not on the admin allowlist.'; await sb.auth.signOut(); return; }
  showAdmin(data.user);
}
async function signOut(){ await sb.auth.signOut(); location.reload(); }
function showAdmin(user){ me = user; $('login').style.display = 'none'; $('admin').style.display = 'block'; $('who').textContent = user.email; load(); }

async function load(){
  $('banner').innerHTML = '';
  const rq = await sb.from('web_requests').select('*').eq('hub', HUB.hub).neq('status','archived').order('created_at', { ascending:false });
  if (rq.error){
    $('banner').innerHTML = `<div class="banner">Could not read requests: ${esc(rq.error.message)}. If this says permission denied, the 0007 migration has not been run yet.</div>`;
    return;
  }
  requests = rq.data || [];
  const iq = await sb.from('introductions').select('*').eq('hub', HUB.hub).order('updated_at', { ascending:false });
  intros = iq.data || [];
  render();
}

function setFilter(f){ filter = f; render(); }
const visible = list => filter === 'all' ? list : list.filter(r => r.status === filter);

function reqCard(r, col){
  const meta = [r.location, r.email, r.phone, r.brief_ref ? `brief ${r.brief_ref}` : '',
    ...Object.entries(r.payload || {}).map(([k,v]) => `${k}: ${v}`)].filter(Boolean).join(' · ');
  let acts = '';
  if (r.status === 'new' || r.status === 'reviewing'){
    acts = `${r.status === 'new' ? `<button class="btn btn-gh" onclick="setStatus(${r.id},'reviewing')">Mark reviewing</button>` : ''}
      <button class="btn btn-grn" onclick="approveReq(${r.id})">${esc(col.approveLabel)}</button>
      <button class="btn btn-gh" onclick="declineReq(${r.id})">Decline</button>`;
  } else if (r.status === 'approved'){
    acts = `<button class="btn btn-grn" onclick="openIntroModal(${r.id})">Make introduction</button>`;
  }
  return `<div class="req s-${esc(r.status)}">
    <div class="req-top">
      <span class="badge b-${esc(r.status)}">${esc(r.status.toUpperCase())}</span>
      <span class="ref">${esc(reqRef(r))}</span>
    </div>
    <h3>${esc(r.company || r.contact_name || r.email)}</h3>
    <div class="meta">${esc(r.contact_name || '')}${r.contact_name ? ' · ' : ''}${esc(meta)}</div>
    <div class="acts" id="act-${r.id}">${acts}</div>
  </div>`;
}

function introRow(i){
  const byId = Object.fromEntries(requests.map(r => [r.id, r]));
  const name = id => { const r = byId[id]; return r ? (r.company || r.contact_name || r.email) : (id ? `request ${id}` : '—'); };
  const money = i.commission_amount != null
    ? `${i.commission_currency === 'GBP' ? '£' : esc(i.commission_currency) + ' '}${Number(i.commission_amount).toLocaleString('en-GB')}`
    : (i.commission_basis || 'TBA');
  const stageOpts = STAGES.map(s => `<option value="${s}" ${s===i.stage?'selected':''}>${STAGE_LABEL[s]}</option>`).join('');
  return `<tr>
    <td style="font-weight:600;color:var(--head)">${esc(i.ref || 'INTRO-' + i.id)}</td>
    <td>${esc(name(i.request_a))}</td>
    <td>${esc(name(i.request_b))}${i.brief_id ? ` <span class="pill p-blue">${esc(i.brief_id.toUpperCase())}</span>` : ''}</td>
    <td><span class="pill ${STAGE_PILL[i.stage] || 'p-grey'}">${esc(STAGE_LABEL[i.stage] || i.stage)}</span></td>
    <td>${esc(money)}</td>
    <td>
      <select onchange="setStage(${i.id}, this.value)" style="font:600 12px/1 var(--font-b);padding:5px;border:1px solid var(--line);border-radius:4px;background:#fff;color:var(--ink)">${stageOpts}</select>
      <button class="btn btn-gh" style="margin-left:6px" onclick="editCommission(${i.id})">Record commission</button>
    </td>
  </tr>`;
}

function render(){
  ['all','new','reviewing','approved','declined'].forEach(f => {
    const el = $('f-' + f); if (el) el.className = 'chip' + (filter === f ? ' on' : '');
  });
  const left = visible(requests.filter(r => r.side === HUB.left.side));
  const right = visible(requests.filter(r => r.side === HUB.right.side));
  $('leftTitle').textContent = HUB.left.title; $('rightTitle').textContent = HUB.right.title;
  $('leftCol').innerHTML = left.length ? left.map(r => reqCard(r, HUB.left)).join('') : '<div class="empty">No requests here right now.</div>';
  $('rightCol').innerHTML = right.length ? right.map(r => reqCard(r, HUB.right)).join('') : '<div class="empty">No requests here right now.</div>';
  $('introRows').innerHTML = intros.length ? intros.map(introRow).join('')
    : '<tr><td colspan="6" style="text-align:center;color:var(--mut);padding:28px">No introductions yet — approve both sides, then pair them here.</td></tr>';
}

async function setStatus(id, status){
  const { error } = await sb.from('web_requests').update({ status, reviewed_by: me.email }).eq('id', id);
  if (error) alert('Could not update: ' + error.message); else load();
}
const approveReq = id => setStatus(id, 'approved');
function declineReq(id){
  const note = prompt('Why is this declined? (recorded on the request)');
  if (note === null) return;
  sb.from('web_requests').update({ status:'declined', reviewed_by: me.email, review_note: note }).eq('id', id)
    .then(({ error }) => { if (error) alert('Could not update: ' + error.message); else load(); });
}

function openIntroModal(id){
  const r = requests.find(x => x.id === id);
  const otherSide = r.side === HUB.left.side ? HUB.right.side : HUB.left.side;
  const partners = requests.filter(x => x.status === 'approved' && x.side === otherSide);
  const opts = partners.map(p => `<option value="${p.id}">${esc(reqRef(p))} — ${esc(p.company || p.contact_name || p.email)}</option>`).join('');
  $('modalContent').innerHTML = `
    <h2>Make an introduction</h2>
    <p style="font-size:13.5px;color:var(--subtle)">Pairing <strong>${esc(r.company || r.contact_name)}</strong> (${esc(reqRef(r))}) with an approved partner. This records the introduction — you send the email yourselves from Outlook, then mark it introduced here.</p>
    <label for="introPartner">Approved partner</label>
    <select id="introPartner">${opts || '<option value="">No approved partner on the other side yet</option>'}</select>
    <label for="introBasis">Commission basis</label>
    <input id="introBasis" placeholder="e.g. 5% per order, 2% of deal, fixed fee">
    <label for="introNotes">Notes</label>
    <textarea id="introNotes" rows="3" placeholder="Anything both of you should remember about this pairing"></textarea>
    <div class="modal-acts">
      <button class="btn btn-gh" onclick="closeModal()">Cancel</button>
      <button class="btn btn-pri" onclick="createIntro(${r.id})">Record the introduction</button>
    </div>`;
  $('overlay').classList.add('open');
}
function closeModal(){ $('overlay').classList.remove('open'); }

async function createIntro(aId){
  const bId = Number($('introPartner').value);
  if (!bId) { alert('Approve a partner on the other side first.'); return; }
  const ins = await sb.from('introductions').insert({
    hub: HUB.hub, request_a: aId, request_b: bId,
    commission_basis: $('introBasis').value.trim() || null,
    notes: $('introNotes').value.trim() || null,
    created_by: me.email, stage: 'approved',
  }).select().single();
  if (ins.error) { alert('Could not record it: ' + ins.error.message); return; }
  await sb.from('introductions').update({ ref: 'INTRO-' + String(ins.data.id).padStart(4,'0') }).eq('id', ins.data.id);
  closeModal(); load();
}

async function setStage(id, stage){
  const patch = { stage, updated_at: new Date().toISOString() };
  if (stage === 'invoiced') patch.invoiced_at = new Date().toISOString().slice(0,10);
  if (stage === 'paid') patch.paid_at = new Date().toISOString().slice(0,10);
  const { error } = await sb.from('introductions').update(patch).eq('id', id);
  if (error) alert('Could not update: ' + error.message); else load();
}
function editCommission(id){
  const i = intros.find(x => x.id === id);
  const amount = prompt('Commission amount (numbers only, GBP):', i.commission_amount || '');
  if (amount === null) return;
  sb.from('introductions').update({ commission_amount: Number(amount) || null, updated_at: new Date().toISOString() }).eq('id', id)
    .then(({ error }) => { if (error) alert('Could not update: ' + error.message); else load(); });
}
boot();
```

- [ ] **Step 3: Commit** — `git checkout -b claude/introductions-manager && git add admin/assets && git commit -m "Admin: shared light chrome and hub board logic"`

### Task 2: The three hub pages

**Files:**
- Create: `admin/print-hub.html`, `admin/mill-hub.html`, `admin/opportunities.html`

**Interfaces:**
- Consumes: `admin/assets/admin-light.css`, `admin/assets/hub-board.js`, and Plan B's tables.

- [ ] **Step 1: Write `admin/print-hub.html`** (complete file):

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>NexPoint Admin — Print Hub</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="assets/admin-light.css">
</head>
<body>
<div id="login" style="display:none">
  <h1>NexPoint <span style="color:var(--green)">Print Hub</span></h1>
  <p>Sign in with your admin account.</p>
  <input id="email" type="email" placeholder="you@nexpoint.co.uk" autocomplete="username">
  <input id="pw" type="password" placeholder="Password" autocomplete="current-password">
  <button class="btn btn-pri" onclick="doLogin()">Sign in</button>
  <div class="err" id="loginErr"></div>
</div>
<div id="admin" style="display:none">
  <header><div class="wrap bar">
    <div class="brand">Nex<span>Point</span> Admin</div>
    <div style="display:flex;align-items:center;gap:14px">
      <span class="who" id="who"></span>
      <button class="btn btn-gh" onclick="signOut()">Sign out</button>
    </div>
  </div></header>
  <div class="wrap">
    <nav class="boards">
      <a href="dashboard.html">Dashboard</a>
      <a href="leads.html">Leads</a>
      <a href="tasks.html">Tasks</a>
      <a href="health.html">Health</a>
      <a href="print-hub.html" aria-current="page">Print Hub</a>
      <a href="mill-hub.html">Mill Hub</a>
      <a href="opportunities.html">Opportunities</a>
      <a href="campaigns.html">Campaigns</a>
    </nav>
    <div class="toolbar">
      <h1>Print Hub</h1>
      <div class="filters">
        <button class="chip on" id="f-all" onclick="setFilter('all')">All</button>
        <button class="chip" id="f-new" onclick="setFilter('new')">New</button>
        <button class="chip" id="f-reviewing" onclick="setFilter('reviewing')">Reviewing</button>
        <button class="chip" id="f-approved" onclick="setFilter('approved')">Approved</button>
        <button class="chip" id="f-declined" onclick="setFilter('declined')">Declined</button>
      </div>
    </div>
    <div id="banner"></div>
    <div class="cols">
      <div><div class="eyebrow" id="leftTitle"></div><div id="leftCol"></div></div>
      <div><div class="eyebrow" id="rightTitle"></div><div id="rightCol"></div></div>
    </div>
    <div class="eyebrow">Introductions — Print Hub</div>
    <div class="note-box">Approving a request records your decision only — no company is ever told about another until you make the introduction yourselves and log it here.</div>
    <div class="table"><table>
      <thead><tr><th>Ref</th><th>Party A</th><th>Party B</th><th>Stage</th><th>Commission</th><th>Manage</th></tr></thead>
      <tbody id="introRows"></tbody>
    </table></div>
  </div>
</div>
<div class="overlay" id="overlay"><div class="modal" id="modalContent"></div></div>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script>
window.HUB = {
  hub: 'print', title: 'Print Hub',
  left:  { side: 'offer_capacity',   title: 'Hosts — offering capacity',    approveLabel: 'Approve as host' },
  right: { side: 'request_capacity', title: 'Seekers — requesting capacity', approveLabel: 'Approve request' },
};
</script>
<script src="assets/hub-board.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `admin/mill-hub.html`** — byte-identical to print-hub.html except: `<title>NexPoint Admin — Mill Hub</title>`, login heading `NexPoint <span style="color:var(--green)">Mill Hub</span>`, toolbar `<h1>Mill Hub</h1>`, nav `aria-current="page"` moves to the `mill-hub.html` link, introductions eyebrow `Introductions — Mill Hub`, and `window.HUB.hub = 'mill'`, `title: 'Mill Hub'` (left/right blocks identical to print).

- [ ] **Step 3: Write `admin/opportunities.html`** — same skeleton with: title/headers "Opportunities Hub", `aria-current` on `opportunities.html`, a toolbar extra button `<a class="btn btn-gh" href="index.html">Manage briefs</a>` beside the filters, introductions eyebrow `Introductions — Opportunities Hub`, and:

```js
window.HUB = {
  hub: 'opportunities', title: 'Opportunities Hub',
  left:  { side: 'list_opportunity', title: 'Listing applications — join the hub', approveLabel: 'Approve and draft brief' },
  right: { side: 'request_intro',    title: 'Introduction requests — against live briefs', approveLabel: 'Approve introduction' },
};
```

- [ ] **Step 4: Verify** — `python3 -m http.server 4399`, open each page: login renders; after signing in (Will's credentials — or verify visually to the login screen and hand a test script to Will), the board loads or shows the migration banner. Buttons must never throw in the console.

- [ ] **Step 5: Commit** — `git add admin/*.html && git commit -m "Admin: print, mill and opportunities hub boards"`

### Task 3: Dashboard

**Files:**
- Create: `admin/dashboard.html`

- [ ] **Step 1: Write it.** Same skeleton as Task 2's pages (login block, header, 8-tab nav with `aria-current` on `dashboard.html`, overlay omitted). Body content after nav:

```html
<div class="toolbar"><h1>Dashboard</h1><span class="ref" id="today"></span></div>
<div id="banner"></div>
<div class="stats">
  <div class="stat"><div class="lab">New requests</div><div class="num" id="stNew">—</div><div class="sub">Across all three hubs</div></div>
  <div class="stat"><div class="lab">Awaiting approval</div><div class="num" id="stReviewing">—</div><div class="sub" id="stOldest"></div></div>
  <div class="stat"><div class="lab">Live introductions</div><div class="num" id="stIntros">—</div><div class="sub" id="stDiscussion"></div></div>
  <div class="stat"><div class="lab">Commission outstanding</div><div class="num" id="stOwed">—</div><div class="sub" id="stInvoices"></div></div>
</div>
<div class="eyebrow">Needs attention</div>
<div id="attention"></div>
```

With this script (after the supabase CDN tag; reuse the same `SUPABASE_URL/KEY/ADMIN_EMAILS/boot/doLogin/signOut` block pattern as `hub-board.js` — copy those functions inline here since HUB pages' shared file assumes a HUB config; do not load `hub-board.js` on this page):

```js
async function load(){
  $('today').textContent = new Date().toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long' });
  const rq = await sb.from('web_requests').select('id,hub,side,company,contact_name,email,status,created_at').neq('status','archived');
  if (rq.error){ $('banner').innerHTML = `<div class="banner">Could not read requests: ${esc(rq.error.message)}</div>`; return; }
  const reqs = rq.data || [];
  const iq = await sb.from('introductions').select('id,ref,hub,stage,commission_amount,invoiced_at');
  const intros = iq.data || [];
  const newReqs = reqs.filter(r => r.status === 'new');
  const reviewing = reqs.filter(r => r.status === 'reviewing');
  $('stNew').textContent = newReqs.length;
  $('stReviewing').textContent = reviewing.length;
  const oldest = [...newReqs, ...reviewing].sort((a,b) => a.created_at < b.created_at ? -1 : 1)[0];
  $('stOldest').textContent = oldest ? `Oldest waiting since ${new Date(oldest.created_at).toLocaleDateString('en-GB')}` : 'Nothing waiting';
  const live = intros.filter(i => !['dead','paid'].includes(i.stage));
  $('stIntros').textContent = live.length;
  $('stDiscussion').textContent = `${intros.filter(i => i.stage === 'in_discussion').length} in active discussion`;
  const owed = intros.filter(i => i.stage === 'invoiced');
  $('stOwed').textContent = '£' + owed.reduce((s,i) => s + Number(i.commission_amount || 0), 0).toLocaleString('en-GB');
  $('stInvoices').textContent = `${owed.length} invoice${owed.length === 1 ? '' : 's'} unpaid`;
  const HUBPAGE = { print:'print-hub.html', mill:'mill-hub.html', opportunities:'opportunities.html' };
  const items = [
    ...newReqs.map(r => ({ cls:'s-new', title:`New ${r.side.replace(/_/g,' ')} — ${r.hub} hub`, meta:`${r.company || r.contact_name || r.email} · ${new Date(r.created_at).toLocaleDateString('en-GB')}`, href: HUBPAGE[r.hub], cta:'Review request' })),
    ...owed.map(i => ({ cls:'s-reviewing', title:`Commission outstanding — ${i.ref || 'INTRO-' + i.id}`, meta:`Invoiced ${i.invoiced_at || ''} · £${Number(i.commission_amount || 0).toLocaleString('en-GB')} · ${i.hub} hub`, href: HUBPAGE[i.hub], cta:'Chase payment' })),
  ];
  $('attention').innerHTML = items.length ? items.map(x => `
    <div class="req ${x.cls}" style="display:flex;justify-content:space-between;gap:14px;align-items:center">
      <div><h3 style="font-size:14.5px">${esc(x.title)}</h3><div class="meta">${esc(x.meta)}</div></div>
      <a class="btn btn-pri" href="${esc(x.href)}">${esc(x.cta)}</a>
    </div>`).join('') : '<div class="empty">Nothing needs you right now.</div>';
}
```

- [ ] **Step 2: Verify** locally as before (banner path pre-migration; live data after).

- [ ] **Step 3: Commit** — `git add admin/dashboard.html && git commit -m "Admin: dashboard with request, introduction and commission stats"`

### Task 4: Unify the nav across the existing pages

**Files:**
- Modify: `admin/index.html`, `admin/leads.html`, `admin/tasks.html`, `admin/health.html` (each has a `nav.boards` block near the top of its `#admin` div)

- [ ] **Step 1: Replace each page's `nav.boards`** with the 8-tab nav from Task 2 Step 1 (Dashboard / Leads / Tasks / Health / Print Hub / Mill Hub / Opportunities / Campaigns), keeping `aria-current="page"` on the tab matching the file (leads.html → Leads, tasks.html → Tasks, health.html → Health; `index.html` — the Briefs board — gets NO `aria-current`; it is reached from the Opportunities page's "Manage briefs" button). Do not touch anything else in these four files; they keep their current dark styling until a later restyle pass Will asks for.

- [ ] **Step 2: Verify** — click through every tab from every page locally; no dead links (campaigns.html is Plan D's — if it does not exist yet the link 404s locally; acceptable, note it in the report).

- [ ] **Step 3: Commit and push** — `git add admin && git commit -m "Admin: unified eight-tab navigation" && git push origin claude/introductions-manager`

- [ ] **Step 4: Report to Will** — what is built, what needs Plan B's migration before it lights up, and a 2-minute test script for him (sign in → approve a test request on each side → make the introduction → advance its stage → record commission → check the dashboard counts move).

## Self-review notes

- Spec coverage: §5 (dashboard + three hub pages, eight-tab nav), §6 (introduction lifecycle incl. invoiced/paid + commission fields), golden rule enforced (approve ≠ introduce; modal copy says Outlook sends). Campaigns page is Plan D's by design.
- Type consistency: statuses and stages match Plan B's CHECK constraints exactly; `reqRef` prefixes are display-only.

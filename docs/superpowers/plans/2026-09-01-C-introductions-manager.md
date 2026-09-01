# Plan C — Introductions Manager Implementation Plan (v2 — engine-repo edition)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **v2 (2026-09-01, evening):** rewritten after discovering the admin app's source of truth moved to the engine repo. The earlier version of this plan built standalone pages in `website/admin/` with direct table writes — both wrong now. This version is the one to execute.

**Goal:** The admin workspace gains a Dashboard and three hub boards (Print, Mill, Opportunities) where Will and Chris review incoming requests, approve/decline them, pair approved requests into introductions, and track each introduction to commission paid — with every action travelling as an `engine_intents` row the engine executes.

**Architecture:** The engine repo (`nexpoint-engine`, locally `/Users/willlawrie/Documents/Claude/Projects/Nexpoint 2`) is the source of truth: its `app/` directory holds the admin boards (deployed as file copies into the website repo's `admin/`), its `supabase/migrations/` holds schema, its `src/nexpoint_engine/intents.py` holds the closed intent vocabulary (mirrored by a DB constraint, guarded by `tests/test_intents.py`). New boards follow `app/leads.html` + `app/admin.css` + `DESIGN.md` exactly. **The app is a pure human surface** (PRODUCT.md): reads are direct selects under RLS; every button press INSERTS an intent; the engine claims and executes it journalled on its next run; the UI shows "queued for the engine" — the exact pattern the leads board already uses.

**Tech Stack:** Vanilla JS + supabase-js (CDN) boards; Python 3 (uv, pytest, TDD) for intent handlers; SQL migrations.

**Spec:** `docs/superpowers/specs/2026-09-01-platform-admin-design.md` (website repo). Binding alongside it: the engine repo's `nexpoint-engine-acceptance-spec.md`, `CLAUDE.md`, `PRODUCT.md`, `DESIGN.md` — read all four before writing anything.

## Global Constraints

- Engine repo `/Users/willlawrie/Documents/Claude/Projects/Nexpoint 2` — branch `claude/introductions-manager`; `uv run pytest -q` stays green; TDD (failing test first); never weaken acceptance-guard tests. Website repo `/Users/willlawrie/Documents/Claude/Projects/Nexpoint/website` — same branch name, receives deploy copies only. Push only `origin claude/*`; Will merges.
- Depends on Plan B's migration **0016** (`web_requests` + `introductions` tables). Build regardless; boards show their honest error banner until it runs.
- Golden rule: approving records a decision; the introduction email is sent by Will/Chris from Outlook (G1: the engine drafts at most). No path here reveals one company to another on any public surface.
- Design: light theme only, square logo only (`app/nexpoint-logo.png`), tokens from `DESIGN.md`/`admin.css` — where the approved mock canvas (https://claude.ai/code/artifact/2eddcfa3-2da6-4627-8710-b19e0616b501) differs from those tokens, the tokens win. No emoji, British English, verb-first CTAs, Material Symbols icons.
- Supabase: `https://synywukadvjpjjxjylwk.supabase.co`; copy the publishable key, auth boot, allowlist and `esc()` patterns from `app/leads.html` verbatim rather than re-inventing them.
- Coordinate with Plan D: it owns job steps and the filing pipeline; this plan owns board UI + intent vocabulary + intent handlers for board actions. Disjoint files except `intents.py`/`handlers.py` wiring lists — if Plan D lands first, rebase.

## Table shapes consumed (Plan B migration 0016 — reference)

`web_requests`: `id, created_at, hub('print'|'mill'|'opportunities'), side('offer_capacity'|'request_capacity'|'list_opportunity'|'request_intro'), company, contact_name, email, phone, location, brief_ref, payload jsonb, status('new'|'reviewing'|'approved'|'declined'|'archived'), reviewed_by, review_note, synced_at`

`introductions`: `id, ref, hub, request_a, request_b, brief_id, stage('approved'|'introduced'|'in_discussion'|'deal_done'|'dead'|'invoiced'|'paid'), commission_basis, commission_amount, commission_currency, invoiced_at, paid_at, created_by, created_at, updated_at, notes, synced_at`

---

### Task 1: Extend the intent vocabulary

**Files:**
- Modify: `src/nexpoint_engine/intents.py` (INTENT_TYPES), `tests/test_intents.py`
- Create: `supabase/migrations/0017_hub_intents.sql`

**Interfaces:**
- Produces: three new intent types, used by the boards (Task 3/4) and executed by the handlers (Task 2):
  - `review-web-request` — payload `{"request_id": 123, "status": "reviewing"|"approved"|"declined", "reason": "…optional…"}`
  - `create-introduction` — payload `{"hub": "print", "request_a": 123, "request_b": 456, "brief_id": null, "commission_basis": "…", "notes": "…"}`
  - `update-introduction` — payload `{"introduction_id": 7, "stage": "introduced", "commission_amount": 3200}` (stage and/or commission fields, all optional except id)

- [ ] **Step 1: Failing test first** — extend `tests/test_intents.py` following its existing style: the three new types are in `INTENT_TYPES`, and (matching however the existing test asserts code↔DB parity) the migration file lists them. Run `uv run pytest tests/test_intents.py -q` — FAIL.

- [ ] **Step 2: Add the types** to `INTENT_TYPES` in `intents.py` with comments in the file's established voice, e.g.:

```python
    # Hub boards (Plan C, 2026-09-01): review a website request, pair two
    # approved requests into an introduction, and move an introduction
    # through its commercial lifecycle. All Supabase-only state — the
    # engine files the workspace copies on its sync passes.
    "review-web-request",
    "create-introduction",
    "update-introduction",
```

- [ ] **Step 3: Write `0017_hub_intents.sql`** in the house style — comment block explaining why, then rebuild the constraint EXACTLY as `0015_intent_vocabulary.sql` does, with the full existing list plus the three new types, ending with the same `pg_get_constraintdef` select. Copy 0015's statement shape verbatim and extend the `check (type in (...))` list.

- [ ] **Step 4: Tests green** — `uv run pytest -q`. Commit: `git add -A && git commit -m "Hub board intent types: review-web-request, create/update-introduction"`

- [ ] **Step 5: GATE — Will applies 0017** in the Supabase SQL editor (with 0016 if not yet run).

### Task 2: Intent handlers

**Files:**
- Modify: `src/nexpoint_engine/handlers.py` (or wherever existing intent execution dispatch lives — find the `approve-lead` handler and register alongside it), `tests/` (new `tests/test_hub_intents.py`)

- [ ] **Step 1: Read the dispatch pattern.** Find how `tick-task` or `approve-lead` handlers are registered and how they reach Supabase (the engine's backend/store modules). Mirror that exactly — including journalling (G10-style run records) and the claim semantics `intents.py` documents.

- [ ] **Step 2: Failing tests** — `tests/test_hub_intents.py`, following the existing handler tests' fixture style:

```python
def test_review_web_request_updates_status(fake_backend):
    intent = make_intent("review-web-request", {"request_id": 5, "status": "approved"})
    execute(intent, backend=fake_backend)
    row = fake_backend.table("web_requests").get(5)
    assert row["status"] == "approved"
    assert row["reviewed_by"] == intent.requested_by

def test_create_introduction_assigns_ref(fake_backend):
    intent = make_intent("create-introduction", {"hub": "print", "request_a": 5, "request_b": 9,
                                                 "commission_basis": "5% per order", "notes": ""})
    execute(intent, backend=fake_backend)
    row = fake_backend.table("introductions").latest()
    assert row["ref"] == f"INTRO-{row['id']:04d}"
    assert row["stage"] == "approved"

def test_update_introduction_stamps_dates(fake_backend):
    intent = make_intent("update-introduction", {"introduction_id": 3, "stage": "paid"})
    execute(intent, backend=fake_backend)
    assert fake_backend.table("introductions").get(3)["paid_at"] is not None
```

Adapt `make_intent` / `execute` / `fake_backend` to the repo's real test helpers — the assertions are the contract. Handler rules: `review-web-request` sets `status`, `reviewed_by` (the intent's requester), `review_note` from `reason`; `create-introduction` inserts with `stage='approved'`, `created_by`=requester, then sets `ref = 'INTRO-' + zero-padded id`; `update-introduction` patches given fields, sets `updated_at`, stamps `invoiced_at` on stage `invoiced` and `paid_at` on `paid`. Reject unknown statuses/stages with the handlers' normal failure path (failed intents surface on the board, like leads.html's "Engine could not action this").

- [ ] **Step 3: Implement, tests green, commit** — `git add -A && git commit -m "Execute hub board intents: request review, introduction lifecycle"`

### Task 3: Shared board module

**Files:**
- Create: `app/hub-board.js`
- Modify: `app/admin.css` (append board classes ONLY if an equivalent class does not already exist — read it first; reuse its buttons, chips, banners, rows wherever present)

- [ ] **Step 1: Write `app/hub-board.js`.** Copy the constants + auth block (`SUPABASE_URL`, key, `ADMIN_EMAILS`, `sb`, `$`, `esc`, `boot/showLogin/doLogin/signOut/showAdmin`) from `app/leads.html` verbatim into the module top, then the board engine. Page contract and behaviour:

```js
/* Page contract:
   window.HUB = {
     hub: 'print', title: 'Print Hub',
     left:  { side: 'offer_capacity',   title: 'Hosts — offering capacity',    approveLabel: 'Approve as host' },
     right: { side: 'request_capacity', title: 'Seekers — requesting capacity', approveLabel: 'Approve request' },
   }
   Every action inserts an engine_intents row; the UI marks the card
   "Queued for the engine" until the executed intent's result lands. */
let me = null, requests = [], intros = [], pendingByReq = {}, pendingByIntro = {}, filter = 'all';

const STAGES = ['approved','introduced','in_discussion','deal_done','dead','invoiced','paid'];
const STAGE_LABEL = { approved:'APPROVED', introduced:'INTRODUCED', in_discussion:'IN DISCUSSION',
  deal_done:'DEAL DONE', dead:'DEAD', invoiced:'INVOICED', paid:'PAID' };
const SIDE_PREFIX = { offer_capacity:'H', request_capacity:'S', list_opportunity:'L', request_intro:'I' };
const reqRef = r => `${HUB.hub[0].toUpperCase()}${SIDE_PREFIX[r.side] || 'R'}-${String(r.id).padStart(4,'0')}`;

async function load(){
  $('banner').innerHTML = '';
  const rq = await sb.from('web_requests').select('*').eq('hub', HUB.hub).neq('status','archived').order('created_at', { ascending: false });
  if (rq.error){
    $('banner').innerHTML = `<div class="banner">Could not read requests: ${esc(rq.error.message)}. If this says permission denied, migration 0016 has not been run yet.</div>`;
    return;
  }
  requests = rq.data || [];
  const iq = await sb.from('introductions').select('*').eq('hub', HUB.hub).order('updated_at', { ascending: false });
  intros = iq.data || [];
  // Which rows already have an intent waiting or failed? (leads.html pattern)
  const { data: intents } = await sb.from('engine_intents')
    .select('id,type,payload_json,status,result_note')
    .in('status', ['pending','claimed','failed'])
    .in('type', ['review-web-request','create-introduction','update-introduction']);
  pendingByReq = {}; pendingByIntro = {};
  (intents || []).forEach(i => {
    const p = i.payload_json || {};
    if (p.request_id != null) pendingByReq[p.request_id] = i;
    if (p.request_a != null) pendingByReq[p.request_a] = i;
    if (p.introduction_id != null) pendingByIntro[p.introduction_id] = i;
  });
  render();
}

async function raise(type, payload, spotId, verb){
  const el = $(spotId);
  if (el) el.innerHTML = '<span class="status">Sending…</span>';
  const { error } = await sb.from('engine_intents').insert({ type, payload_json: payload, requested_by: me.email });
  if (error){ if (el) el.innerHTML = `<span class="status fail">Could not queue it: ${esc(error.message)}</span>`; return; }
  if (el) el.innerHTML = `<span class="status done">${esc(verb)} — queued for the engine.</span>`;
  setTimeout(load, 1200);
}

const reviewReq = (id, status) => raise('review-web-request', { request_id: id, status }, 'act-' + id,
  status === 'approved' ? 'Approved' : status === 'reviewing' ? 'Marked reviewing' : 'Declined');
function declineReq(id){
  const reason = prompt('Why is this declined? (recorded on the request)');
  if (reason === null) return;
  raise('review-web-request', { request_id: id, status: 'declined', reason }, 'act-' + id, 'Declined');
}
function setStage(id, stage){ raise('update-introduction', { introduction_id: id, stage }, 'iact-' + id, 'Updated'); }
function recordCommission(id){
  const current = (intros.find(x => x.id === id) || {}).commission_amount || '';
  const amount = prompt('Commission amount (numbers only, GBP):', current);
  if (amount === null) return;
  raise('update-introduction', { introduction_id: id, commission_amount: Number(amount) || 0 }, 'iact-' + id, 'Recorded');
}
```

Then `reqCard(r, col)`, `introRow(i)`, `render()`, `setFilter(f)`, the make-introduction modal (`openIntroModal(id)` listing approved requests of the opposite side, `createIntro(aId)` raising `create-introduction` with the chosen partner + commission basis + notes and the modal copy: *"This records the introduction — you send the email yourselves from Outlook, then mark it introduced here."*) — same structure as the leads board's rows and actions, styled ONLY with classes that exist in `admin.css` plus the additions of Step 2. A card with a pending/failed intent renders the leads-board treatment: pending → "Queued for the engine — it acts on its next run."; failed → the red status plus a "Try again" button re-raising the same intent.

- [ ] **Step 2: Append to `admin.css`** whatever the boards need that it lacks (candidates: a two-column `.cols` grid, status-edged `.req` cards with `--info-ink`/`warn`/`ok`/`cold` left borders, badges, the register `.table`) — using ONLY `DESIGN.md` token variables (`--bg`, `--surface`, `--fg`, `--fg-1`, `--fg-2`, `--border`, `--info-wash`, `--ok-wash`, `--warn-wash`, `--err-wash`, `--radius-sm`, `--radius-control`, `--font-body`…), matching the file's formatting. Read the whole file first; do not duplicate an existing class.

- [ ] **Step 3: Commit** — `git add app/hub-board.js app/admin.css && git commit -m "Hub board module: intent-queued request review and introductions"`

### Task 4: The four boards

**Files:**
- Create: `app/print-hub.html`, `app/mill-hub.html`, `app/opportunities.html`, `app/dashboard.html`

- [ ] **Step 1: `app/print-hub.html`.** Head + login + header + nav copied from `app/leads.html` (title "NexPoint Admin — Print Hub"), the nav being Task 5's eight-tab set with `aria-current="page"` on Print Hub. Body: toolbar (`<h1>Print Hub</h1>` + filter chips All/New/Reviewing/Approved/Declined), `#banner`, two columns (`leftTitle`/`leftCol`, `rightTitle`/`rightCol`), the introductions register table (`Ref / Party A / Party B / Stage / Commission / Manage` with `#introRows`), the note-box: *"Approving a request records your decision only — no company is ever told about another until you make the introduction yourselves and log it here."*, the modal overlay, then:

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script>
window.HUB = {
  hub: 'print', title: 'Print Hub',
  left:  { side: 'offer_capacity',   title: 'Hosts — offering capacity',    approveLabel: 'Approve as host' },
  right: { side: 'request_capacity', title: 'Seekers — requesting capacity', approveLabel: 'Approve request' },
};
</script>
<script src="hub-board.js"></script>
```

- [ ] **Step 2: `app/mill-hub.html`** — identical except titles ("Mill Hub"), `aria-current` position, and `window.HUB.hub = 'mill'` / `title: 'Mill Hub'`.

- [ ] **Step 3: `app/opportunities.html`** — identical skeleton; titles "Opportunities Hub"; a `Manage briefs` ghost-button link beside the filters pointing at the briefs board (`index.html`); and:

```js
window.HUB = {
  hub: 'opportunities', title: 'Opportunities Hub',
  left:  { side: 'list_opportunity', title: 'Listing applications — join the hub', approveLabel: 'Approve and draft brief' },
  right: { side: 'request_intro',    title: 'Introduction requests — against live briefs', approveLabel: 'Approve introduction' },
};
```

- [ ] **Step 4: `app/dashboard.html`** — same skeleton, no modal, `aria-current` on Dashboard. Stat tiles + needs-attention list exactly as the approved mock's dashboard: New requests / Awaiting approval (status `reviewing` count + oldest) / Live introductions (stage not in dead,paid; "N in active discussion") / Commission outstanding (sum of `commission_amount` where stage `invoiced`; "N invoices unpaid"). Needs-attention rows: every `new` request (→ its hub board, "Review request") and every `invoiced` introduction ("Chase payment"). Read `web_requests` + `introductions` only; inline script (no HUB module), reusing the auth block from `app/leads.html` and tile markup styled from `admin.css` tokens.

- [ ] **Step 5: Local verify** — serve the app directory (`python3 -m http.server 4399` in `app/`), sign in with Will's account (or hand him the check), walk one request through: mark reviewing → approve → make introduction → advance stage → record commission. Each action must show "queued for the engine"; after the next engine run (or `uv run nx run hourly-sync` dry-run then live with Will's go-ahead) the state lands and the queued markers clear. Console must stay clean.

- [ ] **Step 6: Commit** — `git add app/*.html && git commit -m "Hub boards: print, mill, opportunities, dashboard"`

### Task 5: Navigation + deploy to the website

**Files:**
- Modify: `app/index.html`, `app/leads.html`, `app/tasks.html`, `app/health.html` (nav blocks only)
- Modify (website repo): `admin/` — deploy copies

- [ ] **Step 1: Unify the nav** across ALL app pages to eight tabs in this order: `Dashboard · Leads · Tasks · Health · Print Hub · Mill Hub · Opportunities · Campaigns` (hrefs `dashboard.html`, `leads.html`, `tasks.html`, `health.html`, `print-hub.html`, `mill-hub.html`, `opportunities.html`, `campaigns.html`; the briefs board `index.html` is reached from the Opportunities board's "Manage briefs" button and carries no `aria-current`). `campaigns.html` is Plan D's — the tab may 404 until D lands; note it in the report.

- [ ] **Step 2: Deploy copies** — copy the changed/new `app/` files into the website repo's `admin/` (`cp app/{dashboard,print-hub,mill-hub,opportunities,leads,tasks,health,index}.html app/hub-board.js app/admin.css app/nexpoint-logo.png ../Nexpoint/website/admin/` — adjust the set to exactly what changed), on the website repo's `claude/introductions-manager` branch. This is the PRODUCT.md-sanctioned deploy path; Will's merge to main is the human approval that publishes it.

- [ ] **Step 3: Push both repos** — `git push origin claude/introductions-manager` in each.

- [ ] **Step 4: Report to Will** — built boards, the two migrations he must have applied (0016, 0017), the one behavioural note (actions execute on the engine's next hourly run — if that ever feels slow, the portal-publish-watch webhook pattern is the precedent for a faster lane), and his 2-minute test script.

## Self-review notes

- Spec §5/§6 covered; writes-as-intents honours the engine repo's architecture invariant (intents.py docstring); leads/tasks/health internals untouched (function set respected — these boards are additions, not redesigns of the frozen set).
- Statuses/stages match migration 0016's CHECK constraints; intent payload field names match Task 1's interface block everywhere they appear.

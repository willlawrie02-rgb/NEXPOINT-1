# Plan B — Request Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real form submissions from every hub land in a locked-down Supabase `web_requests` table, Will and Chris get an instant notification email, and the schema for introductions exists — with the security of the existing tables audited first.

**Architecture:** The hub forms POST JSON to the existing Cloudflare capture worker (`_system/portal-worker/`), which gains a `/requests` route: it inserts the row into Supabase using the service-role key (held as a Cloudflare secret — the public site never writes to the database directly, and the anon key gets NO access to these tables) and fires a Resend notification email. The engine (Plan D) later pulls unsynced rows down to the local folder. Pipedrive creation does NOT happen in the worker for hub requests — that moves to the engine path so the local folder stays the master copy.

**Tech Stack:** Cloudflare Workers (Wrangler), Supabase (Postgres + RLS), Resend, vanilla JS on static pages.

**Spec:** `docs/superpowers/specs/2026-09-01-platform-admin-design.md` (website repo)

## Global Constraints

- THREE repos in play: website `/Users/willlawrie/Documents/Claude/Projects/Nexpoint/website`; the old workspace `/Users/willlawrie/Documents/Claude/Projects/Nexpoint` (holds `_system/portal-worker/` — the Cloudflare worker code edited here); and the **engine repo `/Users/willlawrie/Documents/Claude/Projects/Nexpoint 2`** (`nexpoint-engine`) — the home of ALL Supabase migrations (`supabase/migrations/`, currently through 0015) and the binding acceptance spec + CLAUDE.md, which you must read before touching it. Branch `claude/request-pipeline` in each repo you touch; push only `origin claude/*`; Will merges.
- The old local engine (`_system/*.py` + launchd) is RETIRED — cloud cutover completed 2026-08-25; scheduled work runs from GitHub Actions in the engine repo. Do not add local scheduling or new `_system` scripts.
- Supabase project: `https://synywukadvjpjjxjylwk.supabase.co`. Publishable (anon) key — safe in pages, already public in `admin/leads.html`: `sb_publishable_a2-WFA1i5tqkoHy52_aGzQ_6Yx3xtNo`. Service-role key: in `_system/portal_config.json` (gitignored) as `service_role_key` — NEVER commit it, never put it in a page; in the worker it lives only as a Wrangler secret.
- Admin identities: `willlawrie@nexpoint.co.uk`, `chris@nexpoint.co.uk` (the existing `public.is_brief_admin()` function in Supabase encodes this allowlist).
- SQL cannot be executed by the session — every migration is a committed `.sql` file that WILL pastes into Supabase → SQL Editor → Run. Mark these gates clearly and wait for his confirmation.
- Golden rule: the website only collects requests. Nothing auto-connects companies, nothing auto-sends outreach. The notification email is Supabase→Resend→Will/Chris (inbound to them), which is fine.
- No emoji, British English, brand palette per `brand/design-system.md` for any visible UI text/styles.
- Plan A renames hub files (`hub/print-offer.html` → `printhub/offer.html` etc.). If Plan A has already merged, edit the new paths; if not, edit the current `hub/` paths — the JS payload contract is identical either way. Check `git log` / the file tree first.

## Interface contract (Plans C and D depend on these exact shapes)

`POST <worker>/requests` body:

```json
{
  "hub": "print | mill | opportunities",
  "side": "offer_capacity | request_capacity | list_opportunity | request_intro",
  "company": "…", "contact_name": "…", "email": "…", "phone": "…",
  "location": "…", "brief_ref": "NX-2581 or empty",
  "payload": { "any": "form-specific fields" },
  "company_url": ""   // honeypot — real users never fill it
}
```
Response: `{ "ok": true, "id": 123 }` or `{ "error": "…" }` with 4xx/5xx.

---

### Task 1: Security audit of the existing Supabase tables

**Files:**
- Create: `supabase/migrations/AUDIT-2026-09.md` and `audit_rls.sql` alongside it (ENGINE repo)

- [ ] **Step 0: Read the posture that already exists.** The engine repo's migrations `0004_board_view_rls.sql`, `0006_authenticated_access.sql`, `0007_revoke_anon_and_posture.sql` and `0012_trim_authenticated.sql` already lock the `engine_*` tables to `is_brief_admin()` and revoke anon — 0007 even defines an `engine_security_posture()` report function. Read all four first; the audit VERIFIES the live database matches them rather than assuming gaps.

- [ ] **Step 1: Write the audit query** — `audit_rls.sql` (also run `select * from engine_security_posture();` if the live DB has it):

```sql
-- RLS audit: run in Supabase SQL Editor, paste the full output back.
select t.tablename,
       t.rowsecurity as rls_enabled,
       p.policyname, p.roles, p.cmd, p.qual, p.with_check
from pg_tables t
left join pg_policies p on p.tablename = t.tablename and p.schemaname = 'public'
where t.schemaname = 'public'
order by t.tablename, p.policyname;
```

- [ ] **Step 2: GATE — Will runs it** and pastes the output back.

- [ ] **Step 3: Analyse and record.** For every table (`briefs`, `engine_lead_queue`, `engine_intents`, `engine_tasks`, `deploy_queue`, `profiles`, and anything unexpected): does it have RLS enabled? Is every policy anchored on `is_brief_admin()` or an equivalent authenticated check? Anything readable or writable by `anon` that should not be? Write findings to `AUDIT-2026-09.md` — one line per table, verdict + evidence. If gaps exist, append fix statements to the migration in Task 2 (e.g. `alter table X enable row level security;` plus a corrected policy) rather than a separate file.

- [ ] **Step 4: Commit (engine repo)** — `git add supabase/migrations/audit_rls.sql supabase/migrations/AUDIT-2026-09.md && git commit -m "RLS audit of existing Supabase tables"`

### Task 2: Schema — web_requests + introductions, locked from birth

**Files:**
- Create: `supabase/migrations/0016_web_requests.sql` (ENGINE repo — its migrations are the single home for schema; 0016 follows the existing 0015. Match the house style: a comment block explaining the why, additive statements, safe to re-run, and a final `select` so the SQL editor shows a result.)

**Interfaces:**
- Produces: tables `web_requests` and `introductions` exactly as below — Plan C reads them from the admin boards (writes travel as intents), Plan D reads them from the engine.

- [ ] **Step 1: Write the migration** — `0016_web_requests.sql` (prepend the house-style comment block explaining the hub request pipeline; `is_brief_admin()` is the repo's standard allowlist function, used by 0004/0006):

```sql
-- Web requests + introductions. Safe to re-run.
-- Access model: NO anon access at all (the capture worker writes with the
-- service role, which bypasses RLS). Admins (Will, Chris) read and manage.

create table if not exists public.web_requests (
  id           bigint generated always as identity primary key,
  created_at   timestamptz not null default now(),
  hub          text not null check (hub in ('print','mill','opportunities')),
  side         text not null check (side in
                 ('offer_capacity','request_capacity','list_opportunity','request_intro')),
  company      text,
  contact_name text,
  email        text not null,
  phone        text,
  location     text,
  brief_ref    text,
  payload      jsonb not null default '{}'::jsonb,
  status       text not null default 'new' check (status in
                 ('new','reviewing','approved','declined','archived')),
  reviewed_by  text,
  review_note  text,
  synced_at    timestamptz   -- stamped by the engine when filed locally
);

create table if not exists public.introductions (
  id                  bigint generated always as identity primary key,
  ref                 text unique,          -- 'INTRO-0042', set by the admin UI after insert
  hub                 text not null check (hub in ('print','mill','opportunities')),
  request_a           bigint references public.web_requests(id),
  request_b           bigint references public.web_requests(id),
  brief_id            text,                 -- briefs.id when hub = 'opportunities'
  stage               text not null default 'approved' check (stage in
                        ('approved','introduced','in_discussion','deal_done','dead','invoiced','paid')),
  commission_basis    text,
  commission_amount   numeric,
  commission_currency text not null default 'GBP',
  invoiced_at         date,
  paid_at             date,
  created_by          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  notes               text,
  synced_at           timestamptz
);

alter table public.web_requests  enable row level security;
alter table public.introductions enable row level security;

drop policy if exists web_requests_admin on public.web_requests;
create policy web_requests_admin on public.web_requests
  for all to authenticated using (public.is_brief_admin()) with check (public.is_brief_admin());

drop policy if exists introductions_admin on public.introductions;
create policy introductions_admin on public.introductions
  for all to authenticated using (public.is_brief_admin()) with check (public.is_brief_admin());

-- No policy for anon: anon can do nothing on either table. Deliberate.

-- LAST statement so the editor shows it.
select count(*) as web_requests_ready from public.web_requests;
```

- [ ] **Step 2: GATE — Will runs the migration** (plus any audit fixes appended in Task 1) in the SQL Editor and confirms "Success".

- [ ] **Step 3: Verify the lock** — with the anon key, both reads must fail or return nothing:

```bash
curl -s "https://synywukadvjpjjxjylwk.supabase.co/rest/v1/web_requests?select=id" \
  -H "apikey: sb_publishable_a2-WFA1i5tqkoHy52_aGzQ_6Yx3xtNo" \
  -H "Authorization: Bearer sb_publishable_a2-WFA1i5tqkoHy52_aGzQ_6Yx3xtNo"
```
Expected: `[]` or a permission error — anything but rows.

- [ ] **Step 4: Commit (engine repo)** — `git add supabase/migrations/0016_web_requests.sql && git commit -m "0016: web_requests and introductions, admin-only RLS"`

### Task 3: Worker `/requests` route

**Files:**
- Modify: `_system/portal-worker/worker.js` (194 lines today), `_system/portal-worker/wrangler.toml`, `_system/portal-worker/README.md`

- [ ] **Step 1: Add the route.** In `worker.js`, the default export's `fetch` currently handles one POST shape. Restructure minimally: at the top of `fetch`, after the OPTIONS/POST checks, branch on path:

```js
const url = new URL(request.url);
if (url.pathname === "/requests") return handleWebRequest(request, env, ctx, origin);
// existing behaviour (old portal capture -> Pipedrive) continues below, unchanged
```

Then add (reusing the existing `json`, `esc`, and `notify` helpers already in the file):

```js
const VALID_HUBS = ["print", "mill", "opportunities"];
const VALID_SIDES = ["offer_capacity", "request_capacity", "list_opportunity", "request_intro"];

async function handleWebRequest(request, env, ctx, origin) {
  let p;
  try { p = await request.json(); } catch { return json({ error: "bad json" }, 400, origin); }
  if (p.company_url) return json({ ok: true }, 200, origin); // honeypot
  if (!p.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email))
    return json({ error: "valid email required" }, 422, origin);
  if (!VALID_HUBS.includes(p.hub) || !VALID_SIDES.includes(p.side))
    return json({ error: "unknown hub or side" }, 422, origin);

  const row = {
    hub: p.hub, side: p.side,
    company: (p.company || "").trim().slice(0, 200),
    contact_name: (p.contact_name || "").trim().slice(0, 200),
    email: p.email.trim().slice(0, 200),
    phone: (p.phone || "").trim().slice(0, 50),
    location: (p.location || "").trim().slice(0, 200),
    brief_ref: (p.brief_ref || "").replace(/^BRIEF\s+/i, "").trim().slice(0, 20),
    payload: (p.payload && typeof p.payload === "object") ? p.payload : {},
  };

  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/web_requests`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(row),
  });
  if (!r.ok) return json({ error: `store failed (${r.status})` }, 502, origin);
  const [saved] = await r.json();

  const SIDE_LABEL = {
    offer_capacity: "Offer to host capacity", request_capacity: "Capacity requested",
    list_opportunity: "Listing application", request_intro: "Introduction requested",
  };
  const subject = `[NexPoint ${p.hub} hub] ${SIDE_LABEL[p.side]} — ${row.company || row.contact_name || row.email}`;
  const detail = Object.entries(row.payload).map(([k, v]) => `${esc(k)}: ${esc(String(v))}`).join("<br>");
  const html = `<p><strong>${esc(SIDE_LABEL[p.side])}</strong> on the ${esc(p.hub)} hub.</p>
<p>${esc(row.contact_name)} · ${esc(row.company)} · ${esc(row.email)} · ${esc(row.phone)}<br>
${esc(row.location)}${row.brief_ref ? ` · brief ${esc(row.brief_ref)}` : ""}</p>
${detail ? `<p>${detail}</p>` : ""}
<p>Request #${saved.id} — manage it in the <a href="https://nexpoint.co.uk/admin/">admin workspace</a>.</p>`;
  ctx.waitUntil(notify(env, { subject, html, replyTo: row.email }));

  return json({ ok: true, id: saved.id }, 200, origin);
}
```

- [ ] **Step 2: Config.** In `wrangler.toml` `[vars]` add `SUPABASE_URL = "https://synywukadvjpjjxjylwk.supabase.co"`. Update `ALLOWED_ORIGIN` handling: the subdomains must be allowed too — change the `json` helper's origin to echo the request's `Origin` header when it is one of `https://nexpoint.co.uk`, `https://printhub.nexpoint.co.uk`, `https://millhub.nexpoint.co.uk`, `https://opportunities.nexpoint.co.uk` (keep a `const ALLOWED = new Set([...])` at top; fall back to `https://nexpoint.co.uk`). Document `SUPABASE_SERVICE_KEY` in the README's secrets list.

- [ ] **Step 3: Local test**

```bash
cd /Users/willlawrie/Documents/Claude/Projects/Nexpoint/_system/portal-worker
npx wrangler dev --local   # local mode: secrets via .dev.vars (SUPABASE_SERVICE_KEY=... from portal_config.json; add .dev.vars to .gitignore)
curl -s -X POST http://localhost:8787/requests -H 'Content-Type: application/json' \
  -d '{"hub":"print","side":"request_capacity","email":"test@example.com","company":"Test Co","contact_name":"Test","payload":{"volume":"40/month"}}'
```
Expected: `{"ok":true,"id":N}`. Verify the row landed (service key read):

```bash
curl -s "https://synywukadvjpjjxjylwk.supabase.co/rest/v1/web_requests?select=id,hub,side,company&order=id.desc&limit=1" \
  -H "apikey: $(python3 -c "import json;print(json.load(open('/Users/willlawrie/Documents/Claude/Projects/Nexpoint/_system/portal_config.json'))['service_role_key'])")" \
  -H "Authorization: Bearer $(python3 -c "import json;print(json.load(open('/Users/willlawrie/Documents/Claude/Projects/Nexpoint/_system/portal_config.json'))['service_role_key'])")"
```
Then also test: honeypot filled → `{ok:true}` with NO new row; bad email → 422; bad hub → 422.

- [ ] **Step 4: Deploy** — `npx wrangler secret put SUPABASE_SERVICE_KEY` (paste from `portal_config.json`; if wrangler is not logged in this is a WILL step), then `npx wrangler deploy`. Repeat the curl test against the deployed `workers.dev` URL and note that URL — it is `CAPTURE_REQUESTS_URL` for Task 5.

- [ ] **Step 5: Commit** — `git add _system/portal-worker && git commit -m "Worker: /requests route stores hub submissions and notifies"`

### Task 4: Notification email — Resend

- [ ] **Step 1: Establish state with Will.** The worker already has `NOTIFY_TO`/`NOTIFY_FROM` vars and an optional `RESEND_API_KEY` secret. Ask Will: does a Resend account exist with `nexpoint.co.uk` verified? If yes and the secret is set, skip to Step 3.

- [ ] **Step 2: WILL's steps (write them to him exactly):** create a free account at resend.com → Domains → Add `nexpoint.co.uk` → add the DKIM/SPF records it lists in Cloudflare DNS (after Plan A's cut-over; before it, add them at Namecheap) → wait for Verified → create an API key → run `cd _system/portal-worker && npx wrangler secret put RESEND_API_KEY` and paste it.

- [ ] **Step 3: Verify** — POST a real test request to the deployed `/requests` endpoint (as Task 3 Step 3) and confirm with Will that the notification email arrived at `hello@nexpoint.co.uk` with the request details and admin link.

### Task 5: Wire the hub forms

**Files:**
- Modify: `hub/assets/portal.js` (functions `introSubmit` ~line 580, `joinSubmit` ~line 591 — currently mock success screens marked "(Draft note: nothing was actually sent.)"), and the offer-page forms `printhub/offer.html` + `millhub/offer.html` (or `hub/print-offer.html` + `hub/mill-offer.html` pre-Plan-A — check which exists). If Plan A has merged, `portal.js` exists as THREE copies (`printhub/assets/`, `millhub/assets/`, `hub/assets/`) — apply identical edits to every copy found by `grep -rln 'introSubmit' --include='*.js'`.

- [ ] **Step 1: Add the sender at the top of portal.js**

```js
/* Live capture endpoint — the Cloudflare worker's /requests route. */
const CAPTURE_REQUESTS_URL = 'https://nexpoint-portal-capture.<ACCOUNT>.workers.dev/requests'; // exact URL from Plan B Task 3 Step 4

function hubOfPage(){
  const h = location.hostname;
  if (h.startsWith('printhub')) return 'print';
  if (h.startsWith('millhub')) return 'mill';
  if (h.startsWith('opportunities')) return 'opportunities';
  // local preview / pre-cutover paths:
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
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok && data.ok) onOk(); else onFail();
  } catch { onFail(); }
}
```

- [ ] **Step 2: Make introSubmit real.** Replace the body of `introSubmit(e)` (keep the existing success markup, minus the "(Draft note: nothing was actually sent.)" line):

```js
function introSubmit(e){
  e.preventDefault();
  const form = e.target;
  const fields = serializeForm(form);
  const btn = form.querySelector('button[type="submit"]');
  if (btn){ btn.disabled = true; btn.textContent = 'Sending your request'; }
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
    if (btn){ btn.disabled = false; btn.textContent = 'Request the introduction'; }
    let err = form.querySelector('.form-error');
    if (!err){ err = document.createElement('p'); err.className = 'form-error'; err.style.cssText = 'color:#E5484D;font-size:13px;margin-top:10px'; form.appendChild(err); }
    err.textContent = 'That did not go through — please try again, or email hello@nexpoint.co.uk.';
  });
  return false;
}
```

- [ ] **Step 3: Make joinSubmit real** — same structure; `side: 'offer_capacity'`, success copy kept from the current mock (minus the draft note), failure handling identical. `joinSubmit` is used both by `portal.js` and inline in the offer pages (`<form onsubmit="return joinSubmit(event)">` in `offer.html` — the function there is defined in the page's own script block; apply the same replacement there, reading that page's actual field ids from its own markup with `serializeForm` so no id guessing is needed: pass `company: fields.<the company field id>` after checking `grep -n 'id=' <file>` for the form's inputs, mapping name/company/email/phone/location fields by their obvious ids and putting everything else in `payload`).

- [ ] **Step 4: Opportunities hub forms** — in `opportunities/index.html` (post-Plan-A), find the existing enquiry/post/membership forms (search `onsubmit`); repoint their handlers to `sendRequest` with `hub:'opportunities'` and `side:'request_intro'` (enquiry with a brief ref), `side:'list_opportunity'` (posting an opportunity). Leave the membership/auth flow on its existing old-worker endpoint — accounts are out of this plan's scope.

- [ ] **Step 5: Test end to end locally** — `python3 -m http.server 4399` in the website repo; open each form, submit a test with email `test+localhost@example.com`; verify `{ok:true}` in the network tab, the success screen (no draft note), the Supabase row, and the notification email. Also verify the failure path by temporarily pointing `CAPTURE_REQUESTS_URL` at an invalid URL — the error line must appear and the button re-enable. Point it back.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "Wire hub forms to the live capture endpoint"`

### Task 6: Security hardening switches — Will's checklist

- [ ] **Step 1: Write the checklist to Will** (these are dashboard settings, not code):
  1. Supabase → Authentication → Settings: enable **leaked password protection**; confirm rate limits are on.
  2. Supabase → Authentication → both admin users: enrol **MFA (TOTP)** — one at a time, Will then Chris.
  3. The **Supabase dashboard account itself**: enable 2FA on the account that owns the project.
  4. Cloudflare account: enable 2FA.
- [ ] **Step 2: Record completion** in `_system/portal-admin/AUDIT-2026-09.md` (append a dated "hardening applied" section listing what Will confirmed).
- [ ] **Step 3: Commit and push both repos** — `git push origin claude/request-pipeline` (each repo). Report to Will: what is live, the worker URL, and that Plan D can now build the engine pull.

## Self-review notes

- Spec coverage: §4 (pipeline: instant email + queue), §9 (both tables), §10 items 1–5 (audit Task 1, lock-from-birth Task 2, MFA + switches Task 6, secrets server-side throughout). The engine hourly pull is Plan D's, deliberately.
- The old portal's direct-to-Pipedrive worker path is left running untouched until Plan A retires the portal; hub requests use the new store-first path. No double-creation: the two paths never handle the same submission.

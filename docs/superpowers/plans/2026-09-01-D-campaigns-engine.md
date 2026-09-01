# Plan D — Campaign Manager & Engine Jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Smartlead campaign stats and mailbox warmup flow into Supabase and the admin Campaigns page (with human-click start/pause/stop), and the engine pulls every web request and introduction down to the local Nexpoint folder — the master copy — filing new requests as leads and syncing them to Pipedrive.

**Architecture:** Two Python scripts in `_system/` (the engine's home) follow the existing `portal_sync.py` REST pattern against Supabase: `smartlead_sync.py` (Smartlead API → Supabase + local archive) and `web_requests_sync.py` (Supabase → `leads/` folders + Pipedrive via the existing `create_pipedrive_lead`, plus an introductions register archive). A new launchd agent runs them every 15 minutes. Start/pause/stop goes through a new route on the existing Cloudflare capture worker, which verifies the caller is Will or Chris via their Supabase session token before touching the Smartlead API — the key never reaches the browser.

**Tech Stack:** Python 3 (stdlib + `requests` if already used, else `urllib`), Smartlead REST API, Cloudflare Workers, Supabase, launchd, vanilla JS admin page.

**Spec:** `docs/superpowers/specs/2026-09-01-platform-admin-design.md` (website repo)

## Global Constraints

- Parent repo `/Users/willlawrie/Documents/Claude/Projects/Nexpoint` (holds `_system/`, `leads/`, `data/`); website repo `/Users/willlawrie/Documents/Claude/Projects/Nexpoint/website`. Branch `claude/campaigns-engine` in both; push only `origin claude/*`; Will merges.
- Secrets: `_system/smartlead_config.json` (NEW, add to the parent repo's `.gitignore` alongside `portal_config.json`) shaped `{ "api_key": "..." }`. Supabase service key already in `_system/portal_config.json` (gitignored). Never commit either; in the worker, keys live only as Wrangler secrets.
- Campaign start/pause/stop is ALWAYS a human click by Will or Chris in the admin page. No script in this plan may change a campaign's state — the sync is read-only against Smartlead.
- The engine only CREATES under `leads/` — the guardrail denies deleting or moving `deals/`/`leads/` data, and that is correct. Before writing lead-filing code, read `_system/reference/adding-a-deal.md`, `_system/reference/lead-pipeline.md` and `_templates/profile.md` — the shapes below follow them, but those documents are the authority if anything conflicts.
- All launchd agents were deliberately disabled in August 2026 (files in `~/Library/LaunchAgents/` renamed `*.DISABLED-*`). Do NOT re-enable any of them. Create only the one new agent below, and confirm with Will before loading it.
- Brand rules for the admin page: light canvas, Montserrat/Inter, no emoji, British English, verb-first CTAs (`brand/design-system.md`).
- Coordinates with Plan B (tables `web_requests`/`introductions` + worker file `_system/portal-worker/worker.js`) and Plan C (`admin/assets/admin-light.css` + nav). Worker edits: Plan B adds `/requests`, this plan adds `/smartlead/*` — if editing concurrently, rebase carefully; the routes are disjoint.

---

### Task 1: Verify the Smartlead API and record real shapes

- [ ] **Step 1: GATE — get the API key from Will** (Smartlead → Settings → API). Write `_system/smartlead_config.json` with it; add the filename to the parent repo `.gitignore` and commit the `.gitignore` change only.

- [ ] **Step 2: Probe the documented endpoints** (base `https://server.smartlead.ai/api/v1`, auth via `?api_key=`):

```bash
KEY=$(python3 -c "import json;print(json.load(open('_system/smartlead_config.json'))['api_key'])")
curl -s "https://server.smartlead.ai/api/v1/campaigns?api_key=$KEY" | python3 -m json.tool | head -40
# then, with a real campaign id from the list:
curl -s "https://server.smartlead.ai/api/v1/campaigns/<ID>/analytics?api_key=$KEY" | python3 -m json.tool
curl -s "https://server.smartlead.ai/api/v1/email-accounts?api_key=$KEY&offset=0&limit=25" | python3 -m json.tool | head -60
```

- [ ] **Step 3: Record what came back** in `_system/reference/smartlead-api.md`: the exact field names for campaign id/name/status, the analytics counters (sent/open/reply/bounce — note whether they are counts or unique counts), and the email-account warmup fields (`warmup_details` or similar: score/status). **The code in Tasks 2 and 4 uses the documented names below — correct them to the observed names before implementing if they differ.** Commit the reference file.

### Task 2: Campaign tables + sync script

**Files:**
- Create: `_system/portal-admin/0008_campaigns.sql`, `_system/smartlead_sync.py`

**Interfaces:**
- Produces: tables `campaigns`, `campaign_stats`, `mailbox_warmup` — the admin Campaigns page (Task 5) reads them.

- [ ] **Step 1: Write `0008_campaigns.sql`** (Will runs it in the SQL Editor — GATE):

```sql
-- Smartlead mirror. Written by the engine (service role); admins read. Safe to re-run.
create table if not exists public.campaigns (
  id          bigint primary key,          -- Smartlead campaign id
  name        text,
  status      text,                        -- Smartlead's own status string
  sent        int, opened int, replied int, bounced int,
  synced_at   timestamptz
);
create table if not exists public.campaign_stats (
  id          bigint generated always as identity primary key,
  campaign_id bigint not null,
  captured_at timestamptz not null default now(),
  sent        int, opened int, replied int, bounced int
);
create table if not exists public.mailbox_warmup (
  email        text primary key,
  warmup_score int,
  status       text,
  synced_at    timestamptz
);
alter table public.campaigns      enable row level security;
alter table public.campaign_stats enable row level security;
alter table public.mailbox_warmup enable row level security;
drop policy if exists campaigns_admin_read on public.campaigns;
create policy campaigns_admin_read on public.campaigns for select to authenticated using (public.is_brief_admin());
drop policy if exists campaign_stats_admin_read on public.campaign_stats;
create policy campaign_stats_admin_read on public.campaign_stats for select to authenticated using (public.is_brief_admin());
drop policy if exists mailbox_warmup_admin_read on public.mailbox_warmup;
create policy mailbox_warmup_admin_read on public.mailbox_warmup for select to authenticated using (public.is_brief_admin());
-- No insert/update policies: only the service role (engine) writes. No anon anything.
```

- [ ] **Step 2: Write `_system/smartlead_sync.py`** (follow `portal_sync.py`'s config/request style — it uses stdlib `urllib`; check its `sb_request` at line ~95 and mirror it):

```python
#!/usr/bin/env python3
"""Smartlead -> Supabase + local archive. READ-ONLY against Smartlead.

Pulls every campaign's headline stats and every mailbox's warmup state,
upserts them into Supabase (campaigns / campaign_stats / mailbox_warmup)
for the admin Campaigns page, and archives the raw pull to
data/smartlead/YYYY-MM-DD_HHMM.json so the local folder stays the master copy.

Never changes campaign state. Start/pause/stop is a human click in the admin
page, via the capture worker's /smartlead/control route.
"""
import json, os, sys, urllib.request, urllib.parse
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SL_BASE = "https://server.smartlead.ai/api/v1"

def load_json(path):
    with open(path) as f:
        return json.load(f)

def sl_get(key, path, params=None):
    q = {"api_key": key}
    if params: q.update(params)
    url = f"{SL_BASE}{path}?{urllib.parse.urlencode(q)}"
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.loads(r.read().decode())

def sb_request(cfg, method, path, body=None, prefer=None):
    url = cfg["supabase_url"].rstrip("/") + "/rest/v1/" + path
    headers = {
        "apikey": cfg["service_role_key"],
        "Authorization": f"Bearer {cfg['service_role_key']}",
        "Content-Type": "application/json",
    }
    if prefer: headers["Prefer"] = prefer
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read().decode()
        return json.loads(raw) if raw else None

def main():
    sb_cfg = load_json(os.path.join(ROOT, "_system", "portal_config.json"))
    sl_cfg = load_json(os.path.join(ROOT, "_system", "smartlead_config.json"))
    key = sl_cfg["api_key"]
    now = datetime.now(timezone.utc).isoformat()

    campaigns = sl_get(key, "/campaigns") or []
    archive = {"pulled_at": now, "campaigns": [], "mailboxes": []}
    for c in campaigns:
        cid = c.get("id")
        stats = sl_get(key, f"/campaigns/{cid}/analytics") or {}
        # Field names verified against _system/reference/smartlead-api.md (Task 1).
        row = {
            "id": cid,
            "name": c.get("name"),
            "status": c.get("status"),
            "sent": int(stats.get("sent_count") or 0),
            "opened": int(stats.get("open_count") or 0),
            "replied": int(stats.get("reply_count") or 0),
            "bounced": int(stats.get("bounce_count") or 0),
            "synced_at": now,
        }
        sb_request(sb_cfg, "POST", "campaigns?on_conflict=id", body=[row],
                   prefer="resolution=merge-duplicates,return=minimal")
        snap = {k: row[k] for k in ("sent", "opened", "replied", "bounced")}
        snap["campaign_id"] = cid
        sb_request(sb_cfg, "POST", "campaign_stats", body=[snap], prefer="return=minimal")
        archive["campaigns"].append({"campaign": c, "analytics": stats})

    accounts = sl_get(key, "/email-accounts", {"offset": 0, "limit": 100}) or []
    for a in accounts:
        wu = a.get("warmup_details") or {}
        row = {
            "email": a.get("from_email") or a.get("email"),
            "warmup_score": int(wu.get("warmup_reputation") or 0),
            "status": wu.get("status") or "",
            "synced_at": now,
        }
        if row["email"]:
            sb_request(sb_cfg, "POST", "mailbox_warmup?on_conflict=email", body=[row],
                       prefer="resolution=merge-duplicates,return=minimal")
            archive["mailboxes"].append(a)

    out_dir = os.path.join(ROOT, "data", "smartlead")
    os.makedirs(out_dir, exist_ok=True)
    stamp = datetime.now().strftime("%Y-%m-%d_%H%M")
    with open(os.path.join(out_dir, f"{stamp}.json"), "w") as f:
        json.dump(archive, f, indent=2)
    print(f"smartlead-sync: {len(campaigns)} campaigns, {len(accounts)} mailboxes, archived {stamp}.json")

if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Reconcile field names** against `_system/reference/smartlead-api.md` from Task 1 (the `sent_count`-style names and `warmup_reputation` are the documented ones — replace with the observed names if they differ, and update the reference file to say the code matches).

- [ ] **Step 4: Run it** — `python3 _system/smartlead_sync.py`. Expected: the summary line, rows in Supabase (`select * from campaigns` via the SQL editor or a service-key curl), and the archive file under `data/smartlead/`. Re-run: no duplicate campaign rows (upsert), one new stats snapshot per campaign per run.

- [ ] **Step 5: Commit** — `git add _system/portal-admin/0008_campaigns.sql _system/smartlead_sync.py _system/reference/smartlead-api.md && git commit -m "Smartlead read-only sync into Supabase with local archive"`

### Task 3: Web requests → local folder → Pipedrive

**Files:**
- Create: `_system/web_requests_sync.py`

**Interfaces:**
- Consumes: `web_requests` / `introductions` (Plan B), `create_pipedrive_lead(company_name, profile_text, api_token, source)` from `_system/pipedrive_sync.py` (line ~224), `_templates/profile.md`.
- Produces: `leads/{slug}/profile.md` + `leads/{slug}/notes/YYYY-MM-DD_web-request.md`, `data/introductions/register.json`, and `synced_at` stamps.

- [ ] **Step 1: Write `_system/web_requests_sync.py`**:

```python
#!/usr/bin/env python3
"""Pull web requests + introductions down from Supabase.

The local Nexpoint folder is the master copy: every hub submission becomes a
lead folder (profile + note) exactly as a manually-added lead would, then the
row is stamped synced_at. Introductions are archived to
data/introductions/register.json on every run.

Creation only — this script never deletes or moves anything under leads/.
"""
import json, os, re, sys, urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "_system"))

def load_cfg():
    with open(os.path.join(ROOT, "_system", "portal_config.json")) as f:
        return json.load(f)

def sb_request(cfg, method, path, body=None, prefer=None):
    url = cfg["supabase_url"].rstrip("/") + "/rest/v1/" + path
    headers = {"apikey": cfg["service_role_key"],
               "Authorization": f"Bearer {cfg['service_role_key']}",
               "Content-Type": "application/json"}
    if prefer: headers["Prefer"] = prefer
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read().decode()
        return json.loads(raw) if raw else None

def slugify(name):
    s = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
    return s or "unnamed-company"

SIDE_LABEL = {
    "offer_capacity": "Offering capacity on the hub",
    "request_capacity": "Requesting capacity from the hub",
    "list_opportunity": "Applying to list an opportunity",
    "request_intro": "Requesting an introduction",
}
HUB_LABEL = {"print": "Print Hub", "mill": "Mill Hub", "opportunities": "Opportunities Hub"}

def profile_md(r, today):
    payload = "\n".join(f"- **{k}:** {v}" for k, v in (r.get("payload") or {}).items())
    return f"""# {r.get('company') or r.get('contact_name') or r.get('email')}

> **Stage:** `prospect`
> **Last updated:** {today}
> **Source:** web-research

## What They Do
Submitted via the {HUB_LABEL.get(r['hub'], r['hub'])} website form — {SIDE_LABEL.get(r['side'], r['side'])}.
{('Location: ' + r['location']) if r.get('location') else ''}

## What They're Looking For
{SIDE_LABEL.get(r['side'], r['side'])}{(' · brief ' + r['brief_ref']) if r.get('brief_ref') else ''}
{payload}

## Fit for NexPoint
Inbound hub request #{r['id']} — review in the admin workspace ({HUB_LABEL.get(r['hub'])} page).

## Commercial Agreement
| Item | Detail |
|------|--------|
| Structure | TBC |
| Rate | TBC |
| Products covered | TBC |
| Status | TBC |
| Open blockers | Awaiting review of hub request |

## Key Contacts
| Name | Role | Email | Phone | Notes |
|------|------|-------|-------|-------|
| {r.get('contact_name') or '—'} | — | {r.get('email')} | {r.get('phone') or '—'} | From hub form |

## Territory & Market
- **HQ:** {r.get('location') or 'TBC'}

## Sector Tags
`{r['hub']}-hub` `web-request`
"""

def note_md(r, today):
    facts = " · ".join(f"{k}: {v}" for k, v in (r.get("payload") or {}).items())
    return f"""**Hub request received — {HUB_LABEL.get(r['hub'])}**

{SIDE_LABEL.get(r['side'], r['side'])} from {r.get('contact_name') or 'unknown contact'} ({r.get('email')}).
{facts}

Filed automatically from web_requests row {r['id']} on {today}. Review and approval happen in the admin workspace; no contact has been made.
"""

def main():
    dry = "--dry-run" in sys.argv
    cfg = load_cfg()
    today = datetime.now().strftime("%Y-%m-%d")
    now = datetime.now(timezone.utc).isoformat()

    rows = sb_request(cfg, "GET", "web_requests?synced_at=is.null&order=id.asc") or []
    filed = 0
    for r in rows:
        slug = slugify(r.get("company") or r.get("contact_name") or f"web-{r['id']}")
        lead_dir = os.path.join(ROOT, "leads", slug)
        deal_dir = os.path.join(ROOT, "deals", slug)
        if os.path.isdir(deal_dir) or os.path.isdir(lead_dir):
            target = deal_dir if os.path.isdir(deal_dir) else lead_dir
            notes_dir = os.path.join(target, "notes")
            os.makedirs(notes_dir, exist_ok=True)
            note_path = os.path.join(notes_dir, f"{today}_web-request-{r['id']}.md")
            if not dry:
                with open(note_path, "w") as f: f.write(note_md(r, today))
        else:
            notes_dir = os.path.join(lead_dir, "notes")
            if not dry:
                os.makedirs(notes_dir, exist_ok=True)
                with open(os.path.join(lead_dir, "profile.md"), "w") as f:
                    f.write(profile_md(r, today))
                with open(os.path.join(notes_dir, f"{today}_web-request-{r['id']}.md"), "w") as f:
                    f.write(note_md(r, today))
        if not dry:
            sb_request(cfg, "PATCH", f"web_requests?id=eq.{r['id']}",
                       body={"synced_at": now}, prefer="return=minimal")
        filed += 1
        print(f"filed request {r['id']} -> {slug}{' (dry)' if dry else ''}")

    intros = sb_request(cfg, "GET", "introductions?order=id.asc") or []
    reg_dir = os.path.join(ROOT, "data", "introductions")
    if not dry:
        os.makedirs(reg_dir, exist_ok=True)
        with open(os.path.join(reg_dir, "register.json"), "w") as f:
            json.dump({"pulled_at": now, "introductions": intros}, f, indent=2)
    print(f"web-requests-sync: {filed} filed, {len(intros)} introductions archived")

if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Dry-run against the Plan B test rows** — `python3 _system/web_requests_sync.py --dry-run` prints what it would file without writing. Then run live: verify `leads/test-co/profile.md` + note exist and match the templates' shape, `synced_at` is stamped (row no longer returned), and `data/introductions/register.json` exists. Re-run: nothing re-files (idempotent via synced_at).

- [ ] **Step 3: Pipedrive hand-off decision (read before wiring).** `_system/pipedrive_sync.py` line ~224 has `create_pipedrive_lead(company_name, profile_text, api_token, source="web")`. Read `_system/reference/lead-pipeline.md` first: if the documented flow is that the daily engine sync discovers new `leads/` folders and creates Pipedrive leads itself, do NOT call Pipedrive here — filing the folder is enough, and note that in the script's docstring. Only if no such discovery exists, append a call to `create_pipedrive_lead` (import from `pipedrive_sync`, token from `pipedrive_config.json`, wrapped in try/except so a Pipedrive failure never blocks local filing) and record the returned id in the profile per `inject_pipedrive_id` (line ~312). Document which branch was taken in the commit message.

- [ ] **Step 4: Commit** — `git add _system/web_requests_sync.py && git commit -m "Engine: pull web requests to local lead folders and archive introductions"`

### Task 4: Worker control route (human-click start/pause/stop)

**Files:**
- Modify: `_system/portal-worker/worker.js`, `_system/portal-worker/wrangler.toml`, `_system/portal-worker/README.md`

- [ ] **Step 1: Add the route.** In the fetch handler's path branch (Plan B adds `/requests`; add alongside):

```js
if (url.pathname === "/smartlead/control") return handleSmartleadControl(request, env, origin);
```

And the handler:

```js
const SL_ACTIONS = { start: "START", pause: "PAUSED", stop: "STOPPED" };
const CONTROL_ADMINS = ["willlawrie@nexpoint.co.uk", "chris@nexpoint.co.uk"];

async function handleSmartleadControl(request, env, origin) {
  // Caller must be a signed-in admin: verify their Supabase access token.
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "sign in required" }, 401, origin);
  const who = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (!who.ok) return json({ error: "sign in required" }, 401, origin);
  const user = await who.json();
  if (!CONTROL_ADMINS.includes((user.email || "").toLowerCase()))
    return json({ error: "not an admin" }, 403, origin);

  let p;
  try { p = await request.json(); } catch { return json({ error: "bad json" }, 400, origin); }
  const status = SL_ACTIONS[p.action];
  const id = Number(p.campaign_id);
  if (!status || !id) return json({ error: "action (start|pause|stop) and campaign_id required" }, 422, origin);

  const r = await fetch(
    `https://server.smartlead.ai/api/v1/campaigns/${id}/status?api_key=${env.SMARTLEAD_API_KEY}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) },
  );
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return json({ error: `smartlead ${r.status}: ${JSON.stringify(data)}` }, 502, origin);
  return json({ ok: true, action: p.action, campaign_id: id, by: user.email }, 200, origin);
}
```

- [ ] **Step 2: Config** — `wrangler.toml` `[vars]`: add `SUPABASE_ANON_KEY = "sb_publishable_a2-WFA1i5tqkoHy52_aGzQ_6Yx3xtNo"` (and `SUPABASE_URL` if Plan B has not added it). Secret: `npx wrangler secret put SMARTLEAD_API_KEY`. Verify the status endpoint's exact path/body against `_system/reference/smartlead-api.md` (Task 1) before deploying — Smartlead documents `POST /campaigns/{id}/status` with `{"status": "PAUSED"|"START"|"STOPPED"}`; if the observed API differs, follow the observation and update the reference.

- [ ] **Step 3: Test** — `npx wrangler dev --local` with `.dev.vars`; curl without a token → 401; with a non-admin token → 403; with Will's real session token (grab from the admin page: `(await sb.auth.getSession()).data.session.access_token` in the browser console) and a real campaign id + `action:"pause"` → `{ok:true}` and the campaign shows Paused in Smartlead; then `action:"start"` to restore it. Get Will's explicit go-ahead before touching a LIVE campaign — use a draft campaign if one exists.

- [ ] **Step 4: Deploy and commit** — `npx wrangler deploy`; `git add _system/portal-worker && git commit -m "Worker: admin-gated Smartlead start/pause/stop route"`

### Task 5: Admin Campaigns page

**Files:**
- Create: `admin/campaigns.html` (website repo, branch `claude/campaigns-engine`)

- [ ] **Step 1: Write it** following Plan C's page skeleton exactly (login block, header, the same 8-tab nav with `aria-current` on `campaigns.html`, `assets/admin-light.css`, supabase CDN, inline copies of the `boot/doLogin/signOut/esc` pattern from `admin/leads.html` with the light-page ids). If Plan C has not merged yet, also copy `admin/assets/admin-light.css` from that plan's Task 1 into this branch — identical content, so the merge is clean. Body after nav:

```html
<div class="toolbar">
  <h1>Campaigns</h1>
  <span class="ref" id="syncedAt"></span>
</div>
<div id="banner"></div>
<div id="campaignCards"></div>
<div class="eyebrow">Mailbox warmup</div>
<div class="table"><table>
  <thead><tr><th>Mailbox</th><th>Warmup score</th><th>Status</th></tr></thead>
  <tbody id="warmupRows"></tbody>
</table></div>
```

Logic (`CONTROL_URL` is the deployed worker + `/smartlead/control`):

```js
const CONTROL_URL = 'https://nexpoint-portal-capture.<ACCOUNT>.workers.dev/smartlead/control'; // exact URL from Task 4
async function load(){
  const cq = await sb.from('campaigns').select('*').order('name');
  if (cq.error){ $('banner').innerHTML = `<div class="banner">Could not read campaigns: ${esc(cq.error.message)}. Run migration 0008 and the first sync.</div>`; return; }
  const camps = cq.data || [];
  const synced = camps.map(c => c.synced_at).sort().pop();
  $('syncedAt').textContent = synced ? `Smartlead · synced ${new Date(synced).toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit'})}` : 'Not yet synced';
  const pct = (n, d) => d ? (100 * n / d).toFixed(1) + '%' : '—';
  const stateCls = s => /activ|start|progress/i.test(s || '') ? 's-approved' : /paus/i.test(s || '') ? 's-reviewing' : 's-declined';
  const badgeCls = s => /activ|start|progress/i.test(s || '') ? 'b-approved' : /paus/i.test(s || '') ? 'b-reviewing' : 'b-declined';
  $('campaignCards').innerHTML = camps.length ? camps.map(c => `
    <div class="req ${stateCls(c.status)}" style="margin-bottom:14px">
      <div class="req-top" style="justify-content:space-between">
        <div style="display:flex;align-items:center;gap:10px">
          <span class="badge ${badgeCls(c.status)}">${esc((c.status || 'UNKNOWN').toUpperCase())}</span>
          <h3 style="margin:0">${esc(c.name)}</h3>
        </div>
        <div class="acts" style="margin:0" id="ctl-${c.id}">
          ${/activ|start|progress/i.test(c.status || '') ? `<button class="btn btn-amb" onclick="control(${c.id},'pause')">Pause campaign</button>` : `<button class="btn btn-grn" onclick="control(${c.id},'start')">Start campaign</button>`}
          <button class="btn btn-danger" onclick="control(${c.id},'stop')">Stop campaign</button>
        </div>
      </div>
      <div class="stats" style="grid-template-columns:repeat(4,minmax(0,1fr));margin:12px 0 0">
        <div class="stat" style="padding:10px 14px"><div class="lab">Sent</div><div class="num" style="font-size:22px">${Number(c.sent || 0).toLocaleString('en-GB')}</div></div>
        <div class="stat" style="padding:10px 14px"><div class="lab">Opened</div><div class="num" style="font-size:22px">${pct(c.opened, c.sent)}</div></div>
        <div class="stat" style="padding:10px 14px"><div class="lab">Replied</div><div class="num" style="font-size:22px">${pct(c.replied, c.sent)}</div></div>
        <div class="stat" style="padding:10px 14px"><div class="lab">Bounced</div><div class="num" style="font-size:22px">${pct(c.bounced, c.sent)}</div></div>
      </div>
    </div>`).join('') : '<div class="empty">No campaigns synced yet.</div>';
  const wq = await sb.from('mailbox_warmup').select('*').order('email');
  const dot = s => s >= 85 ? '#8BC53F' : s >= 60 ? '#E8B23A' : '#E5484D';
  $('warmupRows').innerHTML = (wq.data || []).map(m => `<tr>
    <td style="font-weight:600;color:var(--head)">${esc(m.email)}</td>
    <td style="font:700 16px/1 var(--font-d);color:var(--head)">${esc(m.warmup_score)}</td>
    <td><span style="display:inline-flex;align-items:center;gap:7px"><span style="width:8px;height:8px;border-radius:9999px;background:${dot(m.warmup_score)}"></span>${esc(m.status || '')}</span></td>
  </tr>`).join('') || '<tr><td colspan="3" style="text-align:center;color:var(--mut);padding:28px">No mailboxes synced yet.</td></tr>';
}
async function control(id, action){
  const verb = { start: 'Start', pause: 'Pause', stop: 'Stop' }[action];
  if (!confirm(`${verb} this campaign? It takes effect in Smartlead immediately.`)) return;
  const el = $('ctl-' + id);
  el.innerHTML = '<span class="ref">Sending…</span>';
  const { data } = await sb.auth.getSession();
  const r = await fetch(CONTROL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + data.session.access_token },
    body: JSON.stringify({ action, campaign_id: id }),
  }).catch(() => null);
  const res = r ? await r.json().catch(() => ({})) : {};
  if (res.ok){ el.innerHTML = '<span class="ref">Done — stats refresh on the next sync.</span>'; setTimeout(load, 1500); }
  else { el.innerHTML = `<span class="err" style="margin:0">${esc(res.error || 'Could not reach the control service.')}</span>`; setTimeout(load, 4000); }
}
```

- [ ] **Step 2: Verify** — locally: page renders, migration banner pre-0008; after Task 2's sync ran: cards + warmup rows show real numbers; a pause/start round-trip on a safe campaign works end to end (with Will watching).

- [ ] **Step 3: Commit** — `git add admin/campaigns.html && git commit -m "Admin: campaigns board with human-click Smartlead controls"`

### Task 6: Schedule it — one new launchd agent

**Files:**
- Create: `_system/run_web_sync.sh`, `~/Library/LaunchAgents/com.nexpoint.web-sync.plist`

- [ ] **Step 1: Write `_system/run_web_sync.sh`** (mirror `run_pipedrive_sync.sh`'s python3-discovery loop and log style, logging to `_system/logs/web_sync.log`, running `web_requests_sync.py` then `smartlead_sync.py`, each guarded so one failing does not stop the other). `chmod +x` it.

- [ ] **Step 2: Write the plist** — copy the structure of `~/Library/LaunchAgents/com.nexpoint.hourly-sync.plist.DISABLED-2026-08-21` exactly, with: Label `com.nexpoint.web-sync`, ProgramArguments `/bin/bash` + `/Users/willlawrie/Documents/Claude/Projects/Nexpoint/_system/run_web_sync.sh`, and instead of StartCalendarInterval use `<key>StartInterval</key><integer>900</integer>` (every 15 minutes), stdout/err to `/tmp/nexpoint_web_sync_{stdout,stderr}.log`, `RunAtLoad` false.

- [ ] **Step 3: GATE — confirm with Will before loading** (all other agents were deliberately disabled in August; this one is new and additive): `launchctl load ~/Library/LaunchAgents/com.nexpoint.web-sync.plist`, then `launchctl list | grep nexpoint` shows it, and after 15 minutes `_system/logs/web_sync.log` shows a clean run.

- [ ] **Step 4: Commit** — `git add _system/run_web_sync.sh && git commit -m "Engine: 15-minute web/smartlead sync runner"` (the plist lives outside the repo; paste its content into `_system/reference/smartlead-api.md`'s neighbouring runbook or a new `_system/reference/web-sync.md` so it is reproducible — include load/unload commands).

### Task 7: End-to-end proof and hand-over

- [ ] **Step 1: Full-loop test** — submit a real test request on a hub form (Plan B live) → notification email arrives → row visible on the admin hub page (Plan C) → within 15 minutes the lead folder exists locally and `synced_at` is stamped → approve + pair an introduction in the admin page → next sync archives it in `data/introductions/register.json`. Record each checkpoint's evidence in the final report.
- [ ] **Step 2: Push both repos** — `git push origin claude/campaigns-engine` (each). Report to Will: what runs on what schedule, where the logs are, the one new launchd agent, and the explicit statement that nothing in the system starts, stops or sends anything without a human click.

## Self-review notes

- Spec coverage: §7 fully (stats in via scheduled sync + local archive; control out via server-side function in seconds; human-click rule enforced twice — read-only sync, confirm() + admin-token gate). §4's hourly engine pull delivered at 15 minutes. §11's Pipedrive link via Task 3 (with the documented decision point on which layer creates the lead).
- The Smartlead field names are the documented ones and Task 1 exists precisely to correct them from observation before Tasks 2/4 harden them.

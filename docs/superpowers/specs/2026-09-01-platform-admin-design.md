# NexPoint Platform & Admin App — Design Spec

**Date:** 2026-09-01 · **Agreed with:** Will · **Status:** awaiting Will's review

## 1. Vision

Replace the old portal with the NexPoint Global Hub, split the hubs onto their own
subdomains, and make the admin app the single workspace where Will and Chris run the
business. Every piece of data the websites capture flows to four places: the admin app,
Pipedrive, Claude (the local pipeline files), and Outlook.

## 2. Principles — these override any implementation choice

1. **NexPoint is the gate.** No company is ever connected to another automatically.
   The websites collect *requests*; introductions happen only after Will or Chris
   explicitly approves, and they make the introduction themselves. Public listings stay
   anonymised (the existing "BRIEF NX-2581" style) — no path on any public site reveals
   one company's identity to another.
2. **Automation drafts; a human acts.** Claude/the engine may draft emails, posts,
   videos and files, but sending an email, starting/stopping a campaign, and publishing
   a LinkedIn post are always a human click by Will or Chris.
3. **The local folder is the master copy.** Supabase is the working queue; the engine
   pulls everything down to the Nexpoint folder on Will's Mac hourly. Cloud loss must
   never mean data loss.
4. **One place.** One repo, one database, one admin login. New capability extends the
   existing patterns (Supabase tables + engine polling + static pages) rather than
   adding new infrastructure kinds.

## 3. Public sites & hosting

- **One repo** (NEXPOINT-1), deployed via GitHub Pages as today, with **Cloudflare
  (free tier)** taking over DNS for nexpoint.co.uk. Will changes nameservers at the
  registrar once (exact steps supplied during build).
- Cloudflare routes subdomains to folders of the single site:
  - `nexpoint.co.uk` → root marketing site
  - `printhub.nexpoint.co.uk` → print hub
  - `millhub.nexpoint.co.uk` → mill hub
  - `opportunities.nexpoint.co.uk` → opportunities hub (grown from the portal's briefs;
    briefs are already managed in the Supabase `briefs` table)
  - admin app remains at its current path, protected by Supabase auth
- The Global Hub (`hub/`, renamed from `portal-v2/` on `site-redesign`) **replaces**
  `/portal/`; old portal URLs redirect.
- **Education hub: parked.** Routing will accommodate a future `education.` subdomain;
  nothing is built for it now.

## 4. Request pipeline (website → everywhere)

1. A visitor submits any form (offer capacity, request capacity, list an opportunity,
   request an introduction). Today these forms are mocks; they become real inserts into
   Supabase **`web_requests`** (public key may *insert only* — never read).
2. **Instantly:** a notification email goes to Will and Chris — sent by the capture
   worker (via Resend) in the same moment it stores the row. The admin app sees the
   request live.
3. **Hourly:** the cloud engine (the `nexpoint-engine` repo — locally at
   `~/Documents/Claude/Projects/Nexpoint 2`, running in GitHub Actions per its
   `jobs.yaml`) pulls unsynced requests, files them into the workspace repo
   (lead files — the master copy, G3b data trunk), and Pipedrive follows through the
   engine's journalled `PipedriveClient` path (G10). Claude sees everything in
   `leads/`/`deals/`.

### 4a. Engine integration — binding context

The old local `_system` scripts and launchd agents are RETIRED (cutover completed
2026-08-25); all scheduled work is engine jobs in the `nexpoint-engine` repo, and its
acceptance spec (`nexpoint-engine-acceptance-spec.md`) is binding: G1 no-send, G2
never delete company data, G3/G3a/G3b push rules, G7 run records, G10 journalled
Pipedrive writes, dry-run by default, TDD with acceptance-guard tests. **Never
reintroduce a local scheduler.** The admin app is a pure human surface: every board
action is an `engine_intents` row (closed vocabulary in
`src/nexpoint_engine/intents.py`, mirrored by a DB constraint) that the engine claims
and executes journalled; the browser never touches Pipedrive, the workspace, or the
public site. Supabase schema changes are migrations in that repo's
`supabase/migrations/` (currently through 0015).

## 5. The admin app — Will and Chris's single workspace

Static pages, Supabase auth (two accounts), database-level security (§10). **The engine
repo's `app/` directory is the source of truth for the boards** (PRODUCT.md there);
deploys are sanctioned human-approved file copies into the website repo's `admin/`. New
boards follow the redesigned pattern (`app/leads.html` + `app/admin.css`) and the
engine repo's `DESIGN.md` tokens — light theme only (binding, Will 2026-08-24), square
logo lockup only (`app/nexpoint-logo.png`; the horizontal logo is retired).
**Writes are intents:** board buttons INSERT `engine_intents` rows (vocabulary extended
by migration + `intents.py` + handlers + tests); the UI shows "queued for the engine"
optimistically, as the leads board does. Reads are direct selects under RLS.
**Agreed UI direction (Will, 2026-09-01):** the "NexPoint Admin Workspace" design canvas —
https://claude.ai/code/artifact/2eddcfa3-2da6-4627-8710-b19e0616b501 — four mocked screens
(Dashboard, Print Hub, Opportunities Hub, Campaigns; Mill Hub mirrors Print Hub) on the
light canvas. Build to these mocks for layout and flow; where a mock detail conflicts
with `DESIGN.md`/`admin.css` tokens, the engine repo's design system wins.
Eight areas (navigation leaves room for the future LinkedIn Manager, §8):

| Page | Purpose | Status |
|---|---|---|
| Dashboard | At-a-glance: new requests, live introductions, campaign performance | new |
| Leads | Lead-searcher output (`engine_lead_queue`) | exists |
| Tasks | Will & Chris's tasks (`engine_tasks`) | exists |
| Health | Engine/system status | exists |
| Print Hub | Host applications + capacity requests + print introductions | new |
| Mill Hub | Same, for milling | new |
| Opportunities Hub | Listing applications + intro requests against briefs + those introductions | new |
| Campaigns | Smartlead monitoring and start/stop | new |

The three hub pages share one design: two queues (each side of that hub's marketplace),
request statuses *new → reviewing → approved / declined*, and a "make introduction"
action pairing two requests. An approved offer-capacity request is what makes a company
a host on that hub.

## 6. The introductions register

One table records every introduction ever made — the who-knows-who and who-owes-what
history, and the evidence against being cut out of the loop:

- Which two requests (or request + brief) were paired, which hub, who approved, when.
- Lifecycle: *requested → approved → introduced (Will/Chris send the email from
  Outlook; the engine may pre-draft it in Drafts) → in discussion → deal done / dead →
  commission invoiced → commission paid*.
- Commission fields: basis, amount, currency, invoiced/paid dates.
- Claude reads the local copy and can flag anomalies (e.g. a host with three
  introductions and no commission recorded).

## 7. Campaign Manager (Smartlead)

**Scope: monitor + start/stop.** Campaigns are authored in Smartlead's own UI.

- **Stats in:** an engine job (in the `nexpoint-engine` repo — jobs.yaml entry, TDD,
  dry-run first, Will's go-ahead to wire live) pulls campaign performance (sent, opens,
  replies, bounces) and mailbox warmup scores into Supabase (`campaigns`,
  `campaign_stats`, `mailbox_warmup`) and archives the raw pull into the workspace
  repo. The admin page reads the tables live.
- **Control out:** start/pause/stop buttons call a route on the existing Cloudflare
  capture worker holding the Smartlead API key, gated on the caller's Supabase session
  being Will or Chris — the campaign reacts in seconds, not on the next engine pass.
  The key never appears in any page. (This is the one deliberate exception to
  writes-as-intents: campaign control needs seconds, not the next engine run, and it
  touches Smartlead only — never Pipedrive, the workspace, or the site.)
- Campaign start/stop is always a human click. The automation never launches sends.
- **Prerequisite from Will:** Smartlead API key at build time.

## 8. Future addition — LinkedIn Manager (not in this build)

Will plans to add a LinkedIn Manager later: a weekly cadence calendar, posts and
Higgsfield-MCP videos drafted by Claude to the design system, approval-gated publishing
to the NexPoint Global **company page only**, and post-performance analytics flowing
back in. Direction agreed 2026-09-01; it will get its own spec when Will picks it up.
The admin app's navigation should leave room for it. Note for then: LinkedIn's
company-page API requires a developer-programme application that takes weeks.

## 9. Data model (new Supabase tables)

| Table | Holds | Access |
|---|---|---|
| `web_requests` | every form submission: hub, side (offer/request/list/intro), company + contact details, form payload, status, reviewer notes | public: insert only · Will/Chris: full · engine: read/update |
| `introductions` | paired requests, hub, approver, lifecycle status, commission fields, dates, notes | Will/Chris + engine only |
| `campaigns` | mirror of Smartlead campaigns + latest stats + warmup | Will/Chris + engine; written by sync |
| `campaign_stats` | time-series snapshots per campaign | same |

Existing tables (`briefs`, `engine_lead_queue`, `engine_tasks`, `engine_intents`,
`deploy_queue`) are unchanged — except `engine_intents`' type constraint, which grows
new hub-board intent types via the standard triple: migration + `intents.py`
`INTENT_TYPES` + `tests/test_intents.py`.

**All new tables are migrations in the `nexpoint-engine` repo's
`supabase/migrations/`, numbered from 0016**, following that repo's migration style
(commented rationale, additive, safe to re-run, `select` last so the editor shows it).

## 10. Security

The admin pages are public files; the security boundary is Supabase auth + Row Level
Security, not the login screen. Hardening checklist (an explicit early task in
sub-project 2, before any new data flows):

1. **Audit RLS policies on every existing table** — the single most important check.
2. New tables locked from birth: anonymous users may only insert into `web_requests`
   (no read-back); all other access limited to the two admin accounts + the engine.
3. **MFA on** for both admin logins and for the Supabase dashboard account itself.
4. All secrets (Smartlead key, LinkedIn tokens, email-service key) server-side only.
5. Supabase leaked-password protection and sign-in rate limiting enabled.
6. The local master copy doubles as the backup of record.

## 11. How the four link targets are fulfilled

| Target | How |
|---|---|
| Admin app | reads the Supabase tables live; acts by raising `engine_intents` rows |
| Pipedrive | engine files requests into the workspace, then writes via its journalled `PipedriveClient` (G10) |
| Claude | everything lands in the workspace repo (`leads/`, `deals/`, archives) via the engine's G3b data-trunk pushes |
| Outlook | instant notification email per request (capture worker → Resend, inbound to Will/Chris); intro-email drafting stays G1-compliant: drafts only, a human sends |

## 12. Build order — four sub-projects, each with its own implementation plan

1. **Platform & cut-over** (website repo + Cloudflare) — DNS, subdomain routing,
   Global Hub replaces portal, opportunities hub site generated from `briefs`.
   Note: briefs deploy and its leak guard are the engine's J1.6/J2 — retargeting the
   deploy path from `portal/` to `opportunities/` is an engine-repo change.
2. **Request pipeline** (Cloudflare worker + engine-repo migration) — RLS audit +
   hardening, real forms → capture worker → `web_requests` + notification email.
3. **Introductions Manager** (engine repo `app/`, deployed to website `admin/`) — the
   dashboard + three hub boards + introductions/commission register, acting via new
   intent types; plus the engine-side filing job (requests → workspace lead files →
   Pipedrive) and intent handlers.
4. **Campaign Manager** (engine repo: job + `app/` page; worker: control route) —
   Smartlead stats sync + human-click start/pause/stop.

## 13. Out of scope (deliberately)

- Education hub (routing-ready, nothing built)
- LinkedIn Manager (future addition — §8)
- Campaign authoring inside the admin app
- Pushing pipeline leads into Smartlead campaigns from the admin app (possible later)
- Any auto-sent email, auto-made introduction, or auto-published post

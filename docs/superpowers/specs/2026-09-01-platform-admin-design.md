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
2. **Instantly:** a notification email goes to Will and Chris (Supabase-side trigger via
   a small sending service, e.g. Resend free tier). The admin app sees the request live.
3. **Hourly:** the engine polls Supabase, writes the request into the local Nexpoint
   folder (lead/deal files — the master copy), and the existing sync carries it to
   Pipedrive. Claude sees it in `leads/`/`deals/`. Poll frequency can be raised to
   15 minutes with a one-line change if the hour ever feels slow.

## 5. The admin app — Will and Chris's single workspace

Static pages in `admin/`, Supabase auth (two accounts), database-level security (§10).
Nine areas:

| Page | Purpose | Status |
|---|---|---|
| Dashboard | At-a-glance: new requests, live introductions, campaign + post performance | new |
| Leads | Lead-searcher output (`engine_lead_queue`) | exists |
| Tasks | Will & Chris's tasks (`engine_tasks`) | exists |
| Health | Engine/system status | exists |
| Print Hub | Host applications + capacity requests + print introductions | new |
| Mill Hub | Same, for milling | new |
| Opportunities Hub | Listing applications + intro requests against briefs + those introductions | new |
| Campaigns | Smartlead monitoring and start/stop | new |
| LinkedIn | Cadence calendar, draft approval, post performance | new |

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

- **Stats in:** a scheduled server-side sync pulls campaign performance (sent, opens,
  replies, bounces) and mailbox warmup scores into Supabase (`campaigns`,
  `campaign_stats`). The admin page reads them live; the engine archives them locally.
- **Control out:** start/pause/stop buttons call a small server-side function (Supabase
  Edge Function) holding the Smartlead API key — the campaign reacts in seconds, not on
  the next engine pass. The key never appears in any page.
- Campaign start/stop is always a human click. The automation never launches sends.
- **Prerequisite from Will:** Smartlead API key at build time.

## 8. LinkedIn Manager (company page only)

- **Cadence:** a weekly posting calendar — what goes out, when, on what theme.
- **Creation:** Claude drafts posts in the NexPoint voice and to the design system
  (`brand/design-system.md`), and generates videos via the Higgsfield MCP to the same
  brand standard. Drafts land in the calendar as *draft*.
- **Approval gate:** nothing posts itself. Will or Chris approves each draft in the
  admin app; only then is it posted/scheduled to the **NexPoint Global company page**.
- **Performance in:** impressions, engagement and follower stats pulled from LinkedIn's
  company-page API into Supabase; shown beside the calendar; archived locally so Claude
  can adapt future drafts to what performs.
- **Personal profiles are out of scope** (LinkedIn provides no analytics for them and
  workarounds breach their terms). Revisit only as "Claude drafts, Will pastes".
- **Prerequisite from Will:** apply to LinkedIn's developer programme for company-page
  API access (form-filling; approval typically takes weeks — start early).

## 9. Data model (new Supabase tables)

| Table | Holds | Access |
|---|---|---|
| `web_requests` | every form submission: hub, side (offer/request/list/intro), company + contact details, form payload, status, reviewer notes | public: insert only · Will/Chris: full · engine: read/update |
| `introductions` | paired requests, hub, approver, lifecycle status, commission fields, dates, notes | Will/Chris + engine only |
| `campaigns` | mirror of Smartlead campaigns + latest stats + warmup | Will/Chris + engine; written by sync |
| `campaign_stats` | time-series snapshots per campaign | same |
| `linkedin_posts` | calendar entries: content, media refs, status (draft → approved → posted), post metrics | Will/Chris + engine |

Existing tables (`briefs`, `engine_lead_queue`, `engine_tasks`, `engine_intents`,
`deploy_queue`) are unchanged.

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
| Admin app | reads/writes the Supabase tables live |
| Pipedrive | engine files requests locally → existing hourly Pipedrive sync |
| Claude | everything lands in the local Nexpoint folder (`leads/`, `deals/`, stats archives) |
| Outlook | instant notification email per request; engine pre-drafts intro emails in Drafts for a human to send |

## 12. Build order — five sub-projects, each with its own implementation plan

1. **Platform & cut-over** — Cloudflare DNS, subdomain routing, Global Hub replaces
   portal, opportunities hub site generated from `briefs`.
2. **Request pipeline** — RLS audit + security hardening, real forms → `web_requests`,
   notification email, engine job → local files → Pipedrive.
3. **Introductions Manager** — the three hub admin pages + introductions/commission
   register. UI to be mocked up visually with Will before build.
4. **Campaign Manager** — Smartlead stats sync + start/stop function.
5. **LinkedIn Manager** — cadence calendar, Claude drafting + Higgsfield video
   generation, approval-gated posting, analytics sync. (Start the LinkedIn developer
   application during sub-project 1 so approval lands in time.)

## 13. Out of scope (deliberately)

- Education hub (routing-ready, nothing built)
- LinkedIn personal profiles
- Campaign authoring inside the admin app
- Pushing pipeline leads into Smartlead campaigns from the admin app (possible later)
- Any auto-sent email, auto-made introduction, or auto-published post

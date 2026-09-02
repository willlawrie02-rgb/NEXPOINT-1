# Global Hub accounts & explainer animation — design spec

**Date:** 2026-09-01 · **Status:** awaiting Will's review · **Decided with:** Will (grilled twice)

The Global Hub gains real member accounts, created through one general questionnaire that
serves every hub, and an explainer animation that shows a first-time visitor what the hub
does. Two phases: accounts first, animation second.

---

## 1. Context

The hub today is a draft with no gate: hub pages link straight out to the printhub, millhub
and opportunities subdomains, the sign-in modal is an honest mock, and every action form
(the "desk") asks for the same details every time. Chris's 14 August review praised the
zero-friction workflow — *"you haven't had to enter loads of information up front"* — and
that praise constrains this design: the gate must not put a wall in front of browsing.

Existing plumbing this design builds on, none of it new:

- **GitHub Pages** serves the repo at `nexpoint.co.uk` (deploys from `main`).
- **Subdomain router** (`_system/subdomain-router/`) — a Cloudflare Worker proxying
  `printhub.` / `millhub.` / `opportunities.nexpoint.co.uk` to folders of this repo.
  The `nexpoint.co.uk` zone is on Cloudflare (nameservers verified 2026-09-01).
- **Capture worker** (`_system/portal-worker/worker.js`, name `nexpoint-portal-capture`) —
  handles `/requests` (hub form submissions → Supabase `web_requests` → Pipedrive lead →
  Resend notification), `/smartlead/control` (admin, verified against Supabase Auth
  sessions) and `/intents/ping`.
- **Supabase** — already the stack's database and auth system: `web_requests` lives there
  and the admin app signs in through Supabase Auth.

## 2. The journey

```
Main page → Global Hub → browse everything freely
                       → the moment you ACT, the desk questionnaire fires
                       → completing it creates your Global Hub account
                       → signed in: prefilled forms, one-click requests, across all hubs
```

**Act gate, not a door gate.** Hub landing pages, the capacity finder, the map and the
opportunities board all stay browsable with no account. The questionnaire fires only when a
visitor acts: requests an introduction, asks the desk to route work, registers or offers
capacity. Two entrances to the same flow:

1. **The act gate** — any action button, anywhere on the hubs, when not signed in.
2. **One proactive join CTA** — "Create your hub account" in the hub navigation.

**Instant access.** Completing the questionnaire signs the member in immediately. Human
review stays where it belongs: on introduction requests, exactly as today.

**The desk is the account.** The current per-request intro modal (name, company, email,
location, notes — asked fresh every time) is retired. Introducing yourself once *is*
creating the account; every later action references the profile instead of re-asking.

**Exception:** the Education Hub's "Put me on the list" stays a light name-and-email
capture with no account — a waiting list should be nearly free to join.

## 3. Scope

**Phase 1 — accounts.** Worker auth endpoints, the three-step questionnaire, real sign-in,
act-gate wiring across hub + printhub + millhub + opportunities, member records in the
admin app.

**Phase 2 — explainer.** The four-scene animation replacing the hub home's step cards, the
hero "See how the hub works" link, and the homepage teaser band (§8, already designed and
copy-approved).

**Non-goals (explicitly out):** member dashboards · a board matched to the profile (the
mock sign-in's promise — later release) · magic links · self-serve password reset at launch
("contact us" until the reset page ships as a fast-follow) · telemetry on the animation ·
any change to the education waiting list beyond keeping it light.

## 4. Architecture

### 4.1 Worker gains an auth surface

The capture worker is fronted at **`api.nexpoint.co.uk`** (Cloudflare custom domain on the
existing worker — one route in `wrangler.toml`, one proxied DNS record; possible because
the zone is on Cloudflare). This lets the worker set an **HttpOnly session cookie with
`Domain=.nexpoint.co.uk`**, valid on the apex and all three hub subdomains. The
`workers.dev` URL keeps working for existing consumers until they're migrated.

New endpoints, all proxying **Supabase Auth** (no password ever stored or hashed by us):

| Endpoint | Does |
|---|---|
| `POST /auth/register` | Creates the Supabase user (email + password), inserts the `member_profiles` row, signs in, sets the session cookie. Accepts an optional `pending_request` payload so the action that triggered the gate completes in the same breath. |
| `POST /auth/login` | Password sign-in → session cookie. |
| `POST /auth/logout` | Clears the cookie, revokes the refresh token. |
| `GET /auth/me` | Returns `{signed_in, name, company, email, region, country, town, interests}` for page state and prefill. Cheap; every hub page calls it once on load. |

Session mechanics: the cookie holds the Supabase session (access + refresh JWTs, ~2 KB,
within cookie limits); the worker refreshes transparently when the access token has
expired. `HttpOnly; Secure; SameSite=Lax; Domain=.nexpoint.co.uk; Path=/`.

CORS: the worker's origin allowlist already covers the apex and the three hub subdomains;
`/auth/*` and `/requests` add `Access-Control-Allow-Credentials: true` and GET support.

### 4.2 Data model

One new Supabase table, `member_profiles`, keyed by the Supabase Auth user id:

`user_id (PK, FK auth.users) · name · company · email · phone (nullable) · region ·
country · town · interests (text[] — find_print, offer_print, mill_cell, opportunities,
education) · notes (volumes & systems, free text) · created_at`

`web_requests` gains a nullable `member_id` column: every act-gated submission carries the
member who made it. Existing anonymous rows are untouched.

### 4.3 Client module

One shared script, `hub-account.js`, published once at site root (`assets/`). Apex pages
reference it relatively; subdomain pages reference it by absolute apex URL
(`https://nexpoint.co.uk/assets/hub-account.js`), because a relative path on a subdomain
would be routed into that hub's own folder. It exists once — the folder-copy discipline
("carry the wiring into copies") applies only to the small per-folder `portal.js` edits
that call into it. It owns: the `/auth/me` call, the signed-in chip, the
questionnaire modal, the act-gate interception, and form prefill.

## 5. The questionnaire

Three short steps, in the brand's staged rhythm (Chris: 30 seconds at a time), replacing
the desk modal. Montserrat/Inter, light canvas, verb-first buttons, British English.

1. **Who you are** — name · company · email · password. Framing copy keeps the desk's
   promise: "Two minutes, in confidence. One of us reads every profile personally."
2. **Where you are** — region · country · town. Prefilled from the finder's saved location
   (`np_loc`) when the visitor has already used the map — Chris's "don't ask me to type my
   bloody country in again" rule, now permanent.
3. **What you're after** — multi-select: find print capacity · offer print capacity ·
   a mill cell · the opportunities board · education, plus one free-text field for volumes
   and systems ("anything that helps us weigh the fit").

When the gate fired from an action, that action's context (e.g. the capacity option being
requested) rides along and is submitted as the member's first request on completion — the
visitor never repeats themselves. When signed in already, the same action becomes a
one-click confirm showing what will be sent.

## 6. Per-surface changes

- **`hub/index.html`** — nav gains "Create your hub account"; "Sign in" becomes real
  (the placeholder "later release" copy goes); a small signed-in chip (name, sign out)
  replaces both when a session exists.
- **`printhub/` `find.html` + `offer.html`, `millhub/` `find.html` + `offer.html`,
  `opportunities/index.html`** — every `openIntro`/register/offer form routes through the
  act gate: anonymous → questionnaire; signed-in → prefilled one-click confirm. Browsing,
  the finder and the board stay unauthenticated.
- **Education list** — unchanged light capture (name + email), still notifies via the
  existing pipeline.
- **`hub/privacy.html`** — gains a short accounts paragraph (what's stored, that it's seen
  by NexPoint only, deletion on request). Flagged for Will's copy eye.
- **Admin app** — a Members view listing `member_profiles` (name, company, location,
  interests, joined, requests made), read through the same authenticated pattern the other
  boards use. Minimal: a list, no editing.

## 7. Data flow

- **Account created** → Supabase (`auth.users` + `member_profiles`) → visible in admin.
  **No Pipedrive entity** — accounts alone don't enter the pipeline.
- **Member acts** → `web_requests` row with `member_id` + Resend notification via the worker;
  the engine's hourly sync files the row onwards to the pipeline and Pipedrive — Pipedrive on
  action, with the engine as the actor.
- Notification email for new members: reuse the existing Resend plumbing, to
  `hello@nexpoint.co.uk`, so Will and Chris see joins without opening admin.

## 8. Phase 2 — the explainer animation (design locked earlier, restated)

> **Superseded in part — 2026-09-01.** Chris's four dictated animation briefs of 24 August
> (`chris-chats/2026-08-24_hub-animation-briefs.md` in the parent repo, recorded ten days
> after the review this section was designed from) ask for a *family* of animations: a
> global-overview infomercial ("holistically what NexPoint is doing globally… a map with
> things moving around… as a global community"), per-hub infomercials for mill (the
> factory-cell model) and print (recording missing — Chris to re-record), a product-hub
> piece, and an education infographic. The hub-home slot below becomes the global-overview
> piece, and its story should lean map-and-community rather than the pure four-step
> journey. Phase 2's implementation plan must be drawn from those briefs; two things block
> animation production: the Product Hub vs Global Opportunities Hub naming decision, and
> the missing print-hub recording. Phase 1 is unaffected — the briefs' "no pressure
> whatsoever" browsing framing reinforces the act gate.

- **Asset:** one hand-built SVG/CSS/JS module (`assets/explainer.js` + `.css`), no
  libraries. Four scenes ≈ 25 s, looping with a ~3 s hold on the end card, clickable step
  dots, neutral pointer dot (works on touch), autoplay everywhere,
  `prefers-reduced-motion` → static four-panel storyboard. Brand easing
  `cubic-bezier(0.2,0.8,0.2,1)`, 400–600 ms transitions, palette colours only.
- **Scenes:** 1 — three live doors, cursor picks one · 2 — mini questionnaire fills
  itself · 3 — human review, verified tick · 4 — dotted map, two pins, one arc.
- **Captions (approved copy):**
  1. *Pick your hub* — "Print, mill or opportunities. Each door shows real, current
     capacity: anonymised on the page, verified by us in person."
  2. *Introduce yourself* — "Introduce yourself once and you're a member: who you are,
     where you are, what you're after. Chris or Will reads every profile personally."
  3. *A person weighs the fit* — "One of us reviews every request, usually within two
     working days. If it isn't right, we say why and keep looking."
  4. *A personal introduction* — "When both sides agree, we introduce you directly: names,
     faces, facilities. The conversation is yours; we stay close to help it land."
  End card: **"Introduced, not sold."** — no button (the page's post-CTA carries the action).
- **Hub home:** the animation replaces the four step cards inside `#how`; the three
  hairline rows stay; the hero gains one "See how the hub works" link scrolling to it.
- **Homepage:** a slim band after `#network` — eyebrow "The Global Hub", line "Where the
  O&P world finds print capacity, milled production and live opportunities, one personal
  introduction at a time.", small looping arc motif, CTA "See how the Global Hub works"
  → `/hub/#how`.

## 9. Security & privacy

Passwords touch only Supabase Auth over TLS; the worker proxies and never logs bodies on
`/auth/*`. The service-role key stays a Wrangler secret, server-side only. The session
cookie is HttpOnly (no script access), Secure, domain-scoped to `nexpoint.co.uk`. The
member's profile is visible to NexPoint only, matching the desk's existing promise.

## 10. Verification

Local: `wrangler dev` for the worker + a local static server for the pages; the
cookie-domain behaviour is exercised with a hosts-file alias since `localhost` can't carry
a `.nexpoint.co.uk` cookie. Full pass in the preview browser: register via act gate,
register via join CTA, sign out/in, prefill on every gated form across all four surfaces,
anonymous browsing untouched, education list still light, reduced-motion and mobile checks
for Phase 2. Live confirmation after each merge, since Pages deploys from `main`.

## 11. Sequencing

1. **PR 1** — this spec.
2. **PR 2** — worker: custom domain, `/auth/*`, CORS allowlist, `member_profiles`,
   `web_requests.member_id`. One-time dashboard steps for Will listed in the PR
   (add the `api.` custom domain; confirm email/password auth is enabled in Supabase).
3. **PR 3** — questionnaire + real sign-in + act gate on the hub home, then carried into
   the printhub/millhub/opportunities copies.
4. **PR 4** — admin Members view.
5. **PR 5** — Phase 2: explainer animation + homepage teaser.

Each lands on a `claude/*` branch for Will to merge. Fast-follows parked: password reset
page, member request history, the matched board.

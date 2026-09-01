# Plan A — Platform & Cut-over Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve `printhub.` / `millhub.` / `opportunities.nexpoint.co.uk` from folders of the single website repo via Cloudflare, replace the old `/portal/` with the Global Hub, and stand up the opportunities hub from the existing portal board.

**Architecture:** The site stays on GitHub Pages (repo `willlawrie02-rgb/NEXPOINT-1`, apex `nexpoint.co.uk`, `CNAME` file at repo root). Cloudflare takes over DNS; a small routing Worker maps each subdomain to a folder of the same site (`printhub.nexpoint.co.uk/x` → fetches `https://nexpoint.co.uk/printhub/x`). Each hub folder is fully self-contained (own copy of assets) so routing needs no special cases.

**Tech Stack:** Static HTML/CSS/JS, GitHub Pages, Cloudflare free tier (DNS + one Worker), Wrangler CLI.

**Spec:** `docs/superpowers/specs/2026-09-01-platform-admin-design.md` (in the website repo)

## Global Constraints

- Website repo: `/Users/willlawrie/Documents/Claude/Projects/Nexpoint/website` (git repo `NEXPOINT-1`). Parent folder `/Users/willlawrie/Documents/Claude/Projects/Nexpoint` is a separate git repo holding `_system/`.
- Work on branch `claude/platform-cutover` in BOTH repos. Push only to `origin claude/*` — a guardrail hook denies everything else. Will merges; never merge your own work.
- Brand (from `brand/design-system.md`, read it before any visual change): light canvas `#F5F7FA`, NexPoint Blue `#005CC8`, Green `#8BC53F`, Montserrat headings / Inter body / Material Symbols icons, **no emoji ever**, British English, CTAs verb-first ("Request an introduction", never "Submit").
- Do not touch `deals/`, `leads/`, `_system/hooks/`, `.claude/settings*`, `pipedrive_config.json`, `portal_config.json`.
- The education hub is parked: leave room in nav/copy, build nothing for it.
- Never introduce a path that reveals one company's identity to another on the public sites.
- Base all work on the current `site-redesign` branch state of the website repo (it contains `hub/` renamed from `portal-v2/`). Branch `claude/platform-cutover` from `site-redesign`.

## Current layout (verified 2026-09-01)

```
website/
  CNAME                  -> "nexpoint.co.uk"
  index.html             -> marketing site; links to /portal/ at lines ~614, ~634, ~1072
  portal/                -> OLD portal: index.html (2016 lines, board + briefs), briefs.json, privacy.html
  hub/                   -> Global Hub v2: index.html, mill-hub.html, print-hub.html,
                            mill-find.html, mill-offer.html, print-find.html, print-offer.html,
                            assets/portal.css, assets/portal.js, assets/img/*, assets/nexpoint-logo.png
  admin/                 -> admin app (index, leads, tasks, health) — NOT touched by this plan
```

DNS today: Namecheap nameservers (`dns1.registrar-servers.com`). A Cloudflare Worker (`_system/portal-worker/`, name `nexpoint-portal-capture`) already exists for form capture, so a Cloudflare account may already exist — check with Will / `wrangler whoami` before creating one.

---

### Task 1: Split the hub into per-subdomain folders

**Files:**
- Create: `printhub/index.html` (from `hub/print-hub.html`), `printhub/find.html` (from `hub/print-find.html`), `printhub/offer.html` (from `hub/print-offer.html`), `printhub/assets/*` (copy of `hub/assets/*`)
- Create: `millhub/index.html` (from `hub/mill-hub.html`), `millhub/find.html` (from `hub/mill-find.html`), `millhub/offer.html` (from `hub/mill-offer.html`), `millhub/assets/*` (copy)
- Modify: `hub/index.html` (Global Hub landing — links out to the subdomains)

**Interfaces:**
- Produces: folder names `printhub/`, `millhub/`, `opportunities/` — the routing Worker (Task 4) and Plan B's form wiring depend on these exact names.

- [ ] **Step 1: Create the folders with git mv/cp**

```bash
cd /Users/willlawrie/Documents/Claude/Projects/Nexpoint/website
git checkout site-redesign && git checkout -b claude/platform-cutover
mkdir -p printhub millhub
git mv hub/print-hub.html printhub/index.html
git mv hub/print-find.html printhub/find.html
git mv hub/print-offer.html printhub/offer.html
git mv hub/mill-hub.html millhub/index.html
git mv hub/mill-find.html millhub/find.html
git mv hub/mill-offer.html millhub/offer.html
cp -R hub/assets printhub/assets
cp -R hub/assets millhub/assets
```

- [ ] **Step 2: Fix intra-folder links in the moved pages**

In each moved file, update references (use grep to find them all — `grep -n 'href=\|src=' printhub/*.html`):
- `print-find.html` → `find.html`, `print-offer.html` → `offer.html`, `print-hub.html` → `index.html` (same pattern for mill).
- `assets/portal.css` / `assets/portal.js` stay as-is (each folder has its own copy).
- Links back to the Global Hub (`index.html` referring to the old hub index) → `https://nexpoint.co.uk/hub/`.
- Links to the main site (`../index.html...`) → absolute `https://nexpoint.co.uk/...` (relative paths break across subdomains).
- Privacy link `../portal/privacy.html` → `https://nexpoint.co.uk/hub/privacy.html` (Task 3 creates it).

- [ ] **Step 3: Update the Global Hub landing to point at the subdomains**

In `hub/index.html`: `href="mill-hub.html"` → `href="https://millhub.nexpoint.co.uk/"`, `href="print-hub.html"` → `href="https://printhub.nexpoint.co.uk/"`. Add an equivalent card/link for `https://opportunities.nexpoint.co.uk/` following the exact markup pattern of the existing two cards (read the surrounding section and mirror it; copy tone from the portal board's own description of itself — anonymised opportunity briefs).

- [ ] **Step 4: Verify locally**

```bash
cd /Users/willlawrie/Documents/Claude/Projects/Nexpoint/website && python3 -m http.server 4399
```
Open `http://localhost:4399/printhub/`, `/millhub/`, `/hub/` — every page renders with styles/images, no 404s in the browser console, all cross-links resolve (subdomain links will 404 locally — check they are the right absolute URLs).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Split hub into printhub/ and millhub/ folders for subdomain serving"
```

### Task 2: Build the opportunities hub from the portal board

**Files:**
- Create: `opportunities/index.html` (derived from `portal/index.html`), `opportunities/briefs.json` (copy of `portal/briefs.json`)

- [ ] **Step 1: Copy and rebrand**

```bash
cp portal/index.html opportunities/index.html
cp portal/briefs.json opportunities/briefs.json
```
In `opportunities/index.html` (it is 2016 lines — work with targeted edits, not a rewrite):
- Retitle: `<title>` and visible headings from "Member portal" / portal naming → "NexPoint Opportunities Hub" (keep the board, filters, brief cards, modals exactly as they are — they already implement the anonymised-brief model).
- Point its "back to site" / nav links at `https://nexpoint.co.uk/` and `https://nexpoint.co.uk/hub/` (absolute).
- Leave every form endpoint and auth reference exactly as found — Plan B owns form wiring; do not change `briefs.json` loading (relative path still works: same folder).

- [ ] **Step 2: Verify locally** — `http://localhost:4399/opportunities/` renders the board with briefs visible, filters working, no console errors.

- [ ] **Step 3: Commit** — `git add opportunities && git commit -m "Create opportunities hub from portal board"`

### Task 3: Retire the old portal with redirects

**Files:**
- Modify: `portal/index.html` (replace with redirect), `index.html` (3 link updates)
- Create: `hub/privacy.html` (moved from `portal/privacy.html`)

- [ ] **Step 1: Move privacy, redirect the portal**

```bash
git mv portal/privacy.html hub/privacy.html
```
Replace the ENTIRE contents of `portal/index.html` with:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0; url=https://nexpoint.co.uk/hub/">
<link rel="canonical" href="https://nexpoint.co.uk/hub/">
<title>NexPoint — moved to the Global Hub</title>
</head>
<body style="font-family:Inter,system-ui,sans-serif;background:#F5F7FA;color:#2C3444;display:grid;place-items:center;min-height:100vh;margin:0">
<p>The member portal is now the <a href="https://nexpoint.co.uk/hub/" style="color:#005CC8">NexPoint Global Hub</a>.</p>
</body>
</html>
```

Create `portal/privacy.html` with the same shape redirecting to `https://nexpoint.co.uk/hub/privacy.html`. Keep `portal/briefs.json` in place untouched — the cloud engine (repo `nexpoint-engine`, locally `~/Documents/Claude/Projects/Nexpoint 2`) deploys briefs to it via its J1.6 reconcile + human-gated J2 deploy with a leak guard. Retargeting that deploy from `portal/` to `opportunities/` is an ENGINE-repo change under its acceptance spec — do NOT attempt it in this plan; flag it to Will at the end so he can hand it to the engine session (Plan D's owner is closest).

- [ ] **Step 2: Update the marketing site links** — in `index.html`, change the three `/portal/` hrefs (navbar ~line 614, mobile nav ~634, footer ~1072) to `/hub/`, and their labels "Member portal" → "Global Hub".

- [ ] **Step 3: Fix hub-internal privacy links** — `grep -rn 'portal/privacy' hub/ printhub/ millhub/` and point them all at `https://nexpoint.co.uk/hub/privacy.html`.

- [ ] **Step 4: Verify locally** — `/portal/` redirects to `/hub/` (open it, watch the address bar); main site nav shows "Global Hub" and lands on `hub/index.html`.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "Retire old portal: redirect to Global Hub, move privacy page"`

### Task 4: The subdomain routing Worker

**Files:**
- Create: `_system/subdomain-router/worker.js`, `_system/subdomain-router/wrangler.toml`, `_system/subdomain-router/README.md` (in the PARENT repo, branch `claude/platform-cutover`)

**Interfaces:**
- Consumes: folder names from Task 1/2.
- Produces: live subdomains once DNS (Task 5) is active.

- [ ] **Step 1: Write the worker**

`_system/subdomain-router/worker.js`:

```js
/**
 * NexPoint subdomain router (Cloudflare Worker).
 * Maps hub subdomains onto folders of the single GitHub Pages site, so one
 * repo serves every hub. printhub.nexpoint.co.uk/find.html is fetched from
 * https://nexpoint.co.uk/printhub/find.html and streamed back unchanged.
 */
const FOLDERS = {
  "printhub.nexpoint.co.uk": "printhub",
  "millhub.nexpoint.co.uk": "millhub",
  "opportunities.nexpoint.co.uk": "opportunities",
};

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const folder = FOLDERS[url.hostname];
    if (!folder) return fetch(request); // not ours — pass through untouched

    let path = url.pathname;
    if (path === "/" || path.endsWith("/")) path += "index.html";

    const origin = `https://nexpoint.co.uk/${folder}${path}${url.search}`;
    const res = await fetch(origin, {
      method: request.method,
      headers: request.headers,
      redirect: "manual",
    });
    // GitHub Pages 301s folder paths missing a trailing slash; surface those
    // as same-subdomain redirects rather than leaking the apex URL.
    if (res.status >= 301 && res.status <= 308) {
      const loc = res.headers.get("Location") || "/";
      const back = loc.replace(`https://nexpoint.co.uk/${folder}`, "");
      return Response.redirect(`https://${url.hostname}${back || "/"}`, 302);
    }
    return new Response(res.body, res);
  },
};
```

- [ ] **Step 2: Write wrangler.toml**

```toml
name = "nexpoint-subdomain-router"
main = "worker.js"
compatibility_date = "2026-09-01"

routes = [
  { pattern = "printhub.nexpoint.co.uk/*", zone_name = "nexpoint.co.uk" },
  { pattern = "millhub.nexpoint.co.uk/*", zone_name = "nexpoint.co.uk" },
  { pattern = "opportunities.nexpoint.co.uk/*", zone_name = "nexpoint.co.uk" },
]
```

- [ ] **Step 3: Local test with wrangler dev**

```bash
cd /Users/willlawrie/Documents/Claude/Projects/Nexpoint/_system/subdomain-router
npx wrangler dev --local
curl -s -H 'Host: printhub.nexpoint.co.uk' http://localhost:8787/ | head -5
```
Expected: the HTML of `printhub/index.html` **once the folders are merged and deployed to the live site** — until then a 404 from nexpoint.co.uk is the correct pass-through behaviour; verify the worker constructs the right origin URL by adding a temporary `console.log(origin)` and checking wrangler's output, then remove it.

- [ ] **Step 4: Write README.md** — one page: what it does, the FOLDERS map, `wrangler deploy` instructions, and "routes only activate once the zone is on Cloudflare (Task 5)".

- [ ] **Step 5: Commit (parent repo)**

```bash
cd /Users/willlawrie/Documents/Claude/Projects/Nexpoint
git checkout -b claude/platform-cutover
git add _system/subdomain-router && git commit -m "Add subdomain routing worker for hub subdomains"
```

### Task 5: Cloudflare DNS migration — Will's steps, written for him

**Files:**
- Create: `docs/superpowers/plans/dns-cutover-runbook.md` (website repo)

- [ ] **Step 1: Write the runbook** with EXACTLY these steps (verify current records first with `dig +short A nexpoint.co.uk` and `dig +short CNAME www.nexpoint.co.uk` and include the actual values found):

```markdown
# DNS cut-over runbook (Will — ~20 minutes + propagation)

1. Sign in at dash.cloudflare.com (create the free account if none exists —
   check first: the portal capture worker may already live in one).
2. Add site -> nexpoint.co.uk -> Free plan. Cloudflare imports existing DNS
   records; confirm the GitHub Pages records survived the import:
   - A records on the apex: 185.199.108.153 / .109. / .110. / .111.153
   - CNAME www -> willlawrie02-rgb.github.io (if present today)
   All imported records: keep the proxy status they imported with.
3. Add three records (Type CNAME, Proxy status: Proxied/orange):
   - printhub      -> nexpoint.co.uk
   - millhub       -> nexpoint.co.uk
   - opportunities -> nexpoint.co.uk
4. At Namecheap (domain list -> nexpoint.co.uk -> Nameservers -> Custom DNS)
   replace the registrar nameservers with the two Cloudflare gives you on the
   Add-site screen.
5. Wait for Cloudflare to email "nexpoint.co.uk is active" (minutes to a few
   hours). The website keeps working throughout — records are identical.
6. Tell the session it is done; it deploys the router worker
   (`cd _system/subdomain-router && npx wrangler deploy`) and verifies.
7. SSL/TLS -> Overview -> set encryption mode to "Full (strict)".
```

- [ ] **Step 2: Commit** — `git add docs/superpowers/plans/dns-cutover-runbook.md && git commit -m "Add DNS cut-over runbook"`

- [ ] **Step 3: HAND TO WILL and STOP here until he confirms the zone is active.** This is the plan's one hard human gate.

### Task 6: Deploy and verify end to end

- [ ] **Step 1: Push both branches for Will to merge**

```bash
cd /Users/willlawrie/Documents/Claude/Projects/Nexpoint/website && git push origin claude/platform-cutover
cd /Users/willlawrie/Documents/Claude/Projects/Nexpoint && git push origin claude/platform-cutover
```
Will merges the website branch to `main` (GitHub Pages redeploys automatically, 1–2 min).

- [ ] **Step 2: Deploy the router** (after zone active + site merged): `cd _system/subdomain-router && npx wrangler deploy`

- [ ] **Step 3: Verify every surface**

```bash
curl -sI https://printhub.nexpoint.co.uk/ | head -3
curl -sI https://millhub.nexpoint.co.uk/find.html | head -3
curl -sI https://opportunities.nexpoint.co.uk/ | head -3
curl -sI https://nexpoint.co.uk/portal/ | head -3
```
Expected: `200` on the first three with HTML content; the portal returns its redirect page. Then open each subdomain in a real browser: styles load, images load, nav links cross correctly, no mixed-content warnings.

- [ ] **Step 4: Report** — tell Will: what is live, that the engine's briefs deploy (J1.6/J2 in the `nexpoint-engine` repo) still targets `portal/briefs.json` and needs retargeting to `opportunities/briefs.json` inside that repo (coordinate with Plan D's owner), and that the education subdomain slot is ready in the FOLDERS map when needed. Also note: `website/admin/` files for the three boards are DEPLOY COPIES from the engine repo's `app/` — merges here must not clobber a newer app deploy; coordinate with Plan C's owner if both touch `admin/`.

## Self-review notes

- Spec coverage: §3 fully (subdomains, one repo, hub replaces portal, opportunities from briefs, education parked). Briefs *content* sync retarget deliberately deferred and flagged.
- Order matters: Tasks 1–4 are buildable immediately; Task 5 gates Task 6 only.

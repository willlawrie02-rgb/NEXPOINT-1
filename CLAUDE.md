# nexpoint.co.uk — website repo

Read this before changing anything. Five load-bearing facts:

1. **Merging to `main` IS deploying.** This repo serves the live site via
   GitHub Pages (CNAME nexpoint.co.uk). Never merge a PR without the
   operator's (Will's) explicit OK. Work on `claude/*` branches.
2. **`admin/` is a deploy copy — do not edit it here.** The admin boards'
   source of truth is the engine repo's `app/`
   (`~/Documents/Claude/Projects/Nexpoint 2/app/`). Changes land there and
   arrive here via `nx admin sync`, which pushes a `claude/admin-sync-<date>`
   branch (never main). `nx admin diff` shows drift.
3. **`opportunities/index.html` is a previous-generation page.** It inlines
   its own CSS/auth and predates `hub/assets/portal.css` — do not copy its
   patterns; it is scheduled for a rebuild with its own listing model (D3).
4. **The hub subdomains are folders of this repo.** printhub. / millhub. /
   opportunities.nexpoint.co.uk are served from `printhub/`, `millhub/`,
   `opportunities/` by the Cloudflare router at
   `~/Documents/Claude/Projects/Nexpoint/_system/subdomain-router/worker.js`.
5. **Vocabulary rule (settled 2026-09-07):** customers are never called
   "member(s)"/"membership" anywhere public. A provider with an approved
   listing is a *host*; a site without one is an *account*.

## Checks

Run `npm run check` before any PR (first time: `npm install`). It chains:
`check:js` (node --check on every JS module), `check:html` (html-validate;
`.htmlvalidate.json` relaxes ~11 rules covering 444 pre-existing findings
from 2026-09-09 — tighten one rule at a time as pages are touched, never
grow the off-list silently), and `check:links` (every relative href/src in
static markup must resolve to a file on disk).

## Layout

- `index.html` — apex marketing page (standalone; own inline styles by design)
- `hub/` + `hub/assets/` + `assets/hub-account.js` — the Global Hub and its
  shared modules (portal.css/js, find, listing-form, dashboard, accept)
- `printhub/`, `millhub/` — hub door pages (served on subdomains, see #4)
- `opportunities/` — the briefs board (see #3)
- `admin/` — deploy copy of the engine's boards (see #2)
- `portal/` — an 11-line legacy redirect to `/hub/`; keep it (old bookmarks)
- `check/links.mjs` — the internal link checker

The hub is deliberately `noindex` until the D29 go-live gate (spec
2026-09-07); do not "fix" that.

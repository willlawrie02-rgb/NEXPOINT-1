# Hub Site Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the restored hub surfaces to match the signed site concept — club framing, seeker-first vocabulary, honest depth, one account everywhere, no animation modules — so that merging the PR relaunches the hub.

**Architecture:** The branch `claude/hub-rebuild` already carries the restoration revert (commit 3e55454, controller-applied). Tasks are copy/structure passes per surface plus one real code change (the opportunities board's gate unification onto `NPAccount`). The holding page stays live on `main` until this PR merges; **merging is the relaunch and is Will's click**.

**Tech Stack:** Static site, vanilla JS. No test infra; browser verification.

**Specs (binding, in order of precedence):**
1. Workspace repo `docs/superpowers/specs/2026-09-03-global-hub-commercial-model.md` (money, vocabulary, mechanisms)
2. Website repo `docs/superpowers/specs/2026-09-03-global-hub-site-concept.md` (structure, audiences, surfaces, relaunch gate)

## Global Constraints

- **Vocabulary:** *Host* = paid print/mill supply-side member. *Lister* = free opportunities poster. Seekers carry NO label, are never called "members", and never pay. "Member"/"membership" language is ALLOWED where it genuinely refers to the supply side/club (e.g. "Members warrant a quality service" describing hosts) and FORBIDDEN where it addresses the seeker ("Become a member", "you're a member", "membership is free").
- **No pricing numbers anywhere public** — no £, no $, no percentages. The existing blurred `$██ per pair` teasers become `££ per pair`-free: replace the blurred-price list items with unblurred neutral copy `One standard network price — ask us` (keeps the finder's list shape, kills the dollar glyph).
- **Honest depth:** thin doors say so plainly and confidently. No fabricated capacity, counts, or activity anywhere.
- British English, no emoji, CTAs verb-first, Montserrat/Inter, palette per `brand/design-system.md`. The three `portal.js` copies are NOT identical: hub and millhub match; **printhub is deliberately forked (zero-capacity state) — never cp over it; apply edits to each copy individually and verify the print fork's capacity honesty survives** (see project memory).
- The animation modules are retired: no page loads `explainer.js` or `opps-explainer.js` after this plan. The static storyboard (approved captions) holds the hub-home `#how` slot until the video (build 3) lands.
- Branch `claude/hub-rebuild`. Every commit ends with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Do NOT merge the PR — merging relaunches the live site and is Will's sign-off.

---

### Task 1: Hub home and the shared account module

**Files:**
- Modify: `hub/index.html`, `hub/assets/explainer.css`, `assets/hub-account.js`, `hub/privacy.html`
- Delete: `hub/assets/explainer.js`

- [ ] **Step 1: Retire the animation.** In `hub/index.html` remove the `<script src="assets/explainer.js"></script>` tag (bottom of body). Delete `hub/assets/explainer.js`. The `#explainer` mount's default storyboard content (`.xp-board` with the four approved captions) STAYS — it is now the permanent interim rendering. In `hub/assets/explainer.css`, delete every rule below the `/* ── animation chrome ── */` comment (keep `.hero-how` and the storyboard block: `.xp-board`, `.xp-panel` and their media queries).
- [ ] **Step 2: Club framing, hub home.** Read the hero and `#how` copy. Keep "One trusted network. Four hubs." and the lede. Add one clause of club truth to the lede's end if not already present in spirit — the concept's §1 sentence adapted: after "…by people who know both sides." append nothing if the page already says it (it does — verify and leave). Change the `#how` sub-line `The Global Hub shows you what exists. People decide what meets.` — keep as is (already concept-true). This step is a verification-with-taste pass: the only mandatory edit is removing any copy that promises marketplace mechanics (grep the page for "browse and buy", "marketplace", "order" — none expected; report findings).
- [ ] **Step 3: Member-word sweep, seeker surfaces.** In `assets/hub-account.js`: the questionnaire/sign-in/gate copy must not call the seeker a member. Known instance from the register success path: any string like "you're a member" becomes "your account is live". Grep the file for `member` (case-insensitive) and fix every seeker-addressed use; leave code identifiers (`member_profiles`, `memberFor`, `d.member`) untouched. In `hub/index.html`: sign-in modal copy check (should already say "Create your hub account" — verify). In `hub/privacy.html`: "member of The NexPoint Network" → "hold a NexPoint hub account"; "membership we collect" → "your account we collect"; "your membership" → "your account"; the "Member accounts" heading stays (it names the feature, acceptable) or becomes "Hub accounts" — prefer "Hub accounts" for consistency. Preserve meaning exactly; these are word swaps, not rewrites.
- [ ] **Step 4: Verify in the browser** (static server): hub home renders with storyboard cards in `#how`, no console error for a missing explainer.js (tag removed), sign-in and questionnaire still work against the local worker if cheap (module unchanged functionally), mobile 375px clean.
- [ ] **Step 5: Commit** — `git add -A hub assets/hub-account.js && git commit -m "Hub home: storyboard holds the slot, seeker copy de-membered"` (+ trailer).

---

### Task 2: Print and mill doors — honest depth, host-apply framing

**Files:**
- Modify: `printhub/index.html`, `printhub/find.html`, `printhub/offer.html`, `millhub/index.html`, `millhub/find.html`, `millhub/offer.html`, `hub/assets/portal.js`, `printhub/assets/portal.js`, `millhub/assets/portal.js`

- [ ] **Step 1: Fix the leaked editorial note.** `printhub/index.html` (or a neighbour — grep all three folders) contains leaked draft text beginning `**Point 4 under how the Print Hub works is not valid`. Find it, read the surrounding section, and remove the leaked note entirely; if it flags a genuinely invalid claim in the page's numbered "how it works" steps, ALSO fix that claim to be truthful and report what you changed.
- [ ] **Step 2: Blurred-price teasers.** In each `portal.js` copy (hub, printhub, millhub — individually; printhub is forked): the finder detail list item `Per-pair pricing <span class="blurval">$██ per pair</span>` becomes `Per-pair pricing <span class="blurval">one standard network price</span>` (same classes, no currency glyphs). Verify no other `$` or `£` amounts render anywhere on these pages.
- [ ] **Step 3: Offer pages become host applications.** `printhub/offer.html` currently leads "Own printers? *Be one of the twenty.*" — the founding framing stays (it matches the commercial model's founding-labs promise) but the page must read as an APPLICATION, not a sign-up: in the lede or directly under it, ensure one sentence states the gate plainly — draft: `Hosting is by application. Tell us about your lab and machines; Chris or Will reviews every application personally, and nothing is listed — or charged — until we have approved it and you have accepted the Host Agreement.` Adjust the form's submit button to `Apply to host` if it says anything join-flavoured. Mirror the same treatment on `millhub/offer.html` in that page's own words. Use "Host"/"hosting" vocabulary throughout both.
- [ ] **Step 4: Honest depth lines.** `printhub/index.html` and `printhub/find.html`: verify the zero-capacity state reads confidently (the forked portal.js already withholds fabricated numbers) — where the page has an empty-state or low-density moment, the line to use (adapt to the markup in place): `The first print nodes are joining now, by invitation. Tell us what you need and we will come back to you personally.` `millhub/*`: verify the mill story claims only the verified manufacturer reality (cells on two continents, regions served today) — flag and fix any claim beyond it.
- [ ] **Step 5: Member-word sweep** on all six pages per the Global Constraints rule (host-referring "member" copy like "Members warrant a quality service" STAYS; seeker-addressed membership language goes). The finder copy "member is in the same country as the node" (in portal.js copies) refers to the supply node's owner — read it in context and keep or reword for clarity, stating your call.
- [ ] **Step 6: Verify in the browser**: both hubs' index/find/offer render; finder opens with the de-priced teaser line; print find still shows the honest zero-capacity state; console clean.
- [ ] **Step 7: Commit** — `git add printhub millhub hub/assets/portal.js && git commit -m "Print and mill doors: host applications, honest depth, no prices"` (+ trailer).

---

### Task 3: Opportunities — one account, no second wall

**Files:**
- Modify: `opportunities/index.html`
- Delete: `opportunities/assets/opps-explainer.js`, `opportunities/assets/opps-explainer.css`

- [ ] **Step 1: Remove the infomercial.** Delete the `<section class="oxplain" id="what">` block, the `<link rel="stylesheet" href="assets/opps-explainer.css">`, and the `<script src="assets/opps-explainer.js"></script>` tag; delete both asset files. (The board's own `#how` steps section stays — it is good copy.)
- [ ] **Step 2: Unify the gate on NPAccount.** Read the page's gating system first: `let member=false` (~line 1498), `openGate()` (~1706) with its multi-step signup (`renderContactForm`, `finishGate`, `upsertProfile`, its own `sb.auth` session), the `onSignedIn` path, and the gated call sites (~418 `navAccess` "Become a member", ~433 "View live opportunities", ~507, ~544, ~1554, ~1611). Replace the page's own membership with the hub account:
  - `member` becomes derived state: true when `window.NPAccount && NPAccount.user` (recompute on the `npaccount:change` document event and re-render whatever `onSignedIn`/lock UI depends on it).
  - `openGate()` no longer runs its own signup steps: signed-out it calls `NPAccount.openQuestionnaire({})` (guarded on the module existing, with the previous behaviour as fallback if the module failed to load); signed-in it is a no-op.
  - The page's own sign-in modal keeps working via the existing `doSignIn` → `NPAccount.signIn` path (already wired in an earlier phase); its local `sb.auth.signInWithPassword` fallback stays as the module-absent fallback only.
  - Retire the local signup flow (`renderContactForm` steps, `finishGate`, `upsertProfile`) — delete or short-circuit so no page path reaches them; state which you did and why.
  - The board unlock (brief details, contact reveal) keys off the same derived `member` state.
- [ ] **Step 3: Copy pass.** `Become a member` buttons/links → `Create your hub account`. `Members only · membership is free` → `Signed-in only · a hub account takes two minutes`. Any remaining seeker-membership language per the global rule. Lister-side copy (posting an opportunity) may say listing is free; no success-fee numbers.
- [ ] **Step 4: Verify in the browser** (local worker running for the API): signed-out — "View live opportunities" opens the hub questionnaire, not the old wall; sign in with a throwaway-free existing flow is NOT possible locally without the worker, so verify via the established pattern (NPAccount.signIn with a test account if the worker is up, else DOM-trace the gating logic and say so); signed-in state unlocks the board list; `npaccount:change` flips the nav CTA; console clean bar known locals; no references to the deleted assets.
- [ ] **Step 5: Commit** — `git add -A opportunities && git commit -m "Opportunities: one hub account unlocks the board, infomercial retired"` (+ trailer).

---

### Task 4: Whole-site sweep, verification, relaunch handoff

- [ ] **Step 1: Sweeps** (repo-wide over public surfaces `hub/ printhub/ millhub/ opportunities/ index.html assets/`): (a) seeker-membership language — the Global Constraints rule, zero violations; (b) pricing — no `£`/`$` amounts, no `%` fees; (c) dead references — no page references `explainer.js`, `opps-explainer`, or deleted flows; (d) vocabulary — "Host" used for supply on print/mill, no "provider" on public copy unless quoting the certified-network promise naturally.
- [ ] **Step 2: Full browser pass**: all four doors + homepage, desktop and 375px, console clean (bar known local-API refusals), act gates and sign-in flows work against the local worker, storyboard renders on the hub home, opportunities board unlocks via hub account only.
- [ ] **Step 3: Push and hand over.** Push `claude/hub-rebuild`; open a PR titled "Hub site rebuild — relaunch to the settled concept" whose body states: merging RELAUNCHES the hub (holding page replaced), lists the surface-by-surface changes, and reminds that the relaunch gate's other half (both specs signed) is already met. **Will merges.** Post-merge live checks (controller, after Will's click): all four doors serve rebuilt pages, holding page gone, board unlock via hub account live, admin/API untouched.

## Self-review notes (done at planning time)

- Concept coverage: club-not-marketplace copy (T1/T2) · seekers unlabelled and free (T1 S3, T2 S5, T3 S3) · four doors kept (structure untouched) · board wall unified (T3 S2) · no public pricing (T2 S2, T4 S1b) · honest depth (T2 S1/S4) · certification-not-reviews untouched (no reviews exist) · animation retired, storyboard interim (T1 S1, T3 S1) · relaunch gate honoured (merge = Will).
- The printhub portal.js fork rule is restated in Global Constraints and T2 steps (memory: portal-js-copies-forked).
- Placeholders: none — every mandated edit carries its target string or exact draft copy; verification-with-taste steps state the rule the implementer applies and require reporting of judgement calls.

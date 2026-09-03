# Global Hub — site concept

*2026-09-03 · settled with Will in session (grilled to an empty frontier) · merging this PR is
Will's sign-off. This document governs the WEBSITE: structure, audiences, what each surface
shows, and the relaunch gate. Everything money-shaped — fees, the order ledger, the compliance
score, terms, host onboarding mechanics — is governed by the canonical commercial model in the
workspace repo: `docs/superpowers/specs/2026-09-03-global-hub-commercial-model.md`. Where the
two ever disagree, the commercial model wins. The hub surfaces are behind a holding page
(website commit ea6a432) until the relaunch gate below is met.*

## 1. What the hub is

An **invitation-quality introductions club, not a marketplace**. Clinics, labs and companies
come looking for capacity, products or partners; Will and Chris match each enquiry to a small
number of certified providers and make a personal introduction; work, files and money then flow
directly between the parties, with the order logged on the hub's ledger (commercial model §2).
Nothing is bought on the site. The site is the club's shopfront and intake — it explains,
captures, and routes to a human.

## 2. Audiences, weighted

- **Seekers first.** The public site's advertising job is bringing in the demand side: those
  with work to place or needs to meet. Seekers never pay and get the lightest possible path.
- **Hosts arrive two ways**: through Will and Chris's direct BD (the pipeline already holds
  BioStep, Biotech, Kintec and others), and through the site's **gated apply flow** — apply →
  host profile → Host Agreement → approval by Will or Chris; live and billed only at approval
  (commercial model §4). No self-serve "join as a provider and appear" path exists.
- **Vocabulary (from the commercial model):** *Host* — paid, print/mill supply. *Lister* —
  free opportunities posting, success fee on the deal. Seekers carry no label and no charge.

## 3. Structure — four doors, one club

The four doors stay as built: **Print Hub · Mill Hub · Global Opportunities Hub · Education
Hub**, on their subdomains, under the Global Hub umbrella. Commercially they are one club: one
organisation subscription covers hosting on print and mill; opportunities listings are free
with the existing success-fee route; education is free (a member benefit deepens it later).

Per door, the public face is:

- **Print / Mill** — anonymised, verified capacity only ("anonymised on the page, verified by
  us in person"). Where a door is still thin, it says so honestly — first nodes joining now —
  rather than showing fabricated depth. Acting on anything routes through the act gate.
- **Global Opportunities Hub** — the briefs board as built, with its separate sign-in wall
  RETIRED: one seeker hub account signs you in everywhere, including the board.
- **Education Hub** — stays the light name-and-email list publicly; the quarterly programme
  is delivered to the network.

## 4. Accounts on the site

Person accounts inside an Organisation, per the commercial model §1 (which extends, not
replaces, the 2026-09-01 accounts spec): the three-step questionnaire, act gate and instant
sign-in all stand; hub accounts are the SEEKER side and are free. Host status is an
organisation-level upgrade granted through the gated apply flow. The word "member" is not used
for seekers anywhere in site copy.

## 5. Money on the site

**No numbers, anywhere public.** No subscription price, no per-pair price, no percentage.
The seeker-facing pitch is capability and trust ("one standard network price — ask us"), and
nothing about NexPoint's cut is ever shown to a seeker (commercial model §3). Collective OEM
benefits may be referenced without figures.

## 6. Trust signals

Certification is the public trust signal — every node certified, visited, known personally.
**No public reviews, stars or scores** (the compliance score is a private, internal mechanism;
commercial model §5). Discretion copy stays: names and prices appear only inside a personal
introduction.

## 7. Relaunch gate

The holding page comes off when, and only when:
1. This concept and the commercial model are both signed (their PRs merged), and
2. The site copy and surfaces have been rebuilt to describe the club truthfully — every door
   honest about its current depth, vocabulary per §2, intake working end to end.

No host-count threshold is required to relaunch; thin-but-honest beats closed. Restoring the
hub is a revert of website commit ea6a432, applied after the rebuild lands on top of it.

## 8. What follows this document (in order, each its own plan)

1. **Site rebuild to concept** — copy and structure pass across the four doors + homepage
   (hub links return), the board-wall unification, and honest-depth states. Includes the
   member-word sweep.
2. **Commercial-model build** — organisations, ledger, dashboards, terms clicks, apply flow
   (schema and endpoints per the commercial model's build-implications section; engine-repo
   migrations).
3. **The single explainer video** — one video, "how the Global Hub works", both sides of the
   story, built from the parked frames in workspace `marketing/hub-animation-frames/` (style
   locked there); captions drafted against this concept's vocabulary; PR merge is copy
   approval, as established.

## Superseded / retired by this document

- The four-scene hub-home SVG explainer and the opportunities infomercial as separate pieces
  (one video replaces both; the shipped SVG explainer is behind the holding page and will not
  return in its current form).
- The opportunities board's separate membership wall.
- Any site copy calling seekers "members".

# Global Opportunities Hub Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Global Opportunities Hub infomercial — a four-scene, hand-built SVG/CSS/JS animation on `opportunities/index.html` telling Chris's product-hub story (cross-border matching, negotiated perks, the no-pressure go-to place), plus the page's rename to its settled name.

**Architecture:** A new hub-scoped module (`opportunities/assets/opps-explainer.js` + `.css`) mounts into a new section between `principles` and the board. The page does NOT load `portal.js`, so the module carries its own copy of the land-mask data and projection helpers (copied verbatim from `hub/assets/portal.js`, `OX_`-prefixed, with a provenance comment). Engine architecture mirrors `hub/assets/explainer.js` — scene clock, clickable dots, `_enter`/`_exit`/`_timers` hygiene, end-card overlay, storyboard default content as the no-JS/reduced-motion fallback — restyled for this page's dark canvas using its own tokens. The four `.step` cards in `#how` tell the introduction journey and are NOT touched.

**Tech Stack:** Vanilla JS/CSS/SVG, no libraries. Dark-canvas page (`--bg:#121212` — this board never received the light-canvas migration; the module matches its host, and the page-level palette question is Will's, not this plan's).

**Source authority:** Chris's Product Hub recording, verbatim at `chris-chats/assets/2026-08-24/03_product-hub-transcript.md` (parent repo), summarised in `chris-chats/2026-08-24_hub-animation-briefs.md`. Naming settled by Will 2026-09-02: **Global Opportunities Hub**. There is NO pre-approved caption copy for this piece — the captions below are drafted from Chris's recorded words in the house voice, and the PR merge is Will's copy sign-off.

## Global Constraints

- **Draft copy — use VERBATIM as written here (Will approves at merge):**
  - Scene titles + captions:
    1. *The old way* — "A product proven at home used to mean years of exhibitions, business cards and interviews before it sold abroad."
    2. *We know both ends* — "A company in Canada, a distributor in Europe — NexPoint knows people at both ends, thinks of the fit, and introduces you directly."
    3. *More than listings* — "Partner discounts we've negotiated on scanners and materials live inside the hub, and the quarterly programmes put what's new in front of the whole community."
    4. *A go-to place* — "Products, services, materials and technologies from across the world — browse what might suit you, under no pressure whatsoever."
  - End card: **"Under no pressure whatsoever."** — Chris's words, no button.
  - Section heading: "What the Global Opportunities Hub does" with eyebrow "The Global Opportunities Hub".
- **Rename pass, THIS PAGE ONLY:** every page-local self-reference to "NexPoint Opportunities Hub" / "Opportunities Hub" (title tag, hero eyebrow, meta, aria strings — grep finds 5) becomes the settled name, reading naturally in each spot (e.g. title "NexPoint Global Opportunities Hub", eyebrow "The Global Opportunities Hub"). Nav labels on OTHER pages are out of scope.
- Four scenes ≈ 25 s (`DUR [5500,5500,5500,8500]`), looping, ~3 s end-card hold; clickable dots; autoplay; `prefers-reduced-motion: reduce` and no-JS both get the static four-panel storyboard (the mount's default HTML). Brand easing via the page's own `--ease` (`cubic-bezier(.2,.8,.2,1)`); scene transitions 500 ms; colours ONLY from the page's tokens (`--surface`, `--border-card`, `--on-surface`, `--on-surface-var`, `--blue`, `--blue-bright`, `--green`, `--font-display`, `--font-body`, `--radius-lg/xl`). On the dark canvas, map land dots use `rgba(226,226,226,.28)` (matches the page's muted-text alpha family), arcs use `--green` (main) and `--blue-bright` (faint).
- **No libraries. No emoji. British English.** The `#how` steps, the board, the hero and its globe are untouched. `hub/assets/portal.js` and its copies are untouched (see project memory: printhub's copy is deliberately forked — nothing in this plan goes near any portal.js).
- The module's engine names mirror `hub/assets/explainer.js` (`el()`, `xy()`, `scenes[]`, `_enter`/`_exit`, `g._timers`, `root._goEnd`, `goTo`) so future maintainers see one family; map helpers are `OX_`-prefixed (`OX_LAND`, `OX_isLand`, `OX_mapX`, `OX_mapY`, `OX_W=720`, `OX_H=340`) since this page has no portal.js globals to collide with but may gain scripts later.
- Branch `claude/opps-animation`. Every commit ends with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Verification is browser-based; the in-app pane's known limits apply (below-fold screenshots may hang on heavy pages; layout APIs can misreport — DOM/state assertions are sanctioned evidence).

---

### Task 1: Section markup, storyboard, stylesheet, rename pass

**Files:**
- Create: `opportunities/assets/opps-explainer.css`
- Modify: `opportunities/index.html` (new section after `principles` closes, before `<section class="board" id="briefs">`; head link for the CSS; script tag for the module at the END of the body, after the page's inline script; the rename pass)

**Interfaces:**
- Produces: `<div id="oppsExplainer" class="ox-mount">` whose default content is the storyboard (`.ox-board` grid of four `.ox-panel`s); CSS classes Task 2/3 rely on: `.ox`, `.ox-stage`, `.ox-caption`, `.ox-cap-title`, `.ox-cap-body`, `.ox-dots`, `.ox-dot` (+ `.is-on`), `.ox-end` (+ `.ox.is-end .ox-end`), scene selectors `.ox[data-scene="0..3"] .ox-s0..3`, `.ox-land`, `.ox-pin` (+ `--pulse`), `.ox-arc` (+ `.is-drawn`, `--faint`, `--len`), `.ox-card`, `.ox-cardg` (+ `.is-on`), `.ox-line`, `.ox-tag`, `.ox-scatter`, `.ox-tangle`, `.ox-op`, `--ox-ease`.

- [ ] **Step 1: Insert the section** after `principles`' closing `</section>` (before the `<!-- ... -->` comment preceding the board section, keeping the page's comment style):

```html
<!-- WHAT THE HUB DOES -->
<section class="oxplain" id="what">
  <div class="container">
    <span class="eyebrow eyebrow--green">The Global Opportunities Hub</span>
    <h2>What the Global Opportunities Hub does</h2>
    <div id="oppsExplainer" class="ox-mount">
      <div class="ox-board">
        <div class="ox-panel"><span class="n">01</span><h3>The old way</h3><p>A product proven at home used to mean years of exhibitions, business cards and interviews before it sold abroad.</p></div>
        <div class="ox-panel"><span class="n">02</span><h3>We know both ends</h3><p>A company in Canada, a distributor in Europe — NexPoint knows people at both ends, thinks of the fit, and introduces you directly.</p></div>
        <div class="ox-panel"><span class="n">03</span><h3>More than listings</h3><p>Partner discounts we've negotiated on scanners and materials live inside the hub, and the quarterly programmes put what's new in front of the whole community.</p></div>
        <div class="ox-panel"><span class="n">04</span><h3>A go-to place</h3><p>Products, services, materials and technologies from across the world — browse what might suit you, under no pressure whatsoever.</p></div>
      </div>
    </div>
  </div>
</section>
```

Match the neighbouring sections' spacing conventions (read `principles`/`board` markup); if sections on this page carry entrance-animation classes, mirror them; the `<h2>` styling should inherit the page's section-heading look (verify against `#how`'s `<h2>`).

- [ ] **Step 2: Create `opportunities/assets/opps-explainer.css`** and link it in the `<head>` after the page's font links (this page has no external stylesheet today — the inline `<style>` stays; one `<link rel="stylesheet" href="assets/opps-explainer.css">` is the cleanest addition and works on both the subdomain and the apex path since it's folder-relative):

```css
/* Global Opportunities Hub infomercial — storyboard fallback + animation
   chrome. Dark-canvas page: every colour rides the page's own tokens. */

.oxplain{border-bottom:1px solid var(--border-soft)}
.oxplain h2{font-family:var(--font-display);margin:14px 0 26px}

/* ── storyboard (default; permanent for reduced-motion and no-JS) ── */
.ox-board{display:grid;grid-template-columns:repeat(4,1fr);gap:18px}
.ox-panel{background:var(--surface);border:1px solid var(--border-card);border-radius:var(--radius-xl);padding:20px 18px}
.ox-panel .n{font:700 12px/1 var(--font-display);color:var(--green);letter-spacing:.08em}
.ox-panel h3{font:700 16px/1.3 var(--font-display);color:var(--on-surface);margin:10px 0 8px}
.ox-panel p{font:400 13.5px/1.55 var(--font-body);color:var(--on-surface-var);margin:0}
@media (max-width:900px){.ox-board{grid-template-columns:1fr 1fr}}
@media (max-width:560px){.ox-board{grid-template-columns:1fr}}

/* ── animation chrome ── */
.ox{--ox-ease:var(--ease);position:relative;background:var(--surface);border:1px solid var(--border-card);border-radius:var(--radius-xl);overflow:hidden}
.ox-stage{display:block;width:100%;height:auto}
.ox-caption{padding:16px 22px 6px;min-height:86px}
.ox-cap-title{font:700 15px/1 var(--font-display);color:var(--on-surface);display:block}
.ox-cap-body{font:400 13.5px/1.55 var(--font-body);color:var(--on-surface-var);margin:7px 0 0;max-width:640px}
.ox-dots{display:flex;gap:8px;padding:0 22px 18px}
.ox-dot{width:26px;height:4px;border-radius:9999px;background:var(--border-card);border:none;padding:0;cursor:pointer;transition:background .3s}
.ox-dot.is-on{background:var(--blue-bright)}
.ox-dot:hover{background:var(--green)}

/* map + shared */
.ox-stage .ox-land{stroke:rgba(226,226,226,.28);stroke-width:1.7;stroke-linecap:round;fill:none}
.ox-stage .ox-pin{fill:var(--blue-bright)}
.ox-stage .ox-pin--pulse{animation:oxPulse 1.6s var(--ox-ease) infinite}
@keyframes oxPulse{0%,100%{opacity:1}50%{opacity:.35}}
.ox-stage .ox-arc{stroke:var(--green);stroke-width:2.2;fill:none;stroke-linecap:round;stroke-dasharray:var(--len);stroke-dashoffset:var(--len)}
.ox-stage .ox-arc.is-drawn{transition:stroke-dashoffset 1.4s var(--ox-ease);stroke-dashoffset:0}
.ox-stage .ox-arc--faint{stroke:var(--blue-bright);opacity:.4;stroke-width:1.6}

/* scene groups */
.ox-stage .ox-scene{opacity:0;transform:translateY(8px);transition:opacity .5s var(--ox-ease),transform .5s var(--ox-ease);pointer-events:none}
.ox[data-scene="0"] .ox-s0,.ox[data-scene="1"] .ox-s1,.ox[data-scene="2"] .ox-s2,.ox[data-scene="3"] .ox-s3{opacity:1;transform:none}

/* cards and pieces */
.ox-stage .ox-card{fill:#242424;stroke:var(--border-card)}
.ox-stage .ox-cardg{transition:opacity .5s var(--ox-ease)}
.ox-stage .ox-line{stroke:#3A3A3A;stroke-width:6;stroke-linecap:round}
.ox-stage .ox-scatter rect{fill:#242424;stroke:#333;opacity:.55}
.ox-stage .ox-scatter{animation:oxDrift 5.5s ease-in-out infinite alternate}
@keyframes oxDrift{from{transform:translateY(0)}to{transform:translateY(4px)}}
.ox-stage .ox-tangle{stroke:rgba(226,226,226,.22);stroke-width:1.4;fill:none;stroke-dasharray:4 5}
.ox-stage .ox-tag{opacity:0;transform:scale(.6);transform-origin:center;transform-box:fill-box}
.ox-stage .is-on .ox-tag{transition:opacity .45s var(--ox-ease),transform .45s var(--ox-ease);opacity:1;transform:scale(1)}
.ox-stage .ox-tag rect{fill:var(--green)}
.ox-stage .ox-tag text{font:700 9px var(--font-display);fill:#121212;letter-spacing:.06em}
.ox-stage text.ox-label{font:700 10px var(--font-display);fill:var(--on-surface);letter-spacing:.05em}
.ox-stage text.ox-sub{font:500 9px var(--font-body);fill:rgba(226,226,226,.65)}
.ox-stage .ox-op{opacity:0;transform:translateY(6px);transition:opacity .5s var(--ox-ease),transform .5s var(--ox-ease)}
.ox-stage .is-on .ox-op{opacity:1;transform:none}
.ox-stage .is-on .ox-op:nth-of-type(2){transition-delay:.3s}
.ox-stage .is-on .ox-op:nth-of-type(3){transition-delay:.6s}
.ox-stage .ox-tick{fill:var(--green);transform:scale(0);transform-origin:center;transform-box:fill-box}
.ox-stage .is-on .ox-tick{transition:transform .45s var(--ox-ease) 1.5s;transform:scale(1)}
.ox-stage .ox-tickmark{stroke:#121212;stroke-width:2.4;fill:none;stroke-linecap:round}

/* end card */
.ox-end{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(30,30,30,.9);opacity:0;pointer-events:none;transition:opacity .6s var(--ox-ease)}
.ox.is-end .ox-end{opacity:1}
.ox-end p{font:700 clamp(22px,3.4vw,32px)/1.2 var(--font-display);color:var(--on-surface);margin:0}
```

- [ ] **Step 3: Script tag.** At the very end of the body, after the page's inline `<script>` block, add `<script src="assets/opps-explainer.js"></script>` (folder-relative — works on subdomain and apex; the file lands in Task 2, so a 404 here is expected and noted in the commit body).

- [ ] **Step 4: Rename pass.** Grep the page for `Opportunities Hub` (5 hits): update the `<title>`, the hero eyebrow, and any meta/aria self-references to the settled name so each reads naturally ("NexPoint Global Opportunities Hub" / "The Global Opportunities Hub"). Do not touch the board copy, brief text, or `#how`.

- [ ] **Step 5: Verify statically** (static server + in-app browser at `http://localhost:8000/opportunities/`): the new section renders between principles and the board with the four dark storyboard panels; heading/eyebrow styled like the page's own; title tag renamed; console shows only the module 404 + the known pre-existing errors; mobile 375 px single-column, no horizontal scroll.

- [ ] **Step 6: Commit** — `git add opportunities/ && git commit -m "Opportunities: infomercial storyboard section, settled name"` (+ trailer, noting the expected 404).

---

### Task 2: Module engine — map, clock, dots, scenes 1–2

**Files:**
- Create: `opportunities/assets/opps-explainer.js`

**Interfaces:**
- Consumes: Task 1's mount + CSS classes.
- Produces: the mounted `.ox` component; `scenes` array with `_enter`/`_exit`/`_timers` convention; `root._goEnd`; empty `ox-s2`/`ox-s3` groups for Task 3.

- [ ] **Step 1: Write the module.** FIRST read `hub/assets/explainer.js` end to end — it is the engine this file mirrors (same clock/goTo/_exit shape, same timer hygiene). Then create `opportunities/assets/opps-explainer.js`:

```js
/* Global Opportunities Hub infomercial (Chris's 24 Aug product-hub brief;
   naming settled 2026-09-02). Engine mirrors hub/assets/explainer.js.
   This page does not load portal.js, so the land mask and projection are
   carried here, OX_-prefixed — copied VERBATIM from hub/assets/portal.js
   (Natural Earth 110m rasterised at 1.2 degrees; update both if ever
   regenerated). Bails to the static storyboard under reduced motion. */
(function () {
  'use strict';
  var mount = document.getElementById('oppsExplainer');
  if (!mount) return;
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  /* ── map data (see header comment) ── */
  var OX_STEP = 1.2, OX_ROWS = 118, OX_LAT_TOP = 84, OX_LAT_BOT = -58;
  var OX_W = 720, OX_H = 340;
  var OX_LAND = [/* COPY the LAND array VERBATIM from hub/assets/portal.js (the
    118-row run-length array beginning "[[117,127]]") — every row, unmodified */];
  function OX_isLand(lat, lon) {
    var row = Math.floor((OX_LAT_TOP - lat) / OX_STEP);
    var col = Math.floor((lon + 180) / OX_STEP);
    if (row < 0 || row >= OX_ROWS || col < 0 || col >= 300) return false;
    var segs = OX_LAND[row];
    for (var i = 0; i < segs.length; i++) if (col >= segs[i][0] && col <= segs[i][1]) return true;
    return false;
  }
  function OX_mapX(lon) { return (lon + 180) / 360 * OX_W; }
  function OX_mapY(lat) { return (OX_LAT_TOP - lat) / (OX_LAT_TOP - OX_LAT_BOT) * OX_H; }

  var NS = 'http://www.w3.org/2000/svg';
  var PT = { ca: [56, -106], eu: [51, 10], aus: [-25, 134], us: [39, -98], uk: [52, -1.5], br: [-10, -55], jp: [36, 138] };
  var xy = function (k) { return [OX_mapX(PT[k][1]), OX_mapY(PT[k][0])]; };

  var CAPTIONS = [
    ['The old way', 'A product proven at home used to mean years of exhibitions, business cards and interviews before it sold abroad.'],
    ['We know both ends', 'A company in Canada, a distributor in Europe — NexPoint knows people at both ends, thinks of the fit, and introduces you directly.'],
    ['More than listings', "Partner discounts we've negotiated on scanners and materials live inside the hub, and the quarterly programmes put what's new in front of the whole community."],
    ['A go-to place', 'Products, services, materials and technologies from across the world — browse what might suit you, under no pressure whatsoever.']
  ];
  var DUR = [5500, 5500, 5500, 8500];

  function el(name, attrs, parent) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function txt(node, s) { node.textContent = s; return node; }

  var root = document.createElement('div');
  root.className = 'ox';
  root.setAttribute('data-scene', '0');
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', 'What the Global Opportunities Hub does — animated overview');
  var svg = el('svg', { viewBox: '0 0 ' + OX_W + ' ' + OX_H, 'aria-hidden': 'true', 'class': 'ox-stage' });
  root.appendChild(svg);

  /* the persistent dotted world */
  var d = '';
  for (var lat = OX_LAT_TOP; lat >= OX_LAT_BOT; lat -= OX_STEP) {
    for (var lon = -180; lon < 180; lon += OX_STEP) {
      if (OX_isLand(lat, lon)) d += 'M' + OX_mapX(lon).toFixed(1) + ' ' + OX_mapY(lat).toFixed(1) + 'h0';
    }
  }
  el('path', { d: d, 'class': 'ox-land' }, svg);

  var scenes = [];
  for (var i = 0; i < 4; i++) scenes.push(el('g', { 'class': 'ox-scene ox-s' + i }, svg));

  /* ── scene 1: the old way — a product at home, the legwork abroad ── */
  (function (g) {
    g._timers = [];
    var ca = xy('ca');
    var prod = el('g', { transform: 'translate(' + (ca[0] - 34) + ',' + (ca[1] - 22) + ')' }, g);
    el('rect', { x: 0, y: 0, width: 68, height: 44, rx: 8, 'class': 'ox-card' }, prod);
    txt(el('text', { x: 34, y: 19, 'text-anchor': 'middle', 'class': 'ox-label' }, prod), 'PRODUCT');
    txt(el('text', { x: 34, y: 33, 'text-anchor': 'middle', 'class': 'ox-sub' }, prod), 'proven at home');
    /* the tangle: one wandering dashed path from the product across the ocean */
    var eu = xy('eu');
    el('path', { d: 'M' + (ca[0] + 34) + ' ' + ca[1] +
      ' q60 -46 120 -18 q50 24 40 58 q-14 40 56 30 q60 -8 ' + (eu[0] - (ca[0] + 250)) + ' ' + (eu[1] - ca[1] - 70), 'class': 'ox-tangle' }, g);
    /* scattered business cards across Europe */
    var scat = el('g', { 'class': 'ox-scatter' }, g);
    [[-38, -30], [12, -44], [44, -12], [-10, 8], [30, 22], [-44, 18]].forEach(function (o) {
      el('rect', { x: eu[0] + o[0], y: eu[1] + o[1], width: 26, height: 16, rx: 3 }, scat);
    });
    g._enter = function () { g._timers.forEach(clearTimeout); g._timers = []; };
  })(scenes[0]);

  /* ── scene 2: we know both ends — the tangle becomes one clean arc ── */
  (function (g) {
    g._timers = [];
    var ca = xy('ca'), eu = xy('eu');
    var pinCa = el('circle', { cx: ca[0], cy: ca[1], r: 4, 'class': 'ox-pin' }, g);
    var pinEu = el('circle', { cx: eu[0], cy: eu[1], r: 4, 'class': 'ox-pin' }, g);
    var mx = (ca[0] + eu[0]) / 2, my = Math.min(ca[1], eu[1]) - 60;
    var arc = el('path', { d: 'M' + ca[0] + ' ' + ca[1] + ' Q' + mx + ' ' + my + ' ' + eu[0] + ' ' + eu[1], 'class': 'ox-arc' }, g);
    var a2 = xy('aus'), u2 = xy('us');
    var arc2 = el('path', { d: 'M' + a2[0] + ' ' + a2[1] + ' Q' + ((a2[0] + u2[0]) / 2) + ' ' + (Math.min(a2[1], u2[1]) - 55) + ' ' + u2[0] + ' ' + u2[1], 'class': 'ox-arc ox-arc--faint' }, g);
    [arc, arc2].forEach(function (p) { /* --len set at build; groups are opacity-hidden, so getTotalLength is safe */
      p.style.setProperty('--len', Math.ceil(p.getTotalLength()));
    });
    /* the fit, confirmed: tick at the arc's apex */
    var wrap = el('g', { 'class': 'ox-cardg' }, g);
    var tickg = el('g', { transform: 'translate(' + mx + ',' + (my + 34) + ')', 'class': 'ox-tick' }, wrap);
    el('circle', { cx: 0, cy: 0, r: 10 }, tickg);
    el('path', { d: 'M-4 0 l3 3 l6 -7', 'class': 'ox-tickmark' }, tickg);
    g._enter = function () {
      g._timers.forEach(clearTimeout); g._timers = [];
      [arc, arc2].forEach(function (p) { p.classList.remove('is-drawn'); });
      wrap.classList.remove('is-on');
      void g.getBoundingClientRect();
      g._timers.push(setTimeout(function () { arc.classList.add('is-drawn'); wrap.classList.add('is-on'); }, 500));
      g._timers.push(setTimeout(function () { arc2.classList.add('is-drawn'); }, 1600));
      pinCa.classList.add('ox-pin--pulse'); pinEu.classList.add('ox-pin--pulse');
    };
    g._exit = function () {
      g._timers.forEach(clearTimeout); g._timers = [];
      pinCa.classList.remove('ox-pin--pulse'); pinEu.classList.remove('ox-pin--pulse');
    };
  })(scenes[1]);

  /* captions, dots, end card */
  var cap = document.createElement('div'); cap.className = 'ox-caption';
  var capT = document.createElement('span'); capT.className = 'ox-cap-title'; cap.appendChild(capT);
  var capB = document.createElement('p'); capB.className = 'ox-cap-body'; cap.appendChild(capB);
  root.appendChild(cap);
  var dotsWrap = document.createElement('div'); dotsWrap.className = 'ox-dots';
  var dots = CAPTIONS.map(function (c, idx) {
    var b = document.createElement('button');
    b.className = 'ox-dot'; b.type = 'button';
    b.setAttribute('aria-label', 'Scene ' + (idx + 1) + ': ' + c[0]);
    b.addEventListener('click', function () { goTo(idx, true); });
    dotsWrap.appendChild(b); return b;
  });
  root.appendChild(dotsWrap);
  var end = document.createElement('div'); end.className = 'ox-end';
  var endP = document.createElement('p'); endP.textContent = 'Under no pressure whatsoever.'; end.appendChild(endP);
  root.appendChild(end);

  var current = -1, timer = null;
  function goTo(i, manual) {
    clearTimeout(timer);
    if (current >= 0 && scenes[current] && scenes[current]._exit) scenes[current]._exit();
    current = i;
    root.setAttribute('data-scene', String(i));
    root.classList.remove('is-end');
    dots.forEach(function (b, idx) { b.classList.toggle('is-on', idx === i); });
    capT.textContent = CAPTIONS[i][0];
    capB.textContent = CAPTIONS[i][1];
    var g = scenes[i];
    if (g._enter) g._enter();
    timer = setTimeout(next, DUR[i] + (manual ? 1500 : 0));
  }
  function next() { goTo((current + 1) % 4, false); }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) clearTimeout(timer);
    else { clearTimeout(timer); timer = setTimeout(next, 1500); }
  });

  root._goEnd = function () { root.classList.add('is-end'); };
  root._scenes = scenes;

  mount.innerHTML = '';
  mount.appendChild(root);
  goTo(0, false);
})();
```

The one non-verbatim instruction: the `OX_LAND` array placeholder above is filled by copying the `LAND` array from `hub/assets/portal.js` (the 118-row run-length structure starting `[[117,127]]`) character-for-character. Sanity-check with `node -e` that `OX_LAND.length === 118` after pasting.

- [ ] **Step 2: `node --check opportunities/assets/opps-explainer.js`** and browser-verify (static server): the storyboard is replaced by the dark map component; scene 1 shows the product card on Canada with the tangled path and drifting cards over Europe; scene 2 clears to the clean green Canada→Europe arc + faint Australia→US arc + tick; scenes 3/4 show captions over the bare map (empty groups — expected); dots work; captions exact (JS textContent comparison); tab-hide pauses; console clean bar the known pre-existing errors.

- [ ] **Step 3: Commit** — `git add opportunities/assets/opps-explainer.js && git commit -m "Opportunities: infomercial engine — map, clock, scenes 1 and 2"` (+ trailer).

---

### Task 3: Scenes 3–4, end card, loop

**Files:**
- Modify: `opportunities/assets/opps-explainer.js` (fill `scenes[2]`/`scenes[3]`)

**Interfaces:**
- Consumes: Task 2's `el()`, `xy()`, `scenes`, `root._goEnd`, timer/hook conventions, Task 1's CSS.

- [ ] **Step 1: Scene 3 — more than listings.** Three product cards in a row over the quieted map; the middle one pops a green PARTNER CODE tag; a slim bottom line notes the quarterly programme:

```js
  /* ── scene 3: more than listings — perks and the programme ── */
  (function (g) {
    g._timers = [];
    var wrap = el('g', { 'class': 'ox-cardg' }, g);
    var defs = [['SCANNER', 168], ['MATERIAL', 306], ['TECHNOLOGY', 444]];
    defs.forEach(function (dd) {
      var c = el('g', { transform: 'translate(' + dd[1] + ',96)' }, wrap);
      el('rect', { x: 0, y: 0, width: 108, height: 64, rx: 8, 'class': 'ox-card' }, c);
      txt(el('text', { x: 54, y: 24, 'text-anchor': 'middle', 'class': 'ox-label' }, c), dd[0]);
      el('line', { x1: 16, y1: 40, x2: 92, y2: 40, 'class': 'ox-line' }, c);
    });
    var tag = el('g', { transform: 'translate(360,88)', 'class': 'ox-tag' }, wrap);
    el('rect', { x: -46, y: -12, width: 92, height: 22, rx: 11 }, tag);
    txt(el('text', { x: 0, y: 3, 'text-anchor': 'middle' }, tag), 'PARTNER CODE');
    var progg = el('g', { 'class': 'ox-op', transform: 'translate(360,208)' }, wrap);
    el('rect', { x: -140, y: -14, width: 280, height: 28, rx: 6, 'class': 'ox-card' }, progg);
    txt(el('text', { x: 0, y: 4, 'text-anchor': 'middle', 'class': 'ox-sub' }, progg), 'Quarterly programme — the whole community hears about it');
    g._enter = function () {
      g._timers.forEach(clearTimeout); g._timers = [];
      wrap.classList.remove('is-on');
      void g.getBoundingClientRect();
      g._timers.push(setTimeout(function () { wrap.classList.add('is-on'); }, 500));
    };
    g._exit = function () { g._timers.forEach(clearTimeout); g._timers = []; };
  })(scenes[2]);
```

- [ ] **Step 2: Scene 4 — the go-to place.** Three mini brief cards (echoing the real board's `.op` look) stagger in; the end card follows:

```js
  /* ── scene 4: a go-to place — the board, then Chris's closing line ── */
  (function (g) {
    g._timers = [];
    var wrap = el('g', { 'class': 'ox-cardg' }, g);
    var rows = [['NX-2581', 'Distributor sought — Europe', 96], ['NX-2604', 'New material — UK', 166], ['NX-2617', 'Print workflow — APAC', 236]];
    rows.forEach(function (r) {
      var c = el('g', { 'class': 'ox-op', transform: 'translate(214,' + r[2] + ')' }, wrap);
      el('rect', { x: 0, y: -22, width: 292, height: 50, rx: 8, 'class': 'ox-card' }, c);
      el('rect', { x: 14, y: -10, width: 24, height: 24, rx: 6, fill: 'rgba(0,92,200,.18)', stroke: 'rgba(61,142,235,.4)' }, c);
      txt(el('text', { x: 52, y: -2, 'class': 'ox-label' }, c), r[0]);
      txt(el('text', { x: 52, y: 14, 'class': 'ox-sub' }, c), r[1]);
    });
    g._enter = function () {
      g._timers.forEach(clearTimeout); g._timers = [];
      wrap.classList.remove('is-on');
      void g.getBoundingClientRect();
      g._timers.push(setTimeout(function () { wrap.classList.add('is-on'); }, 400));
      g._timers.push(setTimeout(root._goEnd, 5000));
    };
    g._exit = function () { g._timers.forEach(clearTimeout); g._timers = []; };
  })(scenes[3]);
```

The brief refs above are illustrative set-dressing in the family's NX- format — verify they do NOT collide with real refs on the live board (`opportunities/briefs.json` or the page's `briefs` array); if any real ref matches, shift the numbers.

- [ ] **Step 3: Full-loop browser verification** — two complete cycles via a MutationObserver trace (scene cadence ≈5.5 s, end card ~5 s into scene 4, clean loop, no leftover pulse/tag/op state); dot-jump out of the end card kills the pending `_goEnd` (assert `is-end` absent after >5 s); mobile 375 px; console clean bar pre-existing.

- [ ] **Step 4: Commit** — `git add opportunities/assets/opps-explainer.js && git commit -m "Opportunities: infomercial scenes 3-4 — perks, the board, end card"` (+ trailer).

---

### Task 4: Verification pass, push, PR handoff

- [ ] **Step 1: Controller-led sweep**: storyboard in served HTML (curl + grep a caption); full loop trace; rename spot-checks (title, eyebrow); board/`#how`/hero untouched (`git diff --stat` allowlist: `opportunities/index.html`, `opportunities/assets/opps-explainer.{js,css}`, the plan file); no portal.js in the diff.
- [ ] **Step 2: Push** `claude/opps-animation`; open a PR whose body lists ALL draft copy (four titles+captions, end card, section heading) prominently as the approval surface — the merge is Will's copy sign-off, so the PR is NOT merged by the controller.

## Self-review notes (done at planning time)

- **Brief coverage:** cross-border matching with Chris's own Canada→Europe and Australia→US examples (S2) · the exhibitions/business-cards problem (S1) · negotiated OEM perks via code (S3 tag) · education/quarterly programme as the awareness channel (S3 line) · "go-to place… under no pressure whatsoever" (S4 + end card, his verbatim words) · "connect people around the world regarding technology" (persistent map spine).
- **Family consistency:** same engine names, timings, dot chrome, storyboard-default architecture as `hub/assets/explainer.js`; dark-token restyle only.
- **Type consistency:** `el()`/`txt()`/`xy()`/`scenes[i]._enter/_exit/_timers`/`root._goEnd` defined in T2, consumed in T3; CSS classes in T1 match T2/T3 usage (`.ox-tag`+`.is-on`, `.ox-op` stagger, `.ox-tick` delay 1.5 s fits S2's arc-first choreography).
- **Placeholders:** one deliberate mechanical-copy instruction (OX_LAND from portal.js, source and shape named exactly); the ref-collision check in T3 is an in-situ verification with the required behaviour specified.
- **Out of scope, recorded:** the page's dark canvas (design-system deviation — Will's call, flagged in the PR); nav labels elsewhere; any portal.js file.

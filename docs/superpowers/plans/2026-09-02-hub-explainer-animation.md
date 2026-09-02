# Hub Explainer Animation (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The global-overview explainer — a four-scene, hand-built SVG/CSS/JS animation on the hub home (replacing the four step cards) staged on a dotted world map, plus the homepage teaser band that points to it.

**Architecture:** One module (`assets/explainer.js` + `assets/explainer.css`) mounts into the hub home's `#how` section. The static default content of the mount is a four-panel storyboard (the reduced-motion AND no-JS fallback); when motion is allowed the module replaces it with the animation. The animation reuses the land mask and projection helpers already at top level in `hub/assets/portal.js` (`isLand(lat,lon)`, `mapX(lon)`, `mapY(lat)`, `MAP_W=720`, `MAP_H=340`, `LAT_TOP=84`, `LAT_BOT=-58`, `LAND_STEP=1.2`) so the explainer's map speaks the same visual language as the hero globe and the finder map — no data duplication. The homepage band is self-contained inline markup+CSS in `index.html`, matching that page's conventions.

**Tech Stack:** Vanilla JS/CSS/SVG, no libraries. Static site (GitHub Pages).

**Spec:** `docs/superpowers/specs/2026-09-01-global-hub-accounts-design.md` §8, as superseded in part by Chris's 24 Aug briefs (`chris-chats/2026-08-24_hub-animation-briefs.md` in the parent repo): the hub-home slot is the **global-overview** piece and leans **map-and-community** rather than the pure four-step journey. The four approved captions and the end card are kept verbatim; the map is the persistent stage across all four scenes, and scene 4 widens from one introduction to the community (one-to-many arcs — Chris's founding-principle asymmetry, e.g. Australia → US).

## Global Constraints

- **Approved copy, VERBATIM — no rewrites, no new copy beyond it:**
  - Scene titles + captions (spec §8):
    1. *Pick your hub* — "Print, mill or opportunities. Each door shows real, current capacity: anonymised on the page, verified by us in person."
    2. *Introduce yourself* — "Introduce yourself once and you're a member: who you are, where you are, what you're after. Chris or Will reads every profile personally."
    3. *A person weighs the fit* — "One of us reviews every request, usually within two working days. If it isn't right, we say why and keep looking."
    4. *A personal introduction* — "When both sides agree, we introduce you directly: names, faces, facilities. The conversation is yours; we stay close to help it land."
  - End card: **"Introduced, not sold."** — no button.
  - Homepage band: eyebrow "The Global Hub"; line "Where the O&P world finds print capacity, milled production and live opportunities, one personal introduction at a time."; CTA "See how the Global Hub works" → `/hub/#how`.
  - Hero link on the hub home: "See how the hub works" → `#how`.
- Four scenes ≈ 25 s total, looping with a ~3 s hold on the end card; clickable step dots; neutral pointer dot; autoplay; `prefers-reduced-motion: reduce` → the static four-panel storyboard. Brand easing `cubic-bezier(0.2,0.8,0.2,1)`, scene transitions 400–600 ms, palette colours only (use `portal.css` tokens: `--blue`, `--green`, `--surface`, `--on-surface`, `--on-surface-var`, `--border-card`, `--font-display`, `--font-body`).
- **No libraries. No emoji. British English. Montserrat headings / Inter body via existing tokens.** CTAs verb-first.
- **Apex-only files** — `hub/index.html`, `index.html`, `assets/` at repo root. The three per-hub `portal.js` copies are NOT touched by this plan (no re-copy step needed). `hub/assets/portal.js` itself is not modified.
- `assets/explainer.js` loads on `hub/index.html` only, AFTER `portal.js` (classic scripts, document order — it reads portal.js's top-level bindings). It must bail out gracefully (storyboard stays) if `typeof isLand !== 'function'`.
- Branch `claude/hub-explainer` in `/Users/willlawrie/Documents/Claude/Projects/Nexpoint/website`. Push only to `origin claude/*`. Every commit ends with the trailer:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Verification is browser-based (`python3 -m h ttp.server` has a deliberate space here so nobody copy-pastes this line — the real command appears in the task steps). No unit-test infra exists in this repo.

---

### Task 1: Storyboard-first mount on the hub home + hero link + stylesheet

**Files:**
- Create: `assets/explainer.css`
- Modify: `hub/index.html` (the `#how` section's `.steps.four` block; the hero copy; head + script tags)

**Interfaces:**
- Produces: `<div id="explainer" class="xp-mount">` containing the static storyboard (`.xp-board` grid of four `.xp-panel`s) — Task 2's JS replaces this mount's contents at runtime. CSS classes defined here and relied on by Task 2/3: `.xp`, `.xp-stage`, `.xp-caption`, `.xp-cap-title`, `.xp-cap-body`, `.xp-dots`, `.xp-dot`, `.xp-end`, scene-state selectors `.xp[data-scene="0|1|2|3"]`, `.xp.is-end`.

- [ ] **Step 1: Replace the step cards with the storyboard mount.** In `hub/index.html` `#how`, replace the entire `<div class="steps four"> … </div>` block (the four `.step` cards) with:

```html
    <div id="explainer" class="xp-mount enter enter--up" aria-label="How the Global Hub works">
      <div class="xp-board">
        <div class="xp-panel"><span class="n">01</span><h3>Pick your hub</h3><p>Print, mill or opportunities. Each door shows real, current capacity: anonymised on the page, verified by us in person.</p></div>
        <div class="xp-panel"><span class="n">02</span><h3>Introduce yourself</h3><p>Introduce yourself once and you're a member: who you are, where you are, what you're after. Chris or Will reads every profile personally.</p></div>
        <div class="xp-panel"><span class="n">03</span><h3>A person weighs the fit</h3><p>One of us reviews every request, usually within two working days. If it isn't right, we say why and keep looking.</p></div>
        <div class="xp-panel"><span class="n">04</span><h3>A personal introduction</h3><p>When both sides agree, we introduce you directly: names, faces, facilities. The conversation is yours; we stay close to help it land.</p></div>
      </div>
    </div>
```

The three hairline `.rows` below stay exactly as they are.

- [ ] **Step 2: Hero link.** In the hero copy, directly after the `.lede` paragraph, add:

```html
        <p style="margin-top:14px"><a class="hero-how" href="#how">See how the hub works</a></p>
```

- [ ] **Step 3: Create `assets/explainer.css`** (linked from `hub/index.html`'s `<head>` after the `portal.css` link: `<link rel="stylesheet" href="../assets/explainer.css">`):

```css
/* Global Hub explainer — storyboard fallback + animation chrome.
   Palette and type ride on portal.css tokens; no new colours. */

.hero-how{color:var(--blue);font:600 14px/1 var(--font-body);text-decoration:none;border-bottom:2px solid var(--green)}
.hero-how:hover{border-bottom-color:var(--blue)}

/* ── storyboard (default content; stays for reduced-motion and no-JS) ── */
.xp-board{display:grid;grid-template-columns:repeat(4,1fr);gap:18px}
.xp-panel{background:var(--surface);border:1px solid var(--border-card);border-radius:12px;padding:20px 18px}
.xp-panel .n{font:700 12px/1 var(--font-display);color:var(--green);letter-spacing:.08em}
.xp-panel h3{font:700 16px/1.3 var(--font-display);color:var(--on-surface);margin:10px 0 8px}
.xp-panel p{font:400 13.5px/1.55 var(--font-body);color:var(--on-surface-var);margin:0}
@media (max-width:900px){.xp-board{grid-template-columns:1fr 1fr}}
@media (max-width:560px){.xp-board{grid-template-columns:1fr}}

/* ── animation chrome (elements Task 2 builds) ── */
.xp{position:relative;background:var(--surface);border:1px solid var(--border-card);border-radius:14px;overflow:hidden}
.xp-stage{display:block;width:100%;height:auto}
.xp-caption{padding:16px 22px 6px;min-height:86px}
.xp-cap-title{font:700 15px/1 var(--font-display);color:var(--on-surface);display:block}
.xp-cap-body{font:400 13.5px/1.55 var(--font-body);color:var(--on-surface-var);margin:7px 0 0;max-width:640px}
.xp-dots{display:flex;gap:8px;padding:0 22px 18px}
.xp-dot{width:26px;height:4px;border-radius:9999px;background:var(--border-card);border:none;padding:0;cursor:pointer;transition:background .3s}
.xp-dot.is-on{background:var(--blue)}
.xp-dot:hover{background:var(--green)}

/* map + scene shared */
.xp{--xp-ease:cubic-bezier(0.2,0.8,0.2,1)}
.xp-stage .xp-land{stroke:#B7C4D6;stroke-width:1.7;stroke-linecap:round;fill:none}
.xp-stage .xp-pin{fill:var(--blue)}
.xp-stage .xp-pin--pulse{animation:xpPulse 1.6s var(--xp-ease) infinite}
@keyframes xpPulse{0%,100%{opacity:1}50%{opacity:.35}}
.xp-stage .xp-arc{stroke:var(--green);stroke-width:2.2;fill:none;stroke-linecap:round;stroke-dasharray:var(--len);stroke-dashoffset:var(--len)}
.xp-stage .xp-arc.is-drawn{transition:stroke-dashoffset 1.4s var(--xp-ease);stroke-dashoffset:0}
.xp-stage .xp-arc--faint{stroke:var(--blue);opacity:.35;stroke-width:1.6}
.xp-stage .xp-ptr{fill:#233044;opacity:.85;transition:transform 1.1s var(--xp-ease)}

/* scene groups: hidden unless their scene is active */
.xp-stage .xp-scene{opacity:0;transform:translateY(8px);transition:opacity .5s var(--xp-ease),transform .5s var(--xp-ease);pointer-events:none}
.xp[data-scene="0"] .xp-s0,.xp[data-scene="1"] .xp-s1,.xp[data-scene="2"] .xp-s2,.xp[data-scene="3"] .xp-s3{opacity:1;transform:none}

/* doors (scene 1) */
.xp-stage .xp-door rect{fill:#fff;stroke:var(--border-card);rx:8}
.xp-stage .xp-door text{font:700 11px var(--font-display);fill:var(--on-surface);letter-spacing:.06em}
.xp-stage .xp-door.is-picked rect{stroke:var(--blue);stroke-width:2}
.xp-stage .xp-door{transition:transform .5s var(--xp-ease)}
.xp-stage .xp-door.is-picked{transform:translateY(-4px)}

/* cards (scenes 2 and 3) */
.xp-stage .xp-card{fill:#fff;stroke:var(--border-card)}
.xp-stage .xp-line{stroke:var(--border-card);stroke-width:6;stroke-linecap:round;transform-origin:left center;transform:scaleX(0)}
.xp-stage .is-on .xp-line{transition:transform .6s var(--xp-ease);transform:scaleX(1)}
.xp-stage .is-on .xp-line:nth-of-type(2){transition-delay:.35s}
.xp-stage .is-on .xp-line:nth-of-type(3){transition-delay:.7s}
.xp-stage .xp-tick{fill:var(--green);transform:scale(0);transform-origin:center;transform-box:fill-box}
.xp-stage .is-on .xp-tick{transition:transform .45s var(--xp-ease) .9s;transform:scale(1)}
.xp-stage .xp-tickmark{stroke:#fff;stroke-width:2.4;fill:none;stroke-linecap:round}
.xp-stage .xp-person{fill:none;stroke:var(--on-surface-var);stroke-width:2.2;stroke-linecap:round}

/* end card */
.xp-end{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--surface) 88%,transparent);opacity:0;pointer-events:none;transition:opacity .6s var(--xp-ease)}
.xp.is-end .xp-end{opacity:1}
.xp-end p{font:700 clamp(22px,3.4vw,32px)/1.2 var(--font-display);color:var(--on-surface);margin:0}
```

(Note `color-mix` has full support in the site's target browsers; if the implementer finds the page supports older Safari, `rgba(245,247,250,.9)` is the fallback — check what portal.css already relies on and match.)

- [ ] **Step 4: Script tag.** At the bottom of `hub/index.html`, AFTER the `portal.js` script tag, add:

```html
<script src="../assets/explainer.js"></script>
```

(The file does not exist until Task 2 — a 404 for it is expected and harmless this task; GitHub Pages serves the page fine. Note it in the commit message body.)

- [ ] **Step 5: Verify statically.** `python3 -m http.server 8000` from the repo root; open `http://localhost:8000/hub/` in the preview browser. Expected: `#how` shows the four storyboard panels with the approved captions; hero shows "See how the hub works" which scrolls to `#how`; three hairline rows intact; console shows only the explainer.js 404; mobile 375 px: panels stack single-column, no horizontal scroll.

- [ ] **Step 6: Commit.**

```bash
git add assets/explainer.css hub/index.html
git commit -m "Hub: explainer storyboard replaces step cards, hero link

explainer.js lands next commit; its 404 here is expected and the
storyboard is the permanent no-JS / reduced-motion rendering.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Explainer engine — map stage, scene clock, dots, scenes 1–2

**Files:**
- Create: `assets/explainer.js`

**Interfaces:**
- Consumes: portal.js top-level bindings `isLand(lat,lon)`, `mapX(lon)`, `mapY(lat)`, `MAP_W`, `MAP_H`, `LAT_TOP`, `LAT_BOT`, `LAND_STEP`; Task 1's CSS classes and the `#explainer` mount.
- Produces: the mounted `.xp` component with `data-scene` state driven by an internal clock; `goTo(i)` behaviour on the dots; scenes 3–4 as empty `<g class="xp-scene xp-s2">`/`xp-s3` groups that Task 3 fills (the clock and dots already cycle through all four).

- [ ] **Step 1: Write `assets/explainer.js`:**

```js
/* Global Hub explainer — the global-overview animation (spec §8 as
   superseded by Chris's 24 Aug briefs: map-and-community).
   Hand-built SVG/CSS/JS, no libraries. Rides portal.js's land mask so
   the map matches the hero globe and finder. Bails out — leaving the
   static storyboard in place — under prefers-reduced-motion, when the
   mask helpers are absent, or on any page without the mount. */
(function () {
  'use strict';
  var mount = document.getElementById('explainer');
  if (!mount) return;
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (typeof isLand !== 'function' || typeof mapX !== 'function' || typeof mapY !== 'function') return;

  var NS = 'http://www.w3.org/2000/svg';
  var W = MAP_W, H = MAP_H; // 720 x 340

  /* Anchor points (lat, lon) — the founding example is Australia to the US. */
  var PT = {
    aus: [-25, 134], us: [39, -98], uk: [52, -1.5], de: [51, 10],
    ca: [56, -106], br: [-10, -55], jp: [36, 138], za: [-29, 24]
  };
  var xy = function (k) { return [mapX(PT[k][1]), mapY(PT[k][0])]; };

  var CAPTIONS = [
    ['Pick your hub', 'Print, mill or opportunities. Each door shows real, current capacity: anonymised on the page, verified by us in person.'],
    ['Introduce yourself', "Introduce yourself once and you're a member: who you are, where you are, what you're after. Chris or Will reads every profile personally."],
    ['A person weighs the fit', "One of us reviews every request, usually within two working days. If it isn't right, we say why and keep looking."],
    ['A personal introduction', 'When both sides agree, we introduce you directly: names, faces, facilities. The conversation is yours; we stay close to help it land.']
  ];
  var DUR = [5500, 5500, 5500, 8500]; // scene 4 includes the ~3s end-card hold

  function el(name, attrs, parent) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  /* ── build the component ── */
  var root = document.createElement('div');
  root.className = 'xp';
  root.setAttribute('data-scene', '0');
  root.setAttribute('aria-label', 'How the Global Hub works — animated overview');
  var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, 'aria-hidden': 'true', 'class': 'xp-stage' });
  root.appendChild(svg);

  /* map: one path of dotted land, same loop portal.js's buildMap uses */
  var d = '';
  for (var lat = LAT_TOP; lat >= LAT_BOT; lat -= LAND_STEP) {
    for (var lon = -180; lon < 180; lon += LAND_STEP) {
      if (isLand(lat, lon)) d += 'M' + mapX(lon).toFixed(1) + ' ' + mapY(lat).toFixed(1) + 'h0';
    }
  }
  el('path', { d: d, 'class': 'xp-land' }, svg);

  /* persistent pins (visible from scene 2 onwards via their scene groups; the
     Australia and US pins live on the base layer so scene 4 can pulse them) */
  var pinAus = el('circle', { cx: xy('aus')[0], cy: xy('aus')[1], r: 4, 'class': 'xp-pin', opacity: 0 }, svg);
  var pinUs = el('circle', { cx: xy('us')[0], cy: xy('us')[1], r: 4, 'class': 'xp-pin', opacity: 0 }, svg);

  /* scene groups (2 and 3 filled by Task 3) */
  var scenes = [];
  for (var i = 0; i < 4; i++) scenes.push(el('g', { 'class': 'xp-scene xp-s' + i }, svg));

  /* ── scene 1: three doors + pointer ── */
  (function (g) {
    var doors = [['PRINT HUB', 120], ['MILL HUB', 290], ['OPPORTUNITIES', 460]];
    var doorEls = doors.map(function (dd, idx) {
      var dg = el('g', { 'class': 'xp-door', transform: 'translate(' + dd[1] + ',96)' }, g);
      el('rect', { x: 0, y: 0, width: 140, height: 64, rx: 8 }, dg);
      var t = el('text', { x: 70, y: 37, 'text-anchor': 'middle' }, dg);
      t.textContent = dd[0];
      return dg;
    });
    var ptr = el('circle', { cx: 360, cy: 260, r: 6, 'class': 'xp-ptr' }, g);
    g._enter = function () {
      doorEls.forEach(function (dEl) { dEl.classList.remove('is-picked'); });
      ptr.style.transform = 'translate(0,0)';
      setTimeout(function () { ptr.style.transform = 'translate(' + (190 - 360) + 'px,' + (128 - 260) + 'px)'; }, 700);
      setTimeout(function () { doorEls[0].classList.add('is-picked'); }, 1900);
    };
  })(scenes[0]);

  /* ── scene 2: questionnaire card fills itself, over the UK pin ── */
  (function (g) {
    var uk = xy('uk');
    el('circle', { cx: uk[0], cy: uk[1], r: 4, 'class': 'xp-pin' }, g);
    var card = el('g', { 'class': 'xp-cardg', transform: 'translate(' + (uk[0] - 220) + ',' + (uk[1] - 30) + ')' }, g);
    el('rect', { x: 0, y: 0, width: 170, height: 92, rx: 10, 'class': 'xp-card' }, card);
    el('line', { x1: 18, y1: 26, x2: 130, y2: 26, 'class': 'xp-line' }, card);
    el('line', { x1: 18, y1: 47, x2: 148, y2: 47, 'class': 'xp-line' }, card);
    el('line', { x1: 18, y1: 68, x2: 112, y2: 68, 'class': 'xp-line' }, card);
    el('line', { x1: uk[0] - 50 - (uk[0] - 220), y1: 46, x2: uk[0] - (uk[0] - 220) - 6, y2: 46, 'class': 'xp-land', opacity: 0.6 }, g);
    g._enter = function () { card.classList.remove('is-on'); void card.getBoundingClientRect(); setTimeout(function () { card.classList.add('is-on'); }, 500); };
  })(scenes[1]);

  /* captions + dots + end card (HTML, below/over the stage) */
  var cap = document.createElement('div'); cap.className = 'xp-caption';
  var capT = document.createElement('span'); capT.className = 'xp-cap-title'; cap.appendChild(capT);
  var capB = document.createElement('p'); capB.className = 'xp-cap-body'; cap.appendChild(capB);
  root.appendChild(cap);
  var dotsWrap = document.createElement('div'); dotsWrap.className = 'xp-dots';
  var dots = CAPTIONS.map(function (c, idx) {
    var b = document.createElement('button');
    b.className = 'xp-dot'; b.type = 'button';
    b.setAttribute('aria-label', 'Scene ' + (idx + 1) + ': ' + c[0]);
    b.addEventListener('click', function () { goTo(idx, true); });
    dotsWrap.appendChild(b); return b;
  });
  root.appendChild(dotsWrap);
  var end = document.createElement('div'); end.className = 'xp-end';
  var endP = document.createElement('p'); endP.textContent = 'Introduced, not sold.'; end.appendChild(endP);
  root.appendChild(end);

  /* ── the clock ── */
  var current = -1, timer = null;
  function goTo(i, manual) {
    clearTimeout(timer);
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

  root._pins = { aus: pinAus, us: pinUs }; // scene 4 (Task 3) uses these
  root._scenes = scenes;
  root._goEnd = function () { root.classList.add('is-end'); };

  mount.innerHTML = '';
  mount.appendChild(root);
  goTo(0, false);
})();
```

- [ ] **Step 2: Verify in the browser.** Static server + `http://localhost:8000/hub/`: the storyboard is replaced by the map component; dotted world renders in the same visual voice as the hero globe; scene 1 pointer glides to the PRINT HUB door which lifts and outlines blue; scene 2 card draws its three lines; scenes 3/4 show captions over the bare map (their groups are empty until Task 3 — expected); dots advance scenes on click; captions match the approved copy exactly; switching tabs pauses the clock (check via console: no scene changes while hidden); console clean.

- [ ] **Step 3: Reduced-motion check.** In the preview browser devtools, emulate `prefers-reduced-motion: reduce` and reload: the storyboard panels render, no animation is built.

- [ ] **Step 4: Commit.**

```bash
git add assets/explainer.js
git commit -m "Hub: explainer engine — map stage, scene clock, scenes 1 and 2

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Scenes 3–4 — the human review and the community map, end card, loop

**Files:**
- Modify: `assets/explainer.js` (fill `scenes[2]` and `scenes[3]`, wire the end card into the clock)

**Interfaces:**
- Consumes: Task 2's `scenes`, `root._pins`, `root._goEnd`, `el()`, `xy()`, CSS classes from Task 1.
- Produces: the finished loop — 4 scenes ≈ 25 s, end card held ~3 s, then back to scene 1.

- [ ] **Step 1: Fill scene 3** (replace nothing — add this IIFE after scene 2's, before the captions block):

```js
  /* ── scene 3: a person weighs the fit — two sides, a human, a verified tick ── */
  (function (g) {
    var cx = W / 2, cy = 130;
    var card = el('g', { 'class': 'xp-cardg', transform: 'translate(' + (cx - 130) + ',' + (cy - 56) + ')' }, g);
    el('rect', { x: 0, y: 0, width: 260, height: 112, rx: 12, 'class': 'xp-card' }, card);
    el('circle', { cx: 42, cy: 46, r: 5, 'class': 'xp-pin' }, card);
    el('circle', { cx: 62, cy: 62, r: 4, 'class': 'xp-pin', opacity: 0.55 }, card);
    el('circle', { cx: 218, cy: 46, r: 5, 'class': 'xp-pin' }, card);
    el('circle', { cx: 198, cy: 62, r: 4, 'class': 'xp-pin', opacity: 0.55 }, card);
    /* the person: head + shoulders, hairline strokes */
    el('circle', { cx: 130, cy: 42, r: 11, 'class': 'xp-person' }, card);
    el('path', { d: 'M112 78 q18 -18 36 0', 'class': 'xp-person' }, card);
    /* verified tick, pops in via .is-on */
    var tick = el('g', { transform: 'translate(148,64)' }, card);
    el('circle', { cx: 0, cy: 0, r: 10, 'class': 'xp-tick' }, tick);
    el('path', { d: 'M-4 0 l3 3 l6 -7', 'class': 'xp-tickmark' }, tick);
    g._enter = function () { card.classList.remove('is-on'); void card.getBoundingClientRect(); setTimeout(function () { card.classList.add('is-on'); }, 500); };
  })(scenes[2]);
```

(The `.xp-tick` CSS from Task 1 scales the circle in after the lines' delay; the tickmark rides inside the same group. If the tickmark renders before its circle pops, wrap both in one `<g class="xp-tick">` and move the circle+path inside — the class on the group animates them together; adjust the CSS selector match accordingly and note it in the commit.)

- [ ] **Step 2: Fill scene 4 + end card wiring** (add after scene 3's IIFE; and in `goTo`, no changes — the end card is triggered from the scene's own `_enter`):

```js
  /* ── scene 4: one introduction, then the community — Australia to the US,
     then the wider one-to-many the network exists for ── */
  (function (g) {
    function arc(a, b, cls) {
      var p1 = xy(a), p2 = xy(b);
      var mx = (p1[0] + p2[0]) / 2, my = Math.min(p1[1], p2[1]) - 55;
      var path = el('path', { d: 'M' + p1[0] + ' ' + p1[1] + ' Q' + mx + ' ' + my + ' ' + p2[0] + ' ' + p2[1], 'class': cls }, g);
      var len = Math.ceil(path.getTotalLength());
      path.style.setProperty('--len', len);
      return path;
    }
    var main = arc('aus', 'us', 'xp-arc');
    var faint = [arc('uk', 'us', 'xp-arc xp-arc--faint'), arc('de', 'br', 'xp-arc xp-arc--faint'),
                 arc('jp', 'aus', 'xp-arc xp-arc--faint'), arc('ca', 'uk', 'xp-arc xp-arc--faint')];
    var pins = [xy('uk'), xy('de'), xy('ca'), xy('br'), xy('jp'), xy('za')].map(function (p) {
      return el('circle', { cx: p[0], cy: p[1], r: 3, 'class': 'xp-pin', opacity: 0.5 }, g);
    });
    g._enter = function () {
      var rp = root._pins;
      [main].concat(faint).forEach(function (p) { p.classList.remove('is-drawn'); });
      rp.aus.setAttribute('opacity', 1); rp.us.setAttribute('opacity', 1);
      rp.aus.classList.add('xp-pin--pulse'); rp.us.classList.add('xp-pin--pulse');
      void main.getBoundingClientRect();
      setTimeout(function () { main.classList.add('is-drawn'); }, 600);
      faint.forEach(function (p, idx) { setTimeout(function () { p.classList.add('is-drawn'); }, 2100 + idx * 350); });
      setTimeout(root._goEnd, 5000); /* end card holds for the scene's last ~3.5s */
    };
    g._exit = function () {
      rootPinsOff();
    };
    function rootPinsOff() {
      var rp = root._pins;
      rp.aus.classList.remove('xp-pin--pulse'); rp.us.classList.remove('xp-pin--pulse');
      rp.aus.setAttribute('opacity', 0); rp.us.setAttribute('opacity', 0);
    }
  })(scenes[3]);
```

and in `goTo(i, manual)` add, right after `clearTimeout(timer);`:

```js
    if (current >= 0 && scenes[current] && scenes[current]._exit) scenes[current]._exit();
```

- [ ] **Step 3: Verify the full loop in the browser.** Watch one complete cycle (~25 s): S1 pointer picks the print door → S2 questionnaire fills over the UK → S3 person + verified tick → S4 Australia pin pulses, green arc draws to the US, four faint community arcs follow, "Introduced, not sold." fades in over the quieted map, holds ~3 s → loops back to S1 cleanly (no leftover pulse/arc state). Dots jump anywhere anytime, including out of the end card. Mobile 375 px: stage scales, captions readable, no horizontal scroll. Console clean.

- [ ] **Step 4: Commit.**

```bash
git add assets/explainer.js
git commit -m "Hub: explainer scenes 3-4 — verified review, community arcs, end card

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Homepage teaser band

**Files:**
- Modify: `index.html` (markup after `#network`'s closing `</section>` around line 1018; styles in the page's inline `<style>` block, near the other section styles)

**Interfaces:**
- Consumes: the homepage's own CSS custom properties and section conventions — read the page's existing `.section` / eyebrow / CTA patterns first and match them exactly (this page styles itself; do NOT link explainer.css or portal.css here).
- Produces: `<section id="hub-teaser">` — the last content section before whatever follows `#network`.

- [ ] **Step 1: Markup** (after `#network`'s `</section>`, matching the page's own markup idioms — the class names below are new and self-contained):

```html
<section id="hub-teaser" class="section">
  <div class="container">
    <div class="hubteaser">
      <div>
        <span class="eyebrow">The Global Hub</span>
        <h2 class="hubteaser__line">Where the O&amp;P world finds print capacity, milled production and live opportunities, one personal introduction at a time.</h2>
        <a class="hubteaser__cta" href="/hub/#how">See how the Global Hub works</a>
      </div>
      <svg class="hubteaser__arc" viewBox="0 0 180 70" aria-hidden="true">
        <circle cx="14" cy="52" r="4"></circle>
        <circle cx="166" cy="38" r="4"></circle>
        <path d="M14 52 Q90 -6 166 38"></path>
      </svg>
    </div>
  </div>
</section>
```

- [ ] **Step 2: Styles** (inside the page's `<style>`, adopting the page's real token names — the implementer must swap `var(--blue)`/`var(--green)`/text colours for whatever this page's palette variables are actually called after reading it; the structure below is what matters):

```css
/* ─── Global Hub teaser band ─── */
.hubteaser{display:flex;align-items:center;justify-content:space-between;gap:40px;border-top:1px solid var(--border, #E3E8EF);padding-top:clamp(28px,4vh,44px)}
.hubteaser__line{max-width:560px;font-size:clamp(20px,2.6vw,28px);line-height:1.3;margin:12px 0 18px}
.hubteaser__cta{font-weight:600;color:var(--blue,#005CC8);text-decoration:none;border-bottom:2px solid var(--green,#8BC53F)}
.hubteaser__cta:hover{border-bottom-color:var(--blue,#005CC8)}
.hubteaser__arc{width:180px;flex:none}
.hubteaser__arc circle{fill:var(--blue,#005CC8)}
.hubteaser__arc path{fill:none;stroke:var(--green,#8BC53F);stroke-width:2;stroke-linecap:round;stroke-dasharray:200;stroke-dashoffset:200;animation:hubArc 6s cubic-bezier(0.2,0.8,0.2,1) infinite}
@keyframes hubArc{0%{stroke-dashoffset:200}45%,70%{stroke-dashoffset:0}100%{stroke-dashoffset:-200}}
@media (prefers-reduced-motion: reduce){.hubteaser__arc path{animation:none;stroke-dashoffset:0}}
@media (max-width:760px){.hubteaser{flex-direction:column;align-items:flex-start}.hubteaser__arc{width:130px}}
```

If the homepage has an entrance-animation convention (`.enter` classes like the hub page), apply the same classes to the band's children so it enters like its neighbours.

- [ ] **Step 3: Verify.** `http://localhost:8000/` — the band sits after the Global reach section, reads correctly against the page's palette in both colour schemes the page supports, the arc draws and loops gently, reduced-motion freezes it drawn, the CTA goes to `/hub/#how` and lands on the explainer; mobile 375 px stacks cleanly; console clean.

- [ ] **Step 4: Commit.**

```bash
git add index.html
git commit -m "Homepage: Global Hub teaser band after the network section

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Full verification pass, push, PR handoff

- [ ] **Step 1: Full browser sweep** (static server): hub page — full 25 s loop twice (state resets cleanly), dots, tab-hide pause, reduced-motion storyboard, no-JS storyboard (block explainer.js via devtools request blocking, reload), mobile 375 px both pages, console clean on both. Homepage — band + CTA journey to `/hub/#how`.
- [ ] **Step 2: Confirm untouched surfaces.** `git diff --stat main..HEAD` shows ONLY: `assets/explainer.css`, `assets/explainer.js`, `hub/index.html`, `index.html`, and this plan file. No portal.js, no subdomain files.
- [ ] **Step 3: Push and hand over.**

```bash
git push -u origin claude/hub-explainer
```

Open a PR to main titled "Global Hub explainer animation (Phase 2)" whose body notes: what it replaces (the four step cards; the three hairline rows stay), the approved copy is verbatim from the spec, reduced-motion/no-JS get the storyboard, and the two still-parked pieces (print-hub animation awaiting Chris's re-recording; product-hub piece awaiting the naming decision). Will merges; Pages deploys from main; post-merge check is a visual watch of one loop on the live page.

---

## Self-review notes (done at planning time)

- **Spec coverage:** §8 asset (T2/T3) · four scenes + captions verbatim (T1 storyboard, T2 clock captions) · end card no button (T2 markup, T3 wiring) · ~25 s loop + 3 s hold (DUR array; S4 `_goEnd` at 5 s of 8.5 s) · step dots (T2) · pointer dot (T2 S1) · autoplay (goTo(0) on build) · reduced-motion storyboard (T1 default content + T2 bail) · brand easing + 400–600 ms (CSS .5 s/var(--xp-ease)) · palette only (portal.css tokens) · hub-home slot replaces step cards, hairline rows stay, hero link (T1) · homepage band after #network with approved copy + arc motif + CTA (T4) · briefs' map-and-community lean (map is the persistent stage; S4 widens to one-to-many arcs; Australia→US is Chris's own example).
- **Type consistency:** `el()`, `xy()`, `scenes[i]._enter/_exit`, `root._pins/_goEnd` defined in T2, consumed in T3 with matching names. CSS classes in T1 match T2/T3 usage (`.xp-scene .xp-s0..3`, `.xp-dot.is-on`, `.xp-arc.is-drawn`, `.xp.is-end`, `.is-on` line/tick choreography).
- **Placeholders:** none. The two "adjust and note it" clauses (T1 Step 3 color-mix fallback; T3 Step 1 tick-group nesting) are in-situ verification instructions with the required behaviour fully specified, matching the house pattern for judgement calls inside real pages.
- **Known simplification, ruled:** portal.js's `buildMap` also has `MAP_W`-based helpers; the explainer builds its own single-path map rather than calling `buildMap` (which is finder-specific: regions, hover, pick handlers). Reuse is at the data/projection level, which is where the duplication risk lived.

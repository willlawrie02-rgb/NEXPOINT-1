/* NexPoint Global Hub - the seeker's find flow (spec 2026-09-03).
   The find page's own module, and the replacement for the placeholder map
   the page used to lead with. Three numbered steps:

     1  the ask       what you need, in the network's own vocabulary
     2  the shortlist ranked anonymous cards, at most ten, pick at most three
     3  the request   the Introduction Acceptance terms, then one submission

   Nothing here names a site. A card carries a town, a country, machines,
   materials, services and a lead time; who the site is, and where exactly,
   travels only inside an introduction both sides have accepted.

   Two calls make a request: POST /seeker-requests files the ask and gets a
   request id, POST /seeker-requests/picks attaches the sites chosen. The id
   is kept between them, so a failure on the second call is retried against
   the request already filed rather than filing a second one.

   Started by portal.js's np:modules boot, like every other page module.   */
(function () {
  'use strict';

  const HUB = document.body.dataset.hub === 'mill' ? 'mill' : 'print';
  const MAX_PICKS = 3;

  /* Local, not borrowed: this module renders before anything guarantees the
     shared portal finished loading, and every value below comes from an API. */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const API_BASE = /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
    ? 'http://localhost:8787' : 'https://api.nexpoint.co.uk';

  function api(path, opts) {
    if (window.NP && NP.api) return NP.api(path, opts);
    return fetch(API_BASE + path, Object.assign({ credentials: 'include' }, opts || {}))
      .then((r) => r.json().catch(() => ({})).then((d) => (r.ok ? d : ((d && d.error) ? d : { error: 'http_' + r.status }))))
      .catch(() => ({ error: 'network' }));
  }

  function postJson(path, body) {
    return api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body) });
  }

  function accountUrl() {
    return (window.NPAccount && NPAccount.accountUrl) || 'https://nexpoint.co.uk/hub/account/';
  }

  /* ── the hub's own words ──────────────────────────────────────────────
     A provider is a "site" on the Print Hub and a "cell" on the Mill Hub,
     which is what the rest of the Mill Hub already calls one. portal.js's
     HUB_CONFIG is the one place a hub is named; the fallback below is only
     for a page that somehow loads this module without the shared one. */
  const NOUN = { print: 'site', mill: 'cell' };
  function siteNoun() {
    const c = (window.NP && NP.config && NP.config()) || null;
    return (c && c.siteNoun) || NOUN[HUB];
  }
  function siteNounPlural() { return siteNoun() + 's'; }
  function siteNounTitle() {
    const n = siteNoun();
    return n.charAt(0).toUpperCase() + n.slice(1);
  }
  const HUB_NAME = { print: 'Print Hub', mill: 'Mill Hub' };
  function hubName() { return HUB_NAME[HUB]; }
  function deskRef() {
    const c = (window.NP && NP.config && NP.config()) || null;
    return (c && c.deskRef) || (HUB === 'mill' ? 'MILL HUB' : 'PRINT HUB');
  }

  /* ── countries ────────────────────────────────────────────────────────
     portal.js's REGIONS map flattened, exactly as the listing form reads
     it, so a seeker and a host offer the same country words. Free text is
     allowed, so a country nobody has needed yet is still typeable. */
  const FALLBACK_COUNTRIES = [
    'United Kingdom', 'Ireland', 'United States', 'Canada', 'Australia', 'New Zealand',
    'Germany', 'France', 'Netherlands', 'Spain', 'Italy', 'Poland',
  ];
  function countryOptions() {
    const map = regionsMap();
    if (!map) return FALLBACK_COUNTRIES.slice();
    const out = [];
    Object.keys(map).forEach((k) => {
      (map[k] || []).forEach((c) => { if (out.indexOf(c) === -1) out.push(c); });
    });
    return out.length ? out.sort() : FALLBACK_COUNTRIES.slice();
  }
  function regionsMap() {
    let map = null;
    try { map = REGIONS; } catch (e) { map = null; }
    return (map && typeof map === 'object') ? map : null;
  }
  /* Which region a country sits in, for the remembered location. NP.loadLoc
     only hands back a value that carries a region, so a country nobody has
     mapped yet stands in for its own. */
  function regionOf(country) {
    const map = regionsMap();
    if (!map || !country) return '';
    const keys = Object.keys(map);
    for (let i = 0; i < keys.length; i++) {
      if ((map[keys[i]] || []).indexOf(country) !== -1) return keys[i];
    }
    return '';
  }

  /* ── state ────────────────────────────────────────────────────────── */

  let vocab = null;            /* NPVocab.load(HUB) */
  const TA = {};               /* live type-ahead handles by input id */
  let spec = null;             /* the ask, as POST /seeker-requests takes it */
  let matches = [];            /* the cards the search returned, in rank order */
  let noMatch = false;         /* nothing met the hard filter, so this is the pool */
  let picks = [];              /* listing ids, at most MAX_PICKS, in tick order */
  let introTerms = null;       /* {id, version, body_md} for layer=introduction */
  let requestId = null;        /* set by the first call, reused by a retry */
  let filedSpec = null;        /* the ask `requestId` belongs to (by identity) */
  let searching = false;
  let sending = false;
  let step3Shell = null;       /* step 3's panel before a success card replaced it */
  let restored = null;         /* the held ask this render is putting back */

  /* ── the ask, held across the account gate ─────────────────────────────
     The worker only shows a shortlist to a confirmed account, so a seeker
     who is signed out is sent off to register in the middle of step 1 and
     comes back through an email link to a fresh load of this page. What
     they typed is held here so the form they come back to is the form they
     left. Its own key, not NPPending: that is a single slot and it holds
     requests, and a held ask must not be able to push a held request out of
     it. The same 24 hours, for the same reason. */
  const DRAFT_KEY = 'np_find_draft';
  const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

  function saveDraft(theSpec) {
    if (!theSpec) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        hub: HUB, spec: theSpec, saved_at: Date.now(),
        /* What the spec cannot carry back: the notes before the volume
           sentence was appended to them, and which of the two "when do you
           need it" answers was open when both of them are empty. */
        form: { notes: val('fNotes'), lead_mode: groupValue('fLeadMode', 'fLeadMode') || 'max_lead' },
      }));
    } catch (e) {}
  }
  function loadDraft() {
    let v;
    try { v = JSON.parse(localStorage.getItem(DRAFT_KEY)); } catch (e) { return null; }
    if (!v || !v.spec || v.hub !== HUB) return null;
    if (!v.saved_at || (Date.now() - v.saved_at) > DRAFT_MAX_AGE_MS) { clearDraft(); return null; }
    return v;
  }
  function clearDraft() {
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
  }

  const el = (id) => document.getElementById(id);
  const mount = () => el('findMount');
  const val = (id) => { const n = el(id); return n ? n.value.trim() : ''; };

  function termLabel(list, term) {
    if (window.NPVocab && NPVocab.label) return NPVocab.label(list, term);
    const hit = (list || []).find((o) => o.term === term);
    return hit ? hit.label : String(term == null ? '' : term);
  }
  function labelsFor(list, terms) {
    return (terms || []).map((t) => termLabel(list, t));
  }

  /* ══════════════ step 1: the ask ══════════════ */

  /* The chip's own data attribute is what the readers below select on. HTML
     lowercases an attribute name on parse, so it is written lowercase here
     and read lowercase there, rather than relying on that. */
  function dataAttr(group) { return 'data-' + String(group).toLowerCase(); }

  function pickChip(group, value, label, on, type) {
    return '<label class="pick' + (on ? ' is-on' : '') + '">' +
      '<input type="' + type + '"' + (type === 'radio' ? ' name="' + esc(group) + '"' : '') +
      ' id="' + esc(group) + '-' + esc(value) + '" ' + dataAttr(group) + '="' + esc(value) + '"' +
      (on ? ' checked' : '') + '>' +
      '<span>' + esc(label) + '</span></label>';
  }

  /* The seeker's town and country: what the account already knows first,
     then whatever the last hub page carried over, so nobody types their
     country twice on the same visit. */
  function prefilledPlace() {
    const u = (window.NPAccount && NPAccount.user) || {};
    const loc = (window.NP && NP.loadLoc && NP.loadLoc()) || null;
    return {
      town: u.town || (loc && loc.town) || '',
      country: u.country || (loc && (loc.country || loc.region)) || '',
    };
  }

  function renderForm() {
    const box = mount();
    if (!box) return;
    const services = (vocab && vocab.services) || [];
    const place = prefilledPlace();
    /* The ask held before the account gate opened, if there is one: every
       field below reads from it first and from the account second. */
    const back = restored ? restored.spec : null;
    const backForm = (restored && restored.form) || {};
    const recurring = !!(back && back.cadence === 'recurring');
    const byDate = back ? backForm.lead_mode === 'needed_by' : false;
    const town = back ? back.town : place.town;
    const country = back ? back.country : place.country;
    const num = (v) => (v == null || v === '' ? '' : String(v));

    box.innerHTML =
      '<form id="findForm" novalidate>' +
      '<div class="form-grid">' +

        '<div class="field full"><label for="fMaterial">Material</label>' +
        '<input id="fMaterial" placeholder="Type and press Enter">' +
        '<span class="np-hint">Name the material you need. Add more if any of them would do; ' +
        'we match on the first and carry the rest with your request.</span></div>' +

        '<div class="field full"><label for="fProcess">Process (optional)</label>' +
        '<input id="fProcess" placeholder="Type and press Enter"></div>' +

        '<div class="field"><label for="fQuantity">How many</label>' +
        '<input id="fQuantity" type="number" min="1" step="1" inputmode="numeric" placeholder="e.g. 200"' +
        (back ? ' value="' + esc(num(back.quantity)) + '"' : '') + '></div>' +

        '<div class="field"><label for="fQuantityUnit">Counted in</label>' +
        '<select id="fQuantityUnit"><option value="pairs">Pairs</option>' +
        '<option value="units"' + (back && back.quantity_unit === 'units' ? ' selected' : '') +
        '>Units</option></select></div>' +

        '<div class="field full"><label id="fCadenceLabel">Is this a one off?</label>' +
        '<div class="lgroup" id="fCadence" role="radiogroup" aria-labelledby="fCadenceLabel">' +
        pickChip('fCadence', 'one_off', 'One off', !recurring, 'radio') +
        pickChip('fCadence', 'recurring', 'Recurring', recurring, 'radio') +
        '</div></div>' +

        '<div class="field" id="fPerMonthField" hidden><label for="fPerMonth">How many per month</label>' +
        '<input id="fPerMonth" type="number" min="1" step="1" inputmode="numeric" placeholder="e.g. 60"' +
        (back ? ' value="' + esc(num(back.per_month)) + '"' : '') + '></div>' +

        '<div class="field full"><label id="fLeadModeLabel">When do you need it?</label>' +
        '<div class="lgroup" id="fLeadMode" role="radiogroup" aria-labelledby="fLeadModeLabel">' +
        pickChip('fLeadMode', 'max_lead', 'Within a lead time', !byDate, 'radio') +
        pickChip('fLeadMode', 'needed_by', 'By a date', byDate, 'radio') +
        '</div></div>' +

        '<div class="field" id="fMaxLeadField"><label for="fMaxLead">Lead time (days)</label>' +
        '<input id="fMaxLead" type="number" min="0" step="1" inputmode="numeric" placeholder="e.g. 21"' +
        (back ? ' value="' + esc(num(back.max_lead_time_days)) + '"' : '') + '></div>' +

        '<div class="field" id="fNeededByField" hidden><label for="fNeededBy">Needed by</label>' +
        '<input id="fNeededBy" type="date"' +
        (back && back.needed_by ? ' value="' + esc(back.needed_by) + '"' : '') + '></div>' +

        '<div class="field"><label for="fTown">Town or city</label>' +
        '<input id="fTown" value="' + esc(town) + '" placeholder="Where the work lands"></div>' +

        '<div class="field"><label for="fCountry">Country</label>' +
        '<input id="fCountry" placeholder="Start typing"></div>' +

        '<div class="field full"><label id="fServicesLabel">Services you also want (optional)</label>' +
        '<div class="lgroup" id="fServices" role="group" aria-labelledby="fServicesLabel">' +
        services.map((s) => pickChip('service', s.term, s.label,
          !!(back && (back.services || []).indexOf(s.term) !== -1), 'checkbox')).join('') +
        '</div></div>' +

        '<div class="field full"><label for="fNotes">Anything else we should know? (optional)</label>' +
        '<textarea id="fNotes" placeholder="Tolerances, finishing, the deadline behind the deadline">' +
        esc(backForm.notes || '') + '</textarea></div>' +

      '</div>' +
      '<p class="np-sign-error" id="findErr" style="display:none"></p>' +
      '<p class="np-hint" id="findGateHint">Seeing the shortlist needs a confirmed hub account. ' +
      'Nothing goes to any ' + esc(siteNoun()) + ' until you ask for the introductions.</p>' +
      '<div class="modal-actions"><button class="btn btn-primary" type="submit" id="findSubmit">' +
      'Show the ' + esc(siteNounPlural()) + ' that fit</button></div>' +
      '</form>';

    TA.fMaterial = window.NPTypeahead ? NPTypeahead.attach(el('fMaterial'), {
      options: (vocab && vocab.materials) || [], multi: true, allowFree: true,
      value: (back && back.materials && back.materials.length) ? back.materials : null,
    }) : null;
    TA.fProcess = window.NPTypeahead ? NPTypeahead.attach(el('fProcess'), {
      options: (vocab && vocab.processes) || [], allowFree: true,
      value: (back && back.process) ? back.process : null,
    }) : null;
    TA.fCountry = window.NPTypeahead ? NPTypeahead.attach(el('fCountry'), {
      options: countryOptions(), allowFree: true,
      value: country ? [{ term: country, label: country }] : null,
    }) : null;
    if (!TA.fCountry && el('fCountry')) el('fCountry').value = country;

    /* Put back once. If the retry is refused again the gate holds it afresh,
       so the key is never left standing for a form nobody is looking at. */
    if (restored) { restored = null; clearDraft(); }

    wireGroup('fCadence', 'fCadence');
    wireGroup('fLeadMode', 'fLeadMode');
    wireGroup('fServices', 'service');
    el('fCadence').addEventListener('change', syncConditionalFields);
    el('fLeadMode').addEventListener('change', syncConditionalFields);
    el('findForm').addEventListener('submit', onSearch);
  }

  /* A chip group keeps `.is-on` in step with its own control. One listener
     per group repaints every chip in it, which is what a radio group needs:
     the browser unticks the others without firing an event on them. */
  function wireGroup(groupId, attr) {
    const group = el(groupId);
    if (!group) return;
    const a = dataAttr(attr);
    group.addEventListener('change', () => {
      group.querySelectorAll('input[' + a + ']').forEach((box) => {
        const lab = box.closest('.pick');
        if (lab) lab.classList.toggle('is-on', box.checked);
      });
    });
  }

  function groupValue(groupId, attr) {
    const group = el(groupId);
    if (!group) return '';
    const a = dataAttr(attr);
    const on = group.querySelector('input[' + a + ']:checked');
    return on ? on.getAttribute(a) : '';
  }
  function groupValues(groupId, attr) {
    const group = el(groupId);
    if (!group) return [];
    const a = dataAttr(attr);
    return Array.prototype.slice.call(group.querySelectorAll('input[' + a + ']:checked'))
      .map((box) => box.getAttribute(a));
  }

  function syncConditionalFields() {
    const cadence = groupValue('fCadence', 'fCadence');
    const mode = groupValue('fLeadMode', 'fLeadMode');
    if (el('fPerMonthField')) el('fPerMonthField').hidden = cadence !== 'recurring';
    if (el('fMaxLeadField')) el('fMaxLeadField').hidden = mode !== 'max_lead';
    if (el('fNeededByField')) el('fNeededByField').hidden = mode !== 'needed_by';
  }

  function showFindError(message, focusId) {
    const err = el('findErr');
    if (err) { err.style.display = 'block'; err.textContent = message; }
    let node = focusId ? el(focusId) : null;
    if (node && typeof node.focus !== 'function') node = node.querySelector('input, button, select, textarea');
    if (node && node.tagName === 'DIV') node = node.querySelector('input, button, select, textarea') || node;
    if (node) {
      if (node.scrollIntoView) node.scrollIntoView({ block: 'center' });
      node.focus();
    }
  }
  function clearFindError() {
    const err = el('findErr');
    if (err) { err.style.display = 'none'; err.textContent = ''; }
  }

  function wholeNumber(raw) {
    if (raw === '') return null;
    const n = Number(raw);
    return Number.isInteger(n) ? n : NaN;
  }

  /* The ask, read off the form once. It is wider than the worker's request
     body on purpose: `materials`, `quantity_unit` and `per_month` have no
     column of their own there, so they stay on this object (which drives
     the notes sentence and the held pending) and are dropped by bodyFor
     before anything is posted. Nothing the seeker typed is lost: what has
     no column reaches the desk as a plain sentence on the notes. */
  function buildSpec() {
    const materials = TA.fMaterial ? TA.fMaterial.value() : [];
    if (!materials.length) return { error: 'Name the material you need.', focus: 'fMaterial' };

    const process = TA.fProcess ? TA.fProcess.value() : (val('fProcess') || null);

    const quantity = wholeNumber(val('fQuantity'));
    if (quantity === null || !Number.isFinite(quantity) || quantity < 1) {
      return { error: 'How many do you need? Whole numbers only.', focus: 'fQuantity' };
    }
    const quantityUnit = val('fQuantityUnit') || 'pairs';

    const cadence = groupValue('fCadence', 'fCadence') || 'one_off';
    let perMonth = null;
    /* The per-month figure is the whole reason the cadence question is
       asked, so a recurring ask without one is not an ask we can route. */
    if (cadence === 'recurring') {
      perMonth = wholeNumber(val('fPerMonth'));
      if (perMonth === null || !Number.isFinite(perMonth) || perMonth < 1) {
        return { error: 'How many per month? Whole numbers only.', focus: 'fPerMonth' };
      }
    }

    const mode = groupValue('fLeadMode', 'fLeadMode') || 'max_lead';
    let maxLead = null, neededBy = null;
    if (mode === 'max_lead') {
      maxLead = wholeNumber(val('fMaxLead'));
      if (maxLead !== null && (!Number.isFinite(maxLead) || maxLead < 0)) {
        return { error: 'Give the lead time in whole days.', focus: 'fMaxLead' };
      }
    } else {
      neededBy = val('fNeededBy') || null;
      if (neededBy && !/^\d{4}-\d{2}-\d{2}$/.test(neededBy)) {
        return { error: 'Give the date you need it by.', focus: 'fNeededBy' };
      }
    }

    const town = val('fTown');
    const country = TA.fCountry ? (TA.fCountry.value() || '') : val('fCountry');
    if (!town) return { error: 'Which town or city should we measure from?', focus: 'fTown' };
    if (!country) return { error: 'Which country are you in?', focus: 'fCountry' };

    const services = groupValues('fServices', 'service');
    const notes = val('fNotes');

    return { spec: {
      hub: HUB,
      material: materials[0],
      materials: materials,
      process: process || null,
      quantity: quantity,
      quantity_unit: quantityUnit,
      cadence: cadence,
      per_month: perMonth,
      max_lead_time_days: maxLead,
      needed_by: neededBy,
      town: town,
      country: country,
      services: services,
      notes: notesWithVolume(notes, materials, quantity, quantityUnit, perMonth),
    } };
  }

  /* What the worker has no column for still has to reach a human, so it is
     spelled out on the notes the desk reads. */
  function notesWithVolume(notes, materials, quantity, unit, perMonth) {
    const bits = [];
    bits.push('Volume: ' + quantity + ' ' + unit +
      (perMonth ? ', about ' + perMonth + ' per month' : '') + '.');
    if (materials.length > 1) {
      bits.push('Materials that would work: ' +
        labelsFor(vocab && vocab.materials, materials).join(', ') + '.');
    }
    const tail = bits.join(' ');
    return notes ? notes + '\n\n' + tail : tail;
  }

  /* ══════════════ the search ══════════════ */

  async function onSearch(e) {
    e.preventDefault();
    if (searching) return;
    clearFindError();
    const built = buildSpec();
    if (built.error) { showFindError(built.error, built.focus); return; }
    /* A new ask is a new object, which is how sendRequestAndPicks knows the
       request already filed does not belong to it. */
    spec = built.spec;
    await runSearch(false);
  }

  async function runSearch(retried) {
    const btn = el('findSubmit');
    const orig = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Looking…'; }
    searching = true;
    const q = new URLSearchParams();
    q.set('hub', spec.hub);
    q.set('material', spec.material);
    if (spec.process) q.set('process', spec.process);
    q.set('town', spec.town);
    q.set('country', spec.country);
    if (spec.max_lead_time_days !== null) q.set('max_lead_time_days', String(spec.max_lead_time_days));
    const d = await api('/listings/search?' + q.toString());
    searching = false;
    if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = orig; }

    if (d && (d.error === 'sign in required' || d.error === 'email_unconfirmed' ||
              d.http_status === 401)) {
      /* The shortlist is only shown to an account that could act on it. */
      if (retried || !window.NPAccount) {
        showFindError('Confirm your email and we will show you the ' + siteNounPlural() + ' that fit.');
        return;
      }
      /* Registering means leaving for an email client and coming back to a
         fresh load of this page, so the ask is held before the gate opens. */
      saveDraft(spec);
      NPAccount.requireConfirmed(() => runSearch(true));
      return;
    }
    if (!d || d.error) { showFindError(searchErrorText(d)); return; }

    /* The ask is on screen and answered: nothing left to put back. */
    clearDraft();

    /* Chris, on being asked for his country a second time. The next hub
       page reads this back through NP.loadLoc(), which is where step 1's
       own prefill comes from. */
    if (window.NP && NP.saveLoc) {
      NP.saveLoc(regionOf(spec.country) || spec.country, spec.country, spec.town);
    }

    matches = Array.isArray(d.matches) ? d.matches : [];
    noMatch = !!d.no_match;
    picks = [];
    renderResults();
    reveal('step2');
    hide('step3');
    resetStep3();
    scrollTo('step2');
  }

  function searchErrorText(d) {
    const e = d && d.error;
    if (e === 'network') return 'That did not go through. Check your connection and try again, or email hello@nexpoint.co.uk.';
    if (e === 'hub must be print or mill') return 'This page could not tell us which hub it belongs to. Refresh and try again.';
    if (e === 'http_404' || e === 'not found') return 'Searching is not switched on here just yet. Tell the desk what you need and we will route it by hand.';
    return 'We could not run that search just now. Try again, or email hello@nexpoint.co.uk.';
  }

  /* ══════════════ step 2: the shortlist ══════════════ */

  function renderResults() {
    renderMatchIntro();
    renderNoMatch();
    const grid = el('capGrid');
    if (grid) {
      grid.innerHTML = matches.map((c, i) => cardHtml(c, i + 1)).join('');
      grid.querySelectorAll('input[data-pick]').forEach((box) => {
        box.addEventListener('change', onPickChange);
      });
      /* Anywhere on the card ticks it. The tick's own label already does
         that natively, so a click that lands inside it is left alone. */
      grid.querySelectorAll('.cap.pick').forEach((cardEl) => {
        cardEl.addEventListener('click', (e) => {
          if (e.target.closest('label')) return;
          const box = cardEl.querySelector('input[data-pick]');
          if (box && !box.disabled) box.click();
        });
      });
    }
    updatePickState();
  }

  function renderMatchIntro() {
    const box = el('matchIntro');
    if (!box) return;
    if (!matches.length) {
      box.innerHTML = '';
      box.style.display = 'none';
      return;
    }
    const n = matches.length;
    const privacy = 'Names and addresses stay private until both sides accept an introduction.';
    box.style.display = 'block';
    /* When nothing met the ask, the count is the size of the pool, not a
       claim that any of them fit: #noMatch says what these actually are. */
    box.textContent = noMatch
      ? 'The nearest ' + siteNounPlural() + ' to you, wherever they are. ' + privacy
      : (n === 1 ? 'One ' + siteNoun() + ' can take this. '
                 : n + ' ' + siteNounPlural() + ' can take this, nearest first. ') + privacy;
  }

  /* Two things can leave the shortlist without a card to tick: a search
     that met nobody but had a pool to fall back on (no exact match), and a
     hub whose visible pool is empty, which is where a new hub starts. Both
     end at the same place, so both offer the same desk route rather than
     leaving the seeker on a heading with nothing under it. */
  function renderNoMatch() {
    const box = el('noMatch');
    if (!box) return;
    if (matches.length && !noMatch) { box.innerHTML = ''; box.hidden = true; return; }
    const line = matches.length
      ? 'No exact match yet. These are the nearest ' + esc(siteNounPlural()) +
        '; tick any you would still like to meet, or tell the desk and we will route it by hand.'
      : 'No ' + esc(siteNounPlural()) + ' are listed on ' + esc(hubName()) +
        ' yet. Tell the desk what you need and we will route it by hand.';
    box.hidden = false;
    box.innerHTML =
      '<div class="cap-empty">' +
      '<p>' + line + '</p>' +
      '<button class="btn btn-outline" type="button" id="noMatchDesk">Tell the desk</button>' +
      '</div>';
    const btn = el('noMatchDesk');
    if (btn) btn.addEventListener('click', tellTheDesk);
  }

  /* The desk route out of a no-match: the ask travels with it, so nobody
     has to type it again into a blank form. */
  function tellTheDesk() {
    const heading = 'Tell the desk what you need';
    const ref = deskRef() + ' · NO MATCH';
    if (typeof openIntro === 'function') { openIntro(ref, heading, { search: spec }); return; }
    if (window.NPAccount && NPAccount.gate) {
      NPAccount.gate({ hub: HUB, side: 'request_capacity', brief_ref: ref,
        heading: heading, payload: { search: spec } });
    }
  }

  function cardHtml(card, position) {
    const id = String(card.listing_id);
    const rows = [];

    const machines = (card.machines || []).map((m) => {
      const count = m.count == null ? 1 : Number(m.count);
      return (count > 1 ? count + '× ' : '') + String(m.name || '');
    }).filter(Boolean);
    if (machines.length) rows.push(['Machines', machines.join(', ')]);

    const mats = labelsFor(vocab && vocab.materials, card.materials);
    if (mats.length) rows.push(['Materials', mats.join(', ')]);

    if (card.min_lead_time_days != null) {
      rows.push(['Lead time', Number(card.min_lead_time_days) === 1
        ? '1 day' : Number(card.min_lead_time_days) + ' days']);
    }

    const servs = labelsFor(vocab && vocab.services, card.services);
    if (servs.length) rows.push(['Services', servs.join(', ')]);

    if (card.distance_km != null) rows.push(['Distance', '~' + card.distance_km + ' km']);

    const exactMatch = !card.no_match_flag;
    const who = siteNounTitle() + ' ' + position;
    const where = [card.town, card.country].filter(Boolean).join(', ');
    const tick = 'Introduce me to this ' + siteNoun();

    /* The tick is a real label around a real checkbox, and the card is a
       plain div: a <label> cannot legally hold a heading or a list. The
       whole card is still clickable, forwarded in renderResults(). The
       accessible name opens with the visible words and then says which
       card it is, so four of them are not four identical ticks. */
    return '<div class="cap pick" data-card="' + esc(id) + '">' +
      '<span class="cap__head">' +
        '<b class="cap__num">' + esc(who) + '</b>' +
        (card.verified ? '<span class="badge-verified">Verified</span>' : '') +
        (exactMatch ? '' : '<span class="badge-nomatch">no exact match</span>') +
      '</span>' +
      '<h3>' + esc(where) + '</h3>' +
      '<dl>' + rows.map((r) =>
        '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>').join('') + '</dl>' +
      '<label class="cap__tick">' +
        '<input type="checkbox" id="pick-' + esc(id) + '" data-pick="' + esc(id) + '" ' +
        'aria-label="' + esc(tick + ': ' + who + ', ' + where) + '">' +
        '<span>' + esc(tick) + '</span>' +
      '</label></div>';
  }

  /* The ticks follow `picks`, rather than the other way round: a restored
     set of picks has to reach the boxes that are on screen now. */
  function syncPickBoxes() {
    const grid = el('capGrid');
    if (!grid) return;
    grid.querySelectorAll('input[data-pick]').forEach((box) => {
      box.checked = picks.indexOf(box.getAttribute('data-pick')) !== -1;
    });
  }

  function onPickChange(e) {
    const id = e.target.getAttribute('data-pick');
    if (e.target.checked) {
      if (picks.length >= MAX_PICKS) { e.target.checked = false; updatePickState(); return; }
      if (picks.indexOf(id) === -1) picks.push(id);
    } else {
      picks = picks.filter((p) => p !== id);
    }
    updatePickState();
  }

  /* One place decides what the cap looks like: the ticks that are still
     available, the hint that explains why the rest are not, and the bar. */
  function updatePickState() {
    const full = picks.length >= MAX_PICKS;
    const grid = el('capGrid');
    if (grid) {
      grid.querySelectorAll('input[data-pick]').forEach((box) => {
        const on = box.checked;
        box.disabled = full && !on;
        const lab = box.closest('.pick');
        if (lab) {
          lab.classList.toggle('is-on', on);
          lab.classList.toggle('is-off', full && !on);
        }
      });
    }
    const hint = el('pickHint');
    if (hint) {
      hint.textContent = full ? 'Three is the limit, so each ' + siteNoun() + ' gets a real look.' : '';
      hint.hidden = !full;
    }
    const bar = el('pickBar');
    if (bar) {
      bar.hidden = picks.length === 0;
      const count = el('pickCount');
      if (count) count.textContent = picks.length + ' of ' + MAX_PICKS + ' picked';
    }
    /* Step 3 is open on what was picked a moment ago, so it follows along
       rather than showing a list the seeker has since changed. */
    const step3 = el('step3');
    if (step3 && !step3.hidden) renderPickSummary();
  }

  /* ══════════════ step 3: the request ══════════════ */

  /* The success card replaces step 3's panel, so a second search has to put
     the panel back before it can be filled in again. */
  function resetStep3() {
    const box = el('step3Body');
    if (!box || step3Shell === null || box.innerHTML === step3Shell) return;
    box.innerHTML = step3Shell;
    introTerms = null;
    bindRequestSubmit();
  }

  function bindRequestSubmit() {
    const req = el('requestSubmit');
    if (req) req.addEventListener('click', onRequestSubmit);
  }

  function onContinue() {
    if (!picks.length) return;
    renderPickSummary();
    reveal('step3');
    renderTermsBlock();
    scrollTo('step3');
  }

  function renderPickSummary() {
    const box = el('pickSummary');
    if (!box) return;
    const chosen = picks.map((id) => {
      const i = matches.findIndex((c) => String(c.listing_id) === id);
      return { card: matches[i], position: i + 1 };
    }).filter((c) => c.card);
    box.innerHTML =
      '<p class="body">' + esc(chosen.length === 1
        ? 'One ' + siteNoun() + ', picked by you:'
        : chosen.length + ' ' + siteNounPlural() + ', picked by you:') + '</p>' +
      '<ul class="pick-summary">' + chosen.map((c) =>
        '<li><b>' + esc(siteNounTitle()) + ' ' + c.position + '</b> ' +
        esc([c.card.town, c.card.country].filter(Boolean).join(', ')) + '</li>').join('') +
      '</ul>' +
      '<p class="np-hint">Nothing is sent to a ' + esc(siteNoun()) +
      ' until we have read your request. Contact details are exchanged only once both sides accept.</p>';
  }

  /* Layer 3 of the three terms layers: what a seeker accepts each time an
     introduction is asked for. Read fresh every time step 3 opens, because
     the id ticked here is the id the worker checks against the current one. */
  async function renderTermsBlock() {
    const box = el('introTermsBlock');
    if (!box) return;
    box.innerHTML = '<p class="body" style="margin:0">Loading the introduction terms…</p>';
    const d = await api('/terms/current?layer=introduction');
    if (!el('introTermsBlock')) return;
    if (!d || d.error || !d.id) {
      introTerms = null;
      el('introTermsBlock').innerHTML =
        '<p class="np-sign-error" style="display:block">We could not load the introduction terms. ' +
        'Refresh and try again, or email hello@nexpoint.co.uk.</p>';
      return;
    }
    introTerms = d;
    el('introTermsBlock').innerHTML =
      '<div class="terms-scroll">' + NP.markdownLite(d.body_md) + '</div>' +
      '<label class="np-terms-tick"><input type="checkbox" id="introTick"> ' +
      'I accept the introduction terms, version ' + esc(d.version) + '</label>';
  }

  function showRequestError(message, focusId) {
    const err = el('requestErr');
    if (err) { err.style.display = 'block'; err.textContent = message; }
    const node = focusId ? el(focusId) : null;
    if (node) {
      if (node.scrollIntoView) node.scrollIntoView({ block: 'center' });
      if (typeof node.focus === 'function') node.focus();
    }
  }
  function clearRequestError() {
    const err = el('requestErr');
    if (err) { err.style.display = 'none'; err.textContent = ''; }
  }

  function onRequestSubmit() {
    if (sending) return;
    clearRequestError();
    if (!spec) { showRequestError('Tell us what you need first.'); return; }
    if (!picks.length) {
      showRequestError('Tick at least one ' + siteNoun() + ' before you send this.');
      return;
    }
    if (!introTerms || !introTerms.id) {
      showRequestError('We could not load the introduction terms. Refresh and try again.');
      return;
    }
    const tick = el('introTick');
    if (!tick || !tick.checked) {
      showRequestError('Read the introduction terms and tick to accept them.', 'introTick');
      return;
    }

    const A = window.NPAccount;
    if (!A) { showRequestError(requestErrorText({ error: 'network' })); return; }

    /* Signed out or unconfirmed, the whole request is held so the account
       flow can finish it rather than losing everything the seeker chose.
       portal.js offers the replay when they come back confirmed. */
    if (!A.user || !A.confirmed()) holdPending(spec, picks, introTerms.id);
    A.requireConfirmed(() => send(spec, picks.slice(), introTerms.id, false));
  }

  /* The two calls, in order, against the values they were handed rather
     than a re-read of the page: a refresh mid-flight can rebuild the panel
     and what the seeker chose must not depend on what is still on screen.
     `requestId` survives a failed second call so a retry attaches picks to
     the request already filed instead of filing a second one. */
  async function send(theSpec, thePicks, termsVersionId, retried) {
    const btn = el('requestSubmit');
    const orig = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
    sending = true;
    const d = await sendRequestAndPicks(theSpec, thePicks, termsVersionId);
    sending = false;

    if (d && d.ok) { renderSuccess(); return d; }
    if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = orig; }

    if (d && d.error === 'email_unconfirmed' && !retried && window.NPAccount) {
      /* the session outlived the confirmation state we had cached */
      holdPending(theSpec, thePicks, termsVersionId);
      await NPAccount.refresh();
      NPAccount.requireConfirmed(() => send(theSpec, thePicks, termsVersionId, true));
      return d;
    }
    if (d && d.error === 'stale_terms') {
      /* The version ticked is no longer the current one: fetch the new text
         and ask for the tick again rather than sending on a stale consent. */
      showRequestError(TERMS_MOVED);
      await renderTermsBlock();
      const tick = el('introTick');
      if (tick && tick.scrollIntoView) tick.scrollIntoView({ block: 'center' });
      return d;
    }
    showRequestError(requestErrorText(d), pickErrorFocus(d));
    return d;
  }

  /* The one writer of the held action. `requestId` only survives while this
     page does, so when the ask is already filed the held copy carries its id
     too: that is what stops a replay in the next tab from filing it again. */
  function holdPending(theSpec, thePicks, termsVersionId) {
    if (!window.NPPending) return;
    const held = { kind: 'request', hub: HUB, search: theSpec,
      picks: thePicks.slice(), terms_version_id: termsVersionId };
    if (requestId && filedSpec === theSpec) held.request_id = requestId;
    NPPending.save(held);
  }

  /* The moment POST /seeker-requests returns during a replay, the ask exists
     on the worker whatever happens to the picks call after it. Only the
     replay path passes `savedAt` (submitPending's own `p.saved_at`, the
     identity of the pending it is replaying), so an in-page confirmed
     submission never calls this at all and never touches the store. The
     identity check is the point: the store is re-read fresh, and the id is
     merged in only if what is sitting there right now is still the same
     pending submitPending adopted. A different ask held in the meantime, or
     the same slot already moved on, is left exactly as it is. Saving
     re-stamps the hold's clock, which is right: it now holds a real request
     that still needs its picks attached. */
  function rememberFiledRequest(id, savedAt) {
    if (!window.NPPending || !savedAt) return;
    const held = NPPending.load();
    if (!held || !held.search || held.saved_at !== savedAt || held.request_id === id) return;
    NPPending.save(Object.assign({}, held, { request_id: id }));
  }

  /* The request is filed once per ask. A retry after a failed picks call
     hands back the same ask object, so it attaches to the request already
     filed instead of filing a second one; a different ask files its own.
     `replaySavedAt` is only ever supplied by submitPending; the in-page
     send() path passes nothing, so a freshly filed request there can never
     merge into someone else's held pending. */
  async function sendRequestAndPicks(theSpec, thePicks, termsVersionId, replaySavedAt) {
    if (!requestId || filedSpec !== theSpec) {
      const filed = await postJson('/seeker-requests', bodyFor(theSpec));
      if (!filed || !filed.ok || !filed.request_id) return filed || { error: 'network' };
      requestId = filed.request_id;
      filedSpec = theSpec;
      if (replaySavedAt) rememberFiledRequest(requestId, replaySavedAt);
    }
    return postJson('/seeker-requests/picks', {
      request_id: requestId, listing_ids: thePicks, terms_version_id: termsVersionId,
    });
  }

  /* The request body the worker takes, and nothing else. POST
     /seeker-requests reads exactly these eleven names; `materials`,
     `quantity_unit` and `per_month` have no column and no reader there, so
     sending them would be a contract the worker never agreed to. They stay
     on the internal `spec` (which the held pending keeps whole) and reach
     the desk as a sentence on the notes. */
  function bodyFor(s) {
    return {
      hub: s.hub, material: s.material, process: s.process,
      quantity: s.quantity, cadence: s.cadence,
      max_lead_time_days: s.max_lead_time_days, needed_by: s.needed_by,
      town: s.town, country: s.country, services: s.services, notes: s.notes,
    };
  }

  /* A refusal that names a listing takes the seeker back to that card. */
  function pickErrorFocus(d) {
    return (d && d.listing_id) ? 'pick-' + d.listing_id : null;
  }

  function requestErrorText(d) {
    const e = d && d.error;
    const site = siteNoun();
    if (e === 'network') return 'That did not send. Check your connection and try again, or email hello@nexpoint.co.uk.';
    if (e === 'too_many_picks') return 'Three ' + siteNounPlural() + ' is the limit. Untick one and send again.';
    if (e === 'listing_not_matched' || e === 'listing_not_live') {
      return 'One of the ' + siteNounPlural() + ' you picked is no longer on your shortlist. ' +
        'Run the search again and pick from the new list.';
    }
    if (e === 'own_listing') {
      return 'That is your own ' + site + ', so we cannot introduce you to it. Untick it and send again.';
    }
    if (e === 'listing_already_closed') {
      return 'We have already closed an introduction to that ' + site + ' for this request. Pick another one.';
    }
    if (e === 'picks_already_made') {
      return 'Your picks are already in. You can follow this request on your account.';
    }
    if (e === 'request_not_open') {
      return 'This request is no longer open. Tell the desk and we will pick it up by hand.';
    }
    if (e === 'not your request') return 'That request belongs to another account. Start again from the search.';
    if (e === 'request not found') return 'We could not find that request any more. Run the search again.';
    if (e === 'organisation required') {
      return 'Your account is not attached to a company yet. Email hello@nexpoint.co.uk and we will sort it out.';
    }
    if (e === 'sign in required') return 'Sign in and send this again.';
    if (e === 'email_unconfirmed') {
      return 'We still need the link in your email clicked before this can be sent. Open it, then send again.';
    }
    if (e === 'http_404' || e === 'not found') {
      return 'Requests are not switched on here just yet. Tell the desk what you need and we will route it by hand.';
    }
    if (typeof e === 'string' && e) {
      return e.charAt(0).toUpperCase() + e.slice(1).replace(/_/g, ' ') + '.';
    }
    return 'That did not send. Try again, or email hello@nexpoint.co.uk.';
  }

  function renderSuccess() {
    if (window.NPPending) NPPending.clear();
    const box = el('step3Body');
    if (!box) return;
    box.innerHTML =
      '<div class="success">' +
      '<div class="ok"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M4 12l6 6L20 6"/></svg></div>' +
      '<h2>Thank you.</h2>' +
      '<p>Received. We check every request personally and put it to the ' + esc(siteNounPlural()) +
      ' you picked. You can follow it on your account.</p>' +
      '<div class="modal-actions" style="justify-content:center">' +
      '<a class="btn btn-outline" href="' + esc(accountUrl()) + '">Go to your account</a></div>' +
      '</div>';
    const bar = el('pickBar');
    if (bar) bar.hidden = true;
    scrollTo('step3');
  }

  const TERMS_MOVED = 'The introduction terms have been updated. Read them again and tick to accept.';

  /* What portal.js's replay card sends when a seeker comes back confirmed.
     It restores what was held, so a success also puts the page into the
     state the seeker would have reached had they never been stopped. */
  async function submitPending(p) {
    if (!p || !p.search || !Array.isArray(p.picks) || !p.picks.length || !p.terms_version_id) {
      return { error: 'no_pending' };
    }
    spec = p.search;
    picks = p.picks.slice();
    /* An earlier attempt may already have filed the ask and failed on the
       picks. The held copy carries that id, so this replay attaches picks
       to the request that exists instead of filing a second one. */
    if (p.request_id) { requestId = p.request_id; filedSpec = spec; }
    const d = await sendRequestAndPicks(spec, picks, p.terms_version_id, p.saved_at);
    if (d && d.ok) { reveal('step3'); renderSuccess(); return d; }
    if (d && d.error === 'stale_terms') {
      /* The terms moved while the request sat held. The consent is stale;
         the request is not. The hold goes, because a card cannot ask for a
         tick, and the filed id stays in this module so nothing files twice.
         The seeker lands back on step 3 with the new text to read. */
      if (window.NPPending) NPPending.clear();
      await restoreForNewTerms(p.picks.slice());
    }
    return d;
  }

  /* Puts the page back where the held request left off: the shortlist re-run
     from the same ask, the picks that are still on it ticked again, step 3
     open on freshly fetched terms. `spec` is the same object throughout, so
     the request already filed still belongs to it. */
  async function restoreForNewTerms(held) {
    await runSearch(false);
    picks = held.filter((id) => matches.some((c) => String(c.listing_id) === id))
      .slice(0, MAX_PICKS);
    syncPickBoxes();
    updatePickState();
    if (picks.length) {
      onContinue();
      showRequestError(TERMS_MOVED);
      return;
    }
    /* Nothing held is on the shortlist any more, so there is nothing to
       open step 3 on; the message belongs on the list they pick from. */
    const hint = el('pickHint');
    if (hint) {
      hint.hidden = false;
      hint.textContent = 'The introduction terms have been updated, and your shortlist has moved on. ' +
        'Pick again and tick the new terms.';
    }
  }

  /* ══════════════ steps, on and off ══════════════ */

  function reveal(id) { const n = el(id); if (n) n.hidden = false; }
  function hide(id) { const n = el(id); if (n) n.hidden = true; }
  function scrollTo(id) {
    const n = el(id);
    if (n && n.scrollIntoView) n.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ══════════════ boot ══════════════ */

  async function init() {
    if (!mount()) return;
    const cont = el('pickContinue');
    if (cont) cont.addEventListener('click', onContinue);
    const shell = el('step3Body');
    if (shell) step3Shell = shell.innerHTML;
    bindRequestSubmit();

    /* The account is awaited only so the place fields can be prefilled from
       it; nothing on this page is gated until the seeker acts. */
    const [v] = await Promise.all([
      window.NPVocab ? NPVocab.load(HUB) : Promise.resolve(null),
      window.NPAccount ? NPAccount.ready.catch(() => null) : Promise.resolve(null),
    ]);
    vocab = v;
    /* Read before the render, because the render is what puts it back. */
    restored = loadDraft();
    renderForm();
    syncConditionalFields();
  }

  window.NPFind = { init: init, submitPending: submitPending, errorText: requestErrorText };
})();


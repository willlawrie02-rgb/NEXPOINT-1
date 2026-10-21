/* NexPoint Global Portal - the seeker's find flow (spec 2026-09-03; plan
   067, Terms 1.3, 21 October 2026). The find page's own module. Four steps:

     1  the ask       what you need, in the network's own vocabulary
     2  the terms     the Introduction Acceptance terms, accepted for this
                      search before any name shows (one acceptance per search)
     3  the results   the three best fits by name, and a map of every ranked
                      site; pick one
     4  the request   one call that goes straight to the site picked

   The ranking is the worker's (POST /listings/search): material, region and
   the volume asked for are hard filters, then a weighted score on every
   field the seeker filled in (material, capacity, location, lead time). The
   worker records the search and the acceptance, ranks up to ten and names
   the best three (`named`, with `company`). Those three are shown as cards,
   each tagged "Best fit for your request"; every ranked site is a pin on
   the map (match-map.js), numbered by rank, the best three filled and the
   rest outlined. A pin beyond the three is a town and a rank only: no name,
   no Choose (what was accepted and shown is what is picked, Q4). Sites in
   one town share a numbered pin. The seeker picks one of the three, on a
   card or on the map, and the two stay in step.

   The three named cards are the only names on this page. A card carries a
   town, a country, machines, materials, services and a lead time; the
   site's address and contact details travel only inside an introduction it
   has accepted.

   One call makes the request: POST /seeker-requests {search_id,
   listing_id, client_key}. The worker files the request, writes the
   introduction and emails the site its offer; a retry carries the same
   client key, so a timeout that landed the row is answered with that row.

   Started by portal.js's np:modules boot, like every other page module.   */
(function () {
  'use strict';

  const HUB = document.body.dataset.hub === 'mill' ? 'mill' : 'print';
  const MAX_PICKS = 1;
  const SHORTLIST = 3;

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
     A provider is a "site" on the 3D Print Hub and a "cell" on the Mill Hub,
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
  const HUB_NAME = { print: '3D Print Hub', mill: 'Mill Hub' };
  function hubName() { return HUB_NAME[HUB]; }
  function deskRef() {
    const c = (window.NP && NP.config && NP.config()) || null;
    return (c && c.deskRef) || (HUB === 'mill' ? 'MILL HUB' : '3D PRINT HUB');
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
  let spec = null;             /* the ask, as POST /listings/search takes it */
  let matches = [];            /* every ranked result the worker sent, in rank order (up to ten) */
  let shortlistIds = [];       /* the best three of them, by listing id: the cards shown */
  let named = [];              /* the ids the worker named (company on the card): the only pickable ones */
  let seekerPoint = null;      /* the seeker's own town point, for the map */
  let matchMap = null;         /* NPMatchMap handle while the results show one */
  let noMatch = false;         /* nothing met the hard filter, so this is the pool */
  let picks = [];              /* listing ids, at most MAX_PICKS, in tick order */
  let searchTerms = null;      /* {id, version, body_md} for layer=introduction, shown at the gate */
  let searchId = null;         /* the search the worker recorded; the pick names it */
  let searching = false;
  let sending = false;
  let step3Shell = null;       /* step 3's panel before a success card replaced it */

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
    const town = place.town;
    const country = place.country;

    box.innerHTML =
      '<form id="findForm" novalidate>' +
      '<div class="form-grid">' +

        '<div class="field full"><label for="fMaterial">Material</label>' +
        '<input id="fMaterial" placeholder="Select from the list or type your own">' +
        '<span class="np-hint">Name the material you need. Add more if any of them would do; ' +
        'we match on the first and carry the rest with your request.</span></div>' +

        '<div class="field full"><label for="fProcess">Process (optional)</label>' +
        '<input id="fProcess" placeholder="Select from the list or type your own"></div>' +

        /* One off or recurring is asked before how many (plan 055, point 20):
           the count reads differently once the cadence is known. */
        '<div class="field full"><label id="fCadenceLabel">Is this a one off?</label>' +
        '<div class="lgroup" id="fCadence" role="radiogroup" aria-labelledby="fCadenceLabel">' +
        pickChip('fCadence', 'one_off', 'One off', true, 'radio') +
        pickChip('fCadence', 'recurring', 'Recurring', false, 'radio') +
        '</div></div>' +

        '<div class="field"><label for="fQuantity" id="fQuantityLabel">' +
        'How many</label>' +
        '<input id="fQuantity" type="number" min="1" step="1" inputmode="numeric" placeholder="e.g. 200"></div>' +

        '<div class="field"><label for="fQuantityUnit">Counted in</label>' +
        '<select id="fQuantityUnit"><option value="pairs">Pairs</option>' +
        '<option value="units">Units</option></select></div>' +

        '<div class="field full"><label id="fLeadModeLabel">When do you need it?</label>' +
        '<div class="lgroup" id="fLeadMode" role="radiogroup" aria-labelledby="fLeadModeLabel">' +
        pickChip('fLeadMode', 'max_lead', 'Within a lead time', true, 'radio') +
        pickChip('fLeadMode', 'needed_by', 'By a date', false, 'radio') +
        '</div></div>' +

        '<div class="field" id="fMaxLeadField"><label for="fMaxLead">Lead time (days)</label>' +
        '<input id="fMaxLead" type="number" min="0" step="1" inputmode="numeric" placeholder="e.g. 21"></div>' +

        '<div class="field" id="fNeededByField" hidden><label for="fNeededBy">Needed by</label>' +
        '<input id="fNeededBy" type="date"></div>' +

        '<div class="field"><label for="fTown">Town or city</label>' +
        '<input id="fTown" value="' + esc(town) + '" placeholder="Where the work lands"></div>' +

        '<div class="field"><label for="fCountry">Country</label>' +
        '<input id="fCountry" placeholder="Start typing"></div>' +

        '<div class="field full"><label id="fServicesLabel">Services you also want (optional)</label>' +
        '<div class="lgroup" id="fServices" role="group" aria-labelledby="fServicesLabel">' +
        services.map((s) => pickChip('service', s.term, s.label, false, 'checkbox')).join('') +
        '</div></div>' +

        '<div class="field full"><label for="fNotes">Anything else we should know? (optional)</label>' +
        '<textarea id="fNotes" placeholder="Tolerances, finishing, the deadline behind the deadline">' +
        '</textarea></div>' +

      '</div>' +
      '<p class="np-sign-error" id="findErr" style="display:none"></p>' +
      /* The hint used to open "Seeing the shortlist needs a confirmed hub
         account". Since the one-door register nobody reaches this form without
         one, so only the half that still tells them something is left. */
      '<p class="np-hint" id="findGateHint">Nothing goes to any ' + esc(siteNoun()) +
      ' until you pick one.</p>' +
      '<div class="modal-actions"><button class="btn btn-primary" type="submit" id="findSubmit">' +
      'Find the ' + esc(siteNounPlural()) + ' that fit</button></div>' +
      '</form>';

    TA.fMaterial = window.NPTypeahead ? NPTypeahead.attach(el('fMaterial'), {
      options: (vocab && vocab.materials) || [], multi: true, allowFree: true,
    }) : null;
    TA.fProcess = window.NPTypeahead ? NPTypeahead.attach(el('fProcess'), {
      options: (vocab && vocab.processes) || [], allowFree: true,
    }) : null;
    TA.fCountry = window.NPTypeahead ? NPTypeahead.attach(el('fCountry'), {
      options: countryOptions(), allowFree: true,
      value: country ? [{ term: country, label: country }] : null,
    }) : null;
    if (!TA.fCountry && el('fCountry')) el('fCountry').value = country;

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
    if (el('fQuantityLabel')) el('fQuantityLabel').textContent =
      cadence === 'recurring' ? 'How many per month' : 'How many';
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

  /* The ask, read off the form once. Since plan 067 the worker's search
     takes every field here (`materials` and `quantity_unit` included: the
     search records the whole ask), so bodyFor sends it as it is. The notes
     sentence still spells the volume and the other materials out for the
     desk, which reads the request's notes. */
  function buildSpec() {
    const materials = TA.fMaterial ? TA.fMaterial.value() : [];
    if (!materials.length) return { error: 'Name the material you need.', focus: 'fMaterial' };

    const process = TA.fProcess ? TA.fProcess.value() : (val('fProcess') || null);

    const quantity = wholeNumber(val('fQuantity'));
    if (quantity === null || !Number.isFinite(quantity) || quantity < 1) {
      return { error: 'How many do you need? Whole numbers only.', focus: 'fQuantity' };
    }
    const quantityUnit = val('fQuantityUnit') || 'pairs';

    /* One figure serves both cadences: for a recurring ask "How many" is
       read as the monthly volume (Will, 2026-09-08). */
    const cadence = groupValue('fCadence', 'fCadence') || 'one_off';

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
      max_lead_time_days: maxLead,
      needed_by: neededBy,
      town: town,
      country: country,
      services: services,
      notes: notesWithVolume(notes, materials, quantity, quantityUnit, cadence),
    } };
  }

  /* What the worker has no column for still has to reach a human, so it is
     spelled out on the notes the desk reads. */
  function notesWithVolume(notes, materials, quantity, unit, cadence) {
    const bits = [];
    bits.push('Volume: ' + quantity + ' ' + unit +
      (cadence === 'recurring' ? ' per month, recurring.' : ', one off.'));
    if (materials.length > 1) {
      bits.push('Materials that would work: ' +
        labelsFor(vocab && vocab.materials, materials).join(', ') + '.');
    }
    const tail = bits.join(' ');
    return notes ? notes + '\n\n' + tail : tail;
  }

  /* ══════════════ the search, behind the terms ══════════════ */

  /* A new ask opens the terms gate (P9: one acceptance per search, before
     any name shows). The search itself runs only from the gate's button,
     once the tick is in. */
  async function onSearch(e) {
    e.preventDefault();
    if (searching) return;
    clearFindError();
    const built = buildSpec();
    if (built.error) { showFindError(built.error, built.focus); return; }
    /* A new ask is a new object: its own acceptance, its own search, and
       its own client key for the request that follows. */
    spec = built.spec;
    searchId = null;
    await openTermsGate();
  }

  /* Layer 3 of the three terms layers, read fresh every time the gate
     opens, because the id ticked here is the id the worker checks against
     the current one (stale_terms when it has moved on). */
  async function openTermsGate() {
    hide('step2');
    hide('step3');
    resetStep3();
    if (matchMap) { matchMap.destroy(); matchMap = null; }
    reveal('stepTerms');
    clearSearchTermsError();
    await renderSearchTerms();
    scrollTo('stepTerms');
  }

  async function renderSearchTerms() {
    const box = el('searchTermsBlock');
    if (!box) return;
    box.innerHTML = '<p class="body" style="margin:0">Loading the introduction terms…</p>';
    const d = await api('/terms/current?layer=introduction');
    if (!el('searchTermsBlock')) return;
    if (!d || d.error || !d.id) {
      searchTerms = null;
      el('searchTermsBlock').innerHTML =
        '<p class="np-sign-error" style="display:block">We could not load the introduction terms. ' +
        'Refresh and try again, or email hello@nexpoint.co.uk.</p>';
      return;
    }
    searchTerms = d;
    el('searchTermsBlock').innerHTML =
      '<div class="terms-scroll">' + NP.markdownLite(d.body_md) + '</div>' +
      '<label class="np-terms-tick"><input type="checkbox" id="searchTick"> ' +
      'I accept the introduction terms, version ' + esc(d.version) + '</label>';
  }

  function showSearchTermsError(message, focusId) {
    const err = el('searchTermsErr');
    if (err) { err.style.display = 'block'; err.textContent = message; }
    const node = focusId ? el(focusId) : null;
    if (node) {
      if (node.scrollIntoView) node.scrollIntoView({ block: 'center' });
      if (typeof node.focus === 'function') node.focus();
    }
  }
  function clearSearchTermsError() {
    const err = el('searchTermsErr');
    if (err) { err.style.display = 'none'; err.textContent = ''; }
  }

  /* The gate's button: the tick, then the search with the version ticked. */
  async function onSearchAccept() {
    if (searching) return;
    clearSearchTermsError();
    if (!spec) { showSearchTermsError('Tell us what you need first.'); return; }
    if (!searchTerms || !searchTerms.id) {
      showSearchTermsError('We could not load the introduction terms. Refresh and try again.');
      return;
    }
    const tick = el('searchTick');
    if (!tick || !tick.checked) {
      showSearchTermsError('Read the introduction terms and tick to accept them.', 'searchTick');
      return;
    }
    await runSearch(false);
  }

  async function runSearch(retried) {
    const btn = el('searchAccept');
    const orig = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Looking…'; }
    searching = true;
    const d = await postJson('/listings/search',
      Object.assign(bodyFor(spec), { terms_version_id: searchTerms.id }));
    searching = false;
    if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = orig; }

    if (d && (d.error === 'sign in required' || d.error === 'email_unconfirmed' || d.http_status === 401)) {
      /* The session lapsed mid-visit: sign in over the page, the ask and
         the tick stay as they are, then the same search runs again (Q5). */
      if (retried || !window.NPAccount) { showSearchTermsError('Sign in and run the search again.'); return; }
      NPAccount.requireConfirmed(() => runSearch(true));
      return;
    }
    if (d && d.error === 'stale_terms') {
      /* The version ticked is no longer the current one: fetch the new
         text and ask for the tick again rather than searching on a stale
         consent. The ask stays as typed. */
      showSearchTermsError(TERMS_MOVED);
      await renderSearchTerms();
      const tick = el('searchTick');
      if (tick && tick.scrollIntoView) tick.scrollIntoView({ block: 'center' });
      return;
    }
    if (!d || d.error) { showSearchTermsError(searchErrorText(d)); return; }

    /* Chris, on being asked for his country a second time. The next hub
       page reads this back through NP.loadLoc(), which is where step 1's
       own prefill comes from. */
    if (window.NP && NP.saveLoc) {
      NP.saveLoc(regionOf(spec.country) || spec.country, spec.country, spec.town);
    }

    searchId = d.search_id || null;
    matches = Array.isArray(d.matches) ? d.matches.filter(Boolean) : [];
    named = matches.filter((c) => c.named === true || typeof c.company === 'string')
      .map((c) => String(c.listing_id));
    shortlistIds = shortlistOf(matches).map((c) => String(c.listing_id));
    noMatch = !!d.no_match;
    seekerPoint = d.seeker_point || null;
    picks = [];
    hide('stepTerms');
    renderResults();
    reveal('step2');
    renderMap();
    hide('step3');
    resetStep3();
    scrollTo('step2');
  }

  function searchErrorText(d) {
    const e = d && d.error;
    if (e === 'network') return 'That did not go through. Check your connection and try again, or email hello@nexpoint.co.uk.';
    if (e === 'hub must be print or mill') return 'This page could not tell us which hub it belongs to. Refresh and try again.';
    if (e === 'terms acceptance store failed' || e === 'search store failed' || e === 'search record failed') {
      return 'We could not record your acceptance just now. Try again in a moment, or email hello@nexpoint.co.uk.';
    }
    if (e === 'http_404' || e === 'not found' || e === 'POST only') {
      return 'Searching is not switched on here just yet. Tell the desk what you need and we will route it by hand.';
    }
    if (typeof e === 'string' && e && e !== 'http_500' && e !== 'http_502') {
      return e.charAt(0).toUpperCase() + e.slice(1).replace(/_/g, ' ') + '.';
    }
    return 'We could not run that search just now. Try again, or email hello@nexpoint.co.uk.';
  }

  /* ══════════════ step 2: the shortlist ══════════════ */

  /* The cards the worker marked as the shortlist. A worker from before plan
     052 marks none, so the first three stand in: the ranking is the same. */
  function shortlistOf(all) {
    const marked = all.filter((c) => c && c.shortlist === true);
    return (marked.length ? marked : all).slice(0, SHORTLIST);
  }
  function isBest(id) { return shortlistIds.indexOf(String(id)) !== -1; }
  /* Only a site the worker named may be picked (Q4): the search's record
     is the record of the pick. A worker from before plan 067 names none,
     in which case the three it marked stand in, nameless. */
  function isNamed(id) { return named.length ? named.indexOf(String(id)) !== -1 : isBest(id); }
  /* The cards on the page: the three best fits, in rank order, each with
     its rank (the number its pin carries). A site beyond them is a pin. */
  function visibleMatches() {
    return matches.map((c, i) => ({ card: c, position: i + 1 }))
      .filter((m) => isBest(m.card.listing_id));
  }

  /* The map above the cards. Made after step 2 is shown, because Leaflet
     measures its box when it is made; remade on every search. */
  function renderMap() {
    const box = el('matchMap');
    if (matchMap) { matchMap.destroy(); matchMap = null; }
    if (!box) return;
    box.hidden = true;
    if (!window.NPMatchMap || !matches.length) return;
    box.hidden = false;
    matchMap = NPMatchMap.mount({
      el: box,
      assetBase: window.NP_APEX || '',
      noun: siteNoun(),
      seeker: seekerPoint,
      /* every ranked site, so a pin's number is the site's rank and the
         cards say the same; the best three are flagged for their pins */
      sites: matches.map((c, i) => ({
        listing_id: c.listing_id, position: i + 1, town: c.town, country: c.country,
        point: c.point || null, lead: c.min_lead_time_days, distance: c.distance_km,
        best: isBest(c.listing_id),
      })),
      onPick: chooseFromMap,
    });
    if (!matchMap) { box.hidden = true; return; }
    matchMap.refresh();
    matchMap.select(picks[0] || null);
  }

  /* Choose on the map ticks that card, exactly as a click on it would. A
     pin beyond the three has no Choose; an id that is not named is ignored. */
  function chooseFromMap(id) {
    if (!isNamed(id)) return;
    const box = document.querySelector('#capGrid input[data-pick="' + cssEscape(id) + '"]');
    if (!box || box.disabled) return;
    if (!box.checked) box.click();
    const card = box.closest('.cap');
    if (card && card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function cssEscape(v) {
    return (window.CSS && CSS.escape) ? CSS.escape(String(v)) : String(v).replace(/["\\]/g, '\\$&');
  }

  function renderResults() {
    renderMatchIntro();
    renderNoMatch();
    const grid = el('capGrid');
    if (grid) {
      grid.innerHTML = visibleMatches().map((m) => cardHtml(m.card, m.position, isBest(m.card.listing_id))).join('');
      grid.querySelectorAll('input[data-pick]').forEach((box) => {
        /* a re-render keeps the pick */
        box.checked = picks.indexOf(box.getAttribute('data-pick')) !== -1;
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

  /* small counts in words, as the page's own copy has them ("the three sites") */
  function words(n, sentenceStart) {
    const w = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][n];
    if (!w) return String(n);
    return sentenceStart ? w.charAt(0).toUpperCase() + w.slice(1) : w;
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
    const k = shortlistIds.length;
    const extra = n - k;
    const more = extra > 0
      ? words(extra, true) + ' more ' + (extra === 1 ? siteNoun() : siteNounPlural()) + ' on the map. ' : '';
    box.style.display = 'block';
    /* The page's own hint already says "ranked by fit, pick one"; this line
       carries only what the numbers say. When nothing met the ask, the
       count is the size of the pool, not a claim that any of them fit:
       #noMatch says what these actually are. */
    box.textContent = (noMatch
      ? 'Nothing fits your ask exactly. These are the closest fits we have, wherever they are; the three best are named. '
      : (n === 1 ? 'One ' + siteNoun() + ' can take this, by name. '
                 : 'The ' + words(k) + ' ' + siteNounPlural() + ' that fit best, by name. ')) + more;
    box.textContent = box.textContent.trim();
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
      ? 'No exact match yet. These are the closest fits we have; ' +
        'pick one you would still like to meet, or tell the desk and we will route it by hand.'
      : 'No ' + esc(siteNounPlural()) + ' are listed on the ' + esc(hubName()) +
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

  function cardHtml(card, position, best) {
    const id = String(card.listing_id);
    const rows = [];

    /* "3× EOS P396, 600 a month": the count, the machine, and its monthly
       capacity when the worker sends one (decision 14, plan 055). Machines
       are separated by a dot, as a machine line can carry a comma itself. */
    const machines = (card.machines || []).map((m) => {
      const count = m.count == null ? 1 : Number(m.count);
      const name = (count > 1 ? count + '× ' : '') + String(m.name || '');
      if (!name) return '';
      const cap = m.monthly_capacity == null ? null : Number(m.monthly_capacity);
      return cap !== null && isFinite(cap) ? name + ', ' + cap + ' a month' : name;
    }).filter(Boolean);
    if (machines.length) rows.push(['Machines', machines.join(' · ')]);

    const mats = labelsFor(vocab && vocab.materials, card.materials);
    if (mats.length) rows.push(['Materials', mats.join(', ')]);

    if (card.min_lead_time_days != null) {
      rows.push(['Lead time', Number(card.min_lead_time_days) === 1
        ? '1 day' : Number(card.min_lead_time_days) + ' days']);
    }

    /* Every host prints or mills; the extras follow the base service (Will,
       6 Oct): "Print + Design/CAD, Finish", or just "Print". */
    const servs = labelsFor(vocab && vocab.services, card.services);
    const base = HUB === 'mill' ? 'Mill' : 'Print';
    rows.push(['Services', servs.length ? base + ' + ' + servs.join(', ') : base]);

    if (card.distance_km != null) rows.push(['Distance', '~' + card.distance_km + ' km']);

    const exactMatch = !card.no_match_flag;
    const who = siteNounTitle() + ' ' + position;
    const where = [card.town, card.country].filter(Boolean).join(', ');
    /* Plan 067: a named card (one of the three) leads with the company and
       carries the town beneath; a card without a name keeps its shape. Only
       a named card carries the tick. */
    const company = typeof card.company === 'string' && card.company.trim() ? card.company.trim() : '';
    const pickable = isNamed(id);
    const tick = 'Introduce me to this ' + siteNoun();

    /* The tick is a real label around a real checkbox, and the card is a
       plain div: a <label> cannot legally hold a heading or a list. The
       whole card is still clickable, forwarded in renderResults(). The
       accessible name opens with the visible words and then says which
       card it is, so four of them are not four identical ticks. */
    return '<div class="cap pick" data-card="' + esc(id) + '">' +
      '<span class="cap__head">' +
        '<b class="cap__num">' + esc(who) + '</b>' +
        (best ? '<span class="badge-best">Best fit for your request</span>' : '') +
        (card.verified ? '<span class="badge-verified">Verified</span>' : '') +
        (exactMatch ? '' : '<span class="badge-nomatch">no exact match</span>') +
      '</span>' +
      (company
        ? '<h3>' + esc(company) + '</h3>' +
          /* styled inline: the shared stylesheet is cached for four hours and
             this line is new with the names (the shared-asset cache rule) */
          '<p class="cap__where" style="margin:-10px 0 16px;font:400 13px/1.4 var(--font-body);color:var(--on-surface-var)">' +
          esc(where) + '</p>'
        : '<h3>' + esc(where) + '</h3>') +
      '<dl>' + rows.map((r) =>
        '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>').join('') + '</dl>' +
      (pickable
        ? '<label class="cap__tick">' +
          '<input type="checkbox" id="pick-' + esc(id) + '" data-pick="' + esc(id) + '" ' +
          'aria-label="' + esc(tick + ': ' + who + ', ' + (company || where)) + '">' +
          '<span>' + esc(tick) + '</span>' +
          '</label>'
        : '') +
      '</div>';
  }

  /* One site (plan 052, item 24): ticking a second card moves the pick to
     it rather than refusing, so the ticks behave as a choice of one. */
  function onPickChange(e) {
    const id = e.target.getAttribute('data-pick');
    if (e.target.checked) {
      picks = picks.concat([id]).filter((p, i, a) => a.indexOf(p) === i).slice(-MAX_PICKS);
      const grid = el('capGrid');
      if (grid) grid.querySelectorAll('input[data-pick]').forEach((box) => {
        if (picks.indexOf(box.getAttribute('data-pick')) === -1) box.checked = false;
      });
    } else {
      picks = picks.filter((p) => p !== id);
    }
    updatePickState();
  }

  /* One place decides what the pick looks like: the cards, the map's pins
     and the bar. */
  function updatePickState() {
    const grid = el('capGrid');
    if (grid) {
      grid.querySelectorAll('input[data-pick]').forEach((box) => {
        const lab = box.closest('.pick');
        if (lab) {
          lab.classList.toggle('is-on', box.checked);
          lab.classList.toggle('is-off', false);
        }
      });
    }
    if (matchMap) matchMap.select(picks[0] || null);
    const hint = el('pickHint');
    if (hint) { hint.textContent = ''; hint.hidden = true; }
    const bar = el('pickBar');
    if (bar) {
      bar.hidden = picks.length === 0;
      const count = el('pickCount');
      if (count) {
        const i = picks.length ? matches.findIndex((c) => String(c.listing_id) === picks[0]) : -1;
        count.textContent = i === -1 ? 'Nothing picked' : siteNounTitle() + ' ' + (i + 1) + ' picked';
      }
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
    scrollTo('step3');
  }

  /* The site picked, by name (plan 067): the terms were accepted at the
     search, so this step only says where the request goes. */
  function pickedCard() {
    if (!picks.length) return null;
    const i = matches.findIndex((c) => String(c.listing_id) === picks[0]);
    return i === -1 ? null : { card: matches[i], position: i + 1 };
  }
  function pickedName() {
    const p = pickedCard();
    if (!p) return '';
    const company = typeof p.card.company === 'string' ? p.card.company.trim() : '';
    return company || (siteNounTitle() + ' ' + p.position);
  }

  function renderPickSummary() {
    const box = el('pickSummary');
    if (!box) return;
    const p = pickedCard();
    if (!p) { box.innerHTML = ''; return; }
    const where = [p.card.town, p.card.country].filter(Boolean).join(', ');
    const company = typeof p.card.company === 'string' ? p.card.company.trim() : '';
    const line = 'The ' + siteNoun() + ' you picked: ' + siteNounTitle() + ' ' + p.position +
      (company ? ', ' + company : '') + (where ? ', ' + where : '') + '.';
    box.innerHTML =
      '<p class="body">' + esc(line) + '</p>' +
      '<p class="np-hint">Your request goes straight to this ' + esc(siteNoun()) +
      '. Contact details are exchanged once it accepts.</p>';
    const btn = el('requestSubmit');
    if (btn) btn.textContent = 'Send my request to ' + pickedName();
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
      showRequestError('Pick a ' + siteNoun() + ' before you send this.');
      return;
    }
    if (!searchId) {
      showRequestError('Run the search again.');
      return;
    }

    const A = window.NPAccount;
    if (!A) { showRequestError(requestErrorText({ error: 'network' })); return; }

    /* A lapsed session signs in over the page and then sends (Q5). */
    A.requireConfirmed(() => send(spec, searchId, picks[0], false));
  }

  /* One call, against the values it was handed rather than a re-read of
     the page: a refresh mid-flight can rebuild the panel and what the
     seeker chose must not depend on what is still on screen. The client
     key rides with it, so a retry after a timeout that landed the row is
     answered with that row rather than filing twice. */
  async function send(theSpec, theSearchId, theListingId, retried) {
    const btn = el('requestSubmit');
    const orig = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
    sending = true;
    const d = await postJson('/seeker-requests', {
      search_id: theSearchId, listing_id: theListingId, client_key: clientKeyFor(theSpec),
    });
    sending = false;

    if (d && d.ok) { renderSuccess(d); return d; }
    if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = orig; }
    showRequestError(requestErrorText(d), pickErrorFocus(d));
    return d;
  }

  /* Plan 037: one client key per ask. A retry after a timeout that landed
     the row is answered with that row (the worker reads the key back)
     instead of filing a second request and sending a second pair of emails.
     The key lives on the ask object, not in storage: a stored key that
     outlived its ask would replay the wrong request. */
  let keyedSpec = null;
  let clientKey = null;
  function clientKeyFor(s) {
    if (keyedSpec !== s || !clientKey) {
      keyedSpec = s;
      clientKey = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
        : 'k-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    }
    return clientKey;
  }

  /* The search body the worker takes (plan 067): the whole ask. `materials`
     carries every material named and `material` the first; `quantity_unit`
     and the rest are recorded on the search and copied onto the request at
     the pick. The terms version is added by runSearch. */
  function bodyFor(s) {
    return {
      hub: s.hub, material: s.material, materials: s.materials, process: s.process,
      quantity: s.quantity, quantity_unit: s.quantity_unit, cadence: s.cadence,
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
    if (e === 'listing_id required') return 'Pick a ' + site + ' before you send this.';
    if (e === 'listing_not_named') return 'Pick one of the three named ' + siteNounPlural() + ', or search again.';
    if (e === 'not your search' || e === 'search_id required') return 'Run the search again.';
    if (e === 'request_already_made') {
      return 'Your request for this search is already in; search again to ask another ' + site + '.';
    }
    if (e === 'listing_not_live') {
      return 'The ' + site + ' you picked is no longer on the hub. Run the search again and pick from the new list.';
    }
    if (e === 'own_listing') {
      return 'That is your own ' + site + ', so we cannot introduce you to it. Pick another ' + site + ' and send again.';
    }
    if (e === 'request_not_open') {
      return 'This request is no longer open. Tell the desk and we will pick it up by hand.';
    }
    if (e === 'organisation required') {
      return 'Your account is not attached to a company yet. Email hello@nexpoint.co.uk and we will sort it out.';
    }
    if (e === 'sign in required' || e === 'email_unconfirmed') return 'Sign in and send this again.';
    if (e === 'http_404' || e === 'not found') {
      return 'Requests are not switched on here just yet. Tell the desk what you need and we will route it by hand.';
    }
    if (typeof e === 'string' && e) {
      return e.charAt(0).toUpperCase() + e.slice(1).replace(/_/g, ' ') + '.';
    }
    return 'That did not send. Try again, or email hello@nexpoint.co.uk.';
  }

  /* The request went straight to the site (D8): the card says so, by name,
     and `offer_sent` false means the engine sends the offer at 06:15. */
  function renderSuccess(d) {
    const box = el('step3Body');
    if (!box) return;
    const name = pickedName() || ('the ' + siteNoun() + ' you picked');
    const sent = !(d && d.offer_sent === false);
    const line = sent
      ? 'Sent. Your request has gone to ' + name + ', who have 14 days to answer. We tell you as soon as they do.'
      : 'Sent. Your request goes to ' + name + ' shortly; they then have 14 days to answer.';
    box.innerHTML =
      '<div class="success">' +
      '<div class="ok"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M4 12l6 6L20 6"/></svg></div>' +
      '<h2>Thank you.</h2>' +
      '<p>' + esc(line) + ' You can follow it on your account.</p>' +
      '<div class="modal-actions" style="justify-content:center">' +
      '<a class="btn btn-outline" href="' + esc(accountUrl()) + '">Go to your account</a></div>' +
      '</div>';
    const bar = el('pickBar');
    if (bar) bar.hidden = true;
    scrollTo('step3');
  }

  const TERMS_MOVED = 'The introduction terms have been updated. Read them again and tick to accept.';

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
    const accept = el('searchAccept');
    if (accept) accept.addEventListener('click', onSearchAccept);
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
    renderForm();
    syncConditionalFields();
  }

  window.NPFind = { init: init, errorText: requestErrorText };
})();


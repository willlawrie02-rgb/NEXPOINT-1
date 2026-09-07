/* NexPoint Global Hub - the per-site listing form (spec 2026-09-03).
   The offer page's own module. One listing per site per hub: an address,
   the regions it ships to, services, quality notes, optional capacity, and
   an unlimited list of machines. Nothing a host writes goes live on its
   own; every submission is a pending revision an admin approves, so the
   page has five faces (signed out, unconfirmed, none, pending, live) and a
   sixth for a declined one.

   Started by portal.js's np:modules boot, like every other page module.

   Degrading: when GET /listings/mine answers 404 the marketplace routes are
   not deployed on this worker yet, and the page falls back to the host
   application form it replaced (renderLegacy below), so the offer page keeps
   working through the deploy window.                                       */
(function () {
  'use strict';

  const HUB = document.body.dataset.hub === 'mill' ? 'mill' : 'print';

  /* Local, not borrowed: this module renders before anything guarantees the
     shared portal finished loading, and every value below comes from an API. */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const API_BASE = /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
    ? 'http://localhost:8787' : 'https://api.nexpoint.co.uk';
  const ACCOUNT_URL = 'https://nexpoint.co.uk/hub/account/';

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

  /* The hub's own words. machineNoun comes from portal.js's HUB_CONFIG so
     there is one place a hub is named; the fallback is only for a page that
     somehow loads this module without the shared one. */
  const NOUN = { print: 'printer', mill: 'milling cell' };
  function machineNoun() {
    const c = (window.NP && NP.config && NP.config()) || null;
    return (c && c.machineNoun) || NOUN[HUB];
  }
  function machineNounTitle() {
    const n = machineNoun();
    return n.charAt(0).toUpperCase() + n.slice(1);
  }
  function machineNounPlural() { return machineNoun() + 's'; }

  /* ── countries and the region each one sits in ────────────────────────
     The country list is portal.js's own REGIONS map flattened, so the offer
     page and the find page offer the same words; free text is allowed, so a
     country nobody has needed yet is still typeable. The region map exists
     for one convenience only ("Own country only") and mirrors the worker's
     regionForCountry table term for term. A country it does not know leaves
     the choice to the host, which is the honest outcome. */
  const FALLBACK_COUNTRIES = [
    'United Kingdom', 'Ireland', 'United States', 'Canada', 'Australia', 'New Zealand',
    'Germany', 'France', 'Netherlands', 'Spain', 'Italy', 'Poland',
  ];
  function countryOptions() {
    let map = null;
    try { map = REGIONS; } catch (e) { map = null; }
    if (!map || typeof map !== 'object') return FALLBACK_COUNTRIES.slice();
    const out = [];
    Object.keys(map).forEach((k) => {
      (map[k] || []).forEach((c) => { if (out.indexOf(c) === -1) out.push(c); });
    });
    return out.length ? out.sort() : FALLBACK_COUNTRIES.slice();
  }

  const COUNTRY_REGION = {
    'united kingdom': 'uk', uk: 'uk', 'great britain': 'uk', england: 'uk',
    scotland: 'uk', wales: 'uk', 'northern ireland': 'uk',
    ireland: 'ireland', 'republic of ireland': 'ireland',
    austria: 'europe', belgium: 'europe', bulgaria: 'europe', croatia: 'europe',
    cyprus: 'europe', czechia: 'europe', 'czech republic': 'europe', denmark: 'europe',
    estonia: 'europe', finland: 'europe', france: 'europe', germany: 'europe',
    greece: 'europe', hungary: 'europe', iceland: 'europe', italy: 'europe',
    latvia: 'europe', liechtenstein: 'europe', lithuania: 'europe', luxembourg: 'europe',
    malta: 'europe', netherlands: 'europe', 'the netherlands': 'europe', norway: 'europe',
    poland: 'europe', portugal: 'europe', romania: 'europe', slovakia: 'europe',
    slovenia: 'europe', spain: 'europe', sweden: 'europe', switzerland: 'europe',
    'united states': 'north_america', 'united states of america': 'north_america',
    usa: 'north_america', canada: 'north_america', mexico: 'north_america',
    brazil: 'south_america', argentina: 'south_america', chile: 'south_america',
    colombia: 'south_america',
    'united arab emirates': 'middle_east', uae: 'middle_east',
    'saudi arabia': 'middle_east', israel: 'middle_east', turkey: 'middle_east',
    'south africa': 'africa', egypt: 'africa', nigeria: 'africa', kenya: 'africa',
    india: 'asia', china: 'asia', japan: 'asia', 'south korea': 'asia',
    korea: 'asia', singapore: 'asia',
    australia: 'oceania', 'new zealand': 'oceania',
  };
  function regionForCountry(country) {
    const k = String(country == null ? '' : country).trim().toLowerCase().replace(/\s+/g, ' ');
    return k ? (COUNTRY_REGION[k] || null) : null;
  }

  /* ── page state ───────────────────────────────────────────────────── */
  let vocab = null;        /* NPVocab.load(HUB) result */
  let hostTerms = null;    /* {id, version, body_md} or null */
  let mine = null;         /* the last GET /listings/mine body */
  let termsRequired = false;
  const TA = {};           /* type-ahead handles by input id */
  let rowSeq = 0;
  let bootQueued = false;
  /* A submit that has to refresh the account mid-flight fires
     npaccount:change, and a re-render at that moment would wipe the form the
     host is still looking at. The reload is held until the flight lands. */
  let submitting = false;
  let loadDeferred = false;

  /* Every render rebuilds the panel from scratch, so the type-ahead handles
     of the render before it are handles on detached inputs. Clearing them
     with the row counter keeps the ids in the brief's shape: the first
     machine row of any render is m-1. */
  function resetPanelState() {
    Object.keys(TA).forEach((k) => { delete TA[k]; });
    rowSeq = 0;
  }

  function body() { return document.getElementById('hostAppBody'); }
  function el(id) { return document.getElementById(id); }
  function val(id) { const e = el(id); return e ? e.value.trim() : ''; }

  function markdownLite(md) {
    const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
    let html = '', inList = false;
    const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
    const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>');
    lines.forEach((raw) => {
      const line = raw.trim();
      if (!line) { closeList(); return; }
      const h = /^(#{1,4})\s+(.*)$/.exec(line);
      if (h) { closeList(); const lvl = Math.min(h[1].length + 2, 6); html += '<h' + lvl + '>' + inline(h[2]) + '</h' + lvl + '>'; return; }
      const li = /^[-*]\s+(.*)$/.exec(line);
      if (li) { if (!inList) { html += '<ul>'; inList = true; } html += '<li>' + inline(li[1]) + '</li>'; return; }
      closeList();
      html += '<p>' + inline(line) + '</p>';
    });
    closeList();
    return html;
  }

  function termLabel(list, term) {
    if (window.NPVocab && NPVocab.label) return NPVocab.label(list, term);
    const hit = (list || []).find((o) => o.term === term);
    return hit ? hit.label : String(term == null ? '' : term);
  }

  /* ══════════════ the states that are not a form ══════════════ */

  function renderSignedOut() {
    body().innerHTML =
      '<p class="body">Sign in or create your hub account to list your site. Chris or Will checks every listing personally, and nothing is listed until we have approved it.</p>' +
      '<div class="modal-actions">' +
      '<button class="btn btn-primary" type="button" data-l-signin>Sign in</button>' +
      '<button class="btn btn-outline" type="button" data-l-join>Create your hub account</button>' +
      '</div>';
    body().querySelector('[data-l-signin]').addEventListener('click', () => {
      if (typeof openSignIn === 'function') openSignIn();
    });
    body().querySelector('[data-l-join]').addEventListener('click', () => {
      if (window.NPAccount) NPAccount.openQuestionnaire({});
    });
  }

  function renderUnconfirmed() {
    const email = (window.NPAccount && NPAccount.user && NPAccount.user.email) || '';
    body().innerHTML =
      '<p class="body">Confirm your email first. We sent a link to <strong>' + esc(email) + '</strong>. ' +
      'Open it and you can list your site straight away.</p>' +
      '<div class="modal-actions">' +
      '<button class="btn btn-primary" type="button" data-l-recheck>I have confirmed, refresh</button>' +
      '<button class="btn btn-outline" type="button" data-l-resend>Resend the email</button>' +
      '</div>' +
      '<p class="np-sign-error" data-l-msg style="display:none"></p>';
    body().querySelector('[data-l-recheck]').addEventListener('click', async (e) => {
      const btn = e.target; const orig = btn.textContent;
      btn.disabled = true; btn.textContent = 'Checking…';
      if (window.NPAccount) await NPAccount.refresh();
      if (window.NPAccount && NPAccount.confirmed()) { load(); return; }
      btn.disabled = false; btn.textContent = orig;
      const msg = body().querySelector('[data-l-msg]');
      if (msg) { msg.style.display = 'block'; msg.textContent = 'Not confirmed yet. Open the link in the email, then try again.'; }
    });
    body().querySelector('[data-l-resend]').addEventListener('click', async (e) => {
      const btn = e.target;
      if (btn.disabled) return;
      btn.disabled = true; btn.textContent = 'Sending…';
      if (window.NPAccount) await NPAccount.resendConfirmation(email);
      btn.textContent = 'Sent, check your inbox';
    });
  }

  function renderLoadFailed() {
    body().innerHTML =
      '<p class="body">We could not load your listing just now. Refresh the page and try again, or email ' +
      '<a href="mailto:hello@nexpoint.co.uk">hello@nexpoint.co.uk</a>.</p>';
  }

  function renderDeclined(d) {
    const rev = (d && (d.pending || d.live)) || null;
    const accepted = (d && d.host_terms_accepted_version_id) || null;
    body().innerHTML =
      '<p class="body">This listing was not approved this time. Email ' +
      '<a href="mailto:hello@nexpoint.co.uk">hello@nexpoint.co.uk</a> if anything has changed and we will talk it through.</p>' +
      '<div class="modal-actions"><button class="btn btn-outline" type="button" id="listingDeclinedEdit">Edit and resubmit</button></div>';
    const btn = el('listingDeclinedEdit');
    if (btn) btn.addEventListener('click', () => {
      renderForm({ live: null, prefill: rev, host_terms_accepted_version_id: accepted });
    });
  }

  function renderSuccess() {
    body().innerHTML =
      '<div class="success">' +
      '<div class="ok"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M4 12l6 6L20 6"/></svg></div>' +
      '<h2>Thank you.</h2>' +
      '<p>Received. Nothing is listed until we have checked it; you will get an email when it is live.</p>' +
      '<div class="modal-actions" style="justify-content:center">' +
      '<a class="btn btn-outline" href="' + ACCOUNT_URL + '">Go to your account</a></div>' +
      '</div>';
  }

  /* ══════════════ the read-only render ══════════════
     A revision under review is shown as words, not as inputs somebody cannot
     use: a disabled form reads as broken, a summary reads as a record. */

  function machineSummary(m) {
    const mats = (m.materials || []).map((t) => termLabel(vocab && vocab.materials, t));
    const attrs = Object.assign({}, m.attributes || {});
    const proc = attrs.process; delete attrs.process;
    const bits = [];
    if (mats.length) bits.push(mats.join(', '));
    if (proc) bits.push(termLabel(vocab && vocab.processes, proc));
    if (m.count != null && Number(m.count) > 1) bits.push(String(m.count) + ' units');
    if (m.lead_time_days != null) bits.push(String(m.lead_time_days) + ' day lead time');
    const extra = Object.keys(attrs)
      .map((k) => attrLabel('machine', k) + ': ' + attrValueText(attrs[k]))
      .filter(Boolean);
    return '<div class="lmach"><b>' + esc(m.name || '') + '</b>' +
      (bits.length ? '<br>' + esc(bits.join(' · ')) : '') +
      (extra.length ? '<br>' + esc(extra.join(' · ')) : '') +
      (m.notes ? '<br>' + esc(m.notes) : '') + '</div>';
  }

  function attrLabel(appliesTo, key) {
    const defs = (vocab && vocab.attributes && vocab.attributes[appliesTo]) || [];
    const hit = defs.find((d) => d.key === key);
    return hit ? hit.label : key;
  }
  function attrValueText(v) {
    if (Array.isArray(v)) return v.join(', ');
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    return String(v == null ? '' : v);
  }

  function revisionSummary(rev) {
    if (!rev) return '';
    const rows = [];
    const address = [rev.address_line, rev.town, rev.postcode, rev.country].filter(Boolean).join(', ');
    if (address) rows.push(['Address', address]);
    const ships = (rev.ships_to || []).map((t) => termLabel(vocab && vocab.regions, t));
    if (ships.length) rows.push(['Ships to', ships.join(', ')]);
    const services = (rev.services || []).map((t) => termLabel(vocab && vocab.services, t));
    if (services.length) rows.push(['Services', services.join(', ')]);
    if (rev.monthly_capacity != null) rows.push(['Monthly capacity', String(rev.monthly_capacity) + ' pairs']);
    if (rev.quality_notes) rows.push(['Quality systems', rev.quality_notes]);
    Object.keys(rev.attributes || {}).forEach((k) => {
      const text = attrValueText(rev.attributes[k]);
      if (text) rows.push([attrLabel('listing', k), text]);
    });
    const machines = (rev.machines || []).map(machineSummary).join('');
    return '<dl class="lread">' +
      rows.map((r) => '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>').join('') +
      '</dl>' +
      (machines ? '<div class="lsec" style="margin-top:16px"><div class="lsec__h">' +
        esc(machineNounPlural()) + '</div>' + machines + '</div>' : '');
  }

  function renderPending(d) {
    const liveBlock = d.live
      ? '<div class="lsec"><div class="lsec__h">Live now</div>' + revisionSummary(d.live) + '</div>'
      : '';
    body().innerHTML =
      '<div class="notice-warn notice-warn--block" id="listingLockNotice">' +
      '<span>Under review. Chris or Will checks every listing personally; you can edit again once it is approved.</span>' +
      '</div>' +
      liveBlock +
      '<div class="lsec"><div class="lsec__h">' +
      (d.live ? 'Waiting for review' : 'What you sent us') + '</div>' +
      revisionSummary(d.pending) + '</div>';
  }

  /* ══════════════ the form ══════════════ */

  function fieldsFor(defs, idFor) {
    return defs.map((def) => {
      const id = idFor(def.key);
      const hint = def.hint ? '<span class="np-hint">' + esc(def.hint) + '</span>' : '';
      const label = '<label for="' + esc(id) + '">' + esc(def.label) +
        (def.required ? '' : ' (optional)') + hint + '</label>';
      if (def.type === 'boolean') {
        return '<div class="field full"><label class="np-terms-tick" for="' + esc(id) + '">' +
          '<input type="checkbox" id="' + esc(id) + '"> ' + esc(def.label) + '</label></div>';
      }
      if (def.type === 'select') {
        const opts = ['<option value=""></option>'].concat(
          (def.options || []).map((o) => '<option value="' + esc(o) + '">' + esc(o) + '</option>'));
        return '<div class="field full">' + label + '<select id="' + esc(id) + '">' + opts.join('') + '</select></div>';
      }
      if (def.type === 'number') {
        return '<div class="field full">' + label + '<input id="' + esc(id) + '" type="number" step="1" inputmode="numeric"></div>';
      }
      /* text and multiselect both take an input; multiselect gets a type-ahead */
      return '<div class="field full">' + label + '<input id="' + esc(id) + '"' +
        (def.type === 'multiselect' ? ' placeholder="Type and press Enter"' : '') + '></div>';
    }).join('');
  }

  function wireAttrFields(defs, idFor, values) {
    defs.forEach((def) => {
      const id = idFor(def.key);
      const node = el(id);
      if (!node) return;
      const v = values ? values[def.key] : undefined;
      if (def.type === 'multiselect') {
        TA[id] = NPTypeahead.attach(node, {
          options: (def.options || []).map((o) => ({ term: o, label: o })),
          multi: true, allowFree: !def.options,
          value: Array.isArray(v) ? v.map((o) => ({ term: o, label: o })) : [],
        });
        return;
      }
      if (def.type === 'boolean') { node.checked = !!v; return; }
      if (v != null) node.value = String(v);
    });
  }

  function readAttrFields(defs, idFor) {
    const out = {};
    defs.forEach((def) => {
      const id = idFor(def.key);
      const node = el(id);
      if (!node) return;
      if (def.type === 'multiselect') {
        const list = TA[id] ? TA[id].value() : [];
        if (list && list.length) out[def.key] = list;
        return;
      }
      if (def.type === 'boolean') { if (node.checked) out[def.key] = true; return; }
      const raw = node.value.trim();
      if (!raw) return;
      if (def.type === 'number') {
        const n = Number(raw);
        if (Number.isFinite(n)) out[def.key] = n;
        return;
      }
      out[def.key] = raw;
    });
    return out;
  }

  function pickChip(name, term, label, on) {
    return '<label class="pick' + (on ? ' is-on' : '') + '">' +
      '<input type="checkbox" data-' + name + '="' + esc(term) + '"' + (on ? ' checked' : '') + '>' +
      '<span>' + esc(label) + '</span></label>';
  }

  function machineRowHtml(n, m) {
    const defs = (vocab && vocab.attributes && vocab.attributes.machine) || [];
    return '<div class="mrow" data-mrow="' + n + '">' +
      '<button class="mrow__rm" type="button" id="m-' + n + '-remove">Remove</button>' +
      '<div class="field full"><label for="m-' + n + '-machine">' + esc(machineNounTitle()) + '</label>' +
      '<input id="m-' + n + '-machine" placeholder="Make and model"></div>' +
      '<div class="field full"><label for="m-' + n + '-materials">Materials</label>' +
      '<input id="m-' + n + '-materials" placeholder="Type and press Enter"></div>' +
      '<div class="field full"><label for="m-' + n + '-process">Process (optional)</label>' +
      '<input id="m-' + n + '-process" placeholder="Type and press Enter"></div>' +
      '<div class="field"><label for="m-' + n + '-count">How many</label>' +
      '<input id="m-' + n + '-count" type="number" min="1" step="1" inputmode="numeric" value="' +
      esc(m && m.count != null ? String(m.count) : '1') + '"></div>' +
      '<div class="field"><label for="m-' + n + '-lead">Lead time to shipping (days)</label>' +
      '<input id="m-' + n + '-lead" type="number" min="0" step="1" inputmode="numeric" value="' +
      esc(m && m.lead_time_days != null ? String(m.lead_time_days) : '') + '"></div>' +
      '<div class="field full"><label for="m-' + n + '-notes">Notes (optional)</label>' +
      '<input id="m-' + n + '-notes" value="' + esc((m && m.notes) || '') + '"></div>' +
      fieldsFor(defs, (k) => 'm-' + n + '-attr-' + k) +
      '</div>';
  }

  function addMachineRow(m, focusIt) {
    const n = ++rowSeq;
    const host = el('machineRows');
    if (!host) return;
    host.insertAdjacentHTML('beforeend', machineRowHtml(n, m));
    const defs = (vocab && vocab.attributes && vocab.attributes.machine) || [];
    const attrs = Object.assign({}, (m && m.attributes) || {});
    const proc = attrs.process; delete attrs.process;

    TA['m-' + n + '-machine'] = NPTypeahead.attach(el('m-' + n + '-machine'), {
      options: (vocab && vocab.machines) || [], allowFree: true,
      value: m && m.name ? [{ term: m.name, label: m.name }] : [],
    });
    TA['m-' + n + '-materials'] = NPTypeahead.attach(el('m-' + n + '-materials'), {
      options: (vocab && vocab.materials) || [], multi: true, allowFree: true,
      value: (m && m.materials ? m.materials : []).map((t) => ({ term: t, label: termLabel(vocab && vocab.materials, t) })),
    });
    TA['m-' + n + '-process'] = NPTypeahead.attach(el('m-' + n + '-process'), {
      options: (vocab && vocab.processes) || [], allowFree: true,
      value: proc ? [{ term: proc, label: termLabel(vocab && vocab.processes, proc) }] : [],
    });
    wireAttrFields(defs, (k) => 'm-' + n + '-attr-' + k, attrs);

    el('m-' + n + '-remove').addEventListener('click', () => removeMachineRow(n));
    updateRemoveButtons();
    if (focusIt) el('m-' + n + '-machine').focus();
  }

  function removeMachineRow(n) {
    const row = document.querySelector('[data-mrow="' + n + '"]');
    if (!row) return;
    const rows = document.querySelectorAll('#machineRows .mrow');
    if (rows.length <= 1) return;
    row.remove();
    updateRemoveButtons();
    const add = el('addMachineRow');
    if (add) add.focus();
  }

  /* One row is the minimum a listing can carry, so the last Remove is hidden
     rather than offered and then refused. */
  function updateRemoveButtons() {
    const rows = document.querySelectorAll('#machineRows .mrow');
    rows.forEach((row) => {
      const btn = row.querySelector('.mrow__rm');
      if (!btn) return;
      btn.hidden = rows.length <= 1;
      const nameInput = row.querySelector('input[id$="-machine"]');
      const named = nameInput && nameInput.value.trim();
      btn.setAttribute('aria-label', named ? 'Remove ' + named : 'Remove this ' + machineNoun());
    });
  }

  function renderForm(d) {
    const u = (window.NPAccount && NPAccount.user) || {};
    const live = d.live || null;
    /* `rev` is what the fields are filled from: the live revision when
       editing one, or (from renderDeclined) the declined revision the host
       is resubmitting. `editing` stays bound to a true live listing, not to
       whether there is anything to prefill from, so a declined resubmission
       still reads and submits as a first listing. */
    const rev = live || d.prefill || null;
    /* Assume the tick is needed until GET /terms/current says otherwise: a
       submit that lands before that call resolves must be stopped by this
       form, not by a 422 from the worker. */
    hostTerms = null;
    termsRequired = !d.host_terms_accepted_version_id;
    const editing = !!live;
    const listingDefs = (vocab && vocab.attributes && vocab.attributes.listing) || [];
    const regions = (vocab && vocab.regions) || [];
    const services = (vocab && vocab.services) || [];

    const chosenRegions = (rev && rev.ships_to) || [];
    const chosenServices = (rev && rev.services) || [];
    const serviceTerms = services.map((s) => s.term);
    const extraServices = chosenServices.filter((t) => serviceTerms.indexOf(t) === -1);
    const regionTerms = regions.map((r) => r.term);
    const extraRegions = chosenRegions.filter((t) => regionTerms.indexOf(t) === -1);

    body().innerHTML =
      '<p class="body" style="margin-bottom:20px">Listing <strong>' + esc(u.company || 'your site') + '</strong>' +
      (u.email ? ' (' + esc(u.email) + ')' : '') + '. ' +
      (editing
        ? 'Your listing is live. Any change is reviewed before it replaces what is showing.'
        : 'Chris or Will checks every listing personally; nothing appears until we have approved it.') +
      '</p>' +
      '<form id="listingForm" novalidate>' +

      '<div class="lsec"><div class="lsec__h">Your site</div><div class="form-grid">' +
      '<div class="field full"><label for="siteName">Site name' +
      '<span class="np-hint">Taken from your hub account.</span></label>' +
      '<p class="body" id="siteName" style="margin:0">' + esc(u.company || 'Your site') + '</p></div>' +
      '<div class="field full"><label for="siteAddress1">Address</label>' +
      '<input id="siteAddress1" value="' + esc((rev && rev.address_line) || '') + '"></div>' +
      '<div class="field full"><label for="siteAddress2">Address line 2 (optional)</label>' +
      '<input id="siteAddress2"></div>' +
      '<div class="field"><label for="siteTown">Town or city</label>' +
      '<input id="siteTown" value="' + esc((rev && rev.town) || u.town || '') + '"></div>' +
      '<div class="field"><label for="sitePostcode">Postcode (optional)</label>' +
      '<input id="sitePostcode" value="' + esc((rev && rev.postcode) || '') + '"></div>' +
      '<div class="field full"><label for="siteCountry">Country</label>' +
      '<input id="siteCountry" placeholder="Start typing"></div>' +
      '</div></div>' +

      '<div class="lsec"><div class="lsec__h">Where you ship</div>' +
      '<div class="lgroup" id="shipsTo" role="group" aria-label="Where you ship">' +
      regions.map((r) => pickChip('region', r.term, r.label, chosenRegions.indexOf(r.term) !== -1)).join('') +
      extraRegions.map((t) => pickChip('region', t, termLabel(regions, t), true)).join('') +
      '<button class="pick" type="button" id="shipsToOwn">Own country only</button>' +
      '</div></div>' +

      '<div class="lsec"><div class="lsec__h">Services you offer</div>' +
      '<div class="lgroup" id="services" role="group" aria-label="Services you offer">' +
      services.map((s) => pickChip('service', s.term, s.label, chosenServices.indexOf(s.term) !== -1)).join('') +
      extraServices.map((t) => pickChip('service', t, termLabel(services, t), true)).join('') +
      '</div>' +
      '<div class="field" style="margin-top:14px"><label for="servicesAdd">Add a service we have not listed</label>' +
      '<input id="servicesAdd" placeholder="Type and press Enter"></div></div>' +

      '<div class="lsec"><div class="lsec__h">' + esc(machineNounPlural()) + '</div>' +
      '<div id="machineRows"></div>' +
      '<button class="btn btn-outline" type="button" id="addMachineRow">Add another ' + esc(machineNoun()) + '</button>' +
      '</div>' +

      '<div class="lsec" id="listingAttrs"' + (listingDefs.length ? '' : ' hidden') + '>' +
      '<div class="lsec__h">About your site</div>' +
      '<div class="form-grid">' + fieldsFor(listingDefs, (k) => 'attr-' + k) + '</div></div>' +

      '<div class="lsec"><div class="lsec__h">Quality and capacity</div><div class="form-grid">' +
      '<div class="field full"><label for="qualityNotes">Quality systems and standards' +
      '<span class="np-hint">How you inspect, calibrate and package. Written for Chris and Will, not published.</span></label>' +
      '<textarea id="qualityNotes">' + esc((rev && rev.quality_notes) || '') + '</textarea></div>' +
      '<div class="field"><label for="monthlyCapacity">Monthly capacity (pairs), optional</label>' +
      '<input id="monthlyCapacity" type="number" min="0" step="1" inputmode="numeric" value="' +
      esc(rev && rev.monthly_capacity != null ? String(rev.monthly_capacity) : '') + '"></div>' +
      '</div></div>' +

      '<div id="hostTermsBlock" style="margin-top:20px"></div>' +
      '<p class="np-sign-error" id="listingErr" style="display:none"></p>' +
      '<div class="modal-actions"><button class="btn btn-primary" type="submit" id="listingSubmit">' +
      (editing ? 'Submit changes for review' : 'Submit your listing for review') + '</button></div>' +
      '</form>';

    TA.siteCountry = NPTypeahead.attach(el('siteCountry'), {
      options: countryOptions(), allowFree: true,
      value: (rev && rev.country) || u.country || '',
    });
    TA.servicesAdd = NPTypeahead.attach(el('servicesAdd'), {
      options: services, allowFree: true,
      onChange: (v, chosen) => {
        if (!chosen.length) return;
        addServiceChip(chosen[0].term, chosen[0].label);
        TA.servicesAdd.clear();
      },
    });
    wireAttrFields(listingDefs, (k) => 'attr-' + k, (rev && rev.attributes) || {});

    /* chips toggle their own class; one delegated listener per group */
    ['shipsTo', 'services'].forEach((groupId) => {
      const group = el(groupId);
      if (!group) return;
      group.addEventListener('change', (e) => {
        const box = e.target;
        if (!box || box.type !== 'checkbox') return;
        const label = box.closest('.pick');
        if (label) label.classList.toggle('is-on', box.checked);
      });
    });

    el('shipsToOwn').addEventListener('click', ownCountryOnly);
    el('addMachineRow').addEventListener('click', () => addMachineRow(null, true));
    el('listingForm').addEventListener('submit', onSubmit);
    el('machineRows').addEventListener('input', updateRemoveButtons);

    const machines = (rev && rev.machines) || [];
    if (machines.length) machines.forEach((m) => addMachineRow(m, false));
    else addMachineRow(null, false);

    renderTermsBlock();
  }

  function addServiceChip(term, label) {
    const group = el('services');
    if (!group) return;
    const existing = group.querySelector('[data-service="' + String(term).replace(/"/g, '') + '"]');
    if (existing) {
      existing.checked = true;
      const lab = existing.closest('.pick');
      if (lab) lab.classList.add('is-on');
      return;
    }
    group.insertAdjacentHTML('beforeend', pickChip('service', term, label, true));
  }

  function ownCountryOnly() {
    const country = TA.siteCountry ? TA.siteCountry.value() : val('siteCountry');
    const region = regionForCountry(country);
    if (!region) {
      showError(country
        ? 'We do not know which region that country sits in. Tick the regions yourself.'
        : 'Tell us your country first, then we can tick the region for you.', 'siteCountry');
      return;
    }
    const group = el('shipsTo');
    if (!group) return;
    group.querySelectorAll('input[data-region]').forEach((box) => {
      box.checked = box.getAttribute('data-region') === region;
      const lab = box.closest('.pick');
      if (lab) lab.classList.toggle('is-on', box.checked);
    });
    clearError();
  }

  /* ── the Host Agreement ────────────────────────────────────────────
     Layer 2 of the three terms layers. Accepted once per site per hub: the
     tick appears on a first listing, or when the current version is not the
     one this site accepted. Otherwise the page just says which one applies. */
  async function renderTermsBlock() {
    const box = el('hostTermsBlock');
    if (!box) return;
    const accepted = mine ? mine.host_terms_accepted_version_id : null;
    box.innerHTML = '<p class="body" style="margin:0">Loading the Host Agreement…</p>';
    const d = await api('/terms/current?layer=host');
    if (!el('hostTermsBlock')) return;              /* the panel moved on */
    if (!d || d.error || !d.id) {
      hostTerms = null;
      if (accepted) {
        termsRequired = false;
        el('hostTermsBlock').innerHTML = '<p class="body" style="margin:0">Your Host Agreement still applies.</p>';
        return;
      }
      termsRequired = true;
      el('hostTermsBlock').innerHTML =
        '<p class="np-sign-error" style="display:block">We could not load the Host Agreement. ' +
        'Refresh and try again, or email hello@nexpoint.co.uk.</p>';
      return;
    }
    hostTerms = d;
    if (accepted && accepted === d.id) {
      termsRequired = false;
      el('hostTermsBlock').innerHTML = '<p class="body" style="margin:0">Your Host Agreement v' +
        esc(d.version) + ' still applies.</p>';
      return;
    }
    termsRequired = true;
    el('hostTermsBlock').innerHTML =
      '<div class="terms-scroll">' + markdownLite(d.body_md) + '</div>' +
      '<label class="np-terms-tick"><input type="checkbox" id="hostTick"> ' +
      'I accept the Host Agreement, version ' + esc(d.version) + '</label>';
  }

  /* ══════════════ validation and submit ══════════════ */

  function showError(message, focusId) {
    const err = el('listingErr');
    if (err) { err.style.display = 'block'; err.textContent = message; }
    let node = focusId ? el(focusId) : null;
    /* a group of chips is not focusable itself: take the reader to its first
       control rather than leaving the caret where it was */
    if (node && typeof node.focus !== 'function') node = node.querySelector('input, button, select, textarea');
    if (node && node.tagName === 'DIV') node = node.querySelector('input, button, select, textarea') || node;
    if (node) {
      if (node.scrollIntoView) node.scrollIntoView({ block: 'center' });
      node.focus();
    }
  }
  function clearError() {
    const err = el('listingErr');
    if (err) { err.style.display = 'none'; err.textContent = ''; }
  }

  function chosen(groupId, attr) {
    const group = el(groupId);
    if (!group) return [];
    return Array.prototype.slice.call(group.querySelectorAll('input[data-' + attr + ']:checked'))
      .map((box) => box.getAttribute('data-' + attr));
  }

  function wholeNumber(raw) {
    if (raw === '') return null;
    const n = Number(raw);
    return Number.isInteger(n) ? n : NaN;
  }

  /* One machine row read off the page. `empty` says the host started a row
     and left it, which is not an error; `missing` names the first control a
     complete row still needs. */
  function readRow(row) {
    const n = row.getAttribute('data-mrow');
    const defs = (vocab && vocab.attributes && vocab.attributes.machine) || [];
    /* The machine name is the one field the worker stores exactly as it is
       given (it is what an anonymised card shows), so this is the label the
       host picked, not the vocabulary term behind it. */
    const picked = TA['m-' + n + '-machine'] ? TA['m-' + n + '-machine'].chosen() : [];
    const name = picked.length ? picked[0].label : val('m-' + n + '-machine');
    const materials = TA['m-' + n + '-materials'] ? TA['m-' + n + '-materials'].value() : [];
    const process = TA['m-' + n + '-process'] ? TA['m-' + n + '-process'].value() : '';
    const notes = val('m-' + n + '-notes');
    const leadRaw = val('m-' + n + '-lead');
    const countRaw = val('m-' + n + '-count');
    const attributes = readAttrFields(defs, (k) => 'm-' + n + '-attr-' + k);

    const empty = !name && !materials.length && !process && !notes && leadRaw === '' &&
      !Object.keys(attributes).length;
    if (empty) return { empty: true };

    if (!name) return { missing: 'm-' + n + '-machine', why: 'Name the ' + machineNoun() + ' on every row you fill in.' };
    if (!materials.length) return { missing: 'm-' + n + '-materials', why: 'Add at least one material for ' + name + '.' };
    const lead = wholeNumber(leadRaw);
    if (lead === null || !Number.isFinite(lead) || lead < 0) {
      return { missing: 'm-' + n + '-lead', why: 'Give the lead time for ' + name + ' in whole days.' };
    }
    let count = wholeNumber(countRaw);
    if (count === null) count = 1;
    if (!Number.isFinite(count) || count < 1) {
      return { missing: 'm-' + n + '-count', why: 'How many of the ' + name + ' do you have? Whole numbers only.' };
    }

    return { machine: {
      name: name, materials: materials, count: count, lead_time_days: lead,
      notes: notes, attributes: Object.assign({}, attributes, process ? { process: process } : {}),
    } };
  }

  /* Builds the POST body, or returns {error, focus} for the first thing that
     is not ready. Client validation is short on purpose: the worker is the
     authority, and every message it sends back is shown as written. */
  function buildPayload() {
    const country = TA.siteCountry ? TA.siteCountry.value() : val('siteCountry');
    const town = val('siteTown');
    if (!town) return { error: 'Which town or city is the site in?', focus: 'siteTown' };
    if (!country) return { error: 'Which country is the site in?', focus: 'siteCountry' };

    const shipsTo = chosen('shipsTo', 'region');
    if (!shipsTo.length) return { error: 'Tick at least one region you ship to.', focus: 'shipsTo' };

    const machines = [];
    const rows = document.querySelectorAll('#machineRows .mrow');
    for (let i = 0; i < rows.length; i += 1) {
      const read = readRow(rows[i]);
      if (read.missing) return { error: read.why, focus: read.missing };
      if (read.machine) machines.push(read.machine);
    }
    if (!machines.length) {
      return { error: 'Add at least one ' + machineNoun() + ', with its materials and lead time.',
        focus: document.querySelector('#machineRows input[id$="-machine"]')
          ? document.querySelector('#machineRows input[id$="-machine"]').id : null };
    }

    if (termsRequired) {
      const tick = el('hostTick');
      if (!tick || !tick.checked) {
        return { error: 'Tick to confirm you accept the Host Agreement.', focus: 'hostTick' };
      }
    }

    const line1 = [val('siteAddress1'), val('siteAddress2')].filter(Boolean).join(', ');
    const capacity = wholeNumber(val('monthlyCapacity'));
    if (capacity !== null && (!Number.isFinite(capacity) || capacity < 0)) {
      return { error: 'Monthly capacity is a whole number of pairs, or leave it blank.', focus: 'monthlyCapacity' };
    }
    const listingDefs = (vocab && vocab.attributes && vocab.attributes.listing) || [];

    const payload = {
      hub: HUB,
      address: { line1: line1, town: town, postcode: val('sitePostcode'), country: country },
      ships_to: shipsTo,
      services: chosen('services', 'service'),
      quality_notes: val('qualityNotes'),
      attributes: readAttrFields(listingDefs, (k) => 'attr-' + k),
      machines: machines,
    };
    if (capacity !== null) payload.monthly_capacity = capacity;
    if (termsRequired && hostTerms && hostTerms.id) payload.terms_version_id = hostTerms.id;
    return { payload: payload };
  }

  /* Every error string the worker can answer a submission with, said in the
     host's own words where the raw one would not help. Anything unlisted is
     shown as the worker wrote it: they are already plain sentences. */
  function submitErrorText(d) {
    if (!d || !d.error) return 'That did not go through. Try again, or email hello@nexpoint.co.uk.';
    if (d.error === 'network') {
      return 'That did not send. Check your connection and try again, or email hello@nexpoint.co.uk.';
    }
    if (d.error === 'listing_locked_pending') {
      return 'You already have a listing under review, so this one was not sent. Refresh the page to see it.';
    }
    if (d.error === 'unknown_attribute') {
      return 'One of the fields on this form is no longer in use. Refresh the page and fill it in again.';
    }
    if (d.error === 'invalid_attribute') {
      return d.key ? 'Check what you put in ' + attrLabelAnywhere(d.key) + '.' : 'Check the extra fields on this form.';
    }
    if (d.error === 'attribute_required') {
      return attrLabelAnywhere(d.key) + ' is needed before we can take the listing.';
    }
    if (d.error === 'unknown_region') {
      return 'We did not recognise one of the regions. Tick them again and resend.';
    }
    if (d.error === 'organisation required') {
      return 'Your account is not attached to a site yet. Email hello@nexpoint.co.uk and we will sort it out.';
    }
    if (d.error === 'invalid terms_version_id' || d.error === 'terms_version_id required') {
      return 'The Host Agreement moved on while you were filling this in. Refresh the page and accept the current version.';
    }
    const sentence = String(d.error);
    const positioned = (d.position != null) ? ' (' + machineNoun() + ' ' + (Number(d.position) + 1) + ')' : '';
    return sentence.charAt(0).toUpperCase() + sentence.slice(1) + positioned + '.';
  }

  function attrLabelAnywhere(key) {
    const listing = attrLabel('listing', key);
    if (listing !== key) return listing;
    return attrLabel('machine', key);
  }

  function onSubmit(e) {
    e.preventDefault();
    clearError();
    const built = buildPayload();
    if (built.error) { showError(built.error, built.focus); return; }

    const A = window.NPAccount;
    if (!A) { showError(submitErrorText({ error: 'network' })); return; }

    /* Signed out or unconfirmed, the listing is held so the account flow can
       come back to it rather than losing everything the host just typed. */
    if ((!A.user || !A.confirmed()) && window.NPPending) {
      NPPending.save({ kind: 'listing', hub: HUB, payload: built.payload });
    }
    const btn = el('listingSubmit');
    const orig = btn ? btn.textContent : '';
    A.requireConfirmed(() => send(built.payload, btn, orig, false));
  }

  /* The POST and what each answer means. It sends the payload it was handed,
     never a re-read of the form: a refresh mid-flight can rebuild the panel,
     and the host's typing must not depend on what is still on screen. The
     unconfirmed retry happens once, so a worker that refuses while /auth/me
     still says confirmed ends in a sentence rather than a loop. */
  async function send(payload, btn, orig, retried) {
    const A = window.NPAccount;
    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
    submitting = true;
    const d = await submitPayload(payload);
    submitting = false;
    if (d && d.ok) {
      if (window.NPPending) NPPending.clear();
      renderSuccess();
      return;
    }
    if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = orig; }
    if (d && d.error === 'email_unconfirmed') {
      if (window.NPPending) NPPending.save({ kind: 'listing', hub: HUB, payload: payload });
      if (retried) {
        showError('We still need the link in your email clicked before this can be sent. ' +
          'Open it, then come back and send again.');
        return;
      }
      submitting = true;                 /* the refresh below fires npaccount:change */
      await A.refresh();
      submitting = false;
      loadDeferred = false;              /* the form on screen is still the right one */
      A.requireConfirmed(() => send(payload, el('listingSubmit'), orig, true));
      return;
    }
    if (loadDeferred) { loadDeferred = false; load(); return; }
    showError(submitErrorText(d));
  }

  /* The one place a listing is posted. The replay card in portal.js sends a
     held listing through here too, so there is a single submission path. */
  async function submitPayload(payload) {
    const d = await postJson('/listings', payload);
    if (d && d.ok && window.NPPending) NPPending.clear();
    return d;
  }

  /* ══════════════ the legacy host application ══════════════
     What this page ran before listings existed. Kept whole, and reached only
     when GET /listings/mine answers 404, so the offer page still works on a
     worker that has not taken the marketplace routes yet.                  */
  const LEGACY = {
    print: {
      machineLabel: 'Printers',
      machinePlaceholder: 'e.g. SLS, FDM',
      materialsPlaceholder: 'e.g. Nylon 11, Nylon 12, TPU',
      capacityPlaceholder: 'e.g. 400',
      notesLabel: 'Anything else you think is useful?',
      notesPlaceholder: 'Plans, standards, current volumes',
      signedOut: 'Sign in or create your hub account to apply. Chris or Will reviews every application personally, and nothing is listed or charged until approved.',
      pending: 'Application received. We review personally; nothing is listed or charged until approved.',
      approved: 'You are an approved host on the Print Hub. Your dashboard has your introductions, orders and order log.',
    },
    mill: {
      machineLabel: 'Machines',
      machinePlaceholder: 'e.g. 5-axis CNC',
      materialsPlaceholder: 'e.g. EVA, polypropylene, cork',
      capacityPlaceholder: 'e.g. 4,000',
      notesLabel: 'What do you make today?',
      notesPlaceholder: 'Direct-milled or moulded insoles, top covers, coating and packaging, current volumes',
      signedOut: 'Sign in or create your hub account to apply. Chris or Will reviews every application personally, and nothing is contracted or introduced until approved.',
      pending: 'Application received. We review personally; nothing is contracted or introduced until approved.',
      approved: 'You are an approved host on the Mill Hub. Your dashboard has your introductions, orders and order log.',
    },
  };

  let legacyTermsId = null;

  function legacyStatus(status) {
    const copy = LEGACY[HUB];
    if (status === 'pending') {
      body().innerHTML = '<p class="body" style="font-weight:600;color:#0E1626">' + esc(copy.pending) + '</p>';
      return;
    }
    if (status === 'approved') {
      body().innerHTML = '<p class="body">' + esc(copy.approved) + '</p>' +
        '<div class="modal-actions"><a class="btn btn-primary" href="' + ACCOUNT_URL + '">Go to your dashboard</a></div>';
      return;
    }
    body().innerHTML = '<p class="body">This application was not approved this time. Email ' +
      '<a href="mailto:hello@nexpoint.co.uk">hello@nexpoint.co.uk</a> if anything has changed and you would like to talk it through.</p>';
  }

  async function legacyTerms() {
    const box = el('hostTermsBlock');
    if (!box) return;
    const d = await api('/terms/current?layer=host');
    if (!el('hostTermsBlock')) return;
    const btn = document.querySelector('#hostApplyForm button[type="submit"]');
    if (!d || d.error || !d.id) {
      legacyTermsId = null;
      el('hostTermsBlock').innerHTML = '<p class="np-sign-error" style="display:block">We could not load the Host Agreement. ' +
        'Refresh and try again, or email hello@nexpoint.co.uk.</p>';
      return;
    }
    legacyTermsId = d.id;
    el('hostTermsBlock').innerHTML = '<div class="terms-scroll">' + markdownLite(d.body_md) + '</div>' +
      '<label class="np-terms-tick"><input type="checkbox" id="hostTick" required> I accept the Host Agreement, version ' +
      esc(d.version) + '</label>';
    if (btn) btn.disabled = false;
  }

  function renderLegacy() {
    const copy = LEGACY[HUB];
    const u = (window.NPAccount && NPAccount.user) || {};
    body().innerHTML =
      '<p class="body" style="margin-bottom:18px">Applying as <strong>' + esc(u.company || '') + '</strong> (' + esc(u.email || '') + ').</p>' +
      '<form id="hostApplyForm"><div class="form-grid">' +
      '<div class="field"><label for="hostMachines">' + esc(copy.machineLabel) + '</label>' +
      '<input id="hostMachines" placeholder="' + esc(copy.machinePlaceholder) + '"></div>' +
      '<div class="field"><label for="hostMaterials">Materials</label>' +
      '<input id="hostMaterials" placeholder="' + esc(copy.materialsPlaceholder) + '"></div>' +
      '<div class="field"><label for="hostCapacity">Monthly capacity (pairs)</label>' +
      '<input id="hostCapacity" placeholder="' + esc(copy.capacityPlaceholder) + '"></div>' +
      '<div class="field"><label for="hostLeadTimes">Lead times</label>' +
      '<input id="hostLeadTimes" placeholder="e.g. 5 to 7 working days"></div>' +
      '<div class="field full"><label for="hostCountries">Countries served</label>' +
      '<input id="hostCountries" placeholder="e.g. UK, Ireland, Netherlands"></div>' +
      '<div class="field full"><label for="hostNotes">' + esc(copy.notesLabel) + '</label>' +
      '<textarea id="hostNotes" placeholder="' + esc(copy.notesPlaceholder) + '"></textarea></div>' +
      '</div>' +
      '<div id="hostTermsBlock" style="margin-top:16px"><p class="body" style="margin:0">Loading the Host Agreement…</p></div>' +
      '<p class="np-sign-error" id="hostApplyErr" style="display:none"></p>' +
      '<div class="modal-actions"><button class="btn btn-primary" type="submit" disabled>Apply to host</button></div>' +
      '</form>';
    el('hostApplyForm').addEventListener('submit', legacySubmit);
    legacyTerms();
  }

  async function legacySubmit(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const err = el('hostApplyErr');
    const tick = el('hostTick');
    if (!legacyTermsId || !tick || !tick.checked) {
      err.style.display = 'block';
      err.textContent = 'Tick to confirm you accept the Host Agreement.';
      return;
    }
    const profile = {
      machines: val('hostMachines'), materials: val('hostMaterials'),
      monthly_capacity: val('hostCapacity'), lead_times: val('hostLeadTimes'),
      countries_served: val('hostCountries'), notes: val('hostNotes'),
    };
    const orig = btn.textContent; btn.disabled = true; btn.textContent = 'Submitting…';
    const d = await postJson('/host/apply', { hub: HUB, profile: profile, terms_version_id: legacyTermsId });
    if (d && d.ok) { legacyStatus('pending'); return; }
    btn.disabled = false; btn.textContent = orig;
    err.style.display = 'block';
    err.textContent = (d && d.error) ? String(d.error) : 'That did not go through. Try again.';
  }

  async function legacyBoot() {
    const d = await api('/host/application?hub=' + encodeURIComponent(HUB));
    const status = (d && d.status) || 'none';
    if (status === 'none') renderLegacy(); else legacyStatus(status);
  }

  /* ══════════════ load ══════════════ */

  /* NPAccount both resolves `ready` and fires `npaccount:change` for the same
     refresh, so the load is queued on a timer and runs once per settle. */
  function load() {
    if (submitting) { loadDeferred = true; return; }
    if (bootQueued) return;
    bootQueued = true;
    setTimeout(() => { bootQueued = false; doLoad(); }, 0);
  }

  async function doLoad() {
    if (!body()) return;
    if (!window.NPAccount) { renderSignedOut(); return; }
    await NPAccount.ready;
    if (!NPAccount.user) { renderSignedOut(); return; }
    if (!NPAccount.confirmed()) { renderUnconfirmed(); return; }

    const [d, v] = await Promise.all([
      api('/listings/mine?hub=' + encodeURIComponent(HUB)),
      window.NPVocab ? NPVocab.load(HUB) : Promise.resolve(null),
    ]);
    vocab = v;

    if (d && d.error) {
      /* 404 is the deploy window, not a failure: the marketplace routes are
         not on this worker yet, so the old application form is the truth. */
      if (d.error === 'http_404' || d.error === 'not found' || d.http_status === 404) { legacyBoot(); return; }
      if (d.error === 'http_401' || d.error === 'sign in required') { renderSignedOut(); return; }
      renderLoadFailed();
      return;
    }
    if (!d) { renderLoadFailed(); return; }

    mine = d;
    resetPanelState();
    const status = d.status || 'none';
    if (status === 'pending' || status === 'live_pending_edit') {
      if (d.pending) { renderPending(d); return; }
      /* a pending status with no revision behind it is a shell: let them fill it in */
    }
    if (status === 'declined') { renderDeclined(d); return; }
    renderForm(d);
  }

  function init() {
    if (!body()) return;
    document.addEventListener('npaccount:change', load);
    load();
  }

  window.NPListing = { init: init, submitPayload: submitPayload, reload: load };
})();

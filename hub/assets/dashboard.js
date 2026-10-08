/* NexPoint Global Hub - the account dashboard.
   One page, six sections, one GET /account/summary. Every section owns its
   own empty copy, so a key the worker has not shipped yet leaves that section
   saying something sensible rather than breaking the page: a missing key is
   never an error. Started by portal.js's np:modules boot, like every other
   page module.                                                              */
(function () {
  'use strict';

  /* ── the words a hub is known by ────────────────────────────────── */
  var HUBS = ['print', 'mill'];
  var HUB_LABEL = { print: 'Print Hub', mill: 'Mill Hub', opportunities: 'Opportunities Hub' };
  var HUB_LISTING = {
    print: 'https://printhub.nexpoint.co.uk/offer.html',
    mill: 'https://millhub.nexpoint.co.uk/offer.html',
  };
  /* The door with the four hub cards: where an account that has done nothing
     yet is sent (plan 046, record B2). Spelt as the page's own links spell
     it, so the Go to the Global Hub button and this line land in one place. */
  var HUB_DOOR = '../index.html';

  /* The four steps every introduction walks, in order, the same for seekers and
     providers. CHAIN_AT is the step being waited on; introduced and every later
     stage (see acceptedStage) have nothing left to wait for. A stopped one keeps
     the steps it actually reached and ends on the word for how it stopped. */
  var CHAIN = ['Requested', 'Approved by NexPoint', 'Awaiting provider', 'Introduced'];
  var CHAIN_AT = {
    proposed: 1,
    approved: 2,
    awaiting_acceptance: 2,
  };

  var CURRENCIES = ['GBP', 'EUR', 'USD'];

  /* ── small helpers ──────────────────────────────────────────────── */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function el(id) { return document.getElementById(id); }
  function api(path, opts) {
    if (window.NP && NP.api) return NP.api(path, opts);
    return Promise.resolve({ error: 'network' });
  }
  function post(path, body) {
    return api(path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  }
  function hubLabel(h) { return HUB_LABEL[h] || (h ? String(h) : ''); }
  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    try { return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
    catch (e) { return String(iso); }
  }
  /* A declaration period arrives as 2026-08. People read it as August 2026; the
     raw value stays in data-period, the element ids and what is posted. */
  function fmtPeriod(p) {
    var m = /^(\d{4})-(\d{2})$/.exec(String(p || ''));
    if (!m) return String(p || '');
    var d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
    try { return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }); }
    catch (e) { return String(p); }
  }
  /* Money on this page is only ever the account's own number: what it declared,
     or what it has been invoiced. Nothing here prices the network. */
  function money(amount, currency) {
    var sym = { GBP: '£', EUR: '€', USD: '$' }[currency] || '';
    var n = Number(amount || 0);
    var s;
    try { s = n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    catch (e) { s = n.toFixed(2); }
    return sym ? sym + s : (currency ? currency + ' ' + s : s);
  }
  function list(v) { return Array.isArray(v) ? v.filter(Boolean).join(', ') : (v || ''); }
  function fill(id, html) {
    var node = el(id);
    if (!node) return;
    node.innerHTML = html;
    node.hidden = false;
  }
  function hide(id) {
    var node = el(id);
    if (!node) return;
    node.innerHTML = '';
    node.hidden = true;
  }
  /* Plan 052, item 10: stored terms (pa12_nylon12, one_off) read as the vocab's
     words. `vocab` is filled before the first render (loadVocab) and, if the
     list could not be read, label() still humanises the term. */
  var vocab = {};
  var VOCAB_LIST = { material: 'materials', process: 'processes', service: 'services' };
  var CADENCE = { one_off: 'One off', recurring: 'Recurring' };
  function lab(kind, hub, term) {
    if (term == null || term === '') return '';
    if (kind === 'cadence' && CADENCE[term]) return CADENCE[term];
    var v = vocab[hub === 'mill' ? 'mill' : 'print'];
    var list = v && VOCAB_LIST[kind] ? v[VOCAB_LIST[kind]] : [];
    if (window.NPVocab && NPVocab.label) return NPVocab.label(list, term);
    return String(term);
  }
  function loadVocab() {
    if (!window.NPVocab) return Promise.resolve();
    return Promise.all(['print', 'mill'].map(function (h) {
      return NPVocab.load(h).then(function (v) { vocab[h] = v; }, function () {});
    }));
  }
  function icon(name) { return '<span class="material-symbols-outlined acct-ico" aria-hidden="true">' + name + '</span>'; }
  function empty(text, ico) { return '<div class="acct-empty">' + icon(ico || 'inbox') + '<span>' + esc(text) + '</span></div>'; }
  /* A section's heading: one icon, the title, and the line under it. */
  function head(ico, title, hint) {
    return '<div class="acct-h">' + icon(ico) + '<h2>' + esc(title) + '</h2></div>' +
      (hint ? '<p class="hint">' + esc(hint) + '</p>' : '');
  }
  function hubPill(h) { return h ? '<span class="acct-hub">' + esc(hubLabel(h)) + '</span>' : ''; }
  /* A reference and the hub it belongs to, as every card and row titles itself. */
  function refLine(ref, hub, fallback) {
    var r = ref ? '<span class="acct-ref">' + esc(ref) + '</span>' : '';
    return (r + hubPill(hub)) || esc(fallback || '');
  }
  /* A request is known by its INTRO- code once an introduction exists, and by
     nothing before (plan 052, item 4): the PS-/MS- code is the desk's and the
     email's, and REQ- is retired. One code per pick, in rank order. */
  function requestRefs(r) {
    return (Array.isArray(r.picks) ? r.picks : []).map(function (p) { return p.ref; }).filter(Boolean).join(' \u00b7 ');
  }
  /* Plain rows that belong together share one surface, ruled off by hairlines. */
  function group(rows) { return '<div class="acct-list">' + rows + '</div>'; }
  function initials(name) {
    var w = String(name || '').replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
    return ((w[0] || '').charAt(0) + (w[1] || '').charAt(0)).toUpperCase() || 'N';
  }
  function say(node, text, bad) {
    if (!node) return;
    node.textContent = text;
    node.className = 'acct-msg' + (bad ? ' is-bad' : '');
    node.hidden = false;
  }

  var SECTIONS = ['profile', 'introductions', 'declarations', 'orders', 'fees', 'education'];

  /* ── the account, as this page reads it ─────────────────────────── */
  function siteOf(d) {
    var org = d.org || {};
    var site = d.site || {};
    var pick = function (a, b) { return a != null && a !== '' ? a : b; };
    return {
      name: pick(site.name, org.name) || 'Your organisation',
      town: site.town || '',
      country: site.country || '',
      host_print: pick(site.host_print, org.host_print) || 'none',
      host_mill: pick(site.host_mill, org.host_mill) || 'none',
      sub_status: pick(site.sub_status, org.sub_status) || '',
      founding: !!pick(site.founding, org.founding),
      hidden: site.hidden != null ? !!site.hidden : (org.sub_status === 'hidden'),
      verified: !!site.verified,
    };
  }
  function isHost(s) { return s.host_print === 'approved' || s.host_mill === 'approved'; }
  function hostHubs(s) {
    return HUBS.filter(function (h) { return s['host_' + h] === 'approved'; });
  }

  /* ═══════════ 1. profile ═══════════ */
  function renderProfile(d, s) {
    var where = [s.town, s.country].filter(Boolean).join(', ');
    var badges = [];
    HUBS.forEach(function (h) {
      var st = s['host_' + h];
      if (st === 'approved') {
        badges.push(s.verified
          ? '<span class="badge-verified">Verified host · ' + esc(hubLabel(h)) + '</span>'
          : '<span class="acct-badge">Host · ' + esc(hubLabel(h)) + '</span>');
      } else if (st === 'applied') {
        badges.push('<span class="acct-badge is-applied">Host application in review · ' + esc(hubLabel(h)) + '</span>');
      }
    });
    if (s.founding) badges.push('<span class="acct-badge is-founding">Founding partner</span>');

    var html =
      '<div class="acct-id">' +
        '<span class="acct-mono" aria-hidden="true">' + esc(initials(s.name)) + '</span>' +
        '<div class="acct-id__text"><h2>' + esc(s.name) + '</h2>' +
        '<p class="hint">Site account' + (where ? ' · ' + esc(where) : '') + '</p></div>' +
      '</div>' +
      (badges.length ? '<div class="acct-badges">' + badges.join('') + '</div>' : '') +
      (s.hidden ? '<div class="acct-notice">Your listing is hidden, so nobody searching the hub can see it. Email <a href="mailto:hello@nexpoint.co.uk">hello@nexpoint.co.uk</a> and we will put it back.</div>' : '') +
      listingRows(d, s);
    fill('profile', html);
  }

  function listingRows(d, s) {
    var listings = Array.isArray(d.listings) ? d.listings : null;
    if (!listings) {
      return isHost(s) ? empty('Your listing status appears here.', 'storefront') : '';
    }
    if (!listings.length) return isHost(s) ? empty('Your listing status appears here.', 'storefront') : '';
    return group(listings.map(function (l) {
      var st = l.status || 'none';
      var live = l.live || {};
      var pending = l.pending || {};
      var text;
      if (st === 'live') text = 'Live since ' + fmtDate(live.approved_at);
      else if (st === 'live_pending_edit') text = 'Live since ' + fmtDate(live.approved_at) + '. Pending review since ' + fmtDate(pending.submitted_at) + '.';
      else if (st === 'pending') text = 'Pending review since ' + fmtDate(pending.submitted_at);
      else text = 'Not listed';
      var locked = st === 'pending' || st === 'live_pending_edit';
      var href = HUB_LISTING[l.hub];
      var action = locked
        ? '<span class="acct-disabled" aria-disabled="true">Edit listing</span>'
        : (href ? '<a class="acct-link" href="' + esc(href) + '">Edit listing</a>' : '');
      var dot = st === 'live' ? 'is-live' : locked ? 'is-pending' : '';
      return '<div class="acct-row">' +
        '<div class="acct-row__meta"><b><span class="acct-dot ' + dot + '" aria-hidden="true"></span>' + esc(hubLabel(l.hub)) + ' listing</b><span>' + esc(text) + '</span></div>' +
        '<div class="acct-row__actions">' + action + '</div>' +
      '</div>';
    }).join(''));
  }

  /* ═══════════ 2. introductions ═══════════ */
  function statusChain(stage) {
    var steps = CHAIN.slice();
    var last = steps.length - 1;
    var stop = stage === 'declined' ? 'Declined' : stage === 'expired' ? 'Expired' : '';
    var done = 0;     /* steps 0..done-1 are complete */
    var cur = -1;     /* the step being waited on, if any */
    if (stop) { steps[last] = stop; done = last; }
    else if (acceptedStage(stage)) done = steps.length;
    else if (CHAIN_AT[stage] != null) { cur = CHAIN_AT[stage]; done = cur; }
    return '<ol class="status-chain" aria-label="Progress of this introduction">' + steps.map(function (label, i) {
      var cls = '';
      if (stop && i === last) cls = 'is-stop';
      else if (i < done) cls = i === last ? 'is-done is-green' : 'is-done';
      else if (i === cur) cls = 'is-current';
      return '<li' + (cls ? ' class="' + cls + '"' : '') + (i === cur ? ' aria-current="step"' : '') + '>' + esc(label) + '</li>';
    }).join('') + '</ol>';
  }

  /* Accepted, and everything the older summaries called a live deal after it.
     An allowlist, not a blocklist: `approved` is pre-introduction (Approved by
     NexPoint, step 1) and must never release a counterpart or claim contact
     details were sent. */
  function acceptedStage(stage) {
    return ['introduced', 'in_discussion', 'deal_done', 'invoiced', 'paid'].indexOf(stage) !== -1;
  }

  function introDate(i) {
    if (!i) return '';
    return i.introduced_at || i.accepted_b_at || i.accepted_a_at || '';
  }

  /* The sentence an accepted introduction ends on. Contact details go out by
     email, so this says where to look and how to keep the order trail whole. */
  function releasedLine(ref, date) {
    return date
      ? 'Contact details were emailed on ' + fmtDate(date) + ', ref ' + ref + '. Copy introductions@nexpoint.co.uk on every order email.'
      : 'Contact details were emailed to you, ref ' + ref + '. Copy introductions@nexpoint.co.uk on every order email.';
  }

  function counterpartBlock(c, ref, date) {
    var bits = [];
    if (c) {
      if (c.company) bits.push('<b>' + esc(c.company) + '</b>');
      var line = [];
      if (c.name) line.push(esc(c.name));
      if (c.email) line.push('<a href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a>');
      if (c.phone) line.push(esc(c.phone));
      if (line.length) bits.push('<span>' + line.join(' · ') + '</span>');
    }
    bits.push('<span>' + esc(releasedLine(ref, date)) + '</span>');
    return '<div class="acct-released">' + bits.join('<br>') + '</div>';
  }

  function pickBlock(p, intro, hub) {
    var card = p.card || {};
    var rows = [];
    var where = [card.town, card.country].filter(Boolean).join(', ');
    if (where) rows.push(['Where', where]);
    var mats = function (a) { return (a || []).map(function (t) { return lab('material', hub, t); }); };
    if (card.machines && card.machines.length) rows.push(['Machines', card.machines.map(function (m) {
      if (!m || typeof m !== 'object') return String(m || '');
      return [m.name, m.count > 1 ? 'x' + m.count : '', m.materials && m.materials.length ? '(' + mats(m.materials).join(', ') + ')' : ''].filter(Boolean).join(' ');
    }).filter(Boolean).join('; ')]);
    if (card.materials && card.materials.length) rows.push(['Materials', list(mats(card.materials))]);
    if (card.min_lead_time_days != null) rows.push(['Lead time', 'From ' + card.min_lead_time_days + ' days']);
    if (card.services && card.services.length) rows.push(['Services', list(card.services.map(function (t) { return lab('service', hub, t); }))]);

    var accepted = acceptedStage(p.stage);
    return '<div class="acct-pick">' +
      (p.ref ? '<b class="acct-ref">' + esc(p.ref) + '</b>' : '') +
      (rows.length ? '<dl>' + rows.map(function (r) {
        return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>';
      }).join('') + '</dl>' : '') +
      statusChain(p.stage) +
      (accepted ? counterpartBlock(intro && intro.counterpart, p.ref || (intro && intro.ref) || '', introDate(intro)) : '') +
    '</div>';
  }

  function requestCard(r, byId) {
    var picks = Array.isArray(r.picks) ? r.picks : [];
    var facts = [lab('material', r.hub, r.material), r.quantity, lab('cadence', r.hub, r.cadence)].filter(Boolean).map(String).join(' · ');
    var body;
    /* Picks win over the flag: a request routed by hand keeps no_match, and its
       pick must still show. The flag only words the empty state. */
    if (!picks.length) {
      body = r.no_match
        ? empty('No match yet. We are still looking, and will write the moment there is one.', 'travel_explore')
        : empty('With NexPoint. Nothing has been put forward yet.', 'hourglass_top');
    } else {
      body = '<p class="hint">What we put forward (' + picks.length + ')</p>' +
        picks.map(function (p) { return pickBlock(p, byId[p.introduction_id], r.hub); }).join('');
    }
    return '<div class="acct-card">' +
      '<h3>' + refLine(requestRefs(r), r.hub, 'Your request') + '</h3>' +
      '<p class="hint">' + esc([facts, r.created_at ? 'Requested ' + fmtDate(r.created_at) : ''].filter(Boolean).join(' · ')) + '</p>' +
      body +
    '</div>';
  }

  function providerLine(i) {
    if (i.stage === 'awaiting_acceptance') return 'Answer from the email we sent you.';
    if (i.stage === 'approved') return 'Approved by NexPoint.';
    if (i.stage === 'declined') return 'Declined.';
    if (i.stage === 'expired') return 'Expired.';
    if (i.stage === 'proposed') return 'With NexPoint.';
    return 'Introduced.';
  }

  /* What a provider is being asked for, in the anonymised terms the offer
     carries. No seeker is named here: nothing is released before acceptance. */
  function offerLine(o) {
    if (!o || !o.request) return '';
    var r = o.request;
    return [lab('material', o.hub, r.material), lab('process', o.hub, r.process), r.quantity, lab('cadence', o.hub, r.cadence),
      r.max_lead_time_days != null ? 'within ' + r.max_lead_time_days + ' days' : '',
      [r.town, r.country].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
  }

  function introRow(i, showResend, offer) {
    var extra = [];
    var asked = offerLine(offer);
    if (asked) extra.push(asked);
    if (i.stage === 'awaiting_acceptance' && i.acceptance_expires_at) extra.push('Open until ' + fmtDate(i.acceptance_expires_at) + '.');
    var accepted = acceptedStage(i.stage);
    return '<div class="acct-row">' +
      '<div class="acct-row__meta">' +
        '<b>' + refLine(i.ref, i.hub) + '</b>' +
        '<span>' + esc(providerLine(i)) + '</span>' +
        extra.map(function (x) { return '<span>' + esc(x) + '</span>'; }).join('') +
        statusChain(i.stage) +
        (accepted ? counterpartBlock(i.counterpart, i.ref || '', introDate(i)) : '') +
      '</div>' +
      '<div class="acct-row__actions">' +
        (showResend && i.stage === 'awaiting_acceptance'
          ? '<button class="btn btn-outline acct-btn-sm" type="button" data-act="intro-resend" data-intro="' + esc(i.id) + '">Resend the link</button>' +
            '<span class="acct-msg" id="introMsg-' + esc(i.id) + '" hidden></span>'
          : '') +
      '</div>' +
    '</div>';
  }

  function renderIntroductions(d) {
    var intros = Array.isArray(d.introductions) ? d.introductions : [];
    var requests = Array.isArray(d.requests) ? d.requests : null;
    var byId = {};
    intros.forEach(function (i) { byId[i.id] = i; });

    var pickIds = {};
    (requests || []).forEach(function (r) {
      (Array.isArray(r.picks) ? r.picks : []).forEach(function (p) { pickIds[p.introduction_id] = true; });
    });

    var offerBy = {};
    (Array.isArray(d.offers) ? d.offers : []).forEach(function (o) { offerBy[o.introduction_id] = o; });

    var provider = intros.filter(function (i) { return i.role === 'provider'; });
    /* Anything on this side that no request card already shows: an older
       summary's flat list, or a seeker introduction with no request behind it.
       It still renders, on the same chain, rather than going missing. */
    var other = intros.filter(function (i) { return i.role !== 'provider' && !pickIds[i.id]; });

    var blocks = [];
    if (requests) {
      blocks.push('<h3 class="acct-sub">What you asked for</h3>' +
        (requests.length ? requests.map(function (r) { return requestCard(r, byId); }).join('')
                         : empty('No requests yet. Ask a hub for what you need and it appears here.', 'add_circle')));
    }
    if (provider.length) {
      blocks.push('<h3 class="acct-sub">Asked of you</h3>' +
        provider.map(function (i) { return introRow(i, true, offerBy[i.id]); }).join(''));
    }
    if (other.length) {
      blocks.push((requests || provider.length ? '<h3 class="acct-sub">Everything else</h3>' : '') +
        other.map(function (i) { return introRow(i, false); }).join(''));
    }
    if (!blocks.length) blocks.push(empty('No introductions yet.', 'handshake'));

    fill('introductions',
      head('handshake', 'Introductions', 'Contact details are exchanged only once both sides have accepted.') +
      blocks.join(''));
  }

  /* ═══════════ 3. declarations (host) ═══════════ */
  function declHubOf(dec, byId) {
    if (dec && dec.hub) return dec.hub;
    var items = (dec && Array.isArray(dec.items)) ? dec.items : [];
    for (var n = 0; n < items.length; n++) {
      var i = byId[items[n].introduction_id];
      if (i && i.hub) return i.hub;
    }
    return '';
  }

  function dueLine(state) {
    if (state === 'overdue') return 'Overdue.';
    if (state === 'reminder') return 'Still open, and we have sent a reminder.';
    return 'Open now.';
  }

  function declCard(dec, hub) {
    var period = dec.period_open || '';
    var items = Array.isArray(dec.items) ? dec.items : [];
    if (!items.length) return empty('Nothing to declare this period.', 'task_alt');
    var pid = 'decl-' + period + '-';
    var rows = items.map(function (it) {
      var base = pid + it.introduction_id + '-';
      var seeker = [it.seeker_town, it.seeker_country].filter(Boolean).join(', ');
      var ref = it.ref || String(it.introduction_id);
      return '<tr data-ref="' + esc(ref) + '">' +
        '<td><b>' + esc(ref) + '</b>' + (seeker ? '<br><span>' + esc(seeker) + '</span>' : '') + '</td>' +
        '<td><input id="' + esc(base + 'units') + '" type="number" min="0" step="1" inputmode="numeric" aria-label="Units for ' + esc(ref) + '"></td>' +
        '<td><input id="' + esc(base + 'value') + '" type="number" min="0" step="0.01" inputmode="decimal" aria-label="Value for ' + esc(ref) + '"></td>' +
        '<td><select id="' + esc(base + 'currency') + '" aria-label="Currency for ' + esc(ref) + '">' +
          CURRENCIES.map(function (c) { return '<option value="' + c + '">' + c + '</option>'; }).join('') +
        '</select></td>' +
        '<td><input id="' + esc(base + 'nothing') + '" type="checkbox" aria-label="Nothing through ' + esc(ref) + ' this period"></td>' +
      '</tr>';
    }).join('');

    return '<div class="acct-card">' +
      '<h3>' + esc(fmtPeriod(period)) + '</h3>' +
      '<p class="hint">' + esc(dueLine(dec.due_state)) + ' One line per introduction. Tick the last column where nothing came through.</p>' +
      '<div class="acct-scroll"><table class="decl-table">' +
        '<thead><tr><th>Introduction</th><th>Units</th><th>Value</th><th>Currency</th><th>Nothing</th></tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table></div>' +
      '<p class="acct-msg" id="declMsg-' + esc(period) + '" hidden></p>' +
      '<div class="modal-actions">' +
        '<button class="btn btn-primary" type="button" id="declSubmit-' + esc(period) + '" data-act="decl-submit" ' +
          'data-period="' + esc(period) + '" data-hub="' + esc(hub) + '">Send this declaration</button>' +
      '</div>' +
    '</div>';
  }

  function declHistory(dec) {
    var rows = (dec && Array.isArray(dec.history)) ? dec.history : null;
    var body = (rows && rows.length)
      ? group(rows.map(function (h) {
          return '<div class="acct-row"><div class="acct-row__meta"><b>' + esc(fmtPeriod(h.period)) + '</b>' +
            '<span>' + esc(h.submitted_at ? 'Sent ' + fmtDate(h.submitted_at) : 'Sent') + '</span></div></div>';
        }).join(''))
      : empty('Earlier declarations appear here once you have sent one.', 'history');
    return '<details class="acct-detail"><summary>Earlier declarations</summary>' + body + '</details>';
  }

  function renderDeclarations(d, s, byId) {
    if (!isHost(s)) { hide('declarations'); return; }
    var dec = d.declarations;
    var body;
    if (!dec) body = empty('Declarations open soon.', 'event_upcoming');
    else if (dec.due_state === 'submitted') body = empty('Declared for ' + (fmtPeriod(dec.period_open) || 'this period') + '. Nothing else to send.', 'task_alt');
    else if (dec.due_state === 'due' || dec.due_state === 'reminder' || dec.due_state === 'overdue') {
      body = declCard(dec, declHubOf(dec, byId) || hostHubs(s)[0] || '');
    } else body = empty('Nothing due. Declarations open on the 1st for hosts with accepted introductions.', 'task_alt');

    fill('declarations',
      head('fact_check', 'Declarations', 'What came through each introduction. The other side confirms it, so both records agree.') +
      body + declHistory(dec));
  }

  /* ═══════════ 4. orders awaiting confirmation (seeker) ═══════════ */
  function confirmRow(o) {
    var id = o.id;
    var facts = [];
    if (o.units != null && o.units !== '') facts.push(o.units + ' units');
    if (o.value != null && o.value !== '') facts.push(money(o.value, o.currency));
    if (o.declared_at) facts.push('Declared ' + fmtDate(o.declared_at));
    return '<div class="acct-row" id="line-' + esc(id) + '">' +
      '<div class="acct-row__meta">' +
        '<b>' + (o.ref ? '<span class="acct-ref">' + esc(o.ref) + '</span>' : '') +
          (o.period ? '<span class="acct-hub">' + esc(fmtPeriod(o.period)) + '</span>' : (o.ref ? '' : 'Declared order')) + '</b>' +
        '<span>' + esc(facts.join(' · ')) + '</span>' +
      '</div>' +
      '<div class="acct-row__actions">' +
        '<button class="btn btn-primary acct-btn-sm" type="button" data-act="line-confirm" data-line="' + esc(id) + '" data-kind="' + esc(o.kind) + '">Confirm</button>' +
        '<button class="btn btn-outline acct-btn-sm" type="button" data-act="line-query" data-line="' + esc(id) + '">Query</button>' +
      '</div>' +
      '<div class="acct-note" id="lineNote-' + esc(id) + '" hidden>' +
        '<label class="np-hint" for="dispute-' + esc(id) + '">What does not match?</label>' +
        '<textarea id="dispute-' + esc(id) + '" placeholder="What does not match?"></textarea>' +
        '<button class="btn btn-outline acct-btn-sm" type="button" data-act="line-query-send" data-line="' + esc(id) + '" data-kind="' + esc(o.kind) + '">Send the query</button>' +
      '</div>' +
      '<p class="acct-msg" id="lineMsg-' + esc(id) + '" hidden></p>' +
    '</div>';
  }

  function renderOrders(d) {
    var dec = d.declarations;
    var lines = (dec && Array.isArray(dec.awaiting_my_confirmation)) ? dec.awaiting_my_confirmation.map(function (l) {
      return { kind: 'line', id: l.line_id, ref: l.ref, period: l.period, units: l.units, value: l.value, currency: l.currency, declared_at: l.declared_at };
    }) : null;
    /* Older summaries carried the same idea under orders_awaiting_confirm. */
    if (!lines && Array.isArray(d.orders_awaiting_confirm)) {
      lines = d.orders_awaiting_confirm.map(function (o) {
        return { kind: 'order', id: o.id, ref: o.ref || hubLabel(o.hub), period: o.period, units: o.units, value: o.value, currency: o.currency, declared_at: o.logged_at };
      });
    }
    fill('orders',
      head('pending_actions', 'Waiting on you', 'Confirm what matches your records, or query what does not.') +
      ((lines && lines.length) ? lines.map(confirmRow).join('') : empty('Nothing to confirm.', 'task_alt')));
    if (el('orders')) el('orders').classList.toggle('is-attention', !!(lines && lines.length));
  }

  /* ═══════════ 5. fees and standing (host) ═══════════ */
  function renderFees(d, s) {
    if (!isHost(s)) { hide('fees'); return; }
    var statements = Array.isArray(d.statements) ? d.statements : null;
    var feesBody;
    if (statements && statements.length) {
      feesBody = group(statements.map(function (f) {
        var when = f.paid_at ? fmtDate(f.paid_at)
          : f.issued_at ? fmtDate(f.issued_at)
          : (f.status ? String(f.status) : '');
        var pill = f.paid_at ? '<span class="acct-pill is-paid">Paid</span>'
          : f.issued_at ? '<span class="acct-pill is-issued">Issued</span>' : '';
        return '<div class="acct-row"><div class="acct-row__meta">' +
          '<b>' + esc(f.quarter || '') + '</b>' +
          '<span>' + esc(when) + '</span>' +
        '</div><div class="acct-row__actions">' + pill +
          '<span class="acct-amount">' + esc(money(f.total_fees, f.currency)) + '</span>' +
        '</div></div>';
      }).join(''));
    } else if (!statements && Array.isArray(d.fees_owed) && d.fees_owed.length) {
      feesBody = group(d.fees_owed.map(function (f) {
        return '<div class="acct-row"><div class="acct-row__meta">' +
          '<b class="acct-amount">' + esc(money(f.amount, f.currency)) + '</b><span>Not yet on a statement</span>' +
        '</div></div>';
      }).join(''));
    } else {
      feesBody = empty('Fees appear here once a statement is issued.', 'receipt_long');
    }

    var score = d.score || null;
    var scoreLine = (score && score.value != null)
      ? 'Follow-through: ' + score.value + (score.computed_at ? ' · scored ' + fmtDate(score.computed_at) : '')
      : 'Follow-through: not scored yet.';

    var strikes = (score && Array.isArray(score.open_strikes)) ? score.open_strikes
      : (Array.isArray(d.open_strikes) ? d.open_strikes : []);
    var strikesBody = strikes.length
      ? group(strikes.map(function (st) {
          var line = [st.cure_by ? 'Cure by ' + fmtDate(st.cure_by) + '.' : '', st.notes || ''].filter(Boolean).join(' ');
          return '<div class="acct-row"><div class="acct-row__meta">' +
            '<b>' + esc(st.opened_at ? 'Opened ' + fmtDate(st.opened_at) : 'Open strike') + '</b>' +
            '<span>' + esc(line || 'Declaring the matching order clears it.') + '</span>' +
          '</div></div>';
        }).join(''))
      : empty('No open strikes.', 'verified');

    fill('fees',
      head('receipt_long', 'Fees and standing', scoreLine) +
      feesBody +
      '<h3 class="acct-sub">Open strikes</h3>' +
      strikesBody);
  }

  /* ═══════════ 6. education ═══════════ */
  function renderEducation() {
    fill('education',
      head('school', 'Education', 'Courses and training, built with the people who do the work.') +
      '<div class="tile-grid">' +
        '<button class="tile" type="button" data-act="education">' +
          '<h4>Education Hub</h4>' +
          '<p>Education Hub: quarterly webinars for the whole community, first courses opening soon.</p>' +
          '<span class="go">Put me on the list</span>' +
        '</button>' +
      '</div>');
  }

  /* ═══════════ what needs the reader, and where things are ═══════════ */
  /* Both read the same summary the sections read, and add nothing of their
     own: every line here is a link down to the section that already holds
     the button. */
  function needsOf(d, s) {
    var dec = d.declarations || null;
    var intros = Array.isArray(d.introductions) ? d.introductions : [];
    var lines = (dec && Array.isArray(dec.awaiting_my_confirmation)) ? dec.awaiting_my_confirmation
      : (Array.isArray(d.orders_awaiting_confirm) ? d.orders_awaiting_confirm : []);
    var asked = intros.filter(function (i) { return i.role === 'provider' && i.stage === 'awaiting_acceptance'; }).length;
    var due = isHost(s) && dec && ['due', 'reminder', 'overdue'].indexOf(dec.due_state) !== -1 &&
      Array.isArray(dec.items) && dec.items.length;
    var out = [];
    if (lines.length) out.push({ to: 'orders', icon: 'pending_actions',
      text: lines.length === 1 ? 'Confirm 1 declared order' : 'Confirm ' + lines.length + ' declared orders' });
    if (due) out.push({ to: 'declarations', icon: 'fact_check',
      text: 'Send your declaration for ' + (fmtPeriod(dec.period_open) || 'this period') + (dec.due_state === 'overdue' ? ', now overdue' : '') });
    if (asked) out.push({ to: 'introductions', icon: 'handshake',
      text: asked === 1 ? 'Answer 1 introduction from the email we sent you' : 'Answer ' + asked + ' introductions from the emails we sent you' });
    /* An account that is not a host and has listed, asked and been
       introduced to nothing yet has one thing to do: choose a hub. The
       line goes to the door, not to a section (plan 046, record B2). */
    var nothingYet = !isHost(s) && !(Array.isArray(d.listings) && d.listings.length) &&
      !(Array.isArray(d.requests) && d.requests.length) && !intros.length;
    if (nothingYet) out.push({ href: HUB_DOOR, icon: 'hub',
      text: 'Choose a hub: find print or milling capacity, or list your site' });
    return out;
  }

  /* A line with an href leaves the page (the trailing arrow points on); one
     with a section id scrolls down to it. */
  function renderNeeds(needs) {
    if (!needs.length) { hide('acctNeeds'); return; }
    fill('acctNeeds',
      '<h2>Next step</h2><ul>' + needs.map(function (n) {
        var open = n.href ? '<a href="' + esc(n.href) + '">' : '<a href="#' + n.to + '">';
        var arrow = n.href ? icon('arrow_forward') : icon('arrow_downward');
        return '<li>' + open + icon(n.icon) + '<span>' + esc(n.text) + '</span>' + arrow + '</a></li>';
      }).join('') + '</ul>');
  }

  var NAV_LABEL = { profile: 'Your site', introductions: 'Introductions', declarations: 'Declarations',
    orders: 'Waiting on you', fees: 'Fees and standing', education: 'Education' };

  function renderNav(needs) {
    var flagged = {};
    needs.forEach(function (n) { flagged[n.to] = true; });
    var links = SECTIONS.filter(function (id) { return el(id) && !el(id).hidden; }).map(function (id) {
      return '<a href="#' + id + '">' + esc(NAV_LABEL[id]) +
        (flagged[id] ? '<span class="acct-nav__dot" aria-hidden="true"></span>' : '') + '</a>';
    });
    fill('acctNav', links.join(''));
    var wrap = document.querySelector('.acct-wrap');
    if (wrap) wrap.classList.add('has-nav');
  }

  function clearChrome() {
    hide('acctNeeds');
    hide('acctNav');
    var wrap = document.querySelector('.acct-wrap');
    if (wrap) wrap.classList.remove('has-nav');
  }

  /* ═══════════ page states ═══════════ */
  function showLoading() {
    if (el('acctLoading')) el('acctLoading').hidden = false;
    if (el('acctError')) el('acctError').hidden = true;
    if (el('signInPrompt')) el('signInPrompt').hidden = true;
  }
  function showSignedOut() {
    if (el('acctLoading')) el('acctLoading').hidden = true;
    if (el('acctError')) el('acctError').hidden = true;
    SECTIONS.forEach(hide);
    clearChrome();
    fill('signInPrompt',
      '<div class="panel" style="max-width:480px;margin:24px auto;text-align:center">' +
        '<h2 style="margin-bottom:10px">Sign in to see your account</h2>' +
        '<p class="body" style="margin-bottom:22px">Introductions, declarations and your host standing, all in one place once you are signed in.</p>' +
        '<div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">' +
          '<button class="btn btn-primary" type="button" data-act="signin">Sign in</button>' +
          '<button class="btn btn-outline" type="button" data-act="join">Create your hub account</button>' +
        '</div>' +
      '</div>');
  }
  /* The page with nothing on it but one notice. */
  function showNotice(html) {
    if (el('acctLoading')) el('acctLoading').hidden = true;
    if (el('signInPrompt')) el('signInPrompt').hidden = true;
    SECTIONS.forEach(hide);
    clearChrome();
    var e = el('acctError');
    if (!e) return;
    e.innerHTML = html;
    e.hidden = false;
  }
  var HELLO = '<a href="mailto:hello@nexpoint.co.uk">hello@nexpoint.co.uk</a>';
  function showError() {
    showNotice('That did not load. Check your connection and try again, or email ' + HELLO + '.');
  }
  /* A removed organisation's people can still sign in, and the worker refuses
     them everything else. That is not a fault in their connection, so it does
     not say so. */
  function showRemoved() {
    showNotice('This account has been removed from the hub, so there is nothing to show here. Nothing has been deleted. If you were not expecting this, email ' + HELLO + ' and we will look at it with you.');
  }

  /* Why the worker would not hand over the summary. It refuses in its own
     words ("sign in required" on a 401, "email_unconfirmed" or
     "account_removed" on a 403) and NP.api passes those through with
     http_status beside them; only a refusal with no error word arrives as
     http_401 or http_403. This page once looked for those two alone, so a
     lapsed sign-in and a removed account both read as a dropped connection
     (21 September 2026). */
  function refusalOf(d) {
    if (!d) return '';
    if (d.error === 'account_removed') return 'removed';
    if (d.http_status === 401 || d.http_status === 403 ||
        d.error === 'http_401' || d.error === 'http_403' ||
        d.error === 'sign in required' || d.error === 'email_unconfirmed') return 'signed-out';
    return '';
  }

  function render(d) {
    if (el('acctLoading')) el('acctLoading').hidden = true;
    if (el('acctError')) el('acctError').hidden = true;
    if (el('signInPrompt')) el('signInPrompt').hidden = true;
    var s = siteOf(d);
    var byId = {};
    (Array.isArray(d.introductions) ? d.introductions : []).forEach(function (i) { byId[i.id] = i; });
    renderProfile(d, s);
    renderIntroductions(d);
    renderDeclarations(d, s, byId);
    renderOrders(d);
    renderFees(d, s);
    renderEducation();
    var needs = needsOf(d, s);
    renderNeeds(needs);
    renderNav(needs);
  }

  /* ═══════════ loading ═══════════ */
  var seq = 0, queued = null;
  /* The account module both resolves its ready promise and fires
     npaccount:change for the same refresh, and this page listens for both, so
     a load is queued rather than fired: two triggers for one change fetch the
     summary once. */
  function load() {
    clearTimeout(queued);
    queued = setTimeout(doLoad, 0);
  }
  function doLoad() {
    if (!window.NPAccount || !NPAccount.user) { showSignedOut(); return; }
    var mine = ++seq;
    showLoading();
    api('/account/summary').then(function (d) {
      if (mine !== seq) return;
      if (!d || d.error) {
        var refusal = refusalOf(d);
        if (refusal === 'removed') showRemoved();
        else if (refusal === 'signed-out') showSignedOut();
        else showError();
        return;
      }
      if (d.signed_in === false) { showSignedOut(); return; }
      loadVocab().then(function () { if (mine === seq) render(d); });
    });
  }

  /* ═══════════ what the buttons do ═══════════ */
  function gate(fn) {
    if (window.NPAccount && NPAccount.requireConfirmed) NPAccount.requireConfirmed(fn);
    else fn();
  }
  /* A route the worker has not shipped yet answers 404. That is "not open
     yet", not a failure, and it says so in the section's own words. */
  function isNotBuilt(d) { return d && d.error === 'http_404'; }

  var GENERIC_ERROR = 'That did not go through. Try again, or email hello@nexpoint.co.uk.';
  /* The worker's line-level refusals for POST /declarations, in the host's
     own words rather than the generic sentence above. Anything not listed
     here (including no error code at all) keeps the generic sentence. */
  var DECL_ERRORS = {
    line_value_required: 'Every line needs a value. Enter one, or tick Nothing for that introduction.',
    line_currency_invalid: 'Choose a currency from the list.',
    not_your_introduction: 'One of these introductions is not yours to declare. Reload the page and try again.',
    period_out_of_range: 'That month is not open for declarations.',
    statement_issued: 'That month is already on a statement and cannot be changed. Email hello@nexpoint.co.uk if something is wrong.',
    nothing_or_lines: 'Either tick Nothing for every introduction or enter at least one line.',
  };
  function declError(code) { return DECL_ERRORS[code] || GENERIC_ERROR; }

  /* A successful action changes what the summary says, so the page reloads it.
     The pause is only so the reader sees the line that says it worked before
     the section is rewritten underneath it. */
  function reload() { setTimeout(load, 1200); }

  function busy(btn, label) {
    if (!btn) return function () {};
    var orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = label;
    return function () { btn.disabled = false; btn.textContent = orig; };
  }

  function submitDeclaration(btn) {
    var period = btn.getAttribute('data-period') || '';
    var hub = btn.getAttribute('data-hub') || '';
    var msg = el('declMsg-' + period);
    var lines = [];
    var blocked = null;
    var prefix = 'decl-' + period + '-';
    var table = btn.closest('.acct-card');
    if (table) {
      /* prefix is built from period, API text off data-period rather than
         anything this page chose - CSS.escape it before it goes into a
         selector. The ids it is compared against below go through el(), a
         plain getElementById lookup that needs no escaping of its own. */
      Array.prototype.forEach.call(table.querySelectorAll('input[id^="' + CSS.escape(prefix) + '"][id$="-units"]'), function (u) {
        if (blocked) return;
        var introId = u.id.slice(prefix.length, u.id.length - '-units'.length);
        var nothing = el(prefix + introId + '-nothing');
        if (nothing && nothing.checked) return;
        var value = el(prefix + introId + '-value');
        var currency = el(prefix + introId + '-currency');
        var units = u.value === '' ? null : Number(u.value);
        var val = (!value || value.value === '') ? null : Number(value.value);
        if (units == null && val == null) return;
        /* Units typed but no value: the worker refuses the whole submission
           for this (line_value_required), so catch it here and point at the
           one row that needs fixing instead of sending it. A value with no
           units is fine - units are optional. */
        if (units != null && val == null) {
          var row = u.closest('tr');
          var ref = (row && row.getAttribute('data-ref')) || introId;
          blocked = { input: value, ref: ref };
          return;
        }
        lines.push({ introduction_id: /^\d+$/.test(introId) ? Number(introId) : introId,
          units: units, value: val, currency: currency ? currency.value : 'GBP' });
      });
    }
    if (blocked) {
      say(msg, 'Enter a value for ' + blocked.ref + ', or tick Nothing.', true);
      if (blocked.input) blocked.input.focus();
      return;
    }
    var done = busy(btn, 'Sending…');
    post('/declarations', { hub: hub, period: period, nothing_this_month: lines.length === 0, lines: lines })
      .then(function (d) {
        if (d && d.ok) { say(msg, 'Sent. Thank you.'); reload(); return; }
        done();
        if (isNotBuilt(d)) { say(msg, 'Declarations open soon.'); return; }
        say(msg, declError(d && d.error), true);
      });
  }

  function answerLine(btn, action) {
    var id = btn.getAttribute('data-line');
    var kind = btn.getAttribute('data-kind');
    var msg = el('lineMsg-' + id);
    var noteEl = el('dispute-' + id);
    var note = noteEl ? noteEl.value.trim() : '';
    var done = busy(btn, action === 'confirm' ? 'Confirming…' : 'Sending…');
    var p = kind === 'order'
      ? post('/orders/' + (action === 'confirm' ? 'confirm' : 'dispute'), { order_id: Number(id), note: note })
      : post('/declarations/lines/' + encodeURIComponent(id) + '/' + action, { note: note });
    p.then(function (d) {
      if (d && d.ok) { say(msg, action === 'confirm' ? 'Confirmed. Thank you.' : 'Query sent. We will look at it.'); reload(); return; }
      done();
      if (isNotBuilt(d)) { say(msg, 'Declarations open soon.'); return; }
      say(msg, 'That did not go through. Try again, or email hello@nexpoint.co.uk.', true);
    });
  }

  function resendIntro(btn) {
    var id = btn.getAttribute('data-intro');
    var msg = el('introMsg-' + id);
    var done = busy(btn, 'Sending…');
    post('/introductions/' + encodeURIComponent(id) + '/resend', {}).then(function (d) {
      if (d && d.ok) { say(msg, 'Sent again.'); btn.disabled = true; btn.textContent = 'Sent again'; return; }
      done();
      if (isNotBuilt(d)) { say(msg, 'We could not resend that just now. Email hello@nexpoint.co.uk and we will send it again.'); return; }
      /* Plan 037: the worker's three named refusals in the host's own words.
         "Try again" was the wrong advice for every one of them. */
      var code = d && d.error;
      if (code === 'too_soon') { say(msg, 'Sent in the last two minutes. Check your spam folder before asking again.'); return; }
      if (code === 'no owner address for this organisation') { say(msg, 'Your organisation has no owner address on file. Email hello@nexpoint.co.uk and we will send it by hand.', true); return; }
      if (code === 'this introduction is no longer open') { say(msg, 'This introduction is no longer open, so there is nothing to send again. If that looks wrong, email hello@nexpoint.co.uk.'); return; }
      /* The email provider refused the message (code review, 4 October
         2026). The worker counts the attempt towards its two-minute wait,
         so the advice is a few minutes, not "try again" at once. */
      if (code === 'send_failed') { say(msg, 'We could not send that just now. Try again in a few minutes, or email hello@nexpoint.co.uk and we will send it by hand.', true); return; }
      say(msg, 'That did not go through. Try again, or email hello@nexpoint.co.uk.', true);
    });
  }

  function onClick(e) {
    var btn = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    if (!btn) return;
    var act = btn.getAttribute('data-act');
    if (act === 'signin') { if (window.openSignIn) openSignIn(); return; }
    if (act === 'join') { if (window.NPAccount) NPAccount.openQuestionnaire({}); return; }
    if (act === 'education') { if (window.openEducationList) openEducationList(); return; }
    if (act === 'line-query') {
      var box = el('lineNote-' + btn.getAttribute('data-line'));
      if (box) box.hidden = !box.hidden;
      return;
    }
    if (act === 'decl-submit') { gate(function () { submitDeclaration(btn); }); return; }
    if (act === 'line-confirm') { gate(function () { answerLine(btn, 'confirm'); }); return; }
    if (act === 'line-query-send') { gate(function () { answerLine(btn, 'dispute'); }); return; }
    if (act === 'intro-resend') { gate(function () { resendIntro(btn); }); return; }
  }

  /* ═══════════ boot ═══════════ */
  function init() {
    var wrap = document.querySelector('.acct-wrap');
    if (wrap) wrap.addEventListener('click', onClick);
    if (!window.NPAccount) { showSignedOut(); return; }
    document.addEventListener('npaccount:change', load);
    NPAccount.ready.then(load);
  }

  window.NPDashboard = { init: init };
})();

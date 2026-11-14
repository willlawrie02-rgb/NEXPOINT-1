/* NexPoint Global Portal - the account dashboard.
   One page, six sections, one GET /account/summary. The logo, the reader's
   own details and the account's users live on the settings page
   (hub/account/settings/, people.js); this page only reads the logo. Every section owns its
   own empty copy, so a key the worker has not shipped yet leaves that section
   saying something sensible rather than breaking the page: a missing key is
   never an error. Started by portal.js's np:modules boot, like every other
   page module.                                                              */
(function () {
  'use strict';

  /* ── the words a hub is known by ────────────────────────────────── */
  var HUBS = ['print', 'mill'];
  var HUB_LABEL = { print: '3D Print Hub', mill: 'Mill Hub', opportunities: 'Opportunities Board' };
  var HUB_LISTING = {
    print: 'https://printhub.nexpoint.co.uk/offer.html',
    mill: 'https://millhub.nexpoint.co.uk/offer.html',
  };
  /* The door with the four hub cards: where an account that has done nothing
     yet is sent (plan 046, record B2). Spelt as the page's own links spell
     it, so the Go to the Global Portal button and this line land in one place. */
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
  /* Only the hubs this account touches are read: two per hub-kind round trip
     each, so a Print-only account no longer waits on Mill's seven requests. */
  function hubsOf(d) {
    var seen = {};
    [d.hubs_used, d.listings, d.requests, d.offers, d.introductions].forEach(function (x) {
      (Array.isArray(x) ? x : []).forEach(function (r) {
        var h = typeof r === 'string' ? r : r && r.hub;
        if (h === 'print' || h === 'mill') seen[h] = true;
      });
    });
    return Object.keys(seen);
  }
  function loadVocab(hubs) {
    if (!window.NPVocab) return Promise.resolve();
    return Promise.all(hubs.map(function (h) {
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

  /* In page order. Waiting on you sits directly under the banner (plan 055,
     decision 10); the logo, You and Users moved to the settings page. */
  var SECTIONS = ['profile', 'waiting', 'introductions', 'declarations', 'fees', 'yourTerms', 'education'];

  /* ── the account, as this page reads it ─────────────────────────── */
  function siteOf(d) {
    var org = d.org || {};
    var site = d.site || {};
    var pick = function (a, b) { return a != null && a !== '' ? a : b; };
    return {
      name: pick(site.name, org.name) || 'Your account',
      town: site.town || '',
      country: site.country || '',
      host_print: pick(site.host_print, org.host_print) || 'none',
      host_mill: pick(site.host_mill, org.host_mill) || 'none',
      sub_status: pick(site.sub_status, org.sub_status) || '',
      /* Plan 095: two reasons a listing is not showing, told apart. Each reads
         the worker's new field when it is there and falls back to what an
         older worker sends. hiddenUnpaid is the automatic hide for an unpaid
         membership invoice; pausedByDesk is a person's pause. */
      hiddenUnpaid: site.hidden_unpaid != null ? !!site.hidden_unpaid : (org.sub_status === 'hidden'),
      pausedByDesk: site.paused_by_desk != null ? !!site.paused_by_desk
        : (!!site.paused && org.sub_status !== 'hidden'),
      invoice: d.membership_invoice && typeof d.membership_invoice === 'object' ? d.membership_invoice : null,
      verified: !!site.verified,
      /* Plan 069: the closed shape, when the holder closed the account. */
      closed: d.closed && typeof d.closed === 'object' ? d.closed : null,
    };
  }
  function isHost(s) { return s.host_print === 'approved' || s.host_mill === 'approved'; }
  /* A closed host's declarations and statements carry on for the customers
     it was introduced to (Host Agreement §14), so those two
     sections stay while anything is inside its fee years or on a statement. */
  function closedHost(d, s) {
    return !!(s.closed && s.closed.host_was &&
      ((Number(s.closed.relationships_live) || 0) > 0 || (Array.isArray(d.statements) && d.statements.length)));
  }
  function hostHubs(s) {
    return HUBS.filter(function (h) { return s['host_' + h] === 'approved'; });
  }
  /* Plan 070: a company that sells through an accepted introduction on the
     Opportunities Board declares and is billed like a host, without being
     one; its Declarations and Fees sections show for it too. */
  function boardSeller(d) {
    return (Array.isArray(d.introductions) ? d.introductions : []).some(function (i) {
      return onBoard(i) && i.seller && acceptedStage(i.stage) && i.fee_model !== 'success_fee';
    });
  }
  /* A board introduction, as the worker decides it (its hub); the opportunity
     may be missing when an old row's brief no longer resolves. */
  function onBoard(i) { return !!i && (i.hub === 'opportunities' || !!i.opportunity); }

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

    var html =
      '<div class="acct-id">' +
        '<span class="acct-pic" id="acctPic" data-initials="' + esc(initials(s.name)) + '">' + monogram(initials(s.name)) + '</span>' +
        '<div class="acct-id__text"><h2>' + esc(s.name) + '</h2>' +
        '<p class="hint">Site account' + (where ? ' · ' + esc(where) : '') + '</p></div>' +
      '</div>' +
      '<a class="btn btn-outline acct-btn-sm acct-edit" href="settings/">' + (s.closed ? 'Account settings' : 'Edit account or add users') + '</a>' +
      (s.closed ? '<div class="acct-badges"><span class="acct-badge">Closed ' + esc(fmtDate(s.closed.at)) + '</span></div>' : '') +
      (badges.length && !s.closed ? '<div class="acct-badges">' + badges.join('') + '</div>' : '') +
      listingNotice(s) +
      listingRows(d, s);
    fill('profile', html);
    loadLogo();
  }

  /* Why a host's listing is not showing, and the membership invoice that is
     due (plan 095; audit of 14 November 2026). A person's pause and the
     automatic hide for an unpaid membership invoice are two states, and both
     can hold at once: paying lifts the second and never the first, so each
     has its own words. The page never says who paused a listing or why;
     those stay with NexPoint. The button is the link the invoice email
     carries, drawn only when it has the shape of one.
     Uses only esc, fmtDate, isHost and HELLO, so check/review.mjs can lift it
     out and run every row of the plan's table. */
  function listingNotice(s) {
    if (s.closed || !isHost(s)) return '';
    var inv = s.invoice && s.invoice.number && s.invoice.amount_text ? s.invoice : null;
    var bill = inv ? 'invoice ' + esc(inv.number) + ' for ' + esc(inv.amount_text) : '';
    var payUrl = inv && typeof inv.pay_url === 'string' &&
      /^https?:\/\/[^\/\s]+\/membership\/pay\/[0-9a-f]{64}$/.test(inv.pay_url) ? inv.pay_url : '';
    var words;
    var alarm = true;
    var payable = true;
    if (s.pausedByDesk && s.hiddenUnpaid) {
      words = 'Your listing is hidden from the hubs. ' + (inv ? 'Membership ' + bill : 'Your membership invoice') +
        ' is unpaid, and NexPoint has also paused your listing, so paying does not bring it back on its own. Email ' +
        HELLO + ' and we will tell you what happens next.';
    } else if (s.pausedByDesk) {
      payable = false;
      words = 'NexPoint has paused your listing, so nobody searching the hubs can see it. Email ' + HELLO +
        ' and we will tell you why and what happens next.';
    } else if (s.hiddenUnpaid) {
      words = 'Your listing is hidden from the hubs because ' + (inv ? 'membership ' + bill : 'your membership invoice') +
        ' is unpaid. Nothing has been deleted, and your listing comes back once the payment reaches us.' +
        (inv ? '' : ' The invoice email has the button to pay; email ' + HELLO + ' if you cannot find it.');
    } else if (inv) {
      /* A bill that is simply due: said plainly, not as an alarm. */
      alarm = false;
      words = 'Membership ' + bill + (inv.due_on ? ' is due by ' + esc(fmtDate(inv.due_on)) + '.' : ' is waiting to be paid.');
    } else {
      return '';
    }
    var button = payable && payUrl;
    return (alarm ? '<div class="acct-notice">' + words + '</div>' : '<p class="hint" style="margin:14px 0 0">' + words + '</p>') +
      (button
        ? '<div class="modal-actions" style="margin-top:14px"><a class="btn btn-primary acct-btn-sm" href="' + esc(payUrl) +
            '" target="_blank" rel="noopener">Pay the invoice</a></div>' +
          /* the line the invoice email ends on, under the rows that say "unpaid" */
          (alarm ? '<p class="hint" style="margin:10px 0 0">Paid already? A payment can take a few working days to reach us. Email ' +
            HELLO + ' if you would like us to check.</p>' : '')
        : '');
  }

  /* ── the logo (plan 055, decision 25) ─────────────────────────────
     The account's logo takes the monogram's place when there is one. It is
     added, changed and removed on the settings page (people.js); this page
     only reads it. The worker keeps it in a private bucket and answers a
     link that works for a minute, read fresh on every render; a 401, a 404
     (the route not shipped yet) or no logo at all leaves the monogram. */
  function monogram(text) {
    return '<span class="acct-mono" aria-hidden="true">' + esc(text) + '</span>';
  }
  function showLogo(url) {
    var pic = el('acctPic');
    if (!pic) return;
    if (url) {
      pic.innerHTML = '<img class="acct-mono acct-mono--pic" alt="Your logo">';
      var img = pic.firstChild;
      img.onerror = function () { showLogo(null); };
      img.src = url;
    } else {
      pic.innerHTML = monogram(pic.getAttribute('data-initials'));
    }
  }
  function loadLogo() {
    api('/account/logo').then(function (d) { showLogo(d && !d.error ? d.url : null); });
  }

  function listingRows(d, s) {
    var listings = Array.isArray(d.listings) ? d.listings : null;
    if (!listings) {
      return isHost(s) ? empty('Your listing status appears here.', 'storefront') : '';
    }
    if (!listings.length) return isHost(s) ? empty('Your listing status appears here.', 'storefront') : '';
    /* Plan 095: a listing that is paused or hidden for an unpaid invoice is
       approved but not showing, so its row must not read as live. */
    var off = !!(s.hiddenUnpaid || s.pausedByDesk);
    return group(listings.map(function (l) {
      var st = l.status || 'none';
      var live = l.live || {};
      var pending = l.pending || {};
      var text;
      if (st === 'live' && off) text = 'Approved ' + fmtDate(live.approved_at) + '. Hidden from seekers for now.';
      else if (st === 'live_pending_edit' && off) text = 'Approved ' + fmtDate(live.approved_at) + '. Hidden from seekers for now. Pending review since ' + fmtDate(pending.submitted_at) + '.';
      else if (st === 'live') text = 'Live since ' + fmtDate(live.approved_at);
      else if (st === 'live_pending_edit') text = 'Live since ' + fmtDate(live.approved_at) + '. Pending review since ' + fmtDate(pending.submitted_at) + '.';
      else if (st === 'pending') text = 'Pending review since ' + fmtDate(pending.submitted_at);
      else text = 'Not listed';
      var locked = st === 'pending' || st === 'live_pending_edit';
      var href = HUB_LISTING[l.hub];
      var action = locked
        ? '<span class="acct-disabled" aria-disabled="true">Edit listing</span>'
        : (href ? '<a class="acct-link" href="' + esc(href) + '">Edit listing</a>' : '');
      var dot = st === 'live' && !off ? 'is-live' : locked ? 'is-pending' : '';
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
    var stop = stage === 'declined' ? 'Declined' : stage === 'expired' ? 'Expired' : stage === 'dead' ? 'Closed' : '';
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

  /* The one line an introduced row ends on (plan 052 item 26). The other
     side's details travel in the plain-text introduction email only, so the
     page says where it is and how to carry on, and shows no address. */
  /* Plan 095: the line no longer says "in your inbox" when the worker says
     the email with each other's details did not go, or is still on its way.
     state is 'failed-host' (the side that can send it again), 'failed-other',
     'waiting', or anything else for the line as it always read. */
  function inboxLine(ref, date, state) {
    var tail = state === 'failed-host'
      ? 'The email that gives you both each other\'s details did not go. Send it again with the button here, or email hello@nexpoint.co.uk and we will send it by hand.'
      : state === 'failed-other'
        ? 'The email with each other\'s details has not gone yet. NexPoint has been told and will send it.'
        : state === 'waiting'
          ? 'The introduction email is on its way.'
          : 'The introduction is in your inbox; reply to all to carry on.';
    return '<div class="acct-released"><span>' + esc(
      (date ? 'Introduced on ' + fmtDate(date) + ', ref ' + ref + '. ' : 'Introduced, ref ' + ref + '. ') +
      tail) + '</span></div>';
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
    /* Plan 067: the seeker saw the site's name at the search, so its pick
       is named; a card from before carries no company and reads as before. */
    var company = (card.company && typeof card.company === 'string') ? card.company.trim() : '';
    return '<div class="acct-pick">' +
      (company ? '<b class="acct-company">' + esc(company) + '</b>' : '') +
      (p.ref ? '<b class="acct-ref">' + esc(p.ref) + '</b>' : '') +
      (rows.length ? '<dl>' + rows.map(function (r) {
        return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>';
      }).join('') + '</dl>' : '') +
      statusChain(p.stage) +
      (accepted ? inboxLine(p.ref || (intro && intro.ref) || '', introDate(intro),
        intro && intro.stage === 'introduced' && intro.release === 'failed' ? 'failed-other'
          : (intro && intro.stage === 'introduced' && intro.release === 'waiting' ? 'waiting' : '')) : '') +
    '</div>';
  }

  /* Rigid, soft or both, in words (plan 080): the same words as find.js, labels.js,
     desk.py and app/jobs.js. An unknown value has no words, so nothing prints. */
  var DEVICE_WORDS = { rigid: 'Rigid shell', soft: 'Soft insole', both: 'Rigid shell and soft insole' };
  function deviceWords(r) {
    return (r && Object.prototype.hasOwnProperty.call(DEVICE_WORDS, r.device_type)) ? DEVICE_WORDS[r.device_type] : '';
  }

  function requestCard(r, byId, tag) {
    var picks = Array.isArray(r.picks) ? r.picks : [];
    var facts = [deviceWords(r), lab('material', r.hub, r.material), r.quantity, lab('cadence', r.hub, r.cadence)].filter(Boolean).map(String).join(' · ');
    var body;
    /* Picks win over the flag: a request routed by hand keeps no_match, and its
       pick must still show. The flag only words the empty state. */
    if (!picks.length) {
      body = r.no_match
        ? empty('No match yet. We are still looking, and will write the moment there is one.', 'travel_explore')
        : empty('With NexPoint. Nothing has been put forward yet.', 'hourglass_top');
    } else {
      body = '<p class="hint">The ' + (picks.length === 1
          ? (r.hub === 'mill' ? 'cell' : 'site') + ' you picked'
          : (r.hub === 'mill' ? 'cells' : 'sites') + ' on this request (' + picks.length + ')') + '</p>' +
        picks.map(function (p) { return pickBlock(p, byId[p.introduction_id], r.hub); }).join('');
    }
    return '<div class="acct-card">' +
      '<h3>' + refLine(requestRefs(r), r.hub, 'Your request') + tagHtml(tag) + '</h3>' +
      '<p class="hint">' + esc([facts, r.created_at ? 'Requested ' + fmtDate(r.created_at) : ''].filter(Boolean).join(' · ')) + '</p>' +
      body +
    '</div>';
  }

  function providerLine(i) {
    /* Plan 070: on the Opportunities Board the company behind the
       opportunity answers; the company that asked waits on it. */
    if (onBoard(i) && !i.asked && i.stage === 'awaiting_acceptance') return 'With the company behind the opportunity.';
    if (i.stage === 'awaiting_acceptance') return 'Waiting for your answer.';
    if (i.stage === 'approved') return 'Approved by NexPoint.';
    if (i.stage === 'introduced') return 'Introduced.';
    if (i.stage === 'declined') return 'Declined.';
    if (i.stage === 'expired') return 'Expired.';
    if (i.stage === 'dead') return 'Closed.';
    if (i.stage === 'proposed') return 'With NexPoint.';
    /* Only the stages that mean a live introduction read as introduced; a stage
       this page does not know says nothing rather than something untrue. */
    return acceptedStage(i.stage) ? 'Introduced.' : '';
  }

  /* What a provider is being asked for, in the anonymised terms the offer
     carries. No seeker is named here: nothing is released before acceptance. */
  function offerLine(o) {
    if (!o || !o.request) return '';
    var r = o.request;
    return [deviceWords(r), lab('material', o.hub, r.material), lab('process', o.hub, r.process), r.quantity, lab('cadence', o.hub, r.cadence),
      r.max_lead_time_days != null ? 'within ' + r.max_lead_time_days + ' days' : '',
      [r.town, r.country].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
  }

  /* Can the provider answer this one here? The worker's own gate
     (notAnswerable) in the page's terms: awaiting, with a window, not past it. */
  function answerable(i) {
    return i.stage === 'awaiting_acceptance' && !!i.acceptance_expires_at &&
      new Date(i.acceptance_expires_at).getTime() > Date.now();
  }

  /* Accept or decline in the account (plan 052 items 21, 22): the same
     choice the emailed link offers, through POST /introductions/accept and
     /decline. Accept asks for no terms, unless the seller holds no current
     Host Agreement (Host §2; plan 078, D7): its block then goes in the box
     below. Decline opens an optional reason for the desk. Both panels start
     closed. */
  function answerPanel(i) {
    var id = esc(i.id);
    /* On the board the company that asked is told, not a seeker. */
    var board = onBoard(i);
    return '<div class="acct-answer" id="introAnswer-' + id + '" hidden>' +
        '<p class="hint">' + (board
          ? 'Accept and the introduction goes to you both by email, with each other\'s details. ' +
            'Decline and the other company is told only that you said no, never why.'
          : 'Accept and the introduction goes to you both by email, with each other\'s details. ' +
            'Decline and the seeker is told a site said no, and nothing else.') + '</p>' +
        '<div class="acct-answer__terms" id="introTerms-' + id + '"></div>' +
        '<button class="btn btn-primary acct-btn-sm" type="button" data-act="intro-accept-send" data-intro="' + id + '">Accept the introduction</button>' +
      '</div>' +
      '<div class="acct-answer" id="introDecline-' + id + '" hidden>' +
        '<label class="hint" for="introReason-' + id + '">Tell us why, if you like. This goes to the NexPoint desk, not to ' +
          (board ? 'the other company' : 'the seeker') + '.</label>' +
        '<textarea id="introReason-' + id + '" rows="3" placeholder="' + (board ? 'Not the right fit for us at the moment'
          : 'Too far out, wrong material, no capacity that month') + '"></textarea>' +
        '<button class="btn btn-primary acct-btn-sm" type="button" data-act="intro-decline-send" data-intro="' + id + '">Send my decline</button>' +
      '</div>';
  }

  /* The need box (plan 055, decision 7): what the seeker asked for, in the
     rows the offer email uses, pinned open on the Request pin of the pair
     map. Nobody is named: a request is a specification. */
  function needBoxHtml(r, hub) {
    if (!r) return '';
    var rows = [];
    var one = function (n, s, p) { return Number(n) === 1 ? n + ' ' + s : n + ' ' + p; };
    var words = deviceWords(r);
    if (words) rows.push(['Product', words]);
    var material = lab('material', hub, r.material);
    if (material) rows.push(['Material', material]);
    var process = lab('process', hub, r.process);
    if (process) rows.push(['Process', process]);
    if (r.quantity != null && r.quantity !== '') rows.push(['Quantity', one(r.quantity, 'unit', 'units')]);
    var cadence = lab('cadence', hub, r.cadence);
    if (cadence) rows.push(['Cadence', cadence]);
    if (r.max_lead_time_days != null && r.max_lead_time_days !== '') rows.push(['Lead time', 'within ' + one(r.max_lead_time_days, 'day', 'days')]);
    if (r.needed_by) rows.push(['Needed by', fmtDate(r.needed_by)]);
    var services = (Array.isArray(r.services) ? r.services : []).map(function (s) { return lab('service', hub, s); }).filter(Boolean);
    if (services.length) rows.push(['Services', services.join(', ')]);
    var where = [r.town, r.country].filter(Boolean).join(', ');
    return '<div class="np-need">' +
      '<b class="np-need__head">What they need</b>' +
      (where ? '<span class="np-need__where">' + esc(where) + '</span>' : '') +
      (rows.length ? '<dl>' + rows.map(function (row) {
        return '<dt>' + esc(row[0]) + '</dt><dd>' + esc(row[1]) + '</dd>';
      }).join('') + '</dl>' : '') +
      (r.notes ? '<p class="np-need__notes"><b>Notes</b>' + esc(r.notes) + '</p>' : '') +
    '</div>';
  }

  /* The provider's pair map (plan 052, item 24; plan 055, decision 7): on
     every provider row that carries an offer, whatever its stage, the
     request's town and the provider's own site, two pins and nothing to
     choose, with the need box open on the Request pin. Only a town's point
     ever reaches it; the box stays hidden until the map script has drawn
     into it, and never appears without points. */
  function pairMapBox(i, offer) {
    if (!offer) return '';
    var r = offer.request || {};
    var any = (r.point && typeof r.point.lat === 'number') || (offer.site && offer.site.point);
    if (!any) return '';
    return '<div class="np-map np-map--pair np-map--need" id="pairMap-' + esc(i.id) + '" aria-label="Where the request and your site are" hidden></div>';
  }
  var pairMaps = [];
  function mountPairMaps(intros, offerBy) {
    pairMaps.forEach(function (m) { m.destroy(); });
    pairMaps = [];
    if (!window.NPMatchMap) return;
    intros.forEach(function (i) {
      var o = offerBy[i.id];
      var box = el('pairMap-' + i.id);
      if (!o || !box) return;
      var r = o.request || {};
      box.hidden = false;
      var handle = NPMatchMap.mountPair({
        el: box,
        seeker: r.point ? { town: r.town || '', country: r.country || '', point: r.point } : null,
        site: o.site || null,
        popup: needBoxHtml(r, o.hub || i.hub),
      });
      if (!handle) { box.hidden = true; return; }
      handle.refresh();
      pairMaps.push(handle);
    });
  }

  /* The small tag on a card when the account has both kinds of introduction
     (plan 055, decision 8): which side of it the reader is on. */
  function tagHtml(tag) { return tag ? '<span class="acct-tag">' + esc(tag) + '</span>' : ''; }

  function introRow(i, showResend, offer, tag) {
    var extra = [];
    /* Plan 070: a board introduction names its opportunity, and to the owner
       what the company asking said and where it is (never who). */
    if (i.opportunity) extra.push(['Opportunity ' + (i.opportunity.ref || ''), i.opportunity.title].filter(Boolean).join(', '));
    if (i.ask) {
      /* the member's own words, or the desk's summary of what it wants */
      var said = [i.ask.what_they_said ? (i.ask.from_request === false ? 'What they are looking for: ' : 'What they said: ') +
          i.ask.what_they_said : '',
        [i.ask.town, i.ask.country].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
      if (said) extra.push(said);
    }
    var asked = offerLine(offer);
    if (asked) extra.push(asked);
    if (i.stage === 'awaiting_acceptance' && i.acceptance_expires_at) extra.push('Open until ' + fmtDate(i.acceptance_expires_at) + '.');
    var accepted = acceptedStage(i.stage);
    var canAnswer = showResend && answerable(i);
    /* Plan 095: the worker says whether the email that gives both sides each
       other's details went. Only the answering side can send it again. */
    var releaseFailed = i.stage === 'introduced' && i.release === 'failed';
    var canResendRelease = showResend && releaseFailed;
    var releaseState = releaseFailed ? (showResend ? 'failed-host' : 'failed-other')
      : (i.stage === 'introduced' && i.release === 'waiting' ? 'waiting' : '');
    return '<div class="acct-row" id="intro-' + esc(i.id) + '">' +
      '<div class="acct-row__meta">' +
        '<b>' + refLine(i.ref, i.hub) + tagHtml(tag) + '</b>' +
        '<span>' + esc(providerLine(i)) + '</span>' +
        extra.map(function (x) { return '<span>' + esc(x) + '</span>'; }).join('') +
        pairMapBox(i, offer) +
        statusChain(i.stage) +
        (accepted ? inboxLine(i.ref || '', introDate(i), releaseState) : '') +
        (canAnswer ? answerPanel(i) : '') +
      '</div>' +
      '<div class="acct-row__actions">' +
        (canAnswer
          ? '<button class="btn btn-primary acct-btn-sm" type="button" data-act="intro-accept-open" data-intro="' + esc(i.id) + '">Review and accept</button>' +
            '<button class="btn btn-outline acct-btn-sm" type="button" data-act="intro-decline-open" data-intro="' + esc(i.id) + '">Decline</button>'
          : '') +
        (showResend && i.stage === 'awaiting_acceptance'
          ? '<button class="btn btn-outline acct-btn-sm" type="button" data-act="intro-resend" data-intro="' + esc(i.id) + '">Send the email again</button>'
          : '') +
        (canResendRelease
          ? '<button class="btn btn-primary acct-btn-sm" type="button" data-act="intro-resend" data-intro="' + esc(i.id) + '">Send the introduction email again</button>'
          : '') +
        (showResend && (i.stage === 'awaiting_acceptance' || canResendRelease)
          ? '<span class="acct-msg" id="introMsg-' + esc(i.id) + '" hidden></span>'
          : '') +
      '</div>' +
    '</div>';
  }

  /* One list (plan 055, decision 8): the seeker's request cards and the
     provider's rows together, newest first. A side tag only when the account
     is on both sides of the hub. */
  function when(iso) {
    var ms = iso ? new Date(iso).getTime() : 0;
    return isNaN(ms) ? 0 : ms;
  }
  function renderIntroductions(d) {
    var intros = Array.isArray(d.introductions) ? d.introductions : [];
    var requests = Array.isArray(d.requests) ? d.requests : [];
    var byId = {};
    intros.forEach(function (i) { byId[i.id] = i; });

    var pickIds = {};
    requests.forEach(function (r) {
      (Array.isArray(r.picks) ? r.picks : []).forEach(function (p) { pickIds[p.introduction_id] = true; });
    });

    var offerBy = {};
    (Array.isArray(d.offers) ? d.offers : []).forEach(function (o) { offerBy[o.introduction_id] = o; });

    var provider = intros.filter(function (i) { return i.role === 'provider'; });
    /* Anything on the seeker's side that no request card already shows: an
       older summary's flat list, or a seeker introduction with no request
       behind it. It still renders, on the same chain, rather than going
       missing. */
    var other = intros.filter(function (i) { return i.role !== 'provider' && !pickIds[i.id]; });

    var both = (requests.length || other.length) && provider.length;
    var items = [];
    requests.forEach(function (r) { items.push({ at: when(r.created_at), html: requestCard(r, byId, both ? 'You asked' : '') }); });
    provider.forEach(function (i) { items.push({ at: when(i.created_at), html: introRow(i, true, offerBy[i.id], both ? 'Asked of you' : '') }); });
    other.forEach(function (i) { items.push({ at: when(i.created_at), html: introRow(i, false, null, both ? 'You asked' : '') }); });
    items.sort(function (a, b) { return b.at - a.at; });

    fill('introductions',
      head('handshake', 'Introductions', 'Once both sides have accepted, the introduction arrives in your inbox, and is listed below.') +
      (items.length ? items.map(function (x) { return x.html; }).join('')
        : empty('No introductions yet. Ask a hub for what you need, or list your site, and they appear here.', 'add_circle')));
    mountPairMaps(provider, offerBy);
    attend();
  }

  /* The row the reader was sent to: #intro-<id> in the address (the offer
     email links to it; so does Answer in Waiting on you) scrolls to that
     row and marks it. Only one row is marked at a time. */
  function attend() {
    var m = /^#intro-(\d+)$/.exec(location.hash || '');
    var row = m ? el('intro-' + m[1]) : null;
    Array.prototype.forEach.call(document.querySelectorAll('.acct-row.is-attention'), function (r) {
      if (r !== row) r.classList.remove('is-attention');
    });
    if (!row) return;
    row.classList.add('is-attention');
    try { row.scrollIntoView({ block: 'center' }); } catch (e) { row.scrollIntoView(); }
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
      '<div class="acct-answer__terms" id="declTerms"></div>' +
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
    if (!isHost(s) && !closedHost(d, s) && !boardSeller(d)) { hide('declarations'); return; }
    var dec = d.declarations;
    var body;
    if (!dec) body = empty('Declarations open soon.', 'event_upcoming');
    else if (dec.due_state === 'submitted') body = empty('Declared for ' + (fmtPeriod(dec.period_open) || 'this period') + '. Nothing else to send.', 'task_alt');
    else if (dec.due_state === 'due' || dec.due_state === 'reminder' || dec.due_state === 'overdue') {
      body = declCard(dec, declHubOf(dec, byId) || hostHubs(s)[0] || '');
    } else body = empty(isHost(s) || closedHost(d, s)
      ? 'Nothing due. Declarations open on the 1st for hosts with accepted introductions.'
      : 'Nothing due. Declarations open on the 1st for what you sell through accepted introductions.', 'task_alt');

    fill('declarations',
      head('fact_check', 'Declarations', 'What came through each introduction. Your declaration is the record.') +
      body + declHistory(dec));
    /* A seller holding no current Host Agreement accepts it here, before its
       first line (plan 078). A closed account is never asked: its last
       accepted version continues. "Cannot tell" draws nothing, and a refusal
       from the worker draws the block then. */
    declTerms = null;
    if (el('declTerms') && !s.closed && window.NPAccount && NPAccount.termsFor) {
      NPAccount.termsFor('host').then(function (t) {
        if (t && t.accepted === false && el('declTerms')) drawDeclTerms();
      });
    }
  }
  var declTerms = null;
  function drawDeclTerms(layer, note, fresh) {
    return NPAccount.termsBlock(el('declTerms'), layer || 'host', { note: note, fresh: fresh }).then(function (t) {
      declTerms = t && t.ok && !t.held ? Object.assign({ layer: layer || 'host' }, t) : null;
    });
  }

  /* ═══════════ 4. waiting on you ═══════════ */
  /* Every open action on the account, directly under the banner (plan 055,
     decision 10), the top one highlighted. It reads the same summary the
     sections read and adds nothing of its own: each action links down to the
     section that holds the button, or out to the door. Never empty. */
  function renderWaiting(d, s) {
    var dec = d.declarations || null;
    var intros = Array.isArray(d.introductions) ? d.introductions : [];
    /* The closed mode (plan 069): nothing here applies to a closed account. */
    if (s.closed) { hide('waiting'); return 0; }
    var asked = intros.filter(function (i) { return i.role === 'provider' && i.stage === 'awaiting_acceptance'; });
    var due = (isHost(s) || boardSeller(d)) && dec && ['due', 'reminder', 'overdue'].indexOf(dec.due_state) !== -1 &&
      Array.isArray(dec.items) && dec.items.length;
    /* An account that is not a host and has listed, asked and been
       introduced to nothing yet has one thing to do: choose a hub. The
       line goes to the door, not to a section (plan 046, record B2). */
    var nothingYet = !isHost(s) && !(Array.isArray(d.listings) && d.listings.length) &&
      !(Array.isArray(d.requests) && d.requests.length) && !intros.length;

    var acts = [];
    if (asked.length) acts.push({ href: '#intro-' + asked[0].id, icon: 'handshake',
      text: asked.length === 1 ? 'Answer 1 introduction' : 'Answer ' + asked.length + ' introductions' });
    if (due) acts.push({ href: '#declarations', icon: 'fact_check',
      text: 'Send your declaration for ' + (fmtPeriod(dec.period_open) || 'this period') + (dec.due_state === 'overdue' ? ', now overdue' : '') });
    if (nothingYet) acts.push({ href: HUB_DOOR, icon: 'hub', leaves: true,
      text: 'List your site, or ask a hub for what you need' });

    var body;
    if (!acts.length) {
      body = '<p class="acct-quiet">' + esc(isHost(s)
        ? 'Nothing waiting on you. Your listing is live; introductions appear below as they arrive.'
        : 'Nothing waiting on you. Ask a hub for what you need when you are ready.') + '</p>';
    } else {
      /* The trailing arrow points down to a section, or on to the door. */
      var down = icon('arrow_downward'), on = icon('arrow_forward');
      body = '<div class="acct-actions">' + acts.map(function (a, n) {
        var cls = 'acct-action' + (n === 0 ? ' is-top' : '');
        var inner = icon(a.icon) + '<span>' + esc(a.text) + '</span>' + (a.leaves ? on : down);
        return '<a class="' + cls + '" href="' + esc(a.href) + '">' + inner + '</a>';
      }).join('') + '</div>';
    }
    fill('waiting', head('pending_actions', 'Waiting on you', 'What needs your answer.') + body);
    return acts.length;
  }

  /* ═══════════ 5. fees and standing (host) ═══════════ */
  function relationshipLine(r) {
    var capacity = r.hub !== 'opportunities';
    if (!r.first_order_at) return 'No order yet.' + (capacity ? ' The five fee years start with the first order.' : '');
    return 'First order ' + fmtPeriod(String(r.first_order_at).slice(0, 7)) + '.' + (capacity ? ' The five fee years run from there.' : '');
  }
  function renderFees(d, s) {
    if (!isHost(s) && !closedHost(d, s) && !boardSeller(d)) { hide('fees'); return; }
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

    /* Introduced customers (plan 055, decision 20): each introduction, and
       the first order its five fee years run from (Host §7; plan 078). A board
       fee runs for the period agreed in writing (Host §10), so a board row
       states the order alone. Older summaries carry no relationships; the
       provider rows say the same. */
    var rels = Array.isArray(d.relationships) ? d.relationships
      : (Array.isArray(d.introductions) ? d.introductions : []).filter(function (i) {
          return i.role === 'provider' && i.introduced_at;
        }).map(function (i) { return { introduction_id: i.id, ref: i.ref, hub: i.hub, since: i.introduced_at }; });
    var relBody = rels.length
      ? '<h3 class="acct-sub">Introduced customers</h3>' +
        group(rels.map(function (r) {
          return '<div class="acct-row"><div class="acct-row__meta">' +
            '<b>' + refLine(r.ref, r.hub, 'Introduction') + '</b>' +
            '<span>' + esc(relationshipLine(r)) + '</span>' +
          '</div></div>';
        }).join('')) +
        '<h3 class="acct-sub">Statements</h3>'
      : '';

    fill('fees',
      head('receipt_long', 'Fees and standing', scoreLine) +
      relBody +
      feesBody +
      '<h3 class="acct-sub">Open strikes</h3>' +
      strikesBody);
  }

  /* ═══════════ your terms (plan 078) ═══════════ */
  /* One row per document: the version this account accepted and when, with a
     copy to keep. A closed account is asked nothing more (Platform §9), so its
     rows never promise a next step. A worker with no `terms` hides the section. */
  var TERMS_NAME = { platform: 'Platform Terms', host: 'Host Agreement', seeker: 'Seeker Agreement' };
  function termsLine(t, closed) {
    if (!t.accepted_version) return closed ? 'Not accepted.' : 'Not accepted yet. You are asked the first time it applies.';
    if (t.stale) {
      return 'You accepted version ' + t.accepted_version + '.' +
        (closed ? '' : ' You will be asked to accept version ' + t.current_version + ' the next time it applies.');
    }
    return 'Version ' + t.accepted_version + (t.accepted_at ? ', accepted ' + fmtDate(t.accepted_at) : '') + '.';
  }
  function renderYourTerms(d, s) {
    var rows = Array.isArray(d.terms) ? d.terms : [];
    if (!rows.length || !window.NPAccount) { hide('yourTerms'); return; }
    fill('yourTerms',
      head('gavel', 'Your terms', 'What your account has accepted, with a copy of each to keep.') +
      group(rows.map(function (t) {
        var path = String(t.pdf_path || '');
        return '<div class="acct-row" data-terms-layer="' + esc(t.layer) + '"><div class="acct-row__meta">' +
          '<b>' + esc(TERMS_NAME[t.layer] || t.title || t.layer) + '</b>' +
          '<span>' + esc(termsLine(t, !!s.closed)) + '</span></div>' +
          (/^\/terms\//.test(path)
            ? '<div class="acct-row__actions"><a class="acct-terms-dl" href="' + esc(NPAccount.api + path) + '" download>Download a copy</a></div>'
            : '') +
        '</div>';
      }).join('')));
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

  /* ═══════════ where things are ═══════════ */
  var NAV_LABEL = { profile: 'Your site', waiting: 'Waiting on you', introductions: 'Introductions', yourTerms: 'Your terms',
    declarations: 'Declarations', fees: 'Fees and standing', education: 'Education' };

  /* The rail: one link per section on the page, a dot on any that has
     something waiting, and the settings page last (a page, not a section). */
  function renderNav(flagged) {
    flagged = flagged || {};
    var links = SECTIONS.filter(function (id) { return el(id) && !el(id).hidden; }).map(function (id) {
      return '<a href="#' + id + '">' + esc(NAV_LABEL[id]) +
        (flagged[id] ? '<span class="acct-nav__dot" aria-hidden="true"></span>' : '') + '</a>';
    });
    links.push('<a href="settings/">Account settings</a>');
    fill('acctNav', links.join(''));
    var wrap = document.querySelector('.acct-wrap');
    if (wrap) wrap.classList.add('has-nav');
  }

  function clearChrome() {
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
  /* A closed account refused the summary: a worker that has the gate but
     not yet the closed shape. The holder is told where Reopen lives. */
  function showClosedRefused() {
    showNotice('This account is closed, so there is nothing to show here. Nothing has been deleted; reopen it from <a href="settings/">your account settings</a> and everything is as you left it.');
  }

  /* ═══════════ the closed account (plan 069) ═══════════ */
  /* The notice above the sections: who closed it and when, what carries on,
     when the records go, and Reopen. Drawn into acctError's slot so the
     page's one notice position is reused. */
  function renderClosed(d, s) {
    var c = s.closed;
    var who = c.by_you === false && c.by_name ? esc(c.by_name) + ' closed this account on ' : 'You closed this account on ';
    var lines = [
      '<p>' + who + esc(fmtDate(c.at)) + '.</p>',
      c.host_was
        ? '<p>Your listing is off the hubs and your Host Agreement has ended; the declarations and statements below carry on for the customers we introduced.</p>'
        : '<p>Your requests are closed.</p>',
      /* retention_until is stamped by the engine's 06:15 run, so on the
         closing day it is empty: then the page states the rule itself. */
      c.retention_until
        ? '<p>We keep the records until ' + esc(fmtDate(c.retention_until)) + ', then delete them.</p>'
        : '<p>We keep the records for six years after the last invoice raised for the account, or for six years from closure if there was none, then delete them.</p>',
      c.reopen === false
        ? '<p>This account was also removed from the portal by NexPoint, so it cannot be reopened from here. Email ' + HELLO + ' if you were not expecting this.</p>'
        : '<div class="modal-actions" style="margin-top:14px"><button class="btn btn-primary acct-btn-sm" type="button" data-act="reopen" id="reopenGo">Reopen your account</button></div>',
      '<p class="acct-msg" id="closedMsg" hidden></p>',
    ];
    var e = el('acctError');
    if (!e) return;
    e.innerHTML = '<div id="acctClosed">' + lines.join('') + '</div>';
    e.hidden = false;
    var go = el('goHub');
    if (go) go.hidden = true;
  }
  function reopenAccount() {
    var done = busy(el('reopenGo'), 'Reopening…');
    post('/account/reopen', {}).then(function (d) {
      if (d && d.ok) { load(); return; }
      done();
      say(el('closedMsg'), d && d.error === 'not_closed' ? 'This account is open already.' : 'That did not go through. Try again, or email hello@nexpoint.co.uk.', true);
    });
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
    if (d.error === 'account_closed') return 'closed';
    if (d.http_status === 401 || d.http_status === 403 ||
        d.error === 'http_401' || d.error === 'http_403' ||
        d.error === 'sign in required' || d.error === 'email_unconfirmed') return 'signed-out';
    return '';
  }

  /* The summary last drawn, so an answer can tell a board introduction from
     any other without asking the worker again. */
  var lastSummary = null;
  function render(d) {
    lastSummary = d;
    if (el('acctLoading')) el('acctLoading').hidden = true;
    /* Emptied as well as hidden: a reopened account must not keep the
       closed notice (plan 069) in the page, out of sight but still there. */
    if (el('acctError')) { el('acctError').hidden = true; el('acctError').innerHTML = ''; }
    if (el('signInPrompt')) el('signInPrompt').hidden = true;
    var s = siteOf(d);
    var byId = {};
    (Array.isArray(d.introductions) ? d.introductions : []).forEach(function (i) { byId[i.id] = i; });
    var go = el('goHub');
    if (go) go.hidden = !!s.closed;
    renderProfile(d, s);
    if (s.closed) renderClosed(d, s);
    var open = renderWaiting(d, s);
    if (s.closed) hide('introductions'); else renderIntroductions(d);
    renderDeclarations(d, s, byId);
    renderFees(d, s);
    renderYourTerms(d, s);
    renderEducation();
    renderNav({ waiting: open > 0 });
  }

  /* ═══════════ loading ═══════════ */
  var seq = 0, queued = null;
  var VOCAB_WAIT_MS = 3000;
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
        else if (refusal === 'closed') showClosedRefused();
        else if (refusal === 'signed-out') showSignedOut();
        else showError();
        return;
      }
      if (d.signed_in === false) { showSignedOut(); return; }
      /* Draw once the words are in, but never wait on them for long: after
         VOCAB_WAIT_MS the page draws with humanised fallback labels, and draws
         again when the vocabulary does arrive. */
      var draw = function () { if (mine === seq) { render(d); } };
      var timer = setTimeout(draw, VOCAB_WAIT_MS);
      loadVocab(hubsOf(d)).then(function () {
        clearTimeout(timer);
        draw();
      });
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
    var body = { hub: hub, period: period, nothing_this_month: lines.length === 0, lines: lines };
    var tick = document.querySelector('#declTerms [data-np-terms-tick]');
    if (tick) {
      if (!tick.checked) {
        say(msg, 'Read the Host Agreement and tick to accept it.', true);
        tick.focus();
        return;
      }
      if (declTerms) { body.terms_version_id = declTerms.id; var sentLayer = declTerms.layer; }
    }
    var done = busy(btn, 'Sending…');
    post('/declarations', body)
      .then(function (d) {
        if (d && d.ok) {
          if (body.terms_version_id) NPAccount.noteAccepted(sentLayer);
          say(msg, 'Sent. Thank you.');
          reload();
          return;
        }
        done();
        if (isNotBuilt(d)) { say(msg, 'Declarations open soon.'); return; }
        if (d && (d.error === 'stale_terms' || d.error === 'terms_not_live')) {
          if (!window.NPAccount || !NPAccount.termsBlock) { say(msg, 'This page has been updated since it loaded. Refresh it, then declare.', true); return; }
          var layer = d.layer || 'host';
          if (msg) msg.hidden = true;
          drawDeclTerms(layer, NPAccount.termsMoved(layer), true);
          return;
        }
        say(msg, declError(d && d.error), true);
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
      if (code === 'no owner address for this organisation') { say(msg, 'Your account has no user address on file. Email hello@nexpoint.co.uk and we will send it by hand.', true); return; }
      if (code === 'this introduction is no longer open') { say(msg, 'This introduction is no longer open, so there is nothing to send again. If that looks wrong, email hello@nexpoint.co.uk.'); return; }
      /* The email provider refused the message (code review, 4 October
         2026). The worker counts the attempt towards its two-minute wait,
         so the advice is a few minutes, not "try again" at once. */
      if (code === 'send_failed') { say(msg, 'We could not send that just now. Try again in a few minutes, or email hello@nexpoint.co.uk and we will send it by hand.', true); return; }
      /* Plan 095: the two answers the button for the introduction email can
         also meet. The first is not a failure: the email has gone. */
      if (code === 'this introduction has already been answered') { say(msg, 'This introduction has already been answered and its email has gone. Check your inbox and your spam folder, or email hello@nexpoint.co.uk.'); return; }
      if (code === 'email log unavailable') { say(msg, 'We could not check that just now. Try again in a few minutes, or email hello@nexpoint.co.uk.', true); return; }
      say(msg, 'That did not go through. Try again, or email hello@nexpoint.co.uk.', true);
    });
  }

  function introOf(id) {
    return (lastSummary && Array.isArray(lastSummary.introductions) ? lastSummary.introductions : [])
      .filter(function (x) { return String(x.id) === String(id); })[0];
  }
  function isBoardIntro(id) {
    var i = introOf(id);
    return onBoard(i) ? i : null;
  }
  /* The side that sells is the one the Host Agreement binds (the worker's
     `seller`). A board owner answering a company that sells is not asked. */
  function sellerOf(id) {
    var i = introOf(id);
    return !!(i && i.seller);
  }
  var answerTerms = {};
  function drawAnswerTerms(id, layer, note, fresh) {
    var use = layer || 'host';
    return NPAccount.termsBlock(el('introTerms-' + id), use, { note: note, fresh: fresh }).then(function (t) {
      answerTerms[id] = t && t.ok && !t.held ? Object.assign({ layer: use }, t) : null;
    });
  }

  function openAnswer(btn, which) {
    var id = btn.getAttribute('data-intro');
    var accept = el('introAnswer-' + id);
    var decline = el('introDecline-' + id);
    /* One accept button on screen at a time: the panel's own replaces the
       Review button while the panel is open. */
    var review = document.querySelector('[data-act="intro-accept-open"][data-intro="' + CSS.escape(id) + '"]');
    if (which === 'decline') {
      if (accept) accept.hidden = true;
      if (review) review.hidden = false;
      if (decline) { decline.hidden = false; var r = el('introReason-' + id); if (r) r.focus(); }
      return;
    }
    if (decline) decline.hidden = true;
    if (!accept) return;
    accept.hidden = false;
    if (review) review.hidden = true;
    /* Only a seller holding no current Host Agreement has anything to accept.
       "Cannot tell" draws nothing, and a refusal from the worker draws the
       block then, so nobody holding the version is asked. */
    if (!sellerOf(id) || !window.NPAccount || !NPAccount.termsFor) return;
    if (document.querySelector('#introTerms-' + CSS.escape(id) + ' [data-np-terms-tick]')) return;
    NPAccount.termsFor('host').then(function (t) {
      if (t && t.accepted === false) drawAnswerTerms(id);
    });
  }

  /* The worker's refusals for an answer, in the provider's words. A closed
     or answered introduction is not a fault to retry: the page reloads to
     show where it now stands. */
  var ANSWER_CLOSED = {
    'this introduction is no longer open': 'This introduction is no longer open.',
    'the acceptance window has expired': 'The window to answer this introduction has closed.',
    'this introduction has already been answered': 'This introduction has already been answered.',
    'this introduction has no acceptance window': 'This introduction is no longer open.',
    'this introduction is not yet approved': 'This introduction is still with NexPoint.',
  };

  function sendAnswer(btn, action) {
    var id = btn.getAttribute('data-intro');
    var msg = el('introMsg-' + id);
    var body = { introduction_id: /^\d+$/.test(id) ? Number(id) : id };
    var board = isBoardIntro(id);
    if (action === 'accept') {
      var tick = document.querySelector('#introTerms-' + CSS.escape(id) + ' [data-np-terms-tick]');
      if (tick && !tick.checked) {
        say(msg, 'Read the Host Agreement and tick to accept it.', true);
        tick.focus();
        return;
      }
      if (tick && answerTerms[id]) { body.terms_version_id = answerTerms[id].id; var sentLayer = answerTerms[id].layer; }
    } else {
      var reason = el('introReason-' + id);
      var text = reason ? reason.value.trim() : '';
      if (text) body.reason = text;
    }
    var done = busy(btn, 'Sending…');
    post('/introductions/' + action, body).then(function (d) {
      if (d && d.ok) {
        if (body.terms_version_id) NPAccount.noteAccepted(sentLayer);
        say(msg, action === 'accept'
          ? 'Accepted. The introduction is on its way to your inbox.'
          : board ? 'Declined. The other company is told only that you said no.'
            : 'Declined. The seeker is told a site said no, and nothing else.');
        load();
        return;
      }
      done();
      var code = d && d.error;
      if (ANSWER_CLOSED[code]) { say(msg, ANSWER_CLOSED[code]); reload(); return; }
      if (code === 'stale_terms' || code === 'terms_not_live') {
        /* This seller holds no current version, or it rolled over while the
           box was open: the current text goes up unticked. */
        if (!window.NPAccount || !NPAccount.termsBlock) { say(msg, 'This page has been updated since it loaded. Refresh it, then answer.', true); return; }
        var layer = d.layer || 'host';
        drawAnswerTerms(id, layer, NPAccount.termsMoved(layer), true);
        return;
      }
      if (isNotBuilt(d)) { say(msg, 'For now, answer from the email we sent you.', true); return; }
      say(msg, GENERIC_ERROR, true);
    });
  }

  function onClick(e) {
    var btn = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    if (!btn) return;
    var act = btn.getAttribute('data-act');
    if (act === 'signin') { if (window.openSignIn) openSignIn(); return; }
    if (act === 'join') { if (window.NPAccount) NPAccount.openQuestionnaire({}); return; }
    if (act === 'education') { if (window.openEducationList) openEducationList(); return; }
    if (act === 'reopen') { reopenAccount(); return; }
    if (act === 'decl-submit') { gate(function () { submitDeclaration(btn); }); return; }
    if (act === 'intro-resend') { gate(function () { resendIntro(btn); }); return; }
    if (act === 'intro-accept-open') { openAnswer(btn, 'accept'); return; }
    if (act === 'intro-decline-open') { openAnswer(btn, 'decline'); return; }
    if (act === 'intro-accept-send') { gate(function () { sendAnswer(btn, 'accept'); }); return; }
    if (act === 'intro-decline-send') { gate(function () { sendAnswer(btn, 'decline'); }); return; }
  }

  /* ═══════════ boot ═══════════ */
  function init() {
    var wrap = document.querySelector('.acct-wrap');
    if (wrap) wrap.addEventListener('click', onClick);
    window.addEventListener('hashchange', attend);
    if (!window.NPAccount) { showSignedOut(); return; }
    document.addEventListener('npaccount:change', load);
    NPAccount.ready.then(load);
  }

  window.NPDashboard = { init: init };
})();

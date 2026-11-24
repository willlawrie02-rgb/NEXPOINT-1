/* NexPoint Global Portal - the declaration page (hub/account/declare/).
   Plan 106 (D2, D3, D5, D10, D21, D26; C5, C11): once a month the host
   declares, on one page, the net revenue each introduction brought in that
   month, or ticks "No revenue". The page reads the same GET /account/summary
   the account page reads (declarations.months[], CONTRACT 1) and sends the
   worker's POST /declarations once per hub. The month comes from ?period=,
   else the newest month still to declare. The page writes no day number of
   its own: every date comes from the worker's answer. Started on np:modules,
   after hub-account.js and portal.js, as every page module is.             */
(function () {
  'use strict';

  /* The currencies a host declares and is invoiced in (plan 106, D26).
     dashboard.js keeps the same list; check/review.mjs holds the two equal. */
  var CURRENCIES = ['GBP', 'EUR', 'USD', 'CAD', 'AUD', 'ILS'];
  var HUB_LABEL = { print: '3D Print Hub', mill: 'Mill Hub', opportunities: 'Opportunities Board' };
  var HELLO = 'hello@nexpoint.co.uk';
  var GENERIC_ERROR = 'That did not go through. Try again, or email ' + HELLO + '.';
  /* The account page's words for the worker's refusals (dashboard.js
     DECL_ERRORS), with the tick named as this page names it. */
  var DECL_ERRORS = {
    line_value_required: 'Every line needs a value. Enter one, or tick "No revenue" for that introduction.',
    line_currency_invalid: 'Choose a currency from the list.',
    not_your_introduction: 'One of these introductions is not yours to declare. Reload the page and try again.',
    period_out_of_range: 'That month is not open for declarations.',
    statement_issued: 'That month is already on a statement and cannot be changed. Email ' + HELLO + ' if something is wrong.',
    nothing_or_lines: 'Either tick "No revenue" for every introduction or enter at least one value.',
    /* Plan 098: every introduction is answered, and never both ways. */
    introduction_unanswered: 'Every introduction needs an answer: a value, or a tick under "No revenue". If you have answered them all, reload the page and declare again.',
    line_and_nothing: 'One introduction has both a value and a "No revenue" tick. Clear one of them and send again.',
    already_sent: 'This month has already been sent. To change it, talk to the desk.',
  };

  /* ── small helpers ──────────────────────────────────────────────── */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function el(id) { return document.getElementById(id); }
  function ms(name) { return '<span class="material-symbols-outlined" aria-hidden="true">' + name + '</span>'; }
  function api(path, opts) {
    if (window.NP && NP.api) return NP.api(path, opts);
    return Promise.resolve({ error: 'network' });
  }
  function post(path, body) {
    return api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  }
  function fmtPeriod(p, opt) {
    var m = /^(\d{4})-(\d{2})$/.exec(String(p || ''));
    if (!m) return String(p || '');
    var d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
    try { return d.toLocaleDateString('en-GB', opt === 'month' ? { month: 'long', timeZone: 'UTC' } : { month: 'long', year: 'numeric', timeZone: 'UTC' }); }
    catch (e) { return String(p); }
  }
  /* A date from the worker (2026-11-15, or a timestamp) in words, read in
     UTC so a date never slips a day on a reader's clock. */
  function dateWords(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return '';
    var d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    try { return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }); }
    catch (e) { return String(iso).slice(0, 10); }
  }
  function pennies(p) {
    var s = String(Math.abs(p) % 100);
    var whole = Math.floor(Math.abs(p) / 100).toLocaleString('en-GB');
    return (p < 0 ? '-' : '') + whole + '.' + (s.length < 2 ? '0' + s : s);
  }
  function cash(p, currency) { return (currency ? currency + ' ' : '') + pennies(p); }
  function rateText(r) {
    if (r == null || isNaN(Number(r))) return '';
    return (Math.round(Number(r) * 10000) / 100) + '%';
  }
  /* The host's value: digits, thousands commas where they belong, up to two
     decimals, never negative. Answers pennies, or null for anything else. */
  function parseValue(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$/.test(s)) return null;
    var parts = s.replace(/,/g, '').split('.');
    var frac = (parts[1] || '') + '00';
    var n = Number(parts[0]) * 100 + Number(frac.slice(0, 2));
    return isFinite(n) && n <= 9e13 ? n : null;
  }
  /* value x rate, rounded half-up to the penny, in whole numbers so no
     floating point can tip a half the wrong way. */
  function feeOf(p, rate) {
    var ppm = BigInt(Math.round(Number(rate || 0) * 1e6));
    return Number((BigInt(p) * ppm + 500000n) / 1000000n);
  }
  function totalsText(lines, key) {
    var out = {}, order = [];
    lines.forEach(function (l) {
      if (!(l.currency in out)) { out[l.currency] = 0; order.push(l.currency); }
      out[l.currency] += l[key];
    });
    order.sort();
    /* each currency's figure stays whole; a long total breaks at the plus */
    return order.map(function (c) { return '<span class="nw">' + esc(cash(out[c], c)) + '</span>'; }).join(' + ');
  }
  function say(text, bad) {
    var m = el('declMsg');
    if (!m) return;
    m.textContent = text;
    m.className = 'decl-msg' + (bad === false ? ' is-ok' : '');
    m.hidden = !text;
  }

  /* ── the page's parts ───────────────────────────────────────────── */
  var view = { summary: null, month: null, rows: [], manyHubs: false, sentHubs: {}, terms: null, sending: false };

  function setHead(title, lead, bare) {
    var h = el('declTitle');
    if (h) { h.textContent = title; h.hidden = !!bare; }
    var l = el('declLead');
    if (l) { l.textContent = lead || ''; l.hidden = !lead; }
    try { document.title = title + ' · The NexPoint Global Portal'; } catch (e) {}
  }
  function card(html) {
    var c = el('declCard');
    if (c) { c.innerHTML = html; c.hidden = false; }
  }
  function backButton(label) {
    return '<a class="btn btn-primary" href="../">' + esc(label || 'Back to your account') + ms('arrow_forward') + '</a>';
  }
  /* A page with nothing to fill in: one plain sentence and the way back. */
  function plain(title, text, ico) {
    setHead(title, '');
    card('<div class="decl-done is-quiet">' + ms(ico || 'task_alt') + '<div><p>' + esc(text) + '</p>' + backButton() + '</div></div>');
  }

  function showSignedOut() {
    setHead('Your declaration', '');
    card('<div class="decl-signin"><h2>Sign in to declare</h2>' +
      '<p>Your declaration is made from your hub account, once you are signed in.</p>' +
      '<div class="decl-signin__go"><button class="btn btn-primary" type="button" data-act="signin">Sign in</button></div></div>');
  }
  function showNotice(text) {
    setHead('Your declaration', '');
    card('<div class="decl-notice">' + text + '</div>');
  }

  function wantedPeriod() {
    try {
      var p = new URLSearchParams(location.search).get('period');
      return p && /^\d{4}-\d{2}$/.test(p) ? p : null;
    } catch (e) { return null; }
  }
  function openState(m) { return m && (m.state === 'open' || m.state === 'not_declared'); }

  function render(d) {
    view.summary = d;
    var dec = d.declarations || {};
    var months = Array.isArray(dec.months) ? dec.months : null;
    if (!months) {
      /* an older worker: the account page still has its own declaration card */
      plain('Your declaration', 'Declare from your account page for now.', 'fact_check');
      return;
    }
    var asked = wantedPeriod();
    var month = asked
      ? months.filter(function (m) { return m && m.period === asked; })[0]
      : months.filter(openState)[0];
    if (asked && !month) {
      plain(fmtPeriod(asked), 'There is no declaration to make for ' + fmtPeriod(asked) + '. Your account page lists the months that are open.', 'event_upcoming');
      return;
    }
    /* The Opportunities Board's month is declared on the account page while
       the worker's months hold the two hubs alone (D18): an account with
       nothing to declare here and a board declaration due is sent there. */
    var legacyDue = ['due', 'reminder', 'overdue'].indexOf(dec.due_state) !== -1 &&
      Array.isArray(dec.items) && dec.items.length > 0;
    if (!month && !asked && legacyDue) {
      plain('Your declaration', 'Declare from your account page for now.', 'fact_check');
      return;
    }
    if (!month) {
      var last = months.filter(function (m) { return m && !openState(m); })[0];
      plain('Your declaration', last
        ? 'Declared for ' + fmtPeriod(last.period) + '. Nothing else to send.'
        : 'Nothing to declare yet. Your first declaration opens after the month of your first introduction.', 'task_alt');
      return;
    }
    if (!openState(month)) {
      plain(fmtPeriod(month.period), fmtPeriod(month.period) + ' has already been declared. To change it, talk to the desk.', 'task_alt');
      return;
    }
    /* The rows are the worker's due[]: who owes a line, at what rate. A
       worker that lists none for an open month cannot be declared to from
       this page, and the page says so rather than "nothing to declare". */
    if (!Array.isArray(month.due)) {
      showNotice('We could not list your introductions for ' + esc(fmtPeriod(month.period)) + ' just now. Try again in a few minutes, or email <a href="mailto:' + HELLO + '">' + HELLO + '</a>.');
      return;
    }
    var due = month.due.filter(function (r) { return r && r.introduction_id != null; });
    if (!due.length) {
      plain(fmtPeriod(month.period), 'Nothing to declare for ' + fmtPeriod(month.period) + '. None of your introductions is in it.', 'task_alt');
      return;
    }
    drawForm(d, month, due);
  }

  function yearOf(d, id) {
    var i = (Array.isArray(d.introductions) ? d.introductions : []).filter(function (x) { return String(x.id) === String(id); })[0];
    return i && i.fee_year ? i.fee_year : null;
  }

  function drawForm(d, month, due) {
    view.month = month;
    view.sentHubs = {};
    var hubs = {};
    due.forEach(function (r) { if (r.hub) hubs[r.hub] = true; });
    view.manyHubs = Object.keys(hubs).length > 1;
    /* A host whose own currency is not one of the six: the line starts on
       GBP and the line about another currency stands out. */
    var foreign = due.some(function (r) { return r.currency_default && CURRENCIES.indexOf(r.currency_default) === -1; });
    view.rows = due.map(function (r) {
      return { id: r.introduction_id, ref: r.ref || '', company: r.company || '', hub: r.hub || '', rate: Number(r.rate) || 0,
        currency: CURRENCIES.indexOf(r.currency_default) !== -1 ? r.currency_default : 'GBP', year: yearOf(d, r.introduction_id) };
    });
    var name = fmtPeriod(month.period), short = fmtPeriod(month.period, 'month');
    setHead('Declare ' + name,
      'One line for each introduction: the net revenue you invoiced that customer in ' + short + '. ' +
      'Tick "No revenue" where nothing came through. The rate and the fee fill in by themselves.');
    var body = view.rows.map(function (r, n) {
      var who = r.company
        ? '<span class="co">' + esc(r.company) + (r.ref ? '<small>(' + esc(r.ref) + ')</small>' : '') + '</span>'
        : '<span class="co">' + esc(r.ref) + '</span>';
      var label = r.company || r.ref;
      return '<tr data-row="' + n + '">' +
        '<td>' + who + (view.manyHubs && r.hub ? ' <span class="acct-hub">' + esc(HUB_LABEL[r.hub] || r.hub) + '</span>' : '') + '</td>' +
        '<td class="num"><input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" id="dv-' + n + '" data-field="value" ' +
          'aria-label="Net revenue from ' + esc(label) + ' in ' + esc(short) + '"></td>' +
        '<td><select id="dc-' + n + '" data-field="currency" aria-label="Currency for ' + esc(label) + '">' +
          CURRENCIES.map(function (c) { return '<option value="' + c + '"' + (c === r.currency ? ' selected' : '') + '>' + c + '</option>'; }).join('') +
        '</select></td>' +
        '<td><label class="none"><input type="checkbox" id="dn-' + n + '" data-field="none">No revenue</label></td>' +
        '<td class="num auto">' + esc(rateText(r.rate)) + (r.year ? '<br><small>Year ' + esc(r.year) + '</small>' : '') + '</td>' +
        '<td class="num fee" id="df-' + n + '">–</td>' +
      '</tr>';
    }).join('');
    var by = dateWords(month.declare_by);
    var when = month.state === 'not_declared'
      ? (by ? 'This declaration was due by ' + by + '. ' : 'This declaration is overdue. ')
      : (by ? 'Declare by ' + by + '. ' : '');
    card('<div class="acct-scroll"><table class="decl-table">' +
        '<thead><tr><th>Introduction</th><th class="num">Value you declared</th><th>Currency</th><th><span class="sr">No revenue</span></th><th class="num">Rate</th><th class="num">Fee</th></tr></thead>' +
        '<tbody>' + body + '</tbody>' +
        '<tfoot><tr><td colspan="5" class="num">Total fee for ' + esc(short) + '</td><td class="num" id="declTotal">–</td></tr></tfoot>' +
      '</table></div>' +
      '<p class="decl-other' + (foreign ? ' notice-warn notice-warn--block' : '') + '" id="declOther">' +
        '<span>Invoiced in another currency? Email <a href="mailto:' + HELLO + '">' + HELLO + '</a> before you send this.</span></p>' +
      '<div class="decl-terms" id="declTerms"></div>' +
      '<div class="decl-foot" id="declFoot"><p>' + esc(when) + 'When you send it, we raise one invoice for the month, due 30 days after its date, and it shows on your account page.</p>' +
        '<div class="decl-send"><button class="btn btn-primary" type="button" id="declSend" data-act="decl-send">Send this declaration</button>' +
        '<p class="decl-msg" id="declMsg" role="status" hidden></p></div></div>' +
      '<div class="decl-confirm" id="declConfirm" hidden>' +
        '<p>Nothing came through any introduction in ' + esc(short) + '? Send a nil return.</p>' +
        '<div class="decl-confirm__go"><button class="btn btn-primary" type="button" data-act="nil-send">Send a nil return</button>' +
        '<button class="btn btn-outline" type="button" data-act="nil-back">Go back</button></div></div>');
    recalc();
    /* A seller holding no current Host Agreement accepts it here before its
       first line (plan 078), as on the account page. A closed account is
       never asked; "cannot tell" draws nothing, and a refusal draws it then. */
    view.terms = null;
    var s = d.closed && typeof d.closed === 'object';
    if (!s && window.NPAccount && NPAccount.termsFor) {
      NPAccount.termsFor('host').then(function (t) { if (t && t.accepted === false && el('declTerms')) drawTerms(); });
    }
  }

  function drawTerms(layer, note, fresh) {
    var use = layer || 'host';
    return NPAccount.termsBlock(el('declTerms'), use, { note: note, fresh: fresh }).then(function (t) {
      view.terms = t && t.ok && !t.held ? Object.assign({ layer: use }, t) : null;
    });
  }

  /* Each line as typed: { none, pennies (null when not a value), currency, fee }. */
  function readLines() {
    return view.rows.map(function (r, n) {
      var none = !!(el('dn-' + n) && el('dn-' + n).checked);
      var currency = el('dc-' + n) ? el('dc-' + n).value : r.currency;
      var p = none ? 0 : parseValue(el('dv-' + n) ? el('dv-' + n).value : '');
      return { row: r, n: n, none: none, pennies: p, currency: currency, fee: p == null ? null : feeOf(p, r.rate) };
    });
  }
  function recalc() {
    var lines = readLines(), bad = false;
    lines.forEach(function (l) {
      var cell = el('df-' + l.n);
      var input = el('dv-' + l.n);
      var raw = input ? input.value.trim() : '';
      if (input) input.classList.toggle('is-bad', !l.none && raw !== '' && l.pennies == null);
      if (l.pennies == null) { bad = true; if (cell) cell.textContent = '–'; return; }
      if (cell) cell.textContent = cash(l.fee, l.currency);
    });
    var good = lines.filter(function (l) { return l.pennies != null; });
    var tot = el('declTotal');
    if (tot) {
      var paying = good.filter(function (l) { return !l.none; });
      tot.innerHTML = paying.length ? totalsText(paying, 'fee')
        : esc(!bad && good.length ? cash(0, good[0].currency) : '–');
    }
    return { lines: lines, ok: !bad };
  }

  /* A line with nothing to charge: ticked "No revenue", or a value of nil. */
  function isNil(l) { return l.none || l.pennies === 0; }

  /* One body per hub (C11: a host on both hubs declares every introduction
     on one page) with only the lines above nil: a "No revenue" line is left
     out of lines (a stored nil line would count as trading) and named in
     nothing_for, because the worker takes a nil answer only when it is said
     (plan 098): every introduction is a line or is named there. The nil
     return for a hub where every line is "No revenue". No units (D2). */
  function bodies(lines) {
    var byHub = {}, order = [];
    lines.forEach(function (l) {
      var h = l.row.hub || '';
      if (!(h in byHub)) { byHub[h] = []; order.push(h); }
      byHub[h].push(l);
    });
    return order.map(function (h) {
      var ls = byHub[h];
      var nil = ls.every(isNil);
      var idOf = function (l) { var id = l.row.id; return /^\d+$/.test(String(id)) ? Number(id) : id; };
      var b = { hub: h, period: view.month.period, nothing_this_month: nil,
        nothing_for: ls.filter(isNil).map(idOf) };
      if (!nil) b.lines = ls.filter(function (l) { return !isNil(l); }).map(function (l) {
        return { introduction_id: idOf(l), value: l.pennies / 100, currency: l.currency };
      });
      return b;
    });
  }

  function trySend() {
    if (view.sending) return;
    var r = recalc();
    if (!r.ok) { say('Type a value on each line, or tick "No revenue".'); var first = r.lines.filter(function (l) { return l.pennies == null; })[0]; if (first && el('dv-' + first.n)) el('dv-' + first.n).focus(); return; }
    var tick = document.querySelector('#declTerms [data-np-terms-tick]');
    if (tick && !tick.checked) { say('Read the Host Agreement and tick to accept it.'); tick.focus(); return; }
    if (r.lines.every(isNil)) {
      el('declFoot').hidden = true;
      el('declConfirm').hidden = false;
      var go = document.querySelector('[data-act="nil-send"]');
      if (go) go.focus();
      return;
    }
    send(r.lines);
  }

  function busy(on) {
    view.sending = on;
    var b = el('declSend');
    if (b) { b.disabled = on; b.textContent = on ? 'Sending…' : 'Send this declaration'; }
    var n = document.querySelector('[data-act="nil-send"]');
    if (n) { n.disabled = on; n.textContent = on ? 'Sending…' : 'Send a nil return'; }
    Array.prototype.forEach.call(document.querySelectorAll('#declCard input, #declCard select'), function (x) {
      if (x.closest('#declTerms')) return;
      if (on) x.disabled = true;
      else x.disabled = x.getAttribute('data-field') !== 'none' && !!(el('dn-' + x.id.slice(3)) || {}).checked;
    });
  }

  function send(lines) {
    var list = bodies(lines);
    var tick = document.querySelector('#declTerms [data-np-terms-tick]');
    var termsId = tick && view.terms ? view.terms.id : null;
    var sentLayer = view.terms ? view.terms.layer : null;
    busy(true);
    say('');
    var n = 0;
    function next() {
      if (n >= list.length) { done(lines, termsId ? sentLayer : null); return; }
      var b = list[n];
      if (view.sentHubs[b.hub]) { n++; next(); return; }
      if (termsId) b.terms_version_id = termsId;
      post('/declarations', b).then(function (d) {
        if (d && d.ok) { view.sentHubs[b.hub] = true; n++; next(); return; }
        busy(false);
        backFromConfirm();
        var code = d && d.error;
        if (d && d.error === 'http_404') { say('Declarations open soon.'); return; }
        if (code === 'stale_terms' || code === 'terms_not_live') {
          if (!window.NPAccount || !NPAccount.termsBlock) { say('This page has been updated since it loaded. Refresh it, then declare.'); return; }
          var layer = d.layer || 'host';
          drawTerms(layer, NPAccount.termsMoved ? NPAccount.termsMoved(layer) : '', true).then(function () {
            say('Read the Host Agreement and tick to accept it, then send again.');
          });
          return;
        }
        say(DECL_ERRORS[code] || GENERIC_ERROR);
      });
    }
    next();
  }

  function backFromConfirm() {
    if (el('declConfirm')) el('declConfirm').hidden = true;
    if (el('declFoot')) el('declFoot').hidden = false;
  }

  function done(lines, acceptedLayer) {
    if (acceptedLayer && window.NPAccount && NPAccount.noteAccepted) NPAccount.noteAccepted(acceptedLayer);
    var nil = lines.every(isNil);
    var name = fmtPeriod(view.month.period), short = fmtPeriod(view.month.period, 'month');
    setHead('Declared for ' + name, '', true);   /* the band keeps only the way back, as the approved draft */
    card('<div class="decl-done">' + ms('task_alt') + '<div><h2>Declared for ' + esc(name) + '</h2>' +
      '<p>' + (nil ? 'No revenue this month, so there is no invoice. '
        : 'Your invoice is being raised and will reach you by email, due 30 days after its date. ') +
      'Your account page now shows this declaration under each introduction and on ' + esc(short) + '\'s statement.</p>' +
      '<a class="btn btn-primary" href="../">See it on my account' + ms('arrow_forward') + '</a></div></div>');
    try { window.scrollTo(0, 0); } catch (e) {}
  }

  /* ── loading ────────────────────────────────────────────────────── */
  function refusalOf(d) {
    if (!d) return '';
    if (d.error === 'account_removed') return 'removed';
    if (d.error === 'account_closed') return 'closed';
    if (d.http_status === 401 || d.http_status === 403 || d.error === 'http_401' || d.error === 'http_403' ||
        d.error === 'sign in required' || d.error === 'email_unconfirmed') return 'signed-out';
    return '';
  }
  var seq = 0, queued = null;
  function load() { clearTimeout(queued); queued = setTimeout(doLoad, 0); }
  function doLoad() {
    if (view.sending || el('declCard') && el('declCard').querySelector('.decl-done:not(.is-quiet)')) return;
    if (!window.NPAccount || !NPAccount.user) { showSignedOut(); return; }
    var mine = ++seq;
    api('/account/summary').then(function (d) {
      if (mine !== seq) return;
      if (!d || d.error) {
        var why = refusalOf(d);
        if (why === 'removed') showNotice('This account has been removed from the hub, so there is nothing to declare here. Email <a href="mailto:' + HELLO + '">' + HELLO + '</a> if you were not expecting this.');
        else if (why === 'closed') showNotice('This account is closed. Reopen it from <a href="../settings/">your account settings</a> to declare.');
        else if (why === 'signed-out') showSignedOut();
        else showNotice('That did not load. Check your connection and try again, or email <a href="mailto:' + HELLO + '">' + HELLO + '</a>.');
        return;
      }
      if (d.signed_in === false) { showSignedOut(); return; }
      render(d);
    });
  }

  /* ── what the page does ─────────────────────────────────────────── */
  function gate(fn) {
    if (window.NPAccount && NPAccount.requireConfirmed) NPAccount.requireConfirmed(fn);
    else fn();
  }
  function onInput(e) {
    var t = e.target;
    if (!t || !t.getAttribute || !t.closest('#declCard')) return;
    var f = t.getAttribute('data-field');
    if (!f) return;
    if (f === 'none') {
      var n = t.id.slice(3);
      var v = el('dv-' + n), c = el('dc-' + n);
      if (v) { v.disabled = t.checked; if (t.checked) v.value = ''; }
      if (c) c.disabled = t.checked;
    }
    if (el('declMsg') && !el('declMsg').hidden) say('');
    recalc();
  }
  function onClick(e) {
    var b = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    if (!b) return;
    var act = b.getAttribute('data-act');
    if (act === 'signin') { if (window.openSignIn) openSignIn(); return; }
    if (act === 'decl-send') { gate(trySend); return; }
    if (act === 'nil-send') { gate(function () { send(readLines()); }); return; }
    if (act === 'nil-back') { backFromConfirm(); var s = el('declSend'); if (s) s.focus(); return; }
  }
  /* No number on this page moves under the mouse wheel: the values are text
     boxes, and a focused number box anywhere gives its focus up first. */
  function onWheel(e) {
    var t = e.target;
    if (t && t.tagName === 'INPUT' && t.type === 'number' && document.activeElement === t) t.blur();
  }

  function init() {
    var root = el('declPage') || document.body;
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onInput);
    document.addEventListener('wheel', onWheel, { passive: true });
    if (!window.NPAccount) { showSignedOut(); return; }
    document.addEventListener('npaccount:change', load);
    NPAccount.ready.then(load);
  }

  window.NPDeclare = { init: init, _parseValue: parseValue, _feeOf: feeOf };
  document.addEventListener('np:modules', init, { once: true });
})();

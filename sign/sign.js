/* The consultancy sign-up page (spec 2026-10-19, section 8). A client who
   has said yes on a call gets a private link (/sign/?t=<token>), signs the
   Introduction Agreement and the Master Terms of Business in DocuSign's
   focused view inside this page, and is then looking at the Xero invoice for
   the retainer with a way to pay it.

   The worker answers three routes, each with the same `state`:
     POST /signup/view      what the link stands at now
     POST /signup/sign      a signing address for the focused view (works
                            once, for 300 seconds: every session asks afresh)
     POST /signup/complete  "the client finished signing": the worker checks
                            DocuSign and raises the invoice
   Any bad, expired, withdrawn or unknown link answers one way (link_invalid)
   and the page says one thing for it.

   Standalone, like hub/invite.html: inline styles, no shared script, and
   unlisted (noindex, and robots.txt keeps /sign/ out).                   */
(function () {
  'use strict';
  var local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var API = local ? 'http://localhost:8787' : 'https://api.nexpoint.co.uk';
  var HELP = 'hello@nexpoint.co.uk';
  var POLL_EVERY_MS = 4000;
  var POLL_FOR_MS = 60000;
  /* DocuSign's own script hosts (demo, production). The worker names which;
     the page loads nothing from anywhere else. */
  var DOCUSIGN_JS = /^https:\/\/js(-d)?\.docusign\.com\//;
  var token = new URLSearchParams(location.search).get('t') || '';

  var state = null;       // the latest state the worker gave
  var pollRun = 0;        // bumped to stop a running poll
  var session = 0;        // bumped for every signing session
  var sessionOpen = false;
  var dsScript = null;    // the one load of DocuSign's script
  var dsClients = {};     // integration key -> loadDocuSign promise

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function render(html, wide) {
    $('signBody').innerHTML = html;
    $('card').classList.toggle('wide', !!wide);
    document.body.classList.toggle('is-wide', !!wide);
  }
  function say(title, line) { render('<h1>' + esc(title) + '</h1><p>' + line + '</p>'); }
  var helpLink = '<a href="mailto:' + HELP + '">' + HELP + '</a>';
  function call(path) {
    return fetch(API + path, {
      method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token }),
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) { return { r: r, d: d || {} }; });
    });
  }
  /* "2026-11-18" or a timestamp, as 18 November 2026. */
  function longDate(v, zone) {
    if (!v) return '';
    var d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? v + 'T12:00:00Z' : v);
    if (isNaN(d)) return '';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: zone || 'UTC' });
  }
  function safeHttps(u) { return /^https:\/\//i.test(String(u || '')) ? String(u) : ''; }

  /* ── the states ──────────────────────────────────────────────────── */

  function renderInvalid() {
    pollRun++;
    say('This link is no longer valid.', 'Sign-up links last 30 days and stop working once they are withdrawn or replaced. ' +
      'Email ' + helpLink + ' and we will send you a fresh one.');
  }
  function renderFailed(offline) {
    pollRun++;
    say('That did not go through.', offline
      ? 'Check your connection and open the link again, or email ' + helpLink + '.'
      : 'Open the link again in a moment, or email ' + helpLink + '.');
  }

  /* Whatever the worker says the link stands at. */
  function show(s) {
    pollRun++;
    state = s;
    if (!s || !s.status) { renderFailed(false); return; }
    if (s.status === 'ready') renderReady('');
    else if (s.status === 'signed') { renderSigned(); poll(); }
    else if (s.status === 'invoiced') renderInvoiced(s);
    else if (s.status === 'paid') renderPaid(s);
    else renderFailed(false);
  }

  function renderReady(line, bad) {
    var s = state;
    var fee = s.fee || {};
    render(
      '<h1>Welcome, ' + esc(String(s.company || '').replace(/\.+$/, '')) + '.</h1>' +
      '<p>Thank you for choosing NexPoint. Here is the agreement in brief; the full terms are in the two documents you review next.</p>' +
      '<div class="panel">' +
        '<p class="eyebrow">Your agreement</p>' +
        '<dl class="terms">' +
          (s.service ? '<dt>Service</dt><dd>' + esc(s.service) + '</dd>' : '') +
          (s.territory ? '<dt>Territory</dt><dd>' + esc(s.territory) + '</dd>' : '') +
          '<dt>Retainer</dt><dd><strong>' + esc(fee.display) + '</strong> for six months of sales and marketing work, ' +
            'invoiced when you sign and due within 30 days.</dd>' +
          '<dt>Recurring fee</dt><dd>On the business that results: <strong>6% of the revenue in the first year</strong>, ' +
            'falling to 2% in the fifth, and nothing after.</dd>' +
        '</dl>' +
        '<p class="note">You sign two documents with NexPoint Global Ltd: the Introduction Agreement, made out for ' + esc(s.company) +
          ', and the Master Terms of Business. Both open here, on this page, for ' + esc(s.signer_name) + ' to read and sign.</p>' +
        '<p class="msg' + (bad ? ' bad' : '') + '" id="signMsg" role="status">' + (line || '') + '</p>' +
        '<div class="actions"><button class="yes" type="button" id="signBtn">Review and sign the agreement</button></div>' +
      '</div>');
    $('signBtn').addEventListener('click', startSigning);
  }

  function renderSigned(line) {
    render('<h1>Agreement signed.</h1><p id="pendingLine" role="status">' +
      (line || 'Your invoice is on its way. It appears here in a moment.') + '</p>');
  }

  function invoiceRows(s, inv) {
    return '<dl class="terms">' +
      '<dt>Invoice</dt><dd><strong>' + esc(inv.number) + '</strong></dd>' +
      '<dt>Amount</dt><dd>' + esc(inv.amount_display || (s.fee && s.fee.display)) + '</dd>' +
      (inv.due_date ? '<dt>Due</dt><dd>' + esc(longDate(inv.due_date)) + '</dd>' : '') +
    '</dl>';
  }
  function bankRows(bank) {
    return '<dl class="terms" id="bank">' + Object.keys(bank).map(function (k) {
      return '<dt>' + esc(k) + '</dt><dd>' + esc(bank[k]) + '</dd>';
    }).join('') + '</dl>';
  }
  function bankText(bank, inv) {
    return Object.keys(bank).map(function (k) { return k + ': ' + bank[k]; })
      .concat(['Reference: ' + inv.number, 'Amount: ' + inv.amount_display]).join('\n');
  }

  /* Pay by bank covers UK payers in GBP only (spec section 7): there Pay now
     leads, with the transfer details below it. In dollars or euros the
     transfer leads, and the online invoice is the quieter way. */
  function renderInvoiced(s) {
    var inv = s.invoice || {};
    var pay = safeHttps(inv.pay_url);
    var bank = inv.bank && typeof inv.bank === 'object' && Object.keys(inv.bank).length ? inv.bank : null;
    var ref = '<p class="note">Use <strong>' + esc(inv.number) + '</strong> as the payment reference.</p>';
    var html = '<h1>Agreement signed.</h1>' +
      '<p>Thank you. Here is the invoice for your retainer. A copy of the signed agreement and the invoice are on their way to your inbox.</p>' +
      '<div class="panel"><p class="eyebrow">Your invoice</p>' + invoiceRows(s, inv);
    if (inv.pay_by_bank && pay) {
      html += '<div class="actions"><a class="btn yes" id="payNow" href="' + esc(pay) + '" target="_blank" rel="noopener">Pay now</a></div>' +
        '<p class="note">Pay now opens the invoice, where you can pay straight from your bank account.</p></div>' +
        (bank ? '<div class="panel"><h2>Or pay by bank transfer</h2>' + bankRows(bank) + ref + '</div>' : '');
    } else if (bank) {
      html += '</div><div class="panel"><h2>Pay by bank transfer</h2>' + bankRows(bank) + ref +
        '<div class="actions"><button class="yes" type="button" id="copyBank">Copy bank details</button>' +
        (pay ? '<a class="btn quiet" id="viewInvoice" href="' + esc(pay) + '" target="_blank" rel="noopener">View the invoice</a>' : '') +
        '</div><p class="msg" id="copyMsg" role="status"></p></div>';
    } else if (pay) {
      html += '<div class="actions"><a class="btn yes" id="viewInvoice" href="' + esc(pay) + '" target="_blank" rel="noopener">View the invoice</a></div></div>';
    } else {
      html += '<p class="note">The invoice is in your inbox, with the ways to pay it.</p></div>';
    }
    render(html);
    if ($('copyBank')) $('copyBank').addEventListener('click', function () { copyBank(bankText(bank, inv)); });
  }

  function copyBank(text) {
    var done = function () { $('copyMsg').textContent = 'Bank details copied, with the invoice number as the reference.'; };
    var byHand = function () {
      var t = document.createElement('textarea');
      t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      t.remove();
      if (ok) done();
      else $('copyMsg').textContent = 'Your browser would not copy them. Select the details above and copy them by hand.';
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, byHand);
    else byHand();
  }

  function renderPaid(s) {
    var inv = s.invoice || {};
    var amount = inv.amount_display || (s.fee && s.fee.display);
    var when = longDate(s.paid_at, 'Europe/London');
    render('<h1>Paid, thank you.</h1>' +
      '<p>Your payment of ' + esc(amount) + (inv.number ? ' for invoice ' + esc(inv.number) : '') + ' arrived' +
        (when ? ' on ' + esc(when) : '') + '.</p>' +
      '<p>Your six months of sales and marketing work is now under way. The NexPoint desk will be in touch about the first steps, ' +
        'and the signed agreement is in your inbox for your records.</p>');
  }

  /* ── asking again ────────────────────────────────────────────────── */

  /* `/signup/view` every 4 seconds for a minute, while the invoice is being
     raised (or the worker has not yet seen a signature DocuSign reported).
     Only ever the view: `/signup/complete` may read the envelope from
     DocuSign, which allows few status reads, so the page sends it once per
     signature (twice if the first never arrived). The cron pass finishes
     the job either way. */
  function poll() {
    var run = ++pollRun;
    var until = Date.now() + POLL_FOR_MS;
    function again() {
      if (run !== pollRun) return;
      if (Date.now() >= until) {
        renderSigned('Your invoice is taking a little longer than usual. It will reach your inbox shortly, and opening this link again will show it here.');
        return;
      }
      setTimeout(function () {
        if (run !== pollRun) return;
        call('/signup/view').then(function (o) {
          if (run !== pollRun) return;
          if (o.d.error === 'link_invalid') { renderInvalid(); return; }
          var s = o.r.ok && o.d.ok ? o.d.state : null;
          if (s && s.status !== 'signed' && s.status !== 'ready') { show(s); return; }
          again();
        }, again);
      }, POLL_EVERY_MS);
    }
    again();
  }

  /* ── signing ─────────────────────────────────────────────────────── */

  function loadScript(src) {
    if (dsScript) return dsScript;
    dsScript = new Promise(function (resolve, reject) {
      var el = document.createElement('script');
      el.src = src;
      el.async = true;
      el.onload = function () { if (window.DocuSign) resolve(window.DocuSign); else { dsScript = null; reject(new Error('no DocuSign')); } };
      el.onerror = function () { dsScript = null; el.remove(); reject(new Error('script failed')); };
      document.head.appendChild(el);
    });
    return dsScript;
  }
  function docusignFor(src, key) {
    return loadScript(src).then(function (DS) {
      if (!dsClients[key]) {
        dsClients[key] = Promise.resolve(DS.loadDocuSign(key));
        dsClients[key].catch(function () { delete dsClients[key]; });
      }
      return dsClients[key];
    });
  }

  function backToReady(line, bad) {
    sessionOpen = false;
    session++;
    renderReady(line, bad);
  }

  function startSigning() {
    var btn = $('signBtn');
    btn.disabled = true;
    btn.textContent = 'Opening the agreement…';
    var unavailable = 'The signing service is not answering just now. Try again in a few minutes, or email ' + helpLink + '.';
    call('/signup/sign').then(function (o) {
      if (o.d.error === 'link_invalid') { renderInvalid(); return; }
      if (o.d.error === 'already_signed' && o.d.state) { show(o.d.state); return; }
      var sg = o.r.ok && o.d.ok && o.d.signing;
      if (!sg || !sg.url || !sg.integration_key || !DOCUSIGN_JS.test(sg.js_src || '')) { backToReady(unavailable, true); return; }
      return docusignFor(sg.js_src, sg.integration_key).then(function (docusign) {
        mount(docusign, sg.url);
      }, function () {
        backToReady('The signing panel did not load. Try again, or email ' + helpLink + '.', true);
      });
    }, function () {
      backToReady('That did not reach us. Check your connection and try again.', true);
    });
  }

  function mount(docusign, url) {
    var my = ++session;
    sessionOpen = true;
    render('<h1>Review and sign.</h1>' +
      '<p>Read both documents, then sign where DocuSign marks the place. When you finish, your invoice appears on this page.</p>' +
      '<div class="agreement" id="agreement"><p class="wait" id="agreementWait">Loading the agreement…</p></div>', true);
    try {
      var signing = docusign.signing({
        url: url,
        displayFormat: 'focused',
        style: {
          branding: { primaryButton: { backgroundColor: '#005CC8', color: '#FFFFFF' } },
          signingNavigationButton: { finishText: 'Finish signing', position: 'bottom-center' },
        },
      });
      signing.on('ready', function () {
        if (my === session && $('agreementWait')) $('agreementWait').remove();
      });
      signing.on('sessionEnd', function (e) { ended(my, e && e.type); });
      signing.mount('#agreement');
    } catch (e) {
      backToReady('The signing panel did not load. Try again, or email ' + helpLink + '.', true);
    }
  }

  /* The session is over: DocuSign said so (sessionEnd), or its return page
     (done.html, loaded in the signing frame) told us. Whichever is first. */
  function ended(my, type) {
    if (my !== session || !sessionOpen) return;
    sessionOpen = false;
    if (type === 'signing_complete' || type === '') { finish(type === 'signing_complete'); return; }
    if (type === 'session_timeout' || type === 'ttl_expired') {
      backToReady('The signing session timed out, so nothing was signed. Press Review and sign the agreement to start again.');
    } else if (type === 'decline') {
      backToReady('You declined to sign, so nothing was signed. If something in the agreement needs changing, email ' + helpLink + '.');
    } else {
      backToReady('Nothing was signed. Review and sign the agreement whenever you are ready.');
    }
  }

  /* `signed` is true when DocuSign reported signing_complete; false when
     only the return page spoke and the worker's answer decides. */
  function finish(signed, retried) {
    session++;
    if (!retried) render('<h1>One moment…</h1><p role="status">Recording your signature.</p>');
    call('/signup/complete').then(function (o) {
      if (o.d.error === 'link_invalid') { renderInvalid(); return; }
      var s = o.r.ok && o.d.ok ? o.d.state : null;
      if (s && s.status !== 'ready') { show(s); return; }
      if (s && !signed) { state = s; renderReady('Nothing was signed. Review and sign the agreement whenever you are ready.'); return; }
      renderSigned();
      poll();
    }, function () {
      /* The report did not arrive: send it once more, then wait on the view. */
      renderSigned();
      if (!retried) setTimeout(function () { finish(signed, true); }, POLL_EVERY_MS);
      else poll();
    });
  }

  window.addEventListener('message', function (e) {
    if (e.origin !== location.origin) return;
    var d = e.data;
    if (!d || d.source !== 'np-sign-done') return;
    ended(session, typeof d.event === 'string' ? d.event : '');
  });

  /* ── boot ────────────────────────────────────────────────────────── */
  if (!/^[0-9a-f]{64}$/.test(token)) { renderInvalid(); return; }
  call('/signup/view').then(function (o) {
    if (o.d.error === 'link_invalid') { renderInvalid(); return; }
    if (o.r.ok && o.d.ok && o.d.state) { show(o.d.state); return; }
    renderFailed(false);
  }, function () { renderFailed(true); });
})();

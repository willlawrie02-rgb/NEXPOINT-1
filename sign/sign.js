/* The consultancy sign-up page (spec 2026-10-19, sections 2a and 8). A client
   who has said yes on a call gets a private link (/sign/?t=<token>), reads
   the Introduction Agreement and the Master Terms of Business on this page,
   signs them here by typing the signer's name and position, saying where the
   invoice should go (and a purchase order number, if they use them) and
   ticking that they agree, and is then looking at the Xero invoice for the retainer with
   a way to pay it. There is no DocuSign (Will, 19 October 2026).

   The worker answers two routes, each with the same `state`:
     POST /signup/view    what the link stands at now; while it is ready,
                          `state.agreement` is the text to sign and its hash
     POST /signup/accept  the signature: name, position, the invoice email,
                          the purchase order (may be empty), the tick and
                          the hash of the text this page showed. The worker
                          refuses (agreement_changed) if the text has changed
                          since, so nobody signs a version they were not shown.
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
  var token = new URLSearchParams(location.search).get('t') || '';

  var state = null;       // the latest state the worker gave
  var pollRun = 0;        // bumped to stop a running poll
  var sending = false;    // a signature is on its way to the worker

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function render(html, wide) {
    $('signBody').innerHTML = html;
    $('card').classList.toggle('wide', !!wide);
    document.body.classList.toggle('is-wide', !!wide);
  }
  function say(title, line) { render('<h1>' + esc(title) + '</h1><p>' + line + '</p>'); }
  var helpLink = '<a href="mailto:' + HELP + '">' + HELP + '</a>';
  function call(path, extra) {
    return fetch(API + path, {
      method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ token: token }, extra || {})),
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
  function companyName(s) { return String(s.company || '').replace(/\.+$/, ''); }

  /* ── the agreement, as a document ────────────────────────────────── */

  /* The worker sends the agreement as markdown: the Introduction Agreement,
     then the Master Terms, each opening with its own "# " title (the page's
     CSS sets the second title apart from the first). This reads only what
     that text uses (headings, paragraphs, **bold**, one table, "- " lists)
     and builds the document from elements and text nodes: nothing in the text is ever
     parsed as HTML, so a client's name or address with markup in it shows
     as typed. */
  function inlineInto(el, text) {
    var re = /\*\*(.+?)\*\*/g;
    var at = 0;
    var m;
    while ((m = re.exec(text))) {
      if (m.index > at) el.appendChild(document.createTextNode(text.slice(at, m.index)));
      var b = document.createElement('strong');
      b.textContent = m[1];
      el.appendChild(b);
      at = re.lastIndex;
    }
    if (at < text.length) el.appendChild(document.createTextNode(text.slice(at)));
    return el;
  }
  function block(tag, text) { return inlineInto(document.createElement(tag), text); }
  function cells(line) { return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(function (c) { return c.trim(); }); }
  var TABLE_RULE = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/;

  function renderAgreement(md, box) {
    var lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
    var para = [];
    var list = null;
    var item = null;
    function endPara() { if (para.length) box.appendChild(block('p', para.join(' '))); para = []; }
    function endList() { list = null; item = null; }
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var t = line.trim();
      var m;
      if (!t) { endPara(); endList(); continue; }
      if ((m = /^(#{1,4})\s+(.*)$/.exec(t))) {
        endPara(); endList();
        box.appendChild(block('h' + (m[1].length + 1), m[2]));
        continue;
      }
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) { endPara(); endList(); box.appendChild(document.createElement('hr')); continue; }
      if (t.charAt(0) === '|' && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1].trim())) {
        endPara(); endList();
        var wrap = document.createElement('div');
        wrap.className = 'table';
        var table = wrap.appendChild(document.createElement('table'));
        var head = table.appendChild(document.createElement('thead')).appendChild(document.createElement('tr'));
        cells(t).forEach(function (c) { head.appendChild(block('th', c)); });
        var body = table.appendChild(document.createElement('tbody'));
        for (i += 2; i < lines.length && lines[i].trim().charAt(0) === '|'; i++) {
          var row = body.appendChild(document.createElement('tr'));
          cells(lines[i]).forEach(function (c) { row.appendChild(block('td', c)); });
        }
        i--;
        box.appendChild(wrap);
        continue;
      }
      if ((m = /^[-*+]\s+(.*)$/.exec(t))) {
        endPara();
        if (!list) list = box.appendChild(document.createElement('ul'));
        item = { li: list.appendChild(block('li', m[1])), raw: m[1] };
        continue;
      }
      /* A list item that wraps onto an indented line. */
      if (item && /^\s/.test(line)) {
        item.raw += ' ' + t;
        item.li.textContent = '';
        inlineInto(item.li, item.raw);
        continue;
      }
      endList();
      para.push(t);
    }
    endPara();
  }

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
    sending = false;
    state = s;
    if (!s || !s.status) { renderFailed(false); return; }
    if (s.status === 'ready') renderReady();
    else if (s.status === 'signed') { renderSigned(); poll(); }
    else if (s.status === 'invoiced') renderInvoiced(s);
    else if (s.status === 'paid') renderPaid(s);
    else renderFailed(false);
  }

  function hasAgreement(s) {
    var a = s.agreement;
    return !!(a && typeof a.text === 'string' && a.text.trim() && /^[0-9a-f]{64}$/i.test(String(a.hash || '')));
  }

  function renderReady() {
    var s = state;
    var fee = s.fee || {};
    var company = companyName(s);
    render(
      '<h1>Welcome, ' + esc(company) + '.</h1>' +
      '<p>Thank you for choosing NexPoint. Here, in brief, is the agreement that goes with the proposal we sent you. ' +
        'Read it in full below, then sign it on this page.</p>' +
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
        '<p class="note">The agreement is with NexPoint Global Ltd and has two parts: the Introduction Agreement, made out for ' +
          esc(s.company) + ', and the Master Terms of Business. You sign both at once.</p>' +
        '<div class="actions"><button class="quiet" type="button" id="readBtn" aria-expanded="true" aria-controls="agreementText">Hide the agreement</button></div>' +
        '<div class="doc" id="agreementText" role="region" aria-label="The agreement" tabindex="0"></div>' +
      '</div>' +
      '<form class="panel" id="signForm" novalidate>' +
        '<h2>Sign on behalf of ' + esc(company) + '</h2>' +
        '<div class="field"><label for="signerName">Full name</label>' +
          '<input type="text" id="signerName" autocomplete="name" maxlength="200" spellcheck="false"></div>' +
        '<div class="field"><label for="signerPosition">Position</label>' +
          '<input type="text" id="signerPosition" autocomplete="organization-title" maxlength="200"></div>' +
        '<div class="field"><label for="invoiceEmail">Where should we send the invoice?</label>' +
          '<input type="email" id="invoiceEmail" autocomplete="email" maxlength="200" spellcheck="false" required aria-describedby="invoiceHelp">' +
          '<p class="hint" id="invoiceHelp">Xero sends the invoice and any reminders here.</p></div>' +
        '<div class="field"><label for="purchaseOrder">Purchase order number (optional)</label>' +
          '<input type="text" id="purchaseOrder" maxlength="50" spellcheck="false"></div>' +
        '<label class="tick"><input type="checkbox" id="agree"><span id="agreeLabel">I have read the Introduction Agreement and the ' +
          'Master Terms of Business and agree to them on behalf of ' + esc(company) + '.</span></label>' +
        '<p class="msg" id="signMsg" role="status"></p>' +
        '<div class="actions" id="signActions"><button class="yes" type="submit" id="signBtn" disabled>Sign the agreement</button></div>' +
        '<p class="note">Signing records the name and position you type, the time, your IP address and your browser, ' +
          'with the exact text you signed. A signed copy comes to your inbox with the invoice.</p>' +
      '</form>', true);

    var box = $('agreementText');
    if (hasAgreement(s)) renderAgreement(s.agreement.text, box);
    else {
      box.innerHTML = '<p class="fail">The agreement did not load. Reload the page, or email ' + helpLink + '.</p>';
      setMsg('The agreement did not load, so it cannot be signed yet. Reload the page, or email ' + helpLink + '.', true);
    }
    $('readBtn').addEventListener('click', function () {
      var open = box.hidden;
      box.hidden = !open;
      this.setAttribute('aria-expanded', String(open));
      this.textContent = open ? 'Hide the agreement' : 'Read the agreement';
    });
    $('signerName').value = s.signer_name || '';
    $('invoiceEmail').value = s.invoice_email_default || '';
    ['signerName', 'signerPosition', 'invoiceEmail', 'purchaseOrder'].forEach(function (id) { $(id).addEventListener('input', update); });
    $('agree').addEventListener('change', update);
    $('signForm').addEventListener('submit', sign);
    update();
  }

  function setMsg(html, bad) {
    var m = $('signMsg');
    if (!m) return;
    m.className = 'msg' + (bad ? ' bad' : '');
    m.innerHTML = html;
  }
  function filled() {
    return hasAgreement(state) && !!$('signerName').value.trim() && !!$('signerPosition').value.trim() &&
      !!$('invoiceEmail').value.trim() && $('agree').checked;
  }
  function update() {
    var btn = $('signBtn');
    if (btn) btn.disabled = sending || !filled();
  }
  function lock(on) {
    ['signerName', 'signerPosition', 'invoiceEmail', 'purchaseOrder', 'agree'].forEach(function (id) { $(id).disabled = on; });
  }

  /* What the worker refuses, in plain words. Each is a fixed sentence. */
  var REFUSED = {
    'signer_name required': 'Enter the full name of the person signing.',
    'signer_position required': 'Enter the position of the person signing.',
    'signer_name too long': 'That name is longer than the agreement can record. Shorten it and sign again.',
    'signer_position too long': 'That position is longer than the agreement can record. Shorten it and sign again.',
    'agreement not accepted': 'Tick the box to confirm you have read the agreement and agree to it.',
    'signer_name has formatting characters': 'Take the ** and any line breaks out of your name, then sign again.',
    'signer_position has formatting characters': 'Take the ** and any line breaks out of your position, then sign again.',
    'invoice_email required': 'Enter the email address for the invoice.',
    'invalid invoice_email': 'That invoice email address does not look right.',
    'purchase_order too long': 'Keep the purchase order number to 50 characters.',
    'purchase_order has formatting characters': 'Take ** and line breaks out of the purchase order number.',
  };

  function sign(e) {
    e.preventDefault();
    if (sending || !filled()) return;
    sending = true;
    update();
    lock(true);
    $('signBtn').textContent = 'Signing…';
    setMsg('', false);
    call('/signup/accept', {
      signer_name: $('signerName').value.trim(),
      signer_position: $('signerPosition').value.trim(),
      invoice_email: $('invoiceEmail').value.trim(),
      purchase_order: $('purchaseOrder').value.trim(),
      agree: true,
      agreement_hash: state.agreement.hash,
    }).then(function (o) {
      var d = o.d;
      if (d.error === 'link_invalid') { renderInvalid(); return; }
      if (o.r.ok && d.ok && d.state && d.state.status !== 'ready') { show(d.state); return; }
      if (d.error === 'already_signed' && d.state) { show(d.state); return; }
      if (d.error === 'agreement_changed') { changed(); return; }
      back(REFUSED[d.error] ? esc(REFUSED[d.error]) : 'That did not go through. Try again in a moment, or email ' + helpLink + '.');
    }, function () {
      back('That did not reach us. Check your connection and try again.');
    });
  }
  /* The form stays as the client filled it, with the reason above the button. */
  function back(line) {
    sending = false;
    lock(false);
    $('signBtn').textContent = 'Sign the agreement';
    setMsg(line, true);
    update();
  }
  /* A new version went live after this page opened. Signing it here would
     sign text the client was not shown, so the only way on is a reload. */
  function changed() {
    sending = false;
    setMsg('The agreement was updated since you opened this page. Reload to read the current version.', true);
    $('signActions').innerHTML = '<button class="yes" type="button" id="reloadBtn">Reload the page</button>';
    $('reloadBtn').addEventListener('click', function () { location.reload(); });
  }

  function signedBy(s) {
    if (!s.signed_name) return '';
    var when = longDate(s.signed_at, 'Europe/London');
    return '<p class="note" id="signedBy">Signed by ' + esc(s.signed_name) + (s.signed_position ? ', ' + esc(s.signed_position) : '') +
      (when ? ', on ' + esc(when) : '') + '.</p>';
  }

  /* Where the invoice goes, as the signer gave it, and their purchase order. */
  function invoiceTo(s) {
    if (!s.invoice_email) return '';
    return '<p class="note" id="invoiceTo">Invoice to ' + esc(s.invoice_email) +
      (s.purchase_order ? ', purchase order ' + esc(s.purchase_order) : '') + '.</p>';
  }

  function renderSigned(line) {
    render('<h1>Agreement signed.</h1>' + signedBy(state || {}) + invoiceTo(state || {}) + '<p id="pendingLine" role="status">' +
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
      signedBy(s) + invoiceTo(s) +
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
     raised after the signature. The cron pass finishes the job either way,
     and opening the link again shows wherever it has got to. */
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

  /* ── boot ────────────────────────────────────────────────────────── */
  if (!/^[0-9a-f]{64}$/.test(token)) { renderInvalid(); return; }
  call('/signup/view').then(function (o) {
    if (o.d.error === 'link_invalid') { renderInvalid(); return; }
    if (o.r.ok && o.d.ok && o.d.state) { show(o.d.state); return; }
    renderFailed(false);
  }, function () { renderFailed(true); });
})();

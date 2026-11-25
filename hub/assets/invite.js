/* The invitation landing (plan 052, task 3.2). A user invited a colleague
   into their account; the link in the invitation carries a one-time token.
   This page asks the worker who is asking and for which account
   (POST /auth/invite), then takes the colleague's name and the Platform
   Terms, and posts them with the token (POST /auth/register-invited).
   The worker creates the sign-in inside the existing account and sends the
   ordinary confirmation email: like every account, this one can act once the
   address is confirmed (one-door register, 2026-09-17).

   No password is asked for here (plan 093, 14 November 2026). The colleague
   chooses it on the page the confirmation link opens, as a new registrant
   does. This page used to take a password the sign-in service could refuse
   (its rule as read on 14 November 2026: 8 characters with a lower-case
   letter, a capital, a number and a symbol), with no words for the refusal,
   so a colleague whose password was refused could never join.

   Standalone, like confirm.html and reset.html: someone arriving from an
   email client may have no session and nothing cached, so the page carries
   its own styles and loads no shared script.                             */
(function () {
  'use strict';
  var local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var API = local ? 'http://localhost:8787' : 'https://api.nexpoint.co.uk';
  var TERMS_URL = 'https://nexpoint.co.uk/hub/terms/';
  var token = new URLSearchParams(location.search).get('t') || '';
  var invite = null;
  var termsId = null;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function body() { return document.getElementById('inviteBody'); }
  function render(html) { body().innerHTML = html; }
  function say(title, line) { render('<h1>' + esc(title) + '</h1><p>' + esc(line) + '</p>'); }
  function $(id) { return document.getElementById(id); }
  /* A request that has had no whole answer after REQUEST_TIMEOUT_MS is given
     up and lands in the same place a dropped connection does (audit of
     11 November 2026, finding 10a-03): before, a link opened on a stalled
     connection sat on "One moment…" for as long as the browser waited. The
     body is read inside the limit, and what comes back answers ok, status
     and json() as the fetch answer did. */
  var REQUEST_TIMEOUT_MS = 20000;
  function limited(url, opts) {
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, REQUEST_TIMEOUT_MS) : null;
    var stop = function () { if (timer) clearTimeout(timer); };
    return fetch(url, Object.assign(ctl ? { signal: ctl.signal } : {}, opts)).then(function (r) {
      return r.text().then(function (text) {
        stop();
        return { ok: r.ok, status: r.status, json: function () { return new Promise(function (res) { res(JSON.parse(text)); }); } };
      });
    }).catch(function (e) { stop(); throw e; });
  }
  function call(path, payload, method) {
    return limited(API + path, {
      method: method || 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) { return { r: r, d: d }; });
    });
  }

  function renderUsed() {
    render('<h1>This invitation has been used or has expired.</h1>' +
      '<p>An invitation works once and lasts seven days. Ask the colleague who sent it for a new one, or email ' +
      '<a href="mailto:hello@nexpoint.co.uk">hello@nexpoint.co.uk</a>.</p>');
  }

  function renderForm() {
    var who = invite.inviter ? esc(invite.inviter) + ' has invited you' : 'You have been invited';
    render(
      '<h1>Join ' + esc(invite.company || 'your colleagues') + '.</h1>' +
      '<p>' + who + ' to join the ' + esc(invite.company || 'company') + ' account on the NexPoint Global Portal. ' +
        'Tell us your name; we then send one email to confirm the address, and you choose your password there.</p>' +
      '<div class="panel">' +
        '<div class="field"><label>Email</label><div class="fixed" id="invEmail">' + esc(invite.email) + '</div></div>' +
        '<div class="field"><label for="invName">Your name</label><input id="invName" type="text" autocomplete="name" maxlength="200"></div>' +
        '<div class="field"><label for="invPhone">Phone (optional)</label><input id="invPhone" type="tel" autocomplete="tel" maxlength="50"></div>' +
        '<div id="invTerms"><p>Loading the Platform Terms…</p></div>' +
        '<p class="err" id="formErr"></p>' +
        '<div class="actions"><button class="yes" type="button" id="joinBtn" disabled>Join ' + esc(invite.company || 'the account') + '</button></div>' +
      '</div>');
    $('joinBtn').addEventListener('click', join);
    $('invName').addEventListener('keydown', function (e) { if (e.key === 'Enter') join(); });
    $('invName').focus();
    call('/terms/current?layer=platform', undefined, 'GET').then(function (o) {
      if (!o.r.ok || !o.d || !o.d.id) {
        $('invTerms').innerHTML = '<p class="err" style="display:block">We could not load the Platform Terms, so we cannot set you up yet. Refresh and try again, or email hello@nexpoint.co.uk.</p>';
        return;
      }
      termsId = o.d.id;
      $('invTerms').innerHTML = '<label class="terms-tick"><input type="checkbox" id="invTick"> <span>I accept the ' +
        '<a href="' + TERMS_URL + '" target="_blank" rel="noopener">Platform Terms</a>' +
        (o.d.version ? ', version ' + esc(o.d.version) + '</span></label>' +
          '<p class="terms-dl"><a href="' + esc(API + '/terms/platform/' + encodeURIComponent(o.d.version) + '.pdf') + '" download>Download a copy</a></p>'
          : '</span></label>');
      $('joinBtn').disabled = false;
    }).catch(function () {
      $('invTerms').innerHTML = '<p class="err" style="display:block">We could not load the Platform Terms. Check your connection and refresh.</p>';
    });
  }

  function showError(text) {
    var e = $('formErr');
    if (!e) return;
    e.textContent = text;
    e.style.display = 'block';
  }

  /* The Resend on the card after Join (plan 102, R7-01). An invited colleague
     who missed the confirmation email had no way to ask for another: the
     invitation is spent, and a fresh one is refused. The worker answers a
     resend the same way whatever the address, so the card says only what is
     true either way.

     These two mirror assets/hub-account.js (this page loads no shared
     script, so the copy lives here). The worker's CONFIRM_RESEND_COOLDOWN_MS
     is 120 seconds, but its clock starts when the email log row is written
     after the send, a second or two after this card appears. Counting exactly
     120 from here would end inside the worker's window: nothing sent, and the
     card saying a link is on its way. So ten seconds more. */
  var RESEND_WAIT_S = 130;
  var RESEND_LABEL = 'Resend the email';
  function wireResend(btn, note, email) {
    if (!btn || !note) return;
    var timer = null;
    function stop() { if (timer) { clearInterval(timer); timer = null; } }
    function show(words) { note.textContent = words; note.hidden = false; }
    /* Counted against the clock, not by ticks, so a tab left in the
       background comes back to the right number. A button no longer in the
       page stops its own timer. */
    function wait() {
      stop();
      var until = Date.now() + RESEND_WAIT_S * 1000;
      function tick() {
        if (!btn.isConnected) { stop(); return; }
        var left = Math.ceil((until - Date.now()) / 1000);
        if (left <= 0) {
          stop();
          btn.disabled = false; btn.textContent = RESEND_LABEL;
          return;
        }
        var m = Math.floor(left / 60);
        var s = left % 60;
        btn.disabled = true;
        btn.textContent = RESEND_LABEL + ' in ' + m + ':' + (s < 10 ? '0' + s : s);
      }
      tick();
      timer = setInterval(tick, 1000);
    }
    btn.addEventListener('click', function () {
      if (btn.disabled) return;
      btn.disabled = true; btn.textContent = 'Sending…';
      call('/auth/resend-confirmation', { email: email })
        .then(function () {
          /* Any answer is "sent": the worker says the same thing whatever it
             found. */
          show('If that address still needs confirming, a new link is on its way. It can take a minute to arrive, and it may be in your junk folder.');
          wait();
        })
        .catch(function () {
          /* It never left this device, so there is nothing to wait out. */
          show('That did not send. Check your connection and try again.');
          btn.disabled = false; btn.textContent = RESEND_LABEL;
        });
    });
    wait();
  }

  var ERRORS = {
    'name required': 'Enter your name.',
    'invalid terms_version_id': 'The Platform Terms have just changed. Refresh the page and accept the new version.',
    account_exists: 'That address already has a hub account, so it cannot join a second one. Sign in with it, or email hello@nexpoint.co.uk.',
  };
  function join() {
    var name = ($('invName').value || '').trim();
    if (!name) { showError('Enter your name.'); $('invName').focus(); return; }
    if (!termsId || !$('invTick') || !$('invTick').checked) { showError('Tick the box to accept the Platform Terms.'); return; }
    var btn = $('joinBtn');
    if (btn.disabled) return;
    var label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Setting up…';
    call('/auth/register-invited', { token: token, name: name, phone: $('invPhone').value, terms_version_id: termsId })
      .then(function (o) {
        if (o.r.ok && o.d && o.d.ok) {
          render('<h1>Check your inbox.</h1><p>We have sent one email to <strong>' + esc(invite.email) +
            '</strong>. Open the link in it, choose your password, and you are in.</p>' +
            '<p id="resendNote" role="status" hidden></p>' +
            '<div class="actions"><button class="yes" type="button" id="resendBtn" disabled>Resend the email in 2:10</button></div>');
          wireResend($('resendBtn'), $('resendNote'), invite.email);
          return;
        }
        btn.disabled = false; btn.textContent = label;
        if (o.d && o.d.error === 'invite_invalid') { renderUsed(); return; }
        showError(ERRORS[o.d && o.d.error] || 'That did not go through. Try again, or email hello@nexpoint.co.uk.');
      })
      .catch(function () {
        btn.disabled = false; btn.textContent = label;
        showError('That did not send. Check your connection and try again.');
      });
  }

  if (!token) {
    say('Link incomplete.', 'This link is missing information. Use the link from your invitation, or email hello@nexpoint.co.uk.');
    return;
  }
  call('/auth/invite', { token: token }).then(function (o) {
    if (o.r.ok && o.d && o.d.ok) { invite = o.d; renderForm(); return; }
    if (o.d && o.d.error === 'invite_invalid') { renderUsed(); return; }
    say('That did not go through.', 'Open the link from your invitation again, or email hello@nexpoint.co.uk.');
  }).catch(function () {
    say('That did not go through.', 'Check your connection and open the link again, or email hello@nexpoint.co.uk.');
  });
})();

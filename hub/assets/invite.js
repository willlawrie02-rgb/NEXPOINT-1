/* The invitation landing (plan 052, task 3.2). A user invited a colleague
   into their account; the link in the invitation carries a one-time token.
   This page asks the worker who is asking and for which account
   (POST /auth/invite), then takes the colleague's name, a password and the
   Platform Terms, and posts them with the token (POST /auth/register-invited).
   The worker creates the sign-in inside the existing account and sends the
   ordinary confirmation email: like every account, this one can act once the
   address is confirmed (one-door register, 2026-09-17).

   Standalone, like confirm.html and reset.html: someone arriving from an
   email client may have no session and nothing cached, so the page carries
   its own styles and loads no shared script.                             */
(function () {
  'use strict';
  var local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var API = local ? 'http://localhost:8787' : 'https://api.nexpoint.co.uk';
  var TERMS_URL = 'https://nexpoint.co.uk/hub/terms/';
  var MIN_LENGTH = 8;
  var token = new URLSearchParams(location.search).get('t') || '';
  var invite = null;
  var termsId = null;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function body() { return document.getElementById('inviteBody'); }
  function render(html) { body().innerHTML = html; }
  function say(title, line) { render('<h1>' + esc(title) + '</h1><p>' + esc(line) + '</p>'); }
  function $(id) { return document.getElementById(id); }
  function call(path, payload, method) {
    return fetch(API + path, {
      method: method || 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) { return { r: r, d: d }; });
    });
  }

  /* The same eye every other password field has (plan 046), inlined
     because this page loads no shared script. */
  function passwordEye(input) {
    if (!input || input.dataset.npEye) return;
    input.dataset.npEye = '1';
    var wrap = document.createElement('div');
    wrap.className = 'np-eye';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'np-eye__btn';
    btn.setAttribute('aria-label', 'Show password');
    btn.setAttribute('aria-pressed', 'false');
    btn.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">visibility</span>';
    btn.addEventListener('click', function () {
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.setAttribute('aria-pressed', show ? 'true' : 'false');
      btn.firstChild.textContent = show ? 'visibility_off' : 'visibility';
      input.focus();
    });
    wrap.appendChild(btn);
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
      '<p>' + who + ' to join the ' + esc(invite.company || 'company') + ' account on the NexPoint Global Hub. ' +
        'Choose your name and a password; we then send one email to confirm the address.</p>' +
      '<div class="panel">' +
        '<div class="field"><label>Email</label><div class="fixed" id="invEmail">' + esc(invite.email) + '</div></div>' +
        '<div class="field"><label for="invName">Your name</label><input id="invName" type="text" autocomplete="name" maxlength="200"></div>' +
        '<div class="field"><label for="invPhone">Phone (optional)</label><input id="invPhone" type="tel" autocomplete="tel" maxlength="50"></div>' +
        '<div class="field"><label for="invPass">Password</label><input id="invPass" type="password" autocomplete="new-password" minlength="' + MIN_LENGTH + '"></div>' +
        '<div id="invTerms"><p>Loading the Platform Terms…</p></div>' +
        '<p class="err" id="formErr"></p>' +
        '<div class="actions"><button class="yes" type="button" id="joinBtn" disabled>Join ' + esc(invite.company || 'the account') + '</button></div>' +
      '</div>');
    passwordEye($('invPass'));
    $('joinBtn').addEventListener('click', join);
    $('invPass').addEventListener('keydown', function (e) { if (e.key === 'Enter') join(); });
    $('invName').focus();
    call('/terms/current?layer=platform', undefined, 'GET').then(function (o) {
      if (!o.r.ok || !o.d || !o.d.id) {
        $('invTerms').innerHTML = '<p class="err" style="display:block">We could not load the Platform Terms, so we cannot set you up yet. Refresh and try again, or email hello@nexpoint.co.uk.</p>';
        return;
      }
      termsId = o.d.id;
      $('invTerms').innerHTML = '<label class="terms-tick"><input type="checkbox" id="invTick"> <span>I accept the ' +
        '<a href="' + TERMS_URL + '" target="_blank" rel="noopener">NexPoint Platform Terms</a></span></label>';
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

  var ERRORS = {
    'name required': 'Enter your name.',
    'invalid terms_version_id': 'The Platform Terms have just changed. Refresh the page and accept the new version.',
    account_exists: 'That address already has a hub account, so it cannot join a second one. Sign in with it, or email hello@nexpoint.co.uk.',
  };
  function join() {
    var name = ($('invName').value || '').trim();
    var pass = $('invPass').value || '';
    if (!name) { showError('Enter your name.'); $('invName').focus(); return; }
    if (pass.length < MIN_LENGTH) { showError('Use at least ' + MIN_LENGTH + ' characters for the password.'); $('invPass').focus(); return; }
    if (pass.length > 72) { showError('Use 72 characters or fewer for the password.'); return; }
    if (!termsId || !$('invTick') || !$('invTick').checked) { showError('Tick the box to accept the Platform Terms.'); return; }
    var btn = $('joinBtn');
    var label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Setting up…';
    call('/auth/register-invited', { token: token, name: name, phone: $('invPhone').value, password: pass, terms_version_id: termsId })
      .then(function (o) {
        if (o.r.ok && o.d && o.d.ok) {
          render('<h1>Check your inbox.</h1><p>We have sent one email to <strong>' + esc(invite.email) +
            '</strong>. Open the link in it to confirm the address, and you are in.</p>');
          return;
        }
        btn.disabled = false; btn.textContent = label;
        if (o.d && o.d.error === 'invite_invalid') { renderUsed(); return; }
        showError(ERRORS[o.d && o.d.error] || (/^password/.test((o.d && o.d.error) || '')
          ? 'Use a password of 8 to 72 characters.' : 'That did not go through. Try again, or email hello@nexpoint.co.uk.'));
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

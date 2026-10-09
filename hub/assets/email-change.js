/* The email-change landing (plan 052, task 3.4). A user asked, from their
   account page, to sign in with a new address; the worker sent this link
   to that NEW address. Posting the token back (POST /account/email/confirm)
   is what makes the change: nothing changed before it, and the old address
   is told once it has. No session is needed: the link proves the inbox, and
   the request behind it proved the password.

   Standalone, like confirm.html, for the same reason: it is opened from an
   email client.                                                          */
(function () {
  'use strict';
  var local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var API = local ? 'http://localhost:8787' : 'https://api.nexpoint.co.uk';
  var ACCOUNT_URL = /\.nexpoint\.co\.uk$/.test(location.hostname) ? 'https://nexpoint.co.uk/hub/account/' : '/hub/account/';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function render(html) { document.getElementById('emailBody').innerHTML = html; }
  function say(title, line) { render('<h1>' + esc(title) + '</h1><p>' + esc(line) + '</p>'); }

  var token = new URLSearchParams(location.search).get('t');
  if (!token) {
    say('Link incomplete.', 'This link is missing information. Use the link from your email, or email hello@nexpoint.co.uk.');
    return;
  }
  fetch(API + '/account/email/confirm', {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: token }),
  }).then(function (r) {
    return r.json().catch(function () { return {}; }).then(function (d) {
      if (r.ok && d && d.ok) {
        render('<h1>Your email address is changed.</h1><p>From now on you sign in with <strong>' + esc(d.email) +
          '</strong>. Your password is unchanged.</p>' +
          '<div class="actions"><a class="btn yes" href="' + esc(ACCOUNT_URL) + '">Go to your account</a></div>');
        return;
      }
      if (d && d.error === 'link_invalid') {
        say('This link has been used or has expired.', 'A link works once and lasts 24 hours. Ask for a new one from the You section of your account page.');
        return;
      }
      if (d && d.error === 'address_has_account') {
        say('That address is taken.', 'Another hub account signs in with that address now, so yours stays as it was. Email hello@nexpoint.co.uk and we will sort it out.');
        return;
      }
      say('That did not go through.', 'Open the link from your email again, or email hello@nexpoint.co.uk and we will sort it out.');
    });
  }).catch(function () {
    say('That did not go through.', 'Check your connection and open the link again, or email hello@nexpoint.co.uk.');
  });
})();

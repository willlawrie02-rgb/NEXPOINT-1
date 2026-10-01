/* The second factor for the two operators (plan 035, 2026-10-01).

   Every board loads this after supabase-js and before its own script, and
   both of its paths in, the session found on boot and a fresh password
   sign-in, wait on NXAdminAuth.requireAal2(sb) before showAdmin. The
   promise resolves true once the session is aal2 (a password AND a
   verified second factor): at once if it already is; after a six-digit
   code when a factor is enrolled; after enrolment (a QR code, then the
   first code) when none is. It resolves false when the operator backs
   out of a challenge, and the board shows its sign-in card again; backing
   out of enrolment resolves true (see enrol), a grace that ends when 0054
   makes the database require the factor.

   Order of landing, so nobody is locked out: this script ships first and
   both operators enrol through it; only then does migration 0054 make
   public.is_brief_admin() require aal2, from which moment a password-only
   session reads no rows and queues no intent. Adding an operator means
   adding the address to is_brief_admin() (a migration) AND enrolling a
   factor here; the ADMIN_EMAILS list in each board is only a hint for
   which screen to show.

   Sign-in only, deliberately: no table reads or writes, nothing a board
   does beyond the door. The first shared script besides hub-board.js;
   DEBT-04 (one board shell) is the right follow-on. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* The code prompt lives under the sign-in card, in the card's own style. */
  function panel() {
    let p = $('nxMfa');
    if (!p) {
      p = document.createElement('div');
      p.id = 'nxMfa';
      p.className = 'card';
      const card = document.querySelector('#login .card');
      if (card && card.parentNode) card.parentNode.insertBefore(p, card.nextSibling);
      else document.body.appendChild(p);
    }
    return p;
  }
  function passwordForm(show) {
    const f = document.querySelector('#login form');
    if (f) f.style.display = show ? '' : 'none';
  }
  function showDoor() {
    const login = $('login'), admin = $('admin');
    if (login) login.style.display = 'block';
    if (admin) admin.style.display = 'none';
  }

  /* Renders `intro` and a six-digit code form; resolves true when `submit`
     accepts a code, and `onCancel` (false unless given) when the operator
     backs out through the button labelled `cancelLabel`. A refused code
     stays on the form with the reason, so the next code from the app can
     be tried. */
  function ask(intro, submit, onCancel, cancelLabel) {
    return new Promise((resolve) => {
      const p = panel();
      p.innerHTML = intro +
        '<form id="nxMfaForm">' +
        '<input id="nxMfaCode" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" ' +
        'maxlength="6" placeholder="6-digit code" required>' +
        '<button class="btn btn-pri" type="submit">Verify</button> ' +
        '<button class="btn" type="button" id="nxMfaCancel">' + esc(cancelLabel || 'Cancel') + '</button>' +
        '</form><div class="err" id="nxMfaErr" role="alert"></div>';
      const form = $('nxMfaForm'), code = $('nxMfaCode'), err = $('nxMfaErr');
      code.focus();
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        err.textContent = '';
        const button = form.querySelector('button[type=submit]');
        button.disabled = true;
        try {
          await submit(code.value.trim());
          resolve(true);
        } catch (ex) {
          err.textContent = (ex && ex.message) || 'That code did not verify. Try the next one your app shows.';
          button.disabled = false;
          code.select();
        }
      });
      $('nxMfaCancel').addEventListener('click', () => resolve(!!onCancel));
    });
  }

  /* supabase-js hands the QR code back as `data:image/svg+xml;utf-8,<svg ...>`:
     the SVG raw, quotes and all, which cannot sit inside an HTML attribute
     (Will's walk, 1 October: the tag broke at the first quote and the page
     drew the raw markup). The payload is percent-encoded whatever shape it
     arrives in, and the attribute is escaped on top. */
  function svgDataUri(qr) {
    const text = String(qr || '');
    const comma = text.indexOf(',');
    const payload = text.indexOf('data:') === 0 && comma > 0 ? text.slice(comma + 1) : text;
    if (payload.trim().indexOf('<') === 0) return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(payload);
    return text;
  }

  async function verifyWith(sb, factorId, code) {
    const { data: ch, error: e1 } = await sb.auth.mfa.challenge({ factorId });
    if (e1) throw e1;
    const { error: e2 } = await sb.auth.mfa.verify({ factorId, challengeId: ch.id, code });
    if (e2) throw e2;
  }

  function challenge(sb, factor) {
    return ask('<p>Enter the six-digit code from your authenticator app.</p>',
      (code) => verifyWith(sb, factor.id, code));
  }

  async function enrol(sb, factors) {
    /* An enrolment abandoned half way leaves an unverified factor behind,
       and a second enrol under the same name is refused: tidy first. */
    for (const stale of (factors.all || []).filter((f) => f.status !== 'verified')) {
      try { await sb.auth.mfa.unenroll({ factorId: stale.id }); } catch (_) { /* best effort */ }
    }
    const { data: en, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'NexPoint admin' });
    if (error) {
      panel().innerHTML = '<div class="err" role="alert">Could not start the second-factor set-up: ' +
        esc(error.message) + '</div>';
      return false;
    }
    const src = svgDataUri(en.totp && en.totp.qr_code);
    return ask(
      '<p>Set up your second factor: scan this with an authenticator app (Google Authenticator, ' +
      'Microsoft Authenticator or 1Password), then enter the first code it shows.</p>' +
      '<p><img alt="QR code for the authenticator app" src="' + esc(src) + '" width="180" height="180"></p>' +
      '<p class="hint">Or enter the key by hand: <code>' + esc(en.totp && en.totp.secret) + '</code></p>',
      (code) => verifyWith(sb, en.id, code),
      /* "Not now" opens the board anyway: until migration 0054 the database
         admits a password alone, so an operator who cannot enrol today is
         not locked out by the boards themselves. After 0054 that board
         would simply show no rows, which is the plan's own check. */
      true, 'Not now');
  }

  async function requireAal2(sb) {
    const { data: aal, error } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error) {
      /* The level cannot be read (an old client, a network blip): let the
         board carry on and the database decide, which is where the gate is. */
      return true;
    }
    if (aal && aal.currentLevel === 'aal2') return true;
    const { data: factors } = await sb.auth.mfa.listFactors();
    const totp = ((factors && factors.totp) || []).find((f) => f.status === 'verified');
    showDoor();
    passwordForm(false);
    try {
      return totp ? await challenge(sb, totp) : await enrol(sb, factors || {});
    } finally {
      passwordForm(true);
      panel().innerHTML = '';
    }
  }

  window.NXAdminAuth = { requireAal2 };
})();

/* NexPoint Global Hub - the hub account module (spec 2026-09-03).
   Served from the apex only; subdomain pages load it by absolute URL.
   Progressive enhancement: if this file fails to load, every form falls back
   to its original anonymous behaviour.

   One account per site, and an account exists only once the email behind it
   has been clicked through (one-door register, 2026-09-17). Registration
   sends a confirmation link and signs nobody in; until the click the site
   treats the person as a stranger. Every hub page except the door carries
   data-np-wall and is for signed-in accounts only: enforceDoor() below sends
   a stranger to the door and back. Nothing is held for later. */
(function () {
  'use strict';
  const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const API = local ? 'http://localhost:8787' : 'https://api.nexpoint.co.uk';

  /* The account page lives on the apex; a subdomain has to leave its own host
     to reach it. Same-origin pages keep a relative link. */
  const ACCOUNT_URL = /\.nexpoint\.co\.uk$/.test(location.hostname)
    ? 'https://nexpoint.co.uk/hub/account/' : '/hub/account/';

  async function call(path, opts) {
    let r;
    try {
      r = await fetch(API + path, Object.assign({ credentials: 'include' }, opts));
    } catch (e) {
      return { error: 'network' };
    }
    return r.json().catch(() => ({ error: 'bad response' }));
  }

  function postJson(path, body) {
    return call(path, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body) });
  }

  /* An account the worker has not told us about is treated as confirmed: an
     older worker that does not know the field yet must not lock everyone out
     of their own account. */
  function normalise(m) {
    if (!m) return null;
    const flag = m.confirmed != null ? m.confirmed : m.email_confirmed;
    m.email_confirmed = flag == null ? true : !!flag;
    return m;
  }

  /* Platform Terms (spec §6, layer 1): registration requires a current terms_version_id.
     Kicked off the moment the questionnaire opens, so by the time someone reaches step 2
     it has usually already resolved - step2 awaits it rather than blocking earlier steps. */
  let termsFetch = null;
  let termsResult = null;
  function loadPlatformTerms() {
    termsResult = null;
    termsFetch = call('/terms/current?layer=platform', { method: 'GET' }).then((d) => { termsResult = d; return d; });
    return termsFetch;
  }

  const A = {
    api: API,
    accountUrl: ACCOUNT_URL,
    /* Turnstile on the register form (Will, 2026-09-07 23:15). Set 2026-09-21
       (audit plan 010): Will created the widget "NexPoint hub register" in
       Cloudflare, and this is its site key, which is public by design (it is
       in every page that renders the widget). Deploy order matters: the site
       key goes live here on the website FIRST, then the matching worker
       secret second, or the worker will start rejecting registrations the form
       is not yet sending a token for. It lives on this module, not on NP,
       because this module owns the register form and is loaded on every page
       that opens it, including the Opportunities board, which never loads
       portal.js. Emptying it again switches the widget off: the questionnaire
       renders nothing extra and the register body carries no token, so remove
       the worker's TURNSTILE_SECRET before ever doing that. */
    TURNSTILE_SITE_KEY: '0x4AAAAAAE-v1pLLNA7WlqfZ',
    user: null,
    ready: null,
    async refresh() {
      try {
        const d = await call('/auth/me', { method: 'GET' });
        const signedIn = d.signed_in != null ? d.signed_in : !!(d.ok && d.member);
        A.user = signedIn ? normalise(d.member) : null;
      } catch (e) { A.user = null; }
      document.dispatchEvent(new CustomEvent('npaccount:change'));
      renderChip();
      whenDom(enforceDoor);
      return A.user;
    },
    async signIn(email, password) {
      const d = await postJson('/auth/login', { email, password });
      if (d.ok) { A.user = normalise(d.member); document.dispatchEvent(new CustomEvent('npaccount:change')); renderChip(); whenDom(enforceDoor); }
      return d;
    },
    /* Honest sign-out (audit plan 008): the worker's answer is read, and a
       failure is said in the chip rather than hidden behind a signed-out
       look that the next page load undoes. On a walled page the door then
       takes over: nothing is left on screen for the next person. */
    async signOut() {
      const d = await call('/auth/logout', { method: 'POST' });
      if (!d || !d.ok) {
        renderChip('Could not sign out. Check your connection and try again.');
        return d || { error: 'network' };
      }
      A.user = null;
      document.dispatchEvent(new CustomEvent('npaccount:change'));
      renderChip();
      enforceDoor();
      return d;
    },
    resendConfirmation(email) { return postJson('/auth/resend-confirmation', { email: email }); },
    /* Audit plan 006: the worker answers every address the same way, so the
       caller must show one message whatever comes back. */
    resetRequest(email) { return postJson('/auth/reset-request', { email: email }); },
  };

  /* ── the door (one-door register, 2026-09-17) ───────────────────────
     Every hub page except the door itself, the link landings and the legal
     pages declares data-np-wall on <body>. Such a page is for signed-in
     accounts only: until /auth/me has answered it stays hidden (portal.css,
     or an inline rule on a page without it), a signed-in visitor gets
     data-np-open, and a stranger is sent to the door with the sign-in box
     open and this page's address to come back to. */
  const DOOR_URL = /(^|\.)nexpoint\.co\.uk$/.test(location.hostname) ? 'https://nexpoint.co.uk/hub/' : '/hub/';
  function safeReturn(raw) {
    if (!raw) return null;
    let u;
    try { u = new URL(raw, location.href); } catch (e) { return null; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    const h = u.hostname;
    const ok = h === 'nexpoint.co.uk' || h.endsWith('.nexpoint.co.uk') || h === 'localhost' || h === '127.0.0.1';
    return ok ? u.href : null;
  }
  function doorReturn() { return safeReturn(new URLSearchParams(location.search).get('return')); }
  function whenDom(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }
  function enforceDoor() {
    const b = document.body;
    if (!b) return;
    b.toggleAttribute('data-np-signed-in', !!A.user);
    if (!b.hasAttribute('data-np-wall')) return;
    if (A.user) { b.setAttribute('data-np-open', ''); return; }
    location.replace(DOOR_URL + '?signin=1&return=' + encodeURIComponent(location.href));
  }
  A.doorUrl = DOOR_URL;
  A.safeReturn = safeReturn;
  A.doorReturn = doorReturn;
  A.enforceDoor = enforceDoor;

  /* The worker has just refused this page's session (a 401 mid-visit: the
     sign-in lapsed, or they signed out in another tab), so A.user is stale.
     Forget it without going to the door: the page stays as typed, the chip
     tells the truth, and requireConfirmed() then opens the sign-in box over
     the form (one-door register, Q5). No npaccount:change is sent, because
     page modules re-render on it and the point is to keep what was typed. */
  A.sessionLapsed = function () {
    if (!A.user) return;
    A.user = null;
    renderChip();
  };

  /* The one place a desk request is posted, so there is a single request
     shape to keep true. */
  A.submitRequest = function (action) {
    const u = A.user || {};
    return postJson('/requests', {
      hub: action.hub, side: action.side, brief_ref: action.brief_ref || '',
      company: u.company || '', contact_name: u.name || '', email: u.email || '', phone: '',
      location: [u.town, u.country].filter(Boolean).join(', '),
      payload: action.payload || {}, company_url: '',
    });
  };

  /* ── the header chip ─────────────────────────────────────────────── */
  /* `failure`, when given, is one line shown beside the chip: the only
     caller is a sign-out the worker refused or the network dropped. */
  function renderChip(failure) {
    const slot = document.querySelector('[data-np-account-slot]');
    if (!slot) return;
    if (A.user) {
      const fail = failure
        ? ' <span class="np-chip__fail" role="alert" style="color:#E5484D;font-size:13px">' + escapeText(failure) + '</span>'
        : '';
      slot.innerHTML = '<span class="np-chip">Signed in · ' + escapeText(A.user.name || A.user.email) + ' ' +
        '<a class="np-chip__link" href="' + ACCOUNT_URL + '">Your account</a> ' +
        '<button type="button" class="np-chip__out">Sign out</button>' + fail + '</span>';
      slot.querySelector('.np-chip__out').addEventListener('click', () => A.signOut());
    } else {
      slot.innerHTML = '<a href="#" data-np-signin>Sign in</a> ' +
        '<button class="btn btn-primary" data-np-join>Create your hub account</button>';
      slot.querySelector('[data-np-signin]').addEventListener('click', (e) => { e.preventDefault(); openSignIn(); });
      slot.querySelector('[data-np-join]').addEventListener('click', () => A.openQuestionnaire({}));
    }
  }
  function escapeText(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ── overlay ─────────────────────────────────────────────── */
  function overlay() {
    let ov = document.getElementById('npAccountOverlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.className = 'overlay'; ov.id = 'npAccountOverlay';
      ov.innerHTML = '<div class="modal" role="dialog" aria-modal="true" aria-label="Create your hub account">' +
        '<button class="close" aria-label="Close"><span class="material-symbols-outlined" aria-hidden="true">close</span></button>' +
        '<div id="npAccountContent"></div></div>';
      document.body.appendChild(ov);
      ov.addEventListener('click', (e) => { if (e.target === ov) hide(); });
      ov.querySelector('.close').addEventListener('click', hide);
    }
    return ov;
  }
  function show() { overlay().classList.add('open'); document.body.style.overflow = 'hidden'; }
  function hide() {
    const ov = document.getElementById('npAccountOverlay');
    if (ov) ov.classList.remove('open');
    document.body.style.overflow = '';
    delete draft.password; // never let a plaintext password outlive an abandoned or failed attempt
  }
  function content() { overlay(); return document.getElementById('npAccountContent'); }

  /* ── the two steps ───────────────────────────────────────── */
  const draft = {};

  function savedLoc() {
    try { return JSON.parse(sessionStorage.getItem('np_loc')) || {}; } catch (e) { return {}; }
  }

  /* ── Turnstile, dormant until A.TURNSTILE_SITE_KEY is set ───────────
     Site key first, then the matching worker secret: see the note on the
     property itself. Read here at render time rather than captured, so
     setting the key is a one-line edit above. With no key,
     turnstileSiteKey() returns '' and every function below is a no-op, so
     the register body is unchanged and nothing loads. */
  function turnstileSiteKey() { return A.TURNSTILE_SITE_KEY || ''; }
  let turnstileScriptPromise = null;
  function loadTurnstileScript() {
    if (turnstileScriptPromise) return turnstileScriptPromise;
    turnstileScriptPromise = new Promise((resolve) => {
      if (window.turnstile) { resolve(window.turnstile); return; }
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true; s.defer = true;
      s.onload = () => resolve(window.turnstile || null);
      s.onerror = () => resolve(null);
      document.head.appendChild(s);
    });
    return turnstileScriptPromise;
  }
  let turnstileWidgetId = null;
  let turnstileToken = '';
  let turnstileRender = 0;     /* which render the script promise belongs to */
  let turnstileBox = null;     /* the container the live widget was rendered into */
  /* Renders into #npTurnstile once the script is ready. If step2 has moved on
     (back, closed, re-rendered) by the time the script resolves, the container
     is gone and this quietly does nothing. A script that never arrives fails
     closed, so the submit button stays disabled: it says so in the container
     rather than leaving a blank space and a button that cannot be pressed.
     Step 2 can be entered, left and entered again before the script promise
     settles, and every entry calls this: only the newest call may render, so
     one container never ends up with two widgets. A widget already sitting in
     the very container about to be rendered into is removed first. One left
     in a container step 2 has since thrown away went with it, and asking
     Turnstile to remove that only prints a warning. */
  function renderTurnstile(siteKey) {
    turnstileToken = '';
    const mine = ++turnstileRender;
    refreshSubmitGate();
    loadTurnstileScript().then((ts) => {
      if (mine !== turnstileRender) return;
      const box = content().querySelector('#npTurnstile');
      if (!box) return;
      if (!ts) {
        box.innerHTML = '<p class="np-sign-error" style="display:block">' +
          'The check could not load. Reload the page to try again.</p>';
        return;
      }
      if (turnstileWidgetId != null && turnstileBox === box) {
        try { ts.remove(turnstileWidgetId); } catch (e) {}
      }
      turnstileWidgetId = null;
      turnstileBox = box;
      turnstileWidgetId = ts.render(box, {
        sitekey: siteKey,
        callback: (token) => { turnstileToken = token || ''; refreshSubmitGate(); },
        'error-callback': () => { turnstileToken = ''; refreshSubmitGate(); },
        'expired-callback': () => { turnstileToken = ''; refreshSubmitGate(); },
      });
    });
  }
  /* After a captcha_failed / captcha_unavailable reply: the token that was
     sent is spent (or never arrived), so the widget goes back to asking. */
  function resetTurnstile() {
    turnstileToken = '';
    if (window.turnstile && turnstileWidgetId != null) {
      try { window.turnstile.reset(turnstileWidgetId); } catch (e) {}
    }
    refreshSubmitGate();
  }
  /* The one place that decides whether step2's submit button may be pressed:
     a current Platform Terms version, and - only when a site key is set - a
     Turnstile token in hand. */
  function submitGateOk() {
    const key = turnstileSiteKey();
    return !!draft.terms_version_id && (!key || !!turnstileToken);
  }
  function refreshSubmitGate() {
    const btn = content().querySelector('form[data-np-step="2"] button[type="submit"]');
    if (btn) btn.disabled = !submitGateOk();
  }

  function stepDots(n) {
    return '<div class="np-steps" aria-hidden="true">' +
      [1, 2].map((i) => '<span class="np-step-dot' + (i <= n ? ' is-on' : '') + '"></span>').join('') + '</div>';
  }

  function step1() {
    content().innerHTML = stepDots(1) + `
      <h2>Introduce yourself once.</h2>
      <p class="body">Two minutes, in confidence. One of us reads every profile personally.</p>
      <form data-np-step="1">
        <div class="form-grid">
          <div class="field"><label for="qName">Your name</label><input id="qName" required value="${esc(draft.name)}" placeholder="Full name"></div>
          <div class="field"><label for="qCompany">Company and site</label><input id="qCompany" required value="${esc(draft.company)}" placeholder="Held in confidence"></div>
          <div class="field"><label for="qEmail">Email</label><input id="qEmail" type="email" required value="${esc(draft.email)}" placeholder="you@company.com"></div>
          <div class="field"><label for="qPass">Choose a password</label><input id="qPass" type="password" required minlength="8" maxlength="72" placeholder="At least 8 characters"></div>
        </div>
        <div class="modal-actions"><button class="btn btn-primary" type="submit">Continue to where you are</button></div>
      </form>`;
    content().querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      draft.name = qv('qName'); draft.company = qv('qCompany'); draft.email = qv('qEmail'); draft.password = qv('qPass');
      step2();
    });
    show();
  }

  function step2() {
    const l = savedLoc();
    const tsKey = turnstileSiteKey();
    content().innerHTML = stepDots(2) + `
      <h2>Where is this site?</h2>
      <p class="body">Every hub answers by distance first. Tell us once and never again.</p>
      <form data-np-step="2">
        <div class="form-grid">
          <div class="field"><label for="qRegion">Region</label><input id="qRegion" value="${esc(draft.region || l.region)}" placeholder="e.g. Europe"></div>
          <div class="field"><label for="qCountry">Country</label><input id="qCountry" required value="${esc(draft.country || l.country)}" placeholder="Country"></div>
          <div class="field full"><label for="qTown">Town or city</label><input id="qTown" value="${esc(draft.town || l.town)}" placeholder="Town"></div>
        </div>
        ${tsKey ? '<div id="npTurnstile" style="margin-top:16px"></div>' : ''}
        <div id="npTermsBlock" style="margin-top:16px"></div>
        <input type="text" name="company_url" value="" style="position:absolute;left:-9999px" tabindex="-1" autocomplete="off" aria-hidden="true">
        <p class="np-sign-error" style="display:none"></p>
        <div class="privacy">Seen by NexPoint only. Never shared without your say-so.</div>
        <div class="modal-actions">
          <button class="btn btn-outline" type="button" data-np-back>Go back</button>
          <button class="btn btn-primary" type="submit" disabled>Create my hub account</button>
        </div>
      </form>`;
    content().querySelector('[data-np-back]').addEventListener('click', () => step1());
    renderTermsBlock();
    if (tsKey) renderTurnstile(tsKey);
    content().querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type="submit"]');
      if (btn.disabled) return;
      if (!draft.terms_version_id) {
        const err = e.target.querySelector('.np-sign-error');
        err.style.display = 'block';
        err.textContent = 'We couldn\'t load the current Platform Terms, so we can\'t register you yet. Refresh and try again, or email hello@nexpoint.co.uk.';
        return;
      }
      draft.region = qv('qRegion'); draft.country = qv('qCountry'); draft.town = qv('qTown');
      const orig = btn.textContent; btn.disabled = true; btn.textContent = 'Creating your account…';
      const body = { name: draft.name, company: draft.company, email: draft.email, password: draft.password,
        region: draft.region, country: draft.country, town: draft.town,
        interests: [], notes: '', terms_version_id: draft.terms_version_id,
        company_url: e.target.querySelector('[name="company_url"]').value };
      /* Where the confirmation link should bring them back to (see
         openQuestionnaire): the worker validates it and appends it to the
         link. */
      if (draft.return_to) body.return_to = draft.return_to;
      /* Only present when a site key is set and the widget has actually
         handed back a token: with no key the body is exactly what it was
         before Turnstile existed. */
      if (turnstileToken) body.turnstile_token = turnstileToken;
      const d = await postJson('/auth/register', body);
      if (d.ok) {
        /* No cookie comes back: there is no account until the link in the
           email is clicked, so nothing here signs anyone in. */
        const email = draft.email;
        delete draft.password;
        confirmSentCard(email);
      } else {
        btn.textContent = orig;
        const err = e.target.querySelector('.np-sign-error');
        err.style.display = 'block';
        if (d.error === 'captcha_failed' || d.error === 'captcha_unavailable') {
          err.textContent = d.error === 'captcha_failed'
            ? 'Please complete the check and try again.'
            : 'The check is unavailable right now. Try again in a minute.';
          resetTurnstile(); // clears the token and re-disables submit until a fresh one arrives
        } else {
          btn.disabled = false;
          err.textContent = d.error === 'account_exists'
            ? 'There\'s already an account for that email. Close this and choose Sign in instead.'
            : d.error === 'network'
            ? 'That did not save. Check your connection and try again, or email hello@nexpoint.co.uk.'
            : 'That did not save. Check the details and try again, or email hello@nexpoint.co.uk.';
        }
      }
    });
  }

  /* Renders the Platform Terms tick inside step2's form, keeping the submit button
     disabled until a current terms_version_id is confirmed - registration is refused
     server-side without one, so the client says so honestly rather than letting the
     click fail silently. */
  function renderTermsBlock() {
    const apply = (d) => {
      const box = content().querySelector('#npTermsBlock');
      if (!box) return; // the questionnaire moved on (back / closed) before this resolved
      if (!d || d.error || !d.id) {
        draft.terms_version_id = null;
        box.innerHTML = '<p class="np-sign-error" style="display:block">We couldn\'t load the current Platform Terms, so we can\'t register you yet. Refresh and try again, or email hello@nexpoint.co.uk.</p>';
        refreshSubmitGate();
        return;
      }
      draft.terms_version_id = d.id;
      box.innerHTML = '<label class="np-terms-tick"><input type="checkbox" id="qTerms" required> I accept the ' +
        '<a href="https://nexpoint.co.uk/hub/terms/" target="_blank" rel="noopener">NexPoint Platform Terms</a></label>';
      refreshSubmitGate();
    };
    if (termsResult) { apply(termsResult); return; }
    const box = content().querySelector('#npTermsBlock');
    if (box) box.innerHTML = '<p class="body" style="margin:0">Loading the Platform Terms…</p>';
    (termsFetch || loadPlatformTerms()).then(apply);
  }

  function successCard(line) {
    content().innerHTML = `
      <div class="success">
        <div class="ok"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M4 12l6 6L20 6"/></svg></div>
        <h2>Received, in confidence.</h2>
        <p>${esc(line)}</p>
        <div class="modal-actions" style="justify-content:center"><button class="btn btn-outline" data-np-done>Back to the hub</button></div>
      </div>`;
    content().querySelector('[data-np-done]').addEventListener('click', hide);
  }

  /* Registration is finished by the person, not by us: there is no account
     until the link is clicked. */
  function confirmSentCard(email) {
    content().innerHTML = `
      <div class="success">
        <div class="ok"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M4 12l6 6L20 6"/></svg></div>
        <h2>Check your inbox…</h2>
        <p>We have sent a confirmation link to <strong>${esc(email)}</strong>. Open it and your account is ready. It is how we keep every introduction tied to a real inbox.</p>
        <p class="np-sign-error" style="display:none"></p>
        <div class="modal-actions" style="justify-content:center">
          <button class="btn btn-outline" type="button" data-np-resend>Resend the email</button>
          <button class="btn btn-outline" type="button" data-np-done>Back to the hub</button>
        </div>
      </div>`;
    content().querySelector('[data-np-done]').addEventListener('click', hide);
    wireResend(content().querySelector('[data-np-resend]'), email);
  }

  /* The worker answers a resend the same way whatever the email, so the button
     can only ever report that it has been sent. */
  function wireResend(btn, email) {
    if (!btn) return;
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      const orig = btn.textContent;
      btn.disabled = true; btn.textContent = 'Sending…';
      await A.resendConfirmation(email);
      btn.textContent = 'Sent, check your inbox';
    });
  }

  function qv(id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; }
  function esc(v) { return escapeText(v == null ? '' : v); }

  A.openQuestionnaire = function (opts) {
    opts = opts || {};
    /* Where to bring them back to once the link in the email is clicked:
       the page that asked (a walled page whose session lapsed), or the page
       the door was reached from (its ?return=), or nowhere in particular. */
    draft.return_to = opts.return_to || doorReturn() || null;
    loadPlatformTerms();
    step1();
  };

  /* ── the act gate ────────────────────────────────────────── */
  A.gate = function (action) {
    if (!A.user) { A.afterSignIn = () => A.gate(action); if (typeof openSignIn === 'function') openSignIn(); return; }
    const u = A.user;
    content().innerHTML = `
      ${action.brief_ref ? `<span class="ref">${esc(action.brief_ref)}</span>` : ''}
      <h2>${esc(action.heading || 'Ask us to introduce you')}</h2>
      <p class="body">${esc(action.confirmLine || 'One click, and your profile travels with the request.')}</p>
      <div class="np-confirm">
        <p><strong>${esc(u.name)}</strong> · ${esc(u.company)}<br>${esc([u.town, u.country].filter(Boolean).join(', '))} · ${esc(u.email)}</p>
      </div>
      <div class="field full"><label for="gNotes">Anything specific? (optional)</label><textarea id="gNotes" placeholder="Timing, volumes, the machine in question"></textarea></div>
      <p class="np-sign-error" style="display:none"></p>
      <div class="modal-actions"><button class="btn btn-primary" data-np-send>${esc(action.heading || 'Request the introduction')}</button></div>`;
    show();
    content().querySelector('[data-np-send]').addEventListener('click', async (e) => {
      const btn = e.target;
      if (btn.disabled) return;
      btn.disabled = true; btn.textContent = 'Sending…';
      const payload = Object.assign({}, action.payload || {});
      const extra = qv('gNotes'); if (extra) payload.notes = payload.notes ? payload.notes + '. ' + extra : extra;
      const sent = Object.assign({}, action, { payload: payload });
      const d = await A.submitRequest(sent);
      if (d.ok) {
        successCard('Chris or Will reads every request personally. Expect to hear within two working days.');
        return;
      }
      btn.disabled = false; btn.textContent = action.heading || 'Request the introduction';
      const err = content().querySelector('.np-sign-error'); err.style.display = 'block';
      err.textContent = d.error === 'network'
        ? 'That did not send. Check your connection and try again, or email hello@nexpoint.co.uk.'
        : 'That did not send. Try again, or email hello@nexpoint.co.uk.';
    });
  };

  /* For a page that runs its own submit: reach cb with a signed-in account.
     On a walled page the account is there by construction; the one way to
     land here without one is a sign-in that lapsed mid-visit, and then the
     sign-in box opens over the page and the form underneath keeps what was
     typed (one-door register, Q5). portal.js runs afterSignIn once the box
     has done its job. */
  A.afterSignIn = null;
  A.requireConfirmed = function (cb) {
    if (!A.user) { A.afterSignIn = cb; if (typeof openSignIn === 'function') openSignIn(); return; }
    cb();
  };

  window.NPAccount = A;
  A.ready = A.refresh();
})();

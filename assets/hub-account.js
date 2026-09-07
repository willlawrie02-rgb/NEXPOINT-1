/* NexPoint Global Hub - the hub account module (spec 2026-09-03).
   Served from the apex only; subdomain pages load it by absolute URL.
   Progressive enhancement: if this file fails to load, every form falls back
   to its original anonymous behaviour.

   One account per site, and an account cannot act until the email behind it
   has been clicked through. Registration no longer signs anyone in: it sends
   a confirmation link and says so. Everything that acts therefore goes past
   one of two gates - A.gate() for the desk forms, A.requireConfirmed() for a
   page that runs its own submit - so an unconfirmed account meets the same
   card wherever it tries to act, and never a bare refusal from the worker. */
(function () {
  'use strict';
  const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const API = local ? 'http://localhost:8787' : 'https://api.nexpoint.co.uk';

  /* The account page lives on the apex; a subdomain has to leave its own host
     to reach it. Same-origin pages keep a relative link. */
  const ACCOUNT_URL = /\.nexpoint\.co\.uk$/.test(location.hostname)
    ? 'https://nexpoint.co.uk/hub/account/' : '/hub/account/';

  const PENDING_KEY = 'np_pending';
  const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;

  /* The current page, without the hash: what a registration started here
     hands the worker so the confirmation link can bring the visitor back to
     it, rather than only to the account page. */
  function currentReturnTo() {
    return location.origin + location.pathname + location.search;
  }

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
     Kicked off the moment the questionnaire opens, so by the time someone reaches step 3
     it has usually already resolved - step3 awaits it rather than blocking earlier steps. */
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
    user: null,
    ready: null,
    confirmed() { return !!(A.user && A.user.email_confirmed); },
    async refresh() {
      try {
        const d = await call('/auth/me', { method: 'GET' });
        const signedIn = d.signed_in != null ? d.signed_in : !!(d.ok && d.member);
        A.user = signedIn ? normalise(d.member) : null;
      } catch (e) { A.user = null; }
      document.dispatchEvent(new CustomEvent('npaccount:change'));
      renderChip();
      return A.user;
    },
    async signIn(email, password) {
      const d = await postJson('/auth/login', { email, password });
      if (d.ok) { A.user = normalise(d.member); document.dispatchEvent(new CustomEvent('npaccount:change')); renderChip(); }
      return d;
    },
    async signOut() {
      await call('/auth/logout', { method: 'POST' }).catch(() => {});
      A.user = null;
      document.dispatchEvent(new CustomEvent('npaccount:change'));
      renderChip();
    },
    resendConfirmation(email) { return postJson('/auth/resend-confirmation', { email: email }); },
  };

  /* ── the action someone started before they had an account ──────────
     A confirmation link is opened from an email client, almost always in a
     fresh tab - and often on a different host, since the confirm page lives
     on the apex while the questionnaire can open from a subdomain. Held in
     localStorage (not sessionStorage) so it survives that new tab on the
     same origin, and stamped with a time so a very stale action is never
     resurrected. Shape: {kind, hub, payload, saved_at}. */
  const NPPending = {
    save(p) {
      try {
        localStorage.setItem(PENDING_KEY, JSON.stringify(Object.assign({}, p, { saved_at: Date.now() })));
      } catch (e) {}
    },
    load() {
      let v;
      try { v = JSON.parse(localStorage.getItem(PENDING_KEY)); } catch (e) { return null; }
      if (!v) return null;
      if (!v.saved_at || (Date.now() - v.saved_at) > PENDING_MAX_AGE_MS) { NPPending.clear(); return null; }
      return v;
    },
    clear() {
      try { localStorage.removeItem(PENDING_KEY); } catch (e) {}
    },
  };
  window.NPPending = NPPending;

  function setPending(p) { NPPending.save(p); }
  function getPending() { return NPPending.load(); }
  function clearPending() { NPPending.clear(); }
  A.setPending = setPending;
  A.pending = getPending;
  A.clearPending = clearPending;

  function pendingOf(action) {
    return { kind: 'request', hub: action.hub,
      payload: { side: action.side, brief_ref: action.brief_ref || '',
        heading: action.heading || '', payload: action.payload || {} } };
  }
  function actionOf(pending) {
    const q = (pending && pending.payload) || {};
    return { hub: pending.hub, side: q.side, brief_ref: q.brief_ref || '',
      heading: q.heading || '', payload: q.payload || {} };
  }

  /* The one place a desk request is posted. gate() uses it, and so does the
     confirm page when it finishes an action someone started before they had
     an account, so there is a single request shape to keep true. */
  A.submitRequest = function (action) {
    const u = A.user || {};
    return postJson('/requests', {
      hub: action.hub, side: action.side, brief_ref: action.brief_ref || '',
      company: u.company || '', contact_name: u.name || '', email: u.email || '', phone: '',
      location: [u.town, u.country].filter(Boolean).join(', '),
      payload: action.payload || {}, company_url: '',
    });
  };

  /* Finishes a stored action now that the account can act. Only requests are
     replayed today; the listing and pick flows store their own kinds and will
     claim them here as they land. */
  A.replayPending = async function () {
    const p = getPending();
    if (!p || p.kind !== 'request') return { error: 'no_pending' };
    const d = await A.submitRequest(actionOf(p));
    if (d && d.ok) clearPending();
    return d;
  };

  /* ── the header chip ─────────────────────────────────────────────── */
  function renderChip() {
    const slot = document.querySelector('[data-np-account-slot]');
    if (!slot) return;
    if (A.user) {
      const warn = A.confirmed() ? ''
        : '<button type="button" class="notice-warn np-chip__warn">Confirm your email</button> ';
      slot.innerHTML = '<span class="np-chip">Signed in · ' + escapeText(A.user.name || A.user.email) + ' ' +
        warn + '<a class="np-chip__link" href="' + ACCOUNT_URL + '">Your account</a> ' +
        '<button type="button" class="np-chip__out">Sign out</button></span>';
      slot.querySelector('.np-chip__out').addEventListener('click', () => A.signOut());
      const w = slot.querySelector('.np-chip__warn');
      if (w) w.addEventListener('click', () => confirmGateCard());
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

  /* ── the three steps ─────────────────────────────────────── */
  const INTEREST_OPTS = [
    ['find_print', 'Find 3D print capacity'],
    ['offer_print', 'Offer print capacity'],
    ['mill_cell', 'A milling cell of my own'],
    ['opportunities', 'The opportunities board'],
    ['education', 'Education and training'],
  ];
  const draft = {};

  function savedLoc() {
    try { return JSON.parse(sessionStorage.getItem('np_loc')) || {}; } catch (e) { return {}; }
  }

  function stepDots(n) {
    return '<div class="np-steps" aria-hidden="true">' +
      [1, 2, 3].map((i) => '<span class="np-step-dot' + (i <= n ? ' is-on' : '') + '"></span>').join('') + '</div>';
  }

  function step1(pending) {
    content().innerHTML = stepDots(1) + `
      <h2>Introduce yourself once.</h2>
      <p class="body">Two minutes, in confidence. One of us reads every profile personally.</p>
      <form data-np-step="1">
        <div class="form-grid">
          <div class="field"><label for="qName">Your name</label><input id="qName" required value="${esc(draft.name)}" placeholder="Full name"></div>
          <div class="field"><label for="qCompany">Company and site<span class="np-hint">One account per site. A company with several sites registers each site separately, with its own email.</span></label><input id="qCompany" required value="${esc(draft.company)}" placeholder="Held in confidence"></div>
          <div class="field"><label for="qEmail">Email</label><input id="qEmail" type="email" required value="${esc(draft.email)}" placeholder="you@company.com"></div>
          <div class="field"><label for="qPass">Choose a password</label><input id="qPass" type="password" required minlength="8" maxlength="72" placeholder="At least 8 characters"></div>
        </div>
        <div class="modal-actions"><button class="btn btn-primary" type="submit">Continue to where you are</button></div>
      </form>`;
    content().querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      draft.name = qv('qName'); draft.company = qv('qCompany'); draft.email = qv('qEmail'); draft.password = qv('qPass');
      step2(pending);
    });
    show();
  }

  function step2(pending) {
    const l = savedLoc();
    content().innerHTML = stepDots(2) + `
      <h2>Where is this site?</h2>
      <p class="body">Every hub answers by distance first. Tell us once and never again.</p>
      <form data-np-step="2">
        <div class="form-grid">
          <div class="field"><label for="qRegion">Region</label><input id="qRegion" value="${esc(draft.region || l.region)}" placeholder="e.g. Europe"></div>
          <div class="field"><label for="qCountry">Country</label><input id="qCountry" required value="${esc(draft.country || l.country)}" placeholder="Country"></div>
          <div class="field full"><label for="qTown">Town or city</label><input id="qTown" value="${esc(draft.town || l.town)}" placeholder="Town"></div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-outline" type="button" data-np-back>Go back</button>
          <button class="btn btn-primary" type="submit">Continue to what you're after</button>
        </div>
      </form>`;
    content().querySelector('[data-np-back]').addEventListener('click', () => step1(pending));
    content().querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      draft.region = qv('qRegion'); draft.country = qv('qCountry'); draft.town = qv('qTown');
      step3(pending);
    });
  }

  function step3(pending) {
    content().innerHTML = stepDots(3) + `
      <h2>What are you after?</h2>
      <p class="body">Tick anything that applies. It shapes what we bring to you.</p>
      <form data-np-step="3">
        <div class="np-interests">` +
      INTEREST_OPTS.map(([v, label]) =>
        `<label class="np-interest"><input type="checkbox" value="${v}"${(draft.interests || []).includes(v) ? ' checked' : ''}> ${label}</label>`).join('') + `
        </div>
        <div class="field full" style="margin-top:16px"><label for="qNotes">Volumes and systems</label><textarea id="qNotes" placeholder="Anything that helps us weigh the fit">${esc(draft.notes)}</textarea></div>
        <div id="npTermsBlock" style="margin-top:16px"></div>
        <input type="text" name="company_url" value="" style="position:absolute;left:-9999px" tabindex="-1" autocomplete="off" aria-hidden="true">
        <p class="np-sign-error" style="display:none"></p>
        <div class="privacy">Seen by NexPoint only. Never shared without your say-so.</div>
        <div class="modal-actions">
          <button class="btn btn-outline" type="button" data-np-back>Go back</button>
          <button class="btn btn-primary" type="submit" disabled>Create my hub account</button>
        </div>
      </form>`;
    content().querySelector('[data-np-back]').addEventListener('click', () => step2(pending));
    renderTermsBlock();
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
      draft.interests = Array.from(content().querySelectorAll('.np-interests input:checked')).map((i) => i.value);
      draft.notes = qv('qNotes');
      const orig = btn.textContent; btn.disabled = true; btn.textContent = 'Creating your account…';
      const body = { name: draft.name, company: draft.company, email: draft.email, password: draft.password,
        region: draft.region, country: draft.country, town: draft.town,
        interests: draft.interests, notes: draft.notes, terms_version_id: draft.terms_version_id,
        company_url: e.target.querySelector('[name="company_url"]').value };
      /* Only present when the questionnaire opened from an action (A.gate()):
         the worker validates it and appends it to the confirmation link, so
         the link can bring the visitor back to the page the pending action
         lives on. */
      if (draft.return_to) body.return_to = draft.return_to;
      const d = await postJson('/auth/register', body);
      if (d.ok) {
        /* No cookie comes back: the account exists but cannot act until the
           link in the email is clicked, so nothing here signs anyone in. What
           they were doing is held until the confirm page can finish it. */
        const email = draft.email;
        if (pending) setPending(pendingOf(pending));
        delete draft.password;
        confirmSentCard(email, !!pending);
      } else {
        btn.disabled = false; btn.textContent = orig;
        const err = e.target.querySelector('.np-sign-error');
        err.style.display = 'block';
        err.textContent = d.error === 'account_exists'
          ? 'There\'s already an account for that email. Close this and choose Sign in instead.'
          : d.error === 'network'
          ? 'That didn\'t save. Check your connection and try again, or email hello@nexpoint.co.uk.'
          : 'That didn\'t save. Check the details and try again, or email hello@nexpoint.co.uk.';
      }
    });
  }

  /* Renders the Platform Terms tick inside step3's form, keeping the submit button
     disabled until a current terms_version_id is confirmed - registration is refused
     server-side without one, so the client says so honestly rather than letting the
     click fail silently. */
  function renderTermsBlock() {
    const apply = (d) => {
      const box = content().querySelector('#npTermsBlock');
      const btn = content().querySelector('form[data-np-step="3"] button[type="submit"]');
      if (!box) return; // the questionnaire moved on (back / closed) before this resolved
      if (!d || d.error || !d.id) {
        draft.terms_version_id = null;
        box.innerHTML = '<p class="np-sign-error" style="display:block">We couldn\'t load the current Platform Terms, so we can\'t register you yet. Refresh and try again, or email hello@nexpoint.co.uk.</p>';
        if (btn) btn.disabled = true;
        return;
      }
      draft.terms_version_id = d.id;
      box.innerHTML = '<label class="np-terms-tick"><input type="checkbox" id="qTerms" required> I accept the ' +
        '<a href="https://nexpoint.co.uk/hub/terms/" target="_blank" rel="noopener">NexPoint Platform Terms</a></label>';
      if (btn) btn.disabled = false;
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
        <p>${line}</p>
        <div class="modal-actions" style="justify-content:center"><button class="btn btn-outline" data-np-done>Back to the hub</button></div>
      </div>`;
    content().querySelector('[data-np-done]').addEventListener('click', hide);
  }

  /* Registration is finished by the person, not by us: the account is real but
     asleep until the link is clicked. */
  function confirmSentCard(email, hasPending) {
    content().innerHTML = `
      <div class="success">
        <div class="ok"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M4 12l6 6L20 6"/></svg></div>
        <h2>Check your inbox…</h2>
        <p>We have sent a confirmation link to <strong>${esc(email)}</strong>. Open it and your account is ready${hasPending ? '. The link brings you back to where you were, so you can send your request from there' : ''}. It is how we keep every introduction tied to a real inbox.</p>
        <p class="np-sign-error" style="display:none"></p>
        <div class="modal-actions" style="justify-content:center">
          <button class="btn btn-outline" type="button" data-np-resend>Resend the email</button>
          <button class="btn btn-outline" type="button" data-np-done>Back to the hub</button>
        </div>
      </div>`;
    content().querySelector('[data-np-done]').addEventListener('click', hide);
    wireResend(content().querySelector('[data-np-resend]'), email);
  }

  /* Signed in, not confirmed, and trying to act. Same card wherever it happens. */
  function confirmGateCard(after) {
    const email = (A.user && A.user.email) || '';
    content().innerHTML = `
      <h2>Confirm your email first.</h2>
      <p class="body">We sent a link to <strong>${esc(email)}</strong>. Open it and you can carry straight on. It is how we keep every introduction tied to a real inbox.</p>
      <p class="np-sign-error" style="display:none"></p>
      <div class="modal-actions">
        <button class="btn btn-primary" type="button" data-np-recheck>I have confirmed, refresh</button>
        <button class="btn btn-outline" type="button" data-np-resend>Resend the email</button>
      </div>`;
    show();
    wireResend(content().querySelector('[data-np-resend]'), email);
    content().querySelector('[data-np-recheck]').addEventListener('click', async (e) => {
      const btn = e.target;
      const orig = btn.textContent;
      btn.disabled = true; btn.textContent = 'Checking…';
      await A.refresh();
      if (A.confirmed()) { if (after) after(); else hide(); return; }
      btn.disabled = false; btn.textContent = orig;
      const err = content().querySelector('.np-sign-error');
      if (err) { err.style.display = 'block'; err.textContent = 'Not confirmed yet. Open the link in the email, then try again.'; }
    });
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
    draft.return_to = opts.return_to || null;
    loadPlatformTerms();
    step1(opts.pending || null);
  };

  /* ── the act gate ────────────────────────────────────────── */
  A.gate = function (action) {
    if (!A.user) { A.openQuestionnaire({ pending: action, return_to: currentReturnTo() }); return; }
    if (!A.confirmed()) { setPending(pendingOf(action)); confirmGateCard(() => A.gate(action)); return; }
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
        clearPending();
        const pc = document.getElementById('npPendingCard');
        if (pc && pc.parentNode) pc.parentNode.remove();
        successCard('Chris or Will reads every request personally. Expect to hear within two working days.');
        return;
      }
      if (d.error === 'email_unconfirmed') {
        /* the session outlived the confirmation state we had cached */
        setPending(pendingOf(sent));
        await A.refresh();
        confirmGateCard(() => A.gate(action));
        return;
      }
      btn.disabled = false; btn.textContent = action.heading || 'Request the introduction';
      const err = content().querySelector('.np-sign-error'); err.style.display = 'block';
      err.textContent = d.error === 'network'
        ? 'That didn\'t send. Check your connection and try again, or email hello@nexpoint.co.uk.'
        : 'That didn\'t send. Try again, or email hello@nexpoint.co.uk.';
    });
  };

  /* For a page that runs its own submit: reach cb only with an account that can
     act, and put up the right card when it cannot. `pending` is what to hold
     for someone who has to go and register first. */
  A.requireConfirmed = function (cb, pending) {
    if (pending) setPending(pending);
    if (!A.user) { A.openQuestionnaire({ return_to: currentReturnTo() }); return; }
    if (!A.confirmed()) { confirmGateCard(() => A.requireConfirmed(cb)); return; }
    cb();
  };

  window.NPAccount = A;
  A.ready = A.refresh();
})();

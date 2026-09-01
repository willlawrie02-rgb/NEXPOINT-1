/* NexPoint Global Hub — member account module (spec 2026-09-01).
   Served from the apex only; subdomain pages load it by absolute URL.
   Progressive enhancement: if this file fails to load, every form
   falls back to its original anonymous behaviour. */
(function () {
  'use strict';
  const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const API = local ? 'http://localhost:8787' : 'https://api.nexpoint.co.uk';

  async function call(path, opts) {
    const r = await fetch(API + path, Object.assign({ credentials: 'include' }, opts));
    return r.json().catch(() => ({ error: 'bad response' }));
  }

  const A = {
    api: API,
    user: null,
    ready: null,
    async refresh() {
      try {
        const d = await call('/auth/me', { method: 'GET' });
        A.user = d.signed_in ? d.member : null;
      } catch (e) { A.user = null; }
      document.dispatchEvent(new CustomEvent('npaccount:change'));
      renderChip();
      return A.user;
    },
    async signIn(email, password) {
      const d = await call('/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (d.ok) { A.user = d.member; document.dispatchEvent(new CustomEvent('npaccount:change')); renderChip(); }
      return d;
    },
    async signOut() {
      await call('/auth/logout', { method: 'POST' }).catch(() => {});
      A.user = null;
      document.dispatchEvent(new CustomEvent('npaccount:change'));
      renderChip();
    },
  };

  /* The signed-in chip replaces the nav's Sign in link + account CTA. */
  function renderChip() {
    const slot = document.querySelector('[data-np-account-slot]');
    if (!slot) return;
    if (A.user) {
      slot.innerHTML = '<span class="np-chip">Signed in · ' + escapeText(A.user.name || A.user.email) +
        ' <button type="button" class="np-chip__out">Sign out</button></span>';
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
  function hide() { const ov = document.getElementById('npAccountOverlay'); if (ov) ov.classList.remove('open'); document.body.style.overflow = ''; }
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
          <div class="field"><label for="qCompany">Company</label><input id="qCompany" required value="${esc(draft.company)}" placeholder="Held in confidence"></div>
          <div class="field"><label for="qEmail">Email</label><input id="qEmail" type="email" required value="${esc(draft.email)}" placeholder="you@company.com"></div>
          <div class="field"><label for="qPass">Choose a password</label><input id="qPass" type="password" required minlength="8" placeholder="At least 8 characters"></div>
        </div>
        <p class="np-sign-error" style="display:none"></p>
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
      <h2>Where are you?</h2>
      <p class="body">Every hub answers by distance first — tell us once and never again.</p>
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
      <p class="body">Tick anything that applies — it shapes what we bring to you.</p>
      <form data-np-step="3">
        <div class="np-interests">` +
      INTEREST_OPTS.map(([v, label]) =>
        `<label class="np-interest"><input type="checkbox" value="${v}"${(draft.interests || []).includes(v) ? ' checked' : ''}> ${label}</label>`).join('') + `
        </div>
        <div class="field full" style="margin-top:16px"><label for="qNotes">Volumes and systems</label><textarea id="qNotes" placeholder="Anything that helps us weigh the fit">${esc(draft.notes)}</textarea></div>
        <input type="text" name="company_url" value="" style="position:absolute;left:-9999px" tabindex="-1" autocomplete="off" aria-hidden="true">
        <p class="np-sign-error" style="display:none"></p>
        <div class="privacy">Seen by NexPoint only. Never shared without your say-so.</div>
        <div class="modal-actions">
          <button class="btn btn-outline" type="button" data-np-back>Go back</button>
          <button class="btn btn-primary" type="submit">Create my hub account</button>
        </div>
      </form>`;
    content().querySelector('[data-np-back]').addEventListener('click', () => step2(pending));
    content().querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      draft.interests = Array.from(content().querySelectorAll('.np-interests input:checked')).map((i) => i.value);
      draft.notes = qv('qNotes');
      const btn = e.target.querySelector('button[type="submit"]');
      const orig = btn.textContent; btn.disabled = true; btn.textContent = 'Creating your account…';
      const body = { name: draft.name, company: draft.company, email: draft.email, password: draft.password,
        region: draft.region, country: draft.country, town: draft.town,
        interests: draft.interests, notes: draft.notes,
        company_url: e.target.querySelector('[name="company_url"]').value };
      if (pending) body.pending_request = { hub: pending.hub, side: pending.side,
        brief_ref: pending.brief_ref || '', payload: pending.payload || {} };
      const d = await call('/auth/register', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (d.ok) {
        A.user = d.member; document.dispatchEvent(new CustomEvent('npaccount:change')); renderChip();
        delete draft.password;
        successCard(pending
          ? 'Your account is live and your request is with us. Chris or Will reads every request personally — expect to hear within two working days.'
          : 'Your account is live across every hub. Anything you ask for now arrives with your profile attached.');
      } else {
        btn.disabled = false; btn.textContent = orig;
        const err = e.target.querySelector('.np-sign-error');
        err.style.display = 'block';
        err.textContent = d.error === 'account_exists'
          ? 'There\'s already an account for that email — close this and choose Sign in instead.'
          : 'That didn\'t save. Check the details and try again, or email hello@nexpoint.co.uk.';
      }
    });
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

  function qv(id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; }
  function esc(v) { return escapeText(v == null ? '' : v); }

  A.openQuestionnaire = function (opts) { step1((opts || {}).pending || null); };

  /* ── the act gate ────────────────────────────────────────── */
  A.gate = function (action) {
    if (!A.user) { A.openQuestionnaire({ pending: action }); return; }
    const u = A.user;
    content().innerHTML = `
      ${action.brief_ref ? `<span class="ref">${esc(action.brief_ref)}</span>` : ''}
      <h2>${esc(action.heading || 'Ask us to introduce you')}</h2>
      <p class="body">${esc(action.confirmLine || 'One click — your profile travels with the request.')}</p>
      <div class="np-confirm">
        <p><strong>${esc(u.name)}</strong> · ${esc(u.company)}<br>${esc([u.town, u.country].filter(Boolean).join(', '))} · ${esc(u.email)}</p>
      </div>
      <div class="field full"><label for="gNotes">Anything specific? (optional)</label><textarea id="gNotes" placeholder="Timing, volumes, the machine in question"></textarea></div>
      <p class="np-sign-error" style="display:none"></p>
      <div class="modal-actions"><button class="btn btn-primary" data-np-send>${esc(action.heading || 'Request the introduction')}</button></div>`;
    show();
    content().querySelector('[data-np-send]').addEventListener('click', async (e) => {
      const btn = e.target; btn.disabled = true; btn.textContent = 'Sending…';
      const payload = Object.assign({}, action.payload || {});
      const extra = qv('gNotes'); if (extra) payload.notes = payload.notes ? payload.notes + ' — ' + extra : extra;
      const d = await call('/requests', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hub: action.hub, side: action.side, brief_ref: action.brief_ref || '',
          company: u.company, contact_name: u.name, email: u.email, phone: '',
          location: [u.town, u.country].filter(Boolean).join(', '), payload, company_url: '' }) });
      if (d.ok) successCard('Chris or Will reads every request personally — expect to hear within two working days.');
      else { btn.disabled = false; btn.textContent = action.heading || 'Request the introduction';
        const err = content().querySelector('.np-sign-error'); err.style.display = 'block';
        err.textContent = 'That didn\'t send. Try again, or email hello@nexpoint.co.uk.'; }
    });
  };

  window.NPAccount = A;
  A.ready = A.refresh();
})();

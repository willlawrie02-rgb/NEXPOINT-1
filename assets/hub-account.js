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
    // Implemented in the questionnaire build (Task 6):
    openQuestionnaire(opts) { console.warn('questionnaire not loaded', opts); },
    gate(action) { console.warn('gate not loaded', action); },
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

  window.NPAccount = A;
  A.ready = A.refresh();
})();

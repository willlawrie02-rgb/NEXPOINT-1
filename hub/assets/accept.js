/* NexPoint Global Hub - the provider's answer page (spec 2026-09-03).

   One link, in one email: /hub/accept.html?intro=&token=&answer=. There is
   no sign-in here on purpose. The owner of a site is reading its email, not
   necessarily signed in, and making it find a password first is how an
   introduction quietly expires. The signed token is the whole of the gate,
   and this page never computes one: it forwards the two values the link
   carried and lets the worker say yes or no.

   Nothing here calls a session route, and nothing here knows who the seeker
   is. The preview carries the ask, the seeker's town and country, and not
   one field that names anybody; keeping this page off /account and
   /listings is what makes that structural rather than careful.

   Two calls do the work: GET /introductions/preview to render, POST
   /introductions/respond to answer. Every refusal has somewhere to land -
   a terminal card for the ones that end the page, an inline line for the
   ones worth another try - and once an answer is recorded the buttons are
   gone, so a second click is not a thing that can happen.

   Started by portal.js's np:modules boot, like every other page module. */
(function () {
  'use strict';

  const HELLO = 'hello@nexpoint.co.uk';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* Our own sentences, and only ours, become markup here: the text is
     escaped first and the address put back as a link afterwards, so the
     one thing that can turn into an anchor is a constant in this file. */
  function withMailto(text) {
    return esc(text).split(HELLO).join('<a href="mailto:' + HELLO + '">' + HELLO + '</a>');
  }

  function api(path, opts) { return NP.api(path, opts); }
  function postJson(path, body) {
    return api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body) });
  }

  function el(id) { return document.getElementById(id); }
  function bodyEl() { return el('accBody'); }

  /* The link, exactly as the email wrote it. `answer` is which button was
     pressed there: accept lands on the tick, decline opens the box, and
     neither answers anything on its own. */
  const params = new URLSearchParams(location.search);
  const introId = (params.get('intro') || '').trim();
  const token = (params.get('token') || '').trim();
  const wanted = (params.get('answer') || '').trim();

  let preview = null, terms = null, vocab = null, sending = false;

  /* ── words ─────────────────────────────────────────────────────────── */

  function hubLabel(hub) {
    return hub === 'mill' ? 'Mill Hub' : hub === 'print' ? 'Print Hub' : '';
  }
  function siteNoun() { return (preview && preview.hub === 'mill') ? 'cell' : 'site'; }

  /* "Thursday 10 September". The window closes at an instant; the day that
     instant falls on belongs to whoever is reading, so this is local. */
  function fmtAnswerBy(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    try { return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }); }
    catch (e) { return String(iso); }
  }

  /* A needed-by date is a plain day, not an instant. Parsed as one: given
     to the Date constructor whole it would be read as UTC midnight and
     shown as the day before to anyone west of us. */
  function fmtDay(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value == null ? '' : value));
    if (!m) return value ? String(value) : '';
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (isNaN(d.getTime())) return String(value);
    try { return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); }
    catch (e) { return String(value); }
  }

  function labelOf(list, term) {
    if (!term) return '';
    if (window.NPVocab && NPVocab.label) return NPVocab.label(list, term);
    return String(term);
  }

  /* ── the end states ────────────────────────────────────────────────────
     Where the page stops. Each one is a card and a line saying who to
     write to, because a provider who has just been told "no" by a web page
     needs a person, not a refresh button. */
  /* Null-prototype, both of these: what is looked up in them is a worker
     error string or a key derived from one, and "constructor" off a plain
     object literal is a function, not a miss. */
  const ENDS = Object.assign(Object.create(null), {
    accepted: (ref) => ({
      heading: 'Accepted',
      lines: [ref
        ? 'Recorded. The seeker\'s details are on their way to you by email with the reference ' +
          ref + '; they have yours.'
        : 'Recorded. The seeker\'s details are on their way to you by email; they have yours.'],
      fallback: 'If nothing reaches you, email ' + HELLO + ' and we will send it again.',
    }),
    declined: () => ({
      heading: 'Declined',
      lines: ['Thank you, we will tell the seeker and keep looking.'],
      fallback: 'If you declined this by mistake, email ' + HELLO + ' and we will put it right.',
    }),
    expired: () => ({
      heading: 'This one has closed',
      lines: ['The window to answer has passed, so the introduction is closed. Nothing about you was shared.'],
      fallback: 'If you would still like this one, email ' + HELLO + ' and we will open it again.',
    }),
    answered: () => ({
      heading: 'Already answered',
      lines: ['This introduction has already been answered, so there is nothing left to do here.'],
      fallback: 'If that was not you, email ' + HELLO + ' and we will look into it.',
    }),
    notReady: () => ({
      heading: 'Not ready yet',
      lines: ['This introduction has not been put to you yet, so there is nothing to answer.'],
      fallback: 'Email ' + HELLO + ' with what you were sent and we will look into it.',
    }),
    invalid: () => ({
      heading: 'We could not open this link',
      lines: ['It may be incomplete or out of date, or we could not reach the hub just then.'],
      fallback: 'Open the most recent link in your email, or email ' + HELLO +
        ' and we will send you a fresh one.',
    }),
  });

  /* The worker's own words, mapped to those cards. Everything a refusal can
     say that ends the page is here; anything else is worth another try and
     is shown next to the buttons instead. A network drop is deliberately
     NOT in this table: on the preview it falls to the invalid-link card
     below, but on an answer it is a retry, not a dead link. */
  const TERMINAL = Object.assign(Object.create(null), {
    'invalid token': 'invalid',
    'introduction not found': 'invalid',
    'introduction_id required': 'invalid',
    'token required': 'invalid',
    'not configured': 'invalid',
    'this introduction is not yet approved': 'notReady',
    'this introduction is no longer open': 'answered',
    'this introduction has already been answered': 'answered',
    'already answered': 'answered',
    'this introduction has no acceptance window': 'invalid',
    'the acceptance window has expired': 'expired',
  });

  function end(key, ref) {
    const card = (ENDS[key] || ENDS.invalid)(ref);
    bodyEl().innerHTML =
      '<h2>' + esc(card.heading) + '</h2>' +
      card.lines.map((l) => '<p class="acc-line">' + esc(l) + '</p>').join('') +
      '<p class="acc-fallback">' + withMailto(card.fallback) + '</p>';
  }

  /* The same gate the worker runs before it writes, run here on what the
     preview said, so a row nobody can answer any more is a card rather
     than an Accept button that is going to be refused. */
  function blockedBy(p) {
    if (p.stage === 'proposed') return 'notReady';
    if (p.stage === 'expired') return 'expired';
    if (p.stage === 'declined' || p.stage === 'dead') return 'answered';
    if (p.stage !== 'awaiting_acceptance') return 'answered';
    if (!p.acceptance_expires_at) return 'invalid';
    if (new Date() > new Date(p.acceptance_expires_at)) return 'expired';
    return null;
  }

  /* ── the ask ───────────────────────────────────────────────────────────
     The seeker's request in the shortlist card's own markup, because it is
     the same kind of object: a specification with nobody's name on it. The
     row labels are the ones the offer email uses, so the page and the
     email that led here read as one thing. */
  function askCardHtml(r) {
    if (!r) {
      return '<p class="acc-line">' + withMailto('We could not load what they are asking for. ' +
        'Email ' + HELLO + ' before you answer and we will send it to you.') + '</p>';
    }
    const rows = [];
    const material = labelOf(vocab && vocab.materials, r.material);
    if (material) rows.push(['Material', material]);
    const process = labelOf(vocab && vocab.processes, r.process);
    if (process) rows.push(['Process', process]);
    if (r.quantity != null && r.quantity !== '') {
      rows.push(['Quantity', r.quantity + (Number(r.quantity) === 1 ? ' unit' : ' units')]);
    }
    if (r.cadence) {
      rows.push(['Cadence', r.cadence === 'recurring' ? 'Recurring'
        : r.cadence === 'one_off' ? 'One off' : String(r.cadence)]);
    }
    if (r.max_lead_time_days != null) {
      rows.push(['Lead time', 'within ' + r.max_lead_time_days +
        (Number(r.max_lead_time_days) === 1 ? ' day' : ' days')]);
    }
    if (r.needed_by) rows.push(['Needed by', fmtDay(r.needed_by)]);
    const services = (r.services || []).map((s) => labelOf(vocab && vocab.services, s)).filter(Boolean);
    if (services.length) rows.push(['Services', services.join(', ')]);

    const where = [r.town, r.country].filter(Boolean).join(', ');
    return '<div class="cap acc-card">' +
      '<span class="cap__head"><b class="cap__num">What they need</b></span>' +
      (where ? '<h3>' + esc(where) + '</h3>' : '') +
      '<dl>' + rows.map((row) =>
        '<div><dt>' + esc(row[0]) + '</dt><dd>' + esc(row[1]) + '</dd></div>').join('') + '</dl>' +
      (r.notes ? '<p class="acc-note"><b>Notes</b>' + esc(r.notes) + '</p>' : '') +
      '</div>';
  }

  /* ── the offer ─────────────────────────────────────────────────────── */

  function renderOffer() {
    const p = preview;
    const answerBy = fmtAnswerBy(p.acceptance_expires_at);
    const meta = [hubLabel(p.hub), p.ref, answerBy ? 'answer by ' + answerBy : '']
      .filter(Boolean).join(' · ');

    bodyEl().innerHTML =
      '<h2>An introduction is waiting for you</h2>' +
      '<p class="acc-meta">' + esc(meta) + '</p>' +
      '<p class="acc-line">' + esc('A seeker on the ' + (hubLabel(p.hub) || 'hub') +
        ' needs capacity that matches your listing. Nothing about you has reached them, ' +
        'and nothing will unless you accept.') + '</p>' +
      askCardHtml(p.request) +
      '<p class="acc-line">' + esc('Accept and contact details are exchanged: yours go to the ' +
        'seeker, theirs come to you, both by email. Decline and the seeker is told a ' +
        siteNoun() + ' said no, and nothing else.') + '</p>' +
      '<div id="accTerms"></div>' +
      '<p class="np-sign-error" id="accErr" style="display:none"></p>' +
      '<div class="modal-actions">' +
        '<button class="btn btn-primary" type="button" id="acceptBtn">Accept the introduction</button>' +
        '<button class="btn btn-outline" type="button" id="declineBtn" ' +
          'aria-expanded="false" aria-controls="declineBox">Decline</button>' +
      '</div>' +
      '<div class="acc-decline" id="declineBox" hidden>' +
        '<div class="field full">' +
          '<label for="declineReason">Why not, if you want to say (optional)</label>' +
          '<textarea id="declineReason" rows="3" ' +
            'placeholder="Too far out, wrong material, no capacity that month"></textarea>' +
        '</div>' +
        '<p class="acc-hint">' + esc('This goes to the NexPoint desk, not to the seeker. ' +
          'They are told a ' + siteNoun() + ' said no, and nothing else.') + '</p>' +
        '<div class="modal-actions">' +
          '<button class="btn btn-primary" type="button" id="declineSubmit">Send my decline</button>' +
        '</div>' +
      '</div>';

    renderTerms();
    el('acceptBtn').addEventListener('click', onAccept);
    el('declineBtn').addEventListener('click', openDecline);
    el('declineSubmit').addEventListener('click', onDecline);
  }

  /* Layer 3 of the three terms layers: what a provider accepts each time it
     takes an introduction. Read fresh, because the id ticked here is the id
     the worker checks against the current one. */
  function renderTerms() {
    const box = el('accTerms');
    if (!box) return;
    if (!terms) {
      box.innerHTML = '<p class="np-sign-error" style="display:block">' +
        withMailto('We could not load the introduction terms, so there is nothing to accept ' +
          'yet. Refresh and try again, or email ' + HELLO + '.') + '</p>';
      return;
    }
    box.innerHTML =
      '<div class="terms-scroll">' + NP.markdownLite(terms.body_md) + '</div>' +
      '<label class="np-terms-tick"><input type="checkbox" id="acceptTick"> ' +
      esc('I accept the introduction terms, version ' + terms.version) + '</label>';
  }

  function showErr(message, focusEl) {
    const err = el('accErr');
    if (err) { err.style.display = 'block'; err.innerHTML = withMailto(message); }
    if (focusEl) {
      if (focusEl.scrollIntoView) focusEl.scrollIntoView({ block: 'center' });
      if (typeof focusEl.focus === 'function') focusEl.focus();
    }
  }
  function clearErr() {
    const err = el('accErr');
    if (err) { err.style.display = 'none'; err.textContent = ''; }
  }

  function openDecline() {
    const box = el('declineBox');
    if (!box) return;
    box.hidden = false;
    const btn = el('declineBtn');
    if (btn) btn.setAttribute('aria-expanded', 'true');
    const reason = el('declineReason');
    if (reason) {
      if (reason.scrollIntoView) reason.scrollIntoView({ block: 'center' });
      if (typeof reason.focus === 'function') reason.focus();
    }
  }

  function onAccept() {
    if (sending) return;
    clearErr();
    if (!terms || !terms.id) {
      showErr('We could not load the introduction terms, so we cannot record an acceptance yet. ' +
        'Refresh and try again, or email ' + HELLO + '.');
      return;
    }
    const tick = el('acceptTick');
    if (!tick || !tick.checked) {
      showErr('Read the introduction terms and tick to accept them.', tick);
      return;
    }
    send('accept', { terms_version_id: terms.id });
  }

  function onDecline() {
    if (sending) return;
    clearErr();
    const reason = el('declineReason');
    const text = reason ? reason.value.trim() : '';
    send('decline', text ? { reason: text } : {});
  }

  /* The answer. Both buttons go dead for the duration, and a success
     replaces the whole panel with its end state, so there is no second
     click to make and nothing left to click it with. */
  async function send(action, extra) {
    sending = true;
    const buttons = ['acceptBtn', 'declineBtn', 'declineSubmit']
      .map((id) => el(id)).filter(Boolean);
    const labels = buttons.map((b) => b.textContent);
    buttons.forEach((b) => { b.disabled = true; });
    const live = el(action === 'accept' ? 'acceptBtn' : 'declineSubmit');
    if (live) live.textContent = 'Sending…';

    const d = await postJson('/introductions/respond', Object.assign({
      introduction_id: introId, token: token, action: action }, extra || {}));

    sending = false;
    if (d && d.ok) {
      end(action === 'accept' ? 'accepted' : 'declined', d.ref || (preview && preview.ref));
      return;
    }

    const terminal = TERMINAL[d && d.error];
    if (terminal) { end(terminal); return; }

    buttons.forEach((b, i) => { b.disabled = false; b.textContent = labels[i]; });
    if (d && d.error === 'invalid terms_version_id') { termsMoved(); return; }
    showErr(inlineError(d));
  }

  /* The terms rolled over between the email going out and this click. The
     tick that was given was for a version that is no longer current, so it
     cannot stand: the new text goes up, unticked, and we ask again. */
  async function termsMoved() {
    const d = await api('/terms/current?layer=introduction');
    terms = (d && !d.error && d.id) ? d : null;
    renderTerms();
    /* The refetch failed too, so there is no new text to read and no tick to
       give it. renderTerms has already said so; telling them to read it
       again and tick would contradict the line right above. */
    if (!terms) return;
    showErr('The introduction terms have been updated. Read them again and tick to accept them.',
      el('acceptTick'));
  }

  function inlineError(d) {
    const e = d && d.error;
    if (e === 'terms_version_id required') {
      return 'Read the introduction terms and tick to accept them.';
    }
    if (e === 'bad json' || e === 'action must be accept or decline') {
      return 'That did not send. Refresh the page and try again, or email ' + HELLO + '.';
    }
    return 'That did not send. Check your connection and try again, or email ' + HELLO + '.';
  }

  /* ── the landing ───────────────────────────────────────────────────────
     Which button was pressed in the email decides where the page opens.
     Neither answers anything: the tick still has to be ticked and the
     decline still has to be sent. */
  function landing() {
    if (wanted === 'decline') { openDecline(); return; }
    if (wanted !== 'accept') return;
    const tick = el('acceptTick');
    const target = tick || el('acceptBtn');
    if (target && target.scrollIntoView) target.scrollIntoView({ block: 'center' });
    if (tick && typeof tick.focus === 'function') tick.focus();
  }

  /* Labels, not stored terms: `pa12_nylon12` is a database value, not an
     answer to "what do they need". The vocabulary is public and seeded in
     the module, so this cannot fail into an empty card. */
  async function loadVocab(hub) {
    if (!window.NPVocab || !NPVocab.load) return null;
    try { return await NPVocab.load(hub === 'mill' ? 'mill' : 'print'); }
    catch (e) { return null; }
  }

  async function load() {
    if (!bodyEl()) return;
    if (!introId || !token) { end('invalid'); return; }
    bodyEl().innerHTML = '<div class="acc-loading">Loading the introduction…</div>';

    const [p, t] = await Promise.all([
      api('/introductions/preview?introduction_id=' + encodeURIComponent(introId) +
        '&token=' + encodeURIComponent(token)),
      api('/terms/current?layer=introduction'),
    ]);

    if (!p || !p.ok) { end(TERMINAL[p && p.error] || 'invalid'); return; }
    const blocked = blockedBy(p);
    if (blocked) { end(blocked); return; }

    preview = p;
    terms = (t && !t.error && t.id) ? t : null;
    vocab = await loadVocab(p.hub);
    renderOffer();
    landing();
  }

  window.NPAccept = { init: load };
})();

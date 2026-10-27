/* The three pipelines' shared parts (plan 073): what the Pipelines page
   (pipelines.html) and the company page's steppers (company.html) both draw.

   Loaded after crm-shell.js and crm.js as <script src="pipelines.js?v=073">:
   shared admin files are cached in browsers for up to four hours, so bump
   ?v= on every change (and on every page that links it).

   One global, NXPIPE. It reads and writes nothing. Its rules mirror the
   engine's src/nexpoint_engine/pipelines.py, and tests/test_pipeline_pages.py
   holds the two equal: the stages, what a person may move (handMove, the
   engine's hand_move_allowed, with the same refusal sentence), where an
   introduction sits on the Introductions board (introStage, the engine's
   intro_board_stage) and when a card is stale (isStale, the engine's
   is_stale and the inbox view's stale member). */
(function () {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ms = (name, cls) => '<span class="ms' + (cls ? ' ' + cls : '') + '" aria-hidden="true">' + esc(name) + '</span>';

  const STAGES = {
    hub: ['lead', 'contacted', 'conversation', 'agreed', 'account', 'applied', 'invoiced', 'paid'],
    consultancy: ['lead', 'contacted', 'conversation', 'agreed', 'invoiced', 'paid'],
  };
  const NAMES = {
    hub: { lead: 'Lead', contacted: 'Contacted', conversation: 'In conversation', agreed: 'Agreed',
      account: 'Account created', applied: 'Applied', invoiced: 'Invoiced', paid: 'Paid + live' },
    consultancy: { lead: 'Lead', contacted: 'Contacted', conversation: 'In conversation', agreed: 'Agreed',
      invoiced: 'Invoiced', paid: 'Paid' },
  };
  const HAND = { hub: ['conversation', 'agreed'], consultancy: ['conversation'] };
  const EVIDENCE = {
    hub: { lead: 'an accepted prospect or a fit', contacted: 'the first email',
      account: 'the portal invite or a matching sign-up', applied: 'the listing', invoiced: 'Xero', paid: 'Xero' },
    consultancy: { lead: 'an accepted prospect or a fit', contacted: 'the first email', agreed: 'the signing link',
      invoiced: 'Xero', paid: 'Xero' },
  };
  const BOARD_NAME = { hub: 'Hub Providers', consultancy: 'Consultancy' };
  const DEAD_REASONS = ['Not interested', 'No capacity', 'Went quiet', 'Chose a competitor', 'Not a fit', 'Other'];
  /* Each column's line: what moves a card into it. */
  const WHEN = {
    hub: { lead: 'An accepted prospect or a 3D Print Hub or Mill Hub fit tag', contacted: 'Outlook: we send the first email',
      conversation: 'By hand: a real conversation is under way', agreed: 'By hand: they agree to list',
      account: 'Portal: the invited account is confirmed, or a sign-up matches',
      applied: 'Portal: they submit their first listing', invoiced: 'Xero: we approve, it goes live and the invoice is raised',
      paid: 'Paid hosts move to Live Listings' },
    consultancy: { lead: 'A Consultancy fit tag', contacted: 'Outlook: we send the first email',
      conversation: 'By hand: a real conversation is under way', agreed: 'Signing link: we make the link for them',
      invoiced: 'Xero: they sign, and the invoice is raised', paid: 'Paid cards move to Active clients' },
  };
  /* The stepper's one line on what moves the card. */
  const AUTO_NOTE = {
    hub: 'Moves on its own from the evidence: the first email, the portal and Xero. In conversation and Agreed move by hand, and any card can be moved back by hand.',
    consultancy: 'Moves on its own from the first email, the signing link and Xero. In conversation moves by hand, and any card can be moved back by hand.',
  };
  const AUTO = { hub: { lead: 1, contacted: 1, account: 1, applied: 1, invoiced: 1, paid: 1 },
    consultancy: { lead: 1, contacted: 1, agreed: 1, invoiced: 1, paid: 1 } };

  /* The Introductions board (D2): the introductions themselves, placed by stage. */
  const INTRO_STAGE={ proposed: 'offered', awaiting_acceptance: 'offered', approved: 'offered',
    introduced: 'introduced', in_discussion: 'introduced', deal_done: 'trading', invoiced: 'trading', paid: 'trading',
    declined: 'closed', expired: 'closed', dead: 'closed' };
  const INTRO_NAMES = { offered: 'Offered', introduced: 'Introduced', trading: 'Trading', closed: 'Closed' };
  function introStage(i, declared) {
    const s = INTRO_STAGE[(i || {}).stage] || 'closed';
    return s === 'introduced' && (declared || i.first_order_at) ? 'trading' : s;
  }

  /* D4: null when a person may make the move, else the sentence that says why not. */
  function handMove(board, from, to) {
    const stages = STAGES[board] || [];
    if (!stages.includes(to) || !stages.includes(from))
      return `That is not a stage on ${BOARD_NAME[board] || 'this board'}; reload the page and try again.`;
    if (to === from) return `The card is already at ${NAMES[board][to]}.`;
    if (stages.indexOf(to) < stages.indexOf(from) || HAND[board].includes(to)) return null;
    return `${NAMES[board][to]} moves on its own from ${EVIDENCE[board][to]}. Only a move back is made by hand.`;
  }

  const DAY = 864e5;
  const ts = (v) => { const t = Date.parse(v); return isNaN(t) ? null : t; };
  /* D11: open, not at Lead, not at Invoiced on a running payment clock, and
     the stage and the company's last email both 14 or more days old. */
  function isStale(card, lastEmailAt, now, clockRunning) {
    if (!card || card.dead_at || card.won_at || card.stage === 'lead') return false;
    if (card.board === 'hub' && card.stage === 'invoiced' && clockRunning !== false) return false;
    const cutoff = (now == null ? Date.now() : now) - 14 * DAY;
    const entered = ts(card.stage_entered_at), last = lastEmailAt ? ts(lastEmailAt) : null;
    return entered != null && entered <= cutoff && (last == null || last <= cutoff);
  }
  /* How long it has been quiet: since the later of the move and the last email. */
  function quietDays(card, lastEmailAt, now) {
    const t = Math.max(ts(card.stage_entered_at) || 0, lastEmailAt ? ts(lastEmailAt) || 0 : 0);
    return Math.max(0, Math.floor(((now == null ? Date.now() : now) - t) / DAY));
  }
  const daysSince = (v, now) => { const t = ts(v); return t == null ? null : Math.max(0, Math.floor(((now == null ? Date.now() : now) - t) / DAY)); };
  const plural = (n, a, b) => `${n} ${n === 1 ? a : (b || a + 's')}`;
  function inStage(card, now) {
    const n = daysSince(card.stage_entered_at, now);
    return n == null ? '' : n === 0 ? 'Moved in today' : plural(n, 'day') + ' in stage';
  }
  function mailText(lastEmailAt, now) {
    const n = daysSince(lastEmailAt, now);
    return n == null ? 'No email yet' : n === 0 ? 'Email today' : `Last email ${plural(n, 'day')} ago`;
  }

  function ladder(n, upto) {
    let b = '';
    for (let j = 0; j < n; j++) b += '<i' + (j <= upto ? ' class="on"' : '') + '></i>';
    return '<span class="ladder" style="--n:' + n + '" aria-hidden="true">' + b + '</span>';
  }
  function stageClass(board, i, n) { return i === n - 1 ? 's-agreed' : i === 0 ? 's-known' : i === 1 ? 's-tocontact' : 's-talking'; }
  function stagePill(board, stage, prefix, cls) {
    const stg = STAGES[board], i = stg.indexOf(stage);
    if (i < 0) return '';
    return '<span class="stage ' + (cls || stageClass(board, i, stg.length)) + '" title="' + esc(BOARD_NAME[board] + ': ' + NAMES[board][stage]) + '">' +
      ladder(stg.length, i) + (prefix ? esc(prefix) + ' ' : '') + esc(NAMES[board][stage]) + '</span>';
  }
  const HUB_TAG = { print: ['view_in_ar', '3D print'], mill: ['precision_manufacturing', 'Mill'] };
  function hubTags(card) {
    return (card.hubs || []).filter((h) => HUB_TAG[h]).map((h) => '<span class="tag">' + ms(HUB_TAG[h][0]) + esc(HUB_TAG[h][1]) + '</span>').join('') +
      (card.self_signup ? '<span class="tag">' + ms('how_to_reg') + 'Self sign-up</span>' : '');
  }
  const KIND_WORD = { search: 'Search', acquisition_jv: 'Acquisition / JV' };

  /* A signing link's state in one line (D16): made, opened, signed, invoiced, paid. */
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dm = (v) => { const t = ts(v); if (t == null) return ''; const d = new Date(t); return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()]; };
  function signLine(link) {
    if (!link) return '';
    if (link.revoked_at) return `Signing link withdrawn ${dm(link.revoked_at)}`;
    if (link.paid_at) return `Signed ${dm(link.signed_at)}, paid ${dm(link.paid_at)}`;
    if (link.invoiced_at) return `Signed ${dm(link.signed_at)}, invoiced ${dm(link.invoiced_at)}, not paid`;
    if (link.signed_at) return `Signed ${dm(link.signed_at)}`;
    return `Signing link made ${dm(link.created_at)}` + (link.opened_at ? `, opened ${dm(link.opened_at)}, not signed` : ', not opened');
  }

  /* Mark as dead, in place: the six reasons, a note, the action and Cancel. */
  function deadPicker(card, chosen) {
    return '<div class="picker" data-dead-for="' + esc(card.id) + '"><span class="tg-label">Why is it dead? Pick one</span><div class="picker-opts">' +
      DEAD_REASONS.map((r) => '<button type="button" class="opt" data-act="pickReason" data-reason="' + esc(r) + '" aria-pressed="' + (chosen === r) + '">' + esc(r) + '</button>').join('') +
      '</div><label class="sr" for="dd-note">Note</label><input class="input" id="dd-note" placeholder="Add a note, if it helps">' +
      '<div class="actions"><span class="picker-note">The card remembers its stage, and Revive puts it back there.</span>' +
      '<button type="button" class="btn sm quiet" data-act="closeUi">Cancel</button>' +
      '<button type="button" class="btn sm danger" data-act="confirmDead" data-card="' + esc(card.id) + '">' + ms('block', 'sm') + 'Mark as dead</button></div></div>';
  }
  /* How a move reads in the Pipelines panel and the archive. */
  const HOW_WORD = { auto: 'on its own', hand: 'by hand', created: 'added', dead: 'marked as dead', revived: 'revived', won: 'won', ended: 'term over' };
  function moveLine(board, m, personOf) {
    const to = m.to_stage ? (NAMES[board] || {})[m.to_stage] || m.to_stage : '';
    const who = m.by && m.by !== 'pipelines' ? ', ' + (personOf ? personOf(m.by) : m.by) : '';
    const what = m.how === 'created' ? `Added at ${to}` : m.how === 'dead' ? 'Marked as dead' : m.how === 'revived' ? `Revived at ${to}`
      : m.how === 'ended' ? 'Term over: moved to Ended' : m.how === 'won' ? (board === 'hub' ? 'Paid: moved to Live Listings' : 'Paid: moved to Active clients')
        : `Moved to ${to} ${HOW_WORD[m.how] || ''}`.trim();
    return what + who + (m.evidence ? ` (${m.evidence})` : '');
  }

  window.NXPIPE = { STAGES, NAMES, HAND, EVIDENCE, BOARD_NAME, DEAD_REASONS, WHEN, AUTO_NOTE, AUTO, INTRO_STAGE, INTRO_NAMES, KIND_WORD,
    introStage, handMove, isStale, quietDays, daysSince, inStage, mailText, ladder, stagePill, hubTags, signLine, deadPicker, moveLine, dm };
})();

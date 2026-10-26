/* The admin CRM's shell (round 5, Track B): the rail, the page head, the
   panel a section shows until its plan builds it, the rail's counts and the
   toast. Built to the design Will approved on 22 October 2026 (workspace
   spec docs/superpowers/specs/2026-10-22-crm-design.md).

   Every CRM page loads this after supabase-js and admin-auth.js, keeps its
   own sign-in door and both second-factor gates (the board rules), and once
   the operator is in calls NXShell.mount(sb,user,'<section>') to draw the
   rail. The rail lists the eight sections in the register's order; the
   company page counts as Contacts. "Working as" is whoever signed in: notes,
   tasks and moves are signed with that name.

   Reads only, never a write: the counts read the inbox view (its failed-run
   cards are System's count, so the rail and the Inbox agree; plan 072) and
   the companies in Contacts. Intent reads stay on the pages, where the
   board rules can check them. */
(function () {
  'use strict';

  const SECTIONS = [
    { id: 'inbox', label: 'Inbox', icon: 'inbox', href: 'inbox.html' },
    { id: 'desk', label: 'Desk', icon: 'forum', href: 'desk.html' },
    { id: 'pipelines', label: 'Pipelines', icon: 'view_kanban', href: 'pipelines.html' },
    { id: 'contacts', label: 'Contacts', icon: 'contacts', href: 'contacts.html' },
    { id: 'listings', label: 'Live Listings', icon: 'storefront', href: 'listings.html' },
    { id: 'money', label: 'Money', icon: 'payments', href: 'money.html' },
    { id: 'marketing', label: 'Marketing', icon: 'campaign', href: 'marketing.html' },
    { id: 'system', label: 'System', icon: 'monitor_heart', href: 'system.html' },
  ];
  /* A count in the red pill means a job waits (the Inbox) or a run failed (System). */
  const HOT = { inbox: true, system: true };
  const PEOPLE = { 'willlawrie@nexpoint.co.uk': 'Will', 'chris@nexpoint.co.uk': 'Chris' };

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ms = (name, cls) => '<span class="ms' + (cls ? ' ' + cls : '') + '" aria-hidden="true">' + esc(name) + '</span>';
  const personOf = (email) => PEOPLE[String(email || '').trim().toLowerCase()] || String(email || '');
  const fmtCount = (n) => Number(n).toLocaleString('en-GB');

  function railHtml(o) {
    const active = o.current === 'company' ? 'contacts' : o.current;
    const counts = o.counts || {};
    const nav = SECTIONS.map((s) => {
      const n = Number(counts[s.id]) || 0;
      return '<a href="' + s.href + '"' + (active === s.id ? ' aria-current="page"' : '') + '>' + ms(s.icon) +
        '<span>' + esc(s.label) + '</span>' +
        (n > 0 ? '<span class="count num' + (HOT[s.id] ? ' hot' : '') + '">' + fmtCount(n) + '</span>' : '') + '</a>';
    }).join('');
    return '<a class="brand" href="inbox.html"><img src="nexpoint-mark.png" alt="" width="30" height="26">' +
      '<span class="wordmark"><span class="nex">Nex</span><span class="pt">Point</span></span></a>' +
      '<nav class="nav" aria-label="Sections">' + nav + '</nav>' +
      '<div class="rail-foot"><div class="me"><span>Working as <b>' + esc(personOf(o.email)) + '</b></span>' +
      '<span class="who sr" id="who">' + esc(o.email) + '</span></div>' +
      '<div class="nav"><button type="button" data-act="signout">' + ms('logout', 'sm') + '<span>Sign out</span></button></div></div>';
  }

  /* The title, one short line, and the page's primary action at the right.
     No eyebrow above the title. `actions` is markup the page built. */
  function headHtml(o) {
    return '<div class="head"><div class="head-text"><h1>' + esc(o.title) + '</h1>' +
      (o.lede ? '<p class="lede">' + esc(o.lede) + '</p>' : '') + '</div>' +
      (o.actions ? '<div class="actions">' + o.actions + '</div>' : '') + '</div>';
  }

  /* A section its plan has not built yet: what it will hold, and the old boards
     that do the job until then. The page passes its plan (o.plan) for whoever
     builds it; the built CRM names no plan (Will, 22 October 2026). */
  function comingHtml(o) {
    const until = (o.until || []).map(([href, label]) =>
      '<a class="btn sm" href="' + esc(href) + '">' + esc(label) + '</a>').join('');
    return '<section class="panel coming"><div class="empty-state">' + ms(o.icon || 'construction') +
      '<h3>Not built yet</h3><p>' + esc(o.what) + '</p>' +
      (until ? '<div class="until"><span>Until then</span>' + until + '</div>' : '') + '</div></section>';
  }

  /* The rail's counts. A read that fails leaves its count off, never the rail.
     System counts the inbox view's failed-run cards (item_key is 0077's, so
     the read fails before that migration); without them it reads each job's
     newest run, a run that only found the lock held clearing nothing. */
  async function readCounts(sb) {
    const [ibx, cos, fail] = await Promise.all([
      sb.from('inbox').select('kind', { count: 'exact', head: true }),
      sb.from('crm_companies').select('id', { count: 'exact', head: true }),
      sb.from('inbox').select('item_key', { count: 'exact', head: true }).eq('kind', 'failed_run'),
    ]);
    const counts = {};
    if (!ibx.error && ibx.count) counts.inbox = ibx.count;
    if (!cos.error && cos.count) counts.contacts = cos.count;
    if (!fail.error) {
      if (fail.count) counts.system = fail.count;
      return counts;
    }
    const runs = await sb.from('engine_runs').select('job,status,started_at').order('started_at', { ascending: false }).limit(300);
    if (!runs.error) {
      const latest = {};
      (runs.data || []).forEach((r) => { if (r.status !== 'skipped-because-locked' && !latest[r.job]) latest[r.job] = r; });
      const n = Object.values(latest).filter((r) => r.status === 'failed').length;
      if (n) counts.system = n;
    }
    return counts;
  }

  async function mount(sb, user, current) {
    const rail = document.getElementById('rail');
    if (!rail) return;
    const draw = (counts) => { rail.innerHTML = railHtml({ current, counts, email: user && user.email }); };
    draw({});
    rail.addEventListener('click', (e) => {
      if (!e.target.closest('[data-act="signout"]')) return;
      sb.auth.signOut().then(() => location.reload());
    });
    try { draw(await readCounts(sb)); } catch (_) { /* the rail stands without its counts */ }
  }

  let toastTimer = null;
  function toast(msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 4600);
  }

  window.NXShell = { SECTIONS, esc, ms, personOf, railHtml, headHtml, comingHtml, readCounts, mount, toast };
})();

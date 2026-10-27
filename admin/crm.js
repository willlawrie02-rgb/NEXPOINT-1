/* Plan 071 PR 3: what the Contacts page and the company page share.

   Loaded after crm-shell.js as <script src="crm.js?v=071">: shared admin
   files are cached in browsers for up to four hours, so bump ?v= on every
   later change.

   One global, NXCRM. It reads nothing on its own and never writes: the
   pages read (intents included, by the board rules) and raise through
   their own raise(). Because the Contacts payloads are built from the
   fields a person changed rather than written as literals, each intent
   declares its keys here once (KEYS), held equal to what its handler in
   crm_handlers.py reads, and pick() keeps only those. */
(function () {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const KEYS = {
    'edit-company': ['company_id', 'name', 'website', 'add_domains', 'remove_domains', 'archive', 'restore'],
    'tag-company': ['company_id', 'on', 'tag_id', 'label'],
    'add-person': ['company_id', 'name', 'site_id', 'role', 'emails', 'phones', 'notes', 'kind'],
    'edit-person': ['person_id', 'name', 'role', 'notes', 'kind', 'phones', 'add_emails', 'remove_emails', 'company_id', 'site_id', 'archive', 'restore'],
    'add-site': ['company_id', 'name', 'town', 'country'],
    'edit-site': ['site_id', 'name', 'town', 'country', 'company_id'],
  };
  function pick(type, payload) {
    const keys = KEYS[type];
    if (!keys) throw new Error('not a Contacts intent: ' + type);
    if (!payload || !(keys[0] in payload)) throw new Error(type + ' needs its ' + keys[0]);
    const out = {};
    keys.forEach((k) => { if (k in payload) out[k] = payload[k]; });
    return out;
  }

  /* The kind badge (071): Deal, Lead, Contacts only or Archived. */
  function kindLabel(c) {
    if (!c) return 'Contacts only';
    if (c.archived_at || c.area === 'archive') return 'Archived';
    return c.area === 'deals' ? 'Deal' : c.area === 'leads' ? 'Lead' : 'Contacts only';
  }

  /* Open in Outlook (071 D12): the signed-in person's own mailbox first,
     else another mailbox, labelled with its address. Only Outlook on the
     web's own addresses are ever a link. */
  const OUTLOOK = /^https:\/\/outlook\.office(365)?\.com\//;
  function outlookLink(webLinks, viewerEmail) {
    const links = Object.entries(webLinks || {}).filter(([, href]) => OUTLOOK.test(String(href || '')));
    if (!links.length) return null;
    const me = String(viewerEmail || '').trim().toLowerCase();
    const own = links.find(([box]) => box.toLowerCase() === me);
    if (own) return { href: own[1], label: 'Open in Outlook' };
    return { href: links[0][1], label: 'Open in Outlook (' + links[0][0] + ')' };
  }

  /* Every row of a table, a thousand at a time: build() returns a fresh
     query each call, written out on the page so the board rules can read
     its table and columns. */
  async function readAll(build) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const r = await build().range(from, from + 999);
      if (r.error) return { data: out, error: r.error };
      const rows = r.data || [];
      out.push(...rows);
      if (rows.length < 1000) return { data: out, error: null };
    }
  }

  /* An account's state (Will, 10 September 2026: only a person moves it; plan
     069 adds Closed and Erased). Erased first: a stub keeps its closed_at. */
  const ORG_STATE = { on: 'On the hub', paused: 'Paused', removed: 'Removed from the hub', closed: 'Closed', deleted: 'Deleted', erased: 'Erased' };
  function orgState(o){return o.erased_at?'erased':o.deleted_at?'deleted':o.closed_at?'closed':o.removed_at?'removed':o.hidden_at?'paused':'on';}
  const offHub = (o) => ['removed', 'deleted', 'closed', 'erased'].includes(orgState(o));
  const isHost = (o) => o.host_print === 'approved' || o.host_mill === 'approved';

  /* Where an account stands, as the spec's pills: green for a live host,
     red only for a problem (paused, hidden for an unpaid invoice), neutral
     for what is finished. */
  function accountPill(o) {
    const s = orgState(o);
    const pill = (cls, icon, text) => '<span class="stage ' + cls + '"><span class="ms sm" aria-hidden="true">' + icon + '</span>' + esc(text) + '</span>';
    if (s === 'erased') return pill('s-known', 'delete_forever', 'Records erased');
    if (s === 'deleted') return pill('s-known', 'no_accounts', 'Account deleted');
    if (s === 'closed') return pill('s-known', 'no_accounts', 'Account closed');
    if (s === 'removed') return pill('s-known', 'block', isHost(o) ? 'Host removed' : 'Removed from the hub');
    if (s === 'paused') return pill('s-killed', 'pause_circle', isHost(o) ? 'Live host, paused' : 'Paused');
    if (isHost(o) && o.sub_status === 'hidden') return pill('s-killed', 'visibility_off', 'Live host, hidden: unpaid');
    if (isHost(o)) return pill('s-agreed', 'storefront', 'Live host');
    if (o.host_print === 'applied' || o.host_mill === 'applied') return pill('s-talking', 'storefront', 'Host applied');
    return pill('s-tocontact', 'hub', 'On the portal');
  }

  const FIT_ICON = { '3D Print Hub provider': 'view_in_ar', 'Mill Hub provider': 'precision_manufacturing', 'Consultancy': 'handshake' };
  function fitTag(label) {
    const icon = FIT_ICON[label];
    return '<span class="tag fit">' + (icon ? '<span class="ms sm" aria-hidden="true">' + icon + '</span>' : '') + esc(label) + '</span>';
  }

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  /* 12 Oct 2026; this year's dates drop the year. */
  function fmtDate(v, now) {
    if (!v) return '';
    const d = new Date(String(v).length === 10 ? v + 'T12:00:00Z' : v);
    if (isNaN(d)) return String(v);
    const year = (now || new Date()).getUTCFullYear();
    return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + (d.getUTCFullYear() === year ? '' : ' ' + d.getUTCFullYear());
  }
  const initials = (name) => {
    const w = String(name || '?').replace(/[^A-Za-z0-9 &]/g, '').split(' ').filter((x) => x && x !== '&');
    return w.length ? (w[0][0] + (w[1] ? w[1][0] : '')).toUpperCase() : '?';
  };
  const splitList = (text) => String(text || '').split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);

  /* The person editor both pages open in place (no dialogs): name, role,
     addresses and phones, the company and site (a move, when the page passes
     opts.companies and opts.sites), then archive with a reason. */
  const opt = (value, label, cur) => '<option value="' + esc(value) + '"' + (String(value) === String(cur == null ? '' : cur) ? ' selected' : '') + '>' + esc(label) + '</option>';
  function personForm(p, emails, opts) {
    const v = (x) => esc(x == null ? '' : x);
    const o = opts || {};
    const moves = o.companies
      ? '<div class="field"><label for="pe-co">Company</label><select class="input" id="pe-co">' + opt('', 'No company', p.company_id) +
        o.companies.map((c) => opt(c.id, c.name, p.company_id)).join('') + '</select></div>' +
        (o.sites && o.sites.length ? '<div class="field"><label for="pe-site">Site</label><select class="input" id="pe-site">' + opt('', 'No site', p.site_id) +
          o.sites.map((x) => opt(x.id, x.name, p.site_id)).join('') + '</select></div>' : '')
      : '';
    return '<div class="picker" data-person-form="' + v(p.id) + '"><div class="form-grid">' +
      '<div class="field"><label for="pe-name">Name</label><input class="input" id="pe-name" value="' + v(p.name) + '"></div>' +
      '<div class="field"><label for="pe-role">Role</label><input class="input" id="pe-role" value="' + v(p.role) + '"></div>' +
      '<div class="field"><label for="pe-email">Email</label><input class="input" id="pe-email" value="' + v((emails || []).join(', ')) + '"></div>' +
      '<div class="field"><label for="pe-phone">Phone</label><input class="input" id="pe-phone" value="' + v((p.phones || []).join(', ')) + '"></div>' +
      moves + '</div><div class="actions"><button type="button" class="btn sm primary" data-act="savePerson" data-person="' + v(p.id) + '">Save</button>' +
      '<button type="button" class="btn sm quiet" data-act="closeUi">Cancel</button></div>' +
      '<div class="inline-choice"><label class="sr" for="pe-why">Reason to archive</label>' +
      '<input class="input" id="pe-why" placeholder="Reason to archive, for example: left the company">' +
      '<button type="button" class="btn sm" data-act="archivePerson" data-person="' + v(p.id) + '"><span class="ms sm" aria-hidden="true">archive</span>Archive</button></div></div>';
  }
  /* The edit-person payload: only what changed. `read(id)` returns a form field's value;
     `opts` says whether the form carried the company and site pickers. A move to
     another company sends no site: the handler clears one that is not the new company's. */
  function personChanges(p, emails, read, opts) {
    const out = { person_id: p.id };
    const name = read('pe-name').trim(), role = read('pe-role').trim();
    if (name !== (p.name || '')) out.name = name;
    if (role !== (p.role || '')) out.role = role;
    const now = splitList(read('pe-email')).map((e) => e.toLowerCase()), was = (emails || []).map((e) => e.toLowerCase());
    const add = now.filter((e) => !was.includes(e)), remove = was.filter((e) => !now.includes(e));
    if (add.length) out.add_emails = add;
    if (remove.length) out.remove_emails = remove;
    const phones = splitList(read('pe-phone'));
    if (phones.join('|') !== (p.phones || []).join('|')) out.phones = phones;
    const o = opts || {}, id = (x) => (x === '' ? null : Number(x));
    if (o.companies) {
      const co = read('pe-co');
      if (String(co) !== String(p.company_id == null ? '' : p.company_id)) out.company_id = id(co);
      else if (o.sites && o.sites.length) {
        const site = read('pe-site');
        if (String(site) !== String(p.site_id == null ? '' : p.site_id)) out.site_id = id(site);
      }
    }
    return out;
  }

  window.NXCRM = { esc, KEYS, pick, kindLabel, outlookLink, readAll, ORG_STATE, orgState, offHub, isHost, accountPill,
    fitTag, FIT_ICON, fmtDate, initials, splitList, personForm, personChanges };
})();

/* NexPoint Global Hub - the people on the account page (plan 052, wave 3).
   Two sections the dashboard draws in beside its own: "You", the signed-in
   user's own details with an edit form and the email change, and "Users",
   everyone who signs in to the account, the invitations waiting, and a way
   to invite a colleague or remove one. Will's ruling of 8 October: the
   Account sits above its Users, and every user can do everything the
   account can.

   They read their own three routes (GET /account/profile, /account/users,
   /account/invites) rather than the summary, so a worker without them yet
   (a 404) leaves both sections hidden instead of breaking the page.
   dashboard.js calls NPPeople.render() after it has drawn the summary.   */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function el(id) { return document.getElementById(id); }
  function api(path, opts) {
    if (window.NP && NP.api) return NP.api(path, opts);
    return Promise.resolve({ error: 'network' });
  }
  function post(path, body) {
    return api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  }
  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    try { return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
    catch (e) { return String(iso); }
  }
  function icon(name) { return '<span class="material-symbols-outlined acct-ico" aria-hidden="true">' + name + '</span>'; }
  function head(ico, title, hint) {
    return '<div class="acct-h">' + icon(ico) + '<h2>' + esc(title) + '</h2></div>' +
      (hint ? '<p class="hint">' + esc(hint) + '</p>' : '');
  }
  function fill(id, html) { var n = el(id); if (!n) return; n.innerHTML = html; n.hidden = false; }
  function hide(id) { var n = el(id); if (!n) return; n.innerHTML = ''; n.hidden = true; }
  function say(node, text, bad) {
    if (!node) return;
    node.textContent = text;
    node.className = 'acct-msg' + (bad ? ' is-bad' : '');
    node.hidden = false;
  }
  function busy(btn, label) {
    if (!btn) return function () {};
    var orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = label;
    return function () { btn.disabled = false; btn.textContent = orig; };
  }
  function field(id, label, value, type, extra) {
    return '<div class="field"><label for="' + id + '">' + esc(label) + '</label>' +
      '<input id="' + id + '" type="' + (type || 'text') + '" value="' + esc(value || '') + '"' + (extra || '') + '></div>';
  }
  var HELLO = 'hello@nexpoint.co.uk';
  var GENERIC = 'That did not go through. Try again, or email ' + HELLO + '.';

  /* What the page last read, so a form can be redrawn without asking again. */
  var state = { profile: null, account: null, users: null, invites: null };

  /* ═══════════ You ═══════════ */
  function renderYou() {
    var p = state.profile;
    if (!p) { hide('you'); return; }
    var where = [p.town, p.country].filter(Boolean).join(', ');
    var rows = [['Name', p.name], ['Email', p.email], ['Phone', p.phone], ['Location', where]];
    fill('you',
      head('person', 'You', 'Your own details. They are yours alone; the account above is shared by every user.') +
      '<div class="acct-card" id="youCard">' +
        '<dl class="acct-facts">' + rows.map(function (r) {
          return '<dt>' + esc(r[0]) + '</dt><dd>' + (r[1] ? esc(r[1]) : '<span class="muted">Not given</span>') + '</dd>';
        }).join('') + '</dl>' +
        (p.pending_email
          ? '<p class="acct-msg" id="youPending">A link is waiting at ' + esc(p.pending_email) +
            '. Your sign-in moves to that address once it is opened; until then it stays as it is.</p>'
          : '') +
        '<p class="acct-msg" id="youMsg" hidden></p>' +
        '<div class="modal-actions">' +
          '<button class="btn btn-outline acct-btn-sm" type="button" data-act="you-edit">Edit your details</button>' +
          '<button class="btn btn-outline acct-btn-sm" type="button" data-act="you-email">Change your email address</button>' +
        '</div>' +
        '<form class="acct-form" id="youEdit" hidden>' +
          '<div class="form-grid">' +
            field('youName', 'Name', p.name, 'text', ' autocomplete="name" maxlength="200" required') +
            field('youPhone', 'Phone', p.phone, 'tel', ' autocomplete="tel" maxlength="50"') +
            field('youTown', 'Town', p.town, 'text', ' autocomplete="address-level2" maxlength="100"') +
            field('youCountry', 'Country', p.country, 'text', ' autocomplete="country-name" maxlength="100"') +
          '</div>' +
          '<p class="acct-msg" id="youEditMsg" hidden></p>' +
          '<div class="modal-actions">' +
            '<button class="btn btn-primary acct-btn-sm" type="submit" id="youSave">Save your details</button>' +
            '<button class="btn btn-ghost acct-btn-sm" type="button" data-act="you-cancel">Cancel</button>' +
          '</div>' +
        '</form>' +
        '<form class="acct-form" id="youEmail" hidden>' +
          '<p class="hint">We send a link to the new address, and tell your current address straight away. Nothing changes until the link is opened; changing your password cancels it.</p>' +
          '<div class="form-grid">' +
            field('youNewEmail', 'New email address', '', 'email', ' autocomplete="email" maxlength="200" required') +
            field('youPassword', 'Your current password', '', 'password', ' autocomplete="current-password" required') +
          '</div>' +
          '<p class="acct-msg" id="youEmailMsg" hidden></p>' +
          '<div class="modal-actions">' +
            '<button class="btn btn-primary acct-btn-sm" type="submit" id="youEmailSend">Send the confirmation link</button>' +
            '<button class="btn btn-ghost acct-btn-sm" type="button" data-act="you-cancel">Cancel</button>' +
          '</div>' +
        '</form>' +
      '</div>');
    if (window.NPAccount && NPAccount.passwordEye) NPAccount.passwordEye(el('youPassword'));
  }

  function openForm(which) {
    ['youEdit', 'youEmail'].forEach(function (id) { if (el(id)) el(id).hidden = id !== which; });
    var first = which === 'youEdit' ? el('youName') : el('youNewEmail');
    if (first) first.focus();
  }

  function saveDetails() {
    var msg = el('youEditMsg');
    var name = (el('youName').value || '').trim();
    if (!name) { say(msg, 'Enter your name.', true); el('youName').focus(); return; }
    var done = busy(el('youSave'), 'Saving…');
    var p = state.profile || {};
    post('/account/profile', {
      name: name, phone: el('youPhone').value, town: el('youTown').value,
      country: el('youCountry').value, region: p.region || '',
    }).then(function (d) {
      if (d && d.ok && d.profile) { state.profile = d.profile; renderYou(); say(el('youMsg'), 'Saved.'); return; }
      done();
      say(msg, GENERIC, true);
    });
  }

  var EMAIL_ERRORS = {
    'valid email required': 'Enter a full email address.',
    same_email: 'That is the address you sign in with already.',
    address_has_account: 'That address already signs in to the hub. Use another, or email ' + HELLO + '.',
    current_password_required: 'Enter your current password.',
    current_password_wrong: 'That is not your current password.',
    too_many_attempts: 'Too many wrong passwords. Wait ten minutes, then try again.',
    too_soon: 'A link went out in the last two minutes. Check that inbox, including spam, before asking again.',
  };
  function changeEmail() {
    var msg = el('youEmailMsg');
    var next = (el('youNewEmail').value || '').trim();
    var pass = el('youPassword').value || '';
    if (!next) { say(msg, EMAIL_ERRORS['valid email required'], true); el('youNewEmail').focus(); return; }
    if (!pass) { say(msg, EMAIL_ERRORS.current_password_required, true); el('youPassword').focus(); return; }
    var done = busy(el('youEmailSend'), 'Sending…');
    post('/account/email', { new_email: next, current_password: pass }).then(function (d) {
      if (d && d.ok) {
        state.profile = Object.assign({}, state.profile, { pending_email: d.pending_email });
        renderYou();
        return;
      }
      done();
      say(msg, EMAIL_ERRORS[d && d.error] || GENERIC, true);
    });
  }

  /* ═══════════ Users ═══════════ */
  function roleLabel(u) { return u.role === 'owner' ? 'Created the account' : 'Invited'; }
  function renderUsers() {
    var users = state.users;
    if (!users) { hide('users'); return; }
    var company = (state.account && state.account.name) || 'this account';
    var rows = users.map(function (u) {
      var bits = [u.email, roleLabel(u), u.joined_at ? 'since ' + fmtDate(u.joined_at) : '']
        .concat(u.confirmed ? [] : ['email not confirmed yet']).filter(Boolean);
      return '<div class="acct-row" data-user="' + esc(u.user_id) + '">' +
        '<div class="acct-row__meta"><b>' + esc(u.name || u.email) + (u.you ? ' <span class="acct-hub">You</span>' : '') + '</b>' +
          '<span>' + esc(bits.join(' · ')) + '</span></div>' +
        '<div class="acct-row__actions">' +
          (u.you ? '' : '<button class="btn btn-outline acct-btn-sm" type="button" data-act="user-remove" ' +
            'data-user="' + esc(u.user_id) + '" data-name="' + esc(u.name || u.email) + '">Remove</button>') +
        '</div>' +
      '</div>';
    }).join('');
    var invites = state.invites || [];
    var waiting = invites.length
      ? '<h3 class="acct-sub">Invitations waiting</h3><div class="acct-list">' + invites.map(function (i) {
          return '<div class="acct-row"><div class="acct-row__meta"><b>' + esc(i.email) + '</b>' +
            '<span>' + esc('Sent ' + fmtDate(i.created_at) + ', open until ' + fmtDate(i.expires_at)) + '</span></div>' +
            '<div class="acct-row__actions"><button class="btn btn-outline acct-btn-sm" type="button" data-act="invite-withdraw" ' +
              'data-invite="' + esc(i.id) + '">Withdraw</button></div></div>';
        }).join('') + '</div>'
      : '';
    fill('users',
      head('groups', 'Users', 'Everyone who signs in to ' + company + '. Every user can do everything the account can.') +
      '<div class="acct-list" id="userList">' + rows + '</div>' +
      '<p class="acct-msg" id="usersMsg" hidden></p>' +
      waiting +
      '<h3 class="acct-sub">Invite a colleague</h3>' +
      '<form class="acct-form acct-invite" id="inviteForm">' +
        '<div class="field"><label for="inviteEmail">Their work email</label>' +
          '<input id="inviteEmail" type="email" autocomplete="off" maxlength="200" placeholder="colleague@company.com" required></div>' +
        '<button class="btn btn-primary acct-btn-sm" type="submit" id="inviteSend">Send the invitation</button>' +
      '</form>' +
      '<p class="acct-msg" id="inviteMsg" hidden></p>');
  }

  var INVITE_ERRORS = {
    'valid email required': 'Enter a full email address.',
    that_is_you: 'That is your own address.',
    address_has_account: 'That address already signs in to the hub, so it cannot join a second account. Email ' + HELLO + ' if it should move.',
    already_invited: 'That address has an invitation waiting already.',
    too_many_open_invites: 'Ten invitations are waiting already. Withdraw one, or wait for one to be used.',
    too_many_invites_today: 'That is the most invitations for one day. Try again tomorrow.',
  };
  function sendInvite() {
    var msg = el('inviteMsg');
    var email = (el('inviteEmail').value || '').trim();
    if (!email) { say(msg, INVITE_ERRORS['valid email required'], true); el('inviteEmail').focus(); return; }
    var done = busy(el('inviteSend'), 'Sending…');
    post('/account/invites', { email: email }).then(function (d) {
      if (d && d.ok) {
        loadInvites().then(function () {
          renderUsers();
          say(el('inviteMsg'), 'Invitation sent to ' + (d.invite && d.invite.email || email) + '. The link lasts seven days.');
        });
        return;
      }
      done();
      say(msg, INVITE_ERRORS[d && d.error] || GENERIC, true);
    });
  }

  function withdrawInvite(btn) {
    var id = Number(btn.getAttribute('data-invite'));
    var done = busy(btn, 'Withdrawing…');
    post('/account/invites/withdraw', { id: id }).then(function (d) {
      if (d && (d.ok || d.error === 'not_found')) { loadInvites().then(renderUsers); return; }
      done();
      say(el('usersMsg'), GENERIC, true);
    });
  }

  function removeUser(btn) {
    var id = btn.getAttribute('data-user');
    var name = btn.getAttribute('data-name') || 'this user';
    var company = (state.account && state.account.name) || 'the account';
    if (!window.confirm('Remove ' + name + ' from ' + company + '? Their sign-in is deleted. Nothing the account has done is lost, and they can be invited again.')) return;
    var done = busy(btn, 'Removing…');
    post('/account/users/remove', { user_id: id }).then(function (d) {
      if (d && d.ok) {
        loadUsers().then(function () { renderUsers(); say(el('usersMsg'), name + ' has been removed.'); });
        return;
      }
      done();
      say(el('usersMsg'), d && d.error === 'cannot_remove_yourself'
        ? 'You cannot remove yourself. Email ' + HELLO + ' if you are leaving.' : GENERIC, true);
    });
  }

  /* ═══════════ loading ═══════════ */
  function loadUsers() {
    return api('/account/users').then(function (d) { state.users = d && d.ok ? (d.users || []) : null; });
  }
  function loadInvites() {
    return api('/account/invites').then(function (d) { state.invites = d && d.ok ? (d.invites || []) : []; });
  }
  function render() {
    return Promise.all([
      api('/account/profile').then(function (d) {
        state.profile = d && d.ok ? d.profile : null;
        state.account = d && d.ok ? d.account : null;
      }),
      loadUsers(), loadInvites(),
    ]).then(function () {
      renderYou();
      renderUsers();
    });
  }
  function clear() { hide('you'); hide('users'); }

  function onClick(e) {
    var btn = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    if (!btn) return;
    var act = btn.getAttribute('data-act');
    if (act === 'you-edit') { openForm('youEdit'); return; }
    if (act === 'you-email') { openForm('youEmail'); return; }
    if (act === 'you-cancel') { openForm(''); return; }
    if (act === 'invite-withdraw') { withdrawInvite(btn); return; }
    if (act === 'user-remove') { removeUser(btn); return; }
  }
  function onSubmit(e) {
    var id = e.target && e.target.id;
    if (id === 'youEdit') { e.preventDefault(); saveDetails(); }
    else if (id === 'youEmail') { e.preventDefault(); changeEmail(); }
    else if (id === 'inviteForm') { e.preventDefault(); sendInvite(); }
  }
  function wire() {
    ['you', 'users'].forEach(function (id) {
      var n = el(id);
      if (!n || n.dataset.npWired) return;
      n.dataset.npWired = '1';
      n.addEventListener('click', onClick);
      n.addEventListener('submit', onSubmit);
    });
  }

  window.NPPeople = {
    render: function () { wire(); return render(); },
    clear: clear,
  };
})();

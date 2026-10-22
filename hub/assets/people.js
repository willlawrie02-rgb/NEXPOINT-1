/* NexPoint Global Portal - the account settings page (plan 052, wave 3; plan
   055, decisions 25 and 26). Three sections: "Logo", the account's mark,
   shown on the account page to everyone who signs in to it; "You", the
   signed-in user's own details with an edit form and the email change; and
   "Users", everyone who signs in to the account, the invitations waiting,
   and a way to invite a colleague or remove one. The ruling of 8 October:
   the Account sits above its Users, and every user can do everything the
   account can.

   They read their own routes (GET /account/logo, /account/profile,
   /account/users, /account/invites) rather than the summary, so a worker
   without one of them yet (a 404) leaves that section hidden instead of
   breaking the page. The page boots itself on np:modules when <body>
   carries data-np-settings (NPPeople.boot, called by portal.js).          */
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
  var state = { profile: null, account: null, users: null, invites: null, logo: undefined };

  /* ═══════════ Logo ═══════════ */
  /* The account's logo takes the monogram's place when there is one. The
     worker keeps it in a private bucket and answers a link that works for a
     minute, read fresh on every render. The page crops to a square and
     shrinks it before it is sent, so the worker does no image work. */
  var LOGO_SIDE = 320;
  function initials(name) {
    var w = String(name || '').replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
    return ((w[0] || '').charAt(0) + (w[1] || '').charAt(0)).toUpperCase() || 'N';
  }
  function monogram(text) {
    return '<span class="acct-mono" aria-hidden="true">' + esc(text) + '</span>';
  }
  function renderLogo() {
    if (state.logo === undefined) { hide('logo'); return; }
    var name = (state.account && state.account.name) || 'this account';
    fill('logo',
      head('storefront', 'Logo', 'Shown on your account for everyone who signs in to it.') +
      '<div class="acct-card"><div class="acct-id">' +
        '<span class="acct-pic" id="logoPic" data-initials="' + esc(initials(name)) + '">' + monogram(initials(name)) + '</span>' +
        '<div class="acct-id__text">' +
          '<p class="hint" style="margin:0 0 10px">' + esc(name) + '</p>' +
          '<div class="acct-row__actions">' +
            '<button class="btn btn-primary acct-btn-sm" type="button" data-act="logo-pick">Add a logo</button>' +
            '<button class="btn btn-outline acct-btn-sm" type="button" data-act="logo-remove" hidden>Remove logo</button>' +
            '<input type="file" id="logoFile" accept="image/*" hidden aria-label="Your logo">' +
          '</div>' +
          '<p class="acct-msg" id="logoMsg" hidden></p>' +
        '</div>' +
      '</div></div>');
    showLogo(state.logo);
  }
  function showLogo(url) {
    state.logo = url || null;
    var pic = el('logoPic');
    if (!pic) return;
    if (url) {
      pic.innerHTML = '<img class="acct-mono acct-mono--pic" alt="Your logo">';
      var img = pic.firstChild;
      img.onerror = function () { showLogo(null); };
      img.src = url;
    } else {
      pic.innerHTML = monogram(pic.getAttribute('data-initials'));
    }
    var pick = document.querySelector('[data-act="logo-pick"]');
    var remove = document.querySelector('[data-act="logo-remove"]');
    if (pick) pick.textContent = url ? 'Change logo' : 'Add a logo';
    if (remove) remove.hidden = !url;
  }
  /* The route not shipped yet (a 404) hides the section; a signed-out
     answer is caught by the page state before this runs. */
  function loadLogo() {
    return api('/account/logo').then(function (d) {
      state.logo = (d && !d.error) ? (d.url || null) : (d && d.error === 'http_404' ? undefined : null);
    });
  }
  /* Any picture the browser can read, centre-cropped to a square on white
     (a transparent PNG would otherwise turn black) and sent as a JPEG. */
  function squareJpeg(file) {
    return new Promise(function (resolve, reject) {
      var src = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight, side = Math.min(w, h);
        URL.revokeObjectURL(src);
        if (!side) { reject(new Error('empty')); return; }
        var out = Math.min(LOGO_SIDE, side);
        var c = document.createElement('canvas');
        c.width = out; c.height = out;
        var g = c.getContext('2d');
        g.fillStyle = '#FFFFFF';
        g.fillRect(0, 0, out, out);
        g.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, out, out);
        resolve(c.toDataURL('image/jpeg', 0.88));
      };
      img.onerror = function () { URL.revokeObjectURL(src); reject(new Error('unreadable')); };
      img.src = src;
    });
  }
  var LOGO_ERRORS = {
    not_an_image: 'Choose a PNG or JPEG picture.',
    'too large': 'That picture is too large. Choose one under 2 MB.',
  };
  function uploadLogo(input) {
    var file = input.files && input.files[0];
    var msg = el('logoMsg');
    var pick = document.querySelector('[data-act="logo-pick"]');
    if (!file) return;
    if (msg) msg.hidden = true;
    var done = busy(pick, 'Saving');
    squareJpeg(file).then(function (image) {
      return post('/account/logo', { image: image });
    }, function () {
      return { error: 'not_an_image' };
    }).then(function (d) {
      done();
      input.value = '';
      if (!d || d.error) { say(msg, LOGO_ERRORS[d && d.error] || 'We could not save that logo just now. Try again.', true); return; }
      showLogo(d.url);
    });
  }
  function removeLogo(btn) {
    var msg = el('logoMsg');
    if (msg) msg.hidden = true;
    var done = busy(btn, 'Removing');
    post('/account/logo/remove', {}).then(function (d) {
      done();
      if (!d || d.error) { say(msg, 'We could not remove that logo just now. Try again.', true); return; }
      showLogo(null);
    });
  }

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

  /* ═══════════ Closing (plan 069) ═══════════ */
  /* Platform Terms 1.3 section 8: a host or seeker closes its own account from
     this page, behind the account's name typed (the Delete rule) and the
     current password (the email change's check). The section is drawn only
     when the profile answer carries `account.closed`, so a worker without
     the routes leaves it hidden (plan 052's 404 convention). Once closed, the
     section becomes This account is closed, with Reopen; Logo and Users hide. */
  var closed = function () { return !!(state.account && state.account.closed); };
  var HOST_TEXT = 'Closing ends your Host Agreement now and takes your listing off the 3D Print Hub and the Mill Hub. ' +
    'Fees already paid are not refunded, and an invoice already raised is still payable. Introductions already made keep ' +
    'their five fee years: the recurring fee on work for those customers and the monthly declaration carry on, and you can ' +
    'still sign in to declare and to see your statements. Everything else on the portal closes to you.';
  var SEEKER_TEXT = 'Closing ends your use of the portal. Your open requests close. Introductions already made stay on ' +
    'record, and you may still be asked once a quarter to confirm the order lines that name you, which you can do by signing in.';
  var BOTH_TEXT = 'We keep the account\'s records for six years after the last invoice raised for it, or for six years from ' +
    'today if there was none, and then delete them. You can reopen the account at any time before then.';
  function nameMatches(typed, name) {
    var t = String(typed || '').trim().toLowerCase(), n = String(name || '').trim().toLowerCase();
    return t !== '' && t === n;
  }
  function renderClosing() {
    var a = state.account;
    if (!a || !('closed' in a)) { hide('closing'); return; }
    if (a.closed) {
      fill('closing',
        head('history', 'This account is closed', 'Closed on ' + fmtDate(a.closed.at) + '.') +
        '<div class="acct-card">' +
          '<p class="hint" style="margin:0 0 14px">Reopen it and everything is as you left it; to host on a hub, apply from your account page.</p>' +
          '<p class="acct-msg" id="closingMsg" hidden></p>' +
          '<div class="modal-actions" style="margin-top:0">' +
            '<button class="btn btn-primary acct-btn-sm" type="button" data-act="reopen" id="reopenGo">Reopen this account</button>' +
          '</div>' +
        '</div>');
      return;
    }
    fill('closing',
      head('visibility_off', 'Closing your account', 'Closing ends your use of the portal; the records are kept for six years after the last invoice, and you can reopen at any time before then.') +
      '<div class="modal-actions" style="margin-top:0">' +
        '<button class="btn btn-outline acct-btn-sm" type="button" data-act="close-open">Close this account</button>' +
      '</div>');
  }
  function closeCheck() {
    var go = el('closeGo');
    if (!go) return;
    go.disabled = !nameMatches(el('closeName') && el('closeName').value, state.account && state.account.name);
  }
  function openClose() {
    var a = state.account || {};
    if (el('closeText')) {
      el('closeText').innerHTML = '<p class="body">' + esc(a.host ? HOST_TEXT : SEEKER_TEXT) + '</p>' +
        '<p class="body" style="margin-top:12px">' + esc(BOTH_TEXT) + '</p>';
    }
    if (el('closeNameShown')) el('closeNameShown').textContent = a.name || '';
    if (el('closeName')) el('closeName').value = '';
    if (el('closePassword')) el('closePassword').value = '';
    if (el('closeMsg')) el('closeMsg').hidden = true;
    closeCheck();
    if (window.openOverlay) openOverlay('closeOverlay');
    if (el('closeName')) el('closeName').focus();
  }
  var CLOSE_ERRORS = {
    name_mismatch: 'That is not the account\'s name.',
    current_password_required: 'Enter your current password.',
    current_password_wrong: 'That password is not right.',
    too_many_attempts: 'Too many wrong passwords. Wait ten minutes, then try again.',
    already_closed: 'This account is closed already.',
  };
  function closeAccount() {
    var msg = el('closeMsg');
    var typed = (el('closeName') && el('closeName').value || '').trim();
    var pass = el('closePassword') && el('closePassword').value || '';
    if (!nameMatches(typed, state.account && state.account.name)) { say(msg, CLOSE_ERRORS.name_mismatch, true); return; }
    if (!pass) { say(msg, CLOSE_ERRORS.current_password_required, true); if (el('closePassword')) el('closePassword').focus(); return; }
    var done = busy(el('closeGo'), 'Closing…');
    post('/account/close', { confirm_name: typed, current_password: pass }).then(function (d) {
      if (d && d.ok) { location.href = '../'; return; }
      done();
      closeCheck();
      say(msg, CLOSE_ERRORS[d && d.error] || GENERIC, true);
    });
  }
  function reopenAccount() {
    var msg = el('closingMsg');
    var done = busy(el('reopenGo'), 'Reopening…');
    post('/account/reopen', {}).then(function (d) {
      if (d && d.ok) { location.href = '../'; return; }
      done();
      say(msg, d && d.error === 'not_closed' ? 'This account is open already.' : GENERIC, true);
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
      loadUsers(), loadInvites(), loadLogo(),
    ]).then(function () {
      /* The closed mode (plan 069): You stays, Logo and Users go. */
      if (closed()) { hide('logo'); hide('users'); } else { renderLogo(); renderUsers(); }
      renderYou();
      renderClosing();
    });
  }
  function clear() { hide('logo'); hide('you'); hide('users'); hide('closing'); }

  /* ═══════════ page states (the settings page) ═══════════ */
  function showLoading() {
    if (el('acctLoading')) el('acctLoading').hidden = false;
    if (el('acctError')) el('acctError').hidden = true;
    if (el('signInPrompt')) el('signInPrompt').hidden = true;
  }
  function showSignedOut() {
    if (el('acctLoading')) el('acctLoading').hidden = true;
    if (el('acctError')) el('acctError').hidden = true;
    clear();
    fill('signInPrompt',
      '<div class="panel" style="max-width:480px;margin:24px auto;text-align:center">' +
        '<h2 style="margin-bottom:10px">Sign in to see your account settings</h2>' +
        '<p class="body" style="margin-bottom:22px">The logo, your own details and who signs in, once you are signed in.</p>' +
        '<div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">' +
          '<button class="btn btn-primary" type="button" data-act="signin">Sign in</button>' +
        '</div>' +
      '</div>');
  }
  function showError() {
    if (el('acctLoading')) el('acctLoading').hidden = true;
    if (el('signInPrompt')) el('signInPrompt').hidden = true;
    clear();
    var e = el('acctError');
    if (!e) return;
    e.innerHTML = 'That did not load. Check your connection and try again, or email <a href="mailto:' + HELLO + '">' + HELLO + '</a>.';
    e.hidden = false;
  }
  /* The account module both resolves its ready promise and fires
     npaccount:change for the same refresh, and this page listens for both,
     so a load is queued rather than fired: two triggers, one read. */
  var seq = 0, queued = null;
  function load() {
    clearTimeout(queued);
    queued = setTimeout(doLoad, 0);
  }
  function doLoad() {
    if (!window.NPAccount || !NPAccount.user) { showSignedOut(); return; }
    var mine = ++seq;
    showLoading();
    wire();
    render().then(function () {
      if (mine !== seq) return;
      if (el('acctLoading')) el('acctLoading').hidden = true;
      /* Every route refused: the sign-in has lapsed, or nothing loads. */
      if (state.profile === null && state.users === null && state.logo === null) {
        api('/auth/me').then(function (d) {
          if (mine !== seq) return;
          if (d && d.signed_in === false) { if (window.NPAccount && NPAccount.sessionLapsed) NPAccount.sessionLapsed(); showSignedOut(); }
          else showError();
        });
      }
    });
  }

  function gate(fn) {
    if (window.NPAccount && NPAccount.requireConfirmed) NPAccount.requireConfirmed(fn);
    else fn();
  }
  function onClick(e) {
    var btn = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    if (!btn) return;
    var act = btn.getAttribute('data-act');
    if (act === 'signin') { if (window.openSignIn) openSignIn(); return; }
    if (act === 'logo-pick') { var file = el('logoFile'); if (file) file.click(); return; }
    if (act === 'logo-remove') { gate(function () { removeLogo(btn); }); return; }
    if (act === 'you-edit') { openForm('youEdit'); return; }
    if (act === 'you-email') { openForm('youEmail'); return; }
    if (act === 'you-cancel') { openForm(''); return; }
    if (act === 'invite-withdraw') { withdrawInvite(btn); return; }
    if (act === 'user-remove') { removeUser(btn); return; }
    if (act === 'close-open') { openClose(); return; }
    if (act === 'close-keep') { if (window.closeAll) closeAll(); return; }
    if (act === 'reopen') { reopenAccount(); return; }
  }
  function onSubmit(e) {
    var id = e.target && e.target.id;
    if (id === 'youEdit') { e.preventDefault(); saveDetails(); }
    else if (id === 'youEmail') { e.preventDefault(); changeEmail(); }
    else if (id === 'inviteForm') { e.preventDefault(); sendInvite(); }
    else if (id === 'closeForm') { e.preventDefault(); closeAccount(); }
  }
  function onInput(e) {
    if (e.target && e.target.id === 'closeName') closeCheck();
  }
  function onChange(e) {
    if (e.target && e.target.id === 'logoFile') gate(function () { uploadLogo(e.target); });
  }
  function wire() {
    ['logo', 'you', 'users', 'closing', 'signInPrompt', 'closeOverlay'].forEach(function (id) {
      var n = el(id);
      if (!n || n.dataset.npWired) return;
      n.dataset.npWired = '1';
      n.addEventListener('click', onClick);
      n.addEventListener('submit', onSubmit);
      n.addEventListener('change', onChange);
      n.addEventListener('input', onInput);
    });
  }

  /* ═══════════ boot ═══════════ */
  function boot() {
    if (!document.body || !document.body.hasAttribute('data-np-settings')) return;
    wire();
    if (!window.NPAccount) { showSignedOut(); return; }
    document.addEventListener('npaccount:change', load);
    NPAccount.ready.then(load);
  }

  window.NPPeople = {
    boot: boot,
    render: function () { wire(); return render(); },
    clear: clear,
  };
})();

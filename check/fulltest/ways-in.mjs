// The full test: before anything, every way in, the account's settings and
// people, closing and reopening, and Terms 2.0 (action list groups 1.1-1.3,
// 2, 3, 4, 10 and 11).
import { randomBytes } from "node:crypto";
import { APEX, PRINT, MILL, OPPS, API, Refused, Soft, mustBeZZ, isZZ, isZZSlug, differs, wait, skip, hand, askEnter, askLine } from "./core.mjs";
import { windowFor, go, see, shows, text, whoAmI, apiGet, signIn, signOut, adminWindow, adminGo, saveVia, wantDirect, ADMIN, allow, pollUntil, invoiceRaised } from "./browser.mjs";
import { same, made, acct, today, MARK, stampOf, newcomer, pageErrors, typeahead, fillIfEmpty, emailLink, pdfOk, nearest, termsOf, HUBS, openAnswer, answer, findForm, search, cardOf, companyPage, prospectName, prospectRow, openProspect, fits, registerByHand } from "./kit.mjs";

/* What these journeys send, beyond the runner's own list (browser.mjs). */
allow({
  accountPosts: [
    "/auth/resend-confirmation",            // 2.2 Resend the email
    "/auth/reset-confirm",                  // 3.4 the reset page's new password
    "/account/profile",                     // 4.1 Save your details
    "/account/logo", "/account/logo/remove",  // 4.2 the logo
    "/account/invites/withdraw",            // 4.3 Withdraw
    "/account/email", "/account/email/confirm",  // 4.5 the email change and its link
    "/account/close", "/account/reopen",    // 11 closing and reopening
  ],
});

// ================================================================ helpers of this file
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const posted = (page, path, ms = 30000) => page.waitForResponse((r) => r.url() === `${API}${path}` && r.request().method() === "POST", { timeout: ms });
/* The site sends one confirmation email, one reset email and one email-change
   link per address every two minutes (portal worker, auth.js
   CONFIRM_RESEND_COOLDOWN_MS); a little over that, to be sure. */
const COOLDOWN_MS = 125 * 1000;
async function waitOutCooldown(ctx, sinceIso, what) {
  const left = (Date.parse(sinceIso || "") || 0) + COOLDOWN_MS - Date.now();
  if (left > 0) {
    ctx.log(`  waiting ${Math.ceil(left / 1000)} seconds: the site sends ${what} once every two minutes`);
    await pause(left);
  }
}
/* A one-pixel PNG, made here: the logo upload needs a real picture. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

/* signIn() opens the sign-in box when its window is not yet signed in. A
   confirmation or reset link signs the window in by itself, and then the
   door never opens the box (portal.js openDoorSignIn), so first ask the
   live site whether this window is signed in already. signIn() still proves
   it is the ZZ account before anything else happens. */
async function signInHere(ctx, role, account) {
  const w = await windowFor(ctx, role);
  if (!w.proved && !w.signedIn) {
    if (!/nexpoint\.co\.uk/.test(w.page.url())) await go(w.page, `${APEX}/hub/`);
    const me = await whoAmI(w.page);
    if (me && me.signed_in === true) w.signedIn = true;
  }
  return signIn(ctx, role, account ? { account } : {});
}
/* A sign-in by hand in a clean window, to see what this email and password
   get: the name chip, or the box's error line. */
async function trySignIn(ctx, role, email, password) {
  const w = ctx.lastWindow = await windowFor(ctx, role, { fresh: true });
  await go(w.page, `${APEX}/hub/?signin=1`);
  await w.page.locator("#signOverlay.open").waitFor({ state: "visible", timeout: 25000 });
  await w.page.fill("#sEmail", email);
  await w.page.fill("#sPass", password);
  await w.page.click("#signContent button[type=submit]");
  const chip = w.page.locator(".np-chip__name").first();
  const err = w.page.locator("#signContent .np-sign-error");
  await Promise.race([chip.waitFor({ state: "visible", timeout: 20000 }), err.waitFor({ state: "visible", timeout: 20000 })]).catch(() => {});
  if (await chip.isVisible().catch(() => false)) return { w, ok: true, me: await whoAmI(w.page) };
  return { w, ok: false, error: await text(w.page, "#signContent .np-sign-error").catch(() => "") };
}
/* The link in the newest email since a given moment, so an older email with
   the same subject (a withdrawn invitation, say) is never the one opened.
   Without the mailbox, the operator pastes it, as emailLink() asks. */
async function linkSince(ctx, { to, subject, part, what, since }) {
  const box = ctx.mail.on ? ctx.mail.boxFor(to) : "";
  if (!box || !since) return emailLink(ctx, { to, subject, part, what });
  const m = await ctx.mail.waitFor(box, { to, subject, since });
  if (!m) differs(`${what}, sent to ${to}`, "no such email in the mailbox after 90 seconds", subject);
  const link = await ctx.mail.linkIn(box, m.id, part);
  if (!link) differs(`the link in ${what}`, "no link to that page in the email", part);
  let u; try { u = new URL(link); } catch { throw new Refused("refused: that is not a web address"); }
  if (u.origin !== APEX || !u.pathname.includes(part)) throw new Refused(`refused: the link does not open ${APEX}${part}`);
  return u.href;
}
/* How many emails to this address, with this subject, since a moment: null
   when the runner may not read that mailbox. Waits up to ms for want of them. */
async function mailCount(ctx, { to, subject, since, want, ms = 90000 }) {
  const box = ctx.mail.on ? ctx.mail.boxFor(to) : "";
  if (!box) return null;
  const end = Date.now() + ms;
  for (;;) {
    const n = (await ctx.mail.recent(box, since)).filter((m) =>
      [].concat(m.toRecipients || [], m.ccRecipients || []).some((p) => same(p.emailAddress && p.emailAddress.address, to)) &&
      String(m.subject || "").includes(subject)).length;
    if (n >= want || Date.now() > end) return n;
    await pause(5000);
  }
}

/* The newcomer: the one account registered on every run (in.register).
   Its stamp is kept for the other journeys of this run, which read it here. */
const REG = "in.register";
function reg(ctx, key = "email") {
  const n = newcomer(ctx, key);
  ctx.cache.newcomerStamp = stampOf(ctx);
  return n;
}
/* Its password: the settings' one until 3.4 sets a new one, which lives in
   this run's memory only, never in the state file. */
function newcomerPassword(ctx) {
  if (ctx.cache.newcomerPassword) return ctx.cache.newcomerPassword;
  if (made(ctx).passwordReset) skip("the new account's password was changed on an earlier run, and a password is never kept between runs");
  return newcomer(ctx).password;
}
const newcomerAccount = (ctx) => ({ ...reg(ctx), password: newcomerPassword(ctx) });
/* For a journey other than in.register: the new account's company name. */
function newcomerCompany(ctx) {
  const m = made(ctx), r = ctx.state.made[REG] || {};
  const registered = (ctx.state.at[REG] && (ctx.state.at[REG].done || []).includes("register")) || ctx.cache.newcomerStamp;
  const stamp = m.newcomerStamp || ctx.cache.newcomerStamp || (registered && r.stamp);
  if (!stamp) skip("no new account was registered on this run, or left waiting by an earlier one");
  m.newcomerStamp = stamp;
  const company = String(ctx.settings.new_account.company || "ZZ Full Test {stamp}").replace("{stamp}", stamp);
  mustBeZZ(company, "the new account's company");
  return company;
}

/* The invited user (in.join): the host's company, the invitation address,
   the settings' password. */
function invitee(ctx) {
  if (!String(ctx.settings.new_account.invite_email || "").trim()) skip("new_account.invite_email is not filled in");
  return newcomer(ctx, "invite_email");
}
const joinerName = (ctx) => `${newcomer(ctx, "invite_email").name} Joiner`;
const joinerAccount = (ctx) => ({ company: acct(ctx, "host").company, email: invitee(ctx).email, password: newcomer(ctx).password });
function changedAddress(ctx) {
  if (!String(ctx.settings.new_account.change_email || "").trim()) skip("new_account.change_email is not filled in");
  return newcomer(ctx, "change_email").email;
}
/* Sends an invitation from the host's settings page to this address. */
async function invite(ctx, email) {
  const w = await signIn(ctx, "host");
  await go(w.page, `${APEX}/hub/account/settings/`);
  await w.page.locator("#inviteEmail").waitFor({ state: "visible", timeout: 25000 });
  await w.page.fill("#inviteEmail", email);
  const sent = posted(w.page, "/account/invites");
  await w.page.click("#inviteSend");
  if ((await sent).ok()) ctx.did();
  await see(w.page, "#inviteMsg", "Invitation sent to", "after inviting");
  return w;
}

// ================================================================ 1. before anything
const WALLED = [`${PRINT}/`, `${MILL}/`, `${PRINT}/find.html`, `${MILL}/find.html`, `${PRINT}/offer.html`, `${MILL}/offer.html`,
  `${OPPS}/`, `${APEX}/hub/account/`, `${APEX}/hub/account/settings/`];
const start = [{
  id: "start.checks", title: "Before anything", pass: "computer", needs: [],
  steps: [
    { id: "live", does: "Reads the live terms version, and the site's build if it publishes one",
      shows: "Terms 2.0 is live",
      run: async (ctx) => {
        if (!ctx.world.termsVersion) differs("the live terms version", "could not be read", "a version");
        if (!ctx.world.terms2) differs("the live terms version", ctx.world.termsVersion, "2.0, with a Seeker Agreement");
        return `build ${ctx.world.build || "not published by the live site"}; terms ${ctx.world.termsVersion}`;
      } },
    { id: "pages", does: "Opens the home page, the portal door, the terms and privacy pages as a stranger",
      shows: "Each page loads with its heading and no script errors",
      run: async (ctx) => {
        const w = ctx.lastWindow = await windowFor(ctx, "stranger");
        for (const url of [`${APEX}/`, `${APEX}/hub/`, `${APEX}/hub/terms/`, `${APEX}/hub/privacy.html`]) {
          await go(w.page, url);
          await w.page.locator("h1").first().waitFor({ state: "visible" }).catch(() => differs(url, "no heading showed", "the page's heading"));
          await w.page.waitForLoadState("networkidle").catch(() => {});
          if (w.page.url().split(/[?#]/)[0] !== url) differs(url, `went to ${w.page.url().split("?")[0]}`, "stayed on the page");
          pageErrors(w, url);
        }
      } },
    { id: "wall", does: "Opens every walled page as a stranger: both hub doors, both find forms, both listing forms, the board, the account page and its settings",
      shows: "Sent to the sign-in box each time, with the way back kept",
      run: async (ctx) => {
        const w = ctx.lastWindow = await windowFor(ctx, "stranger");
        for (const url of WALLED) {
          await go(w.page, url);
          await w.page.waitForURL(/\/hub\/\?signin=1/, { timeout: 25000 }).catch(() => differs(`the wall on ${url}`, w.page.url(), "/hub/?signin=1&return=…"));
          if (!w.page.url().includes(`return=${encodeURIComponent(url)}`)) differs("the way back", w.page.url(), `return=${url}`);
          await w.page.locator("#signOverlay.open").waitFor({ state: "visible" });
        }
      } },
  ],
}];

// ================================================================ 2 and 3. every way in
const signingIn = {
  id: "in.signin", title: "Every way in: signing in and out", pass: "computer", needs: ["seeker"],
  steps: [
    { id: "in", does: "Signs in as the seeker, then as the host when there is one", shows: "The name chip in the header; the live site names each ZZ company",
      run: async (ctx) => {
        await signIn(ctx, "seeker");
        if (!ctx.have.host) return "the seeker only: accounts.host is not filled in";
        await signIn(ctx, "host");
      } },
    { id: "out-in", does: "Signs out, then in again from a walled page", shows: "Back at the door; then returned to the page asked for",
      run: async (ctx) => {
        const w = await signIn(ctx, "seeker"), a = acct(ctx, "seeker");
        await signOut(w);
        await go(w.page, `${PRINT}/find.html`);
        await w.page.locator("#signOverlay.open").waitFor({ state: "visible", timeout: 25000 });
        await w.page.fill("#sEmail", a.email);
        await w.page.fill("#sPass", a.password);
        await w.page.click("#signContent button[type=submit]");
        await w.page.waitForURL(/printhub\.nexpoint\.co\.uk\/find/, { timeout: 20000 }).catch(() => differs("after signing in", w.page.url(), "the find page"));
        await w.page.locator("#findForm").waitFor({ state: "visible" });
        w.signedIn = true;
        await signIn(ctx, "seeker");          // proves again who the live site says this is
      } },
    { id: "wrong", does: "A wrong password, once", shows: "\"That email and password don't match an account\"",
      run: async (ctx) => {
        const w = ctx.lastWindow = await windowFor(ctx, "stranger");
        await go(w.page, `${APEX}/hub/?signin=1`);
        await w.page.locator("#signOverlay.open").waitFor({ state: "visible" });
        await w.page.fill("#sEmail", acct(ctx, "seeker").email);
        await w.page.fill("#sPass", `zz-wrong-${ctx.stamp}`);
        await w.page.click("#signContent button[type=submit]");
        await see(w.page, "#signContent .np-sign-error", /don.t match an account/, "the wrong-password line");
      } },
  ],
};

/* Registration, confirmation, closing and reopening, and a new password,
   all on the one new account, in this order: the new password comes last,
   because it is kept in this run's memory only. */
const registering = {
  id: REG, title: "Every way in: registering, closing and reopening, and a new password", pass: "computer", needs: ["new_account", "window"],
  steps: [
    { id: "register", once: true, does: "You register a new ZZ account in your own Chrome (the human check refuses an automated browser); the runner hands you the details",
      shows: "\"Check your inbox\"; the confirmation email arrives",
      run: async (ctx) => {
        const n = newcomer(ctx);
        await registerByHand(ctx, { url: `${APEX}/hub/?join=1`, what: `a new ZZ account, ${n.company}`, password: n.password, fields: [
          ["Your name", n.name], ["Company", n.company], ["Email", n.email], ["Country", n.country], ["Town", n.town]] });
        made(ctx).registeredAt = new Date().toISOString();
        ctx.cache.newcomerStamp = stampOf(ctx);
        ctx.did();
        ctx.mail.expect("Confirm your email (registration)", n.email, "Confirm your email");
        ctx.left.push(`the account ${n.company} (${n.email})`);
      } },
    { id: "resend", once: true, does: "Asks for the confirmation email again, once the site's two-minute pause has passed",
      shows: "\"A new link is on its way\"; a second confirmation email arrives",
      run: async (ctx) => {
        const n = reg(ctx), m = made(ctx);
        await waitOutCooldown(ctx, m.registeredAt || m.since, "a confirmation email");
        const asked = new Date(Date.now() - 2000).toISOString();
        let w = ctx.windows[`newcomer@${ctx.size}`];
        if (w && (await shows(w.page, "#npAccountContent [data-np-resend]", 1500))) {
          /* The card registration left on screen: its own Resend the email. */
          ctx.lastWindow = w;
          const sent = posted(w.page, "/auth/resend-confirmation");
          await w.page.click("#npAccountContent [data-np-resend]");
          if (!(await sent).ok()) differs("Resend the email", "the site refused it", "a new link sent");
          ctx.did();
          await see(w.page, "#npAccountContent [role=status]", "a new link is on its way", "after Resend the email");
        } else {
          /* A later run: the sign-in box offers the same, to an address not yet confirmed. */
          w = ctx.lastWindow = await windowFor(ctx, "stranger", { fresh: true });
          await go(w.page, `${APEX}/hub/?signin=1`);
          await w.page.locator("#signOverlay.open").waitFor({ state: "visible", timeout: 25000 });
          await w.page.fill("#sEmail", n.email);
          await w.page.fill("#sPass", n.password);
          await w.page.click("#signContent button[type=submit]");
          await see(w.page, "#signContent .np-sign-error", "Confirm your email first", "signing in before confirming", 20000);
          const sent = posted(w.page, "/auth/resend-confirmation");
          await w.page.click("#signContent .np-sign-resend button");
          if (!(await sent).ok()) differs("Send a new confirmation link", "the site refused it", "a new link sent");
          ctx.did();
          await see(w.page, "#signContent .np-sign-resend [role=status]", "a link is on its way", "after Send a new confirmation link");
        }
        ctx.mail.expect("Confirm your email (sent again)", n.email, "Confirm your email");
        const count = await mailCount(ctx, { to: n.email, subject: "Confirm your email", since: m.since, want: 2 });
        if (count === null) return "the second email is for you to check by hand: the runner cannot read that mailbox";
        if (count < 2) differs("confirmation emails in the mailbox", `${count}`, "2: the first and the one sent again");
        return `${count} confirmation emails arrived (asked again at ${asked.slice(11, 16)} UTC)`;
      } },
    { id: "confirm", once: true, does: "Opens the newest confirmation link (read from the mailbox, or pasted by you)",
      shows: "\"You're confirmed.\"; the account-ready email and the desk's \"Account created\" notice",
      run: async (ctx) => {
        const n = reg(ctx), w = ctx.lastWindow = await windowFor(ctx, "newcomer");
        /* Kept for the next step in this run only: a link is never written to the state file. */
        const link = ctx.cache.confirmLink = await emailLink(ctx, { to: n.email, subject: "Confirm your email", part: "/hub/confirm.html", what: "the newest confirmation email" });
        await go(w.page, link);
        ctx.did();
        await see(w.page, "#confirmBody", /You.re confirmed/, "the confirmation page", 30000);
        ctx.mail.expect("Your account is ready", n.email, "Your NexPoint hub account is ready");
        if (ctx.mail.s.desk) ctx.mail.expect("Desk notice: account created", ctx.mail.s.desk, "Account created:");
      } },
    { id: "twice", does: "Opens the same link again in a clean window", shows: "\"This link has been used or has expired.\"",
      run: async (ctx) => {
        if (!ctx.cache.confirmLink) skip("the link was opened on an earlier run and is not kept between runs");
        const w = ctx.lastWindow = await windowFor(ctx, "stranger", { fresh: true });
        await go(w.page, ctx.cache.confirmLink);
        await see(w.page, "#confirmBody", "used or has expired", "the link, opened twice", 30000);
      } },
    { id: "signed-in", does: "Signs in as the new account", shows: "The chip; the ZZ company",
      run: async (ctx) => { await signInHere(ctx, "newcomer", newcomerAccount(ctx)); } },

    // ---------------------------------------------------------------- 11. closing and reopening
    { id: "close", once: true, does: "Closes the new account from Settings: types its name and the password",
      shows: "Close this account stays greyed until the name is typed; then the account page",
      run: async (ctx) => {
        const a = newcomerAccount(ctx), w = await signInHere(ctx, "newcomer", a);
        mustBeZZ(a.company, "the account to close");
        await go(w.page, `${APEX}/hub/account/settings/`);
        await w.page.locator('#closing [data-act="close-open"]').waitFor({ state: "visible", timeout: 25000 })
          .catch(() => differs("the settings page", "no Close this account button", "Closing your account"));
        await w.page.click('#closing [data-act="close-open"]');
        await w.page.locator("#closeOverlay.open").waitFor({ state: "visible" });
        if (!(await w.page.locator("#closeGo").isDisabled())) differs("Close this account before the name is typed", "can be pressed", "greyed out");
        await w.page.fill("#closeName", a.company);
        await w.page.fill("#closePassword", a.password);
        if (await w.page.locator("#closeGo").isDisabled()) differs("Close this account with the name typed", "still greyed out", "can be pressed");
        const sent = posted(w.page, "/account/close");
        await w.page.click("#closeGo");
        if (!(await sent).ok()) differs("closing", await text(w.page, "#closeMsg").catch(() => "refused"), "closed");
        ctx.did();
        await w.page.waitForURL((u) => u.pathname === "/hub/account/", { timeout: 20000 }).catch(() => differs("after closing", w.page.url(), "the account page"));
        ctx.mail.expect("Your account is closed", a.email, "account is closed");
        if (ctx.mail.s.desk) ctx.mail.expect("Desk notice: account closed", ctx.mail.s.desk, `Account closed: ${a.company}`);
      } },
    { id: "closed", does: "While closed: the account page, a find form, a listing form and the board",
      shows: "\"You closed this account on …\" with Reopen; \"This account is closed\" on both hub forms and on the board",
      run: async (ctx) => {
        const w = await signInHere(ctx, "newcomer", newcomerAccount(ctx));
        await go(w.page, `${APEX}/hub/account/`);
        await see(w.page, "#acctError #acctClosed", "closed this account on", "the account page while closed", 25000);
        if (!(await shows(w.page, '#acctClosed [data-act="reopen"]'))) differs("the account page while closed", "no Reopen button", "Reopen your account");
        await go(w.page, `${PRINT}/find.html`);
        await see(w.page, "#findMount .acct-closed-notice", "This account is closed", "the 3D Print Hub find form while closed", 25000);
        await go(w.page, `${MILL}/offer.html`);
        await see(w.page, "#hostAppBody .acct-closed-notice", "This account is closed", "the Mill Hub listing form while closed", 25000);
        await go(w.page, `${OPPS}/`);
        await see(w.page, "#boardClosed", "This account is closed", "the board while closed", 25000);
      } },
    { id: "reopen", once: true, does: "Reopens it from the account page", shows: "The closed notice goes",
      run: async (ctx) => {
        const a = newcomerAccount(ctx), w = await signInHere(ctx, "newcomer", a);
        await go(w.page, `${APEX}/hub/account/`);
        const btn = '#acctClosed [data-act="reopen"]';
        await w.page.locator(btn).waitFor({ state: "visible", timeout: 25000 }).catch(() => differs("the account page", "no Reopen button", "Reopen your account"));
        const sent = posted(w.page, "/account/reopen");
        await w.page.click(btn);
        if (!(await sent).ok()) differs("reopening", await text(w.page, "#closedMsg").catch(() => "refused"), "open again");
        ctx.did();
        await w.page.locator("#acctClosed").waitFor({ state: "detached", timeout: 20000 }).catch(() => differs("after reopening", "the closed notice stayed", "gone"));
        ctx.mail.expect("Your account is open again", a.email, "account is open again");
        if (ctx.mail.s.desk) ctx.mail.expect("Desk notice: account reopened", ctx.mail.s.desk, `Account reopened: ${a.company}`);
      } },
    { id: "open-again", does: "Open again: the account page, a search on the 3D Print Hub, and the board",
      shows: "No closed notice; the search shows the sites that fit; the board shows no closed line",
      run: async (ctx) => {
        const w = await signInHere(ctx, "newcomer", newcomerAccount(ctx));
        await go(w.page, `${APEX}/hub/account/`);
        await w.page.locator("#profile:not([hidden])").waitFor({ state: "visible", timeout: 25000 });
        if (await shows(w.page, "#acctClosed", 1500)) differs("the account page after reopening", "still closed", "open");
        if (await w.page.locator("#profile .acct-badge", { hasText: "Closed" }).count()) differs("the account page after reopening", "a Closed badge", "none");
        await findForm(w, HUBS[0]);
        await search(w);
        await go(w.page, `${OPPS}/`);
        await w.page.locator("body[data-np-open]").waitFor({ state: "attached", timeout: 25000 });
        await w.page.waitForLoadState("networkidle").catch(() => {});
        if (await shows(w.page, "#boardClosed", 3000)) differs("the board after reopening", "This account is closed", "the board's cards");
      } },

    // ---------------------------------------------------------------- 3.4 a new password
    { id: "reset-ask", once: true, does: "Forgotten your password? for the new account", shows: "\"Check your inbox.\"; the reset email",
      run: async (ctx) => {
        const n = reg(ctx), w = ctx.lastWindow = await windowFor(ctx, "stranger", { fresh: true });
        await go(w.page, `${APEX}/hub/?signin=1`);
        await w.page.locator("#signOverlay.open").waitFor({ state: "visible", timeout: 25000 });
        await w.page.fill("#sEmail", n.email);
        const sent = posted(w.page, "/auth/reset-request");
        await w.page.getByText("Forgotten your password?").first().click();
        if ((await sent).ok()) ctx.did();
        await see(w.page, "#signContent", "Check your inbox", "after asking for a reset");
        ctx.mail.expect("Password reset", n.email, "Set a new password");
      } },
    { id: "reset-set", once: true, does: "Opens the reset link and sets a new password (made for this run, kept in memory only)",
      shows: "\"Your password is set.\"",
      run: async (ctx) => {
        const n = reg(ctx);
        const link = await emailLink(ctx, { to: n.email, subject: "Set a new password", part: "/hub/reset.html", what: "the reset email" });
        const w = ctx.lastWindow = await windowFor(ctx, "stranger", { fresh: true });
        await go(w.page, link);
        await w.page.locator("#pass1").waitFor({ state: "visible", timeout: 25000 });
        const fresh = `ZZ-${randomBytes(12).toString("base64url")}-7q`;
        await w.page.fill("#pass1", fresh);
        await w.page.fill("#pass2", fresh);
        const sent = posted(w.page, "/auth/reset-confirm");
        await w.page.click("#setBtn");
        const r = await sent;
        if (r.ok()) {
          made(ctx).passwordReset = true;
          ctx.cache.newcomerPassword = fresh;
          ctx.did();
        }
        await see(w.page, "#resetBody h1", "Your password is set", "the reset page", 20000);
      } },
    { id: "reset-check", does: "Signs in with the old password, then the new one, each in a clean window",
      shows: "The old one: \"don't match an account\". The new one: the chip, and the ZZ company",
      run: async (ctx) => {
        const n = reg(ctx), fresh = ctx.cache.newcomerPassword;
        if (!fresh) skip("the new password was set on an earlier run and is not kept between runs");
        const old = await trySignIn(ctx, "stranger", n.email, n.password);
        if (old.ok) differs("signing in with the old password", "signed in", "refused");
        if (!/don.t match an account/.test(old.error)) differs("signing in with the old password", old.error, "don't match an account");
        const now = await trySignIn(ctx, "stranger", n.email, fresh);
        if (!now.ok) differs("signing in with the new password", now.error, "the name chip");
        const company = now.me && now.me.member && now.me.member.company;
        if (!same(company, n.company)) differs("the account the new password opens", company, n.company);
      } },
  ],
};

/* 2.6: the engine adopts a new company into Contacts at its next run. */
const inContacts = {
  id: "in.contacts", title: "Every way in: the new account in the admin's Contacts", pass: "computer", needs: ["new_account", "admin", "window"],
  steps: [
    { id: "contacts", does: "Admin opens the new ZZ company from Contacts",
      shows: "Its page, with the new person tagged Portal user (waits if the engine has not adopted it yet)",
      run: async (ctx) => {
        const company = newcomerCompany(ctx), name = String(ctx.settings.new_account.name || "");
        mustBeZZ(name, "the new account's person");
        const w = await companyPage(ctx, company);
        const person = w.page.locator(".people .person", { has: w.page.locator(".person-name", { hasText: name }) }).first();
        await person.waitFor({ state: "visible", timeout: 20000 }).catch(() => wait(`${company} is in Contacts, but ${name} is not among its people yet`));
        if (!(await person.locator(".tag.mini", { hasText: "Portal user" }).count())) differs(`${name} on the company page`, "no Portal user tag", "Portal user");
      } },
  ],
};

// ================================================================ 4. the account's settings and people
const settings = {
  id: "settings.host", title: "Settings: the host's own details and the logo", pass: "computer", needs: ["host"],
  steps: [
    { id: "details", does: "Host edits their phone under You, saves, reloads; then puts it back",
      shows: "\"Saved.\"; the new phone after the reload; the old one again at the end",
      run: async (ctx) => {
        const w = await signIn(ctx, "host");
        await go(w.page, `${APEX}/hub/account/settings/`);
        await w.page.locator('#you [data-act="you-edit"]').waitFor({ state: "visible", timeout: 25000 });
        const before = await apiGet(w.page, "/account/profile");
        if (before.status !== 200 || !before.body || !before.body.profile) differs("the host's details", `the API answered ${before.status}`, "the profile");
        const original = String(before.body.profile.phone || "");
        const testPhone = `ZZ test ${ctx.stamp}`;
        const save = async (value) => {
          await w.page.click('#you [data-act="you-edit"]');
          await w.page.locator("#youEdit").waitFor({ state: "visible" });
          await w.page.fill("#youPhone", value);
          const sent = posted(w.page, "/account/profile");
          await w.page.click("#youSave");
          if (!(await sent).ok()) differs("Save your details", await text(w.page, "#youEditMsg").catch(() => "refused"), "Saved.");
          await see(w.page, "#youMsg", "Saved.", "after Save your details");
        };
        await save(testPhone);
        await w.page.reload({ waitUntil: "domcontentloaded" });
        await see(w.page, "#youCard .acct-facts", testPhone, "the You section after a reload", 25000);
        await save(original);
        return original ? "changed, and put back" : "changed, and emptied again (it was not given before)";
      } },
    { id: "logo", does: "Host adds a logo (a small test picture), sees it on Settings and the account page, then removes it",
      shows: "The picture in place of the initials, Remove logo; after removing, the initials again on both pages",
      run: async (ctx) => {
        const w = await signIn(ctx, "host");
        const loaded = (sel) => w.page.waitForFunction((s) => { const i = document.querySelector(s); return !!i && i.complete && i.naturalWidth > 0; }, sel, { timeout: 20000 });
        await go(w.page, `${APEX}/hub/account/settings/`);
        await w.page.locator('#logo [data-act="logo-pick"]').waitFor({ state: "visible", timeout: 25000 })
          .catch(() => differs("the settings page", "no Logo section", "Add a logo"));
        if (await w.page.locator('#logo [data-act="logo-remove"]').isVisible()) skip("the host has a logo already; the step would replace it");
        const sent = posted(w.page, "/account/logo");
        await w.page.setInputFiles("#logoFile", { name: "zz-test-logo.png", mimeType: "image/png", buffer: PNG });
        if (!(await sent).ok()) differs("adding the logo", await text(w.page, "#logoMsg").catch(() => "refused"), "the logo");
        await loaded("#logoPic img").catch(() => differs("the logo on Settings", "no picture showed", "the picture"));
        if (!(await shows(w.page, '#logo [data-act="logo-remove"]'))) differs("after adding the logo", "no Remove logo", "Remove logo");
        await go(w.page, `${APEX}/hub/account/`);
        await w.page.locator("#profile:not([hidden])").waitFor({ state: "visible", timeout: 25000 });
        await loaded("#acctPic img").catch(() => differs("the logo on the account page", "the initials", "the picture"));
        await go(w.page, `${APEX}/hub/account/settings/`);
        await w.page.locator('#logo [data-act="logo-remove"]').waitFor({ state: "visible", timeout: 25000 });
        const gone = posted(w.page, "/account/logo/remove");
        await w.page.click('#logo [data-act="logo-remove"]');
        if (!(await gone).ok()) differs("removing the logo", await text(w.page, "#logoMsg").catch(() => "refused"), "removed");
        await w.page.locator("#logoPic .acct-mono").waitFor({ state: "visible", timeout: 15000 }).catch(() => differs("Settings after removing", "still a picture", "the initials"));
        await go(w.page, `${APEX}/hub/account/`);
        await w.page.locator("#profile:not([hidden])").waitFor({ state: "visible", timeout: 25000 });
        await w.page.waitForLoadState("networkidle").catch(() => {});
        if (await w.page.locator("#acctPic img").count()) differs("the account page after removing", "still a picture", "the initials");
      } },
  ],
};

const joining = {
  id: "in.join", title: "People: invite and withdraw, join, change email, remove", pass: "computer", needs: ["host", "new_account"],
  steps: [
    // ---------------------------------------------------------------- 4.3 invite, then withdraw
    { id: "invite-first", once: true, does: "The host invites a new ZZ user from Settings, to withdraw it", shows: "\"Invitation sent to …\"; the invitation email",
      run: async (ctx) => {
        const n = invitee(ctx);
        await invite(ctx, n.email);
        ctx.mail.expect("Invitation to join (the one withdrawn)", n.email, "has invited you to");
      } },
    { id: "withdraw", once: true, does: "Withdraws that invitation under Invitations waiting", shows: "The invitation goes from the list",
      run: async (ctx) => {
        const n = invitee(ctx), w = await signIn(ctx, "host");
        await go(w.page, `${APEX}/hub/account/settings/`);
        await w.page.locator("#users:not([hidden])").waitFor({ state: "visible", timeout: 25000 });
        await w.page.waitForLoadState("networkidle").catch(() => {});
        const id = await nearest(w.page, '#users [data-act="invite-withdraw"]', n.email, "invite");
        if (!id) differs("Invitations waiting", "no Withdraw for that address", n.email);
        const sent = posted(w.page, "/account/invites/withdraw");
        await w.page.click(`#users [data-act="invite-withdraw"][data-invite="${id}"]`);
        if (!(await sent).ok()) differs("withdrawing", await text(w.page, "#usersMsg").catch(() => "refused"), "withdrawn");
        ctx.did();
        await w.page.locator(`#users [data-act="invite-withdraw"][data-invite="${id}"]`).waitFor({ state: "detached", timeout: 15000 })
          .catch(() => differs("Invitations waiting after withdrawing", "still listed", "gone"));
      } },
    { id: "withdrawn-link", once: true, does: "Opens the withdrawn invitation's link in a clean window",
      shows: "\"This invitation has been used or has expired.\"",
      run: async (ctx) => {
        const n = invitee(ctx);
        const link = await emailLink(ctx, { to: n.email, subject: "has invited you to", part: "/hub/invite.html", what: "the withdrawn invitation" });
        const w = ctx.lastWindow = await windowFor(ctx, "stranger", { fresh: true });
        await go(w.page, link);
        await see(w.page, "#inviteBody h1", "used or has expired", "the withdrawn invitation's page", 30000);
      } },

    // ---------------------------------------------------------------- 4.4 invite again, join, confirm
    { id: "invite", once: true, does: "The host invites the same address again", shows: "\"Invitation sent to …\"; a second invitation email",
      run: async (ctx) => {
        const n = invitee(ctx);
        /* The join step opens only an invitation sent after this moment, not the withdrawn one. */
        made(ctx).invitedAt = new Date(Date.now() - 2000).toISOString();
        await invite(ctx, n.email);
        ctx.mail.expect("Invitation to join", n.email, "has invited you to");
      } },
    { id: "join", once: true, does: "Opens the new invitation and joins", shows: "\"Join <ZZ host>\"; then \"Check your inbox.\"",
      run: async (ctx) => {
        const n = invitee(ctx), w = ctx.lastWindow = await windowFor(ctx, "joiner");
        const link = await linkSince(ctx, { to: n.email, subject: "has invited you to", part: "/hub/invite.html", what: "the second invitation email", since: made(ctx).invitedAt });
        await go(w.page, link);
        const head = await see(w.page, "h1", "Join", "the invitation page", 30000);
        if (!head.toLowerCase().includes(acct(ctx, "host").company.toLowerCase())) throw new Refused("refused: the invitation is not to the ZZ host's account");
        await w.page.fill("#invName", joinerName(ctx));
        await w.page.locator("#invPass").pressSequentially(n.password);
        await w.page.locator("#invTick").waitFor({ state: "visible" });
        await w.page.check("#invTick");
        const sent = posted(w.page, "/auth/register-invited");
        await w.page.click("#joinBtn:not([disabled])");
        if ((await sent).ok()) ctx.did();
        await see(w.page, "h1", "Check your inbox", "after joining", 30000);
      } },
    { id: "join-confirm", once: true, does: "Confirms the invited user's address", shows: "\"You're confirmed.\"",
      run: async (ctx) => {
        const n = invitee(ctx), w = ctx.lastWindow = await windowFor(ctx, "joiner");
        await go(w.page, await emailLink(ctx, { to: n.email, subject: "Confirm your email", part: "/hub/confirm.html", what: "the invited user's confirmation email" }));
        ctx.did();
        await see(w.page, "#confirmBody", /You.re confirmed/, "the confirmation page", 30000);
      } },

    // ---------------------------------------------------------------- 4.5 the joined user changes email
    { id: "joiner-in", does: "Signs in as the invited user", shows: "The chip; the live site names the ZZ host's company",
      run: async (ctx) => {
        if (made(ctx).emailChanged) skip("this user's email was changed on an earlier run; the next steps sign in with the new one");
        await signInHere(ctx, "joiner", joinerAccount(ctx));
      } },
    { id: "email-change", once: true, does: "The invited user asks, under You, to sign in with a new address (current password given)",
      shows: "\"A link is waiting at …\"; the link to the new address, a notice to the current one",
      run: async (ctx) => {
        const next = changedAddress(ctx), a = joinerAccount(ctx), w = await signInHere(ctx, "joiner", a);
        await go(w.page, `${APEX}/hub/account/settings/`);
        await w.page.locator('#you [data-act="you-email"]').waitFor({ state: "visible", timeout: 25000 });
        await w.page.click('#you [data-act="you-email"]');
        await w.page.locator("#youEmail").waitFor({ state: "visible" });
        await w.page.fill("#youNewEmail", next);
        await w.page.fill("#youPassword", a.password);
        const sent = posted(w.page, "/account/email");
        await w.page.click("#youEmailSend");
        if (!(await sent).ok()) differs("asking to change the address", await text(w.page, "#youEmailMsg").catch(() => "refused"), "a link sent");
        ctx.did();
        await see(w.page, "#youPending", "A link is waiting at", "the You section after asking");
        ctx.mail.expect("Email change: the link, to the new address", next, "Confirm the new email address");
        ctx.mail.expect("Email change: the notice, to the current address", a.email, "Someone asked to change");
      } },
    { id: "email-confirm", once: true, does: "Opens the link sent to the new address, in a clean window", shows: "\"Your email address is changed.\"",
      run: async (ctx) => {
        const next = changedAddress(ctx), old = joinerAccount(ctx).email;
        const link = await emailLink(ctx, { to: next, subject: "Confirm the new email address", part: "/hub/email.html", what: "the email-change link" });
        const w = ctx.lastWindow = await windowFor(ctx, "stranger", { fresh: true });
        const sent = posted(w.page, "/account/email/confirm");
        await go(w.page, link);
        if ((await sent).ok()) { made(ctx).emailChanged = true; ctx.did(); }
        await see(w.page, "#emailBody h1", "Your email address is changed", "the email-change page", 30000);
        ctx.mail.expect("Email change: done, to the old address", old, "email address has changed");
      } },
    { id: "new-email-in", does: "Signs in with the old address, then the new one, each in a clean window",
      shows: "The old one: \"don't match an account\". The new one: the chip, and the ZZ host's company",
      run: async (ctx) => {
        const next = changedAddress(ctx), a = joinerAccount(ctx);
        const old = await trySignIn(ctx, "stranger", a.email, a.password);
        if (old.ok) differs("signing in with the old address", "signed in", "refused");
        const now = await trySignIn(ctx, "stranger", next, a.password);
        if (!now.ok) differs("signing in with the new address", now.error, "the name chip");
        const company = now.me && now.me.member && now.me.member.company;
        if (!(same(company, a.company) && isZZ(company))) differs("the account the new address opens", company, a.company);
      } },

    // ---------------------------------------------------------------- 4.6 the host removes the user
    { id: "remove", once: true, does: "The host removes that user again (its login is deleted)", shows: "\"<name> has been removed.\"",
      run: async (ctx) => {
        const name = joinerName(ctx), w = await signIn(ctx, "host");
        mustBeZZ(name, "the user to remove");
        await go(w.page, `${APEX}/hub/account/settings/`);
        await w.page.locator("#users").waitFor({ state: "visible" });
        await w.page.waitForLoadState("networkidle").catch(() => {});
        const user = await nearest(w.page, '#users [data-act="user-remove"]', name, "user");
        if (!user) differs("the invited user on Settings", "not listed with a Remove button", name);
        const sent = posted(w.page, "/account/users/remove");
        await w.page.click(`#users [data-act="user-remove"][data-user="${user}"]`);
        if (!(await sent).ok()) differs("removing the user", await text(w.page, "#usersMsg").catch(() => "refused"), "removed");
        ctx.did();
        await see(w.page, "#usersMsg", "has been removed", "after removing the user");
      } },
  ],
};

const waysIn = [signingIn, registering, settings, joining, inContacts];

// ================================================================ 10. Terms 2.0
const terms = [{
  /* Will, 12 November 2026 (the code audit's decision B; website #226): the
     box "Our Platform Terms have changed" is gone. The Platform Terms are
     accepted when an account is made or joined by invitation, and nowhere
     else, so an account still on 1.3 signs in and meets nothing. Until that
     day this journey waited for the box, accepted it once and looked for it
     never to come back. */
  id: "terms.platform", title: "Terms 2.0: no box for the Platform Terms at sign-in", pass: "computer", needs: ["terms2", "veteran"],
  from: "plan 078, W5 (queue DH9); Will's decision B of 12 November 2026",
  steps: [
    { id: "no-box", does: "Veteran signs in", shows: "No \"Our Platform Terms have changed\" box",
      run: async (ctx) => {
        const w = await signIn(ctx, "veteran");
        if (await shows(w.page, "#npTermsGate", 4000)) differs("signing in on the veteran account", "the box \"Our Platform Terms have changed\"", "no box");
        const t = await termsOf(w, "platform");
        return t && t.accepted ? "no box (this account already holds Platform Terms 2.0, so the check proves less than it would on 1.3)"
          : "no box, on an account that has not accepted Platform Terms 2.0";
      } },
    { id: "never-again", does: "Reloads, then signs out and in", shows: "No box, either time",
      run: async (ctx) => {
        const w = await signIn(ctx, "veteran");
        await go(w.page, `${APEX}/hub/account/`);
        await w.page.locator("body[data-np-open]").waitFor({ state: "attached", timeout: 25000 });
        if (await shows(w.page, "#npTermsGate", 4000)) differs("after a reload", "the box", "no box");
        await signOut(w);
        await signIn(ctx, "veteran");
        if (await shows(w.page, "#npTermsGate", 4000)) differs("after signing in again", "the box", "no box");
      } },
  ],
}, {
  id: "terms.rest", title: "Terms 2.0: each agreement once, and a copy everywhere", pass: "computer", needs: ["terms2", "host", "seeker"],
  from: "plan 078, W5 (queue DH9)",
  steps: [
    { id: "seeker-twice", does: "Seeker searches twice on the 3D Print Hub (nothing is sent)",
      shows: "The Seeker Agreement the first time if not yet accepted; never the second time",
      run: async (ctx) => {
        const w = await signIn(ctx, "seeker"), h = HUBS[0];
        const before = await termsOf(w, "seeker");
        await findForm(w, h);
        await w.page.click("#findSubmit");
        const gate = await shows(w.page, "#stepTerms", 6000);
        if (before && before.accepted && gate) differs("a seeker who already holds the Seeker Agreement", "asked again", "straight to the sites");
        if (before && !before.accepted && !gate) differs("a seeker's first search", "no agreement shown", "the Seeker Agreement");
        if (gate) {
          await see(w.page, "#stepTerms", "Seeker Agreement", "the agreement shown");
          await pdfOk(ctx, w, await w.page.getAttribute("#searchTermsBlock a.np-terms-dl", "href"), "the Seeker Agreement");
          await w.page.check("#searchTick");
          await w.page.click("#searchAccept");
        }
        await w.page.locator("#step2:not([hidden])").waitFor({ state: "visible", timeout: 30000 });
        await findForm(w, h);
        if (await search(w)) differs("the second search", "the agreement again", "straight to the sites");
        return gate ? "shown once, then never" : "already held: not shown either time";
      } },
    { id: "host-held", does: "Host opens the listing form on both hubs", shows: "\"Your Host Agreement v2.0 still applies\", Read it, Download a copy",
      run: async (ctx) => {
        const w = await signIn(ctx, "host");
        for (const h of HUBS) {
          await go(w.page, `${h.base}/offer.html`);
          await w.page.locator("#hostTermsBlock").waitFor({ state: "visible", timeout: 25000 })
            .catch(() => differs(`the ${h.name} listing form`, "no terms block (is the listing under review?)", "the Host Agreement line"));
          /* A host that has not listed yet is shown the tick, not the line: it accepts at its
             first listing (hubs.print), so on a first run this step waits for the next one. */
          if (!(await shows(w.page, "#hostTermsBlock .np-terms-held", 4000)) && (await shows(w.page, "#hostTick", 1500)))
            wait(`the ${h.name} form still shows the tick: the ZZ host accepts the Host Agreement at its first listing (hubs.print)`);
          await see(w.page, "#hostTermsBlock .np-terms-held", "still applies", `the ${h.name} listing form`);
          await pdfOk(ctx, w, await w.page.getAttribute("#hostTermsBlock a.np-terms-dl", "href"), "the Host Agreement");
        }
      } },
    { id: "pdfs", does: "Each Download a copy link", shows: "A PDF, for all three documents",
      run: async (ctx) => {
        const w = await signIn(ctx, "seeker");
        for (const layer of ["platform", "host", "seeker"]) {
          const cur = await apiGet(w.page, `/terms/current?layer=${layer}`);
          if (cur.status !== 200) differs(`the current ${layer} document`, cur.status, 200);
          await pdfOk(ctx, w, `${API}/terms/${layer}/${cur.body.version}.pdf`, `the ${layer} document`);
        }
        const old = await apiGet(w.page, "/terms/current?layer=opportunity");
        if (old.status !== 422) differs("the retired Opportunity Terms", old.status, 422);
      } },
    { id: "your-terms", does: "Host and seeker open the account page", shows: "\"Your terms\", three rows, each with its version and a copy",
      run: async (ctx) => {
        for (const role of ["host", "seeker"]) {
          const w = await signIn(ctx, role);
          await go(w.page, `${APEX}/hub/account/`);
          await w.page.locator("#yourTerms").waitFor({ state: "visible", timeout: 25000 }).catch(() => differs(`the ${role}'s account page`, "no Your terms section", "Your terms"));
          for (const layer of ["platform", "host", "seeker"]) {
            const row = `#yourTerms .acct-row[data-terms-layer="${layer}"]`;
            if (!(await shows(w.page, `${row} a.acct-terms-dl`))) differs(`the ${role}'s Your terms`, `no ${layer} row with a copy`, "three rows");
          }
          await see(w.page, '#yourTerms .acct-row[data-terms-layer="platform"]', /Version \d/, `the ${role}'s Platform Terms line`);
        }
      } },
    { id: "terms-page", does: "The terms page", shows: "Three documents, each with a version and Download a copy",
      run: async (ctx) => {
        const w = ctx.lastWindow = await windowFor(ctx, "stranger");
        await go(w.page, `${APEX}/hub/terms/`);
        for (const layer of ["platform", "host", "seeker"]) {
          await see(w.page, `section.terms-doc#${layer} [data-terms-meta]`, /Version \d/, `the ${layer} document on the terms page`, 25000);
          if (!(await shows(w.page, `section.terms-doc#${layer} [data-terms-meta] a`))) differs(`the ${layer} document`, "no Download a copy", "a copy");
        }
      } },
    { id: "board-forms", does: "The board's post form, as the host (nothing is sent)", shows: "The Host Agreement for an offer, or nothing once held; never the Opportunity Terms",
      run: async (ctx) => {
        const w = await signIn(ctx, "host");
        await go(w.page, `${OPPS}/`);
        await w.page.locator("body[data-np-open]").waitFor({ state: "attached", timeout: 25000 });
        await w.page.click("#post button.btn-primary");
        await see(w.page, "#formContent [data-post-terms]", "Choose what this post is", "before a direction is chosen");
        await w.page.locator('#formContent input[name=direction][value="Offering New Opportunities"]').check({ force: true });
        await w.page.waitForLoadState("networkidle").catch(() => {});
        const words = await text(w.page, "#formContent [data-post-terms]");
        if (/Opportunity Terms/.test(words)) differs("the post form's terms", "the Opportunity Terms", "the Host Agreement, or nothing");
        if (words && !/Host Agreement/.test(words)) differs("the post form's terms for an offer", words.slice(0, 80), "the Host Agreement");
        await w.page.keyboard.press("Escape");
      } },
  ],
}];

export const WAYS_IN = [].concat(start, waysIn, terms);

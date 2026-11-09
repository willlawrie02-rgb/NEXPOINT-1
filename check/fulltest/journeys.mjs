// The full test's script: every journey, in order, each step with what the
// runner does and what it should show. The design and this list are kept in
// step with docs/superpowers/specs/2026-11-05-full-test-runner-design.md in
// the workspace repository.
//
// The page elements used here are the ones the scripted walk (check/walk.mjs)
// already drives; the Terms 2.0 ones are from the terms screens' own branch.
import { APEX, PRINT, MILL, OPPS, API, Refused, Soft, mustBeZZ, isZZSlug, differs, wait, skip, askEnter, askLine } from "./core.mjs";
import { windowFor, go, see, shows, text, whoAmI, apiGet, signIn, signOut, adminWindow, adminGo, saveVia, wantDirect, ADMIN } from "./browser.mjs";

const same = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
const made = (ctx) => (ctx.state.made[ctx.current.key] = ctx.state.made[ctx.current.key] || {});
const acct = (ctx, role) => ctx.settings.accounts[role];
const today = () => new Date().toISOString().slice(0, 10);
const MARK = "ZZ full test";
/* A run's own stamp, kept with the journey so a later run uses the same names. */
const stampOf = (ctx) => { const m = made(ctx); m.stamp = m.stamp || ctx.stamp; m.since = m.since || new Date().toISOString(); return m.stamp; };
function newcomer(ctx, key = "email") {
  const n = ctx.settings.new_account, stamp = stampOf(ctx);
  const company = String(n.company || "ZZ Full Test {stamp}").replace("{stamp}", stamp);
  mustBeZZ(company, "the new account's company");
  return { company, name: n.name, email: String(n[key]).replace("{stamp}", stamp.toLowerCase()), password: n.password,
    town: n.town || "Leeds", country: n.country || "United Kingdom" };
}
const pageErrors = (w, what) => {
  const e = w.errors.splice(0);
  if (e.length) differs(`${what}: script errors`, e.join(" | "), "none");
};
/* A typeahead field: type, then Return commits the value. */
async function typeahead(page, selector, value) {
  await page.fill(selector, value);
  await page.press(selector, "Enter");
}
const fillIfEmpty = async (page, selector, value) => { if (!(await page.inputValue(selector)).trim()) await page.fill(selector, value); };
/* The link in an email: read from the mailbox when the runner may, pasted
   by the operator when it may not. Only ever a page of ours. */
async function emailLink(ctx, { to, subject, part, what }) {
  let link = "";
  const box = ctx.mail.on ? ctx.mail.boxFor(to) : "";
  if (box) {
    /* Looked for from when this journey began, which may be an earlier run. */
    const m = await ctx.mail.waitFor(box, { to, subject, since: made(ctx).since });
    if (!m) differs(`${what}, sent to ${to}`, "no such email in the mailbox after 90 seconds", subject);
    link = await ctx.mail.linkIn(box, m.id, part);
    if (!link) differs(`the link in ${what}`, "no link to that page in the email", part);
  } else {
    if (ctx.args.headless) skip(`the link is in an email to ${to}, which the runner cannot read`);
    link = await askLine(`Open ${what}, sent to ${to}, copy its button's link`);
    if (!link) skip("no link was pasted");
  }
  let u; try { u = new URL(link); } catch { throw new Refused("refused: that is not a web address"); }
  if (u.origin !== APEX || !u.pathname.includes(part)) throw new Refused(`refused: the link does not open ${APEX}${part}`);
  return u.href;
}
/* A Download a copy link gives a PDF. */
async function pdfOk(ctx, w, href, what) {
  if (!String(href || "").startsWith(`${API}/terms/`)) differs(`${what}: the link`, href, `${API}/terms/<document>/<version>.pdf`);
  const r = await w.context.request.get(href);
  const head = (await r.body()).subarray(0, 4).toString("latin1");
  if (!r.ok() || !/application\/pdf/.test(r.headers()["content-type"] || "") || head !== "%PDF") {
    differs(`${what}: the download`, `${r.status()} ${r.headers()["content-type"] || ""}`, "a PDF");
  }
}
/* The button on the smallest box that carries these words and holds only that
   one button; answers the button's data-<key>, or "". So a button is never
   matched to the words of the row beside it. */
const nearest = (page, selector, words, key) => page.evaluate(([sel, want, k]) => {
  for (const b of document.querySelectorAll(sel)) {
    let box = b.parentElement;
    while (box && box !== document.body && box.querySelectorAll(sel).length === 1) {
      if (box.textContent.includes(want)) return b.dataset[k] || "";
      box = box.parentElement;
    }
  }
  return "";
}, [selector, words, key]);
const termsOf = (w, layer) => whoAmI(w.page).then((me) => (me && me.terms && me.terms[layer]) || null);

// ================================================================ 1. before anything
const start = [{
  id: "start.checks", title: "Before anything", pass: "computer", needs: [],
  steps: [
    { id: "live", does: "Reads the live terms version, and the site's build if it publishes one",
      shows: "A version (1.3 today, 2.0 after the switch)",
      run: async (ctx) => {
        if (!ctx.world.termsVersion) differs("the live terms version", "could not be read", "a version");
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
    { id: "wall", does: "Opens the walled pages (both hub doors, find capacity, the board) as a stranger",
      shows: "Sent to the sign-in box each time, with the way back kept",
      run: async (ctx) => {
        const w = ctx.lastWindow = await windowFor(ctx, "stranger");
        for (const url of [`${PRINT}/`, `${MILL}/`, `${PRINT}/find.html`, `${OPPS}/`]) {
          await go(w.page, url);
          await w.page.waitForURL(/\/hub\/\?signin=1/, { timeout: 25000 }).catch(() => differs(`the wall on ${url}`, w.page.url(), "/hub/?signin=1&return=…"));
          if (!w.page.url().includes(`return=${encodeURIComponent(url)}`)) differs("the way back", w.page.url(), `return=${url}`);
          await w.page.locator("#signOverlay.open").waitFor({ state: "visible" });
        }
      } },
  ],
}];

// ================================================================ 2. every way in
const waysIn = [{
  id: "in.signin", title: "Every way in: signing in and out", pass: "computer", needs: ["seeker"],
  steps: [
    { id: "in", does: "Signs in as the seeker", shows: "The name chip in the header; the live site names the ZZ company",
      run: async (ctx) => { await signIn(ctx, "seeker"); } },
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
    { id: "reset", does: "Asks for a password reset for the seeker (does not finish it)", shows: "\"Check your inbox.\"; the reset email arrives",
      run: async (ctx) => {
        const w = ctx.lastWindow = await windowFor(ctx, "stranger");
        await go(w.page, `${APEX}/hub/?signin=1`);
        await w.page.locator("#signOverlay.open").waitFor({ state: "visible" });
        await w.page.fill("#sEmail", acct(ctx, "seeker").email);
        await w.page.getByText("Forgotten your password?").first().click();
        await see(w.page, "#signContent", "Check your inbox", "after asking for a reset");
        ctx.mail.expect("Password reset", acct(ctx, "seeker").email, "Set a new password");
      } },
  ],
}, {
  id: "in.register", title: "Every way in: registering", pass: "computer", needs: ["new_account", "window"],
  steps: [
    { id: "register", once: true, does: "Registers a new ZZ account (waits for the human check; asks you if it does not clear)",
      shows: "\"Check your inbox\"; nobody is signed in yet",
      run: async (ctx) => {
        const n = newcomer(ctx), w = ctx.lastWindow = await windowFor(ctx, "newcomer");
        await go(w.page, `${APEX}/hub/?join=1`);
        await w.page.locator('form[data-np-step="1"]').waitFor({ state: "visible" });
        await w.page.fill("#qName", n.name);
        await w.page.fill("#qCompany", n.company);
        await w.page.fill("#qEmail", n.email);
        await w.page.locator("#qPass").pressSequentially(n.password);
        await w.page.click("#npAccountContent button[type=submit]");
        await w.page.locator('form[data-np-step="2"]').waitFor({ state: "visible" });
        await w.page.fill("#qCountry", n.country);
        await w.page.fill("#qTown", n.town);
        await w.page.locator("#qTerms").waitFor({ state: "visible" });
        await w.page.check("#qTerms");
        /* The human check is Cloudflare's. The runner never touches it: it
           waits for it to clear, and asks the person at the keyboard if not. */
        const ready = 'form[data-np-step="2"] button[type=submit]:not([disabled])';
        if (!(await shows(w.page, ready, 45000))) {
          await w.page.bringToFront().catch(() => {});
          if (!(await askEnter("The \"are you human\" check has not cleared. Complete it in the Chrome window."))) skip("the human check was left");
          await w.page.locator(ready).waitFor({ state: "visible", timeout: 5 * 60 * 1000 });
        }
        const sent = w.page.waitForResponse((r) => r.url() === `${API}/auth/register`, { timeout: 30000 });
        await w.page.click(ready);
        if ((await sent).ok()) ctx.did();
        await see(w.page, "#npAccountContent .success", "Check your inbox", "after registering", 30000);
        const me = await whoAmI(w.page);
        if (me && me.signed_in) differs("before confirming", "signed in already", "nobody signed in");
        ctx.mail.expect("Confirm your email (registration)", n.email, "Confirm your email");
        ctx.left.push(`the account ${n.company} (${n.email})`);
      } },
    { id: "confirm", once: true, does: "Opens the confirmation link (read from the mailbox, or pasted by you)",
      shows: "\"You're confirmed.\"; the account-ready email and the desk's \"Account created\" notice",
      run: async (ctx) => {
        const n = newcomer(ctx), w = ctx.lastWindow = await windowFor(ctx, "newcomer");
        /* Kept for the next step in this run only: a link is never written to the state file. */
        const link = ctx.cache.confirmLink = await emailLink(ctx, { to: n.email, subject: "Confirm your email", part: "/hub/confirm.html", what: "the confirmation email" });
        await go(w.page, link);
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
      run: async (ctx) => { await signIn(ctx, "newcomer", { account: newcomer(ctx) }); } },
  ],
}, {
  id: "in.join", title: "Every way in: joining by invitation", pass: "computer", needs: ["host", "new_account"],
  steps: [
    { id: "invite", once: true, does: "The host invites a new ZZ user from Settings", shows: "\"Invitation sent to …\"; the invitation email",
      run: async (ctx) => {
        const n = newcomer(ctx, "invite_email"), w = await signIn(ctx, "host");
        if (!n.email) skip("new_account.invite_email is not filled in");
        await go(w.page, `${APEX}/hub/account/settings/`);
        await w.page.fill("#inviteEmail", n.email);
        const sent = w.page.waitForResponse((r) => r.url() === `${API}/account/invites` && r.request().method() === "POST", { timeout: 30000 });
        await w.page.click("#inviteSend");
        if ((await sent).ok()) ctx.did();
        await see(w.page, "#inviteMsg", "Invitation sent to", "after inviting");
        ctx.mail.expect("Invitation to join", n.email, "has invited you to");
      } },
    { id: "join", once: true, does: "Opens the invitation and joins", shows: "\"Join <ZZ host>\"; then \"Check your inbox.\"",
      run: async (ctx) => {
        const n = newcomer(ctx, "invite_email"), w = ctx.lastWindow = await windowFor(ctx, "joiner");
        const link = await emailLink(ctx, { to: n.email, subject: "has invited you to", part: "/hub/invite.html", what: "the invitation email" });
        await go(w.page, link);
        const head = await see(w.page, "h1", "Join", "the invitation page", 30000);
        if (!head.toLowerCase().includes(acct(ctx, "host").company.toLowerCase())) throw new Refused("refused: the invitation is not to the ZZ host's account");
        await w.page.fill("#invName", `${n.name} Joiner`);
        await w.page.locator("#invPass").pressSequentially(n.password);
        await w.page.locator("#invTick").waitFor({ state: "visible" });
        await w.page.check("#invTick");
        const sent = w.page.waitForResponse((r) => r.url() === `${API}/auth/register-invited`, { timeout: 30000 });
        await w.page.click("#joinBtn:not([disabled])");
        if ((await sent).ok()) ctx.did();
        await see(w.page, "h1", "Check your inbox", "after joining", 30000);
      } },
    { id: "join-confirm", once: true, does: "Confirms the invited user's address", shows: "\"You're confirmed.\"",
      run: async (ctx) => {
        const n = newcomer(ctx, "invite_email"), w = ctx.lastWindow = await windowFor(ctx, "joiner");
        await go(w.page, await emailLink(ctx, { to: n.email, subject: "Confirm your email", part: "/hub/confirm.html", what: "the invited user's confirmation email" }));
        await see(w.page, "#confirmBody", /You.re confirmed/, "the confirmation page", 30000);
      } },
    { id: "remove", does: "The host removes that user again", shows: "\"<name> has been removed.\"",
      run: async (ctx) => {
        const name = `${newcomer(ctx, "invite_email").name} Joiner`, w = await signIn(ctx, "host");
        mustBeZZ(name, "the user to remove");
        await go(w.page, `${APEX}/hub/account/settings/`);
        await w.page.locator("#users").waitFor({ state: "visible" });
        await w.page.waitForLoadState("networkidle").catch(() => {});
        const user = await nearest(w.page, '#users [data-act="user-remove"]', name, "user");
        if (!user) differs("the invited user on Settings", "not listed with a Remove button", name);
        await w.page.click(`#users [data-act="user-remove"][data-user="${user}"]`);
        await see(w.page, "#usersMsg", "has been removed", "after removing the user");
      } },
  ],
}, {
  id: "in.consultancy", title: "Every way in: the consultancy sign-up (never signed)", pass: "computer", needs: ["admin", "host", "window"],
  steps: [
    { id: "link", once: true, does: "Admin: makes a consultancy link for the ZZ host's folder, at your own address", shows: "\"Link ready\"",
      run: async (ctx) => {
        const a = acct(ctx, "host");
        if (!isZZSlug(a.folder)) skip("accounts.host.folder is not filled in (the company's zz- folder name)");
        const w = await adminGo(ctx, "consultancy.html");
        const ids = () => w.page.locator('[id^="link-"]').evaluateAll((els) => els.map((e) => e.id));
        const before = await ids();
        await w.page.fill("#f-slug", a.folder);
        await w.page.fill("#f-client", a.company);
        await w.page.fill("#f-address", "ZZ test address: not a real agreement");
        await w.page.fill("#f-signer", "ZZ Full Test");
        await w.page.fill("#f-email", ctx.settings.admin.email);
        await w.page.click("#f-submit");
        await see(w.page, "#given-title", "Link ready", "after making the link", 30000);
        ctx.did();
        /* The new link's row is the one that was not there before. Its number is
           kept; its address opens a real agreement, so it stays in memory only. */
        const mine = (await ids()).filter((id) => !before.includes(id));
        if (mine.length === 1) made(ctx).link = mine[0];
        ctx.left.push(`a consultancy link for ${a.company} (the runner revokes it)`);
        const url = await w.page.inputValue("#given-url");
        if (!/^https:\/\/nexpoint\.co\.uk\/sign\/\?t=[0-9a-f]{64}$/.test(url)) differs("the link", url.replace(/[0-9a-f]{56}$/, "…"), `${APEX}/sign/?t=…`);
        if (mine.length !== 1) differs("the new link's row", `${mine.length} new rows`, "one");
        ctx.cache.signUrl = url;
      } },
    { id: "read", does: "Opens the link", shows: "\"Welcome, <ZZ company>.\"; the retainer line; Sign is greyed out. Never signed",
      run: async (ctx) => {
        if (!ctx.cache.signUrl) skip("the link was made on an earlier run and its address is not kept between runs");
        const w = ctx.lastWindow = await windowFor(ctx, "stranger");
        /* Whatever this page shows, the link is still revoked in the next step. */
        try {
          await go(w.page, ctx.cache.signUrl);
          const head = await see(w.page, "#signBody h1", "Welcome,", "the agreement page", 30000);
          mustBeZZ(head.replace(/^Welcome,\s*/, "").replace(/\.$/, ""), "the company on the agreement page");
          await see(w.page, "#signBody", "Retainer", "the summary");
          if (!(await w.page.locator("#signBtn").isDisabled())) differs("the Sign button before anything is typed", "can be pressed", "greyed out");
        } catch (e) { throw new Soft(String(e.message || e).split("\n")[0]); }
      } },
    { id: "revoke", once: true, does: "Admin: revokes the link", shows: "The question under the link, with no pop-up; then the link reads revoked",
      run: async (ctx) => {
        const a = acct(ctx, "host"), id = made(ctx).link;
        if (!id) skip("the runner does not know which link it made, so it revokes none. Revoke it by hand on the Consultancy page");
        const w = await adminGo(ctx, "consultancy.html");
        const row = w.page.locator(`#${id}`);
        await row.waitFor({ state: "visible" }).catch(() => differs("the link on the Consultancy page", "not among the open links", id));
        if (!(await row.textContent()).includes(a.company)) throw new Refused("refused: that link is not the ZZ host's");
        mustBeZZ(a.company, "the link to revoke");
        await row.locator('[data-act="askRevoke"]').click();
        await see(w.page, `#${id} .inline-choice`, "Revoke this link?", "the question under the link");
        const sent = w.page.waitForResponse((r) => r.url() === `${API}/consultancy/links/revoke`, { timeout: 30000 });
        await row.locator('[data-act="revoke"]').click();
        if ((await sent).ok()) ctx.did(); else differs("revoking", "the API refused", "revoked");
        /* A revoked link moves under Finished, which is folded. */
        await w.page.waitForFunction((i) => !!document.querySelector(`#finished #${i}`), id, { timeout: 20000 })
          .catch(() => differs("the link after revoking", "not under Finished", "under Finished, revoked"));
      } },
    { id: "dead", does: "Opens the revoked link again", shows: "\"This link is no longer valid.\"",
      run: async (ctx) => {
        if (!ctx.cache.signUrl) skip("the link's address is not kept between runs");
        const w = ctx.lastWindow = await windowFor(ctx, "stranger");
        await go(w.page, ctx.cache.signUrl);
        await see(w.page, "#signBody", "no longer valid", "the revoked link", 30000);
      } },
  ],
}];

// ================================================================ 3. the hubs
const HUBS = [
  { key: "print", base: PRINT, name: "3D Print Hub", device: "rigid", machine: "HP MJF 5200", material: "PA12" },
  { key: "mill", base: MILL, name: "Mill Hub", device: "soft", machine: "5-axis CNC", material: "EVA" },
];
const APPROVE_BY_HAND = "the ZZ host's listing waits for approval. Approving a first listing raises a real membership invoice in Xero, " +
  "so the runner never presses it: approve it yourself in the Inbox, void the invoice, then run the test again";
async function openAnswer(ctx, w, id) {
  await w.page.click(`[data-act="intro-accept-open"][data-intro="${id}"]`);
  await w.page.locator(`#introAnswer-${id}`).waitFor({ state: "visible" });
  await w.page.waitForLoadState("networkidle").catch(() => {});
  const ticks = await w.page.locator(`#introTerms-${id} input[type=checkbox]`).count();
  if (ctx.world.terms2 && ticks) differs("the answer on Terms 2.0", "a terms tick", "no terms at all");
  if (!ctx.world.terms2 && !ticks) differs(`the answer on Terms ${ctx.world.termsVersion}`, "no terms tick", "the terms and a tick");
  return ticks;
}
/* Declines, or with --with accept accepts. Accepting sends the introduction
   email to both sides with Will and Chris copied in. */
async function answer(ctx, w, id, { accept, ref, seeker, host }) {
  if (accept) {
    const tick = w.page.locator(`#introTerms-${id} input[type=checkbox]`);
    if (await tick.count()) await tick.first().check();
    const done = w.page.waitForResponse((r) => r.url() === `${API}/introductions/accept` && r.request().method() === "POST");
    ctx.acceptNow = true;      // the lock on accepting opens for this one press
    let sent;
    try { await w.page.click(`[data-act="intro-accept-send"][data-intro="${id}"]`); sent = await done; } finally { ctx.acceptNow = false; }
    if (!sent.ok()) differs("accepting", await text(w.page, `#introMsg-${id}`).catch(() => "refused"), "Accepted");
    ctx.did();
    await see(w.page, `#intro-${id}`, "Introduced on", "the row after accepting", 20000);
    ctx.mail.expect(`The introduction email, ${ref} (to the seeker)`, seeker, `Introduction ${ref}`);
    ctx.mail.expect(`The introduction email, ${ref} (to the host)`, host, `Introduction ${ref}`);
    return "accepted: the introduction email went to both, with Will and Chris copied in";
  }
  await w.page.click(`[data-act="intro-decline-open"][data-intro="${id}"]`);
  await w.page.fill(`#introReason-${id}`, `${MARK}: a test, please ignore.`);
  const done = w.page.waitForResponse((r) => r.url() === `${API}/introductions/decline` && r.request().method() === "POST");
  await w.page.click(`[data-act="intro-decline-send"][data-intro="${id}"]`);
  if (!(await done).ok()) differs("declining", await text(w.page, `#introMsg-${id}`).catch(() => "refused"), "Declined");
  ctx.did();
  await w.page.locator(`[data-act="intro-accept-open"][data-intro="${id}"]`).waitFor({ state: "detached", timeout: 20000 })
    .catch(() => differs("the row after declining", "can still be answered", "closed"));
  ctx.mail.expect(`Declined, ${ref}`, seeker, "An update on");
  return "declined (the default; --with accept sends the introduction email)";
}
const hubJourney = (h) => ({
  id: `hubs.${h.key}`, title: `The ${h.name}: list, search, pick, introduce`, pass: "computer", needs: ["host", "seeker"],
  steps: [
    { id: "listing", does: "Host opens the listing form", shows: "A live listing: the form with its values. None: the empty form",
      run: async (ctx) => {
        const w = await signIn(ctx, "host");
        await go(w.page, `${h.base}/offer.html`);
        await w.page.locator("body[data-np-open]").waitFor({ state: "attached", timeout: 25000 });
        const mine = await apiGet(w.page, `/listings/mine?hub=${h.key}`);
        if (mine.status !== 200 || !mine.body) differs("the host's listing", `the API answered ${mine.status}`, "its state");
        made(ctx).status = mine.body.status;
        const owner = mine.body.listing && mine.body.listing.company;
        if (owner) mustBeZZ(owner, "the listing's company");
        return `the listing is ${mine.body.status}`;
      } },
    { id: "save", does: "Live: changes the lead time by a day and saves. None: fills and submits a first listing, then stops for you",
      shows: "\"Saved.\" and \"Live now\". Or \"Received\", then waiting on your approval",
      run: async (ctx) => {
        const w = await signIn(ctx, "host"), status = made(ctx).status;
        if (status === "pending" || status === "live_pending_edit") wait(APPROVE_BY_HAND);
        await w.page.locator("#listingForm").waitFor({ state: "visible" });
        if (status === "live") {
          const v = Number(await w.page.inputValue("#m-1-lead")) || 5;
          await w.page.fill("#m-1-lead", String(v <= 1 ? 2 : v % 2 === 0 ? v + 1 : v - 1));
          if (await shows(w.page, "#hostTick", 1500)) await w.page.check("#hostTick");
          await w.page.click("#listingSubmit");
          await see(w.page, "#hostAppBody .success", "Saved.", "after the change", 30000);
          await see(w.page, "#hostAppBody .success", "Live now", "a lead-time change goes live at once");
          return;
        }
        await fillIfEmpty(w.page, "#siteTown", "Leeds");
        if (!(await w.page.inputValue("#siteCountry")).trim()) await typeahead(w.page, "#siteCountry", "United Kingdom");
        await w.page.click('#shipsTo input[data-region="uk"] + span');
        await typeahead(w.page, "#m-1-machine", h.machine);
        await typeahead(w.page, "#m-1-materials", h.material);
        await w.page.fill("#m-1-lead", "5");
        await w.page.fill("#m-1-capacity", "100");
        if (await shows(w.page, '#hostMembership input[name="billing"]', 1500)) await w.page.click('#hostMembership input[name="billing"][value="monthly"] + span');
        await w.page.locator("#hostTick").waitFor({ state: "visible" });
        await w.page.check("#hostTick");
        await w.page.click("#listingSubmit");
        await see(w.page, "#hostAppBody .success", "Received", "after submitting a first listing", 30000);
        if (ctx.mail.s.desk) ctx.mail.expect(`Desk notice: a ${h.name} listing to review`, ctx.mail.s.desk, "User request:");
        wait(APPROVE_BY_HAND);
      } },
    { id: "form", does: `Seeker opens Find capacity and fills the form (${h.device}, 12 pairs)`, shows: "The form, with the two picture boxes",
      run: async (ctx) => {
        const w = await signIn(ctx, "seeker");
        await findForm(w, h);
      } },
    { id: "search", does: "Searches",
      shows: "On 1.3 the introduction terms, ticked once. On 2.0 the Seeker Agreement the first time only. Then up to three named sites",
      run: async (ctx) => {
        const w = await signIn(ctx, "seeker");
        const gate = await search(w);
        return gate ? "the terms were shown and accepted" : "no terms were shown";
      } },
    { id: "pick", does: "Picks the ZZ host, and only the ZZ host", shows: "\"The site you picked: … <ZZ host>\"",
      run: async (ctx) => {
        const w = await signIn(ctx, "seeker"), host = acct(ctx, "host").company;
        const cards = await w.page.locator("#capGrid .cap").evaluateAll((els) => els.map((e) => ({
          id: e.getAttribute("data-card"), name: (e.querySelector("h3") ? e.querySelector("h3").textContent : "").trim() })));
        const card = cards.find((c) => same(c.name, host));
        if (!card) differs("the ZZ host among the named sites", `${cards.filter((c) => c.name).length} named sites, none of them the ZZ host; nobody was picked`, host);
        mustBeZZ(card.name, "the site to pick");
        await w.page.click(`#capGrid [data-card="${card.id}"] .cap__tick`);
        await w.page.click("#pickContinue");
        await see(w.page, "#pickSummary", host, "the site picked");
        if (!(await text(w.page, "#requestSubmit")).includes(host)) throw new Refused("refused: the send button does not name the ZZ host");
      } },
    { id: "send", once: true, does: "Sends the request",
      shows: "\"Thank you.\"; \"We have your request\" to the seeker; \"New introduction for you\" to the host; the desk notice",
      run: async (ctx) => {
        const w = await signIn(ctx, "seeker");
        const answered = w.page.waitForResponse((r) => r.url() === `${API}/seeker-requests` && r.request().method() === "POST");
        await w.page.click("#requestSubmit");
        const r = await answered, j = await r.json().catch(() => ({}));
        if (!r.ok() || !j.introduction) differs("sending the request", `${r.status()} ${j.error || await text(w.page, "#requestErr").catch(() => "")}`, "an introduction");
        Object.assign(made(ctx), { intro: j.introduction.id, ref: j.introduction.ref, request: j.ref });
        ctx.did();
        await see(w.page, "#step3Body .success", "Thank you.", "after sending");
        ctx.mail.expect(`Request received, ${h.name}`, acct(ctx, "seeker").email, "We have your request");
        ctx.mail.expect(`The offer to the host, ${j.introduction.ref}`, acct(ctx, "host").email, "New introduction for you");
        if (ctx.mail.s.desk) ctx.mail.expect(`Desk notice: a site was picked, ${h.name}`, ctx.mail.s.desk, "picked");
        ctx.left.push(`introduction ${j.introduction.ref} on the ${h.name}`);
        return `${j.introduction.ref}`;
      } },
    { id: "row", does: "Host opens the introduction on its account page", shows: "The row, \"Open until …\", Review and accept, Decline",
      run: async (ctx) => {
        const id = made(ctx).intro, w = await signIn(ctx, "host");
        await go(w.page, `${APEX}/hub/account/#intro-${id}`);
        await see(w.page, `#intro-${id}`, "Open until", "the introduction's row", 25000);
        for (const act of ["intro-accept-open", "intro-decline-open"]) {
          if (!(await shows(w.page, `[data-act="${act}"][data-intro="${id}"]`))) differs("the row's buttons", `${act} is missing`, "Review and accept, and Decline");
        }
      } },
    { id: "answer-open", does: "Opens the answer", shows: "On 2.0: no terms at all. On 1.3: the introduction terms and a tick",
      run: async (ctx) => { const w = await signIn(ctx, "host"); await openAnswer(ctx, w, made(ctx).intro); } },
    { id: "answer", once: true, does: "Declines (or, with --with accept on the 3D Print Hub, accepts)",
      shows: "\"Declined…\" and the seeker's \"An update on\" email. Or \"Introduced on …\" and the introduction email to both",
      run: async (ctx) => {
        const w = await signIn(ctx, "host"), m = made(ctx);
        return answer(ctx, w, m.intro, { accept: ctx.args.with.includes("accept") && h.key === "print", ref: m.ref,
          seeker: acct(ctx, "seeker").email, host: acct(ctx, "host").email });
      } },
    { id: "seeker-sees", does: "Seeker opens its account page", shows: "The request, with where it stands",
      run: async (ctx) => {
        const w = await signIn(ctx, "seeker");
        await go(w.page, `${APEX}/hub/account/`);
        await see(w.page, "#introductions", made(ctx).request || made(ctx).ref, "the request on the seeker's account page", 25000);
      } },
  ],
});
async function findForm(w, h) {
  await go(w.page, `${h.base}/find.html`);
  await w.page.locator("#findForm").waitFor({ state: "visible", timeout: 25000 });
  for (const type of ["rigid", "soft"]) {
    if (!(await shows(w.page, `.device-card:has(#fDevice-${type})`))) differs("the picture boxes", `no ${type} box`, "Rigid shell and Soft insole");
  }
  await w.page.click(`.device-card:has(#fDevice-${h.device})`);
  await typeahead(w.page, "#fMaterial", h.material);
  await w.page.fill("#fQuantity", "12");
  await fillIfEmpty(w.page, "#fTown", "Leeds");
  if (!(await w.page.inputValue("#fCountry")).trim()) await typeahead(w.page, "#fCountry", "United Kingdom");
  await w.page.fill("#fNotes", `${MARK}: a test search, please ignore.`);
}
/* Presses Find, takes the terms if they are shown, and waits for the sites. True when the terms were shown. */
async function search(w) {
  await w.page.click("#findSubmit");
  const gate = await shows(w.page, "#stepTerms", 6000);
  if (gate) {
    await w.page.locator("#searchTick").waitFor({ state: "visible" });
    await w.page.check("#searchTick");
    await w.page.click("#searchAccept");
  }
  await w.page.locator("#step2:not([hidden])").waitFor({ state: "visible", timeout: 30000 })
    .catch(async () => differs("the search", await text(w.page, "#findErr").catch(() => "") || "no sites showed", "the sites that fit"));
  return gate;
}

// ================================================================ 4. the board
const cardOf = (w, owner, button) => w.page.locator('section[id^="opp-"]', { hasText: owner }).filter({ has: w.page.locator("button", { hasText: button }) }).first();
const board = [{
  id: "board.card", title: "The Opportunities Board: post, approve, publish, request, answer", pass: "computer",
  needs: ["host", "seeker", "admin", "window"],
  from: "waits on the engine four times (every two hours), so it takes several runs across a day",
  steps: [
    { id: "post", once: true, does: "Host posts an opportunity (\"ZZ full test …\", anonymous; on 2.0 as \"offering\")", shows: "\"Received.\"; the desk notice",
      run: async (ctx) => {
        const w = await signIn(ctx, "host"), m = made(ctx);
        m.fit = `${MARK} ${stampOf(ctx)}: a test post, please ignore.`;
        await go(w.page, `${OPPS}/`);
        await w.page.locator("body[data-np-open]").waitFor({ state: "attached", timeout: 25000 });
        await w.page.click("#post button.btn-primary");
        await w.page.locator("#formOverlay.open #formContent form").waitFor({ state: "visible" });
        const offering = w.page.locator('#formContent input[name=direction][value="Offering New Opportunities"]');
        if (await offering.count()) await offering.check({ force: true });
        await w.page.fill("#formContent textarea[name=fit]", m.fit);
        const tick = w.page.locator("#formContent [data-post-terms] [data-np-terms-tick]");
        if (await shows(w.page, "#formContent [data-post-terms] [data-np-terms-tick]", 6000)) await tick.check();
        const sent = w.page.waitForResponse((r) => r.url() === `${API}/requests` && r.request().method() === "POST", { timeout: 30000 });
        await w.page.click("#formContent button[type=submit]:not([disabled])");
        if ((await sent).ok()) ctx.did();
        await see(w.page, "#formContent .success", "Received.", "after posting", 30000);
        if (ctx.mail.s.desk) ctx.mail.expect("Desk notice: an opportunity posted", ctx.mail.s.desk, "an opportunity from");
      } },
    { id: "approve", once: true, does: "Admin, Live Listings: Approve and draft the brief, on the ZZ host's post", shows: "Queued",
      run: async (ctx) => {
        const host = acct(ctx, "host").company, w = await adminGo(ctx, "listings.html?tab=opportunities");
        const row = w.page.locator(".item", { hasText: made(ctx).fit }).first();
        await row.waitFor({ state: "visible" }).catch(() => differs("the post under Posts to approve", "not listed", made(ctx).fit));
        if (!(await row.textContent()).includes(host)) throw new Refused("refused: the post is not from the ZZ host");
        mustBeZZ(host, "the post to approve");
        await row.locator('[data-act="reviewRequest"][data-status="approved"]').click();
        ctx.did();
        await see(w.page, "#toast", /queued/i, "after approving");
      } },
    { id: "publish", once: true, does: "Admin: Review and publish, on the card owned by the ZZ host", shows: "The card reads Live",
      run: async (ctx) => {
        const host = acct(ctx, "host").company, w = await adminGo(ctx, "listings.html?tab=opportunities");
        mustBeZZ(host, "the card's owner");
        const card = cardOf(w, host, "Review and publish");
        if (!(await card.count())) wait("the brief-writer drafts the ZZ card at the engine's next run (every two hours)");
        if (!(await text(w.page, `#${await card.getAttribute("id")} .opp-facts`)).includes(host)) throw new Refused("refused: the draft card's owner is not the ZZ host");
        const id = (await card.getAttribute("id")).replace(/^opp-/, "");
        Object.assign(made(ctx), { opp: id, ref: await text(w.page, `#opp-${id} .opp-top .ref`) });
        await card.locator("button", { hasText: "Review and publish" }).click();
        await w.page.evaluate(() => { const t = document.getElementById("toast"); if (t) t.textContent = ""; });
        await w.page.click(`[data-act="publish"][data-opp="${id}"]`);
        /* The editor asks for a save first when it filled something in by itself. The save goes to the engine. */
        if (await shows(w.page, '#toast:has-text("Save your changes first")', 2500)) {
          await w.page.click('[data-act="saveEditor"]');
          wait("the card's editor asked for a save first; it is saved at the engine's next run, then the runner publishes it");
        }
        await w.page.locator(`#opp-${id} .opp-top .stage`, { hasText: /live/i }).waitFor({ state: "visible", timeout: 20000 })
          .catch(async () => differs("the card after Publish", `${await text(w.page, `#opp-${id} .opp-top .stage`).catch(() => "")} · ${await text(w.page, "#toast").catch(() => "")}`, "Live"));
        ctx.did();
        ctx.left.push(`the board card ${made(ctx).ref} (the runner ends it at the last step)`);
      } },
    { id: "shown", does: "Seeker opens the board", shows: "The new card, by its NX number",
      run: async (ctx) => {
        const w = await signIn(ctx, "seeker");
        await go(w.page, `${OPPS}/`);
        await w.page.locator("body[data-np-open]").waitFor({ state: "attached", timeout: 25000 });
        await w.page.waitForLoadState("networkidle").catch(() => {});
        if (!(await shows(w.page, `#grid .op[data-ref="BRIEF ${made(ctx).ref}"]`, 8000))) wait(`${made(ctx).ref} reaches the public board at the engine's next run`);
      } },
    { id: "request", once: true, does: "Seeker requests an introduction on that card", shows: "\"Received, in confidence.\"; the desk notice",
      run: async (ctx) => {
        const w = await signIn(ctx, "seeker"), ref = made(ctx).ref;
        await w.page.click(`#grid .op[data-ref="BRIEF ${ref}"]`);
        await w.page.locator("#briefOverlay.open #briefContent [data-id]").first().waitFor({ state: "visible" });
        if (!(await text(w.page, "#briefContent")).includes(ref.replace(/^BRIEF\s+/, ""))) throw new Refused("refused: the open card is not the ZZ card");
        await w.page.locator("#briefContent [data-id]", { hasText: "Request an introduction" }).click();
        await w.page.locator("[data-np-send]").waitFor({ state: "visible" });
        if (await shows(w.page, "[data-np-terms] [data-np-terms-tick]", 6000)) await w.page.check("[data-np-terms] [data-np-terms-tick]");
        await w.page.fill("#gNotes", `${MARK}: a test request, please ignore.`);
        const sent = w.page.waitForResponse((r) => r.url() === `${API}/requests` && r.request().method() === "POST", { timeout: 30000 });
        await w.page.click("[data-np-send]:not([disabled])");
        if ((await sent).ok()) ctx.did();
        await see(w.page, ".success", "Received, in confidence.", "after requesting", 30000);
        if (ctx.mail.s.desk) ctx.mail.expect("Desk notice: an introduction requested on the board", ctx.mail.s.desk, "User request:");
      } },
    { id: "introduce", once: true, does: "Admin: Introduce, on the ZZ seeker's request (fee in words \"Test data, no fee\")", shows: "Queued",
      run: async (ctx) => {
        const seeker = acct(ctx, "seeker").company, m = made(ctx), w = await adminGo(ctx, "listings.html?tab=opportunities");
        mustBeZZ(seeker, "the company to introduce");
        const row = w.page.locator(".item", { hasText: seeker }).filter({ has: w.page.locator('[data-ui^="introreq:"]') }).first();
        await row.waitFor({ state: "visible" }).catch(() => differs("the request under Introductions to make", "not listed", seeker));
        await row.locator('[data-ui^="introreq:"]').click();
        const form = `[data-act="introduce"][data-opp="${m.opp}"]`;
        if (!(await shows(w.page, form))) throw new Refused("refused: the request is not for the ZZ card");
        await w.page.fill(`#i-note-${m.opp}`, "Test data, no fee");
        await w.page.fill(`#i-agreed-${m.opp}`, today());
        /* A two-way card asks who sells; the owner is the ZZ host. */
        const sells = w.page.locator(`#i-sells-${m.opp}`);
        if (await sells.isEnabled() && !(await sells.inputValue())) await sells.selectOption("owner");
        await w.page.click(form);
        await see(w.page, "#toast", /Introduced on/, "after Introduce");
        ctx.did();
      } },
    { id: "owner-row", does: "Host opens the introduction on its account page", shows: "\"Opportunity NX-…\", \"Waiting for your answer.\"",
      run: async (ctx) => {
        const w = await signIn(ctx, "host"), m = made(ctx);
        await go(w.page, `${APEX}/hub/account/`);
        await w.page.locator("#introductions").waitFor({ state: "visible", timeout: 25000 });
        const row = w.page.locator('[id^="intro-"]', { hasText: `Opportunity ${m.ref}` }).filter({ has: w.page.locator('[data-act="intro-accept-open"]') }).first();
        if (!(await row.count())) wait("the owner's offer is made at the engine's next run");
        m.intro = (await row.getAttribute("id")).replace(/^intro-/, "");
        await see(w.page, `#intro-${m.intro}`, "Waiting for your answer", "the owner's row");
        ctx.mail.expect(`The offer to the owner, ${m.ref}`, acct(ctx, "host").email, "New introduction for you");
      } },
    { id: "owner-answer", once: true, does: "Opens the answer, then declines", shows: "No terms on 2.0; \"Declined…\"",
      run: async (ctx) => {
        const w = await signIn(ctx, "host"), m = made(ctx);
        await openAnswer(ctx, w, m.intro);
        return answer(ctx, w, m.intro, { accept: false, ref: m.ref, seeker: acct(ctx, "seeker").email, host: acct(ctx, "host").email });
      } },
    { id: "end", once: true, does: "Admin: Ends the card, reason \"test data\"", shows: "Queued; the card leaves the working list",
      run: async (ctx) => {
        const host = acct(ctx, "host").company, m = made(ctx), w = await adminGo(ctx, "listings.html?tab=opportunities");
        if (!(await text(w.page, `#opp-${m.opp} .opp-facts`)).includes(host)) throw new Refused("refused: the card's owner is not the ZZ host");
        await w.page.click(`#opp-${m.opp} [data-ui="end:${m.opp}"]`);
        await w.page.fill(`#en-why-${m.opp}`, "test data");
        await w.page.click(`#opp-${m.opp} [data-act="end"]`);
        ctx.did();
        await see(w.page, "#toast", /queued/i, "after ending the card");
      } },
  ],
}];

// ================================================================ 5. Terms 2.0
const terms = [{
  id: "terms.platform", title: "Terms 2.0: the Platform Terms, once", pass: "computer", needs: ["terms2", "veteran"],
  from: "plan 078, W5 (queue DH9)",
  steps: [
    { id: "gate", does: "Veteran signs in", shows: "\"Our Platform Terms have changed\", with no way to close it",
      run: async (ctx) => {
        const w = await signIn(ctx, "veteran", { leaveGate: true });
        const t = await termsOf(w, "platform");
        if (t && t.accepted) skip("this account has already accepted Platform Terms 2.0; the once-only check needs an account still on 1.3");
        await see(w.page, "#npTermsGate #npGateHead", "Our Platform Terms have changed", "the box at sign-in");
        await w.page.keyboard.press("Escape");
        await w.page.mouse.click(4, 4);
        if (!(await shows(w.page, "#npTermsGate", 1500))) differs("the box after Escape and a click outside", "closed", "still open");
      } },
    { id: "accept", does: "Downloads the copy; ticks; Accept and continue", shows: "A PDF; the box goes",
      run: async (ctx) => {
        const w = await signIn(ctx, "veteran", { leaveGate: true });
        if (!(await shows(w.page, "#npTermsGate", 3000))) skip("no box is showing");
        await pdfOk(ctx, w, await w.page.getAttribute("#npTermsGate a.np-terms-dl", "href"), "the Platform Terms");
        if (!(await w.page.locator("#npTermsGate [data-np-gate-go]").isDisabled())) differs("Accept and continue before the tick", "can be pressed", "greyed out");
        await w.page.check("#npTermsGate input[data-np-gate-tick]");
        await w.page.click("#npTermsGate [data-np-gate-go]");
        await w.page.locator("#npTermsGate").waitFor({ state: "detached", timeout: 20000 });
      } },
    { id: "never-again", does: "Reloads, then signs out and in", shows: "No box, either time",
      run: async (ctx) => {
        const w = await signIn(ctx, "veteran", { leaveGate: true });
        await go(w.page, `${APEX}/hub/account/`);
        await w.page.locator("body[data-np-open]").waitFor({ state: "attached", timeout: 25000 });
        if (await shows(w.page, "#npTermsGate", 4000)) differs("after a reload", "the box again", "no box");
        await signOut(w);
        await signIn(ctx, "veteran", { leaveGate: true });
        if (await shows(w.page, "#npTermsGate", 4000)) differs("after signing in again", "the box again", "no box");
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

// ================================================================ 6. the admin
/* Opens the ZZ company's page from Contacts and proves the page is that company's. */
async function companyPage(ctx, company) {
  mustBeZZ(company, "the company to open");
  if (!ctx.cache[company]) {
    const w = await adminGo(ctx, "contacts.html");
    await w.page.fill("#cq", company);
    const row = w.page.locator('a.lrow[href^="company.html?id="]', { hasText: company }).first();
    await row.waitFor({ state: "visible" }).catch(() => wait(`${company} is not in Contacts yet (the engine adopts it at its next run)`));
    ctx.cache[company] = await row.getAttribute("href");
  }
  const w = await adminGo(ctx, ctx.cache[company]);
  /* The title reads "NexPoint CRM: Company" until the company has loaded. */
  await w.page.waitForFunction(() => /^NexPoint CRM: (?!Company$)./.test(document.title), null, { timeout: 20000 }).catch(() => {});
  const title = (await w.page.title()).replace(/^NexPoint CRM:\s*/, "");
  if (!same(title, company)) throw new Refused(`refused: the page is titled ${JSON.stringify(title.slice(0, 60))}, not the ZZ company`);
  mustBeZZ(title, "the company page");
  return w;
}
const prospectName = (ctx) => `ZZ Full Test Prospect ${stampOf(ctx)}`;
async function prospectRow(ctx) {
  const name = prospectName(ctx), w = await adminGo(ctx, "marketing.html");
  await w.page.evaluate(() => { try { localStorage.removeItem("nx-prospects-filters"); localStorage.removeItem("nx-prospects-tab"); } catch { /* private window */ } });
  await w.page.reload({ waitUntil: "domcontentloaded" });
  await w.page.locator("#admin").waitFor({ state: "visible" });
  await w.page.waitForLoadState("networkidle").catch(() => {});
  await w.page.fill("#f-search", name);
  /* Leaving the search box fires its change event, which redraws the list. Left to the first
     click, that redraw lands between the button's mousedown and mouseup, so the click is lost
     and the row never opens (the 6 November run). Blur here, so the redraw comes first. */
  await w.page.locator("#f-search").blur();
  const row = w.page.locator("#plist tbody tr", { hasText: name }).first();
  /* A row whose decision is queued for the engine shows "… queued" in place of Show details. */
  const button = row.locator('[data-act="openRow"]').first();
  const id = (await row.count()) && (await button.count()) ? await button.getAttribute("data-id") : "";
  if (!id && (await row.count())) wait(`${name} has a decision queued for the engine; it opens again after the engine's next run`);
  return { w, name, id };
}
async function openProspect(ctx) {
  const p = await prospectRow(ctx);
  if (!p.id) wait(`${p.name} is not on Prospects yet (the engine files it at its next run)`);
  mustBeZZ(p.name, "the prospect to open");
  await p.w.page.click(`#plist [data-act="openRow"][data-id="${p.id}"]`);
  await p.w.page.locator(`#type-${p.id}`).waitFor({ state: "visible" })
    .catch(() => differs("Show details on the row", "the row stayed shut", "the row's fields"));
  return p;
}
const admin = [{
  id: "admin.door", title: "The admin: signing in", pass: "computer", needs: ["admin", "window"],
  steps: [
    { id: "door", does: "Opens the admin and waits for you to sign in", shows: "The side menu with nine items; \"Working as …\" with your address",
      run: async (ctx) => {
        const w = await adminWindow(ctx);
        const n = await w.page.locator(".rail .nav a").count();
        if (n !== 9) differs("the side menu", `${n} items`, "nine");
      } },
  ],
}, {
  id: "admin.company", title: "The admin: Contacts and a company page, with fast saves on", pass: "computer", needs: ["admin", "host", "window"],
  from: "queue CY11 and DA9 (plan 079)",
  steps: [
    { id: "open", does: "Contacts: finds the ZZ host and opens its page", shows: "The page titled with the ZZ name; Portal user on its person; a Terms line",
      run: async (ctx) => {
        const w = await companyPage(ctx, acct(ctx, "host").company);
        if (!(await shows(w.page, 'span.tag.mini:has-text("Portal user")'))) differs("the company's people", "nobody tagged Portal user", "Portal user");
        if (!(await shows(w.page, 'dt:has-text("Terms")'))) differs("the account block", "no Terms line", "Terms");
      } },
    { id: "note", does: "Adds a note", shows: "With fast saves on: \"Saved\", and the note on the timeline at once",
      run: async (ctx) => {
        const w = await companyPage(ctx, acct(ctx, "host").company), body = `${MARK} ${ctx.stamp}: a test note, please ignore.`;
        if (await shows(w.page, '[data-act="composerPick"][data-pick="note"]', 1500)) await w.page.click('[data-act="composerPick"][data-pick="note"]');
        await w.page.fill("#cp-note", body);
        const saved = await saveVia(w.page, () => w.page.click('[data-act="noteAdd"]'));
        ctx.left.push(`a test note on ${acct(ctx, "host").company}`);
        if (!saved.direct) throw new Soft(`the note was queued for the engine ("${saved.toast}"): fast saves read off, so CY11's switch is not on`);
        wantDirect(saved, "the note");
        await see(w.page, ".tl", body, "the note on the timeline at once");
      } },
    { id: "edit", does: "Edits the website field, then puts it back", shows: "\"Saved\" both times; the value survives a reload",
      run: async (ctx) => {
        const company = acct(ctx, "host").company, test = "https://example.com/zz-full-test";
        let w = await companyPage(ctx, company);
        await w.page.click('[data-act="openUi"][data-ui="editco"]');
        const old = await w.page.inputValue("#ec-web");
        await w.page.fill("#ec-web", old === test ? "" : test);
        const first = await saveVia(w.page, () => w.page.click('[data-act="saveCompany"]'));
        let kept = true;
        if (first.direct) {
          w = await companyPage(ctx, company);
          await w.page.click('[data-act="openUi"][data-ui="editco"]');
          kept = (await w.page.inputValue("#ec-web")) === (old === test ? "" : test);
          await w.page.fill("#ec-web", old === test ? "" : old);
          wantDirect(await saveVia(w.page, () => w.page.click('[data-act="saveCompany"]')), "putting the website back");
        }
        if (!first.direct) throw new Soft(`the edit was queued for the engine ("${first.toast}"): fast saves read off. The website field now reads ${test}; put it back by hand`);
        if (!kept) differs("the website after a reload", "the old value", test);
      } },
    { id: "task", does: "Adds a task, then marks it done", shows: "The task under the company; then gone from the open list",
      run: async (ctx) => {
        const w = await companyPage(ctx, acct(ctx, "host").company), title = `${MARK} ${ctx.stamp}: a test task`;
        await w.page.click('[data-act="composerPick"][data-pick="task"]');
        await w.page.fill("#cp-title", title);
        const saved = await saveVia(w.page, () => w.page.click('[data-act="taskAdd"]'));
        if (!saved.direct) throw new Soft(`the task was queued for the engine ("${saved.toast}"): fast saves read off. Mark it done by hand once it shows`);
        const task = await nearest(w.page, '[data-act="taskDone"]', title, "task");
        if (!task) differs("the new task", "not listed with a Done button", title);
        const done = w.page.locator(`[data-act="taskDone"][data-task="${task}"]`).first();
        wantDirect(await saveVia(w.page, () => done.click()), "marking the task done");
      } },
  ],
}, {
  id: "admin.pipelines", title: "The admin: a pipeline card", pass: "computer", needs: ["admin", "host", "window"],
  steps: [
    { id: "add", once: true, does: "Pipelines: adds a hub card for the ZZ host", shows: "The card in the Accepted column",
      run: async (ctx) => {
        const company = acct(ctx, "host").company, w = await adminGo(ctx, "pipelines.html?tab=hub");
        mustBeZZ(company, "the company for the card");
        /* The cards there before, so the runner only ever touches the one it adds. */
        made(ctx).before = await w.page.locator(".card[data-card]").evaluateAll((els) => els.map((e) => e.dataset.card));
        await w.page.click('[data-act="openUi"][data-ui="add"]');
        await w.page.fill("#ac-q", company);
        await w.page.click('[data-act="findCompany"]');
        const pick = w.page.locator('[data-act="pickCompany"]', { hasText: company }).first();
        await pick.waitFor({ state: "visible" }).catch(() => differs("finding the company", "not offered", company));
        await pick.click();
        await w.page.click('[data-act="toggleHub"][data-hub="print"]');
        const saved = await saveVia(w.page, () => w.page.click('[data-act="confirmAdd"]'));
        ctx.did();
        ctx.left.push(`a pipeline card for ${company} (the runner marks it dead)`);
        return saved.direct ? "" : `queued for the engine ("${saved.toast}"): fast saves read off, so the card shows after the next run`;
      } },
    { id: "move", does: "Moves it to In conversation, on the company page", shows: "The stage changes; \"Saved\"",
      run: async (ctx) => {
        const company = acct(ctx, "host").company, w = await adminGo(ctx, "pipelines.html?tab=hub");
        const before = made(ctx).before || null;
        if (!before) skip("the runner does not know which card it added, so it moves none");
        const fresh = await w.page.locator(".card[data-card]", { hasText: company }).evaluateAll((els, old) => els.map((e) => e.dataset.card).filter((c) => !old.includes(c)), before);
        if (!fresh.length) wait("the new card is not on the board yet (the engine adds it at its next run)");
        if (fresh.length > 1) throw new Refused("refused: more than one new card for the ZZ host; the runner cannot tell which is its own");
        const id = made(ctx).card = fresh[0];
        await companyPage(ctx, company);
        await w.page.locator(`#card-${id}`).waitFor({ state: "visible" }).catch(() => differs("the card on the company page", "not shown", `#card-${id}`));
        wantDirect(await saveVia(w.page, () => w.page.click(`#card-${id} [data-act="setStage"][data-stage="conversation"]`)), "moving the card");
      } },
    { id: "dead", does: "Marks the card dead", shows: "\"Saved\"; the card leaves the board",
      run: async (ctx) => {
        const company = acct(ctx, "host").company, id = made(ctx).card;
        if (!id) skip("the runner does not know which card it added, so it marks none dead");
        const w = await companyPage(ctx, company);
        await w.page.click(`[data-act="openUi"][data-ui="dead:${id}"]`);
        await w.page.locator('[data-act="pickReason"]').first().click();
        await w.page.fill("#dd-note", "test data");
        wantDirect(await saveVia(w.page, () => w.page.click('[data-act="confirmDead"]')), "marking the card dead");
      } },
  ],
}, {
  id: "admin.prospects", title: "The admin: Prospects, with fast saves on", pass: "computer", needs: ["admin", "window"],
  from: "queue CY9, CY11 and DA9. Never onto a campaign: that goes into Smartlead",
  steps: [
    { id: "add", once: true, does: "Prospects: adds \"ZZ Full Test Prospect …\" as a Known contact", shows: "Queued for the engine",
      run: async (ctx) => {
        const p = await prospectRow(ctx);
        mustBeZZ(p.name, "the prospect to add");
        if (p.id) return "already there from an earlier run";
        await p.w.page.click('.head [data-act="toggleAdd"]');
        await p.w.page.fill("#add-name", p.name);
        await p.w.page.selectOption("#add-type", { label: "Known contact" });
        await p.w.page.click("#add-go");
        ctx.did();
        await see(p.w.page, "#toast", /./, "after adding");
        ctx.left.push(`the prospect ${p.name}, and the lead folder made when it is accepted`);
      } },
    { id: "sector", does: "Opens the row: a second sector on, Save, reload, off again, Save", shows: "The sector survives the reload; the row ends as it began",
      run: async (ctx) => {
        let p = await openProspect(ctx);
        const button = () => p.w.page.locator(`#plist [data-act="toggleMany"][data-id="${p.id}"][data-f="sectors"]`).first();
        const look = async () => button().evaluate((b) => `${b.getAttribute("aria-pressed")}|${b.className}`);
        const before = await look();
        await button().click();
        const on = await look();
        if (on === before) differs("pressing a sector", "nothing changed", "the sector lit");
        const saved = await saveVia(p.w.page, () => p.w.page.click(`#save-${p.id}`));
        if (!saved.direct) throw new Soft(`the edit was queued for the engine ("${saved.toast}"): fast saves read off. One sector on ${p.name} was changed`);
        p = await openProspect(ctx);
        if ((await look()) !== on) differs("the sector after a reload", "as it was before", "still on");
        await button().click();
        wantDirect(await saveVia(p.w.page, () => p.w.page.click(`#save-${p.id}`)), "taking the sector off again");
        if ((await look()) !== before) differs("the row at the end", "changed", "as it began");
      } },
    { id: "note", does: "Adds a note on the prospect", shows: "The note under the row at once",
      run: async (ctx) => {
        const p = await openProspect(ctx), body = `${MARK} ${ctx.stamp}: a test note, please ignore.`;
        if (!(await shows(p.w.page, `#note-${p.id}`, 1500))) await p.w.page.locator("#plist details summary", { hasText: "Notes" }).first().click();
        await p.w.page.fill(`#note-${p.id}`, body);
        const saved = await saveVia(p.w.page, () => p.w.page.click(`[data-act="addNote"][data-id="${p.id}"]`));
        if (!saved.direct) throw new Soft(`the note was queued for the engine ("${saved.toast}"): fast saves read off`);
        await see(p.w.page, "#plist p.note-item", body, "the note under the row");
      } },
    { id: "accept", once: true, does: "Accepts it as a Known contact, with no campaign", shows: "\"Accepted as a lead\"",
      run: async (ctx) => {
        const p = await openProspect(ctx);
        await p.w.page.selectOption(`#type-${p.id}`, { label: "Known contact" });
        const lit = await p.w.page.locator(`#plist [data-act="toggleMany"][data-id="${p.id}"][data-f="campaigns"][aria-pressed="true"]`).count();
        if (lit) throw new Refused("refused: a campaign is chosen on the row, and a campaign goes into Smartlead");
        await p.w.page.click(`#act-${p.id} [data-act="accept"][data-id="${p.id}"]`);
        ctx.did();
        await see(p.w.page, "#toast", "Accepted", "after Accept");
      } },
    { id: "in-contacts", does: "Looks for the accepted company in Contacts", shows: "The company, as a lead",
      run: async (ctx) => { await companyPage(ctx, prospectName(ctx)); } },
  ],
}, {
  id: "delete-login", title: "The admin: a login deleted, the person kept (uses up an account)", pass: "computer", optIn: true,
  needs: ["admin", "disposable", "window"], from: "queue CY10b, case 2 (plan 085)",
  steps: [
    { id: "role", once: true, does: "Gives the disposable account's person a role in Contacts", shows: "\"Saved\"",
      run: async (ctx) => {
        const w = await companyPage(ctx, acct(ctx, "disposable").company);
        await w.page.locator('[data-act="editPerson"]').first().click();
        await w.page.locator("#pe-name").waitFor({ state: "visible" });
        await w.page.getByLabel(/role/i).first().fill("ZZ test role");
        await saveVia(w.page, () => w.page.click('[data-act="savePerson"]'));
      } },
    { id: "delete", once: true, does: "Delete user, and its confirmation", shows: "The question under the user, then queued",
      run: async (ctx) => {
        const w = await companyPage(ctx, acct(ctx, "disposable").company);
        const user = await w.page.locator('[data-act="deleteUser"]').first().getAttribute("data-user");
        await w.page.click(`[data-act="deleteUser"][data-user="${user}"]`);
        await w.page.click(`[data-act="confirmDeleteUser"][data-user="${user}"]`);
        ctx.did();
        await see(w.page, "#toast", /./, "after Delete user");
      } },
    { id: "kept", does: "Opens the company page again", shows: "The person stays, with no Portal user tag; the timeline says a login was deleted",
      run: async (ctx) => {
        const w = await companyPage(ctx, acct(ctx, "disposable").company);
        if (await shows(w.page, 'span.tag.mini:has-text("Portal user")', 2000)) wait("the engine has not yet deleted the login (its next run)");
        await see(w.page, ".tl", "A portal login was deleted", "the timeline");
        if (!(await w.page.locator(".person-name").count())) differs("the person", "gone from Contacts", "kept, because they hold a role");
      } },
  ],
}];

// ================================================================ 7. the phone pass
/* Nothing runs off the side, and the thing a visitor came for is on screen. */
async function fits(w, url, main) {
  await go(w.page, url);
  await w.page.locator(main).first().waitFor({ state: "visible", timeout: 25000 }).catch(() => differs(url, "the main part did not show", main));
  await w.page.waitForLoadState("networkidle").catch(() => {});
  const over = await w.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (over > 2) differs(`${url} at phone width`, `${over}px runs off the side`, "nothing off the side");
  const box = await w.page.locator(main).first().boundingBox();
  const wide = w.page.viewportSize().width;
  if (!box || box.x < -1 || box.x + box.width > wide + 1) differs(`${url} at phone width`, "the main part is cut off", "inside the screen");
}
const phoneStep = (id, who, pages) => ({ id, does: `As ${who}: ${pages.map((p) => p[2]).join(", ")}, at 390 wide`,
  shows: "Nothing runs off the side; the main part of each page is on screen" });
const phone = [{
  id: "phone.public", title: "The phone pass: a stranger", pass: "phone", needs: [],
  steps: [(() => {
    const pages = [[`${APEX}/`, "h1", "the home page"], [`${APEX}/hub/`, "h1", "the portal door"], [`${APEX}/hub/terms/`, "h1", "the terms page"]];
    return { ...phoneStep("pages", "a stranger", pages), run: async (ctx) => {
      const w = ctx.lastWindow = await windowFor(ctx, "stranger");
      for (const [url, main] of pages) await fits(w, url, main);
    } };
  })()],
}, {
  id: "phone.seeker", title: "The phone pass: the seeker", pass: "phone", needs: ["seeker"],
  steps: [(() => {
    const pages = [[`${PRINT}/`, "h1", "the 3D Print Hub door"], [`${MILL}/`, "h1", "the Mill Hub door"],
      [`${PRINT}/find.html`, "#findForm", "the 3D Print Hub's find form"], [`${MILL}/find.html`, "#findForm", "the Mill Hub's find form"],
      [`${OPPS}/`, "#grid", "the board"], [`${APEX}/hub/account/`, "#introductions, #profile", "the account page"],
      [`${APEX}/hub/account/settings/`, "#you", "the settings page"]];
    return { ...phoneStep("pages", "the seeker", pages), run: async (ctx) => {
      const w = await signIn(ctx, "seeker");
      for (const [url, main] of pages) await fits(w, url, main);
      await go(w.page, `${PRINT}/find.html`);
      await w.page.locator(".device-card:has(#fDevice-rigid)").tap();
      if (!(await shows(w.page, ".device-card.is-on:has(#fDevice-rigid)"))) differs("tapping a picture box", "did not light", "lit");
    } };
  })()],
}, {
  id: "phone.host", title: "The phone pass: the host", pass: "phone", needs: ["host"],
  steps: [(() => {
    const pages = [[`${PRINT}/offer.html`, "#hostAppBody", "the 3D Print Hub's listing form"], [`${MILL}/offer.html`, "#hostAppBody", "the Mill Hub's listing form"],
      [`${APEX}/hub/account/`, "#introductions, #profile", "the account page"]];
    return { ...phoneStep("pages", "the host", pages), run: async (ctx) => {
      const w = await signIn(ctx, "host");
      for (const [url, main] of pages) await fits(w, url, main);
    } };
  })()],
}, {
  id: "phone.admin", title: "The phone pass: the admin", pass: "phone", needs: ["admin", "window"],
  steps: [(() => {
    const pages = [["inbox.html", "the Inbox"], ["marketing.html", "Prospects"], ["contacts.html", "Contacts"], ["pipelines.html", "Pipelines"],
      ["listings.html", "Live Listings"]];
    return { id: "pages", does: `As the admin: ${pages.map((p) => p[1]).join(", ")}, at 390 wide`,
      shows: "Nothing runs off the side; the main part of each page is on screen",
      run: async (ctx) => {
        await adminWindow(ctx);
        for (const [file] of pages) await fits(ctx.lastWindow, `${ADMIN}/${file}`, "#admin");
      } };
  })()],
}];

// ================================================================ 8. the emails
const mail = [{
  id: "mail.check", title: "The emails", pass: "last", needs: [],
  steps: [
    { id: "arrived", does: "Looks in the test mailboxes for every email the journeys above should have caused (read only)",
      shows: "Each one arrived: its recipient, sender (portal@), subject and folder (Inbox)",
      run: async (ctx) => {
        if (!ctx.mail.expected.length) skip("no journey on this run caused an email");
        ctx.mailRows = await ctx.mail.settle(ctx.log);
        const wrong = ctx.mailRows.filter((r) => !r.ok && !r.hand);
        const hand = ctx.mailRows.filter((r) => r.hand);
        if (wrong.length) throw new Soft(`${wrong.length} of ${ctx.mailRows.length} differed: ${wrong.map((r) => `${r.what}: ${r.result}`).join("; ").slice(0, 300)}`);
        return hand.length ? `${ctx.mailRows.length - hand.length} arrived; ${hand.length} are for you to check by hand` : `${ctx.mailRows.length} arrived`;
      } },
  ],
}];

export const JOURNEYS = [].concat(start, waysIn, HUBS.map(hubJourney), board, terms, admin, phone, mail);

/* What the runner cannot judge. Always printed at the foot of the report. */
export const BY_HAND = [
  "A real phone: the phone pass is Chrome at phone width, not a phone.",
  "Money: approving a first listing and its Xero invoice, a card payment, statements, anything in Xero.",
  "Smartlead: accepting a prospect onto one or two campaigns, and the turn passing between them (queue DA9).",
  "How each screen and each email reads. The runner checks an email arrived, not that it reads well.",
  "Queue CY10b case 3 (a login deleted in the Supabase dashboard) and CY10c (the count, in the SQL editor).",
  "Queue CY11's proof of the fallback: turning fast saves off and on again is a change in the SQL editor.",
  "The public desk forms (home page, hub door, Education sign-up). The daily canary posts one each morning.",
  "A discount code shown on the click: there is no ZZ code card.",
  "A monthly declaration, and that the seeker gets no email when a host declares.",
  "Queue DB5, the ZZ clear-out, including what this run left behind (listed below).",
];

// The full test: before anything, every way in, and Terms 2.0.
import { APEX, PRINT, MILL, OPPS, API, Refused, Soft, mustBeZZ, isZZ, isZZSlug, differs, wait, skip, hand, askEnter, askLine } from "./core.mjs";
import { windowFor, go, see, shows, text, whoAmI, apiGet, signIn, signOut, adminWindow, adminGo, saveVia, wantDirect, ADMIN, allow, pollUntil, invoiceRaised } from "./browser.mjs";
import { same, made, acct, today, MARK, stampOf, newcomer, pageErrors, typeahead, fillIfEmpty, emailLink, pdfOk, nearest, termsOf, HUBS, openAnswer, answer, findForm, search, cardOf, companyPage, prospectName, prospectRow, openProspect, fits } from "./kit.mjs";

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

export const WAYS_IN = [].concat(start, waysIn, terms);

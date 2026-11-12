// The full test: its two fixed ZZ accounts, the host and the seeker. The
// first run registers and confirms each; every later run finds it there and
// signs in. Their passwords are made by --setup and live only in the
// settings file on the operator's machine.
import { APEX, mustBeZZ, differs, skip, askEnter } from "./core.mjs";
import { windowFor, go, see, shows, text, signIn } from "./browser.mjs";
import { made, acct, stampOf, emailLink } from "./kit.mjs";

const posted = (page, path) => page.waitForResponse((r) => new URL(r.url()).pathname === path && r.request().method() === "POST", { timeout: 60000 });
async function ensure(ctx, role) {
  const a = acct(ctx, role), m = made(ctx);
  mustBeZZ(a.company, `the ${role} account in the settings`);
  stampOf(ctx);                                   // sets when this journey began, for the mailbox search
  const w = ctx.lastWindow = await windowFor(ctx, role);
  if (w.proved) return "already signed in";
  if (!m[`${role}Registered`]) {
    await go(w.page, `${APEX}/hub/?signin=1`);
    await w.page.locator("#signOverlay.open").waitFor({ state: "visible" });
    await w.page.fill("#sEmail", a.email);
    await w.page.fill("#sPass", a.password);
    await w.page.click("#signContent button[type=submit]");
    const chip = w.page.locator(".np-chip__name").first(), err = w.page.locator("#signContent .np-sign-error").first();
    await Promise.race([chip.waitFor({ state: "visible", timeout: 25000 }), err.waitFor({ state: "visible", timeout: 25000 })]).catch(() => {});
    if (await chip.isVisible().catch(() => false)) { w.signedIn = true; await signIn(ctx, role); return "the account is there already"; }
    const line = await text(w.page, "#signContent .np-sign-error").catch(() => "");
    if (!/don.t match an account/.test(line)) differs(`signing in as the ${role}`, line || "neither the chip nor an error showed", "the chip, or \"don't match an account\"");
    /* No such account yet: register it, as a person would. */
    if (ctx.args.headless) skip("the account is not registered yet, and registering needs the Chrome window");
    await go(w.page, `${APEX}/hub/?join=1`);
    await w.page.locator('form[data-np-step="1"]').waitFor({ state: "visible" });
    await w.page.fill("#qName", a.company);
    await w.page.fill("#qCompany", a.company);
    await w.page.fill("#qEmail", a.email);
    await w.page.locator("#qPass").pressSequentially(a.password);
    await w.page.click("#npAccountContent button[type=submit]");
    await w.page.locator('form[data-np-step="2"]').waitFor({ state: "visible" });
    await w.page.fill("#qCountry", ctx.settings.new_account.country || "United Kingdom");
    await w.page.fill("#qTown", ctx.settings.new_account.town || "Leeds");
    await w.page.locator("#qTerms").waitFor({ state: "visible" });
    await w.page.check("#qTerms");
    /* The human check is Cloudflare's. The runner never touches it. */
    const ready = 'form[data-np-step="2"] button[type=submit]:not([disabled])';
    if (!(await shows(w.page, ready, 45000))) {
      await w.page.bringToFront().catch(() => {});
      if (!(await askEnter("The \"are you human\" check has not cleared. Complete it in the Chrome window."))) skip("the human check was left");
      await w.page.locator(ready).waitFor({ state: "visible", timeout: 5 * 60 * 1000 });
    }
    const sent = posted(w.page, "/auth/register");
    await w.page.click(ready);
    const r = await sent;
    if (!r.ok()) differs(`registering the ${role}`, `the site answered ${r.status()}: ${await text(w.page, "#npAccountContent").catch(() => "")}`.slice(0, 200), "Check your inbox");
    m[`${role}Registered`] = true;
    await see(w.page, "#npAccountContent .success", "Check your inbox", "after registering", 30000);
    ctx.left.push(`the account ${a.company} (${a.email}), kept between runs`);
  }
  await go(w.page, await emailLink(ctx, { to: a.email, subject: "Confirm your email", part: "/hub/confirm.html", what: `the ${role}'s confirmation email` }));
  await see(w.page, "#confirmBody", /You.re confirmed/, "the confirmation page", 30000);
  await signIn(ctx, role);
  return "registered and confirmed on this run";
}

const accounts = [{
  id: "accounts.make", title: "The two fixed ZZ accounts: there, or registered and confirmed now", pass: "computer", needs: ["host", "seeker"],
  steps: ["host", "seeker"].map((role) => ({
    id: role, does: `Signs in as the ZZ ${role}; the first time, registers the account and confirms it from its email`,
    shows: "The name chip; the live site names the ZZ company",
    run: (ctx) => ensure(ctx, role),
  })),
}];
export const ACCOUNT_JOURNEYS = accounts;

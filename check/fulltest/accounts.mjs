// The full test: its two fixed ZZ accounts, the host and the seeker. The
// first run registers and confirms each; every later run finds it there and
// signs in. Their passwords are made by --setup and live only in the
// settings file on the operator's machine.
import { APEX, mustBeZZ, differs, skip } from "./core.mjs";
import { windowFor, go, see, text, signIn } from "./browser.mjs";
import { made, acct, stampOf, emailLink, registerByHand } from "./kit.mjs";

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
    /* No such account yet: a person registers it (the human check refuses an automated browser). */
    await registerByHand(ctx, { url: `${APEX}/hub/?join=1`, what: `the ZZ ${role} account`, password: a.password, fields: [
      ["Your name", a.company], ["Company", a.company], ["Email", a.email],
      ["Country", ctx.settings.new_account.country || "United Kingdom"], ["Town", ctx.settings.new_account.town || "Leeds"]] });
    m[`${role}Registered`] = true;
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
    id: role, does: `Signs in as the ZZ ${role}; the first time, you register it in your own Chrome and the runner confirms it from its email`,
    shows: "The name chip; the live site names the ZZ company",
    run: (ctx) => ensure(ctx, role),
  })),
}];
export const ACCOUNT_JOURNEYS = accounts;

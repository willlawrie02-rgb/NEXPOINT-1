// The full test's script: every journey, in order. Each area is its own file
// (ways-in, hubs, board, admin); this file holds the phone pass, the emails and the order.
import { APEX, PRINT, MILL, OPPS, API, Refused, Soft, mustBeZZ, isZZ, isZZSlug, differs, wait, skip, hand, askEnter, askLine } from "./core.mjs";
import { windowFor, go, see, shows, text, whoAmI, apiGet, signIn, signOut, adminWindow, adminGo, saveVia, wantDirect, ADMIN, allow, pollUntil, invoiceRaised } from "./browser.mjs";
import { same, made, acct, today, MARK, stampOf, newcomer, pageErrors, typeahead, fillIfEmpty, emailLink, pdfOk, nearest, termsOf, HUBS, openAnswer, answer, findForm, search, cardOf, companyPage, prospectName, prospectRow, openProspect, fits } from "./kit.mjs";
import { WAYS_IN } from "./ways-in.mjs";
import { HUB_JOURNEYS } from "./hubs.mjs";
import { BOARD_JOURNEYS } from "./board.mjs";
import { ADMIN_JOURNEYS, ADMIN_RESTORE } from "./admin.mjs";

// ================================================================ 7. the phone pass
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

export const JOURNEYS = [].concat(ADMIN_RESTORE, WAYS_IN, HUB_JOURNEYS, BOARD_JOURNEYS, ADMIN_JOURNEYS, phone, mail);

/* What the runner cannot judge. Always printed at the foot of the report. */
export const BY_HAND = [
  "A real phone: the phone pass is Chrome at phone width, not a phone.",
  "Money: voiding in Xero each invoice the run raised (listed below), a card payment, and how each invoice and statement reads in Xero.",
  "Smartlead: accepting a prospect onto one or two campaigns, and the turn passing between them (queue DA9).",
  "How each screen and each email reads. The runner checks an email arrived, not that it reads well.",
  "Queue CY10b case 3 (a login deleted in the Supabase dashboard) and CY10c (the count, in the SQL editor).",
  "Queue CY11's proof of the fallback: turning fast saves off and on again is a change in the SQL editor.",
  "The home page's desk form and the Education sign-up. The daily canary posts one each morning.",
  "A monthly declaration, and that the seeker gets no email when a host declares.",
  "Queue DB5, the ZZ clear-out, including what this run left behind (listed below).",
];

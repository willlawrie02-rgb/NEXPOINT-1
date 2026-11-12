// The full test: the 3D Print Hub and the Mill Hub: list, search, pick, introduce.
import { APEX, PRINT, MILL, OPPS, API, Refused, Soft, mustBeZZ, isZZ, isZZSlug, differs, wait, skip, hand, askEnter, askLine } from "./core.mjs";
import { windowFor, go, see, shows, text, whoAmI, apiGet, signIn, signOut, adminWindow, adminGo, saveVia, wantDirect, ADMIN, allow, pollUntil, invoiceRaised } from "./browser.mjs";
import { same, made, acct, today, MARK, stampOf, newcomer, pageErrors, typeahead, fillIfEmpty, emailLink, pdfOk, nearest, termsOf, HUBS, openAnswer, answer, findForm, search, cardOf, companyPage, prospectName, prospectRow, openProspect, fits } from "./kit.mjs";

const APPROVE_BY_HAND = "the ZZ host's listing waits for approval. Approving a first listing raises a real membership invoice in Xero, " +
  "so the runner never presses it: approve it yourself in the Inbox, void the invoice, then run the test again";
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

export const HUB_JOURNEYS = HUBS.map(hubJourney);

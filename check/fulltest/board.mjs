// The full test: the Opportunities Board.
import { APEX, PRINT, MILL, OPPS, API, Refused, Soft, mustBeZZ, isZZ, isZZSlug, differs, wait, skip, hand, askEnter, askLine } from "./core.mjs";
import { windowFor, go, see, shows, text, whoAmI, apiGet, signIn, signOut, adminWindow, adminGo, saveVia, wantDirect, ADMIN, allow, pollUntil, invoiceRaised } from "./browser.mjs";
import { same, made, acct, today, MARK, stampOf, newcomer, pageErrors, typeahead, fillIfEmpty, emailLink, pdfOk, nearest, termsOf, HUBS, openAnswer, answer, findForm, search, cardOf, companyPage, prospectName, prospectRow, openProspect, fits } from "./kit.mjs";

// ================================================================ 4. the board
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

export const BOARD_JOURNEYS = [].concat(board);

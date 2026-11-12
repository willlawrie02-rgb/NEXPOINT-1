// The full test: the Opportunities Board, and the desk forms that reach the admin's Desk
// (action list 1.4 and 8.1 to 8.13).
import { APEX, PRINT, MILL, OPPS, API, Refused, Soft, mustBeZZ, isZZ, isZZSlug, differs, wait, skip, hand, askEnter, askLine } from "./core.mjs";
import { windowFor, go, see, shows, text, whoAmI, apiGet, signIn, signOut, adminWindow, adminGo, saveVia, wantDirect, ADMIN, allow, pollUntil, invoiceRaised } from "./browser.mjs";
import { same, made, acct, today, MARK, stampOf, newcomer, pageErrors, typeahead, fillIfEmpty, emailLink, pdfOk, nearest, termsOf, HUBS, openAnswer, answer, findForm, search, cardOf, companyPage, prospectName, prospectRow, openProspect, fits } from "./kit.mjs";

/* What this file's steps send, and nothing more. The never-lists in browser.mjs still win. */
allow({
  accountPosts: ["/requests", "/opportunities/code", "/introductions/accept"],
  adminIntents: ["review-web-request", "save-board-opportunity", "publish-to-live-site", "introduce-on-board",
    "end-board-opportunity", "record-code-sales", "desk-reply", "desk-close", "desk-reopen", "desk-add-to-contacts"],
});

// ================================================================ local helpers
const LISTINGS = "listings.html?tab=opportunities";
/* The admin's name for a web request (admin/listings.html requestsPanel). */
const enq = (id) => `ENQ-${String(id).padStart(4, "0")}`;
/* The worker opens no Desk conversation for an address on our own domain
   (desk.js isOurs: the daily canary posts from it, and the Desk never reads our
   own mail in). The same rule, so a step can say why there is no row. */
const isOurs = (email) => {
  const d = String(email || "").trim().toLowerCase().split("@").pop();
  return !d || d === "nexpoint.co.uk" || d.endsWith(".nexpoint.co.uk");
};
const OURS_WHY = "the address is on nexpoint.co.uk, and the worker opens no Desk conversation for our own domain (desk.js isOurs)";
/* The seeker's address with a tag for this run, so the conversation's address
   is one Contacts does not hold yet and Add to Contacts can take it. Mail to
   it lands in the seeker's own mailbox (mail.mjs boxFor reads plus addresses). */
function tagged(email, tag) {
  const [local, domain] = String(email || "").trim().split("@");
  if (!local || !domain) return email;
  return local.includes("+") ? `${local}-${tag}@${domain}` : `${local}+${tag}@${domain}`;
}
/* The quarter before this one, as YYYY-Qn. */
function lastQuarter(d = new Date()) {
  let y = d.getFullYear(), q = Math.floor(d.getMonth() / 3);
  if (q === 0) { y -= 1; q = 4; }
  return `${y}-Q${q}`;
}
const clearToast = (page) => page.evaluate(() => { const t = document.getElementById("toast"); if (t) t.textContent = ""; });
/* Presses a button and reads the toast the press writes. */
async function press(page, selector, toast, what) {
  await clearToast(page);
  await page.click(selector);
  return see(page, "#toast", toast, what, 20000);
}
/* Opens the board in an account's window, once the account has unlocked it. */
async function board(ctx, role) {
  const w = await signIn(ctx, role);
  await go(w.page, `${OPPS}/`);
  await w.page.locator("body[data-np-open]").waitFor({ state: "attached", timeout: 25000 });
  await w.page.waitForLoadState("networkidle").catch(() => {});
  return w;
}
/* Posts on the board as the role: "Offering New Opportunities" or "Seeking New
   Opportunities", anonymous. Answers the request id the worker gave, and
   whether a terms tick was shown. Calls ctx.did() once the worker has the post. */
async function postOnBoard(ctx, role, direction, fit) {
  const w = await board(ctx, role);
  await w.page.click("#post button.btn-primary");
  await w.page.locator("#formOverlay.open #formContent form").waitFor({ state: "visible" });
  const choice = w.page.locator(`#formContent input[name=direction][value="${direction}"]`);
  if (await choice.count()) await choice.check({ force: true });
  else if (ctx.world.terms2) differs("the post form on Terms 2.0", "no choice of offering or seeking", direction);
  await w.page.fill("#formContent textarea[name=fit]", fit);
  const tickSel = "#formContent [data-post-terms] [data-np-terms-tick]";
  const ticked = await shows(w.page, tickSel, 6000);
  if (ticked) await w.page.check(tickSel);
  const sent = w.page.waitForResponse((r) => r.url() === `${API}/requests` && r.request().method() === "POST", { timeout: 30000 });
  await w.page.click("#formContent button[type=submit]:not([disabled])");
  const r = await sent, j = await r.json().catch(() => ({}));
  if (r.ok()) ctx.did();
  await see(w.page, "#formContent .success", "Received.", "after posting", 30000);
  return { w, id: j.id || null, ticked };
}
/* Asks for an introduction on a live card as the seeker. Answers the request id. */
async function requestOn(ctx, ref, note) {
  const w = await board(ctx, "seeker");
  const card = `#grid .op[data-ref="BRIEF ${ref}"]`;
  if (!(await shows(w.page, card, 8000))) wait(`${ref} is not on the board yet (the engine publishes it at its next run)`);
  await w.page.click(card);
  await w.page.locator("#briefOverlay.open #briefContent [data-id]").first().waitFor({ state: "visible" });
  if (!(await text(w.page, "#briefContent")).includes(ref.replace(/^BRIEF\s+/, ""))) throw new Refused("refused: the open card is not the ZZ card");
  await w.page.locator("#briefContent [data-id]", { hasText: "Request an introduction" }).click();
  await w.page.locator("[data-np-send]").waitFor({ state: "visible" });
  if (await shows(w.page, "[data-np-terms] [data-np-terms-tick]", 6000)) await w.page.check("[data-np-terms] [data-np-terms-tick]");
  await w.page.fill("#gNotes", note);
  const sent = w.page.waitForResponse((r) => r.url() === `${API}/requests` && r.request().method() === "POST", { timeout: 30000 });
  await w.page.click("[data-np-send]:not([disabled])");
  const r = await sent, j = await r.json().catch(() => ({}));
  if (r.ok()) ctx.did();
  await see(w.page, ".success", "Received, in confidence.", "after requesting", 30000);
  if (ctx.mail.s.desk) ctx.mail.expect(`Desk notice: an introduction requested on ${ref}`, ctx.mail.s.desk, "User request:");
  return j.id || null;
}
/* A request row on Live Listings, by its ENQ number, proved to be the ZZ company's. */
async function requestRow(w, id, company, email) {
  const row = w.page.locator(".item", { hasText: enq(id) }).first();
  if (!(await row.count())) return null;
  const words = (await row.textContent()) || "";
  mustBeZZ(company, `the company on ${enq(id)}`);
  if (!words.includes(company) || (email && !words.toLowerCase().includes(String(email).toLowerCase()))) {
    throw new Refused(`refused: ${enq(id)} is not the ZZ company's request`);
  }
  return row;
}
/* Declines a board request with a note: the board's own "Decline with a note"
   (admin/listings.html), a review-web-request with status declined. */
async function declineRequest(ctx, id, company, email) {
  const w = await adminGo(ctx, LISTINGS);
  const row = await requestRow(w, id, company, email);
  if (!row) differs(`${enq(id)} on Live Listings`, "not listed", "the ZZ request, waiting");
  await row.locator(`[data-act="openUi"][data-ui="declinereq:${id}"]`).click();
  await w.page.fill(`#dr-why-${id}`, `${MARK}: test data, declined by the test.`);
  await press(w.page, `[data-act="declineRequest"][data-req="${id}"]`, /Declined, queued/, "after Decline");
  ctx.did();
}
/* An opportunity's card on Live Listings once nothing is queued on it, or null. */
async function settledCard(ctx, id) {
  const w = await adminGo(ctx, LISTINGS);
  const card = w.page.locator(`#opp-${id}`);
  if (!(await card.count())) return null;
  if (/Queued, moments away/.test((await card.textContent()) || "")) return null;
  return w;
}
async function cardWhen(ctx, id, why) {
  await adminWindow(ctx);
  const w = await pollUntil(() => settledCard(ctx, id));
  if (!w) wait(why);
  const fail = w.page.locator(`#opp-${id} .fail-line`);
  if (await fail.count()) differs(`the card ${id} on Live Listings`, await fail.first().textContent(), "no failure");
  return w;
}
const ownedBy = async (w, id, owner) => (await text(w.page, `#opp-${id} .opp-facts`).catch(() => "")).includes(owner);
/* Review and publish: opens the editor and sets the card live. Waits when the
   editor asks for a save first (it filled in the owner's one account itself). */
async function publishCard(ctx, w, id) {
  await w.page.click(`[data-act="openEditor"][data-opp="${id}"]`);
  await w.page.locator(`[data-act="publish"][data-opp="${id}"]`).waitFor({ state: "visible" });
  await clearToast(w.page);
  await w.page.click(`[data-act="publish"][data-opp="${id}"]`);
  if (await shows(w.page, '#toast:has-text("Save your changes first")', 2500)) {
    await w.page.click('[data-act="saveEditor"]');
    wait("the card's editor asked for a save first; it is saved at the engine's next run, then the runner publishes it");
  }
  await w.page.locator(`#opp-${id} .opp-top .stage`, { hasText: /live/i }).waitFor({ state: "visible", timeout: 20000 })
    .catch(async () => differs("the card after Publish", `${await text(w.page, `#opp-${id} .opp-top .stage`).catch(() => "")} · ${await text(w.page, "#toast").catch(() => "")}`, "Live"));
}
/* Ends a card, reason "test data". */
async function endCard(ctx, id, owner) {
  const w = await adminGo(ctx, LISTINGS);
  mustBeZZ(owner, "the card's owner");
  if (!(await ownedBy(w, id, owner))) throw new Refused("refused: the card's owner is not the ZZ host");
  await w.page.click(`#opp-${id} [data-ui="end:${id}"]`);
  await w.page.fill(`#en-why-${id}`, "test data");
  await w.page.click(`#opp-${id} [data-act="end"]`);
  ctx.did();
  await see(w.page, "#toast", /queued/i, "after ending the card");
}
/* The card has left Live Listings' working list and the seeker's board. */
async function cardGone(ctx, id, ref) {
  await adminWindow(ctx);
  const off = await pollUntil(async () => {
    const w = await adminGo(ctx, LISTINGS);
    return (await w.page.locator(`#opp-${id}`).count()) ? null : w;
  });
  if (!off) wait(`${ref} is still in the working list on Live Listings (the engine ends it within a minute or two)`);
  if (!(await text(off.page, "details.archive").catch(() => "")).includes(ref)) differs(`${ref} after ending`, "not under Ended", "under Ended");
  const w = await board(ctx, "seeker");
  if (await shows(w.page, `#grid .op[data-ref="BRIEF ${ref}"]`, 3000)) wait(`${ref} is still on the public board (it comes off at the engine's next publish)`);
}

/* The Desk: one conversation, once the check says it is ready. Every press reads
   the ZZ name first: the subject is "Question from <company>" (desk.js opening). */
async function deskOpen(ctx, id) {
  const w = await adminGo(ctx, `desk.html?thread=${id}`);
  await w.page.locator("#th-h").waitFor({ state: "visible", timeout: 20000 });
  return w;
}
async function deskName(w) {
  const who = (await text(w.page, "#th-h")).replace(/^Question from\s+/i, "");
  mustBeZZ(who, "the Desk conversation");
  return who;
}
async function deskWhen(ctx, id, ready, why) {
  await adminWindow(ctx);
  const w = await pollUntil(async () => {
    const w = await deskOpen(ctx, id);
    if (await w.page.locator(".panel.thread .status-line.fail").count()) return w;
    return (await ready(w.page)) ? w : null;
  });
  if (!w) wait(why);
  const fail = w.page.locator(".panel.thread .status-line.fail");
  if (await fail.count()) differs(`DESK-${String(id).padStart(4, "0")}`, await fail.first().textContent(), "no failure");
  await deskName(w);
  return w;
}
const has = (selector) => async (page) => (await page.locator(selector).count()) > 0;
/* Finds the conversation whose list entry carries these words, on the Open view. */
async function deskFind(ctx, words, why) {
  await adminWindow(ctx);
  const href = await pollUntil(async () => {
    const w = await adminGo(ctx, "desk.html");
    const item = w.page.locator("a.titem", { hasText: words }).first();
    return (await item.count()) ? item.getAttribute("href") : null;
  });
  if (!href) wait(why);
  const m = /thread=(\d+)/.exec(href || "");
  if (!m) differs("the conversation's link", href, "desk.html?thread=<number>");
  return Number(m[1]);
}
/* Add to Contacts on a conversation not yet matched. A company name, when given,
   makes that company in Contacts as well (desk_handlers.desk_add_to_contacts). */
async function deskAdd(ctx, id, person, company) {
  const w = await deskWhen(ctx, id, has(`[data-act="close"][data-thread="${id}"], [data-act="reopen"][data-thread="${id}"]`),
    "the conversation has a change queued; it clears at the engine's next run");
  if (!(await w.page.locator(`[data-act="openAdd"][data-thread="${id}"]`).count())) {
    skip(`no Add to Contacts: the conversation is already matched in Contacts by its address (${(await text(w.page, ".thread-head .ditem-meta")).slice(0, 120)})`);
  }
  await w.page.click(`[data-act="openAdd"][data-thread="${id}"]`);
  await w.page.locator("#dk-name").waitFor({ state: "visible" });
  mustBeZZ(person, "the person to add");
  await w.page.fill("#dk-name", person);
  if (await w.page.locator("#dk-co").count()) {
    if (company) mustBeZZ(company, "the company to add");
    await w.page.fill("#dk-co", company || "");
  }
  await press(w.page, `[data-act="add"][data-thread="${id}"]`, /Added to Contacts, queued/, "after Add to Contacts");
  ctx.did();
}
/* What Add to Contacts made: the conversation now names its person, from Contacts. */
async function deskAdded(ctx, id, person) {
  const w = await deskWhen(ctx, id, async (page) => !(await text(page, ".thread-head .ditem-meta")).includes("Not in Contacts yet"),
    "Add to Contacts is made at the engine's next run");
  const who = await text(w.page, ".thread-head .ditem-meta");
  const name = (/^From (.+?)(?:, in Contacts|, | ·)/.exec(who) || [])[1] || "";
  if (!isZZ(name) || !same(name, person)) differs("the person Add to Contacts made", name || who, person);
  const company = await w.page.locator(".thread-head .ditem-meta a[href^='company.html?id=']").first().textContent().catch(() => "");
  if (company && !isZZ(company)) differs("the company the person joined", company, "a ZZ company");
  return company ? `made ${name}, at ${company.trim()}, in Contacts` : `made ${name} in Contacts, with no company`;
}

// ================================================================ 1.4 the portal door's desk form
const door = {
  id: "board.door", title: "The portal door's desk form, as a stranger, to the admin's Desk", pass: "computer",
  needs: ["seeker"],
  from: "action list 1.4; the Desk steps need the admin, and Add to Contacts finishes at the engine's next run",
  steps: [
    { id: "form", once: true, does: "A stranger opens Talk to the desk on the portal door and sends it (\"ZZ Full Test Desk …\")",
      shows: "\"Received, in confidence.\"; the desk notice",
      run: async (ctx) => {
        const m = made(ctx), stamp = stampOf(ctx);
        m.company = `ZZ Full Test Desk ${stamp}`;
        m.name = "ZZ Full Test Desk";
        m.email = tagged(acct(ctx, "seeker").email, `desk-${stamp.toLowerCase()}`);
        m.notes = `${MARK} ${stamp}: a test question to the desk from the portal door, please ignore.`;
        mustBeZZ(m.company, "the company on the desk form");
        const w = ctx.lastWindow = await windowFor(ctx, "stranger");
        await go(w.page, `${APEX}/hub/`);
        await w.page.locator(`button[onclick*="Talk to the desk"]`).first().click();
        await w.page.locator("#introOverlay.open #introContent form").waitFor({ state: "visible" });
        await w.page.fill("#iName", m.name);
        await w.page.fill("#iCompany", m.company);
        await w.page.fill("#iEmail", m.email);
        await w.page.fill("#iWhere", "Leeds, United Kingdom");
        await w.page.fill("#iNotes", m.notes);
        const sent = w.page.waitForResponse((r) => r.url() === `${API}/requests` && r.request().method() === "POST", { timeout: 30000 });
        await w.page.click("#introContent button[type=submit]");
        if ((await sent).ok()) ctx.did();
        await see(w.page, "#introContent .success", "Received, in confidence.", "after sending the desk form", 30000);
        if (ctx.mail.s.desk) ctx.mail.expect("Desk notice: a question from the portal door", ctx.mail.s.desk, `User request: a desk enquiry from ${m.company}`);
        return `sent as ${m.email}`;
      } },
    { id: "row", does: "Admin, Desk: the stranger's conversation", shows: "Its row, \"DESK-…\", sent through Talk to the desk on the portal's home page, with the message",
      run: async (ctx) => {
        const m = made(ctx);
        if (isOurs(m.email)) skip(OURS_WHY);
        m.thread = m.thread || await deskFind(ctx, m.company, `${m.company} is not on the Desk yet (the engine opens it at its next run when the worker could not)`);
        const w = await deskOpen(ctx, m.thread);
        if (!same(await deskName(w), m.company)) throw new Refused("refused: the conversation is not the ZZ stranger's");
        await see(w.page, ".thread-head", /DESK-\d{4}/, "the conversation's reference");
        await see(w.page, ".thread-head", "the NexPoint Global Portal's home page", "where it came from");
        await see(w.page, ".msgs", m.notes, "the stranger's message");
        ctx.left.push(`the Desk conversation from ${m.company}`);
      } },
    { id: "add", once: true, does: "Admin, Desk: Add to Contacts, with the ZZ name and company", shows: "Queued",
      run: async (ctx) => {
        const m = made(ctx);
        if (!m.thread) skip(isOurs(m.email) ? OURS_WHY : "no conversation to add");
        await deskAdd(ctx, m.thread, m.name, m.company);
      } },
    { id: "added", does: "Admin, Desk: the conversation after Add to Contacts", shows: "\"From ZZ Full Test Desk, ZZ Full Test Desk …\": a ZZ person at a ZZ company in Contacts",
      run: async (ctx) => {
        const m = made(ctx);
        if (!m.thread) skip(isOurs(m.email) ? OURS_WHY : "no conversation to read");
        const note = await deskAdded(ctx, m.thread, m.name);
        ctx.left.push(`in Contacts: ${m.name} and ${m.company}, from the Desk`);
        return note;
      } },
    { id: "close", once: true, does: "Admin, Desk: Close the conversation, so no test question waits on us", shows: "Queued",
      run: async (ctx) => {
        const m = made(ctx);
        if (!m.thread) skip(isOurs(m.email) ? OURS_WHY : "no conversation to close");
        const w = await deskWhen(ctx, m.thread, has(`[data-act="close"][data-thread="${m.thread}"]`), "the conversation has a change queued; it clears at the engine's next run");
        await press(w.page, `[data-act="close"][data-thread="${m.thread}"]`, /Closed, queued/, "after Close");
        ctx.did();
      } },
  ],
};

// ================================================================ 8. the board: the host's card
const card = {
  id: "board.card", title: "The Opportunities Board: post, approve, edit, publish, request, accept, a second request declined", pass: "computer",
  needs: ["host", "seeker", "admin", "window"],
  from: "action list 8.1, 8.3 to 8.7 and 8.13; waits on the engine (the brief-writer runs every two hours), so it takes several runs across a day",
  steps: [
    { id: "post", once: true, does: "Host posts an opportunity (\"ZZ full test …\", anonymous; on 2.0 as \"offering\")", shows: "\"Received.\"; the desk notice; no terms when the Host Agreement is held",
      run: async (ctx) => {
        const m = made(ctx);
        m.fit = `${MARK} ${stampOf(ctx)}: a test post, please ignore.`;
        const { id, ticked } = await postOnBoard(ctx, "host", "Offering New Opportunities", m.fit);
        m.post = id;
        if (ctx.mail.s.desk) ctx.mail.expect("Desk notice: an opportunity posted", ctx.mail.s.desk, "an opportunity from");
        return ticked ? "the Host Agreement was shown and ticked: this account did not hold it yet" : "no terms shown: the Host Agreement is held";
      } },
    { id: "approve", once: true, does: "Admin, Live Listings: Approve and draft the brief, on the ZZ host's post", shows: "Queued",
      run: async (ctx) => {
        const host = acct(ctx, "host").company, w = await adminGo(ctx, LISTINGS);
        const row = w.page.locator(".item", { hasText: made(ctx).fit }).first();
        await row.waitFor({ state: "visible" }).catch(() => differs("the post under Posts to approve", "not listed", made(ctx).fit));
        if (!(await row.textContent()).includes(host)) throw new Refused("refused: the post is not from the ZZ host");
        mustBeZZ(host, "the post to approve");
        await row.locator('[data-act="reviewRequest"][data-status="approved"]').click();
        ctx.did();
        await see(w.page, "#toast", /queued/i, "after approving");
      } },
    { id: "edit", once: true, does: "Admin: Review and publish on the drafted card owned by the ZZ host, change its headline, Save", shows: "Queued",
      run: async (ctx) => {
        const host = acct(ctx, "host").company, m = made(ctx), w = await adminGo(ctx, LISTINGS);
        mustBeZZ(host, "the card's owner");
        const c = cardOf(w, host, "Review and publish");
        if (!(await c.count())) wait("the brief-writer drafts the ZZ card at the engine's next run (every two hours)");
        const id = (await c.getAttribute("id")).replace(/^opp-/, "");
        if (!(await ownedBy(w, id, host))) throw new Refused("refused: the draft card's owner is not the ZZ host");
        Object.assign(m, { opp: id, ref: await text(w.page, `#opp-${id} .opp-top .ref`), head: `ZZ full test card ${stampOf(ctx)}, please ignore` });
        await w.page.click(`[data-act="openEditor"][data-opp="${id}"]`);
        await w.page.locator("#f_head").waitFor({ state: "visible" });
        await w.page.fill("#f_head", m.head);
        await press(w.page, '[data-act="saveEditor"]', /Saved .*queued/, "after Save");
        ctx.did();
        ctx.left.push(`the board card ${m.ref} (the runner ends it at the last step)`);
      } },
    { id: "publish", once: true, does: "Admin: Review and publish again, once the save has landed; Publish", shows: "The headline as saved; the card reads Live",
      run: async (ctx) => {
        const host = acct(ctx, "host").company, m = made(ctx);
        const w = await cardWhen(ctx, m.opp, `the save on ${m.ref} lands at the engine's next run`);
        if (!(await ownedBy(w, m.opp, host))) throw new Refused("refused: the card's owner is not the ZZ host");
        await w.page.click(`[data-act="openEditor"][data-opp="${m.opp}"]`);
        await w.page.locator("#f_head").waitFor({ state: "visible" });
        const head = await w.page.inputValue("#f_head");
        if (head !== m.head) differs("the headline after the save", head, m.head);
        await w.page.click('[data-act="closeEditor"]');
        await publishCard(ctx, w, m.opp);
        ctx.did();
      } },
    { id: "shown", does: "Seeker opens the board", shows: "The new card, by its NX number",
      run: async (ctx) => {
        const w = await board(ctx, "seeker");
        if (!(await shows(w.page, `#grid .op[data-ref="BRIEF ${made(ctx).ref}"]`, 8000))) wait(`${made(ctx).ref} reaches the public board at the engine's next run`);
      } },
    { id: "request", once: true, does: "Seeker requests an introduction on that card", shows: "\"Received, in confidence.\"; the desk notice",
      run: async (ctx) => {
        const m = made(ctx);
        m.req = await requestOn(ctx, m.ref, `${MARK}: a test request, please ignore.`);
      } },
    { id: "introduce", once: true, does: "Admin: Introduce, on the ZZ seeker's request (fee in words \"Test data, no fee\")", shows: "Queued",
      run: async (ctx) => {
        const s = acct(ctx, "seeker"), m = made(ctx), w = await adminGo(ctx, LISTINGS);
        mustBeZZ(s.company, "the company to introduce");
        let row = m.req ? await requestRow(w, m.req, s.company, s.email) : null;
        if (!row) row = w.page.locator(".item", { hasText: s.company }).filter({ has: w.page.locator('[data-ui^="introreq:"]') }).first();
        await row.waitFor({ state: "visible" }).catch(() => differs("the request under Introductions to make", "not listed", s.company));
        if (!(await row.textContent()).includes(s.company)) throw new Refused("refused: the request is not the ZZ seeker's");
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
        m.introRef = await text(w.page, `#intro-${m.intro} .acct-ref`).catch(() => "");
        await see(w.page, `#intro-${m.intro}`, "Waiting for your answer", "the owner's row");
        ctx.mail.expect(`The offer to the owner, ${m.ref}`, acct(ctx, "host").email, "New introduction for you");
        if (!/^INTRO-\d+/.test(m.introRef)) differs("the introduction's reference on the row", m.introRef, "INTRO-…");
      } },
    { id: "owner-answer", once: true, does: "Host opens the answer, then accepts", shows: "No terms on 2.0; \"Introduced on…\"; the introduction email to both, with Will and Chris in copy",
      run: async (ctx) => {
        const w = await signIn(ctx, "host"), m = made(ctx);
        await openAnswer(ctx, w, m.intro);
        /* The email's subject carries the INTRO reference, not the card's NX one (emails.js contact_release). */
        const note = await answer(ctx, w, m.intro, { accept: true, ref: m.introRef, seeker: acct(ctx, "seeker").email, host: acct(ctx, "host").email });
        ctx.left.push(`the accepted introduction ${m.introRef} on ${m.ref}`);
        return note;
      } },
    { id: "request-again", once: true, does: "Seeker asks for an introduction on the same card a second time", shows: "\"Received, in confidence.\"; the desk notice",
      run: async (ctx) => {
        const m = made(ctx);
        m.req2 = await requestOn(ctx, m.ref, `${MARK}: a second test request, please ignore.`);
        if (!m.req2) differs("the second request", "no request number in the worker's answer", "a number");
      } },
    { id: "decline-request", once: true, does: "Admin, Live Listings: Decline with a note, on the second request", shows: "Queued; the seeker is told",
      run: async (ctx) => {
        const s = acct(ctx, "seeker"), m = made(ctx);
        await declineRequest(ctx, m.req2, s.company, s.email);
        /* The action list says the requester is told. review-web-request (handlers.py) writes the
           status and the note and sends nothing, so this email is expected to be missing until it does. */
        /* The engine sends no email when a board request is declined (board_handlers _review_web_request writes the status only). */
        ctx.notes.push("Declining a board introduction request emails nobody: the requester is not told (a finding for Will).");
        return "declined; note: the engine's review-web-request sends the requester no email";
      } },
    { id: "declined", does: "Admin, Live Listings: the second request after declining", shows: "It has left Introductions to make",
      run: async (ctx) => {
        const s = acct(ctx, "seeker"), m = made(ctx);
        await adminWindow(ctx);
        const gone = await pollUntil(async () => {
          const w = await adminGo(ctx, LISTINGS);
          return (await requestRow(w, m.req2, s.company, s.email)) ? null : true;
        });
        if (!gone) wait(`${enq(m.req2)} is declined at the engine's next run`);
      } },
    { id: "end", once: true, does: "Admin: Ends the card, reason \"test data\"", shows: "Queued",
      run: async (ctx) => endCard(ctx, made(ctx).opp, acct(ctx, "host").company) },
    { id: "gone", does: "Admin and seeker: the ended card", shows: "Under Ended on Live Listings, out of the working list; off the board",
      run: async (ctx) => cardGone(ctx, made(ctx).opp, made(ctx).ref) },
  ],
};

// ================================================================ 8.2, 8.3 the seeker's post, declined
const seek = {
  id: "board.seek", title: "The Opportunities Board: the seeker posts what it seeks; the admin declines it", pass: "computer",
  needs: ["seeker", "admin", "window"],
  from: "action list 8.2 and 8.3",
  steps: [
    { id: "post", once: true, does: "Seeker posts what it seeks (\"ZZ full test …\", anonymous, \"seeking\")", shows: "\"Received.\"; the desk notice; the Seeker Agreement held",
      run: async (ctx) => {
        const m = made(ctx);
        m.fit = `${MARK} ${stampOf(ctx)}: a test post of what we seek, please ignore.`;
        const { w, id, ticked } = await postOnBoard(ctx, "seeker", "Seeking New Opportunities", m.fit);
        m.post = id;
        if (!id) differs("the post", "no request number in the worker's answer", "a number");
        if (ctx.mail.s.desk) ctx.mail.expect("Desk notice: a seeker's post", ctx.mail.s.desk, "an opportunity from");
        if (ctx.world.terms2) {
          const t = await termsOf(w, "seeker");
          if (!(t && t.accepted)) differs("the Seeker Agreement after posting", t ? "not accepted" : "not read", "accepted");
        }
        return ticked ? "the Seeker Agreement was shown and ticked" : "no terms shown: the Seeker Agreement was already held";
      } },
    { id: "decline", once: true, does: "Admin, Live Listings: Decline with a note, on the ZZ seeker's post", shows: "Queued; the seeker is told",
      run: async (ctx) => {
        const s = acct(ctx, "seeker"), m = made(ctx);
        await declineRequest(ctx, m.post, s.company, s.email);
        /* The engine sends no email when a board post is declined. */
        ctx.notes.push("Declining a board post emails nobody: the company that posted is not told (a finding for Will).");
        return "declined; note: the engine's review-web-request sends the seeker no email";
      } },
    { id: "declined", does: "Admin, Live Listings: the post after declining", shows: "It has left Posts to approve",
      run: async (ctx) => {
        const s = acct(ctx, "seeker"), m = made(ctx);
        await adminWindow(ctx);
        const gone = await pollUntil(async () => {
          const w = await adminGo(ctx, LISTINGS);
          return (await requestRow(w, m.post, s.company, s.email)) ? null : true;
        });
        if (!gone) wait(`${enq(m.post)} is declined at the engine's next run`);
      } },
  ],
};

// ================================================================ 8.8 to 8.10, 8.13 a discount code
const CODE = "ZZTEST";
const code = {
  id: "board.code", title: "The Opportunities Board: a discount code, shown on the click, its use logged and a quarter's sales recorded", pass: "computer",
  needs: ["host", "seeker", "admin", "window"],
  from: "action list 8.8 to 8.10 and 8.13; each save waits a minute or two on the engine",
  steps: [
    { id: "new", once: true, does: "Admin, Live Listings: New opportunity, kind Discount code, code ZZTEST, \"ZZ test code, please ignore\", a 5% rate; Save",
      shows: "Queued",
      run: async (ctx) => {
        const m = made(ctx), w = await adminGo(ctx, LISTINGS);
        m.title = `ZZ full test discount code ${stampOf(ctx)}, please ignore`;
        mustBeZZ(m.title, "the new opportunity");
        await w.page.click('[data-act="newOpp"]');
        await w.page.locator("#f_title").waitFor({ state: "visible" });
        await w.page.selectOption("#f_dir", "OFFERING");
        await w.page.selectOption("#f_cat", "materials");
        await w.page.fill("#f_head", m.title);
        await w.page.fill("#f_title", m.title);
        await w.page.fill("#f_regions", "United Kingdom");
        await w.page.fill("#f_sum", `${MARK}: a test discount code, please ignore.`);
        await w.page.selectOption("#f_naming", "anonymised");
        await w.page.selectOption("#f_kind", "discount_code");
        await w.page.fill("#f_code", CODE);
        await w.page.fill("#f_code_terms", "ZZ test code, please ignore");
        await w.page.selectOption("#f_fee_model", "recurring");
        await w.page.fill("#f_fee_rate", "5");
        await w.page.fill("#f_fee_note", "Test data, no fee");
        await w.page.fill("#f_fee_agreed", today());
        await press(w.page, '[data-act="saveEditor"]', /New opportunity saved/, "after Save");
        ctx.did();
      } },
    { id: "owner", once: true, does: "Admin: Set the owner on the new card to the ZZ host, and its site", shows: "Queued",
      run: async (ctx) => {
        const host = acct(ctx, "host").company, m = made(ctx);
        mustBeZZ(host, "the owner to set");
        await adminWindow(ctx);
        const w = await pollUntil(async () => {
          const w = await adminGo(ctx, LISTINGS);
          const c = w.page.locator("section.opp", { hasText: m.title }).first();
          return (await c.count()) && !/Queued, moments away/.test(await c.textContent()) ? w : null;
        });
        if (!w) wait("the engine makes the new opportunity at its next run");
        const c = w.page.locator("section.opp", { hasText: m.title }).first();
        m.opp = (await c.getAttribute("id")).replace(/^opp-/, "");
        m.ref = await text(w.page, `#opp-${m.opp} .opp-top .ref`);
        if (!(await text(w.page, `#opp-${m.opp} h3`)).includes(m.title)) throw new Refused("refused: the card is not the ZZ code card");
        ctx.left.push(`the discount-code card ${m.ref} (the runner ends it at the last step)`);
        await w.page.click(`[data-act="openUi"][data-ui="owner:${m.opp}"]`);
        await w.page.fill(`#ow-q-${m.opp}`, host);
        await w.page.click(`[data-act="findOwner"][data-opp="${m.opp}"]`);
        const opts = w.page.locator(`[data-act="pickOwner"][data-opp="${m.opp}"]`);
        let pick = -1;
        for (let i = 0; i < await opts.count(); i++) if (same(await opts.nth(i).textContent(), host)) { pick = i; break; }
        if (pick < 0) wait(`${host} is not in Contacts yet (the engine adopts the account at its next run)`);
        mustBeZZ((await opts.nth(pick).textContent()).trim(), "the company picked as owner");
        await opts.nth(pick).click();
        const site = w.page.locator(`#ow-site-${m.opp}`);
        if (await site.count() && !(await site.inputValue())) {
          const first = await site.locator("option").evaluateAll((os) => (os.find((o) => o.value) || {}).value || "");
          if (first) await site.selectOption(first);
        }
        await press(w.page, `[data-act="saveOwner"][data-opp="${m.opp}"]`, /Owner of .* set to/, "after Set the owner");
        ctx.did();
      } },
    { id: "publish", once: true, does: "Admin: Review and publish the code card, once its owner is set", shows: "The card reads Live; owner the ZZ host; model Discount code",
      run: async (ctx) => {
        const host = acct(ctx, "host").company, m = made(ctx);
        const w = await cardWhen(ctx, m.opp, `the owner of ${m.ref} is set at the engine's next run`);
        if (!(await ownedBy(w, m.opp, host))) wait(`the owner of ${m.ref} is not the ZZ host yet`);
        await see(w.page, `#opp-${m.opp} .opp-facts`, "Discount code", "the card's model");
        await publishCard(ctx, w, m.opp);
        ctx.did();
      } },
    { id: "never-on-card", does: "Seeker opens the board and the code card", shows: "The card with \"Discount code\" and \"See the code\"; ZZTEST nowhere on it, nor in what the board serves",
      run: async (ctx) => {
        const m = made(ctx), w = await board(ctx, "seeker");
        const sel = `#grid .op[data-ref="BRIEF ${m.ref}"]`;
        if (!(await shows(w.page, sel, 8000))) wait(`${m.ref} reaches the public board at the engine's next publish`);
        const face = await text(w.page, sel);
        if (!face.includes("Discount code") || !face.includes("See the code")) differs("the code card's face", face, "Discount code · See the code");
        if (face.toUpperCase().includes(CODE)) differs("the code card's face", "shows the code", "no code");
        const served = await apiGet(w.page, "/opportunities/briefs");
        const mine = ((served.body && served.body.briefs) || []).find((b) => String(b.ref || "").endsWith(m.ref));
        if (!mine) differs("what the board serves", "no brief for the code card", m.ref);
        if (JSON.stringify(mine).toUpperCase().includes(CODE)) differs("what the board serves for the code card", "carries the code", "no code");
        await w.page.click(sel);
        await w.page.locator("#briefOverlay.open #briefContent").waitFor({ state: "visible" });
        if ((await text(w.page, "#briefContent")).toUpperCase().includes(CODE)) differs("the open code card", "shows the code", "no code before Show the code");
      } },
    { id: "see-code", once: true, does: "Seeker: Show the code", shows: "ZZTEST, with \"ZZ test code, please ignore\"",
      run: async (ctx) => {
        const m = made(ctx), w = await board(ctx, "seeker");
        await w.page.click(`#grid .op[data-ref="BRIEF ${m.ref}"]`);
        await w.page.locator("#briefOverlay.open #briefContent").waitFor({ state: "visible" });
        if (!(await text(w.page, "#briefContent")).includes(m.title)) throw new Refused("refused: the open card is not the ZZ code card");
        const shown = w.page.waitForResponse((r) => r.url() === `${API}/opportunities/code` && r.request().method() === "POST", { timeout: 30000 });
        await w.page.locator("#briefContent button[data-id]", { hasText: "Show the code" }).click();
        const r = await shown;
        if (r.ok()) ctx.did();
        await see(w.page, "#formOverlay.open #formContent [data-code]", CODE, "the code", 20000);
        await see(w.page, "#formContent", "ZZ test code, please ignore", "what the code gives");
      } },
    { id: "logged", does: "Admin, Live Listings and Money: the code card after the reveal", shows: "\"1 use logged\" or more, on both",
      run: async (ctx) => {
        const m = made(ctx), w = await adminGo(ctx, LISTINGS);
        const facts = await text(w.page, `#opp-${m.opp} .opp-facts`);
        if (!/\b[1-9]\d* uses? logged/.test(facts)) differs(`${m.ref} on Live Listings`, facts, "1 use logged");
        const money = await adminGo(ctx, "money.html?tab=statements");
        const row = money.page.locator("tr", { hasText: m.ref }).first();
        if (!(await row.count())) differs(`${m.ref} on Money, Discount-code reports`, "no row", m.ref);
        const words = (await row.textContent()) || "";
        if (!/\b[1-9]\d* uses? logged/.test(words)) differs(`${m.ref} on Money`, words, "1 use logged");
      } },
    { id: "record", once: true, does: "Admin, Live Listings: Record a quarter's code sales on the code card (last quarter, 1 unit, GBP 1.00)", shows: "Queued",
      run: async (ctx) => {
        const host = acct(ctx, "host").company, m = made(ctx), w = await adminGo(ctx, LISTINGS);
        mustBeZZ(host, "the card's owner");
        if (!(await ownedBy(w, m.opp, host))) throw new Refused("refused: the card's owner is not the ZZ host");
        m.quarter = lastQuarter();
        await w.page.click(`[data-act="openUi"][data-ui="code:${m.opp}"]`);
        await w.page.fill(`#cs-q-${m.opp}`, m.quarter);
        await w.page.fill(`#cs-units-${m.opp}`, "1");
        await w.page.fill(`#cs-value-${m.opp}`, "1.00");
        await w.page.fill(`#cs-cur-${m.opp}`, "GBP");
        await w.page.fill(`#cs-note-${m.opp}`, `${MARK}: test data, no sale.`);
        await press(w.page, `[data-act="recordCode"][data-opp="${m.opp}"]`, /code sales, queued/, "after Record the quarter");
        ctx.did();
        ctx.left.push(`the ${m.quarter} code-sales report on ${m.ref} (never invoiced; Money offers Raise invoice in Xero, which the runner never presses)`);
      } },
    { id: "on-money", does: "Admin, Money: the quarter's code sales", shows: "The quarter, \"GBP 1.00 sold, fee GBP 0.05\", 1 unit",
      run: async (ctx) => {
        const m = made(ctx);
        await adminWindow(ctx);
        const words = await pollUntil(async () => {
          const w = await adminGo(ctx, "money.html?tab=statements");
          const row = w.page.locator("tr", { hasText: m.ref }).filter({ hasText: m.quarter }).filter({ hasText: "sold, fee" }).first();
          return (await row.count()) ? (await row.textContent()) || " " : null;
        });
        if (!words) wait(`the ${m.quarter} report on ${m.ref} is recorded at the engine's next run`);
        if (!/1\.00/.test(words) || !/0\.05/.test(words)) differs(`the ${m.quarter} row on Money`, words, "1.00 sold, fee 0.05");
      } },
    { id: "end", once: true, does: "Admin: Ends the code card, reason \"test data\"", shows: "Queued",
      run: async (ctx) => endCard(ctx, made(ctx).opp, acct(ctx, "host").company) },
    { id: "gone", does: "Admin and seeker: the ended code card", shows: "Under Ended on Live Listings, out of the working list; off the board",
      run: async (ctx) => cardGone(ctx, made(ctx).opp, made(ctx).ref) },
  ],
};

// ================================================================ 8.11, 8.12 the desk, from the board
const desk = {
  id: "board.desk", title: "Talk to the desk on the board, then the Desk: reply, close, reopen, add to Contacts", pass: "computer",
  needs: ["seeker", "admin", "window"],
  from: "action list 8.11 and 8.12; each Desk change waits a minute or two on the engine",
  steps: [
    { id: "talk", once: true, does: "Seeker: Talk to the desk, on the board (\"ZZ full test …\")", shows: "\"Received, in confidence.\"; the desk notice",
      run: async (ctx) => {
        const s = acct(ctx, "seeker"), m = made(ctx), w = await board(ctx, "seeker");
        m.notes = `${MARK} ${stampOf(ctx)}: a test question to the desk from the board, please ignore.`;
        await w.page.click('button[onclick="talkToDesk()"]');
        await w.page.locator("#npAccountContent [data-np-send]").waitFor({ state: "visible" });
        await see(w.page, "#npAccountContent h2", "Talk to the desk", "the desk form's heading");
        if (await shows(w.page, "#npAccountContent [data-np-terms-tick]", 2500)) differs("the desk form", "a terms tick", "no terms");
        await w.page.fill("#gNotes", m.notes);
        const sent = w.page.waitForResponse((r) => r.url() === `${API}/requests` && r.request().method() === "POST", { timeout: 30000 });
        await w.page.click("#npAccountContent [data-np-send]:not([disabled])");
        if ((await sent).ok()) ctx.did();
        await see(w.page, "#npAccountContent .success", "Received, in confidence.", "after sending", 30000);
        if (ctx.mail.s.desk) ctx.mail.expect("Desk notice: a question from the board", ctx.mail.s.desk, `User request: a desk enquiry from ${s.company}`);
      } },
    { id: "row", does: "Admin, Desk: the seeker's conversation", shows: "Its row, with the seeker's message",
      run: async (ctx) => {
        const s = acct(ctx, "seeker"), m = made(ctx);
        if (isOurs(s.email)) skip(OURS_WHY);
        m.thread = m.thread || await deskFind(ctx, m.notes, "the seeker's question is not on the Desk yet (the engine opens it at its next run when the worker could not)");
        const w = await deskOpen(ctx, m.thread);
        if (!same(await deskName(w), s.company)) throw new Refused("refused: the conversation is not the ZZ seeker's");
        m.subject = await text(w.page, "#th-h");
        await see(w.page, ".msgs", m.notes, "the seeker's message");
        ctx.left.push(`the Desk conversation from ${s.company}`);
      } },
    { id: "reply", once: true, does: "Admin, Desk: Send the reply \"ZZ full test: a test reply, please ignore.\"", shows: "Queued; the reply emails the ZZ seeker",
      run: async (ctx) => {
        const s = acct(ctx, "seeker"), m = made(ctx);
        if (!m.thread) skip(isOurs(s.email) ? OURS_WHY : "no conversation to answer");
        const w = await deskWhen(ctx, m.thread, has(`[data-act="send"][data-thread="${m.thread}"]`), "the conversation has a change queued; it clears at the engine's next run");
        await w.page.fill("#dk-reply", `${MARK}: a test reply, please ignore.`);
        await press(w.page, `[data-act="send"][data-thread="${m.thread}"]`, /Reply queued/, "after Send the reply");
        ctx.did();
        /* The Desk answers from hello@, never portal@ (desk.js DESK_SENDER_DEFAULT). */
        ctx.mail.expect(`The Desk's reply, ${m.subject}`, s.email, `Re: ${m.subject}`, { from: "hello@nexpoint.co.uk" });
      } },
    { id: "close", once: true, does: "Admin, Desk: Close the conversation, once the reply has gone", shows: "The reply sent, not failed; then Queued",
      run: async (ctx) => {
        const s = acct(ctx, "seeker"), m = made(ctx);
        if (!m.thread) skip(isOurs(s.email) ? OURS_WHY : "no conversation to close");
        const w = await deskWhen(ctx, m.thread, async (page) => (await page.locator(`[data-act="close"][data-thread="${m.thread}"]`).count()) > 0
          && (await page.locator(".msg.us").count()) > 0 && !(await text(page, ".msgs")).includes("Sending"),
          "the reply goes at the engine's next run");
        await see(w.page, ".msg.us", "Sent by", "our reply, once it has gone");
        await press(w.page, `[data-act="close"][data-thread="${m.thread}"]`, /Closed, queued/, "after Close");
        ctx.did();
      } },
    { id: "reopen", once: true, does: "Admin, Desk: Reopen the conversation", shows: "Closed first; then Queued",
      run: async (ctx) => {
        const s = acct(ctx, "seeker"), m = made(ctx);
        if (!m.thread) skip(isOurs(s.email) ? OURS_WHY : "no conversation to reopen");
        const w = await deskWhen(ctx, m.thread, has(`[data-act="reopen"][data-thread="${m.thread}"]`), "the close is made at the engine's next run");
        await see(w.page, ".panel.thread", "This conversation is closed", "the conversation once closed");
        await press(w.page, `[data-act="reopen"][data-thread="${m.thread}"]`, /Reopened, queued/, "after Reopen");
        ctx.did();
      } },
    { id: "add", once: true, does: "Admin, Desk: Add to Contacts, with a ZZ name and no company", shows: "Queued, or no button when the address is already in Contacts",
      run: async (ctx) => {
        const s = acct(ctx, "seeker"), m = made(ctx);
        if (!m.thread) skip(isOurs(s.email) ? OURS_WHY : "no conversation to add");
        m.person = `ZZ Full Test Desk Person ${stampOf(ctx)}`;
        await deskWhen(ctx, m.thread, has(`[data-act="close"][data-thread="${m.thread}"]`), "the reopen is made at the engine's next run");
        await deskAdd(ctx, m.thread, m.person, "");
        m.added = true;
      } },
    { id: "after", does: "Admin, Desk: the conversation at the end", shows: "Open again, our reply on it; the person added, named ZZ",
      run: async (ctx) => {
        const s = acct(ctx, "seeker"), m = made(ctx);
        if (!m.thread) skip(isOurs(s.email) ? OURS_WHY : "no conversation to read");
        if (!m.added) {
          const w = await deskWhen(ctx, m.thread, has(`[data-act="close"][data-thread="${m.thread}"]`), "the reopen is made at the engine's next run");
          await see(w.page, ".msg.us", "Sent by", "our reply");
          return "open again; nothing added (the address was already in Contacts)";
        }
        const note = await deskAdded(ctx, m.thread, m.person);
        ctx.left.push(`in Contacts: ${m.person}, from the Desk`);
        return `open again; ${note}`;
      } },
  ],
};

export const BOARD_JOURNEYS = [door, card, seek, code, desk];

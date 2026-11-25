// The full test: the 3D Print Hub and the Mill Hub (list, approve, change,
// search, pick, introduce), then the money that follows: the monthly
// declaration on its own page, the month's statement the engine builds, the
// membership clock, an audit strike the host never sees, and voiding every
// Xero invoice the run raised (action list groups 5, 6 and 7).
//
// The host in the settings is a fresh ZZ account with no listing. Approving
// its first listing raises a real membership invoice in Xero (Will, 12
// November 2026): the run records it and money.void stops for it to be voided.
// A month's fee invoice is not among them: since plan 106 (live 25 November
// 2026) the engine raises it with no press, and never for a test account, so
// a ZZ host's statement is left issued and nothing reaches Xero.
import { APEX, PRINT, MILL, OPPS, API, Refused, Soft, Skipped, mustBeZZ, isZZ, isZZSlug, differs, wait, skip, hand, askEnter, askLine } from "./core.mjs";
import { windowFor, go, see, shows, text, whoAmI, apiGet, signIn, signOut, adminWindow, adminGo, saveVia, wantDirect, ADMIN, allow, pollUntil, invoiceRaised } from "./browser.mjs";
import { same, made, acct, today, MARK, stampOf, newcomer, pageErrors, typeahead, fillIfEmpty, emailLink, pdfOk, nearest, termsOf, HUBS, openAnswer, answer, findForm, search, cardOf, companyPage, prospectName, prospectRow, openProspect, fits } from "./kit.mjs";

// ---------------------------------------------------------------- what these steps send
allow({
  /* The host's monthly declaration, from the declaration page: one request
     for each hub (hub/assets/declare.js, send). */
  accountPosts: ["/declarations"],
  /* Send the email again on an open offer (dashboard.js, resendIntro). */
  accountPatterns: [/^\/introductions\/\d+\/resend$/],
  adminIntents: [
    "approve-listing",              // a first listing (raises the membership invoice in Xero)
    "ask-listing-call",             // Ask for a call on the ZZ host's first listing: one email, to the ZZ host's own address
    "approve-listing-revision", "decline-listing-revision",
    "reissue-acceptance",           // Resend to <host> on a declined offer; never re-route
    "extend-membership-clock",
    "open-audit-strike", "cure-strike",
    /* The desk's correction of a declared line before it is invoiced. Raise
       invoice in Xero is not here: the runner never presses it. */
    "edit-declaration-line",
  ],
});

// ---------------------------------------------------------------- local helpers
/* The admin is there to press: a window, an address in the settings, and you. */
const adminAvailable = (ctx) => !!ctx.have.admin && !ctx.args.headless && !ctx.adminDeclined;
/* jobs.js's domId: a job's element id is its key with anything odd made an underscore. */
const domId = (k) => String(k == null ? "" : k).replace(/[^A-Za-z0-9_-]/g, "_");
const compact = (s) => String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]/g, "");
const addDays = (iso, n) => { const d = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const quote = (v) => JSON.stringify(String(v));
/* A month as the pages write it (en-GB): "November 2026", "15 December 2026". */
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthName = (p) => { const m = /^(\d{4})-(\d{2})$/.exec(String(p || "")); return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : String(p || ""); };
const dayWords = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || "")); return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : ""; };
const stepPeriod = (p, n) => { const [y, mo] = String(p).split("-").map(Number); const t = y * 12 + (mo - 1) + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; };
/* Today in Europe/London, as the worker's clock reads it (declarations.js
   londonParts): the day of the month and the month before this one. */
function londonNow(now = new Date()) {
  const parts = {};
  for (const x of new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now)) parts[x.type] = x.value;
  const month = `${parts.year}-${parts.month}`;
  return { day: Number(parts.day), month, last: stepPeriod(month, -1) };
}
/* Money as the hub pages write a declared figure (dashboard.js and declare.js cash). */
const cash = (amount, currency) => `${currency ? `${currency} ` : ""}${(Math.round(Number(amount || 0) * 100) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* A read the admin page itself could make, through its own database client
   (the pages' `sb`). Reads only: a select is a GET, which the locks pass. */
async function dbRead(ctx, table, select, filters = []) {
  let w = await adminWindow(ctx);
  ctx.lastWindow = w;
  const has = await w.page.evaluate(() => typeof sb !== "undefined" && !!sb && typeof sb.from === "function").catch(() => false);
  if (!has) w = await adminGo(ctx, "inbox.html");
  const r = await w.page.evaluate(async ([t, s, f]) => {
    if (typeof sb === "undefined" || !sb || typeof sb.from !== "function") return { error: "this admin page has no database client" };
    let q = sb.from(t).select(s);
    for (const [op, col, val] of f) {
      if (op === "is") q = q.is(col, val);
      else if (op === "in") q = q.in(col, val);
      else if (op === "ilike") q = q.ilike(col, val);
      else q = q.eq(col, val);
    }
    const out = await q.limit(1000);
    return { rows: out.data || [], error: out.error ? out.error.message : "" };
  }, [table, select, filters]);
  if (r.error) differs(`reading ${table} as the admin page does`, r.error, "the rows");
  return r.rows;
}
/* The ZZ host's account (organisations row), found by its name and nothing else. */
async function hostOrg(ctx) {
  if (ctx.cache.hostOrg) return ctx.cache.hostOrg;
  const company = acct(ctx, "host").company;
  mustBeZZ(company, "the host account in the settings");
  const rows = (await dbRead(ctx, "organisations", "id,name,sub_status,sub_period,billing_from", [["ilike", "name", "ZZ%"]]))
    .filter((o) => same(o.name, company));
  if (!rows.length) differs("the ZZ host's account in the database", "no account by that name", company);
  let org = rows[0];
  if (rows.length > 1) {
    /* Two accounts can carry the host's name: the first run's pipeline
       invitation gave its joiner a second "ZZ Full Test Host" (13 November,
       DP4 item 5). The host's own listing names its account, so that one is
       the host's; with no listing to go by, the runner cannot tell. */
    const ids = [];
    for (const h of HUBS) {
      const b = await mine(ctx, h).catch(() => null);
      if (b && b.listing && b.listing.id) ids.push(b.listing.id);
    }
    const owners = ids.length ? [...new Set((await dbRead(ctx, "listings", "id,org_id", [["in", "id", ids]])).map((l) => l.org_id))] : [];
    const mineOnes = rows.filter((o) => owners.includes(o.id));
    if (mineOnes.length !== 1) throw new Refused(`refused: ${rows.length} accounts are named ${JSON.stringify(company)}, and the host's own listings do not settle which is the host`);
    org = mineOnes[0];
    ctx.notes.push(`${rows.length} accounts are named ${company}; the runner took the one its listings are on (${org.id}). The other is the first run's joiner's (DP4 item 5): a finding for Will, and one for the ZZ clear-out.`);
  }
  mustBeZZ(org.name, "the host's account");
  ctx.cache.hostOrg = org;
  return org;
}
/* One row of the Inbox's own view (public.inbox), by kind and item. */
async function inboxRow(ctx, kind, itemId, ms = 60000) {
  const row = await pollUntil(async () => (await dbRead(ctx, "inbox", "*", [["eq", "kind", kind]]))
    .find((r) => String(r.item_id) === String(itemId)), { ms, every: 5000 });
  if (!row) differs(`the ${kind} job in the Inbox`, "not in the queue", `item ${itemId}`);
  mustBeZZ(row.name, `the company the ${kind} job names`);
  return row;
}
/* Listing and re-route jobs are decided on the company page, where the Inbox
   card links (jobs.js inPlace: a company.html board is not decided in place).
   Opens that page for the account, proves the account is ZZ, and answers the
   job's own box. */
async function jobOnCompanyPage(ctx, row) {
  const name = (await dbRead(ctx, "organisations", "id,name", [["eq", "id", row.org_id]]))[0];
  if (!name) differs("the job's account", "not found", row.org_id);
  mustBeZZ(name.name, "the account the job is on");
  const w = await adminGo(ctx, `company.html?org=${encodeURIComponent(row.org_id)}&job=${encodeURIComponent(row.item_key)}`);
  await w.page.waitForFunction(() => { const p = document.getElementById("page"); return !!p && !/Reading the company\./.test(p.textContent); }, null, { timeout: 30000 })
    .catch(() => differs("the company page", "still reading after 30 seconds", "the page"));
  if (!(await text(w.page, "#page")).includes(name.name)) throw new Refused(`refused: the company page does not name ${JSON.stringify(name.name)}`);
  const item = w.page.locator(`#job-${domId(row.item_key)}`);
  await item.waitFor({ state: "visible", timeout: 20000 }).catch(() => differs("the job under Needs you", "not on the company page", row.item_key));
  return { w, item };
}
/* A real Xero invoice the run raised, once, with the row it lives in, so
   money.void can read it back. invoiceRaised keeps the list and the report. */
function recordInvoice(ctx, { what, table, id, number = "", company = "", amount = "" }) {
  ctx.state.invoices = ctx.state.invoices || [];
  const known = ctx.state.invoices.find((i) => (i.table === table && String(i.id) === String(id)) || (number && i.number === number));
  if (known) {
    if (number && !known.number) known.number = number;
    ctx.left.push(`${known.what}${known.number ? ` (Xero ${known.number})` : ""}`);
    return known;
  }
  invoiceRaised(ctx, { what, number, company, amount, table });
  const row = ctx.state.invoices[ctx.state.invoices.length - 1];
  row.id = id;
  return row;
}
const describe = (i) => `${i.what}${i.number ? `, Xero ${i.number}` : ", not numbered yet"}${i.company ? `, ${i.company}` : ""}${i.amount ? `, ${i.amount}` : ""}`;

/* The host's own view of its listing on this hub (GET /listings/mine). */
async function mine(ctx, h) {
  const w = await signIn(ctx, "host");
  if (!/nexpoint\.co\.uk/.test(w.page.url())) await go(w.page, `${h.base}/offer.html`);
  const r = await apiGet(w.page, `/listings/mine?hub=${h.key}`);
  if (r.status !== 200 || !r.body) differs("the host's listing", `the API answered ${r.status}`, "its state");
  return r.body;
}
const materialsOf = (rev) => ((rev && rev.machines && rev.machines[0] && rev.machines[0].materials) || []).map(compact);
const hasMaterial = (rev, m) => materialsOf(rev).some((x) => x.includes(compact(m)) || compact(m).includes(x));
/* Materials the change steps add, one not on the listing yet. Free text is allowed. */
const EXTRA_MATERIALS = { print: ["TPU", "PA11", "PETG", "PP", "ABS"], mill: ["PE foam", "Cork", "Poron"] };
const newMaterial = (h, rev, not = "") => EXTRA_MATERIALS[h.key].find((m) => !hasMaterial(rev, m) && compact(m) !== compact(not));
async function openForm(ctx, h) {
  const w = await signIn(ctx, "host");
  await go(w.page, `${h.base}/offer.html`);
  await w.page.locator("body[data-np-open]").waitFor({ state: "attached", timeout: 25000 });
  await w.page.locator("#listingForm").waitFor({ state: "visible", timeout: 25000 })
    .catch(async () => differs("the listing form", await text(w.page, "#hostAppBody").catch(() => ""), "the form, ready to edit"));
  return w;
}
async function saveEdit(w, what) {
  if (await shows(w.page, "#hostTick", 1500)) await w.page.check("#hostTick");
  const sent = w.page.waitForResponse((r) => r.url() === `${API}/listings` && r.request().method() === "POST", { timeout: 30000 });
  await w.page.click("#listingSubmit");
  const r = await sent;
  if (!r.ok()) differs(what, `${r.status()} ${await text(w.page, "#listingErr").catch(() => "")}`, "Saved.");
  await see(w.page, "#hostAppBody .success", "Saved.", what, 30000);
}
/* Waits for the listing to reach a state, as the host's own view says. */
const listingBecomes = (ctx, h, test, ms = 4 * 60 * 1000) => pollUntil(async () => { const b = await mine(ctx, h); return test(b) ? b : null; }, { ms, every: 10000 });

// ================================================================ 5 and 6. the hubs
/* Which hub's offer the ZZ host accepts. Since plan 104 (live 19 November
   2026; worker requests.js, already_introduced) a company is not sent to a
   host it has an offer waiting with, or has been introduced to, on either
   hub. So the two ZZ accounts can hold one accepted introduction between
   them, and it must come last: the 3D Print Hub's offer, which runs first,
   is declined, offered again by the desk and declined again (a declined
   offer does not stand in the way), and the Mill Hub's is accepted. Until 25
   November 2026 it was the other way about. */
const ACCEPTS = "mill";
const NO_REQUEST = "no request went to the ZZ host on this run, so there is no new introduction to follow";
/* Where the journey's own introduction stands now, as the host's summary says. */
async function introNow(ctx, id) {
  const w = await signIn(ctx, "host");
  const r = await apiGet(w.page, "/account/summary");
  if (r.status !== 200 || !r.body) differs("the host's account summary", `the API answered ${r.status}`, "the account");
  return (r.body.introductions || []).find((i) => String(i.id) === String(id)) || null;
}
/* A step that needs the offer still open: left out when an earlier run answered it. */
async function openOffer(ctx) {
  const id = made(ctx).intro;
  if (!id) skip(NO_REQUEST);
  const i = await introNow(ctx, id);
  if (!i) differs("the introduction on the host's account", "not listed", `introduction ${id}`);
  if (i.stage !== "awaiting_acceptance") skip(`the introduction is ${i.stage}: it was answered on an earlier run`);
  return id;
}

const hubJourney = (h) => {
  const print = h.key === "print";
  const accepts = h.key === ACCEPTS;
  const NO_ADMIN = "the admin is not open on this run (it needs the window, admin.email in the settings, and you to sign in)";
  const listingSteps = [
    { id: "listing", does: "Host opens the listing form", shows: "A live listing: the form with its values. None: the empty form",
      run: async (ctx) => {
        const w = await signIn(ctx, "host");
        await go(w.page, `${h.base}/offer.html`);
        await w.page.locator("body[data-np-open]").waitFor({ state: "attached", timeout: 25000 });
        const b = await mine(ctx, h);
        Object.assign(made(ctx), { status: b.status, listing: b.listing && b.listing.id });
        return `the listing is ${b.status}`;
      } },
    { id: "first", once: true,
      does: print ? "Fills and submits a first listing: Leeds, UK, one HP MJF 5200 (PA12), monthly membership, the Host Agreement ticked"
        : "Fills and submits a first listing: Leeds, UK, one 5-axis CNC (EVA)",
      shows: print ? "\"Received\"; the desk notice; Your terms on the account page shows the Host Agreement"
        : "\"Your Host Agreement … still applies\", no second agreement; \"already has a monthly membership\"; then \"Received\"",
      run: async (ctx) => {
        const status = made(ctx).status;
        if (status === "pending") skip("submitted on an earlier run; it waits for approval");
        if (status === "live" || status === "live_pending_edit") skip("the listing is live already");
        /* Plan 102 (live 19 November 2026): a first listing the desk sent back
           for changes is handed back to its host. The page says "Changes
           needed", shows what was sent, and its one button opens the form
           refilled from it (listing-form.js renderDeclined). The runner sends
           it back as it stands. */
        const sentBack = status === "declined";
        if (status !== "none" && !sentBack) differs("the listing before a first submission", status, "none");
        let w;
        if (sentBack) {
          w = await signIn(ctx, "host");
          await go(w.page, `${h.base}/offer.html`);
          await see(w.page, "#listingDeclinedNotice", "Changes needed.", "a first listing sent back for changes", 25000);
          await w.page.click("#listingDeclinedEdit");
          await w.page.locator("#listingForm").waitFor({ state: "visible", timeout: 25000 })
            .catch(() => differs("Change your listing and send it back", "no form opened", "the form, refilled"));
          if (!(await w.page.inputValue("#siteTown")).trim()) differs("the form after Changes needed", "empty", "refilled from what was sent");
        } else {
          w = await openForm(ctx, h);
          await fillIfEmpty(w.page, "#siteTown", "Leeds");
          if (!(await w.page.inputValue("#siteCountry")).trim()) await typeahead(w.page, "#siteCountry", "United Kingdom");
          await w.page.click('#shipsTo input[data-region="uk"] + span');
          await typeahead(w.page, "#m-1-machine", h.machine);
          await typeahead(w.page, "#m-1-materials", h.material);
          await w.page.fill("#m-1-lead", "5");
          await w.page.fill("#m-1-capacity", "100");
        }
        const billed = await shows(w.page, "#hostMembership", 1500) && (await text(w.page, "#hostMembership")).includes("already has");
        /* A form refilled from a declined listing keeps the period it was sent with. */
        if (await shows(w.page, '#hostMembership input[name="billing"]', 1500) && !(await w.page.locator('#hostMembership input[name="billing"]:checked').count())) {
          await w.page.click('#hostMembership input[name="billing"][value="monthly"] + span');
        }
        /* The terms block loads the agreement after the form: the tick, or the line saying it still applies. */
        await w.page.locator("#hostTick, #hostTermsBlock .np-terms-held").first().waitFor({ state: "visible", timeout: 20000 })
          .catch(() => differs("the Host Agreement block", "neither the tick nor \"still applies\"", "one of them"));
        const asked = await shows(w.page, "#hostTick", 500);
        if (asked) await w.page.check("#hostTick");
        const sent = w.page.waitForResponse((r) => r.url() === `${API}/listings` && r.request().method() === "POST", { timeout: 30000 });
        await w.page.click("#listingSubmit");
        const r = await sent;
        if (!r.ok()) differs("submitting the first listing", `${r.status()} ${await text(w.page, "#listingErr").catch(() => "")}`, "Received");
        ctx.did();
        await see(w.page, "#hostAppBody .success", "Received", "after submitting a first listing", 30000);
        if (ctx.mail.s.desk) ctx.mail.expect(`Desk notice: a ${h.name} listing to review`, ctx.mail.s.desk, "User request:");
        ctx.left.push(`a ${h.name} listing for ${acct(ctx, "host").company}`);
        if (print) {
          await go(w.page, `${APEX}/hub/account/`);
          await see(w.page, '#yourTerms [data-terms-layer="host"]', "Version", "the Host Agreement under Your terms", 25000)
            .catch((e) => { throw new Soft(String(e.message || e)); });
          return asked ? "the Host Agreement was asked for and ticked" : "the Host Agreement was already held, so none was asked for";
        }
        if (asked) throw new Soft("the Mill Hub asked for the Host Agreement again; one acceptance should cover both hubs");
        if (!billed) throw new Soft("the Mill Hub's form did not say the site already has a membership (was the 3D Print Hub listing approved first?)");
        return "\"still applies\" and the membership already held; no second agreement";
      } },
    /* Will, 12 November 2026: a first listing is approved after a call with
       the host, so its card has "Ask for a call", which emails the host and
       leaves the listing waiting (engine #237, website #227; queue step DQ6).
       Pressed once a host, on the 3D Print Hub listing: one email is enough.
       The same step takes the code audit's one look (row 23 of its launch
       list, finding 07b-05): whether the Inbox holds a second card for the
       waiting listing, a "wrote to the desk" card that opens a page which
       cannot decide it. Seen or not, it goes in the report's notes. */
    ...(print ? [{ id: "ask-call", once: true,
      does: "Admin: on the listing request's card, presses Ask for a call, then \"Send the email\"",
      shows: `Queued; the listing still waits; the card says "Call asked for on" today; "A call about your ${h.name} listing" reaches the host`,
      run: async (ctx) => {
        const now = await mine(ctx, h);
        if (now.status === "live" || now.status === "live_pending_edit") {
          ctx.notes.push(`Ask for a call (queue DQ6, the code audit's row 23) was not taken: the ZZ host's ${h.name} listing was live before the run (approved by hand on 16 November), so no listing of its waits and there is no card to press. It needs a ZZ listing still waiting.`);
          skip("the listing is live already (approved before this run), so its card and Ask for a call have gone");
        }
        if (now.status !== "pending") differs("the listing before asking for a call", now.status, "pending");
        if (!adminAvailable(ctx)) wait(`asking the ZZ host for a call waits: ${NO_ADMIN}`);
        let org;
        try { org = await hostOrg(ctx); } catch (e) {
          if (e instanceof Skipped) wait(`asking the ZZ host for a call waits: ${e.message}`);
          throw e;
        }
        const row = await inboxRow(ctx, "listing", now.listing.id);
        if (row.org_id !== org.id) throw new Refused("refused: the listing request is not on the ZZ host's account");
        const twins = (await dbRead(ctx, "inbox", "kind,ref,name,hub,board", [["eq", "kind", "enquiry"]]))
          .filter((r) => same(r.name, org.name) && r.hub === h.key && /-hub\.html$/.test(String(r.board || "")));
        ctx.notes.push(twins.length
          ? `The Inbox holds ${twins.length === 1 ? "a second card" : `${twins.length} more cards`} for the ZZ host's waiting ${h.name} listing (${twins.map((r) => `${r.ref}, which opens ${r.board}`).join("; ")}): the code audit's finding 07b-05, a card no page can decide (a finding for Will).`
          : `The Inbox holds one card for the ZZ host's waiting ${h.name} listing and no second "wrote to the desk" card (the code audit's finding 07b-05 did not show).`);
        const { w, item } = await jobOnCompanyPage(ctx, row);
        const open = item.locator('[data-act="jobOpen"][data-ui="call"]');
        if (!(await open.count())) differs("the listing request's buttons", await item.textContent(), "Ask for a call");
        if (/again/i.test(await open.textContent())) skip("this host was asked for a call on an earlier run; asking again would send a second email");
        await open.click();
        const send = w.page.locator(`#job-${domId(row.item_key)} [data-act="jobAskCall"]`);
        await send.waitFor({ state: "visible" }).catch(() => differs("Ask for a call", "no question opened", "\"Email the host to ask for a call?\" and \"Send the email\""));
        await see(w.page, `#job-${domId(row.item_key)} .inline-choice`, "Email the host to ask for a call?", "the question under Ask for a call");
        await saveVia(w.page, () => send.click(), ctx);
        const asked = await pollUntil(async () => {
          const l = (await dbRead(ctx, "listings", "id,status,call_asked_at", [["eq", "id", now.listing.id]]))[0];
          return l && l.call_asked_at ? l : null;
        });
        if (!asked) wait("asked and queued; the engine has not sent the email yet (it wakes within about a minute)");
        if (asked.status !== "pending") differs("the listing after asking for a call", asked.status, "still pending");
        ctx.mail.expect(`A call asked for, ${h.name}: the listing still waits`, acct(ctx, "host").email, `A call about your ${h.name} listing`);
        /* The card says when it was asked, once the page has read the listing again. */
        const after = await jobOnCompanyPage(ctx, row);
        await see(after.w.page, `#job-${domId(row.item_key)}`, "Call asked for on", "the card after the email went", 20000)
          .catch((e) => { throw new Soft(String(e.message || e)); });
        return twins.length ? "asked, and the listing still waits; the Inbox shows a second card for it (see the notes)"
          : "asked, and the listing still waits; one card for it in the Inbox";
      } },
    /* Plan 096 (live 16 November 2026, queue DU7): the Inbox shows one card
       per waiting listing, never a "Desk question" card beside it. Read from
       the Inbox's own view as its page does, for every listing that waits,
       whoever's: names are said only when they are ZZ ones. */
    { id: "one-card", does: "Reads the Inbox for every listing that waits for approval",
      shows: "One card for each waiting listing, and no \"Desk question\" card beside any of them",
      run: async (ctx) => {
        if (!adminAvailable(ctx)) skip(NO_ADMIN);
        const rows = await dbRead(ctx, "inbox", "kind,item_id,name,hub,board,ref", [["in", "kind", ["listing", "listing_change", "enquiry"]]]);
        const listings = rows.filter((r) => r.kind === "listing" || r.kind === "listing_change");
        if (!listings.length) skip("no listing waits for approval anywhere today, so there is nothing to look beside (the ZZ host's two went live before the run)");
        const twinsOf = (l) => rows.filter((r) => r.kind === "enquiry" && same(r.name, l.name) && r.hub === l.hub && /-hub\.html$/.test(String(r.board || "")));
        const perListing = new Map();
        for (const l of listings) perListing.set(String(l.item_id), (perListing.get(String(l.item_id)) || 0) + 1);
        const doubled = [...perListing.values()].filter((n) => n > 1).length;
        const twinned = listings.filter((l) => twinsOf(l).length);
        const say = (l) => (isZZ(l.name) ? `${l.name} (${l.hub})` : `a ${l.hub} listing`);
        if (doubled) differs("listing cards in the Inbox", `${doubled} listing(s) with more than one card`, "one card per listing");
        if (twinned.length) differs("a Desk question card beside a waiting listing", twinned.map(say).join("; "), "none (plan 096)");
        return `${listings.length} waiting listing(s), one card each, no Desk question card beside any`;
      } }] : []),
    { id: "approve", once: true,
      does: "Admin: opens the listing request from the Inbox on the host's company page, presses Approve, then \"Yes, approve it\"",
      shows: print ? "Queued, then the listing is live; this raises a real membership invoice in Xero"
        : "Queued, then the listing is live; no new invoice (one membership covers both hubs)",
      run: async (ctx) => {
        const now = await mine(ctx, h);
        /* Will approved both of the ZZ host's listings by hand on 16 November (queue DU20):
           only a listing still waiting is approved here, and the steps after approval run either way. */
        if (now.status === "live" || now.status === "live_pending_edit") skip("the listing is live already (approved before this run); the steps after approval run on it");
        if (now.status !== "pending") differs("the listing before approval", now.status, "pending");
        if (!adminAvailable(ctx)) wait(`the ZZ host's ${h.name} listing waits for approval and ${NO_ADMIN}`);
        let org;
        try { org = await hostOrg(ctx); } catch (e) {
          if (e instanceof Skipped) wait(`the ZZ host's ${h.name} listing waits for approval: ${e.message}`);
          throw e;
        }
        if (!print) {
          /* Approved before the 3D Print Hub's, this would be the first billing and raise the invoice itself. */
          const fresh = (await dbRead(ctx, "organisations", "id,sub_status", [["eq", "id", org.id]]))[0] || {};
          if (!fresh.sub_status || fresh.sub_status === "none") wait("the ZZ host is not billed yet: its 3D Print Hub listing is approved first (hubs.print), so this approval shows one membership covering both hubs");
        }
        const row = await inboxRow(ctx, "listing", now.listing.id);
        if (row.org_id !== org.id) throw new Refused("refused: the listing request is not on the ZZ host's account");
        made(ctx).invoicesBefore = (await dbRead(ctx, "membership_invoices", "id", [["eq", "org_id", org.id]])).length;
        const { w, item } = await jobOnCompanyPage(ctx, row);
        /* Will, 12 November 2026 (the code audit's decision C): Approve asks
           once more before it acts, and says what the approval does to the
           money. The first press only opens the question on the card; the
           second, "Yes, approve it", is the approval. */
        const open = item.locator('[data-act="jobOpen"][data-ui="approve"]');
        if (!(await open.count())) differs("the listing request's buttons", await item.textContent(), "Approve");
        await open.click();
        const button = w.page.locator(`#job-${domId(row.item_key)} [data-act="jobApproveListing"]`);
        await button.waitFor({ state: "visible" }).catch(() => differs("Approve", "no question opened", "\"Approve this listing?\" and \"Yes, approve it\""));
        await see(w.page, `#job-${domId(row.item_key)} .inline-choice`, "Approve this listing?", "the question under Approve");
        await see(w.page, `#job-${domId(row.item_key)} .inline-choice`,
          print ? "the first membership invoice is raised in Xero" : "with no new invoice", "what the question says about the invoice");
        await saveVia(w.page, () => button.click(), ctx);
        const live = await pollUntil(async () => {
          const l = (await dbRead(ctx, "listings", "id,status", [["eq", "id", now.listing.id]]))[0];
          return l && l.status === "live" ? l : null;
        });
        if (!live) wait("approved and queued; the engine has not put the listing live yet (it wakes within about a minute)");
        made(ctx).org = org.id;
        ctx.mail.expect(`Approved, ${h.name}: the listing is live${print ? ", with the first membership invoice" : ""}`,
          acct(ctx, "host").email, `You are approved: your ${h.name} listing is live`);
        return "approved; the listing is live";
      } },
    { id: "invoice",
      does: print ? "Reads the membership invoice the approval raised, and finds its number on Money"
        : "Checks the approval raised no second membership invoice",
      shows: print ? "One first membership invoice for the ZZ host, numbered in Xero; listed for voiding at the end"
        : "Still one first membership invoice for the ZZ host",
      run: async (ctx) => {
        if (!adminAvailable(ctx)) skip(NO_ADMIN);
        const b = await mine(ctx, h);
        if (b.status !== "live" && b.status !== "live_pending_edit") wait(`the ${h.name} listing is ${b.status}, not live yet`);
        const org = await hostOrg(ctx), cols = "id,org_id,kind,period,amount,currency,xero_invoice_number,invoiced_at,voided_at,last_error";
        const read = () => dbRead(ctx, "membership_invoices", cols, [["eq", "org_id", org.id]]);
        if (!print) {
          const before = made(ctx).invoicesBefore;
          /* Give the worker a minute to raise anything it was going to. */
          await new Promise((r) => setTimeout(r, before == null ? 0 : 60000));
          const rows = await read(), firsts = rows.filter((r) => r.kind === "first");
          /* Whatever is there is a real invoice on a ZZ account: listed for voiding either way. */
          for (const r of rows.filter((x) => !x.voided_at)) {
            recordInvoice(ctx, { what: `Membership invoice for ${org.name} (${r.kind || "membership"})`, table: "membership_invoices", id: r.id,
              number: r.xero_invoice_number || "", company: org.name, amount: `${r.currency || "GBP"} ${r.amount}` });
          }
          if (firsts.length !== 1) differs("first membership invoices on the ZZ host", `${firsts.length}`, "one");
          if (before != null && rows.length !== before) differs("membership invoices after the Mill Hub approval", `${rows.length} (were ${before})`, `${before}: no new invoice`);
          return "one membership covers both hubs: no second invoice";
        }
        const rows = await pollUntil(async () => {
          const all = await read(), first = all.filter((r) => r.kind === "first");
          return first.length && first.every((r) => r.xero_invoice_number || r.voided_at || r.last_error) ? all : null;
        }, { ms: 7 * 60 * 1000, every: 15000 }) || await read();
        const firsts = rows.filter((r) => r.kind === "first");
        if (!firsts.length) differs("the membership invoice after approval", "no invoice row for the ZZ host", "one, numbered in Xero");
        for (const r of rows.filter((x) => !x.voided_at)) {
          recordInvoice(ctx, { what: `Membership invoice for ${org.name} (${r.kind === "first" ? "first listing approved" : r.kind || "membership"})`,
            table: "membership_invoices", id: r.id, number: r.xero_invoice_number || "", company: org.name, amount: `${r.currency || "GBP"} ${r.amount}` });
        }
        if (firsts.length > 1) differs("first membership invoices on the ZZ host", `${firsts.length}`, "one");
        const inv = firsts[0];
        if (inv.voided_at) return `the first invoice ${inv.xero_invoice_number || ""} is voided already`;
        if (!inv.xero_invoice_number) throw new Soft(`the invoice row is there but Xero has not numbered it yet${inv.last_error ? ` (${inv.last_error})` : ""}; it is listed for voiding by its row`);
        const w = await adminGo(ctx, "money.html?tab=invoices");
        await see(w.page, "#page", inv.xero_invoice_number, "the invoice on Money's Xero invoices tab", 25000);
        return `Xero ${inv.xero_invoice_number}, ${inv.currency || "GBP"} ${inv.amount} (${inv.period})`;
      } },
    /* Plan 095 (live 16 November 2026): the host's account page says a bill
       that is simply due plainly, with a Pay the invoice button carrying the
       invoice's own pay link; the alarm words are for a hidden or paused
       listing (admin.pause reads the paused words). The button is read,
       never pressed. */
    ...(print ? [{ id: "host-bill", does: "Host opens its account page while its membership invoice is unpaid",
      shows: "\"Membership invoice <number> for … is due by …\" (or \"was due on\"), and Pay the invoice; not pressed",
      run: async (ctx) => {
        const b = await mine(ctx, h);
        if (b.status !== "live" && b.status !== "live_pending_edit") wait(`the ${h.name} listing is ${b.status}, not live yet`);
        const w = await signIn(ctx, "host");
        const sum = await apiGet(w.page, "/account/summary");
        if (sum.status !== 200 || !sum.body) differs("the host's account summary", `the API answered ${sum.status}`, "the account");
        const inv = sum.body.membership_invoice;
        if (!inv || !inv.number) skip("the host has no unpaid membership invoice to show (paid or voided already)");
        await go(w.page, `${APEX}/hub/account/`);
        await w.page.locator("#profile:not([hidden])").waitFor({ state: "visible", timeout: 25000 });
        await see(w.page, "#profile", new RegExp(`Membership invoice ${inv.number.replace(/[^A-Za-z0-9-]/g, "")} for .+ (is due by|was due on|is waiting to be paid)`),
          "the bill on the host's account page", 25000);
        if (await shows(w.page, "#profile .acct-notice", 1500)) differs("the bill on the host's account page", await text(w.page, "#profile .acct-notice"), "said plainly, with no alarm, while the listing shows");
        const pay = w.page.locator("#profile a", { hasText: "Pay the invoice" }).first();
        if (!(await pay.count())) differs("the host's account page", "no Pay the invoice button", "Pay the invoice");
        const href = String(await pay.getAttribute("href") || "");
        if (!/^https:\/\/api\.nexpoint\.co\.uk\/membership\/pay\/[0-9a-f]{64}$/.test(href)) differs("Pay the invoice's link", href.replace(/[0-9a-f]{64}$/, "<token>"), `${API}/membership/pay/<token>`);
        return `${inv.number}: said plainly, with Pay the invoice (not pressed)`;
      } }] : []),
  ];
  /* 5.5 to 5.7, on the 3D Print Hub only: one change that goes live, one that
     is reviewed and approved, one that is reviewed and declined. */
  const changeSteps = !print ? [] : [
    { id: "lead", does: "Host changes the first machine's lead time by a day and saves", shows: "\"Saved.\" and \"Live now\": no review",
      run: async (ctx) => {
        const b = await mine(ctx, h);
        if (b.status === "live_pending_edit") skip("a change from an earlier run is waiting for review, so the form is shut until it is decided");
        if (b.status !== "live") wait(`the listing is ${b.status}, not live`);
        const w = await openForm(ctx, h);
        const v = Number(await w.page.inputValue("#m-1-lead")) || 5;
        await w.page.fill("#m-1-lead", String(v <= 1 ? 2 : v % 2 === 0 ? v + 1 : v - 1));
        await saveEdit(w, "after the lead-time change");
        await see(w.page, "#hostAppBody .success", "Live now", "a lead-time change goes live at once");
      } },
    { id: "material", once: true, does: "Host adds a material to the first machine and saves", shows: "\"Saved.\" and \"Waiting for review\"; the listing stays live",
      run: async (ctx) => {
        if (!adminAvailable(ctx)) skip(`${NO_ADMIN}, and a reviewed change would wait for it`);
        const b = await mine(ctx, h);
        if (b.status === "live_pending_edit") skip("a change from an earlier run is already waiting for review; the next step decides it");
        if (b.status !== "live") wait(`the listing is ${b.status}, not live`);
        const m = newMaterial(h, b.live);
        if (!m) skip("every test material is on the listing already");
        const w = await openForm(ctx, h);
        await typeahead(w.page, "#m-1-materials", m);
        await saveEdit(w, "after adding a material");
        ctx.did();
        made(ctx).material = m;
        await see(w.page, "#hostAppBody .success", "Waiting for review", "a new material waits for review");
        const after = await mine(ctx, h);
        if (after.status !== "live_pending_edit" || after.listing.status !== "live") differs("the listing after a reviewed change", `${after.listing.status}, ${after.status}`, "live, with the change waiting");
        return `added ${m}`;
      } },
    { id: "approve-change", once: true, does: "Admin: on the host's company page, presses Approve the change, then \"Yes, approve the change\"",
      shows: "\"Approve this change to <ZZ host>'s listing?\"; queued; the new material is live; \"The changes to your 3D Print Hub listing are live\" to the host",
      run: async (ctx) => {
        if (!adminAvailable(ctx)) skip(NO_ADMIN);
        const b = await mine(ctx, h);
        if (b.status !== "live_pending_edit") skip(made(ctx).material && hasMaterial(b.live, made(ctx).material) ? "approved already" : `no change is waiting (the listing is ${b.status})`);
        const org = await hostOrg(ctx), row = await inboxRow(ctx, "listing_change", b.listing.id);
        if (row.org_id !== org.id) throw new Refused("refused: the listing change is not on the ZZ host's account");
        const { w, item } = await jobOnCompanyPage(ctx, row);
        /* Will, 17 November 2026 (jobs.js changePanel): approving emails the
           host and nothing un-approves, so the button asks first in place,
           naming the site. The second press is the approval. */
        const open = item.locator('[data-act="jobOpen"][data-ui="approvechange"]');
        if (!(await open.count())) differs("the listing change's buttons", await item.textContent(), "Approve the change");
        await open.click();
        const button = w.page.locator(`#job-${domId(row.item_key)} [data-act="jobApproveChange"]`);
        await button.waitFor({ state: "visible" }).catch(() => differs("Approve the change", "no question opened", "\"Approve this change to …\" and \"Yes, approve the change\""));
        const asked = await see(w.page, `#job-${domId(row.item_key)} .inline-choice`, "Approve this change to", "the question under Approve the change");
        if (!asked.includes(org.name)) throw new Refused(`refused: the question does not name ${JSON.stringify(org.name)}`);
        await saveVia(w.page, () => button.click(), ctx);
        const after = await listingBecomes(ctx, h, (x) => x.status === "live");
        if (!after) wait("approved and queued; the engine has not made the change live yet");
        const m = made(ctx).material;
        if (m && !hasMaterial(after.live, m)) differs("the live listing after approval", materialsOf(after.live).join(", "), `with ${m}`);
        ctx.mail.expect("A listing change approved, 3D Print Hub", acct(ctx, "host").email, `The changes to your ${h.name} listing are live`);
      } },
    { id: "second-change", once: true, does: "Host adds another material and saves", shows: "\"Saved.\" and \"Waiting for review\"",
      run: async (ctx) => {
        if (!adminAvailable(ctx)) skip(NO_ADMIN);
        const b = await mine(ctx, h);
        if (b.status === "live_pending_edit") skip("a change is already waiting for review; the next step declines it");
        if (b.status !== "live") wait(`the listing is ${b.status}, not live`);
        const m = newMaterial(h, b.live, made(ctx).material);
        if (!m) skip("every test material is on the listing already");
        const w = await openForm(ctx, h);
        await typeahead(w.page, "#m-1-materials", m);
        await saveEdit(w, "after adding a second material");
        ctx.did();
        made(ctx).declined = m;
        await see(w.page, "#hostAppBody .success", "Waiting for review", "the second change waits for review");
        return `added ${m}`;
      } },
    { id: "decline-change", once: true, does: "Admin: declines that change with a note", shows: "Queued; the live listing is as it was; \"Changes needed on the update to your 3D Print Hub listing\" to the host",
      run: async (ctx) => {
        if (!adminAvailable(ctx)) skip(NO_ADMIN);
        const b = await mine(ctx, h);
        if (b.status !== "live_pending_edit") skip(`no change is waiting (the listing is ${b.status})`);
        const org = await hostOrg(ctx), row = await inboxRow(ctx, "listing_change", b.listing.id);
        if (row.org_id !== org.id) throw new Refused("refused: the listing change is not on the ZZ host's account");
        const { w, item } = await jobOnCompanyPage(ctx, row);
        await item.locator('[data-act="jobOpen"][data-ui="decline"]').click();
        const note = w.page.locator(`#jb-note-${domId(row.item_key)}`);
        await note.waitFor({ state: "visible" }).catch(() => differs("Decline the change", "no note box opened", "the question and a note"));
        await note.fill(`${MARK}: a test change, declined on purpose. Please ignore.`);
        await saveVia(w.page, () => w.page.locator(`#job-${domId(row.item_key)} [data-act="jobDeclineChange"]`).click(), ctx);
        const after = await listingBecomes(ctx, h, (x) => x.status === "live");
        if (!after) wait("declined and queued; the engine has not settled it yet");
        const m = made(ctx).declined;
        if (m && hasMaterial(after.live, m)) differs("the live listing after declining", materialsOf(after.live).join(", "), `without ${m}`);
        ctx.mail.expect("A listing change declined, 3D Print Hub", acct(ctx, "host").email, `Changes needed on the update to your ${h.name} listing`);
      } },
  ];
  const seekSteps = [
    { id: "form", does: `Seeker opens Find capacity and fills the form (${h.device}, 12 pairs); presses the Up and Down arrows in How many and in the lead time`,
      shows: "The form, with the two picture boxes; a number changes only by typing, so the arrows change nothing",
      run: async (ctx) => {
        const w = await signIn(ctx, "seeker");
        await findForm(w, h);
        /* Plan 106 (W5.2; typed-numbers.js, guarded on the form by find.js):
           the arrow keys do nothing in a number box. The lead time is typed
           only for this look and emptied again, so the search is as before. */
        for (const [box, typed, key, what] of [["#fQuantity", "12", "ArrowUp", "How many"], ["#fMaxLead", "30", "ArrowDown", "the lead time"]]) {
          await w.page.fill(box, typed);
          await w.page.press(box, key);
          const now = await w.page.inputValue(box);
          if (now !== typed) differs(`${what}, after the ${key === "ArrowUp" ? "Up" : "Down"} arrow`, now, `${typed}: a number changes only by typing`);
        }
        await w.page.fill("#fMaxLead", "");
      } },
    { id: "search", does: "Searches",
      shows: "The Seeker Agreement the first time only (version 2.1 since 25 November 2026, so an account that accepted 2.0 is asked once more). Then up to three named sites",
      run: async (ctx) => {
        const w = await signIn(ctx, "seeker");
        const gate = await search(w);
        return gate ? "the terms were shown and accepted" : "no terms were shown";
      } },
    { id: "pick", does: "Picks the ZZ host, and only the ZZ host", shows: `"The ${print ? "site" : "cell"} you picked: … <ZZ host>", and "It sees your company's name with your request."`,
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
        /* Plan 106 (D12): the seeker is told, before it sends, that the site sees its company's name. */
        await see(w.page, "#pickSummary", "It sees your company's name with your request.", "what the seeker is told before it sends")
          .catch((e) => { throw new Soft(String(e.message || e)); });
      } },
    { id: "send", once: true, does: "Sends the request",
      shows: "\"Thank you.\"; \"We have your request\" to the seeker; \"New introduction for you\" to the host; the desk notice. When the two ZZ companies already have an offer waiting or an introduction, on either hub: refused in the page's words, with nothing sent (plan 104)",
      run: async (ctx) => {
        const w = await signIn(ctx, "seeker");
        const answered = w.page.waitForResponse((r) => r.url() === `${API}/seeker-requests` && r.request().method() === "POST", { timeout: 60000 });
        await w.page.click("#requestSubmit");
        const r = await answered, j = await r.json().catch(() => ({}));
        /* Plan 104 (R7-20; worker requests.js, page find.js requestErrorText).
           Nothing is written and nobody is emailed for either refusal. Not
           marked done: a later run presses again. */
        if (r.status() === 409 && j.error === "already_introduced") {
          await see(w.page, "#requestErr", j.waiting ? "You have already asked this company, and it has not answered yet."
            : "You already have an introduction with this company", "the page's words for a repeat pick", 10000);
          skip(`refused, as it should be: the ZZ seeker ${j.waiting ? "has an offer waiting with" : "already has an introduction to"} the ZZ host${j.ref ? ` (${j.ref})` : ""}, on one hub or the other, so nothing was sent. The steps that follow a new introduction are left out`);
        }
        if (r.status() === 429 && j.error === "too_many_picks_today") {
          await see(w.page, "#requestErr", "requests in the last 24 hours, which is the most allowed in a day", "the page's words for the daily limit", 10000);
          skip("refused, as it should be: the ZZ seeker has sent ten requests in the last 24 hours, the most a company may; run again tomorrow");
        }
        if (!r.ok() || !j.introduction) differs("sending the request", `${r.status()} ${j.error || await text(w.page, "#requestErr").catch(() => "")}`, "an introduction");
        Object.assign(made(ctx), { intro: j.introduction.id, ref: j.introduction.ref, request: j.ref, sentAt: Date.now() });
        ctx.did();
        await see(w.page, "#step3Body .success", "Thank you.", "after sending");
        ctx.mail.expect(`Request received, ${h.name}`, acct(ctx, "seeker").email, "We have your request");
        ctx.mail.expect(`The offer to the host, ${j.introduction.ref}`, acct(ctx, "host").email, `New introduction for you, ${j.introduction.ref}`);
        if (ctx.mail.s.desk) ctx.mail.expect(`Desk notice: a site was picked, ${h.name}`, ctx.mail.s.desk, "picked");
        ctx.left.push(`introduction ${j.introduction.ref} on the ${h.name}`);
        return `${j.introduction.ref}`;
      } },
    /* Plan 106 (live 25 November 2026; dashboard.js introCard, needBoxHtml):
       the host's card is titled with the company that asked and the
       reference, and "What they need", on the card's map, names the company
       and prints only what the seeker typed in the notes box (the worker's
       notes_own), never the sentences the find form composes for the desk.
       The person, the email and the phone still wait for acceptance. */
    { id: "row", does: "Host opens the introduction on its account page",
      shows: "The card titled \"<ZZ seeker> (INTRO-…)\"; \"Waiting for your answer. Open until …\"; Review and accept, Decline; What they need names the ZZ seeker and carries the seeker's own notes and nothing else",
      run: async (ctx) => {
        const id = await openOffer(ctx), w = await signIn(ctx, "host"), seeker = acct(ctx, "seeker").company;
        await go(w.page, `${APEX}/hub/account/#intro-${id}`);
        await see(w.page, `#intro-${id}`, "Open until", "the introduction's row", 25000);
        for (const act of ["intro-accept-open", "intro-decline-open"]) {
          if (!(await shows(w.page, `[data-act="${act}"][data-intro="${id}"]`))) differs("the row's buttons", `${act} is missing`, "Review and accept, and Decline");
        }
        const odd = [];
        const title = await text(w.page, `#intro-${id} .intro-name`).catch(() => "");
        if (!title.toLowerCase().includes(seeker.trim().toLowerCase()) || !title.includes(`(${made(ctx).ref})`)) {
          odd.push(`the card's title reads ${JSON.stringify(title.slice(0, 120) || "no company")}, expected "${seeker} (${made(ctx).ref})"`);
        }
        /* The box is the map's own, drawn once the map is: a moment after the row. */
        const want = `${MARK}: a test search, please ignore.`;
        const notes = w.page.locator(`#intro-${id} .np-need__notes`).first();
        await notes.waitFor({ state: "attached", timeout: 10000 }).catch(() => {});
        const got = (await notes.count()) ? ((await notes.textContent()) || "").replace(/\s+/g, " ").trim().replace(/^Notes\s*/, "") : "";
        if (!got) odd.push(`no notes under What they need (did the card's map draw?), expected the seeker's own: ${want}`);
        else if (got !== want) odd.push(`the notes under What they need read ${JSON.stringify(got.slice(0, 160))}, expected the seeker's own words and nothing else (${want})`);
        const who = await text(w.page, `#intro-${id} .np-need__company`).catch(() => "");
        if (got && !who.toLowerCase().includes(seeker.trim().toLowerCase())) odd.push(`What they need names ${JSON.stringify(who || "no company")}, expected ${seeker}`);
        if (odd.length) throw new Soft(odd.join("; "));
        return "the card names the ZZ seeker; its two buttons; the seeker's own notes and nothing else";
      } },
  ];
  /* 6.5: the account page offers Send the email again only while the offer
     is open (dashboard.js), and the worker refuses a second offer email
     within two minutes of the last (offers.js, OFFER_RESEND_COOLDOWN_MS). */
  const resendStep = !print ? [] : [
    { id: "resend", once: true, does: "Host presses Send the email again on the open offer, two minutes after it went",
      shows: "\"Sent again.\" under the row; the offer email to the host a second time",
      run: async (ctx) => {
        const id = await openOffer(ctx), m = made(ctx), w = await signIn(ctx, "host");
        const left = (m.sentAt || 0) + 125000 - Date.now();
        if (left > 0) { ctx.log(`  waiting ${Math.ceil(left / 1000)} seconds: the offer email can be sent again two minutes after the last`); await w.page.waitForTimeout(left); }
        await go(w.page, `${APEX}/hub/account/#intro-${id}`);
        /* The open offer's own button; plan 095's "Send the introduction email again" (data-kind="release") is another. */
        const button = w.page.locator(`[data-act="intro-resend"][data-intro="${id}"]:not([data-kind="release"])`);
        await button.waitFor({ state: "visible", timeout: 25000 }).catch(() => differs("Send the email again", "not on the row", "the button, while the offer is open"));
        const sent = w.page.waitForResponse((r) => r.url() === `${API}/introductions/${id}/resend` && r.request().method() === "POST", { timeout: 30000 });
        await button.click();
        const r = await sent;
        if (!r.ok()) differs("sending the offer again", `${r.status()} ${await text(w.page, `#introMsg-${id}`).catch(() => "")}`, "Sent again.");
        ctx.did();
        await see(w.page, `#introMsg-${id}`, "Sent again.", "after Send the email again");
        ctx.mail.expect(`The offer to the host again, ${m.ref}`, acct(ctx, "host").email, `New introduction for you, ${m.ref}`);
      } },
  ];
  const answerSteps = [
    { id: "answer-open", does: "Host opens the answer",
      shows: "No terms at all: the Host Agreement was accepted on the listing form (only an account that does not hold the current version is asked here, once)",
      run: async (ctx) => {
        const id = await openOffer(ctx), w = await signIn(ctx, "host");
        if (!(await shows(w.page, `#intro-${id}`, 1500))) await go(w.page, `${APEX}/hub/account/#intro-${id}`);
        await w.page.locator(`[data-act="intro-accept-open"][data-intro="${id}"]`).waitFor({ state: "visible", timeout: 25000 });
        await openAnswer(ctx, w, id);
      } },
    { id: "answer", once: true,
      does: accepts ? "Host accepts the introduction" : "Host declines the introduction",
      shows: accepts ? "\"Introduction approved\" fills the page, naming the ZZ seeker; Back to my account; then \"Introduced on …\" at the top of the card; the introduction email to both, with Will and Chris in copy"
        : "\"Declined…\" and the seeker's \"An update on\" email",
      run: async (ctx) => {
        const id = await openOffer(ctx), w = await signIn(ctx, "host"), m = made(ctx);
        if (!(await shows(w.page, `#introAnswer-${id}`, 1500))) {
          await go(w.page, `${APEX}/hub/account/#intro-${id}`);
          await w.page.locator(`[data-act="intro-accept-open"][data-intro="${id}"]`).waitFor({ state: "visible", timeout: 25000 });
          if (accepts) await openAnswer(ctx, w, id);
        }
        let note = "", late = null;
        try {
          note = await answer(ctx, w, id, { accept: accepts, ref: m.ref, seeker: acct(ctx, "seeker").email, host: acct(ctx, "host").email,
            named: accepts ? acct(ctx, "seeker").company : "" });
        } catch (e) { if (!(e instanceof Soft)) throw e; late = e; }
        if (accepts) {
          /* commercial.js DESK_COPY: Will and Chris are in copy. Will's is the admin address in the settings. */
          if (ctx.settings.admin.email) ctx.mail.expect(`The introduction email, ${m.ref} (you, in copy)`, ctx.settings.admin.email, `Introduction ${m.ref}`);
          ctx.notes.push(`The introduction email for ${m.ref} copies Chris in: check it reached him (the runner does not read his mailbox).`);
          ctx.notes.push(`The ZZ host now has an accepted introduction (${m.ref}), so it is asked to declare every month from the 3rd of the next: the engine emails it on the 3rd and the 10th and opens a strike on it on the 16th if nothing is sent. money.declare sends the declaration; run it each month while the two ZZ accounts stand, or clear them out (queue DB5).`);
          ctx.left.push(`introduction ${m.ref} accepted: the two ZZ accounts have each other's details`);
        }
        if (late) throw late;
        return note;
      } },
  ];
  /* 6.8: the Inbox's Re-route card on a declined offer offers "Resend to
     <site>" (jobs.js reroutePanel, reissue-acceptance). The runner presses
     that and never Re-route, which would offer the ZZ request to a real site. */
  const reissueSteps = accepts ? [] : [
    { id: "reissue", once: true, does: "Admin: on the seeker's company page, the Re-route card for the declined offer: Resend to the ZZ host",
      shows: "\"Send the offer … to the same site again?\"; queued; the offer back at awaiting acceptance; the offer email to the host again",
      run: async (ctx) => {
        const m = made(ctx);
        if (!m.intro) skip(NO_REQUEST);
        if (!adminAvailable(ctx)) skip(NO_ADMIN);
        const row = await inboxRow(ctx, "reroute", m.intro);
        const { w, item } = await jobOnCompanyPage(ctx, row);
        const open = item.locator('[data-act="jobOpen"][data-ui="resend"]');
        if (!(await open.count())) differs("the Re-route card", await item.textContent(), "Resend to the ZZ host");
        /* The button reads "<icon name>Resend to <site>" (jobs.js btn puts the icon's name first). */
        mustBeZZ((await open.textContent()).trim().replace(/^.*?Resend to\s*/, ""), "the site the offer is resent to");
        await open.click();
        const go2 = w.page.locator(`#job-${domId(row.item_key)} [data-act="jobResend"]`);
        await go2.waitFor({ state: "visible" }).catch(() => differs("Resend to the ZZ host", "no question opened", "Resend the offer"));
        await saveVia(w.page, () => go2.click(), ctx);
        const back = await pollUntil(async () => {
          const i = (await dbRead(ctx, "introductions", "id,stage", [["eq", "id", m.intro]]))[0];
          return i && i.stage === "awaiting_acceptance" ? i : null;
        });
        if (!back) wait("resent and queued; the engine has not reopened the offer yet");
        ctx.mail.expect(`The offer to the host, sent again by the desk, ${m.ref}`, acct(ctx, "host").email, `New introduction for you, ${m.ref}`);
      } },
    { id: "reanswer", once: true, does: "Host opens the reopened row and declines again", shows: "\"Open until …\" again; then declined, and the seeker's \"An update on\" email",
      run: async (ctx) => {
        const id = await openOffer(ctx), m = made(ctx), w = await signIn(ctx, "host");
        await go(w.page, `${APEX}/hub/account/#intro-${id}`);
        await see(w.page, `#intro-${id}`, "Open until", "the reopened row", 25000);
        return answer(ctx, w, id, { accept: false, ref: m.ref, seeker: acct(ctx, "seeker").email, host: acct(ctx, "host").email });
      } },
  ];
  const lastSteps = [
    /* Plan 106 (live 25 November 2026; admin/inbox.html activityHtml): the
       Inbox lists every introduction event of the last 14 days under
       Activity, newest first, both companies named. Nothing in it is a job:
       no line has a button. */
    { id: "activity", does: "Admin, Inbox: the Activity list",
      shows: `"<ZZ seeker> asked to be introduced to <ZZ host>" and "<ZZ host> ${accepts ? "accepted: introduced to" : "declined the introduction to"} <ZZ seeker>", each with the reference, and no button on either`,
      run: async (ctx) => {
        const m = made(ctx);
        if (!m.intro) skip(NO_REQUEST);
        if (!adminAvailable(ctx)) skip(NO_ADMIN);
        if (m.sentAt && Date.now() - m.sentAt > 13 * 24 * 3600 * 1000) skip("the request is nearly a fortnight old, and Activity keeps 14 days");
        const host = acct(ctx, "host").company.trim().toLowerCase(), seeker = acct(ctx, "seeker").company.trim().toLowerCase();
        const w = await adminGo(ctx, "inbox.html");
        try {
          await w.page.locator("#activity-h").waitFor({ state: "visible", timeout: 25000 }).catch(() => differs("the Inbox", "no Activity list", "Activity, under the queue"));
          const lines = (await w.page.locator(".qitem.activity").evaluateAll((els) => els.map((e) => ({
            words: (e.getAttribute("aria-label") || "").toLowerCase(), buttons: e.querySelectorAll("button").length }))))
            .filter((l) => l.words.includes(String(m.ref).toLowerCase()));
          const wanted = [`${seeker} asked to be introduced to ${host}`,
            accepts ? `${host} accepted: introduced to ${seeker}` : `${host} declined the introduction to ${seeker}`];
          const missing = wanted.filter((x) => !lines.some((l) => l.words.startsWith(x)));
          if (missing.length) differs(`Activity, for ${m.ref}`, lines.map((l) => l.words).join(" | ") || "no line with that reference", missing.join("; "));
          if (lines.some((l) => l.buttons)) differs(`Activity, for ${m.ref}`, "a button on a line", "nothing to press: nothing in Activity is a job");
        } catch (e) { throw new Soft(String(e.message || e)); }
        return `${m.ref}: asked, then ${accepts ? "accepted" : "declined"}`;
      } },
    /* The seeker's request is known by its INTRO- code once an introduction
       exists (dashboard.js requestRefs, requestCard); the PS- or MS- code is
       the desk's and the email's. */
    { id: "seeker-sees", does: "Seeker opens its account page", shows: "The request, by its INTRO- reference, with where it stands",
      run: async (ctx) => {
        const m = made(ctx);
        if (!m.ref) skip(NO_REQUEST);
        const w = await signIn(ctx, "seeker");
        await go(w.page, `${APEX}/hub/account/`);
        await see(w.page, "#introductions", m.ref, "the request on the seeker's account page", 25000);
      } },
  ];
  return {
    id: `hubs.${h.key}`, title: `The ${h.name}: list, ${print ? "ask for a call, " : ""}approve, ${print ? "change, " : ""}search, pick, ${accepts ? "accept" : "decline, offer again"}`,
    pass: "computer", needs: ["host", "seeker"],
    from: print ? "action list 5.1, 5.2, 5.5 to 5.7, 6.1 to 6.5, then the decline and the desk's offer again (6.7, 6.8, the Mill Hub's until 25 November 2026); Ask for a call added at Will's word, 12 November 2026 (queue step DQ6)"
      : "action list 5.3, 5.4, then the acceptance (6.6, the 3D Print Hub's until 25 November 2026: a second pick of the same company is refused since plan 104, so the accepted offer comes last)",
    steps: [].concat(listingSteps, changeSteps, seekSteps, resendStep, answerSteps, reissueSteps, lastSteps),
  };
};

// ================================================================ 7. money
/* Plan 106 (live 25 November 2026).
   A host declares on its own page, /hub/account/declare/ (declare.js): one
   line for each introduction, a value and its currency (GBP, EUR, USD, CAD,
   AUD or ILS; no units), or "No revenue". The account page keeps one button
   to it (dashboard.js renderMonthsDeclarations).
   The clock is the worker's (declarations.js: newestListedMonth,
   declareByFor, monthsSection), read in Europe/London: a month is listed
   from the 3rd of the month after it, for an introduction accepted by its
   end; the 15th is the last day on time; from the 16th it reads "not
   declared". A page writes no day of its own. A sent month is locked: a
   correction is the desk's (409 already_sent).
   The engine builds the month's statement at its next run (statements.py,
   in hourly-sync, so within two hours) and raises its invoice with no
   press, except where money_handlers.raise_without_a_press holds it: a test
   account, a disputed line, a currency outside the six. So a ZZ host's
   statement is left issued, with no fee_invoices row: nothing reaches Xero
   and there is nothing to void. Money offers "Raise invoice in Xero (test
   account)" on it; the runner never presses that. A nil return builds no
   statement at all.
   So this journey finishes over more than one run: an introduction is
   accepted in one month, and the month is declared from the 3rd of the next. */
const CURRENCIES = ["GBP", "EUR", "USD", "CAD", "AUD", "ILS"];
const unsent = (m) => !!m && (m.state === "open" || m.state === "not_declared");
/* The month the pages offer to declare: the newest not yet sent that owes a
   line (dashboard.js monthToDeclare; declare.js with no ?period=). */
const monthToDeclare = (months) => months.filter(unsent).filter((m) => !Array.isArray(m.due) || m.due.length > 0)[0] || null;
async function hostMonths(ctx) {
  const w = await signIn(ctx, "host");
  const r = await apiGet(w.page, "/declarations");
  /* The last full run took the ZZ accounts off the hub (admin.orgs), and the
     worker refuses a removed account everything, its declaration too. A run
     of this journey alone must put the host back first. */
  if (r.status === 403 && r.body && r.body.error === "account_removed") {
    wait("the ZZ host is removed from the hub, so it cannot declare: run admin.restore first (a full run does; with --only, name it too: --only admin.restore,money)");
  }
  if (r.status !== 200 || !r.body || !r.body.declarations) differs("the host's declarations", `the API answered ${r.status}`, "what is open");
  const months = r.body.declarations.months;
  if (!Array.isArray(months)) differs("the host's declarations", "no list of months", "declarations.months, newest first (plan 106)");
  return { w, months };
}
const FEE_COLS = "id,statement_id,org_id,amount,currency,xero_invoice_number,invoiced_at,voided_at,requested_by,last_error";
/* The fee invoices on a statement that are not voided. For a ZZ host there
   should be none; any there is has reached Xero or soon will, so it is
   listed for voiding before the step says it differed. */
async function feesOn(ctx, org, statementId, what) {
  const rows = (await dbRead(ctx, "fee_invoices", FEE_COLS, [["eq", "statement_id", statementId]])).filter((f) => !f.voided_at);
  for (const f of rows) {
    recordInvoice(ctx, { what: `Fee invoice for ${org.name}, ${what}`, table: "fee_invoices", id: f.id,
      number: f.xero_invoice_number || "", company: org.name, amount: `${f.currency || "GBP"} ${f.amount}` });
  }
  return rows;
}
/* What a sent month says of itself, kept with the journey for the steps after. */
function noteSent(m, month) {
  const line = (month.lines || []).find((l) => l && !l.nothing && isZZ(l.company)) || (month.lines || []).find((l) => l && !l.nothing) || null;
  Object.assign(m, { period: month.period, open: false, declared: line ? "line" : "nothing" });
  if (line) Object.assign(m, { intro: line.introduction_id, ref: line.ref, value: Number(line.value), currency: line.currency || "GBP" });
}

const declare = {
  id: "money.declare", title: "Money: a month declared on the declaration page, locked, on Orders, its statement built and its invoice held", pass: "computer", needs: ["host"],
  from: "action list 7.1 to 7.4, as plan 106 left them; from the 3rd of the month after the Mill Hub introduction is accepted",
  steps: [
    { id: "card", does: "Host opens Declarations on its account page",
      shows: "No form: one button, \"Declare <month>\", to the declaration page, with \"Open now. Declare by 15 <the month after>.\" (from the 16th, \"Overdue. It was due by …\"). The month is listed from the 3rd",
      run: async (ctx) => {
        const { w, months } = await hostMonths(ctx);
        const m = made(ctx), now = londonNow();
        /* The clock, checked against the worker's own rule. */
        const newest = now.day >= 3 ? now.last : stepPeriod(now.last, -1);
        if (months.length && months[0].period > newest) differs(`the newest month listed on the ${now.day} of the month`, months[0].period, `${newest} at the latest: a month is listed from the 3rd of the next`);
        const open = monthToDeclare(months), sent = months.filter((x) => x && x.period && !unsent(x));
        if (!open && !sent.length) {
          wait(`nothing is open to declare yet: a month is listed from the 3rd of the month after it, for an introduction accepted by its end (the ZZ host accepts one in hubs.${ACCEPTS})`);
        }
        if (open) {
          const want = open.period < now.last || now.day >= 16 ? "not_declared" : "open";
          if (open.state !== want) differs(`${open.period}, on the ${now.day} of the month`, open.state, `${want}: the 15th is the last day on time`);
          if (open.declare_by !== `${stepPeriod(open.period, 1)}-15`) differs(`the last day on time for ${open.period}`, open.declare_by, `${stepPeriod(open.period, 1)}-15`);
          /* A new month to declare: what the journey kept of an earlier
             month is put down, and the two steps that act once a month
             (declare, edit-line) are free to run again. The worker refuses
             a second declaration for a month whatever this file remembers. */
          if (m.period !== open.period) for (const k of ["statement", "declared", "intro", "ref", "value", "currency", "rate"]) delete m[k];
          const at = ctx.state.at[ctx.current.key];
          if (at && Array.isArray(at.done)) at.done = at.done.filter((id) => id !== "declare" && id !== "edit-line");
          Object.assign(m, { period: open.period, open: true });
        } else {
          noteSent(m, sent.find((x) => x.period === m.period) || sent[0]);
        }
        await go(w.page, `${APEX}/hub/account/#declarations`);
        await see(w.page, "#declarations", "Declarations", "the Declarations section", 25000);
        await w.page.waitForLoadState("networkidle").catch(() => {});
        if (await w.page.locator("#declarations input, #declarations select, #declarations .decl-table").count()) {
          differs("Declarations on the account page", "a form", "one button to the declaration page (plan 106, D5)");
        }
        if (!open) {
          await see(w.page, "#declarations", "Nothing else to send.", "Declarations with every month sent");
          return `${monthName(m.period)} is declared already (${m.declared === "line" ? "a line" : "a nil return"}); nothing else is open`;
        }
        const by = dayWords(open.declare_by);
        await see(w.page, "#declarations a.acct-declare", `Declare ${monthName(open.period)}`, "the button to the declaration page");
        const href = await w.page.getAttribute("#declarations a.acct-declare", "href");
        if (href !== `declare/?period=${open.period}`) differs("where the button goes", href, `declare/?period=${open.period}`);
        await see(w.page, "#declarations .acct-declare-row", open.state === "open" ? `Open now. Declare by ${by}.` : `Overdue. It was due by ${by}.`, "the words beside the button");
        /* The engine's emails for the month (declarations.py: from the 3rd,
           and again from the 10th while nothing is sent). Looked for, never
           required: the daily run may not have gone yet today. */
        const host = acct(ctx, "host").email, box = ctx.mail.on ? ctx.mail.boxFor(host) : "";
        if (box && open.period === now.last) {
          const since = `${now.month}-03T00:00:00Z`;
          const found = async (subject) => ctx.mail.find(box, { to: host, subject, since }).catch(() => null);
          const prompt = await found(/^Time to declare your .+ orders for /), again = now.day >= 10 ? await found(/^Reminder: your .+ declaration for /) : null;
          ctx.notes.push(`The engine's email asking the ZZ host to declare ${monthName(open.period)} ${prompt ? `arrived ("${prompt.subject}")` : "was not in its mailbox when the runner looked (it goes with the engine's daily run from the 3rd; check by hand if that has run today)"}` +
            (now.day >= 10 ? `; the reminder of the 10th ${again ? `arrived ("${again.subject}")` : "was not there"}.` : "."));
        }
        return `${open.period}, ${open.state}, ${(open.due || []).length} introduction(s), declare by ${by}`;
      } },
    { id: "declare", once: true,
      does: "Opens the declaration page with no month in its address, as the engine's email does. Presses Send on the empty form; then types 10 in GBP on one introduction with a ZZ company and ticks No revenue on every other (No revenue on all when an earlier month carries a line)",
      shows: "\"Declare <month>\", the newest month not yet sent; a line an introduction, by company; a value and one of six currencies, no Units; the empty form refused in words with nothing sent; the fee worked out as the value is typed; then \"Declared for <month>\" (all No revenue: asked once more, \"Send a nil return\"); the desk notice; the seeker gets no email",
      run: async (ctx) => {
        const m = made(ctx), p = m.period;
        if (!p) wait("no month to declare was found");
        const { w, months } = await hostMonths(ctx);
        const month = months.find((x) => x && x.period === p);
        if (!month || !unsent(month)) {
          if (month) noteSent(m, month);
          skip(`${monthName(p)} is declared already, and a sent month is locked`);
        }
        const due = (month.due || []).filter((x) => x && x.introduction_id != null);
        if (!due.length) differs(`the introductions ${monthName(p)} is due for`, "none listed", "one for each introduction made by the month's end");
        await go(w.page, `${APEX}/hub/account/declare/`);
        await w.page.locator("#declCard .decl-table tbody tr").first().waitFor({ state: "visible", timeout: 30000 })
          .catch(async () => differs("the declaration page", await text(w.page, "#declCard").catch(() => ""), "the form, one line an introduction"));
        await see(w.page, "#declTitle", `Declare ${monthName(p)}`, "the month the page opens on when its address names none");
        const rows = await w.page.locator("#declCard .decl-table tbody tr").count();
        if (rows !== due.length) differs("the lines on the declaration page", `${rows}`, `${due.length}, one for each introduction`);
        const offered = await w.page.locator("#dc-0 option").evaluateAll((els) => els.map((e) => e.value));
        if (offered.join() !== CURRENCIES.join()) differs("the currencies offered", offered.join(", "), CURRENCIES.join(", "));
        if ((await w.page.locator("#declCard input[type=number]").count()) || /Units/.test(await text(w.page, "#declCard"))) {
          differs("the declaration form", "a Units box", "a value and its currency, and nothing else (plan 106, D2)");
        }
        await see(w.page, "#declFoot", month.state === "not_declared" ? `This declaration was due by ${dayWords(month.declare_by)}.` : `Declare by ${dayWords(month.declare_by)}.`,
          "the last day on time, in the worker's own date");
        /* One line, on an introduction whose company is a ZZ one and on a hub
           (the worker names no company on the Opportunities Board); every
           other row is answered No revenue, a real company's above all. */
        const before = months.some((x) => x && x.period < p && (x.lines || []).some((l) => l && !l.nothing));
        const at = before ? -1 : due.findIndex((d) => (d.hub === "print" || d.hub === "mill") && isZZ(d.company));
        if (at >= 0) {
          mustBeZZ(due[at].company, "the company the line is declared against");
          const who = await text(w.page, `#declCard tr[data-row="${at}"] .co`);
          if (!who.includes(due[at].company) || !who.includes(due[at].ref)) throw new Refused(`refused: line ${at + 1} on the page reads ${JSON.stringify(who.slice(0, 80))}, not ${due[at].company} (${due[at].ref})`);
        }
        const hubs = [...new Set(due.map((d) => d.hub || ""))];
        const sentBodies = [];
        let taken = 0;
        const onRequest = (q) => { if (q.url() === `${API}/declarations` && q.method() === "POST") { try { sentBodies.push(q.postDataJSON()); } catch { sentBodies.push(null); } } };
        const onResponse = (res) => { if (res.url() === `${API}/declarations` && res.request().method() === "POST" && res.ok()) { taken += 1; ctx.did(); } };
        w.page.on("request", onRequest);
        w.page.on("response", onResponse);
        try {
          /* Plan 098, kept by plan 106: every introduction is answered before anything is sent. */
          await w.page.click("#declSend");
          await see(w.page, "#declMsg", "Type a value on each line, or tick \"No revenue\".", "Send on an empty declaration", 10000);
          await w.page.waitForTimeout(1500);
          if (sentBodies.length) differs("Send on an empty declaration", `${sentBodies.length} declaration(s) sent`, "nothing sent");
          for (let n = 0; n < due.length; n++) {
            if (n === at) {
              await w.page.fill(`#dv-${n}`, "10");
              await w.page.selectOption(`#dc-${n}`, "GBP");
            } else {
              await w.page.check(`#dn-${n}`);
            }
          }
          if (at >= 0) {
            /* The fee is the page's own sum, at the worker's rate for the line: value x rate, to the penny. */
            const fee = cash(Math.round(1000 * Number(due[at].rate || 0)) / 100, "GBP");
            await see(w.page, `#df-${at}`, fee, "the fee, worked out as the value is typed", 5000);
            await see(w.page, "#declTotal", fee, "the total fee", 5000);
          }
          if (await shows(w.page, "#declTerms [data-np-terms-tick]", 1500)) await w.page.check("#declTerms [data-np-terms-tick]");
          await w.page.click("#declSend");
          if (at < 0) {
            /* A month with no revenue at all is asked once more: "Send a nil return" takes the Send button's place. */
            const nil = w.page.locator('#declConfirm [data-act="nil-send"]');
            await nil.waitFor({ state: "visible", timeout: 10000 }).catch(() => differs("a month with no revenue at all", "sent on the first press", "asked once more: Send a nil return"));
            if (sentBodies.length) differs("before the nil return is confirmed", `${sentBodies.length} declaration(s) sent`, "nothing sent");
            await nil.click();
          }
          const done = w.page.locator("#declCard .decl-done:not(.is-quiet) h2"), refused = w.page.locator("#declMsg:not([hidden])");
          await Promise.race([done.waitFor({ state: "visible", timeout: 60000 }), refused.waitFor({ state: "visible", timeout: 60000 })]).catch(() => {});
          if (!(await done.isVisible().catch(() => false))) {
            differs("sending the declaration", (await text(w.page, "#declMsg").catch(() => "")) || "neither \"Declared for\" nor a refusal showed", `Declared for ${monthName(p)}`);
          }
        } finally { w.page.off("request", onRequest); w.page.off("response", onResponse); }
        Object.assign(m, { open: false, declared: at < 0 ? "nothing" : "line" });
        if (at >= 0) Object.assign(m, { intro: due[at].introduction_id, ref: due[at].ref, value: 10, currency: "GBP", rate: Number(due[at].rate || 0) });
        await see(w.page, "#declCard .decl-done h2", `Declared for ${monthName(p)}`, "after sending the declaration");
        await see(w.page, "#declCard .decl-done p", at < 0 ? "No revenue this month, so there is no invoice." : "Your invoice is being raised", "the words after sending");
        if (ctx.mail.s.desk) ctx.mail.expect(`Desk notice: a declaration filed, ${p}`, ctx.mail.s.desk, "declaration filed by");
        ctx.left.push(`a ${p} declaration by ${acct(ctx, "host").company} (${at < 0 ? "no revenue" : `GBP 10 on ${m.ref}`})`);
        const odd = [];
        if (taken !== hubs.length) odd.push(`${taken} declaration(s) were taken, expected ${hubs.length}, one for each hub`);
        if (sentBodies.some((b) => !b || b.period !== p)) odd.push(`a declaration went for a month other than ${p}`);
        if (JSON.stringify(sentBodies).includes("units")) odd.push("what was sent carries units (plan 106, D2: a value and its currency only)");
        if (odd.length) throw new Soft(odd.join("; "));
        return at < 0 ? `No revenue on every line for ${p}${before ? " (an earlier month carries the line)" : " (no line names a ZZ company on a hub)"}` : `one line on ${m.ref}: GBP 10, for ${p}`;
      } },
    /* Plan 106, D10: a sent declaration is locked. The Change this
       declaration button and Keep what I sent (plan 098) have gone with the
       account page's form; a correction is the desk's. */
    { id: "locked", does: "Host opens the declaration page on the month it sent, then the account page",
      shows: "\"<month> has already been declared. To change it, talk to the desk.\", with no form; no Change this declaration on the account page; nothing sent",
      run: async (ctx) => {
        const m = made(ctx), p = m.period;
        if (!p || m.open) wait("the month has not been declared yet");
        const w = await signIn(ctx, "host");
        let sentAny = 0;
        const on = (q) => { if (q.url() === `${API}/declarations` && q.method() === "POST") sentAny += 1; };
        w.page.on("request", on);
        try {
          await go(w.page, `${APEX}/hub/account/declare/?period=${encodeURIComponent(p)}`);
          await see(w.page, "#declCard .decl-done.is-quiet p", `${monthName(p)} has already been declared. To change it, talk to the desk.`, "the declaration page on a sent month", 30000);
          if (await w.page.locator("#declCard input, #declCard select, #declSend").count()) differs("the declaration page on a sent month", "a form", "no form: a sent month is locked");
          await go(w.page, `${APEX}/hub/account/#declarations`);
          await see(w.page, "#declarations", "Declarations", "the Declarations section", 25000);
          await w.page.waitForLoadState("networkidle").catch(() => {});
          if (await w.page.locator('#declarations [data-act="decl-change"], #declarations [data-act="decl-keep"]').count()) {
            differs("Declarations on the account page", "Change this declaration", "no way to change a sent month (plan 106, D10)");
          }
          if (await w.page.locator(`a.acct-declare[href="declare/?period=${p}"]`).count()) differs("the account page", `a Declare button for ${monthName(p)}`, "none on a month already sent");
        } finally { w.page.off("request", on); }
        if (sentAny) differs("looking at a sent month", `${sentAny} declaration(s) sent`, "nothing sent");
        return "locked: no form on the declaration page, and no way to change it on the account page";
      } },
    { id: "orders", does: "Admin, Orders: picks the month and finds the ZZ host's declaration", shows: "The ZZ host's card for that month, with the line's reference and its value, or NOTHING DECLARED",
      run: async (ctx) => {
        if (!adminAvailable(ctx)) skip("the admin is not open on this run");
        const m = made(ctx);
        if (!m.period || m.open) wait("the month has not been declared yet");
        const org = await hostOrg(ctx), w = await adminGo(ctx, "orders.html");
        await w.page.selectOption("#month", m.period).catch(() => differs("the month on Orders", "not in the picker", m.period));
        /* One card for each hub the host owes a declaration on. */
        const cards = w.page.locator("#recRows .row", { has: w.page.locator(".company", { hasText: org.name }) });
        await cards.first().waitFor({ state: "visible", timeout: 25000 }).catch(() => differs("the ZZ host on Orders", "no card for it", `${org.name}, ${m.period}`));
        const got = [];
        for (let n = 0; n < await cards.count(); n++) {
          const card = cards.nth(n), name = ((await card.locator(".company").first().textContent()) || "").trim();
          if (!same(name, org.name)) continue;
          mustBeZZ(name, "the card on Orders");
          got.push(((await card.textContent()) || "").replace(/\s+/g, " "));
        }
        if (!got.length) differs("the ZZ host on Orders", "no card for it", `${org.name}, ${m.period}`);
        if (m.declared === "nothing") { if (!got.some((t) => t.includes("NOTHING DECLARED"))) differs("the card on Orders", got.join(" | "), "NOTHING DECLARED"); return "nothing declared"; }
        const value = Number(m.value || 0).toFixed(2);
        if (!got.some((t) => t.includes(m.ref) && t.includes(value))) differs("the line on Orders", got.join(" | "), `${m.ref}, ${m.currency || "GBP"} ${value}`);
        return `${m.ref}, ${m.currency || "GBP"} ${value}`;
      } },
    { id: "statement", does: "Admin, Money: the month's statement, which the engine builds at its next run with no press",
      shows: "The ZZ host's statement for the month: Ready to invoice, tagged Test account, the declared line at its rate, no units. Its invoice is held, because this is a test account: \"Raise invoice in Xero (test account)\" is offered and never pressed, and there is no fee invoice",
      run: async (ctx) => {
        if (!adminAvailable(ctx)) skip("the admin is not open on this run");
        const m = made(ctx), p = m.period;
        if (!p || m.open) wait("the month has not been declared yet");
        if (m.declared === "nothing") skip("a nil return builds no statement and no invoice");
        const org = await hostOrg(ctx);
        const read = async () => (await dbRead(ctx, "statements", "id,org_id,period,quarter,status,currency,lines,totals,issued_at", [["eq", "org_id", org.id], ["eq", "period", p]]))
          .filter((s) => s.status !== "void").sort((a, b) => b.id - a.id)[0];
        const st = await pollUntil(async () => { const s = await read(); return s && s.status !== "draft" ? s : null; }, { ms: 3 * 60 * 1000, every: 15000 });
        if (!st) wait(`the engine has not built ${org.name}'s ${monthName(p)} statement yet: it does at its next run, within two hours of the declaration. Run this journey again then`);
        m.statement = st.id;
        const fees = await feesOn(ctx, org, st.id, `the ${monthName(p)} statement`);
        if (fees.length) {
          differs(`fee invoices on the ZZ host's ${monthName(p)} statement`, fees.map((f) => `${f.currency} ${f.amount}, ${f.xero_invoice_number || "not numbered yet"}, asked for by ${f.requested_by || "nobody named"}`).join("; "),
            "none: the engine never raises a test account's invoice, so nothing reaches Xero (listed for voiding below)");
        }
        if (st.status !== "issued") differs(`the ZZ host's ${monthName(p)} statement`, st.status, "issued, and left so: its invoice is held");
        const line = (st.lines || []).find((l) => l && l.ref === m.ref && l.period === p);
        if (!line) differs("the statement's lines", JSON.stringify(st.lines || []).slice(0, 160), `${m.ref}, ${p}`);
        const fee = Math.round(Number(line.value) * Number(line.rate) * 100) / 100;
        const odd = [];
        if (Math.abs(Number(line.value) - Number(m.value)) > 0.004) odd.push(`the line's value is ${line.value}, expected ${m.value}`);
        if (Math.abs(Number(line.fee) - fee) > 0.004) odd.push(`the line's fee is ${line.fee}, expected ${fee} (its value at its rate)`);
        if (m.rate != null && Math.abs(Number(line.rate) - Number(m.rate)) > 1e-9) odd.push(`the line's rate is ${line.rate}, and the declaration page showed ${m.rate}`);
        if (line.units != null) odd.push(`the line carries ${line.units} units, expected none`);
        const w = await adminGo(ctx, `money.html?tab=statements&period=${encodeURIComponent(p)}`);
        const panel = w.page.locator(`#st-${st.id}`);
        await panel.waitFor({ state: "visible", timeout: 25000 }).catch(() => differs("the statement on Money", "not shown", `${org.name}, ${monthName(p)}`));
        mustBeZZ((await panel.locator(".co-name").first().textContent()).trim(), "the statement on Money");
        await see(w.page, `#st-${st.id} .stmt-head`, "Ready to invoice", "the statement's state on Money");
        await see(w.page, `#st-${st.id} .stmt-head`, "Test account", "the tag on a test account's statement");
        const button = panel.locator(`[data-act="raiseStatement"][data-statement="${st.id}"]`);
        if (!(await button.count()) || !((await button.first().textContent()) || "").includes("(test account)")) {
          differs("the held raise on Money", ((await panel.locator(".actions").first().textContent()) || "").replace(/\s+/g, " "), "Raise invoice in Xero (test account), offered and not pressed");
        }
        await see(w.page, `#st-${st.id} .actions`, "its raise was held", "why the statement waits for a person");
        if (odd.length) throw new Soft(odd.join("; "));
        return `statement ${st.id}: ${line.currency} ${line.value} at ${+(Number(line.rate) * 100).toFixed(2)}%, fee ${line.fee}; its invoice held, nothing raised in Xero`;
      } },
    /* The desk's correction (plan 106, D10; money.html canEdit and saveLine,
       the engine's edit-declaration-line): a line is edited before it is
       invoiced, the change kept with its reason, and the statement rebuilt.
       On a real host that means voiding the invoice first; a ZZ host's was
       never raised. */
    { id: "edit-line", once: true, does: "Admin, Money: on that statement, corrects the declared line's value from 10 to 12, with a reason",
      shows: "Queued; the line's new value; the statement rebuilt with it",
      run: async (ctx) => {
        if (!adminAvailable(ctx)) skip("the admin is not open on this run");
        const m = made(ctx), p = m.period;
        if (m.declared === "nothing") skip("a nil return has no line to correct");
        if (!m.statement) wait("the month's statement is not built yet");
        const org = await hostOrg(ctx);
        const s = (await dbRead(ctx, "statements", "id,org_id,period,status", [["eq", "id", m.statement]]))[0];
        if (!s || s.org_id !== org.id) throw new Refused("refused: that statement is not the ZZ host's");
        if (s.status !== "issued") skip(`the statement is ${s.status}: a line is corrected only before it is invoiced`);
        if ((await feesOn(ctx, org, s.id, `the ${monthName(p)} statement`)).length) skip("the statement has a fee invoice; a line is corrected before it is invoiced");
        const lines = (await dbRead(ctx, "declaration_lines", "id,statement_id,introduction_id,value,units,currency,superseded_at", [["eq", "statement_id", s.id]])).filter((l) => !l.superseded_at);
        const line = lines.find((l) => String(l.introduction_id) === String(m.intro));
        if (!line) differs("the statement's lines", `${lines.length} line(s), none on ${m.ref}`, "the declared line");
        if (Number(line.value) !== 10) skip(`the line reads ${line.currency || "GBP"} ${line.value}, not the runner's own GBP 10: it was corrected on an earlier run`);
        const value = 12;
        const w = await adminGo(ctx, `money.html?tab=statements&period=${encodeURIComponent(p)}`);
        const panel = w.page.locator(`#st-${s.id}`);
        await panel.waitFor({ state: "visible", timeout: 25000 }).catch(() => differs("the statement on Money", "not shown", `${org.name}, ${monthName(p)}`));
        mustBeZZ((await panel.locator(".co-name").first().textContent()).trim(), "the statement on Money");
        await panel.locator(`[data-act="openUi"][data-ui="line:${line.id}"]`).click();
        await w.page.fill(`#el-value-${line.id}`, String(value));
        await w.page.fill(`#el-why-${line.id}`, `${MARK}: a test correction, please ignore.`);
        await saveVia(w.page, () => w.page.click(`[data-act="saveLine"][data-line="${line.id}"]`), ctx);
        const moved = await pollUntil(async () => {
          const l = (await dbRead(ctx, "declaration_lines", "id,value", [["eq", "id", line.id]]))[0];
          return l && Number(l.value) === value ? l : null;
        });
        if (!moved) wait("corrected and queued; the engine has not changed the line yet");
        m.value = value;
        const rebuilt = await pollUntil(async () => {
          const again = (await dbRead(ctx, "statements", "id,lines", [["eq", "id", s.id]]))[0];
          return again && (again.lines || []).some((l) => l && l.ref === m.ref && Number(l.value) === value) ? again : null;
        }, { ms: 60000, every: 5000 });
        if (!rebuilt) throw new Soft(`the line reads ${value}, but the statement's own lines still carry the old value: it was not rebuilt`);
        return `${line.currency || "GBP"} 10 to ${value}; the statement rebuilt`;
      } },
    /* What the host sees of the month (dashboard.js monthStatement and
       declDetails). For a ZZ host a line's month reads "Invoice on its way"
       for good, because its invoice is held. A strike is ours alone (plan
       106, D27): nothing on the page says the word. */
    { id: "host-month", does: "Host opens its account page after declaring",
      shows: "Under Monthly statements, the month with the value declared: \"Invoice on its way\" for a line, \"No revenue\" for a nil return. The same line under Declarations for this introduction, on its card. No Introduced customers, and the word strike nowhere",
      run: async (ctx) => {
        const m = made(ctx), p = m.period;
        if (!p || m.open) wait("the month has not been declared yet");
        const w = await signIn(ctx, "host");
        const sum = await apiGet(w.page, "/account/summary");
        if (sum.status !== 200 || !sum.body) differs("the host's account summary", `the API answered ${sum.status}`, "the account");
        const month = ((sum.body.declarations || {}).months || []).find((x) => x && x.period === p);
        if (!month) differs("the months on the host's summary", "the declared month is not listed", p);
        const want = m.declared === "nothing" ? "nothing" : "invoice_pending";
        const odd = [];
        if (month.state !== want) {
          odd.push(`the month's state is ${month.state}, expected ${want}${want === "invoice_pending" ? " (a ZZ account's invoice is held, so no invoice is numbered)" : ""}`);
        }
        if (Array.isArray(sum.body.open_strikes) && sum.body.open_strikes.length) odd.push(`the summary sends the host ${sum.body.open_strikes.length} open strike(s), expected none (plan 106, D27)`);
        await go(w.page, `${APEX}/hub/account/#fees`);
        const block = `#fees details.stmt[data-key="stmt-${p}"]`;
        await w.page.locator(block).first().waitFor({ state: "attached", timeout: 25000 }).catch(() => differs("Monthly statements on the account page", "no block for the month", monthName(p)));
        await see(w.page, "#fees", "Monthly statements", "the heading over the statements");
        const words = await text(w.page, block);
        if (!words.includes(monthName(p))) odd.push(`the month's block does not name ${monthName(p)}`);
        if (month.state === want && !words.includes(want === "nothing" ? "No revenue" : "Invoice on its way")) odd.push(`the month's block reads ${JSON.stringify(words.slice(0, 120))}, expected ${want === "nothing" ? "No revenue" : "Invoice on its way"}`);
        if (m.declared === "line" && !words.includes(cash(m.value, m.currency || "GBP"))) odd.push(`the month's block does not show ${cash(m.value, m.currency || "GBP")}, the value declared`);
        const fees = await text(w.page, "#fees"), page = await text(w.page, ".acct-wrap").catch(() => fees);
        if (/Introduced customers/.test(fees)) odd.push("Fees and standing still lists Introduced customers");
        if (/strike/i.test(page)) odd.push("the account page says the word strike, which a host is never shown (plan 106, D27)");
        if (m.declared === "line" && m.intro) {
          const card = await text(w.page, `#intro-${m.intro} details.intro-decl`).catch(() => "");
          if (!card.includes(monthName(p)) || !card.includes(cash(m.value, m.currency || "GBP"))) {
            odd.push(`Declarations for this introduction, on ${m.ref}'s card, reads ${JSON.stringify(card.slice(0, 140) || "nothing")}, expected ${monthName(p)} and ${cash(m.value, m.currency || "GBP")}`);
          }
        }
        if (odd.length) throw new Soft(odd.join("; "));
        return `${monthName(p)}: ${want === "nothing" ? "No revenue, no invoice" : `${cash(m.value, m.currency || "GBP")} declared, Invoice on its way (held)`}; no strike shown`;
      } },
    /* Not once: read again on every run, so an invoice somebody raised by
       hand on the test statement is still listed for voiding. */
    { id: "held", does: "Reads the fee invoices on the ZZ host's statement once more",
      shows: "None: the month's invoice was never raised, so there is nothing in Xero to void for it",
      run: async (ctx) => {
        if (!adminAvailable(ctx)) skip("the admin is not open on this run");
        const m = made(ctx);
        if (m.declared === "nothing") skip("a nil return has no statement and no invoice");
        if (!m.statement) skip("the month's statement is not built yet");
        const org = await hostOrg(ctx);
        const fees = await feesOn(ctx, org, m.statement, `the ${monthName(m.period)} statement`);
        if (fees.length) {
          differs(`fee invoices on the ZZ host's ${monthName(m.period)} statement`, fees.map((f) => `${f.currency} ${f.amount}, ${f.xero_invoice_number || "not numbered yet"}`).join("; "),
            "none (listed for voiding below)");
        }
        return "held: no fee invoice, nothing in Xero";
      } },
  ],
};

const moneyAdmin = {
  id: "money.admin", title: "Money: the membership clock, billing from the first introduction, an audit strike the host never sees", pass: "computer",
  needs: ["host", "admin", "window"], from: "action list 7.5 and 7.7; a strike is ours alone since plan 106 (D27)",
  steps: [
    { id: "clock", once: true, does: "Money, Memberships: Extend the clock on the ZZ host's unpaid invoice, a week past its last day, with a reason",
      shows: "Queued; \"Extended by hand to …\" on Money; \"(extended)\" on Organisations",
      run: async (ctx) => {
        const org = await hostOrg(ctx);
        const inv = (await dbRead(ctx, "membership_invoices", "id,org_id,xero_invoice_number,invoiced_at,paid_at,voided_at,hide_on,extended_to,period_start",
          [["eq", "org_id", org.id]])).filter((r) => r.invoiced_at && !r.paid_at && !r.voided_at)
          .sort((a, b) => String(a.period_start).localeCompare(String(b.period_start)))[0];
        if (!inv) skip("the ZZ host has no raised, unpaid membership invoice yet (its first listing is approved in hubs.print)");
        const until = addDays([today(), String(inv.hide_on || "").slice(0, 10)].sort().pop(), 7);
        const w = await adminGo(ctx, "money.html?tab=memberships");
        const row = w.page.locator("tr", { has: w.page.locator(`a[href=${quote(`company.html?org=${encodeURIComponent(org.id)}`)}]`) }).first();
        await row.waitFor({ state: "visible", timeout: 25000 }).catch(() => differs("the ZZ host on Memberships", "not listed", org.name));
        mustBeZZ((await row.locator("a.linkish").first().textContent()).trim(), "the membership row");
        const open = row.locator(`[data-act="openUi"][data-ui="extend:${inv.id}"]`);
        if (!(await open.count())) differs("Extend the clock", await row.textContent(), "the button on the unpaid invoice");
        await open.click();
        await w.page.fill(`#ex-until-${inv.id}`, until);
        await w.page.fill(`#ex-why-${inv.id}`, `${MARK}: a test extension, please ignore.`);
        await saveVia(w.page, () => w.page.click(`[data-act="extendClock"][data-invoice="${inv.id}"]`), ctx);
        const moved = await pollUntil(async () => {
          const r = (await dbRead(ctx, "membership_invoices", "id,extended_to,hide_on", [["eq", "id", inv.id]]))[0];
          return r && String(r.extended_to || "").slice(0, 10) === until ? r : null;
        });
        if (!moved) throw new Soft("extended and queued; the engine has not moved the day yet");
        ctx.left.push(`${org.name}'s membership clock extended to ${until}`);
        const link = `a[href=${quote(`company.html?org=${encodeURIComponent(org.id)}`)}]`;
        const m2 = await adminGo(ctx, "money.html?tab=memberships");
        await see(m2.page, `tr:has(${link})`, "Extended by hand", "the membership row on Money", 25000);
        const o = await adminGo(ctx, "organisations.html");
        await see(o.page, `#orgRows tr:has(${link})`, "(extended)", "the ZZ host on Organisations", 25000)
          .catch((e) => { throw new Soft(String(e.message || e)); });
        return `extended to ${until}`;
      } },
    { id: "defer", does: "Money, Memberships: looks for Bill from the first introduction on the ZZ host",
      shows: "Not offered: the host is billed, and the engine refuses a change of billing once a host is billed",
      run: async (ctx) => {
        const org = await hostOrg(ctx), w = await adminGo(ctx, "money.html?tab=memberships");
        const sel = `tr:has(a[href=${quote(`company.html?org=${encodeURIComponent(org.id)}`)}])`;
        await w.page.locator(sel).first().waitFor({ state: "visible", timeout: 25000 }).catch(() => differs("the ZZ host on Memberships", "not listed", org.name));
        const offered = await w.page.locator(`${sel} [data-act="openUi"][data-ui^="defer:"]`).count();
        if (offered) hand("Money offers a billing change on the ZZ host: it has no membership invoice. Decide by hand whether to press it");
        skip("not offered once a host is billed (money.html shows it only for an approved host with no invoice; handlers._defer_membership_billing refuses one that is billed). It can only be tried on a host before its first approval");
      } },
    { id: "strike", once: true, does: "Company page: Open audit strike on the ZZ host, with a reason", shows: "Queued; the strike under the account, Audit, with its cure-by date",
      run: async (ctx) => {
        const org = await hostOrg(ctx), why = `${MARK} ${ctx.stamp}: a test audit strike, please ignore.`;
        const w = await adminGo(ctx, `company.html?org=${encodeURIComponent(org.id)}`);
        await w.page.waitForFunction(() => { const p = document.getElementById("page"); return !!p && !/Reading the company\./.test(p.textContent); }, null, { timeout: 30000 });
        if (!(await text(w.page, "#page")).includes(org.name)) throw new Refused(`refused: the company page does not name ${JSON.stringify(org.name)}`);
        const open = w.page.locator(`[data-act="openAuditStrike"][data-org-id=${quote(org.id)}]`);
        await open.waitFor({ state: "visible", timeout: 20000 }).catch(() => differs("Open audit strike", "not on the account panel", "the button"));
        await open.click();
        await w.page.locator("#au-why").fill(why);
        made(ctx).strikeAt = new Date(Date.now() - 2000).toISOString();
        await saveVia(w.page, () => w.page.click(`[data-act="confirmAudit"][data-org-id=${quote(org.id)}]`), ctx);
        const s = await pollUntil(async () => (await dbRead(ctx, "strikes", "id,org_id,source,notes,cured_at,cure_by", [["eq", "org_id", org.id], ["eq", "source", "audit"]]))
          .find((x) => !x.cured_at && String(x.notes || "").includes(ctx.stamp)));
        if (!s) wait("opened and queued; the engine has not filed the strike yet");
        made(ctx).strike = s.id;
        ctx.left.push(`an audit strike on ${org.name} (cured by a later step)`);
        const p = await adminGo(ctx, `company.html?org=${encodeURIComponent(org.id)}`);
        await see(p.page, ".strike-row", "Audit", "the strike on the company page", 25000);
        return `strike ${s.id}, cure by ${s.cure_by}`;
      } },
    /* Plan 106, D27 (Will and Chris, 24 November 2026): a strike is ours
       alone. It is opened, cured and counted as before and the desk is told,
       but a host is never shown one and never emailed about one: the summary
       answers no open strikes (commercial.js), the account page draws none
       (dashboard.js renderFees) and the engine sends no strike email. */
    { id: "host-blind", does: "Host opens its account page while the strike is open, and its mailbox is looked in",
      shows: "The word strike nowhere on the page; its follow-through score still shown; no \"Action needed\" email to the host",
      run: async (ctx) => {
        const m = made(ctx);
        if (!m.strike) skip("the runner opened no strike on this run or an earlier one");
        const org = await hostOrg(ctx);
        const open = (await dbRead(ctx, "strikes", "id,cured_at", [["eq", "id", m.strike]]))[0];
        if (!open || open.cured_at) skip("the strike is cured already, so the page would say nothing of it either way");
        mustBeZZ(org.name, "the account under the strike");
        const w = await signIn(ctx, "host");
        const sum = await apiGet(w.page, "/account/summary");
        if (sum.status !== 200 || !sum.body) differs("the host's account summary", `the API answered ${sum.status}`, "the account");
        const odd = [];
        if (Array.isArray(sum.body.open_strikes) && sum.body.open_strikes.length) odd.push(`the summary sends the host ${sum.body.open_strikes.length} open strike(s), expected none`);
        await go(w.page, `${APEX}/hub/account/#fees`);
        await see(w.page, "#fees", "Fees and standing", "the host's Fees and standing", 25000);
        await see(w.page, "#fees", "Follow-through:", "the host's follow-through score, which it still sees");
        await w.page.waitForLoadState("networkidle").catch(() => {});
        if (/strike/i.test(await text(w.page, ".acct-wrap"))) odd.push("the account page says the word strike while one is open");
        const host = acct(ctx, "host").email, box = ctx.mail.on ? ctx.mail.boxFor(host) : "";
        let inbox = "the host's mailbox is not one the runner may read, so the email is for you to check by hand";
        if (box && m.strikeAt) {
          const sent = await ctx.mail.find(box, { to: host, subject: /^(Action needed on your .+ listing|Your strike on the .+ is cleared)$/, since: m.strikeAt }).catch(() => null);
          if (sent) odd.push(`the host was emailed about the strike ("${sent.subject}")`);
          inbox = "no strike email in the host's mailbox";
        }
        if (odd.length) throw new Soft(odd.join("; "));
        return `nothing on the host's page says strike; ${inbox}`;
      } },
    { id: "cure", once: true, does: "Cures that strike, with a note", shows: "Queued; the strike cured; no open strike on the company page",
      run: async (ctx) => {
        const org = await hostOrg(ctx), id = made(ctx).strike;
        if (!id) skip("the runner does not know which strike it opened; cure it by hand on the company page");
        const w = await adminGo(ctx, `company.html?org=${encodeURIComponent(org.id)}`);
        const cure = w.page.locator(`[data-act="cureStrike"][data-strike="${id}"]`);
        await cure.waitFor({ state: "visible", timeout: 25000 }).catch(() => differs("Cure on the strike", "not shown", `strike ${id}`));
        if (!(await text(w.page, "#page")).includes(org.name)) throw new Refused(`refused: the company page does not name ${JSON.stringify(org.name)}`);
        await cure.click();
        await w.page.locator("#cu-note").fill(`${MARK}: cured, a test.`);
        await saveVia(w.page, () => w.page.click(`[data-act="confirmCure"][data-strike="${id}"]`), ctx);
        const done = await pollUntil(async () => {
          const s = (await dbRead(ctx, "strikes", "id,cured_at", [["eq", "id", id]]))[0];
          return s && s.cured_at ? s : null;
        });
        if (!done) wait("cured and queued; the engine has not cured the strike yet");
        const p = await adminGo(ctx, `company.html?org=${encodeURIComponent(org.id)}`);
        await p.page.locator(`[data-act="cureStrike"][data-strike="${id}"]`).waitFor({ state: "detached", timeout: 25000 })
          .catch(() => differs("the strike on the company page", "still open", "cured"));
      } },
  ],
};

/* Every real Xero invoice raised and not yet seen voided, this run's and
   earlier runs' (ctx.state.invoices). The worker cannot void in Xero: it
   reads a void back from Xero (membership.js and fee-invoices.js, the
   Xero read-back, every 15 minutes). */
const VOID_TABLES = new Set(["membership_invoices", "fee_invoices"]);
const openInvoices = (ctx) => (ctx.state.invoices || []).filter((i) => !i.voided);
/* Every membership and fee invoice row on the ZZ host not voided, recorded,
   so one whose own step stopped before reading it back (the engine slow to
   file it) is still listed here. Only when the admin is open already on
   this run; it reads as the admin page does, and presses nothing. */
async function sweepInvoices(ctx) {
  if (!ctx.have.host || !adminAvailable(ctx) || !Object.values(ctx.windows).some((w) => w.role === "admin" && w.proved)) return;
  const org = await hostOrg(ctx), money = (r) => `${r.currency || "GBP"} ${r.amount}`;
  for (const r of (await dbRead(ctx, "membership_invoices", "id,kind,amount,currency,xero_invoice_number,voided_at", [["eq", "org_id", org.id]])).filter((x) => !x.voided_at)) {
    recordInvoice(ctx, { what: `Membership invoice for ${org.name} (${r.kind || "membership"})`, table: "membership_invoices", id: r.id,
      number: r.xero_invoice_number || "", company: org.name, amount: money(r) });
  }
  for (const f of (await dbRead(ctx, "fee_invoices", "id,amount,currency,xero_invoice_number,voided_at", [["eq", "org_id", org.id]])).filter((x) => !x.voided_at)) {
    recordInvoice(ctx, { what: `Fee invoice for ${org.name}`, table: "fee_invoices", id: f.id, number: f.xero_invoice_number || "", company: org.name, amount: money(f) });
  }
}
const voidJourney = {
  id: "money.void", title: "Money: every Xero invoice the runs raised, voided", pass: "last", needs: [],
  from: "action list 7.6",
  steps: [
    { id: "list", does: "Lists every Xero invoice the runs raised that has not been seen voided, and any other open invoice row on the ZZ host",
      shows: "Each with its number, company and amount",
      run: async (ctx) => {
        await sweepInvoices(ctx).catch((e) => {
          if (!(e instanceof Skipped)) ctx.notes.push(`The ZZ host's invoice rows could not be read for voiding (${String(e.message || e).split("\n")[0]}): check Money for any open invoice on it.`);
        });
        const open = openInvoices(ctx);
        if (!open.length) skip("no invoice is waiting to be voided");
        return open.map(describe).join("; ");
      } },
    { id: "ask", does: "Stops for you to void each one in Xero", shows: "You press Return once each is voided",
      run: async (ctx) => {
        const open = openInvoices(ctx);
        if (!open.length) skip("no invoice is waiting to be voided");
        const list = open.map((i, n) => `${n + 1}. ${describe(i)}`).join("\n    ");
        if (ctx.args.headless) hand(`void these in Xero, then run the test again to check: ${open.map(describe).join("; ")}`);
        const went = await askEnter(`Void each of these invoices in Xero (they are test invoices for ZZ accounts):\n    ${list}`);
        if (!went) hand(`you chose to void them later: ${open.map(describe).join("; ")}`);
        ctx.cache.voidAsked = true;
      } },
    { id: "check", does: "Reads each invoice's row as Money does until it shows voided (Xero is read back every 15 minutes)",
      shows: "Each one voided; any still open after 20 minutes is listed as differed",
      run: async (ctx) => {
        if (!ctx.cache.voidAsked) skip("you were not asked to void them on this run");
        const open = openInvoices(ctx);
        if (!adminAvailable(ctx)) hand(`check on Money that each is voided: ${open.map(describe).join("; ")}`);
        const readable = open.filter((i) => VOID_TABLES.has(i.table) && (i.id != null || i.number));
        const unreadable = open.filter((i) => !readable.includes(i));
        await adminGo(ctx, "money.html?tab=invoices");
        const voidedNow = async (i) => {
          const rows = await dbRead(ctx, i.table, "id,xero_invoice_number,voided_at", i.id != null ? [["eq", "id", i.id]] : [["eq", "xero_invoice_number", i.number]]);
          return rows.length && rows.every((r) => r.voided_at) ? rows[0].voided_at : "";
        };
        await pollUntil(async () => {
          for (const i of readable.filter((x) => !x.voided)) {
            const at = await voidedNow(i);
            if (at) { i.voided = true; i.voided_at = at; ctx.log(`  voided      ${describe(i)}`); }
          }
          return readable.every((x) => x.voided);
        }, { ms: 20 * 60 * 1000, every: 30000 });
        const still = readable.filter((i) => !i.voided);
        if (still.length) {
          differs(`${still.length} invoice(s) still open after 20 minutes`, still.map(describe).join("; ") +
            (unreadable.length ? `. Not readable here, check in Xero: ${unreadable.map(describe).join("; ")}` : ""), "voided");
        }
        if (unreadable.length) hand(`these cannot be read back from here; check each is voided in Xero: ${unreadable.map(describe).join("; ")}`);
        return `${readable.length} voided`;
      } },
  ],
};

export const HUB_JOURNEYS = HUBS.map(hubJourney).concat([declare, moneyAdmin, voidJourney]);

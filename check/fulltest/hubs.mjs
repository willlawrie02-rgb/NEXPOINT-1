// The full test: the 3D Print Hub and the Mill Hub (list, approve, change,
// search, pick, introduce), then the money that follows: declarations, the
// fee invoice, the membership clock, an audit strike, and voiding every Xero
// invoice the run raised (action list groups 5, 6 and 7).
//
// The host in the settings is a fresh ZZ account with no listing. Approving
// its first listing raises a real membership invoice in Xero (Will, 12
// November 2026): the run records it and money.void stops for it to be voided.
import { APEX, PRINT, MILL, OPPS, API, Refused, Soft, Skipped, mustBeZZ, isZZ, isZZSlug, differs, wait, skip, hand, askEnter, askLine } from "./core.mjs";
import { windowFor, go, see, shows, text, whoAmI, apiGet, signIn, signOut, adminWindow, adminGo, saveVia, wantDirect, ADMIN, allow, pollUntil, invoiceRaised } from "./browser.mjs";
import { same, made, acct, today, MARK, stampOf, newcomer, pageErrors, typeahead, fillIfEmpty, emailLink, pdfOk, nearest, termsOf, HUBS, openAnswer, answer, findForm, search, cardOf, companyPage, prospectName, prospectRow, openProspect, fits } from "./kit.mjs";

// ---------------------------------------------------------------- what these steps send
allow({
  /* The host's monthly declaration (hub/assets/dashboard.js, submitDeclaration). */
  accountPosts: ["/declarations"],
  /* Send the email again on an open offer (dashboard.js, resendIntro). */
  accountPatterns: [/^\/introductions\/\d+\/resend$/],
  adminIntents: [
    "approve-listing",              // a first listing (raises the membership invoice in Xero)
    "approve-listing-revision", "decline-listing-revision",
    "reissue-acceptance",           // Resend to <host> on a declined offer; never re-route
    "extend-membership-clock",
    "open-audit-strike", "cure-strike",
    "edit-declaration-line", "raise-fee-invoice",
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
  if (rows.length > 1) throw new Refused(`refused: ${rows.length} accounts are named ${JSON.stringify(company)}, so the runner cannot tell which is the host`);
  mustBeZZ(rows[0].name, "the host's account");
  ctx.cache.hostOrg = rows[0];
  return rows[0];
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
const hubJourney = (h) => {
  const print = h.key === "print";
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
        if (status !== "none") differs("the listing before a first submission", status, "none");
        const w = await openForm(ctx, h);
        await fillIfEmpty(w.page, "#siteTown", "Leeds");
        if (!(await w.page.inputValue("#siteCountry")).trim()) await typeahead(w.page, "#siteCountry", "United Kingdom");
        await w.page.click('#shipsTo input[data-region="uk"] + span');
        await typeahead(w.page, "#m-1-machine", h.machine);
        await typeahead(w.page, "#m-1-materials", h.material);
        await w.page.fill("#m-1-lead", "5");
        await w.page.fill("#m-1-capacity", "100");
        const billed = await shows(w.page, "#hostMembership", 1500) && (await text(w.page, "#hostMembership")).includes("already has");
        if (await shows(w.page, '#hostMembership input[name="billing"]', 1500)) await w.page.click('#hostMembership input[name="billing"][value="monthly"] + span');
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
        if (now.status === "live" || now.status === "live_pending_edit") skip("the listing is live already, so its card has gone");
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
      } }] : []),
    { id: "approve", once: true,
      does: "Admin: opens the listing request from the Inbox on the host's company page, presses Approve, then \"Yes, approve it\"",
      shows: print ? "Queued, then the listing is live; this raises a real membership invoice in Xero"
        : "Queued, then the listing is live; no new invoice (one membership covers both hubs)",
      run: async (ctx) => {
        const now = await mine(ctx, h);
        if (now.status === "live" || now.status === "live_pending_edit") skip("the listing is live already");
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
    { id: "approve-change", once: true, does: "Admin: approves the change on the host's company page", shows: "Queued; the new material is live; \"The changes to your 3D Print Hub listing are live\" to the host",
      run: async (ctx) => {
        if (!adminAvailable(ctx)) skip(NO_ADMIN);
        const b = await mine(ctx, h);
        if (b.status !== "live_pending_edit") skip(made(ctx).material && hasMaterial(b.live, made(ctx).material) ? "approved already" : `no change is waiting (the listing is ${b.status})`);
        const org = await hostOrg(ctx), row = await inboxRow(ctx, "listing_change", b.listing.id);
        if (row.org_id !== org.id) throw new Refused("refused: the listing change is not on the ZZ host's account");
        const { w, item } = await jobOnCompanyPage(ctx, row);
        await saveVia(w.page, () => item.locator('[data-act="jobApproveChange"]').click(), ctx);
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
        const answered = w.page.waitForResponse((r) => r.url() === `${API}/seeker-requests` && r.request().method() === "POST", { timeout: 60000 });
        await w.page.click("#requestSubmit");
        const r = await answered, j = await r.json().catch(() => ({}));
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
    { id: "row", does: "Host opens the introduction on its account page", shows: "The row, \"Open until …\", Review and accept, Decline",
      run: async (ctx) => {
        const id = made(ctx).intro, w = await signIn(ctx, "host");
        await go(w.page, `${APEX}/hub/account/#intro-${id}`);
        await see(w.page, `#intro-${id}`, "Open until", "the introduction's row", 25000);
        for (const act of ["intro-accept-open", "intro-decline-open"]) {
          if (!(await shows(w.page, `[data-act="${act}"][data-intro="${id}"]`))) differs("the row's buttons", `${act} is missing`, "Review and accept, and Decline");
        }
      } },
  ];
  /* 6.5: the account page offers Send the email again only while the offer
     is open (dashboard.js), and the worker refuses a second offer email
     within two minutes of the last (offers.js, OFFER_RESEND_COOLDOWN_MS). */
  const resendStep = !print ? [] : [
    { id: "resend", once: true, does: "Host presses Send the email again on the open offer, two minutes after it went",
      shows: "\"Sent again.\" under the row; the offer email to the host a second time",
      run: async (ctx) => {
        const m = made(ctx), id = m.intro, w = await signIn(ctx, "host");
        const left = (m.sentAt || 0) + 125000 - Date.now();
        if (left > 0) { ctx.log(`  waiting ${Math.ceil(left / 1000)} seconds: the offer email can be sent again two minutes after the last`); await w.page.waitForTimeout(left); }
        await go(w.page, `${APEX}/hub/account/#intro-${id}`);
        const button = w.page.locator(`[data-act="intro-resend"][data-intro="${id}"]`);
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
    { id: "answer-open", does: "Host opens the answer", shows: "On 2.0: no terms at all. On 1.3: the introduction terms and a tick",
      run: async (ctx) => {
        const w = await signIn(ctx, "host"), id = made(ctx).intro;
        if (!(await shows(w.page, `#intro-${id}`, 1500))) await go(w.page, `${APEX}/hub/account/#intro-${id}`);
        await w.page.locator(`[data-act="intro-accept-open"][data-intro="${id}"]`).waitFor({ state: "visible", timeout: 25000 });
        await openAnswer(ctx, w, id);
      } },
    { id: "answer", once: true,
      does: print ? "Host accepts the introduction" : "Host declines the introduction",
      shows: print ? "\"Introduced on …\"; the introduction email to both, with Will and Chris in copy"
        : "\"Declined…\" and the seeker's \"An update on\" email",
      run: async (ctx) => {
        const w = await signIn(ctx, "host"), m = made(ctx);
        const note = await answer(ctx, w, m.intro, { accept: print, ref: m.ref, seeker: acct(ctx, "seeker").email, host: acct(ctx, "host").email });
        if (print) {
          /* commercial.js DESK_COPY: Will and Chris are in copy. Will's is the admin address in the settings. */
          if (ctx.settings.admin.email) ctx.mail.expect(`The introduction email, ${m.ref} (you, in copy)`, ctx.settings.admin.email, `Introduction ${m.ref}`);
          ctx.notes.push(`The introduction email for ${m.ref} copies Chris in: check it reached him (the runner does not read his mailbox).`);
          ctx.left.push(`introduction ${m.ref} accepted: the two ZZ accounts have each other's details`);
        }
        return note;
      } },
  ];
  /* 6.8: the Inbox's Re-route card on a declined offer offers "Resend to
     <site>" (jobs.js reroutePanel, reissue-acceptance). The runner presses
     that and never Re-route, which would offer the ZZ request to a real site. */
  const reissueSteps = print ? [] : [
    { id: "reissue", once: true, does: "Admin: on the seeker's company page, the Re-route card for the declined offer: Resend to the ZZ host",
      shows: "\"Send the offer … to the same site again?\"; queued; the offer back at awaiting acceptance; the offer email to the host again",
      run: async (ctx) => {
        if (!adminAvailable(ctx)) skip(NO_ADMIN);
        const m = made(ctx), row = await inboxRow(ctx, "reroute", m.intro);
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
        const m = made(ctx), w = await signIn(ctx, "host");
        await go(w.page, `${APEX}/hub/account/#intro-${m.intro}`);
        await see(w.page, `#intro-${m.intro}`, "Open until", "the reopened row", 25000);
        return answer(ctx, w, m.intro, { accept: false, ref: m.ref, seeker: acct(ctx, "seeker").email, host: acct(ctx, "host").email });
      } },
  ];
  const lastSteps = [
    { id: "seeker-sees", does: "Seeker opens its account page", shows: "The request, with where it stands",
      run: async (ctx) => {
        const w = await signIn(ctx, "seeker");
        await go(w.page, `${APEX}/hub/account/`);
        await see(w.page, "#introductions", made(ctx).request || made(ctx).ref, "the request on the seeker's account page", 25000);
      } },
  ];
  return {
    id: `hubs.${h.key}`, title: `The ${h.name}: list, ${print ? "ask for a call, " : ""}approve, ${print ? "change, " : ""}search, pick, ${print ? "accept" : "decline, offer again"}`,
    pass: "computer", needs: ["host", "seeker"],
    from: print ? "action list 5.1, 5.2, 5.5 to 5.7, 6.1 to 6.6; Ask for a call added at Will's word, 12 November 2026 (queue step DQ6)" : "action list 5.3, 5.4, 6.7, 6.8",
    steps: [].concat(listingSteps, changeSteps, seekSteps, resendStep, answerSteps, reissueSteps, lastSteps),
  };
};

// ================================================================ 7. money
/* A host declares a month from the 1st of the month after it, and only for
   an introduction accepted by the end of that month (declarations.js:
   period <= previousMonth, period >= the month of the first introduction).
   A statement is drafted once its quarter has closed and issued on the 23rd
   of the month after; a line is edited and invoiced only once it is on an
   issued statement (money.html canEdit, raiseStatements). So this journey
   finishes over several runs, weeks apart, and waits in between. */
const declare = {
  id: "money.declare", title: "Money: a declaration, Orders, the line corrected, the fee invoice", pass: "computer", needs: ["host"],
  from: "action list 7.1 to 7.4; a month after the 3D Print Hub introduction is accepted, then after its quarter's statement is issued",
  steps: [
    { id: "card", does: "Host opens Declarations on its account page", shows: "The month open for the accepted 3D Print Hub introduction, from the 1st of the next month",
      run: async (ctx) => {
        const w = await signIn(ctx, "host");
        const r = await apiGet(w.page, "/declarations");
        if (r.status !== 200 || !r.body || !r.body.declarations) differs("the host's declarations", `the API answered ${r.status}`, "what is open");
        const d = r.body.declarations, m = made(ctx);
        if (d.hub !== "print" || !(d.items || []).length || !d.period_open) {
          wait("nothing is open to declare on the 3D Print Hub yet: a month opens on the 1st of the month after it, for an introduction accepted by its end");
        }
        Object.assign(m, { period: d.period_open, intro: d.items[0].introduction_id, ref: d.items[0].ref, items: d.items.map((i) => i.introduction_id),
          state: d.due_state, lineBefore: (d.history || []).some((x) => x.hub === "print" && x.status === "submitted" && x.period < d.period_open) });
        await go(w.page, `${APEX}/hub/account/#declarations`);
        await see(w.page, "#declarations", "Declarations", "the Declarations section", 25000);
        return `${d.period_open}, ${d.due_state}, ${d.items.length} introduction(s)`;
      } },
    { id: "declare", once: true, does: "Declares the month: one line on the accepted introduction (1 unit, GBP 10), or Nothing if an earlier month carries the line",
      shows: "\"Sent. Thank you.\"; the desk notice; the seeker gets no email",
      run: async (ctx) => {
        const m = made(ctx), p = m.period;
        if (m.state === "submitted") skip(`declared for ${p} already`);
        const w = await signIn(ctx, "host");
        await go(w.page, `${APEX}/hub/account/#declarations`);
        const submit = w.page.locator(`[id=${quote(`declSubmit-${p}`)}]`);
        await submit.waitFor({ state: "visible", timeout: 25000 }).catch(() => differs("the declaration card", "no Send this declaration button", p));
        const nothing = m.lineBefore;
        for (const id of m.items) {
          const base = `decl-${p}-${id}-`;
          if (!nothing && String(id) === String(m.intro)) {
            await w.page.fill(`[id=${quote(base + "units")}]`, "1");
            await w.page.fill(`[id=${quote(base + "value")}]`, "10");
            await w.page.selectOption(`[id=${quote(base + "currency")}]`, "GBP");
          } else {
            await w.page.check(`[id=${quote(base + "nothing")}]`);
          }
        }
        if (await shows(w.page, "#declTerms [data-np-terms-tick]", 1500)) await w.page.check("#declTerms [data-np-terms-tick]");
        const sent = w.page.waitForResponse((r) => r.url() === `${API}/declarations` && r.request().method() === "POST", { timeout: 30000 });
        await submit.click();
        const r = await sent;
        if (!r.ok()) differs("sending the declaration", `${r.status()} ${await text(w.page, `[id=${quote(`declMsg-${p}`)}]`).catch(() => "")}`, "Sent. Thank you.");
        ctx.did();
        m.declared = nothing ? "nothing" : "line";
        await see(w.page, `[id=${quote(`declMsg-${p}`)}]`, "Sent. Thank you.", "after sending the declaration");
        if (ctx.mail.s.desk) ctx.mail.expect(`Desk notice: a declaration filed, ${p}`, ctx.mail.s.desk, "declaration filed by");
        ctx.left.push(`a ${p} declaration by ${acct(ctx, "host").company} (${nothing ? "nothing this month" : `GBP 10 on ${m.ref}`})`);
        return nothing ? `Nothing this month for ${p} (an earlier month carries the line)` : `one line on ${m.ref}: 1 unit, GBP 10, for ${p}`;
      } },
    { id: "orders", does: "Admin, Orders: picks the month and finds the ZZ host's declaration", shows: "The ZZ host's card for that month, with the line's reference and GBP 10.00, or NOTHING DECLARED",
      run: async (ctx) => {
        if (!adminAvailable(ctx)) skip("the admin is not open on this run");
        const m = made(ctx), org = await hostOrg(ctx), w = await adminGo(ctx, "orders.html");
        await w.page.selectOption("#month", m.period).catch(() => differs("the month on Orders", "not in the picker", m.period));
        const card = w.page.locator("#recRows .row", { has: w.page.locator(".company", { hasText: org.name }) }).first();
        await card.waitFor({ state: "visible", timeout: 25000 }).catch(() => differs("the ZZ host on Orders", "no card for it", `${org.name}, ${m.period}`));
        mustBeZZ((await card.locator(".company").first().textContent()).trim(), "the card on Orders");
        const got = (await card.textContent()).replace(/\s+/g, " ");
        if (m.declared === "nothing" || m.lineBefore) { if (!got.includes("NOTHING DECLARED")) differs("the card on Orders", got, "NOTHING DECLARED"); return "nothing declared"; }
        if (!got.includes(m.ref) || !got.includes("10.00")) differs("the line on Orders", got, `${m.ref}, GBP 10.00`);
        return `${m.ref}, GBP 10.00`;
      } },
    { id: "edit-line", once: true, does: "Admin, Money: on the issued statement, corrects the declared line's value by two pounds, with a reason",
      shows: "Queued; the line's new value; the statement rebuilt",
      run: async (ctx) => {
        if (!adminAvailable(ctx)) skip("the admin is not open on this run");
        const m = made(ctx), org = await hostOrg(ctx);
        const sts = (await dbRead(ctx, "statements", "id,org_id,quarter,status", [["eq", "org_id", org.id]])).filter((s) => s.status === "issued")
          .sort((a, b) => String(b.quarter).localeCompare(String(a.quarter)));
        if (!sts.length) wait("the line is on no issued statement yet: the engine drafts a quarter's statement once the quarter has closed and issues it by the 23rd of the month after");
        const s = sts[0];
        Object.assign(m, { statement: s.id, quarter: s.quarter });
        const fees = await dbRead(ctx, "fee_invoices", "id,voided_at", [["eq", "statement_id", s.id]]);
        if (fees.some((f) => !f.voided_at)) skip(`statement ${s.quarter} already has a fee invoice; a line is corrected before it is invoiced`);
        const lines = (await dbRead(ctx, "declaration_lines", "id,statement_id,value,units,currency,superseded_at", [["eq", "statement_id", s.id]])).filter((l) => !l.superseded_at);
        if (!lines.length) differs("the statement's lines", "none", "the declared line");
        const line = lines[0], value = Number(line.value) + 2;
        const w = await adminGo(ctx, `money.html?tab=statements&quarter=${encodeURIComponent(s.quarter)}`);
        const panel = w.page.locator(`#st-${s.id}`);
        await panel.waitFor({ state: "visible", timeout: 25000 }).catch(() => differs("the statement on Money", "not shown", `${org.name}, ${s.quarter}`));
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
        return `${line.currency || "GBP"} ${line.value} to ${value}`;
      } },
    { id: "raise", once: true, does: "Admin, Money: Raise invoice in Xero (test account) on that statement",
      shows: "Queued; the host's statement email. A real Xero invoice, read back and listed for voiding by the next step",
      run: async (ctx) => {
        if (!adminAvailable(ctx)) skip("the admin is not open on this run");
        const m = made(ctx), org = await hostOrg(ctx);
        if (!m.statement) wait("no issued statement to raise yet");
        const live = (await dbRead(ctx, "fee_invoices", "id,voided_at", [["eq", "statement_id", m.statement]])).filter((f) => !f.voided_at);
        if (live.length) skip("the statement has a fee invoice already");
        const w = await adminGo(ctx, `money.html?tab=statements&quarter=${encodeURIComponent(m.quarter)}`);
        const panel = w.page.locator(`#st-${m.statement}`);
        await panel.waitFor({ state: "visible", timeout: 25000 });
        mustBeZZ((await panel.locator(".co-name").first().textContent()).trim(), "the statement to invoice");
        const button = panel.locator(`[data-act="raiseStatement"][data-statement="${m.statement}"]`);
        await button.waitFor({ state: "visible", timeout: 20000 }).catch(async () => differs("Raise invoice in Xero", await panel.textContent(), "the button"));
        /* money.html marks a ZZ account's raise as a test (payload.test), and says so on the button. */
        if (!(await button.textContent()).includes("(test account)")) throw new Refused("refused: the button does not say test account, so the raise would not be marked as a test");
        await saveVia(w.page, () => button.click(), ctx);
        ctx.mail.expect(`The statement email, ${m.quarter}`, acct(ctx, "host").email, `Your NexPoint statement for ${m.quarter}`);
        return `raised on ${org.name}'s statement ${m.quarter}; the next step reads the invoice back`;
      } },
    /* Not once: a raise that the engine files late is still read back and
       listed for voiding on the next run, though the raise itself is done. */
    { id: "raised", does: "Reads back the fee invoice on that statement, and finds its number on Xero invoices",
      shows: "The fee invoice, numbered in Xero; listed for voiding at the end",
      run: async (ctx) => {
        if (!adminAvailable(ctx)) skip("the admin is not open on this run");
        const m = made(ctx), org = await hostOrg(ctx);
        if (!m.statement) skip("no statement was raised");
        const cols = "id,statement_id,org_id,amount,currency,xero_invoice_number,invoiced_at,voided_at,last_error";
        const read = async () => (await dbRead(ctx, "fee_invoices", cols, [["eq", "statement_id", m.statement]])).filter((f) => !f.voided_at);
        const rows = await pollUntil(async () => {
          const all = await read();
          return all.length && all.every((f) => f.xero_invoice_number || f.last_error) ? all : null;
        }, { ms: 7 * 60 * 1000, every: 15000 }) || await read();
        for (const f of rows) recordInvoice(ctx, { what: `Fee invoice for ${org.name}, statement ${m.quarter}`, table: "fee_invoices", id: f.id,
          number: f.xero_invoice_number || "", company: org.name, amount: `${f.currency || "GBP"} ${f.amount}` });
        if (!rows.length) wait("raised and queued; the engine has not filed the fee invoice yet");
        const unnumbered = rows.filter((f) => !f.xero_invoice_number);
        if (unnumbered.length) throw new Soft(`raised, but Xero has not numbered ${unnumbered.length === 1 ? "it" : "them"} yet${unnumbered[0].last_error ? ` (${unnumbered[0].last_error})` : ""}`);
        const xi = await adminGo(ctx, "money.html?tab=invoices");
        await see(xi.page, "#page", rows[0].xero_invoice_number, "the fee invoice on Xero invoices", 25000);
        return rows.map((f) => `Xero ${f.xero_invoice_number}, ${f.currency} ${f.amount}`).join("; ");
      } },
  ],
};

const moneyAdmin = {
  id: "money.admin", title: "Money: the membership clock, billing from the first introduction, an audit strike", pass: "computer",
  needs: ["host", "admin", "window"], from: "action list 7.5 and 7.7",
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
        await saveVia(w.page, () => w.page.click(`[data-act="confirmAudit"][data-org-id=${quote(org.id)}]`), ctx);
        const s = await pollUntil(async () => (await dbRead(ctx, "strikes", "id,org_id,source,notes,cured_at,cure_by", [["eq", "org_id", org.id], ["eq", "source", "audit"]]))
          .find((x) => !x.cured_at && String(x.notes || "").includes(ctx.stamp)));
        if (!s) wait("opened and queued; the engine has not filed the strike yet");
        made(ctx).strike = s.id;
        ctx.left.push(`an audit strike on ${org.name} (cured by the next step)`);
        const p = await adminGo(ctx, `company.html?org=${encodeURIComponent(org.id)}`);
        await see(p.page, ".strike-row", "Audit", "the strike on the company page", 25000);
        return `strike ${s.id}, cure by ${s.cure_by}`;
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

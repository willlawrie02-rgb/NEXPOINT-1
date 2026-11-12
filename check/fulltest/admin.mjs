// The full test: the consultancy sign-up and the admin boards.
import { APEX, PRINT, MILL, OPPS, API, Refused, Soft, mustBeZZ, isZZ, isZZSlug, differs, wait, skip, hand, askEnter, askLine } from "./core.mjs";
import { windowFor, go, see, shows, text, whoAmI, apiGet, signIn, signOut, adminWindow, adminGo, saveVia, wantDirect, ADMIN, allow, pollUntil, invoiceRaised } from "./browser.mjs";
import { same, made, acct, today, MARK, stampOf, newcomer, pageErrors, typeahead, fillIfEmpty, emailLink, pdfOk, nearest, termsOf, HUBS, openAnswer, answer, findForm, search, cardOf, companyPage, prospectName, prospectRow, openProspect, fits } from "./kit.mjs";

/* What these journeys send, beyond what browser.mjs opens for every run. The
   never-lists there still win: no campaign, no re-run, nothing marked paid,
   nothing erased. */
allow({
  /* The portal invitation's door reads the invitation (no session, changes nothing). */
  accountPosts: ["/auth/portal-invite"],
  adminApi: ["/consultancy/links/reissue"],
  adminIntents: [
    /* 12.3 the company page, as intents when the fast saves are off */
    "tag-company", "add-site", "edit-site", "add-person",
    /* 12.4 and 12.6 the card */
    "set-card-next", "revive-card", "invite-to-portal",
    /* 12.5 and 12.11 the account controls on the company page */
    "pause-org", "resume-org", "remove-org", "restore-org",
    /* 12.7 Prospects decisions */
    "watch-lead", "unpark-lead", "reject-lead", "block-lead", "unblock-lead", "return-to-prospect",
    /* 12.8 the Inbox */
    "dismiss-inbox-item", "restore-inbox-item",
  ],
  adminFunctions: [
    "crm_tag_company", "crm_add_site", "crm_edit_site", "crm_add_person",
    "crm_set_card_next", "crm_revive_card",
    /* 12.9 Projects: direct only, no intent stands behind them */
    "crm_project_add_task", "crm_project_tick", "crm_project_archive_task",
    /* A read: the company page asks it for an account on the three-year check. It changes nothing. */
    "hub_dormant_card",
  ],
});

// ================================================================ local helpers
/* A value two journeys share (the run's site, the invited person): this
   journey's own copy, else this run's, else another journey's kept one,
   else a new one. Kept with the journey, so a later run uses the same. */
function shared(ctx, key, make) {
  const m = made(ctx), cacheKey = `shared:${key}`;
  if (m[key] == null) {
    const other = Object.values(ctx.state.made || {}).find((x) => x && x[key] != null);
    m[key] = ctx.cache[cacheKey] != null ? ctx.cache[cacheKey] : other ? other[key] : make();
  }
  ctx.cache[cacheKey] = m[key];
  return m[key];
}
/* The person the admin invites to the portal (12.3, 12.4, 12.10): named as
   the in.join journey names its joiner, at new_account.invite_email with that
   journey's stamp. in.join's host removes its own joiner, which deletes that
   login, so the address is free again by the time the admin journeys run. */
function joinerOf(ctx) {
  const n = ctx.settings.new_account || {};
  if (!String(n.invite_email || "").trim() || !String(n.password || "").trim()) return null;
  const j = shared(ctx, "joiner", () => {
    const stamp = String((ctx.state.made["in.join"] || {}).stamp || ctx.stamp);
    return { name: `${n.name} Joiner`, email: String(n.invite_email).replace("{stamp}", stamp.toLowerCase()) };
  });
  mustBeZZ(j.name, "the invited person");
  return j;
}
const siteName = (ctx) => shared(ctx, "site", () => `ZZ Full Test Site ${stampOf(ctx)}`);
/* The run's own ZZ companies with a portal account: the fixed host and
   seeker, and the account in.register made. */
function runCompanies(ctx) {
  const out = [];
  for (const role of ["host", "seeker"]) if (ctx.have[role]) out.push(acct(ctx, role).company);
  if (ctx.have.new_account) {
    /* in.register's stamp from this run first: a journey that finished clears what it kept. */
    const n = ctx.settings.new_account, stamp = String(ctx.cache.newcomerStamp || (ctx.state.made["in.register"] || {}).stamp || ctx.stamp);
    out.push(String(n.company || "ZZ Full Test {stamp}").replace("{stamp}", stamp));
  }
  return [...new Set(out)].filter(isZZ);
}
/* Opens a <details> fold that holds this selector, so its buttons can be pressed. */
const unfold = (page, selector) => page.evaluate((sel) => {
  for (const el of document.querySelectorAll(sel)) { const d = el.closest("details"); if (d) d.open = true; }
}, selector);
/* On a company page: the account (org id) a user, by address, is on. */
const orgOfUser = (page, email) => page.evaluate((e) => {
  for (const site of document.querySelectorAll(".site")) {
    const u = [...site.querySelectorAll(".user-row [title]")].find((x) => String(x.getAttribute("title") || "").toLowerCase() === e);
    if (!u) continue;
    const b = site.querySelector("[data-org-id]");
    return b ? b.dataset.orgId : "";
  }
  return "";
}, String(email || "").toLowerCase());
/* On a company page: the state word of an account's site ("On the portal", "Paused", "Removed from the hub"). */
const orgWord = (page, orgId) => page.evaluate((id) => {
  const b = [...document.querySelectorAll(".site [data-org-id]")].find((x) => x.dataset.orgId === id);
  const s = b && b.closest(".site"), st = s && s.querySelector(".site-h .st");
  return st ? st.textContent.replace(/\s+/g, " ").trim() : "";
}, String(orgId));
const hasUser = (page, email) => page.evaluate((e) => [...document.querySelectorAll(".user-row [title]")]
  .some((x) => String(x.getAttribute("title") || "").toLowerCase() === e), String(email || "").toLowerCase());
/* The host's own account on its company page, found by the host's sign-in address. */
async function hostOrg(ctx) {
  const a = acct(ctx, "host"), w = await companyPage(ctx, a.company);
  const org = await orgOfUser(w.page, a.email);
  if (!org) differs("the ZZ host's account on its company page", "no user with the host's address", a.email);
  return { w, org };
}
/* Polls the company page until the account's state word matches. */
async function untilOrgWord(ctx, company, org, want, what) {
  const got = await pollUntil(async () => {
    const w = await companyPage(ctx, company);
    const word = await orgWord(w.page, org);
    return want.test(word) ? word : null;
  });
  if (!got) wait(`${what}: still queued for the engine after four minutes (it finishes at the engine's next run)`);
  return got;
}
/* The ZZ host among the seeker's 3D Print Hub results, or not. */
async function hostInSearch(ctx) {
  const w = await signIn(ctx, "seeker"), host = acct(ctx, "host").company;
  await findForm(w, HUBS[0]);
  let names = [];
  try {
    await search(w);
    names = await w.page.locator("#capGrid .cap h3").evaluateAll((els) => els.map((e) => e.textContent.trim()));
  } catch (e) {
    /* No site at all fits: the host is not among them either. */
    const why = await text(w.page, "#findErr").catch(() => "");
    if (!why) throw e;
  }
  return { shown: names.some((n) => same(n, host)), names };
}
/* The door's Create account form, as in.register fills it. Answers when "Check your inbox" shows. */
async function doorRegister(ctx, w, p) {
  await w.page.fill("#qName", p.name);
  if (p.company) await w.page.fill("#qCompany", p.company);
  await w.page.locator("#qPass").pressSequentially(p.password);
  await w.page.click("#npAccountContent button[type=submit]");
  await w.page.locator('form[data-np-step="2"]').waitFor({ state: "visible" });
  await w.page.fill("#qCountry", p.country);
  await w.page.fill("#qTown", p.town);
  await w.page.locator("#qTerms").waitFor({ state: "visible" });
  await w.page.check("#qTerms");
  const ready = 'form[data-np-step="2"] button[type=submit]:not([disabled])';
  if (!(await shows(w.page, ready, 45000))) {
    await w.page.bringToFront().catch(() => {});
    if (!(await askEnter("The \"are you human\" check has not cleared. Complete it in the Chrome window."))) skip("the human check was left");
    await w.page.locator(ready).waitFor({ state: "visible", timeout: 5 * 60 * 1000 });
  }
  const sent = w.page.waitForResponse((r) => r.url() === `${API}/auth/register`, { timeout: 30000 });
  await w.page.click(ready);
  const res = await sent;
  if (!res.ok()) differs("registering", await text(w.page, "#npAccountContent .np-sign-error").catch(() => `${res.status()}`), "Check your inbox");
  ctx.did();
  await see(w.page, "#npAccountContent .success", "Check your inbox", "after registering", 30000);
}

// ---------------------------------------------------------------- the Prospects page
const PROSPECT_TABS = ["prospects", "parked", "leads"];
/* Where a prospect stands: its tab (prospects, parked, leads), or the Declined
   archive (declined, killed), or none; with its row number and whether a
   decision on it is queued. */
async function findProspect(ctx, name) {
  mustBeZZ(name, "the prospect");
  const w = await adminGo(ctx, "marketing.html");
  await w.page.evaluate(() => { try { localStorage.removeItem("nx-prospects-filters"); localStorage.removeItem("nx-prospects-tab"); } catch { /* private window */ } });
  await w.page.reload({ waitUntil: "domcontentloaded" });
  await w.page.locator("#admin").waitFor({ state: "visible" });
  await w.page.waitForLoadState("networkidle").catch(() => {});
  await w.page.fill("#f-search", name);
  await w.page.locator("#f-search").blur();
  for (const tab of PROSPECT_TABS) {
    await w.page.click(`[data-act="tab"][data-f="${tab}"]`);
    const row = w.page.locator("#plist tbody tr", { hasText: name }).first();
    if (!(await row.count())) continue;
    const button = row.locator('[data-act="openRow"]').first();
    const id = (await button.count()) ? await button.getAttribute("data-id") : "";
    return { w, name, where: tab, id, queued: !id };
  }
  const arch = w.page.locator("#declined .arch-row", { has: w.page.locator(".co-name", { hasText: name }) }).first();
  if (await arch.count()) {
    const words = (await arch.textContent()) || "";
    const act = await arch.locator('[id^="act-"]').first().getAttribute("id").catch(() => "");
    return { w, name, where: /Killed/.test(words) ? "killed" : "declined", id: String(act || "").replace(/^act-/, ""), queued: /queued/i.test(words) };
  }
  return { w, name, where: "none", id: "", queued: false };
}
/* Waits, up to four minutes, for the engine to put the prospect where it should be. */
async function untilProspect(ctx, name, where, what) {
  const p = await pollUntil(async () => { const q = await findProspect(ctx, name); return q.where === where && !q.queued ? q : null; });
  if (!p) wait(`${what}: the engine has not done it yet (it finishes at its next run)`);
  return p;
}
async function openRow(p) {
  await p.w.page.click(`#plist [data-act="openRow"][data-id="${p.id}"]`);
  await p.w.page.locator(`#act-${p.id}`).waitFor({ state: "visible" }).catch(() => differs("Show details on the row", "the row stayed shut", "the row's buttons"));
}
/* Adds a Known contact prospect, never on a campaign. */
async function addProspect(ctx, name) {
  const p = await findProspect(ctx, name);
  if (p.where !== "none") return "already there from an earlier run";
  await p.w.page.click('.head [data-act="toggleAdd"]');
  await p.w.page.fill("#add-name", name);
  await p.w.page.selectOption("#add-type", { label: "Known contact" });
  await saveVia(p.w.page, () => p.w.page.click("#add-go"), ctx);
  ctx.left.push(`the prospect ${name}`);
  return "";
}
/* Accept as a Known contact, refused if any campaign is lit on the row. */
async function acceptKnown(ctx, name) {
  const p = await findProspect(ctx, name);
  if (p.where === "leads") return "already a lead";
  if (p.where !== "prospects" || !p.id) wait(`${name} is not on the Prospects tab (${p.where}${p.queued ? ", a decision queued" : ""})`);
  await openRow(p);
  await p.w.page.selectOption(`#type-${p.id}`, { label: "Known contact" });
  const lit = await p.w.page.locator(`#plist [data-act="toggleMany"][data-id="${p.id}"][data-f="campaigns"][aria-pressed="true"]`).count();
  if (lit) throw new Refused("refused: a campaign is chosen on the row, and a campaign goes into Smartlead");
  await saveVia(p.w.page, () => p.w.page.click(`#act-${p.id} [data-act="accept"][data-id="${p.id}"]`));
  await untilProspect(ctx, name, "leads", "accepting");
  return "";
}

// ================================================================ 9. the consultancy agreement
/* Makes a link for the ZZ host's folder, signed by the admin's own address. Answers its row id and address. */
async function makeLink(ctx) {
  const a = acct(ctx, "host");
  if (!isZZSlug(a.folder)) skip("accounts.host.folder is not filled in (the company's zz- folder name)");
  mustBeZZ(a.company, "the client on the link");
  const w = await adminGo(ctx, "consultancy.html");
  const ids = () => w.page.locator('[id^="link-"]').evaluateAll((els) => els.map((e) => e.id));
  const before = await ids();
  await w.page.fill("#f-slug", a.folder);
  await w.page.fill("#f-client", a.company);
  await w.page.fill("#f-address", "ZZ test address: not a real agreement");
  await w.page.fill("#f-signer", "ZZ Full Test");
  await w.page.fill("#f-email", ctx.settings.admin.email);
  if (await w.page.locator("#f-test").isChecked()) await w.page.uncheck("#f-test");
  const sent = w.page.waitForResponse((r) => r.url() === `${API}/consultancy/links` && r.request().method() === "POST", { timeout: 30000 });
  await w.page.click("#f-submit");
  if ((await sent).ok()) ctx.did();
  await see(w.page, "#given-title", "Link ready", "after making the link", 30000);
  const url = await w.page.inputValue("#given-url");
  if (!/^https:\/\/nexpoint\.co\.uk\/sign\/\?t=[0-9a-f]{64}$/.test(url)) differs("the link", url.replace(/[0-9a-f]{56}$/, "…"), `${APEX}/sign/?t=…`);
  await w.page.waitForFunction((n) => document.querySelectorAll('[id^="link-"]').length > n, before.length, { timeout: 15000 }).catch(() => {});
  const mine = (await ids()).filter((id) => !before.includes(id));
  if (mine.length !== 1) differs("the new link's row", `${mine.length} new rows`, "one");
  return { id: mine[0], url };
}
async function openLink(ctx, url) {
  const w = ctx.lastWindow = await windowFor(ctx, "stranger");
  await go(w.page, url);
  return w;
}
/* The invoice number and amount the signed page shows, once Xero has raised it. */
const invoiceOnPage = (page) => page.evaluate(() => {
  const out = {};
  for (const dt of document.querySelectorAll("#signBody dl.terms dt")) {
    const dd = dt.nextElementSibling, k = dt.textContent.trim();
    if (dd && (k === "Invoice" || k === "Amount")) out[k] = dd.textContent.replace(/\s+/g, " ").trim();
  }
  return out.Invoice ? out : null;
});
/* A link's row on the Consultancy page, after proving it is the ZZ host's. */
async function linkRow(ctx, id, where = "") {
  const a = acct(ctx, "host"), w = await adminGo(ctx, "consultancy.html");
  const row = w.page.locator(`${where}#${id}`);
  await unfold(w.page, `#${id}`);
  await row.waitFor({ state: "visible" }).catch(() => differs("the link on the Consultancy page", "not shown", id));
  if (!((await row.textContent()) || "").includes(a.company)) throw new Refused("refused: that link is not the ZZ host's");
  mustBeZZ(a.company, "the link");
  return { w, row };
}

const consultancy = [{
  id: "in.consultancy", title: "Every way in: the consultancy agreement, signed, and a second link reissued and revoked", pass: "computer",
  needs: ["admin", "host", "window"], from: "action list group 9 (Will, 12 November: signing raises a real Xero invoice)",
  steps: [
    { id: "link", once: true, does: "Admin: makes a consultancy link for the ZZ host's folder, signed by your own address", shows: "\"Link ready\"",
      run: async (ctx) => {
        const l = await makeLink(ctx);
        made(ctx).link = l.id;
        ctx.cache.signUrl = l.url;      // opens a real agreement: kept in memory only, never in the state file
        ctx.left.push(`a signed consultancy agreement for ${acct(ctx, "host").company}`);
      } },
    { id: "read", does: "Opens the link", shows: "\"Welcome, <ZZ company>.\"; the retainer line; Sign is greyed out",
      run: async (ctx) => {
        if (!ctx.cache.signUrl) skip("the link was made on an earlier run and its address is not kept between runs");
        const w = await openLink(ctx, ctx.cache.signUrl);
        const head = await see(w.page, "#signBody h1", "Welcome,", "the agreement page", 30000);
        mustBeZZ(head.replace(/^Welcome,\s*/, "").replace(/\.$/, ""), "the company on the agreement page");
        await see(w.page, "#signBody", "Retainer", "the summary");
        if (!(await w.page.locator("#signBtn").isDisabled())) differs("the Sign button before anything is typed", "can be pressed", "greyed out");
      } },
    { id: "sign", once: true, does: "Signs it as the ZZ company: name, position, the invoice to your address, the tick, Sign the agreement",
      shows: "\"Agreement signed.\"; then the Xero invoice number and amount on the page; listed for voiding",
      run: async (ctx) => {
        if (!ctx.cache.signUrl) skip("the link's address is not kept between runs, so it is not signed here. Sign it, or revoke it, on the Consultancy page");
        const a = acct(ctx, "host"), mail = String(ctx.settings.admin.email || "").trim();
        const w = await openLink(ctx, ctx.cache.signUrl);
        const head = await see(w.page, "#signBody h1", "Welcome,", "the agreement page", 30000);
        const company = head.replace(/^Welcome,\s*/, "").replace(/\.$/, "");
        mustBeZZ(company, "the company signing");
        if (!same(company, a.company.replace(/\.+$/, ""))) throw new Refused("refused: the agreement is not made out to the ZZ host");
        await w.page.fill("#signerName", "ZZ Full Test");
        await w.page.fill("#signerPosition", "ZZ test signer, not a real agreement");
        if (!same(await w.page.inputValue("#invoiceEmail"), mail)) await w.page.fill("#invoiceEmail", mail);
        await w.page.check("#agree");
        await w.page.locator("#signBtn:not([disabled])").waitFor({ state: "visible" })
          .catch(() => differs("the Sign button once filled", "still greyed out", "can be pressed"));
        const sent = w.page.waitForResponse((r) => r.url() === `${API}/signup/accept` && r.request().method() === "POST", { timeout: 60000 });
        /* The lock opens for this one press, and shuts whatever happens. */
        ctx.signNow = true;
        let res;
        try { await w.page.click("#signBtn"); res = await sent; } finally { ctx.signNow = false; }
        if (!res.ok()) differs("signing", await text(w.page, "#signMsg").catch(() => `${res.status()}`), "Agreement signed.");
        ctx.did();
        await see(w.page, "#signBody h1", "Agreement signed", "after signing", 30000);
        ctx.mail.expect("The signed agreement, with the invoice attached", mail, "Your NexPoint agreement is signed");
        /* The page asks again for a minute by itself; after that, opening the link again shows where it has got to. */
        await w.page.waitForFunction(() => [...document.querySelectorAll("#signBody dl.terms dt")].some((d) => d.textContent.trim() === "Invoice"),
          null, { timeout: 75000 }).catch(() => {});
        const inv = (await invoiceOnPage(w.page)) || (await pollUntil(async () => {
          await go(w.page, ctx.cache.signUrl);
          await w.page.locator("#signBody h1").first().waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
          await w.page.waitForLoadState("networkidle").catch(() => {});
          return invoiceOnPage(w.page);
        }, { ms: 4 * 60 * 1000, every: 20000 }));
        if (!inv) {
          invoiceRaised(ctx, { what: `The consultancy retainer invoice for ${a.company} (number not shown yet)`, company: a.company, table: "consultancy_links" });
          throw new Soft("signed, but no invoice showed in five minutes. The five-minute pass raises it: void it in Xero once it shows on the Consultancy page");
        }
        invoiceRaised(ctx, { what: `The consultancy retainer invoice for ${a.company}`, number: inv.Invoice, company: a.company, amount: inv.Amount || "", table: "consultancy_links" });
        return `Xero ${inv.Invoice}, ${inv.Amount || "amount not shown"}`;
      } },
    { id: "signed-admin", does: "Admin: the Consultancy page", shows: "The link reads Invoiced, with the same invoice number",
      run: async (ctx) => {
        const id = made(ctx).link;
        if (!id) skip("the runner does not know which link it made");
        const number = ((ctx.state.invoices || []).find((i) => i.table === "consultancy_links" && i.number && i.run === ctx.stamp) || {}).number;
        const { row } = await linkRow(ctx, id);
        const words = ((await row.textContent()) || "").replace(/\s+/g, " ");
        /* Whatever this shows, the second link is still reissued and revoked. */
        if (!/Invoiced/.test(words)) throw new Soft(`the signed link reads ${JSON.stringify(words.slice(0, 120))}, expected Invoiced`);
        if (number && !words.includes(number)) throw new Soft(`the link does not carry the invoice number ${number}: ${JSON.stringify(words.slice(0, 160))}`);
      } },
    { id: "link2", once: true, does: "Admin: makes a second link the same way", shows: "\"Link ready\"",
      run: async (ctx) => {
        const l = await makeLink(ctx);
        made(ctx).link2 = l.id;
        ctx.cache.signUrl2 = l.url;
      } },
    { id: "reissue", once: true, does: "Reissues the second link, and answers the question under the form", shows: "\"Link reissued\"; a new link, marked as a reissue of the old one",
      run: async (ctx) => {
        const id = made(ctx).link2;
        if (!id) skip("the runner does not know which second link it made. Revoke it by hand on the Consultancy page");
        const { w, row } = await linkRow(ctx, id);
        const ids = () => w.page.locator('[id^="link-"]').evaluateAll((els) => els.map((e) => e.id));
        const before = await ids();
        await row.locator('[data-act="startReissue"]').click();
        await see(w.page, "#make-title", "Reissue the link for", "the form, ready to reissue");
        await w.page.click("#f-submit");
        await see(w.page, "#make-ask", "Reissue this link?", "the question under the form");
        const sent = w.page.waitForResponse((r) => r.url() === `${API}/consultancy/links/reissue`, { timeout: 30000 });
        await w.page.click('#make-ask [data-act="sendReissue"]');
        if (!(await sent).ok()) differs("reissuing", await text(w.page, "#make-status").catch(() => "the API refused"), "Link reissued");
        ctx.did();
        await see(w.page, "#given-title", "Link reissued", "after reissuing", 30000);
        ctx.cache.signUrl3 = await w.page.inputValue("#given-url");
        await w.page.waitForFunction((n) => document.querySelectorAll('[id^="link-"]').length > n, before.length, { timeout: 15000 }).catch(() => {});
        const mine = (await ids()).filter((x) => !before.includes(x));
        if (mine.length !== 1) differs("the reissued link's row", `${mine.length} new rows`, "one");
        made(ctx).link3 = mine[0];
        await see(w.page, `#${mine[0]}`, `Reissue of link ${id.replace(/^link-/, "")}`, "the new link's row");
      } },
    { id: "old-dead", does: "Opens the old address of the reissued link", shows: "\"This link is no longer valid.\"",
      run: async (ctx) => {
        if (!ctx.cache.signUrl2) skip("the old address is not kept between runs");
        const w = await openLink(ctx, ctx.cache.signUrl2);
        await see(w.page, "#signBody", "no longer valid", "the old address", 30000);
      } },
    { id: "revoke", once: true, does: "Admin: revokes the reissued link", shows: "The question under the link, with no pop-up; then the link sits under Finished, revoked",
      run: async (ctx) => {
        const id = made(ctx).link3;
        if (!id) skip("the runner does not know which link the reissue made. Revoke it by hand on the Consultancy page");
        const { w, row } = await linkRow(ctx, id);
        await row.locator('[data-act="askRevoke"]').click();
        await see(w.page, `#${id} .inline-choice`, "Revoke this link?", "the question under the link");
        const sent = w.page.waitForResponse((r) => r.url() === `${API}/consultancy/links/revoke`, { timeout: 30000 });
        await w.page.locator(`#${id} [data-act="revoke"]`).click();
        if ((await sent).ok()) ctx.did(); else differs("revoking", "the API refused", "revoked");
        await w.page.waitForFunction((i) => !!document.querySelector(`#finished #${i}`), id, { timeout: 20000 })
          .catch(() => differs("the link after revoking", "not under Finished", "under Finished, revoked"));
      } },
    { id: "dead", does: "Opens the revoked link", shows: "\"This link is no longer valid.\"",
      run: async (ctx) => {
        if (!ctx.cache.signUrl3) skip("the link's address is not kept between runs");
        const w = await openLink(ctx, ctx.cache.signUrl3);
        await see(w.page, "#signBody", "no longer valid", "the revoked link", 30000);
      } },
  ],
}];

// ================================================================ 12. the admin
const PAUSE_WHY = (ctx) => `${MARK} ${ctx.stamp}: a test pause, resumed at once`;
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
  from: "queue CY11 and DA9 (plan 079); action list 12.2 and 12.3",
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
    { id: "tag", does: "Adds a ZZ topic tag, then takes it off", shows: "\"Saved\" both times; the tag on the page, then gone",
      run: async (ctx) => {
        const company = acct(ctx, "host").company, label = `ZZ test tag ${stampOf(ctx)}`;
        mustBeZZ(label, "the tag");
        let w = await companyPage(ctx, company);
        const tagBtn = () => w.page.locator(`[data-act="untag"][aria-label="Take off ${label}"]`).first();
        if (!(await tagBtn().count())) {
          await w.page.click('[data-act="openUi"][data-ui="topic"]');
          await w.page.fill("#tp-new", label);
          const saved = await saveVia(w.page, () => w.page.click('[data-act="addTopic"]'));
          ctx.left.push(`the topic tag ${label} (taken off ${company}; the tag itself stays in the list)`);
          if (!saved.direct) throw new Soft(`the tag was queued for the engine ("${saved.toast}"): fast saves read off. Take it off by hand once it shows`);
          w = await companyPage(ctx, company);
        }
        if (!(await tagBtn().count())) differs("the tag on the page", "not shown", label);
        wantDirect(await saveVia(w.page, () => tagBtn().click()), "taking the tag off");
        w = await companyPage(ctx, company);
        if (await tagBtn().count()) differs("the tag after taking it off", "still shown", "gone");
      } },
    { id: "site", once: true, does: "Adds a site, \"ZZ Full Test Site …\", in Leeds", shows: "\"Saved\"; the site under Sites and accounts, with no portal account yet",
      run: async (ctx) => {
        const company = acct(ctx, "host").company, name = siteName(ctx);
        mustBeZZ(name, "the site");
        const w = await companyPage(ctx, company);
        if (await w.page.locator(".site .site-h b", { hasText: name }).count()) return "already there from an earlier run";
        await w.page.click('[data-act="openUi"][data-ui="addsite"]');
        await w.page.fill("#as-name", name);
        await w.page.fill("#as-town", "Leeds");
        await w.page.fill("#as-country", "United Kingdom");
        const saved = await saveVia(w.page, () => w.page.click('[data-act="confirmAddSite"]'), ctx);
        ctx.left.push(`the site ${name} on ${company}`);
        if (!saved.direct) wait(`the site was queued for the engine ("${saved.toast}"): fast saves read off`);
        const after = await companyPage(ctx, company);
        const block = after.page.locator(".site", { has: after.page.locator(".site-h b", { hasText: name }) }).first();
        if (!(await block.count())) differs("the new site", "not under Sites and accounts", name);
        if (!((await block.textContent()) || "").includes("No portal account yet")) differs("the new site's account line", (await block.textContent()) || "", "No portal account yet");
      } },
    { id: "site-edit", does: "Edits the site: its town to York", shows: "\"Saved\"; the edit form reads York when opened again",
      run: async (ctx) => {
        const company = acct(ctx, "host").company, name = siteName(ctx);
        let w = await companyPage(ctx, company);
        const site = await nearest(w.page, '[data-act="editSite"]', name, "site");
        if (!site) differs("the run's site", "not listed with an Edit button", name);
        mustBeZZ(name, "the site to edit");
        await w.page.click(`[data-act="editSite"][data-site="${site}"]`);
        await w.page.locator("#es-town").waitFor({ state: "visible" });
        if (!same(await w.page.inputValue("#es-name"), name)) throw new Refused("refused: the edit form is not the run's site");
        if (same(await w.page.inputValue("#es-town"), "York")) await w.page.fill("#es-town", "Leeds");
        else await w.page.fill("#es-town", "York");
        const want = await w.page.inputValue("#es-town");
        const saved = await saveVia(w.page, () => w.page.click(`[data-act="saveSite"][data-site="${site}"]`));
        if (!saved.direct) throw new Soft(`the site edit was queued for the engine ("${saved.toast}"): fast saves read off`);
        w = await companyPage(ctx, company);
        await w.page.click(`[data-act="editSite"][data-site="${site}"]`);
        await w.page.locator("#es-town").waitFor({ state: "visible" });
        const got = await w.page.inputValue("#es-town");
        await w.page.click('[data-act="closeUi"]');
        if (!same(got, want)) differs("the town after a reload", got, want);
      } },
    { id: "person", once: true, does: "Adds a ZZ person, \"<new_account.name> Joiner\", with a role, the invitation address and the run's site",
      shows: "\"Saved\"; the person under People",
      run: async (ctx) => {
        const company = acct(ctx, "host").company, j = joinerOf(ctx);
        const name = j ? j.name : `${MARK} person ${stampOf(ctx)}`;
        mustBeZZ(name, "the person");
        const w = await companyPage(ctx, company);
        if (await w.page.locator(".person-name", { hasText: name }).count()) return "already there from an earlier run";
        await w.page.click('[data-act="openUi"][data-ui="addperson"]');
        await w.page.fill("#ap-name", name);
        await w.page.fill("#ap-role", "ZZ test role");
        if (j) await w.page.fill("#ap-email", j.email);
        if (await w.page.locator("#ap-site").count()) {
          const opt = await w.page.locator("#ap-site option", { hasText: siteName(ctx) }).first().getAttribute("value").catch(() => "");
          if (opt) await w.page.selectOption("#ap-site", opt);
        }
        const saved = await saveVia(w.page, () => w.page.click('[data-act="confirmAddPerson"]'), ctx);
        ctx.left.push(`the person ${name} on ${company}`);
        if (!saved.direct) wait(`the person was queued for the engine ("${saved.toast}"): fast saves read off`);
        await see(w.page, ".people", name, "the new person");
        return j ? "" : "new_account.invite_email is not filled in, so the person has no address and the portal invitation (12.4) is left out";
      } },
  ],
}, {
  id: "admin.pause", title: "The admin: the ZZ host paused, off the seeker's search, then resumed", pass: "computer",
  needs: ["admin", "host", "seeker", "window"], from: "action list 12.5",
  steps: [
    { id: "before", does: "Seeker searches the 3D Print Hub (rigid, 12 pairs; nothing is sent)", shows: "The ZZ host among the named sites",
      run: async (ctx) => {
        const r = await hostInSearch(ctx);
        ctx.cache.pauseBaseline = r.shown;
        if (!r.shown) skip(`the ZZ host is not among the named sites before the pause (${r.names.length} named), so the search cannot show the pause. Is its listing live?`);
      } },
    { id: "pause", does: "Admin: Pause on the ZZ host's own account, with a reason", shows: "\"Paused\"; the site reads Paused once the engine has done it",
      run: async (ctx) => {
        const company = acct(ctx, "host").company, { w, org } = await hostOrg(ctx);
        mustBeZZ(company, "the account to pause");
        if (/Paused/.test(await orgWord(w.page, org))) return "already paused (an earlier run stopped here)";
        await w.page.click(`[data-act="pauseOrg"][data-org-id="${org}"]`);
        await w.page.fill("#pa-why", PAUSE_WHY(ctx));
        await saveVia(w.page, () => w.page.click(`[data-act="confirmPause"][data-org-id="${org}"]`));
        ctx.left.push(`a pause and a resume on ${company} (each on the account's record)`);
        await untilOrgWord(ctx, company, org, /Paused/, "the pause");
      } },
    { id: "gone", does: "Seeker searches again", shows: "The ZZ host is not among the named sites",
      run: async (ctx) => {
        if (ctx.cache.pauseBaseline === false) skip("the host was not shown before the pause either");
        if ((await hostInSearch(ctx)).shown) differs("the search while the host is paused", "the ZZ host is still offered", "not offered");
      } },
    { id: "resume", does: "Admin: Resume, and its question", shows: "\"Resumed\"; the site reads On the portal once the engine has done it",
      run: async (ctx) => {
        const company = acct(ctx, "host").company, { w, org } = await hostOrg(ctx);
        mustBeZZ(company, "the account to resume");
        if (/On the portal/.test(await orgWord(w.page, org))) return "already on (resumed on an earlier run)";
        await w.page.click(`[data-act="resumeOrg"][data-org-id="${org}"]`);
        await see(w.page, ".inline-choice", "Resume", "the question");
        await saveVia(w.page, () => w.page.click(`[data-act="confirmResume"][data-org-id="${org}"]`));
        await untilOrgWord(ctx, company, org, /On the portal/, "the resume");
      } },
    { id: "back", does: "Seeker searches once more", shows: "The ZZ host among the named sites again",
      run: async (ctx) => {
        if (ctx.cache.pauseBaseline === false) skip("the host was not shown before the pause either");
        if (!(await hostInSearch(ctx)).shown) differs("the search after the resume", "the ZZ host is not offered", "offered again");
      } },
  ],
}, {
  id: "admin.pipelines", title: "The admin: a pipeline card, the portal invitation, dead, revived and dead again", pass: "computer",
  needs: ["admin", "host", "window"], from: "action list 12.4 and 12.6",
  steps: [
    { id: "add", once: true, does: "Pipelines: adds a 3D Print Hub card for the ZZ host, on the run's site", shows: "The card in the Accepted column",
      run: async (ctx) => {
        const company = acct(ctx, "host").company, w = await adminGo(ctx, "pipelines.html?tab=hub");
        mustBeZZ(company, "the company for the card");
        stampOf(ctx);
        /* The cards there before, so the runner only ever touches the one it adds. */
        made(ctx).before = await w.page.locator(".card[data-card]").evaluateAll((els) => els.map((e) => e.dataset.card));
        await w.page.click('[data-act="openUi"][data-ui="add"]');
        await w.page.fill("#ac-q", company);
        await w.page.click('[data-act="findCompany"]');
        const pick = w.page.locator('[data-act="pickCompany"]', { hasText: company }).first();
        await pick.waitFor({ state: "visible" }).catch(() => differs("finding the company", "not offered", company));
        mustBeZZ(((await pick.textContent()) || "").trim(), "the company picked");
        await pick.click();
        await w.page.click('[data-act="toggleHub"][data-hub="print"]');
        /* The run's site if it is offered (it has no account, so the invitation can follow); else a new one named after the company. */
        const site = await w.page.locator("#ac-site option", { hasText: siteName(ctx) }).first().getAttribute("value").catch(() => "");
        if (site) await w.page.selectOption("#ac-site", site);
        const saved = await saveVia(w.page, () => w.page.click('[data-act="confirmAdd"]'), ctx);
        ctx.left.push(`a pipeline card for ${company}, ended dead`);
        return (site ? "" : "the run's site was not offered, so the card has a new site named after the company. ") +
          (saved.direct ? "" : `Queued for the engine ("${saved.toast}"): fast saves read off, so the card shows after the next run`);
      } },
    { id: "move", does: "Moves it to In conversation, on the company page", shows: "The stage changes; \"Saved\"",
      run: async (ctx) => {
        const company = acct(ctx, "host").company, w = await adminGo(ctx, "pipelines.html?tab=hub");
        const before = made(ctx).before || null;
        if (!before) skip("the runner does not know which card it added, so it moves none");
        const fresh = await w.page.locator(".card[data-card]", { hasText: company }).evaluateAll((els, old) => els.map((e) => e.dataset.card).filter((c) => !old.includes(c)), before);
        if (!fresh.length && !made(ctx).card) wait("the new card is not on the board yet (the engine adds it at its next run)");
        if (fresh.length > 1) throw new Refused("refused: more than one new card for the ZZ host; the runner cannot tell which is its own");
        const id = made(ctx).card = made(ctx).card || fresh[0];
        await companyPage(ctx, company);
        await w.page.locator(`#card-${id}`).waitFor({ state: "visible" }).catch(() => differs("the card on the company page", "not shown", `#card-${id}`));
        if (await shows(w.page, `#card-${id} [data-stage="conversation"][aria-pressed="true"]`, 1500)) return "already In conversation";
        wantDirect(await saveVia(w.page, () => w.page.click(`#card-${id} [data-act="setStage"][data-stage="conversation"]`)), "moving the card");
      } },
    { id: "next", does: "Sets the card's shared next step", shows: "\"Saved\"; \"Next step, shared: ZZ full test …\" on the card",
      run: async (ctx) => {
        const company = acct(ctx, "host").company, id = made(ctx).card, words = `${MARK}: a test next step`;
        if (!id) skip("the runner does not know which card it added");
        const w = await companyPage(ctx, company);
        await w.page.click(`#card-${id} [data-act="openUi"][data-ui="next:${id}"]`);
        await w.page.fill("#ne-input", words);
        wantDirect(await saveVia(w.page, () => w.page.click(`[data-act="saveNext"][data-card="${id}"]`)), "the next step");
        await see(w.page, `#card-${id} .next`, words, "the next step on the card");
      } },
    { id: "agreed", does: "Moves it to Agreed", shows: "\"Saved\"; Invite to the portal shows on the card",
      run: async (ctx) => {
        const company = acct(ctx, "host").company, id = made(ctx).card;
        if (!id) skip("the runner does not know which card it added");
        let w = await companyPage(ctx, company);
        if (!(await shows(w.page, `#card-${id} [data-stage="agreed"][aria-pressed="true"]`, 1500))) {
          wantDirect(await saveVia(w.page, () => w.page.click(`#card-${id} [data-act="setStage"][data-stage="agreed"]`)), "moving the card to Agreed");
          w = await companyPage(ctx, company);
        }
        if (!(await shows(w.page, `#card-${id} [data-act="openUi"][data-ui="invite:${id}"]`, 4000))) {
          differs("the card at Agreed", "no Invite to the portal (its site has an account)", "Invite to the portal");
        }
      } },
    { id: "invite", once: true, does: "Invite to the portal: the ZZ person's address and name, Send the invitation",
      shows: "\"Invite sent to …\"; the invitation email to that address",
      run: async (ctx) => {
        const company = acct(ctx, "host").company, id = made(ctx).card, j = joinerOf(ctx);
        if (!id) skip("the runner does not know which card it added");
        if (!j) skip("new_account.invite_email is not filled in, so there is nobody to invite");
        stampOf(ctx);
        const w = await companyPage(ctx, company);
        /* The in.join journey's joiner held this address; its host removed it, which deletes that login. */
        if (await hasUser(w.page, j.email)) skip("the in.join journey's invited user still holds this address (its Remove step did not run), so no invitation is sent to it");
        mustBeZZ(j.name, "the person invited");
        await w.page.click(`#card-${id} [data-act="openUi"][data-ui="invite:${id}"]`);
        await w.page.fill("#inv-email", j.email);
        await w.page.fill("#inv-name", j.name);
        await saveVia(w.page, () => w.page.click(`[data-act="confirmInvite"][data-card="${id}"]`), ctx);
        ctx.mail.expect("The portal invitation", j.email, "Your invitation to the NexPoint Global Portal");
        ctx.left.push(`a portal invitation to ${j.email}`);
      } },
    { id: "join", once: true, does: "Opens the invitation (read from the mailbox, or pasted by you) and creates the account",
      shows: "Create account, with the ZZ host's name and the address filled in; then \"Check your inbox\"",
      run: async (ctx) => {
        const company = acct(ctx, "host").company, j = joinerOf(ctx);
        if (!j || !made(ctx).card) skip("no invitation was sent");
        stampOf(ctx);
        const link = await emailLink(ctx, { to: j.email, subject: "Your invitation to the NexPoint Global Portal", part: "/hub/", what: "the portal invitation" });
        if (!/^[0-9a-f]{64}$/.test(new URL(link).searchParams.get("join") || "")) throw new Refused("refused: the link is not a portal invitation");
        const w = ctx.lastWindow = await windowFor(ctx, "invitee");
        await go(w.page, link);
        await w.page.locator('form[data-np-step="1"]').waitFor({ state: "visible", timeout: 25000 })
          .catch(() => differs("the invitation", "Create account did not open", "Create account, filled in"));
        await w.page.waitForFunction(() => { const c = document.getElementById("qCompany"); return !!c && c.value.trim() !== ""; }, null, { timeout: 15000 }).catch(() => {});
        const filled = await w.page.inputValue("#qCompany");
        mustBeZZ(filled, "the company the invitation names");
        if (!same(filled, company)) throw new Refused("refused: the invitation is not for the ZZ host");
        if (!same(await w.page.inputValue("#qEmail"), j.email)) differs("the address on the form", await w.page.inputValue("#qEmail"), j.email);
        const n = ctx.settings.new_account;
        await doorRegister(ctx, w, { name: j.name, password: n.password, town: n.town || "Leeds", country: n.country || "United Kingdom" });
        ctx.left.push(`the account made through the invitation (${filled}, ${j.email}); its login is deleted by delete-login`);
        ctx.mail.expect("Confirm your email (the invited account)", j.email, "Confirm your email");
      } },
    { id: "join-confirm", once: true, does: "Confirms the invited account's address", shows: "\"You're confirmed.\"",
      run: async (ctx) => {
        const j = joinerOf(ctx);
        if (!j || !made(ctx).card) skip("no invitation was sent");
        stampOf(ctx);
        const w = ctx.lastWindow = await windowFor(ctx, "invitee");
        await go(w.page, await emailLink(ctx, { to: j.email, subject: "Confirm your email", part: "/hub/confirm.html", what: "the invited account's confirmation email" }));
        await see(w.page, "#confirmBody", /You.re confirmed/, "the confirmation page", 30000);
      } },
    { id: "dead", does: "Marks the card dead (once nothing on it is queued)", shows: "\"Saved\"; the card in the company's dead archive",
      run: async (ctx) => {
        const company = acct(ctx, "host").company, id = made(ctx).card;
        if (!id) skip("the runner does not know which card it added, so it marks none dead");
        /* The invitation needs the card open at Agreed until the engine has sent it. */
        const calm = await pollUntil(async () => {
          const w = await companyPage(ctx, company);
          return (await w.page.locator(`#card-${id} .status-line`, { hasText: "Queued" }).count()) ? null : w;
        });
        if (!calm) wait("something on the card is still queued for the engine");
        const w = calm;
        await w.page.click(`[data-act="openUi"][data-ui="dead:${id}"]`);
        await w.page.locator('[data-act="pickReason"]').first().click();
        await w.page.fill("#dd-note", "test data");
        wantDirect(await saveVia(w.page, () => w.page.click('[data-act="confirmDead"]')), "marking the card dead");
      } },
    { id: "revive", does: "Revives it from the company's dead archive", shows: "\"Saved\"; the card back at the stage it died at",
      run: async (ctx) => {
        const company = acct(ctx, "host").company, id = made(ctx).card;
        if (!id) skip("the runner does not know which card it added");
        const w = await companyPage(ctx, company);
        const sel = `[data-act="revive"][data-card="${id}"]`;
        await unfold(w.page, sel);
        if (!(await w.page.locator(sel).count())) differs("the dead card", "no Revive button", "Revive");
        wantDirect(await saveVia(w.page, () => w.page.click(sel)), "reviving the card");
        const back = await companyPage(ctx, company);
        await back.page.locator(`#card-${id}`).waitFor({ state: "visible" }).catch(() => differs("the card after reviving", "not on the company page", "open again"));
      } },
    { id: "dead-again", does: "Marks it dead again", shows: "\"Saved\"; on Pipelines, the card under Dead with its reason and Revive",
      run: async (ctx) => {
        const company = acct(ctx, "host").company, id = made(ctx).card;
        if (!id) skip("the runner does not know which card it added");
        const w = await companyPage(ctx, company);
        await w.page.click(`[data-act="openUi"][data-ui="dead:${id}"]`);
        await w.page.locator('[data-act="pickReason"]').first().click();
        await w.page.fill("#dd-note", "test data");
        wantDirect(await saveVia(w.page, () => w.page.click('[data-act="confirmDead"]')), "marking the card dead again");
        const p = await adminGo(ctx, "pipelines.html?tab=hub");
        await unfold(p.page, `[data-act="revive"][data-card="${id}"]`);
        if (!(await p.page.locator(`details.archive [data-act="revive"][data-card="${id}"]`).count())) differs("the Dead archive on Pipelines", "the card is not there", "the card, with Revive");
      } },
  ],
}, {
  id: "delete-login", title: "The admin: the invited user's login deleted, the person kept", pass: "computer",
  needs: ["admin", "host", "new_account", "window"], from: "queue CY10b, case 2 (plan 085); action list 12.10",
  steps: [
    { id: "shown", does: "Opens the ZZ host's company page", shows: "The invited user on their account, and the ZZ person tagged Portal user",
      run: async (ctx) => {
        const j = joinerOf(ctx);
        if (!j) skip("new_account.invite_email is not filled in, so nobody was invited");
        const w = await companyPage(ctx, acct(ctx, "host").company);
        if (!(await hasUser(w.page, j.email))) wait("the invited account is not on the company yet (the engine joins it to its site once confirmed, at its next run)");
        if (!(await shows(w.page, `.person-name:has-text("${j.name}") span.tag.mini:has-text("Portal user")`, 3000))) {
          throw new Soft(`${j.name} is not tagged Portal user yet (the engine adopts the login at its next run)`);
        }
      } },
    { id: "delete", once: true, does: "Delete user on the invited user, and its question", shows: "The question under the user, then queued",
      run: async (ctx) => {
        const j = joinerOf(ctx);
        if (!j) skip("nobody was invited");
        const w = await companyPage(ctx, acct(ctx, "host").company);
        const user = await w.page.evaluate((e) => {
          const t = [...document.querySelectorAll(".user-row [title]")].find((x) => String(x.getAttribute("title") || "").toLowerCase() === e);
          const row = t && t.closest(".user-row"), b = row && row.querySelector('[data-act="deleteUser"]');
          return b ? { id: b.dataset.user, name: t.textContent.trim() } : null;
        }, j.email.toLowerCase());
        if (!user) differs("the invited user", "no Delete user button beside them", j.email);
        mustBeZZ(user.name, "the user to delete");
        await w.page.click(`[data-act="deleteUser"][data-user="${user.id}"]`);
        await see(w.page, ".inline-choice", "Delete", "the question under the user");
        await saveVia(w.page, () => w.page.click(`[data-act="confirmDeleteUser"][data-user="${user.id}"]`), ctx);
      } },
    { id: "kept", does: "Opens the company page again", shows: "The person stays, with no Portal user tag; the timeline says a login was deleted",
      run: async (ctx) => {
        const j = joinerOf(ctx);
        if (!j) skip("nobody was invited");
        const w = await companyPage(ctx, acct(ctx, "host").company);
        if (await hasUser(w.page, j.email)) wait("the engine has not yet deleted the login (its next run)");
        await see(w.page, ".tl", "A portal login was deleted", "the timeline");
        if (!(await w.page.locator(".person-name", { hasText: j.name }).count())) differs("the person", "gone from Contacts", "kept, because they were a contact before the login");
        if (await shows(w.page, `.person-name:has-text("${j.name}") span.tag.mini:has-text("Portal user")`, 1500)) differs("the person", "still tagged Portal user", "no tag");
      } },
  ],
}, {
  id: "admin.prospects", title: "The admin: Prospects, with fast saves on", pass: "computer", needs: ["admin", "window"],
  from: "queue CY9, CY11 and DA9; action list 12.7. Never onto a campaign: that goes into Smartlead",
  steps: [
    { id: "add", once: true, does: "Prospects: adds \"ZZ Full Test Prospect …\" as a Known contact", shows: "Queued for the engine",
      run: async (ctx) => addProspect(ctx, prospectName(ctx)) },
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
    { id: "park", does: "Parks it", shows: "\"Parked, queued\"; then the row on the Parked tab",
      run: async (ctx) => {
        const name = prospectName(ctx), p = await findProspect(ctx, name);
        if (p.where === "parked") return "already parked";
        if (p.where !== "prospects" || !p.id) wait(`${name} is not on the Prospects tab (${p.where})`);
        await openRow(p);
        await saveVia(p.w.page, () => p.w.page.click(`#act-${p.id} [data-act="park"][data-id="${p.id}"]`));
        await untilProspect(ctx, name, "parked", "parking");
      } },
    { id: "unpark", does: "Unparks it from the Parked tab", shows: "\"Unparked, queued\"; then the row back on the Prospects tab",
      run: async (ctx) => {
        const name = prospectName(ctx), p = await findProspect(ctx, name);
        if (p.where === "prospects") return "already back on Prospects";
        if (p.where !== "parked" || !p.id) wait(`${name} is not on the Parked tab (${p.where})`);
        await openRow(p);
        await saveVia(p.w.page, () => p.w.page.click(`#act-${p.id} [data-act="unpark"][data-id="${p.id}"]`));
        await untilProspect(ctx, name, "prospects", "unparking");
      } },
    { id: "accept", does: "Accepts it as a Known contact, with no campaign", shows: "\"Accepted as a lead with no campaign\"; the row on the Leads tab",
      run: async (ctx) => acceptKnown(ctx, prospectName(ctx)) },
    { id: "return", does: "Returns the lead to Prospects, with a reason", shows: "\"Returned to prospect, queued\"; then the row back on the Prospects tab",
      run: async (ctx) => {
        const name = prospectName(ctx), p = await findProspect(ctx, name);
        if (p.where === "prospects") return "already back on Prospects";
        if (p.where !== "leads" || !p.id) wait(`${name} is not on the Leads tab (${p.where})`);
        await openRow(p);
        await p.w.page.click(`#act-${p.id} [data-act="returnLead"][data-id="${p.id}"]`);
        await p.w.page.fill(`#ask-${p.id}`, `${MARK}: a test return, accepted again at once`);
        await saveVia(p.w.page, () => p.w.page.click(`[data-act="confirmReturn"][data-id="${p.id}"]`));
        await untilProspect(ctx, name, "prospects", "returning to prospect");
      } },
    { id: "accept-again", once: true, does: "Accepts it again as a Known contact, with no campaign", shows: "The row on the Leads tab",
      run: async (ctx) => {
        const note = await acceptKnown(ctx, prospectName(ctx));
        ctx.left.push(`the lead folder of ${prospectName(ctx)}`);
        return note;
      } },
    { id: "in-contacts", does: "Looks for the accepted company in Contacts", shows: "The company, as a lead",
      run: async (ctx) => { await companyPage(ctx, prospectName(ctx)); } },
  ],
}, {
  id: "admin.prospects-kill", title: "The admin: a prospect killed, then restored", pass: "computer", needs: ["admin", "window"],
  from: "action list 12.7 (block and unblock)",
  steps: [
    { id: "add", once: true, does: "Prospects: adds \"ZZ Full Test Kill …\" as a Known contact", shows: "Queued for the engine; then the row on Prospects",
      run: async (ctx) => addProspect(ctx, `ZZ Full Test Kill ${stampOf(ctx)}`) },
    { id: "kill", does: "Kill, with a reason", shows: "\"Killed, queued\"; then the row in the Declined archive, Killed, with Restore",
      run: async (ctx) => {
        const name = `ZZ Full Test Kill ${stampOf(ctx)}`, p = await findProspect(ctx, name);
        if (p.where === "killed") return "already killed";
        if (p.where !== "prospects" || !p.id) wait(`${name} is not on the Prospects tab yet (${p.where}; the engine files it at its next run)`);
        await openRow(p);
        await p.w.page.click(`#act-${p.id} [data-act="block"][data-id="${p.id}"]`);
        await p.w.page.fill(`#ask-${p.id}`, `${MARK}: a test kill, restored at once`);
        await saveVia(p.w.page, () => p.w.page.click(`[data-act="confirmBlock"][data-id="${p.id}"]`));
        await untilProspect(ctx, name, "killed", "killing");
      } },
    { id: "restore", does: "Restore, from the Declined archive", shows: "\"Restored, queued\"; then the row leaves every list (the engine withdraws it)",
      run: async (ctx) => {
        const name = `ZZ Full Test Kill ${stampOf(ctx)}`, p = await findProspect(ctx, name);
        if (p.where === "none") return "already restored";
        if (p.where !== "killed" || !p.id) wait(`${name} is not in the Declined archive as killed (${p.where})`);
        await unfold(p.w.page, `#declined [data-act="unblock"][data-id="${p.id}"]`);
        await p.w.page.click(`#declined [data-act="unblock"][data-id="${p.id}"]`);
        await saveVia(p.w.page, () => p.w.page.click(`[data-act="confirmUnblock"][data-id="${p.id}"]`));
        await untilProspect(ctx, name, "none", "restoring");
      } },
  ],
}, {
  id: "admin.prospects-decline", title: "The admin: a prospect declined", pass: "computer", needs: ["admin", "window"],
  from: "action list 12.7 (reject)",
  steps: [
    { id: "add", once: true, does: "Prospects: adds \"ZZ Full Test Decline …\" as a Known contact", shows: "Queued for the engine; then the row on Prospects",
      run: async (ctx) => addProspect(ctx, `ZZ Full Test Decline ${stampOf(ctx)}`) },
    { id: "decline", does: "Decline, with a reason", shows: "\"Declined, queued\"; then the row in the Declined archive",
      run: async (ctx) => {
        const name = `ZZ Full Test Decline ${stampOf(ctx)}`, p = await findProspect(ctx, name);
        if (p.where === "declined") return "already declined";
        if (p.where !== "prospects" || !p.id) wait(`${name} is not on the Prospects tab yet (${p.where}; the engine files it at its next run)`);
        await openRow(p);
        await p.w.page.click(`#act-${p.id} [data-act="reject"][data-id="${p.id}"]`);
        await p.w.page.fill(`#ask-${p.id}`, `${MARK}: a test decline`);
        await saveVia(p.w.page, () => p.w.page.click(`[data-act="confirmReject"][data-id="${p.id}"]`));
        await untilProspect(ctx, name, "declined", "declining");
        ctx.left.push(`the declined prospect ${name}`);
      } },
  ],
}, {
  id: "admin.inbox", title: "The admin: the Inbox, a ZZ task ticked and a job set aside and put back", pass: "computer", needs: ["admin", "window"],
  from: "action list 12.8 and 12.9 (the Inbox's tasks)",
  steps: [
    { id: "task-add", does: "Inbox: Add task, a ZZ task with no company", shows: "\"Saved\"; the task under Tasks",
      run: async (ctx) => {
        const title = `${MARK} ${stampOf(ctx)}: an Inbox test task`, w = await adminGo(ctx, "inbox.html");
        mustBeZZ(title, "the task");
        if (await nearest(w.page, '[data-act="taskDone"]', title, "task")) return "already there";
        await w.page.click('[data-act="taskOpen"]');
        await w.page.fill("#tk-title", title);
        const saved = await saveVia(w.page, () => w.page.click('[data-act="taskAdd"]'));
        ctx.left.push(`the Inbox task "${title}", done`);
        if (!saved.direct) wait(`the task was queued for the engine ("${saved.toast}"): fast saves read off`);
      } },
    { id: "tick", does: "Ticks it", shows: "\"Saved\"; the task under Done with Put back",
      run: async (ctx) => {
        const title = `${MARK} ${stampOf(ctx)}: an Inbox test task`, w = await adminGo(ctx, "inbox.html");
        const task = await nearest(w.page, '[data-act="taskDone"]', title, "task");
        if (!task) differs("the task", "not listed with its tick", title);
        made(ctx).task = task;
        wantDirect(await saveVia(w.page, () => w.page.click(`[data-act="taskDone"][data-task="${task}"]`)), "ticking the task");
        const back = await adminGo(ctx, "inbox.html");
        await unfold(back.page, `[data-act="taskPutBack"][data-task="${task}"]`);
        if (!(await back.page.locator(`[data-act="taskPutBack"][data-task="${task}"]`).count())) differs("the task after the tick", "not under Done", "under Done, with Put back");
      } },
    { id: "put-back", does: "Puts it back, then ticks it again", shows: "\"Saved\" both times; it ends under Done",
      run: async (ctx) => {
        const title = `${MARK} ${stampOf(ctx)}: an Inbox test task`, task = made(ctx).task;
        if (!task) skip("the task was not ticked");
        let w = await adminGo(ctx, "inbox.html");
        await unfold(w.page, `[data-act="taskPutBack"][data-task="${task}"]`);
        const row = w.page.locator(".arch-row", { has: w.page.locator(`[data-act="taskPutBack"][data-task="${task}"]`) }).first();
        if (!((await row.textContent()) || "").includes(title)) throw new Refused("refused: that Done row is not the run's task");
        wantDirect(await saveVia(w.page, () => w.page.click(`[data-act="taskPutBack"][data-task="${task}"]`)), "putting the task back");
        w = await adminGo(ctx, "inbox.html");
        wantDirect(await saveVia(w.page, () => w.page.click(`[data-act="taskDone"][data-task="${task}"]`)), "ticking it again");
      } },
    { id: "not-now", once: true, does: "Not now on a job about one of the run's ZZ companies, with a reason", shows: "\"Not now: set aside below\"; the job under Set aside",
      run: async (ctx) => {
        const w = await adminGo(ctx, "inbox.html"), names = runCompanies(ctx);
        let key = "";
        for (const name of names) {
          /* The row's own company name, exactly (its tile's initials left out), not a name that merely contains it. */
          mustBeZZ(name, "the job's company");
          const toggles = await w.page.locator(".qitem").evaluateAll((els, want) => els.map((e) => {
            const q = e.querySelector(".qco:not(.none)"), b = e.querySelector('[data-act="toggleRow"]');
            const own = q ? [...q.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim().toLowerCase() : "";
            return b && own === want ? b.dataset.key : "";
          }).filter(Boolean), name.trim().toLowerCase());
          for (const k of toggles) {
            await w.page.click(`[data-act="toggleRow"][data-key="${k}"]`);
            if (await shows(w.page, `[data-act="jobOpen"][data-ui="nn"][data-key="${k}"]`, 1500)) { key = k; mustBeZZ(name, "the job's company"); break; }
            await w.page.click(`[data-act="toggleRow"][data-key="${k}"]`);
          }
          if (key) break;
        }
        if (!key) skip("no job about the run's ZZ companies offers Not now on the Inbox today (only host applications, flagged hosts, unsent offers and failed runs do)");
        made(ctx).key = key;
        await w.page.click(`[data-act="jobOpen"][data-ui="nn"][data-key="${key}"]`);
        await w.page.locator(".inline-choice .input").first().fill(`${MARK} ${ctx.stamp}: set aside by the full test, put back at once`);
        await saveVia(w.page, () => w.page.click(`[data-act="jobNotNow"][data-key="${key}"]`), ctx);
        const set = await pollUntil(async () => {
          const p = await adminGo(ctx, "inbox.html");
          return (await p.page.locator(`[data-act="putBack"][data-key="${key}"]`).count()) ? p : null;
        });
        if (!set) wait("the job is not under Set aside yet (the engine records it at its next run)");
      } },
    { id: "restore", does: "Put back, from Set aside", shows: "\"Put back, queued\"; the job back in the queue",
      run: async (ctx) => {
        const key = made(ctx).key;
        if (!key) skip("no job was set aside");
        const w = await adminGo(ctx, "inbox.html");
        const sel = `[data-act="putBack"][data-key="${key}"]`;
        if (!(await w.page.locator(sel).count())) return "already back in the queue";
        await unfold(w.page, sel);
        const row = w.page.locator(".arch-row", { has: w.page.locator(sel) }).first();
        if (!((await row.textContent()) || "").includes(MARK)) throw new Refused("refused: that Set aside row is not the run's");
        await saveVia(w.page, () => w.page.click(sel));
        const back = await pollUntil(async () => {
          const p = await adminGo(ctx, "inbox.html");
          return (await p.page.locator(`[data-act="toggleRow"][data-key="${key}"]`).count()) ? p : null;
        });
        if (!back) wait("the job is not back in the queue yet (the engine puts it back at its next run)");
      } },
  ],
}, {
  id: "admin.projects", title: "The admin: Projects, one ZZ task added, ticked and removed (nothing else touched)", pass: "computer", needs: ["admin", "window"],
  from: "action list 12.9. Projects is in daily use by Will and Chris: only the ZZ task is pressed",
  steps: [
    { id: "add", does: "Projects: Add task, a ZZ task owned by you", shows: "\"Saved\"; the task on the Whole project tab",
      run: async (ctx) => {
        const title = `${MARK} ${stampOf(ctx)}: a Projects test task`;
        mustBeZZ(title, "the task");
        const w = await adminGo(ctx, "projects.html");
        await w.page.click('[data-act="tab"][data-t="all"]');
        if (await w.page.locator(".ptask .pt-title", { hasText: title }).count()) return "already there";
        await w.page.click('[data-act="form"][data-f="add"]');
        await w.page.fill("#fa-title", title);
        await saveVia(w.page, () => w.page.click('[data-act="taskAdd"]'));
        ctx.left.push(`the Projects task "${title}", removed (it stays under Removed)`);
      } },
    { id: "tick", does: "Ticks the ZZ task", shows: "\"Saved\"; the task reads done",
      run: async (ctx) => {
        const title = `${MARK} ${stampOf(ctx)}: a Projects test task`, w = await adminGo(ctx, "projects.html");
        await w.page.click('[data-act="tab"][data-t="all"]');
        const card = w.page.locator(".ptask", { has: w.page.locator(".pt-title", { hasText: title }) }).first();
        if (!(await card.count())) differs("the task", "not on the Whole project tab", title);
        mustBeZZ(((await card.locator(".pt-title").textContent()) || "").trim(), "the task to tick");
        const id = made(ctx).task = String(await card.getAttribute("id")).replace(/^task-/, "");
        wantDirect(await saveVia(w.page, () => w.page.click(`#task-${id} .pt-top [data-act="tick"][data-task="${id}"]`)), "ticking the task");
      } },
    { id: "remove", does: "Opens it, Remove task, and its question", shows: "\"Saved\"; the task under Removed, with Put back",
      run: async (ctx) => {
        const title = `${MARK} ${stampOf(ctx)}: a Projects test task`, id = made(ctx).task;
        if (!id) skip("the runner does not know which task it ticked");
        const w = await adminGo(ctx, "projects.html");
        await w.page.click('[data-act="tab"][data-t="all"]');
        /* A done task sits in its phase's folded Done list. */
        /* Opening a fold only changes what the page shows. Each press redraws the page, so the first shut one is looked for again each time. */
        for (let i = 0; i < 12 && !(await shows(w.page, `#task-${id}`, 800)); i++) {
          const fold = w.page.locator('details:not([open]) > summary[data-act="fold"]').first();
          if (!(await fold.count())) break;
          await fold.click();
        }
        const card = w.page.locator(`#task-${id}`);
        await card.waitFor({ state: "visible" }).catch(() => differs("the ticked task", "not found", title));
        if (!same(((await card.locator(".pt-title").textContent()) || "").trim(), title)) throw new Refused("refused: that card is not the run's task");
        await card.locator(`[data-act="open"][data-task="${id}"]`).click();
        await w.page.click(`#task-${id} [data-act="form"][data-f="remove:${id}"]`);
        wantDirect(await saveVia(w.page, () => w.page.click(`#task-${id} [data-act="archive"][data-task="${id}"][data-to="1"]`)), "removing the task");
        const p = await adminGo(ctx, "projects.html");
        await p.page.click('[data-act="tab"][data-t="all"]');
        const fold = p.page.locator('summary[data-act="fold"][data-k="removed"]');
        if (!(await fold.count())) differs("the Removed list", "not shown", "Removed, with the task");
        await fold.click();
        if (!(await shows(p.page, `#task-${id} [data-act="archive"][data-to="0"]`, 4000))) differs("the removed task", "not under Removed with Put back", title);
      } },
  ],
}, {
  id: "admin.pages", title: "The admin: the read-only pages open with their data", pass: "computer", needs: ["admin", "window"],
  from: "action list 12.12. Nothing is pressed on these pages",
  steps: [
    ...[["money.html", "Money"], ["orders.html", "Orders"], ["system.html", "System"], ["pipelines.html?tab=introductions", "Introductions"],
      ["members.html", "Members"], ["marketing-campaigns.html", "Campaigns"], ["marketing-finder.html", "the Finder"], ["marketing-linkedin.html", "LinkedIn"]]
      .map(([file, name]) => ({ id: name.replace(/^the /, "").toLowerCase(), does: `Opens ${name} (presses nothing)`, shows: "It loads, with no script errors and no \"Could not read\" line",
        run: async (ctx) => {
          const w = await adminWindow(ctx);
          w.errors.splice(0);
          await adminGo(ctx, file);
          await w.page.waitForTimeout(1500);
          try {
            pageErrors(w, name);
            const bad = await w.page.locator(".banner", { hasText: "Could not read" }).allTextContents();
            if (bad.length) differs(`${name}: what it reads`, bad.join(" | ").replace(/\s+/g, " ").slice(0, 200), "every read worked");
          } catch (e) { throw new Soft(String(e.message || e).split("\n")[0]); }
        } })),
    { id: "moved", does: "Opens the old addresses (Health, Introductions, Campaigns, Finder, LinkedIn, Tasks)", shows: "Each goes on to its new page",
      run: async (ctx) => {
        const w = await adminWindow(ctx), wrong = [];
        for (const [old, now] of [["health.html", "system.html"], ["introductions.html", "pipelines.html?tab=introductions"], ["campaigns.html", "marketing-campaigns.html"],
          ["finder.html", "marketing-finder.html"], ["linkedin.html", "marketing-linkedin.html"], ["tasks.html", "inbox.html"]]) {
          await go(w.page, `${ADMIN}/${old}`);
          const ok = await w.page.waitForURL((u) => u.href.startsWith(`${ADMIN}/${now}`), { timeout: 15000 }).then(() => true, () => false);
          if (!ok) wrong.push(`${old} stayed at ${w.page.url().split("/").pop()}`);
        }
        if (wrong.length) throw new Soft(wrong.join("; "));
      } },
  ],
}];

// ================================================================ 12.11 Organisations, last of all
/* The working list and the Archive on Organisations, by name and account. */
async function orgLists(ctx) {
  const w = await adminGo(ctx, "organisations.html");
  await w.page.waitForFunction(() => { const t = document.getElementById("orgRows"); return !!t && !/Loading/.test(t.textContent); }, null, { timeout: 25000 }).catch(() => {});
  const lists = await w.page.evaluate(() => {
    const read = (sel) => [...document.querySelectorAll(`${sel} tr`)].map((tr) => {
      const s = tr.querySelector("td strong"), a = tr.querySelector('a[href^="company.html?org="]');
      return s && a ? { name: s.textContent.trim(), org: new URL(a.getAttribute("href"), location.href).searchParams.get("org") } : null;
    }).filter(Boolean);
    return { on: read("#orgRows"), off: read("#archiveRows") };
  });
  return { w, ...lists };
}
/* Opens an account's company page from its org and presses one of its controls, after reading its ZZ name. */
async function orgPress(ctx, org, name, act, field, confirm) {
  mustBeZZ(name, "the account");
  const w = await adminGo(ctx, `company.html?org=${encodeURIComponent(org)}`);
  const sel = `[data-act="${act}"][data-org-id="${org}"]`;
  await w.page.locator(sel).first().waitFor({ state: "visible", timeout: 20000 }).catch(() => differs(`${name}'s company page`, `no ${act} button`, act));
  const heading = await text(w.page, "#page h1").catch(() => "");
  mustBeZZ(heading, "the company page");
  await w.page.click(sel);
  if (field) await w.page.fill(field, `${MARK} ${ctx.stamp}: removed at the end of the full test, so no ZZ site stays in front of seekers`);
  await saveVia(w.page, () => w.page.click(`[data-act="${confirm}"][data-org-id="${org}"]`));
}
const removeOrg = (ctx, o) => orgPress(ctx, o.org, o.name, "removeOrg", "#rm-why", "confirmRemove");
const restoreOrg = (ctx, o) => orgPress(ctx, o.org, o.name, "restoreOrg", "", "confirmRestore");
/* Waits for every account of the run to be in the list it should be in. */
async function untilOrgs(ctx, names, where, what) {
  const got = await pollUntil(async () => {
    const l = await orgLists(ctx);
    const there = (n) => l[where].some((o) => same(o.name, n)) && !l[where === "on" ? "off" : "on"].some((o) => same(o.name, n));
    return names.every(there) ? l : null;
  });
  if (!got) wait(`${what}: the engine has not done it yet (it finishes at its next run)`);
  return got;
}

const orgs = [{
  id: "admin.orgs", title: "The admin: Organisations, the run's ZZ accounts taken off the hub", pass: "last", needs: ["admin", "window"],
  from: "action list 12.11. Remove is undone with Restore; nothing is deleted or erased",
  steps: [
    { id: "remove", does: "Removes from the hub every ZZ account this run used (host, seeker, the new account), each from its company page with a reason",
      shows: "\"Removed, queued\" for each; then each under Archive, none in the working list",
      run: async (ctx) => {
        const names = runCompanies(ctx);
        if (!names.length) skip("no ZZ account is filled in");
        const l = await orgLists(ctx);
        const todo = l.on.filter((o) => names.some((n) => same(n, o.name)));
        for (const o of todo) await removeOrg(ctx, o);
        const found = names.filter((n) => l.on.concat(l.off).some((o) => same(o.name, n)));
        if (!found.length) skip("none of the run's ZZ accounts is on Organisations");
        made(ctx).names = found;
        ctx.notes.push(`The run's ZZ accounts (${found.join(", ")}) were removed from the hub at the end. The next run restores the fixed host and seeker first (admin.restore).`);
        await untilOrgs(ctx, found, "off", "removing");
        const missing = names.filter((n) => !found.includes(n));
        return missing.length ? `not on Organisations: ${missing.join(", ")}` : "";
      } },
    { id: "archive", does: "Opens the Archive on Organisations", shows: "Each removed account, Removed, with its reason",
      run: async (ctx) => {
        const names = made(ctx).names || [];
        if (!names.length) skip("nothing was removed");
        const l = await orgLists(ctx);
        await l.w.page.click("#archive > summary");
        for (const n of names) await see(l.w.page, "#archiveRows", n, `${n} in the Archive`);
        await see(l.w.page, "#archiveRows", "REMOVED", "the state in the Archive");
      } },
    { id: "restore", does: "Restores one of them (the new account if there is one, else the seeker)", shows: "\"Restored, queued\"; then it is back in the working list",
      run: async (ctx) => {
        const names = made(ctx).names || [];
        if (!names.length) skip("nothing was removed");
        const pick = made(ctx).restored = names[names.length - 1];
        const l = await orgLists(ctx);
        const o = l.off.find((x) => same(x.name, pick));
        if (o) await restoreOrg(ctx, o);
        await untilOrgs(ctx, [pick], "on", "restoring");
      } },
    { id: "remove-again", does: "Removes it again", shows: "Back under Archive; no ZZ account of the run in the working list",
      run: async (ctx) => {
        const names = made(ctx).names || [], pick = made(ctx).restored;
        if (!pick) skip("nothing was restored");
        const l = await orgLists(ctx);
        for (const o of l.on.filter((x) => same(x.name, pick))) await removeOrg(ctx, o);
        await untilOrgs(ctx, names, "off", "removing again");
      } },
  ],
}];

/* The last run removed the fixed host and seeker from the hub (admin.orgs), so
   no ZZ site stayed in front of real seekers. This puts them back first. */
const restoreFixed = [{
  id: "admin.restore", title: "The admin: the fixed ZZ host and seeker put back on the hub", pass: "computer", needs: ["admin", "window"],
  steps: [
    { id: "restore", does: "Restores the fixed ZZ host and seeker if the last run removed them", shows: "Each in the working list on Organisations",
      run: async (ctx) => {
        const names = ["host", "seeker"].map((r) => (ctx.settings.accounts[r] || {}).company).filter(Boolean);
        for (const n of names) mustBeZZ(n, "an account to restore");
        const l = await orgLists(ctx);
        const off = l.off.filter((o) => names.some((n) => same(n, o.name)));
        if (!off.length) return "both already on the hub";
        for (const o of off) await restoreOrg(ctx, o);
        await untilOrgs(ctx, off.map((o) => o.name), "on", "restoring");
        return `restored ${off.map((o) => o.name).join(", ")}`;
      } },
  ],
}];

export const ADMIN_RESTORE = restoreFixed;
export const ADMIN_JOURNEYS = [].concat(consultancy, admin, orgs);

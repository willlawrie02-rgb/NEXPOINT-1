// The full test's shared step helpers: names, mail links, the find form, the
// introduction answer, the admin company page. Every journey file uses these.
import { APEX, PRINT, MILL, OPPS, API, Refused, Soft, mustBeZZ, isZZ, isZZSlug, differs, wait, skip, hand, askEnter, askLine } from "./core.mjs";
import { windowFor, go, see, shows, text, whoAmI, apiGet, signIn, signOut, adminWindow, adminGo, saveVia, wantDirect, ADMIN, allow, pollUntil, invoiceRaised } from "./browser.mjs";

const same = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
const made = (ctx) => (ctx.state.made[ctx.current.key] = ctx.state.made[ctx.current.key] || {});
const acct = (ctx, role) => ctx.settings.accounts[role];
const today = () => new Date().toISOString().slice(0, 10);
const MARK = "ZZ full test";
/* A run's own stamp, kept with the journey so a later run uses the same names. */
const stampOf = (ctx) => { const m = made(ctx); m.stamp = m.stamp || ctx.stamp; m.since = m.since || new Date().toISOString(); return m.stamp; };
function newcomer(ctx, key = "email") {
  const n = ctx.settings.new_account, stamp = stampOf(ctx);
  const company = String(n.company || "ZZ Full Test {stamp}").replace("{stamp}", stamp);
  mustBeZZ(company, "the new account's company");
  return { company, name: n.name, email: String(n[key]).replace("{stamp}", stamp.toLowerCase()), password: n.password,
    town: n.town || "Leeds", country: n.country || "United Kingdom" };
}
const pageErrors = (w, what) => {
  const e = w.errors.splice(0);
  if (e.length) differs(`${what}: script errors`, e.join(" | "), "none");
};
/* A typeahead field: type, then Return commits the value. */
async function typeahead(page, selector, value) {
  await page.fill(selector, value);
  await page.press(selector, "Enter");
}
const fillIfEmpty = async (page, selector, value) => { if (!(await page.inputValue(selector)).trim()) await page.fill(selector, value); };
/* The link in an email: read from the mailbox when the runner may, pasted
   by the operator when it may not. Only ever a page of ours. */
async function emailLink(ctx, { to, subject, part, what }) {
  let link = "";
  const box = ctx.mail.on ? ctx.mail.boxFor(to) : "";
  if (box) {
    /* Looked for from when this journey began, which may be an earlier run. */
    const m = await ctx.mail.waitFor(box, { to, subject, since: made(ctx).since });
    if (!m) differs(`${what}, sent to ${to}`, "no such email in the mailbox after 90 seconds", subject);
    link = await ctx.mail.linkIn(box, m.id, part);
    if (!link) differs(`the link in ${what}`, "no link to that page in the email", part);
  } else {
    if (ctx.args.headless) skip(`the link is in an email to ${to}, which the runner cannot read`);
    link = await askLine(`Open ${what}, sent to ${to}, copy its button's link`);
    if (!link) skip("no link was pasted");
  }
  let u; try { u = new URL(link); } catch { throw new Refused("refused: that is not a web address"); }
  if (u.origin !== APEX || !u.pathname.includes(part)) throw new Refused(`refused: the link does not open ${APEX}${part}`);
  return u.href;
}
/* A Download a copy link gives a PDF. */
async function pdfOk(ctx, w, href, what) {
  if (!String(href || "").startsWith(`${API}/terms/`)) differs(`${what}: the link`, href, `${API}/terms/<document>/<version>.pdf`);
  const r = await w.context.request.get(href);
  const head = (await r.body()).subarray(0, 4).toString("latin1");
  if (!r.ok() || !/application\/pdf/.test(r.headers()["content-type"] || "") || head !== "%PDF") {
    differs(`${what}: the download`, `${r.status()} ${r.headers()["content-type"] || ""}`, "a PDF");
  }
}
/* The button on the smallest box that carries these words and holds only that
   one button; answers the button's data-<key>, or "". So a button is never
   matched to the words of the row beside it. */
const nearest = (page, selector, words, key) => page.evaluate(([sel, want, k]) => {
  for (const b of document.querySelectorAll(sel)) {
    let box = b.parentElement;
    while (box && box !== document.body && box.querySelectorAll(sel).length === 1) {
      if (box.textContent.includes(want)) return b.dataset[k] || "";
      box = box.parentElement;
    }
  }
  return "";
}, [selector, words, key]);
const termsOf = (w, layer) => whoAmI(w.page).then((me) => (me && me.terms && me.terms[layer]) || null);
const HUBS = [
  { key: "print", base: PRINT, name: "3D Print Hub", device: "rigid", machine: "HP MJF 5200", material: "PA12" },
  { key: "mill", base: MILL, name: "Mill Hub", device: "soft", machine: "5-axis CNC", material: "EVA" },
];
async function openAnswer(ctx, w, id) {
  await w.page.click(`[data-act="intro-accept-open"][data-intro="${id}"]`);
  await w.page.locator(`#introAnswer-${id}`).waitFor({ state: "visible" });
  await w.page.waitForLoadState("networkidle").catch(() => {});
  const ticks = await w.page.locator(`#introTerms-${id} input[type=checkbox]`).count();
  if (ctx.world.terms2 && ticks) differs("the answer on Terms 2.0", "a terms tick", "no terms at all");
  if (!ctx.world.terms2 && !ticks) differs(`the answer on Terms ${ctx.world.termsVersion}`, "no terms tick", "the terms and a tick");
  return ticks;
}
/* Declines or accepts. Accepting sends the introduction email to both sides
   with Will and Chris copied in (allowed since Will's decisions of 12 November). */
async function answer(ctx, w, id, { accept, ref, seeker, host }) {
  if (accept) {
    const tick = w.page.locator(`#introTerms-${id} input[type=checkbox]`);
    if (await tick.count()) await tick.first().check();
    const done = w.page.waitForResponse((r) => r.url() === `${API}/introductions/accept` && r.request().method() === "POST", { timeout: 60000 });
    await w.page.click(`[data-act="intro-accept-send"][data-intro="${id}"]`);
    const sent = await done;
    if (!sent.ok()) differs("accepting", await text(w.page, `#introMsg-${id}`).catch(() => "refused"), "Accepted");
    ctx.did();
    await see(w.page, `#intro-${id}`, "Introduced on", "the row after accepting", 20000);
    /* The contact-release email copies the two directors in (portal worker,
       commercial.js DESK_COPY). Their addresses are in the settings
       (mail.copied), not in this public repository. */
    const cc = { cc: [].concat((ctx.settings.mail || {}).copied || []), from: (ctx.settings.mail || {}).intro_from || "" };
    ctx.mail.expect(`The introduction email, ${ref} (to the seeker)`, seeker, `Introduction ${ref}`, cc);
    ctx.mail.expect(`The introduction email, ${ref} (to the host)`, host, `Introduction ${ref}`, cc);
    return "accepted: the introduction email went to both, with Will and Chris copied in";
  }
  await w.page.click(`[data-act="intro-decline-open"][data-intro="${id}"]`);
  await w.page.fill(`#introReason-${id}`, `${MARK}: a test, please ignore.`);
  const done = w.page.waitForResponse((r) => r.url() === `${API}/introductions/decline` && r.request().method() === "POST", { timeout: 60000 });
  await w.page.click(`[data-act="intro-decline-send"][data-intro="${id}"]`);
  if (!(await done).ok()) differs("declining", await text(w.page, `#introMsg-${id}`).catch(() => "refused"), "Declined");
  ctx.did();
  await w.page.locator(`[data-act="intro-accept-open"][data-intro="${id}"]`).waitFor({ state: "detached", timeout: 20000 })
    .catch(() => differs("the row after declining", "can still be answered", "closed"));
  ctx.mail.expect(`Declined, ${ref}`, seeker, "An update on");
  return "declined: the seeker is told";
}
async function findForm(w, h) {
  await go(w.page, `${h.base}/find.html`);
  await w.page.locator("#findForm").waitFor({ state: "visible", timeout: 25000 });
  for (const type of ["rigid", "soft"]) {
    if (!(await shows(w.page, `.device-card:has(#fDevice-${type})`))) differs("the picture boxes", `no ${type} box`, "Rigid shell and Soft insole");
  }
  await w.page.click(`.device-card:has(#fDevice-${h.device})`);
  await typeahead(w.page, "#fMaterial", h.material);
  await w.page.fill("#fQuantity", "12");
  await fillIfEmpty(w.page, "#fTown", "Leeds");
  if (!(await w.page.inputValue("#fCountry")).trim()) await typeahead(w.page, "#fCountry", "United Kingdom");
  await w.page.fill("#fNotes", `${MARK}: a test search, please ignore.`);
}
/* Presses Find, takes the terms if they are shown, and waits for the sites. True when the terms were shown. */
async function search(w) {
  await w.page.click("#findSubmit");
  const gate = await shows(w.page, "#stepTerms", 6000);
  if (gate) {
    await w.page.locator("#searchTick").waitFor({ state: "visible" });
    await w.page.check("#searchTick");
    await w.page.click("#searchAccept");
  }
  await w.page.locator("#step2:not([hidden])").waitFor({ state: "visible", timeout: 30000 })
    .catch(async () => differs("the search", await text(w.page, "#findErr").catch(() => "") || "no sites showed", "the sites that fit"));
  return gate;
}

const cardOf = (w, owner, button) => w.page.locator('section[id^="opp-"]', { hasText: owner }).filter({ has: w.page.locator("button", { hasText: button }) }).first();
/* Opens the ZZ company's page from Contacts and proves the page is that company's. */
async function companyPage(ctx, company) {
  mustBeZZ(company, "the company to open");
  if (!ctx.cache[company]) {
    const w = await adminGo(ctx, "contacts.html");
    await w.page.fill("#cq", company);
    const row = w.page.locator('a.lrow[href^="company.html?id="]', { hasText: company }).first();
    await row.waitFor({ state: "visible" }).catch(() => wait(`${company} is not in Contacts yet (the engine adopts it at its next run)`));
    ctx.cache[company] = await row.getAttribute("href");
  }
  const w = await adminGo(ctx, ctx.cache[company]);
  /* The title reads "NexPoint CRM: Company" until the company has loaded. */
  await w.page.waitForFunction(() => /^NexPoint CRM: (?!Company$)./.test(document.title), null, { timeout: 20000 }).catch(() => {});
  const title = (await w.page.title()).replace(/^NexPoint CRM:\s*/, "");
  if (!same(title, company)) throw new Refused(`refused: the page is titled ${JSON.stringify(title.slice(0, 60))}, not the ZZ company`);
  mustBeZZ(title, "the company page");
  return w;
}
const prospectName = (ctx) => `ZZ Full Test Prospect ${stampOf(ctx)}`;
async function prospectRow(ctx) {
  const name = prospectName(ctx), w = await adminGo(ctx, "marketing.html");
  await w.page.evaluate(() => { try { localStorage.removeItem("nx-prospects-filters"); localStorage.removeItem("nx-prospects-tab"); } catch { /* private window */ } });
  await w.page.reload({ waitUntil: "domcontentloaded" });
  await w.page.locator("#admin").waitFor({ state: "visible" });
  await w.page.waitForLoadState("networkidle").catch(() => {});
  await w.page.fill("#f-search", name);
  /* Leaving the search box fires its change event, which redraws the list. Left to the first
     click, that redraw lands between the button's mousedown and mouseup, so the click is lost
     and the row never opens (the 6 November run). Blur here, so the redraw comes first. */
  await w.page.locator("#f-search").blur();
  const row = w.page.locator("#plist tbody tr", { hasText: name }).first();
  /* A row whose decision is queued for the engine shows "… queued" in place of Show details. */
  const button = row.locator('[data-act="openRow"]').first();
  const id = (await row.count()) && (await button.count()) ? await button.getAttribute("data-id") : "";
  if (!id && (await row.count())) wait(`${name} has a decision queued for the engine; it opens again after the engine's next run`);
  return { w, name, id };
}
async function openProspect(ctx) {
  const p = await prospectRow(ctx);
  if (!p.id) wait(`${p.name} is not on Prospects yet (the engine files it at its next run)`);
  mustBeZZ(p.name, "the prospect to open");
  await p.w.page.click(`#plist [data-act="openRow"][data-id="${p.id}"]`);
  await p.w.page.locator(`#type-${p.id}`).waitFor({ state: "visible" })
    .catch(() => differs("Show details on the row", "the row stayed shut", "the row's fields"));
  return p;
}
/* Nothing runs off the side, and the thing a visitor came for is on screen. */
async function fits(w, url, main) {
  await go(w.page, url);
  await w.page.locator(main).first().waitFor({ state: "visible", timeout: 25000 }).catch(() => differs(url, "the main part did not show", main));
  await w.page.waitForLoadState("networkidle").catch(() => {});
  const over = await w.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (over > 2) differs(`${url} at phone width`, `${over}px runs off the side`, "nothing off the side");
  const box = await w.page.locator(main).first().boundingBox();
  const wide = w.page.viewportSize().width;
  if (!box || box.x < -1 || box.x + box.width > wide + 1) differs(`${url} at phone width`, "the main part is cut off", "inside the screen");
}

export { same, made, acct, today, MARK, stampOf, newcomer, pageErrors, typeahead, fillIfEmpty, emailLink, pdfOk, nearest, termsOf, HUBS, openAnswer, answer, findForm, search, cardOf, companyPage, prospectName, prospectRow, openProspect, fits };

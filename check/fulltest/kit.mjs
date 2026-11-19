// The full test's shared step helpers: names, mail links, the find form, the
// introduction answer, the admin company page. Every journey file uses these.
import { APEX, PRINT, MILL, OPPS, API, Refused, Soft, mustBeZZ, isZZ, isZZSlug, differs, wait, skip, hand, askEnter, askLine, passwordProblem } from "./core.mjs";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
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

/* Registering is a person's act. The site's human check (Cloudflare's)
   refuses an automated browser, as it should, and the runner never tries to
   pass it. So the runner stops, opens the page in a private window of the
   operator's own Chrome and waits while the person registers.
   Since plan 093 (live 16 November 2026) the registration form and the
   invitation have no password box: the password is chosen on the page the
   confirmation link opens, and the runner does that (choosePassword below),
   so nothing goes on the clipboard any more.
   With watchResend, the person also watches the "Check your inbox" card's
   Resend the email button count down from 2:10 and presses it once when it
   comes back: the card is in their window, which the runner cannot see. */
async function registerByHand(ctx, { url, what, fields, watchResend = false }) {
  if (ctx.args.headless) skip(`${what} is registered by a person, in a Chrome window`);
  if (process.platform !== "darwin") hand(`${what}: register it by hand, in a private Chrome window at ${url}`);
  spawnSync("open", ["-na", "Google Chrome", "--args", "--incognito", url]);
  const list = fields.map(([k, v]) => `      ${k}: ${v}`).join("\n");
  const after = watchResend
    ? `    When it says "Check your inbox", leave that card open and watch its "Resend the email" button:\n` +
      `      it should be greyed and count down from 2:10 ("Resend the email in 2:09", and so on).\n` +
      `    When it reads "Resend the email" again, press it once. The card should say a new link is on its way.\n` +
      `    Then close that window and come back here. Do not open the emails: the runner does that.`
    : `    When it says "Check your inbox", close that window and come back here. Do not open the email: the runner does that.`;
  const went = await askEnter(`Register ${what} yourself, in the private Chrome window that just opened (not the test's own window).\n` +
    `    Type these in:\n${list}\n` +
    `    There is no password box: the runner chooses the password later, on the page the email's link opens.\n` +
    `    Tick the terms, wait for the "are you human" tick, and create the account.\n${after}` +
    (/[0-9a-f]{32}/.test(url) ? "" : `\n    (If no window opened, open a private Chrome window yourself at ${url})`));
  if (!went) skip(`${what} was not registered`);
}

/* The page a confirmation link opens (hub/confirm.html, plan 093): "Choose
   your password", two boxes, "Confirm and sign in". Nothing is posted when
   the page loads; the link is spent only by the press, which posts the
   password with it. With checks, it first proves the page refuses, before
   anything is sent, a password missing a symbol and two that differ. Then
   it chooses the account's password and expects "You're confirmed." */
const RULE_WORDS = "at least 8 characters, with a lower-case letter, a capital letter, a number and a symbol";
function confirmPosts(page) {
  let n = 0;
  const on = (r) => { if (r.url() === `${API}/auth/confirm` && r.method() === "POST") n += 1; };
  page.on("request", on);
  return { count: () => n, stop: () => page.off("request", on) };
}
async function openChoosePassword(w, link, what) {
  await go(w.page, link);
  await see(w.page, "#confirmBody h1", "Choose your password", `${what}: the page the link opens`, 30000);
  await w.page.locator("#pass1").waitFor({ state: "visible" });
  await w.page.locator("#pass2").waitFor({ state: "visible" });
}
async function refusedBeforeSending(w, p1, p2, want, what) {
  const posts = confirmPosts(w.page);
  try {
    await w.page.fill("#pass1", p1);
    await w.page.fill("#pass2", p2);
    await w.page.click("#setBtn");
    await see(w.page, "#formErr", want, what, 5000);
    await w.page.waitForTimeout(1500);
    if (posts.count()) differs(`${what}: anything sent`, `${posts.count()} request(s) to /auth/confirm`, "nothing, the page refuses it first");
  } finally { posts.stop(); }
}
async function choosePassword(ctx, w, link, password, { what = "the confirmation link", checks = false } = {}) {
  const bad = passwordProblem(password);
  if (bad) throw new Refused(`refused: the password the runner would choose ${bad}, so the live page would refuse it; run "npm run fulltest -- --setup"`);
  ctx.lastWindow = w;
  await openChoosePassword(w, link, what);
  let note = "";
  if (checks) {
    const said = await text(w.page, "#confirmBody");
    if (!said.includes(RULE_WORDS)) differs(`${what}: the rule on the page`, said.slice(0, 160), RULE_WORDS);
    /* Long enough, with a capital, a lower-case letter and a number, and no symbol. */
    const noSymbol = `Zz${randomBytes(6).toString("hex")}7`;
    await refusedBeforeSending(w, noSymbol, noSymbol, "Add a symbol.", `${what}: a password with no symbol`);
    const other = `Zz-${randomBytes(6).toString("hex")}7`;
    await refusedBeforeSending(w, other, `${other}x`, "do not match", `${what}: two passwords that differ`);
    note = "the page stated the rule and refused, before sending anything, a password with no symbol and two that differed; ";
  }
  await w.page.fill("#pass1", password);
  await w.page.fill("#pass2", password);
  const sent = w.page.waitForResponse((r) => r.url() === `${API}/auth/confirm` && r.request().method() === "POST", { timeout: 30000 });
  await w.page.click("#setBtn");
  const r = await sent;
  if (!r.ok()) differs(`${what}: Confirm and sign in`, `${r.status()} ${await text(w.page, "#confirmBody").catch(() => "")}`, "You're confirmed.");
  if (typeof ctx.did === "function") ctx.did();
  await see(w.page, "#confirmBody", /You.re confirmed/, `${what}: after Confirm and sign in`, 30000);
  w.signedIn = true;
  return `${note}the password chosen; confirmed and signed in`;
}

export { same, made, acct, today, MARK, stampOf, newcomer, pageErrors, typeahead, fillIfEmpty, emailLink, pdfOk, nearest, termsOf, HUBS, openAnswer, answer, findForm, search, cardOf, companyPage, prospectName, prospectRow, openProspect, fits, registerByHand, choosePassword, openChoosePassword, RULE_WORDS };

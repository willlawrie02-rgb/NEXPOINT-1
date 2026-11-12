// The full test's browser: one window per account, the locks on what each
// window may send, signing in, and the small checks every journey uses.
import { existsSync, readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { APEX, API, DB_HOST, OUR_HOSTS, Refused, mustBeZZ, isZZ, differs, askEnter, skip } from "./core.mjs";

export const SIZES = {
  computer: { viewport: { width: 1280, height: 900 } },
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};

/* The same search as the scripted walk (check/walk.mjs), so both use one Chrome. */
export function findBrowser({ headless }) {
  const tries = [process.env.WALK_BROWSER,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  const cache = join(homedir(), "Library", "Caches", "ms-playwright");
  if (headless && existsSync(cache)) {
    for (const d of readdirSync(cache).filter((n) => n.startsWith("chromium_headless_shell-")).sort().reverse()) {
      tries.push(join(cache, d, "chrome-headless-shell-mac-arm64", "chrome-headless-shell"));
    }
  }
  return tries.find((p) => p && existsSync(p));
}

// ---------------------------------------------------------------- the locks
/* What an account's window may send to the API. Everything is a ZZ account's
   own act on its own records. A path not listed never leaves the browser.
   Each journey file adds the paths its own steps send, with allow() below,
   so the list is always exactly what the script is written to do. */
const ACCOUNT_POSTS = new Set(["/auth/login", "/auth/logout", "/auth/register", "/auth/confirm", "/auth/invite",
  "/auth/register-invited", "/auth/reset-request", "/listings/search", "/seeker-requests", "/listings", "/requests",
  "/introductions/accept", "/introductions/decline", "/account/invites", "/account/users/remove",
  "/terms/platform/accept", "/signup/view"]);
/* Paths with an id in them: matched as patterns. */
const ACCOUNT_POST_PATTERNS = [];
/* What the admin window may ask the engine to do. Since Will's decisions of
   12 November this includes approving a first listing (a Xero invoice the
   run lists for voiding); never a campaign, never re-running a job. */
const ADMIN_INTENTS = new Set(["add-note", "edit-company", "add-task", "done-task", "add-card", "move-card", "mark-card-dead",
  "add-prospect", "edit-prospect", "add-prospect-note", "accept-prospect", "review-web-request", "save-board-opportunity",
  "publish-to-live-site", "end-board-opportunity", "introduce-on-board", "edit-person", "delete-user"]);
/* Never, whatever a journey asks for: Smartlead, re-running a job, money marked paid, erasing. */
const ADMIN_NEVER = new Set(["add-campaign-member", "remove-campaign-member", "change-campaign", "switch-campaign",
  "link-campaign-version", "approve-template", "delete-campaign", "campaign-approve-lead", "campaign-exclude-lead",
  "rerun-job", "reroute-introduction", "mark-paid", "record-fee-paid", "record-sub-paid", "erase-account",
  "update-linkedin-queue", "set-opportunity", "delete-account", "remove-dormant-account"]);
/* The fast saves (plan 079) the journeys make: database functions that change
   the CRM's own rows. Named one by one, so crm_change_campaign and the rest
   stay shut. */
const ADMIN_FUNCTIONS = new Set(["crm_add_note", "crm_edit_company", "crm_add_task", "crm_done_task", "crm_add_card", "crm_move_card",
  "crm_mark_card_dead", "crm_edit_prospect", "crm_add_prospect_note", "crm_edit_person"]);
const FUNCTIONS_NEVER = new Set(["crm_change_campaign"]);
/* The admin's own sign-in and second factor, and nothing else of the sign-in service. */
const ADMIN_AUTH = [/^\/auth\/v1\/token$/, /^\/auth\/v1\/factors\/[^/]+\/(challenge|verify)$/, /^\/auth\/v1\/logout$/];
/* Other hosts a page may post to: Cloudflare's human check, and nothing else. */
const OTHER_POST_HOSTS = new Set(["challenges.cloudflare.com"]);
const asObject = (v) => { if (typeof v === "string") { try { return JSON.parse(v); } catch { return null; } } return v && typeof v === "object" ? v : null; };
/* A prospect edit that names a campaign puts the company into Smartlead. */
const namesCampaign = (fields) => !fields || (Array.isArray(fields.campaign_ids) ? fields.campaign_ids.length > 0 : "campaign_ids" in fields);
const ADMIN_API_POSTS = new Set(["/consultancy/links", "/consultancy/links/revoke"]);
const ADMIN_TABLE_WRITES = new Set(["PATCH board_opportunities"]);
/* A journey file names what its steps send. The never-lists above still win. */
export function allow({ accountPosts = [], accountPatterns = [], adminIntents = [], adminFunctions = [], adminApi = [] } = {}) {
  for (const p of accountPosts) ACCOUNT_POSTS.add(p);
  for (const re of accountPatterns) ACCOUNT_POST_PATTERNS.push(re);
  for (const t of adminIntents) { if (ADMIN_NEVER.has(t)) throw new Error(`allow(): ${t} is never allowed`); ADMIN_INTENTS.add(t); }
  for (const f of adminFunctions) { if (FUNCTIONS_NEVER.has(f)) throw new Error(`allow(): ${f} is never allowed`); ADMIN_FUNCTIONS.add(f); }
  for (const a of adminApi) ADMIN_API_POSTS.add(a);
}

const bodyOf = (request) => { try { return JSON.parse(request.postData() || "null"); } catch { return null; } };
/* Why a request is stopped, or "" when it may go. */
export function lockVerdict(kind, method, url, body, opts = {}) {
  const u = new URL(url);
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return "";
  if (u.hostname === "api.nexpoint.co.uk") {
    /* Signing raises a Xero invoice: open only while the one step that signs runs. */
    if (u.pathname === "/signup/accept") return method === "POST" && opts.sign ? "" : "signing a consultancy agreement outside its own step";
    const allowed = kind === "admin" ? ADMIN_API_POSTS : ACCOUNT_POSTS;
    if (method === "POST" && (allowed.has(u.pathname) || (kind !== "admin" && ACCOUNT_POST_PATTERNS.some((re) => re.test(u.pathname))))) return "";
    return `${method} ${u.pathname}`;
  }
  if (u.hostname === DB_HOST) {
    if (kind !== "admin") return `${method} ${u.pathname} from an account window`;
    if (u.pathname.startsWith("/auth/v1/")) return method === "POST" && ADMIN_AUTH.some((re) => re.test(u.pathname)) ? "" : `${method} ${u.pathname}`;
    const table = u.pathname.replace(/^\/rest\/v1\//, "");
    if (table === "engine_intents" && method === "POST") {
      const rows = [].concat(body || []);
      if (!rows.length) return "an engine request with no readable body";
      for (const row of rows) {
        const type = String((row && row.type) || "");
        if (ADMIN_NEVER.has(type) || !ADMIN_INTENTS.has(type)) return `the engine request "${type}"`;
        const p = asObject(row.payload_json);
        if (type === "accept-prospect" && !(p && Array.isArray(p.campaign_ids) && p.campaign_ids.length === 0)) {
          return "accepting a prospect onto a campaign (it goes into Smartlead)";
        }
        if (type === "add-prospect" && p && Array.isArray(p.campaign_ids) && p.campaign_ids.length) {
          return "adding a prospect onto a campaign (it goes into Smartlead)";
        }
        if (type === "edit-prospect" && namesCampaign(p && p.fields)) return "putting a prospect onto a campaign (it goes into Smartlead)";
      }
      return "";
    }
    if (method === "POST" && table.startsWith("rpc/")) {
      const fn = table.slice(4);
      if (FUNCTIONS_NEVER.has(fn) || !ADMIN_FUNCTIONS.has(fn)) return `the database function ${fn}`;
      const p = asObject(body && body.p);
      if (fn === "crm_edit_prospect" && namesCampaign(p && p.fields)) return "putting a prospect onto a campaign (it goes into Smartlead)";
      return "";
    }
    /* Publish: one row's status set to live, and nothing else. */
    if (ADMIN_TABLE_WRITES.has(`${method} ${table}`)) {
      const b = asObject(body);
      const keys = b ? Object.keys(b).sort().join() : "";
      return b && b.status === "live" && keys === "status,updated_at" && /^\?id=eq\.[\w-]+$/.test(u.search) ? "" : `${method} ${table} with something other than "set live"`;
    }
    return `${method} ${table}`;
  }
  /* Any other host: reads only, bar Cloudflare's human check. The home page's
     old desk form posts to a mail service, for one. */
  return OTHER_POST_HOSTS.has(u.hostname) ? "" : `${method} to ${u.hostname}`;
}
async function lock(context, kind, ctx) {
  const guard = async (route) => {
    const request = route.request();
    if (request.method() === "GET") return route.continue();
    /* Accepting is open only while the one step that is asked to accept runs. */
    const opts = { sign: !!ctx.signNow };
    const why = lockVerdict(kind, request.method(), request.url(), bodyOf(request), opts);
    if (!why) {
      /* One signing request per opening of the lock: it shuts as this one goes. */
      if (opts.sign && new URL(request.url()).pathname === "/signup/accept") ctx.signNow = false;
      return route.continue();
    }
    /* A stopped save to our API or database fails the step. A post to any
       other host (a page's visitor counter, say) is stopped quietly. */
    const ours = ["api.nexpoint.co.uk", DB_HOST].includes(new URL(request.url()).hostname);
    if (ours) ctx.blocked.push(why);
    if (ours || !ctx.quiet.has(why)) ctx.log(`  LOCK: stopped ${why}`);
    ctx.quiet.add(why);
    return route.abort("blockedbyclient");
  };
  await context.route("**/*", guard);
}

// ---------------------------------------------------------------- windows
/* One browser context per account and pass. The phone pass starts from the
   computer pass's session, so nobody signs in twice. */
export async function windowFor(ctx, role, { fresh = false } = {}) {
  const key = `${role}@${ctx.size}`;
  if (!fresh && ctx.windows[key]) return ctx.windows[key];
  const size = SIZES[ctx.size];
  const earlier = ctx.windows[`${role}@computer`];
  const storageState = !fresh && earlier && ctx.size !== "computer" ? await earlier.context.storageState() : undefined;
  const context = await ctx.browser.newContext({ ...size, locale: "en-GB", timezoneId: "Europe/London", storageState });
  context.setDefaultTimeout(15000);
  await lock(context, role === "admin" ? "admin" : "account", ctx);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e).slice(0, 200)));
  /* Remove user asks with the browser's own confirm box. In the admin a
     confirm box guards things the test never does, so there it is refused. */
  page.on("dialog", (d) => (role === "admin" ? d.dismiss() : d.accept()).catch(() => {}));
  const w = { role, context, page, errors, signedIn: !!storageState && role !== "stranger" };
  if (!fresh) ctx.windows[key] = w; else ctx.spare.push(w);
  return w;
}
export async function go(page, url) {
  const host = new URL(url).hostname;
  if (!OUR_HOSTS.has(host)) throw new Refused(`refused: ${host} is not one of our pages`);
  await page.goto(url, { waitUntil: "domcontentloaded" });
}
export async function shot(ctx, name) {
  mkdirSync(ctx.shotsDir, { recursive: true });
  const w = ctx.lastWindow;
  if (!w) return "";
  const path = join(ctx.shotsDir, `${ctx.pass}-${name}`.replace(/[^a-zA-Z0-9._-]+/g, "-") + ".png");
  await w.page.screenshot({ path, fullPage: false });
  return path;
}

// ---------------------------------------------------------------- small checks
export const text = async (page, selector) => ((await page.locator(selector).first().textContent()) || "").replace(/\s+/g, " ").trim();
export async function see(page, selector, part, what, ms = 15000) {
  const loc = page.locator(selector).first();
  const until = Date.now() + ms;
  await loc.waitFor({ state: "visible", timeout: ms }).catch(() => { throw new Error(`${what}: nothing showed at ${selector}`); });
  /* Visible is not the same as written: the admin's toast is on the page
     before a save comes back and fills it (the first run, 6 November). */
  const matches = (t) => (part instanceof RegExp ? part.test(t) : t.includes(part));
  let got = "";
  for (;;) {
    got = ((await loc.textContent()) || "").replace(/\s+/g, " ").trim();
    if (matches(got) || Date.now() > until) break;
    await page.waitForTimeout(250);
  }
  const ok = matches(got);
  if (!ok) differs(what, got, part instanceof RegExp ? String(part) : part);
  return got;
}
export const shows = (page, selector, ms = 4000) => page.locator(selector).first()
  .waitFor({ state: "visible", timeout: ms }).then(() => true, () => false);
/* Who the live site says this window is signed in as. */
export async function whoAmI(page) {
  return page.evaluate(async (api) => {
    try {
      const r = await fetch(`${api}/auth/me`, { credentials: "include" });
      return await r.json();
    } catch (e) { return { error: String(e) }; }
  }, API);
}
/* A read of the API from inside the page, with the account's own session. */
export async function apiGet(page, path) {
  return page.evaluate(async ([api, p]) => {
    try {
      const r = await fetch(`${api}${p}`, { credentials: "include" });
      return { status: r.status, body: await r.json().catch(() => null) };
    } catch (e) { return { status: 0, body: null, error: String(e) }; }
  }, [API, path]);
}

// ---------------------------------------------------------------- signing in
const sameName = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
/* Signs the role's ZZ account in, in its own window, and proves the live
   site agrees it is that ZZ company before anything else happens there. */
export async function signIn(ctx, role, { leaveGate = false, account } = {}) {
  const a = account || ctx.settings.accounts[role];
  mustBeZZ(a.company, `the ${role} account in the settings`);
  const w = await windowFor(ctx, role);
  ctx.lastWindow = w;
  if (!w.proved) {
    /* A confirmation, reset or invitation link signs the window in by itself,
       and then /hub/?signin=1 never opens the box: ask the site first. */
    if (!w.signedIn && /nexpoint\.co\.uk/.test(w.page.url())) {
      const before = await whoAmI(w.page);
      if (before && before.signed_in !== false && before.member && sameName(before.member.company, a.company)) w.signedIn = true;
    }
    if (!w.signedIn) {
      await go(w.page, `${APEX}/hub/?signin=1`);
      await w.page.locator("#signOverlay.open").waitFor({ state: "visible" });
      await w.page.fill("#sEmail", a.email);
      await w.page.fill("#sPass", a.password);
      await w.page.click("#signContent button[type=submit]");
      await w.page.locator(".np-chip__name").first().waitFor({ state: "visible" })
        .catch(async () => differs(`signing in as the ${role}`, await text(w.page, "#signContent").catch(() => ""), "the name chip"));
    } else if (!/nexpoint\.co\.uk/.test(w.page.url())) {
      await go(w.page, `${APEX}/hub/`);
    }
    const me = await whoAmI(w.page);
    const company = me && me.member && me.member.company;
    if (!(me && me.signed_in !== false && me.member && sameName(company, a.company) && isZZ(company))) {
      throw new Refused(`refused: the live site says this window is signed in as ${JSON.stringify(String(company || "nobody").slice(0, 60))}, not the ZZ ${role} account`);
    }
    w.signedIn = true; w.proved = true; w.me = me;
  }
  if (!leaveGate) await passPlatformGate(ctx, w, role);
  return w;
}
/* After the switch to Terms 2.0 an account that has not accepted the new
   Platform Terms meets a box it cannot close. Every role but the veteran
   accepts it here, once, so its journeys can run; the veteran's box is the
   thing its own journey tests. */
export async function passPlatformGate(ctx, w, role) {
  if (!ctx.world.terms2 || w.gatePassed) return;
  if (await shows(w.page, "#npTermsGate", 2500)) {
    await w.page.check("#npTermsGate input[data-np-gate-tick]");
    await w.page.click("#npTermsGate [data-np-gate-go]");
    await w.page.locator("#npTermsGate").waitFor({ state: "detached" });
    ctx.notes.push(`The ${role} account met the Platform Terms box at sign-in and accepted it, so its journeys could run.`);
  }
  w.gatePassed = true;
}
export async function signOut(w) {
  await w.page.click(".np-chip__out");
  await w.page.locator("[data-np-account-slot] [data-np-signin]").first().waitFor({ state: "visible" });
  w.signedIn = false; w.proved = false;
}

// ---------------------------------------------------------------- the admin
export const ADMIN = `${APEX}/admin`;
/* Opens the admin and waits for the operator to sign in, second factor and
   all. The script never sees the password or the code. */
export async function adminWindow(ctx) {
  const w = await windowFor(ctx, "admin");
  ctx.lastWindow = w;
  if (w.proved) return w;
  if (ctx.adminDeclined) skip("you chose to leave the admin out");
  if (!/\/admin\//.test(w.page.url())) await go(w.page, `${ADMIN}/inbox.html`);
  if (!(await shows(w.page, "#admin", 3000))) {
    if (ctx.args.headless) skip("the admin needs you to sign in, in the Chrome window");
    await w.page.bringToFront().catch(() => {});
    const went = await askEnter("Sign in to the admin in the Chrome window (password, then your six-digit code). The test carries on from there.");
    if (!went) { ctx.adminDeclined = true; skip("you chose to leave the admin out"); }
    await w.page.locator("#admin").waitFor({ state: "visible", timeout: 10 * 60 * 1000 })
      .catch(() => differs("the admin after sign-in", "still at the door after ten minutes", "the boards"));
  }
  const who = (await text(w.page, "#who").catch(() => "")).toLowerCase();
  const want = String(ctx.settings.admin.email || "").trim().toLowerCase();
  if (want && !who.includes(want)) throw new Refused(`refused: the admin window is signed in as ${JSON.stringify(who.slice(0, 60))}, not the address in the settings`);
  w.proved = true;
  return w;
}
export async function adminGo(ctx, file) {
  const w = await adminWindow(ctx);
  await go(w.page, `${ADMIN}/${file}`);
  await w.page.locator("#admin").waitFor({ state: "visible" });
  await w.page.waitForLoadState("networkidle").catch(() => {});
  return w;
}
/* The toast after a save, and which route the save took: straight to the
   database (fast saves on) or queued for the engine. */
export async function saveVia(page, press, ctx) {
  /* The page says how the save went in its toast, once the save has come
     back: exactly "Saved" for a fast save (admin/save.js), its own words
     ending "queued" for the engine's route, and a sentence when it failed.
     A missing database function falls back to the engine by itself. */
  await page.evaluate(() => { const t = document.getElementById("toast"); if (t) t.textContent = ""; });
  await press();
  /* Given the step's ctx, a press that cannot be taken back is marked done
     the moment it is made, so a toast that never comes cannot send it twice. */
  if (ctx) ctx.did();
  await page.waitForFunction(() => { const t = document.getElementById("toast"); return !!t && t.textContent.trim() !== ""; }, null, { timeout: 35000 })
    .catch(() => { throw new Error("the save showed no result"); });
  const toast = await text(page, "#toast");
  if (/^Not saved|may not have saved|Could not|Still saving/i.test(toast)) differs("the save", toast, "Saved");
  return { direct: toast === "Saved", toast };
}
/* CY11 and DA9 expect the fast saves on. A save that went the old way is
   not wrong, but it is not what those steps describe. */
export function wantDirect(saved, what) {
  if (!saved.direct) differs(`${what}: fast saves`, `queued for the engine ("${saved.toast}"); the direct_writes switch reads off`, "Saved, straight to the database");
}

// ---------------------------------------------------------------- waiting on the engine
/* Polls until check() answers something truthy, or the time is up (then ""
   or false). Every admin request wakes the engine within about a minute
   (the worker's /intents/ping), so most waits are a few minutes at most. */
export async function pollUntil(check, { ms = 4 * 60 * 1000, every = 10000 } = {}) {
  const until = Date.now() + ms;
  for (;;) {
    const got = await check().catch(() => null);
    if (got) return got;
    if (Date.now() > until) return null;
    await new Promise((r) => setTimeout(r, every));
  }
}
/* A real Xero invoice the run raised. Listed in the report; the money.void
   journey stops for the operator to void each one in Xero. */
export function invoiceRaised(ctx, { what, number = "", company = "", amount = "", table = "", id = "" }) {
  ctx.state.invoices = ctx.state.invoices || [];
  const row = { what, number, company, amount, table, id, raised: new Date().toISOString(), run: ctx.stamp };
  const same = (i) => (id && i.table === table && String(i.id) === String(id)) || (number && i.number === number);
  const known = ctx.state.invoices.find(same);
  if (known) { if (number && !known.number) known.number = number; return; }
  ctx.state.invoices.push(row);
  ctx.left.push(`${what}${number ? ` (Xero ${number})` : ""}`);
}

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
   own act on its own records. A path not listed never leaves the browser. */
const ACCOUNT_POSTS = new Set(["/auth/login", "/auth/logout", "/auth/register", "/auth/confirm", "/auth/invite",
  "/auth/register-invited", "/auth/reset-request", "/listings/search", "/seeker-requests", "/listings", "/requests",
  "/introductions/accept", "/introductions/decline", "/account/invites", "/account/users/remove",
  "/terms/platform/accept", "/signup/view"]);
/* What the admin window may ask the engine to do. Nothing here raises an
   invoice, approves a listing, invites anyone, or runs a job. */
const ADMIN_INTENTS = new Set(["add-note", "edit-company", "add-task", "done-task", "add-card", "move-card", "mark-card-dead",
  "add-prospect", "edit-prospect", "add-prospect-note", "accept-prospect", "review-web-request", "publish-to-live-site",
  "end-board-opportunity", "introduce-on-board"]);
const ADMIN_INTENTS_DELETE_LOGIN = new Set(["edit-person", "delete-user"]);
const ADMIN_API_POSTS = new Set(["/consultancy/links", "/consultancy/links/revoke"]);
const ADMIN_TABLE_WRITES = new Set(["PATCH board_opportunities"]);

const bodyOf = (request) => { try { return JSON.parse(request.postData() || "null"); } catch { return null; } };
/* Why a request is stopped, or "" when it may go. */
export function lockVerdict(kind, method, url, body, opts = {}) {
  const u = new URL(url);
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return "";
  if (u.hostname === "api.nexpoint.co.uk") {
    if (u.pathname === "/signup/accept") return "signing a consultancy agreement (it raises a Xero invoice)";
    const allowed = kind === "admin" ? ADMIN_API_POSTS : ACCOUNT_POSTS;
    if (method === "POST" && allowed.has(u.pathname)) {
      if (u.pathname === "/introductions/accept" && !opts.accept) return "accepting an introduction without --with accept";
      return "";
    }
    return `${method} ${u.pathname}`;
  }
  if (u.hostname === DB_HOST) {
    if (u.pathname.startsWith("/auth/v1/")) return "";                       // the admin's own sign-in and second factor
    if (kind !== "admin") return `${method} ${u.pathname} from an account window`;
    const table = u.pathname.replace(/^\/rest\/v1\//, "");
    if (table === "engine_intents" && method === "POST") {
      const rows = [].concat(body || []);
      if (!rows.length) return "an engine request with no readable body";
      for (const row of rows) {
        const type = String((row && row.type) || "");
        const ok = ADMIN_INTENTS.has(type) || (opts.deleteLogin && ADMIN_INTENTS_DELETE_LOGIN.has(type));
        if (!ok) return `the engine request "${type}"`;
        let p = row.payload_json; if (typeof p === "string") { try { p = JSON.parse(p); } catch { p = null; } }
        if (type === "accept-prospect" && !(p && Array.isArray(p.campaign_ids) && p.campaign_ids.length === 0)) {
          return "accepting a prospect onto a campaign (it goes into Smartlead)";
        }
        if (type === "add-prospect" && p && Array.isArray(p.campaign_ids) && p.campaign_ids.length) {
          return "adding a prospect onto a campaign (it goes into Smartlead)";
        }
        if (type === "review-web-request" && p && p.status !== "approved") return "declining a request (the company is told)";
      }
      return "";
    }
    /* The fast saves (plan 079): database functions that change the CRM's own
       rows and nothing outside it. The page falls back to an engine request
       when one is missing, and that is checked above. */
    if (method === "POST" && /^rpc\/crm_[a-z_]+$/.test(table)) return "";
    if (ADMIN_TABLE_WRITES.has(`${method} ${table}`)) return "";
    return `${method} ${table}`;
  }
  return "";   // other hosts: fonts, maps, the human check. Our pages send nothing else of ours.
}
async function lock(context, kind, ctx) {
  const opts = { accept: ctx.args.with.includes("accept"), deleteLogin: ctx.args.with.includes("delete-login") };
  const guard = async (route) => {
    const request = route.request();
    const why = lockVerdict(kind, request.method(), request.url(), bodyOf(request), opts);
    if (!why) return route.continue();
    ctx.blocked.push(why);
    ctx.log(`  LOCK: stopped ${why}`);
    return route.abort("blockedbyclient");
  };
  await context.route(`https://api.nexpoint.co.uk/**`, guard);
  await context.route(`https://${DB_HOST}/**`, guard);
}

// ---------------------------------------------------------------- windows
/* One browser context per account and pass. The phone pass starts from the
   computer pass's session, so nobody signs in twice. */
export async function windowFor(ctx, role, { fresh = false } = {}) {
  const key = `${role}@${ctx.pass}`;
  if (!fresh && ctx.windows[key]) return ctx.windows[key];
  const size = SIZES[ctx.size];
  const earlier = ctx.windows[`${role}@computer`];
  const storageState = !fresh && earlier && ctx.pass !== "computer" ? await earlier.context.storageState() : undefined;
  const context = await ctx.browser.newContext({ ...size, locale: "en-GB", timezoneId: "Europe/London", storageState });
  context.setDefaultTimeout(15000);
  await lock(context, role === "admin" ? "admin" : "account", ctx);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e).slice(0, 200)));
  /* Remove user asks with the browser's own confirm box. */
  page.on("dialog", (d) => d.accept().catch(() => {}));
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
  await loc.waitFor({ state: "visible", timeout: ms }).catch(() => { throw new Error(`${what}: nothing showed at ${selector}`); });
  const got = ((await loc.textContent()) || "").replace(/\s+/g, " ").trim();
  const ok = part instanceof RegExp ? part.test(got) : got.includes(part);
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
    if (!(me && me.signed_in && sameName(company, a.company) && isZZ(company))) {
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
  if (!/\/admin\//.test(w.page.url())) await go(w.page, `${ADMIN}/inbox.html`);
  if (!(await shows(w.page, "#admin", 3000))) {
    if (ctx.args.headless) skip("the admin needs you to sign in, in the Chrome window");
    await w.page.bringToFront().catch(() => {});
    const went = await askEnter("Sign in to the admin in the Chrome window (password, then your six-digit code). The test carries on from there.");
    if (!went) skip("you chose to leave the admin out");
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
export async function saveVia(page, press) {
  const sent = page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).hostname === DB_HOST
    && /\/rest\/v1\/(rpc\/crm_|engine_intents)/.test(r.url()), { timeout: 15000 });
  await press();
  const request = await sent.catch(() => { throw new Error("the save sent nothing"); });
  const direct = /\/rpc\/crm_/.test(request.url());
  const response = await request.response().catch(() => null);
  const toast = await text(page, "#toast").catch(() => "");
  if (response && response.status() >= 400) differs("the save", `${response.status()} ${toast}`, "saved");
  return { direct, toast };
}
/* CY11 and DA9 expect the fast saves on. A save that went the old way is
   not wrong, but it is not what those steps describe. */
export function wantDirect(saved, what) {
  if (!saved.direct) differs(`${what}: fast saves`, `queued for the engine ("${saved.toast}"); the direct_writes switch reads off`, "Saved, straight to the database");
  if (!/^Saved/.test(saved.toast)) differs(`${what}: the toast`, saved.toast, "Saved");
}

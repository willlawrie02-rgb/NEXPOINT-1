// The scripted walk (launch checklist, Phase 4): a real browser opens every
// way in, as a stranger and as a signed-in account, and every admin board.
//
//   npm run walk
//
// Nothing here touches the live site, the live API or the live database. The
// pages are served from this checkout under their real hostnames, and the API
// (api.nexpoint.co.uk) and the database (Supabase) are stubbed in this file.
// A request to either that no stub knows is a failure, so a page that starts
// calling something new is noticed here. The one thing fetched from the
// network is the pinned supabase-js build the boards load from the CDN.
//
//   WALK_ADMIN_DIR=/path/to/engine/app npm run walk   walks the boards from
//       the engine's source instead of this repo's deploy copy, to prove a
//       change before the admin sync.
//   WALK_BROWSER=/path/to/chrome   uses that browser.
//   WALK_ONLY=boards (or public)   runs one half.
import { chromium } from "playwright-core";
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, dirname, resolve, extname, sep } from "node:path";
import { homedir } from "node:os";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const ADMIN_DIR = process.env.WALK_ADMIN_DIR ? resolve(process.env.WALK_ADMIN_DIR) : join(ROOT, "admin");
const ONLY = process.env.WALK_ONLY || "";

const APEX = "https://nexpoint.co.uk";
const PRINT = "https://printhub.nexpoint.co.uk";
const MILL = "https://millhub.nexpoint.co.uk";
const OPPS = "https://opportunities.nexpoint.co.uk";
const FOLDERS = {
  "nexpoint.co.uk": "",
  "printhub.nexpoint.co.uk": "printhub",
  "millhub.nexpoint.co.uk": "millhub",
  "opportunities.nexpoint.co.uk": "opportunities",
};
const API_HOST = "api.nexpoint.co.uk";
const DB_HOST = "synywukadvjpjjxjylwk.supabase.co";
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".webp": "image/webp", ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8", ".xml": "application/xml", ".woff2": "font/woff2",
};

// ---------------------------------------------------------------- results
const results = [];
let area = "";
const check = (name, ok, detail = "") => {
  results.push({ area, name, ok: !!ok, detail: ok ? "" : String(detail || "") });
};
/* One step of a walk. A step that throws (a timeout, a missing element) is a
   failed check with the reason, and the walk carries on to the next. */
async function step(name, fn) {
  try {
    const out = await fn();
    check(name, out !== false, out === false ? "the expectation was false" : "");
  } catch (e) {
    check(name, false, String(e && e.message ? e.message : e).split("\n")[0].slice(0, 300));
  }
}
const eq = (got, want, what) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  return true;
};
const has = (text, part, what) => {
  if (!String(text || "").includes(part)) throw new Error(`${what}: ${JSON.stringify(String(text || "").slice(0, 160))} does not include ${JSON.stringify(part)}`);
  return true;
};

// ---------------------------------------------------------------- the people
const PASSWORD = "walk-password-1";
const USER = {
  id: "00000000-0000-4000-8000-000000000001", name: "Walk Tester", company: "ZZ Walk Test Ltd",
  email: "walk@example.com", town: "Leeds", country: "United Kingdom", region: "Europe",
  email_confirmed: true, confirmed: true,
};
const ADMIN_EMAIL = "willlawrie@nexpoint.co.uk";
const MFA_CODE = "123456";
const now = () => Math.floor(Date.now() / 1000);
const b64u = (v) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");
const FACTOR = { id: "factor-1", factor_type: "totp", status: "verified", friendly_name: "NexPoint admin",
  created_at: "2026-10-01T14:00:00Z", updated_at: "2026-10-01T14:00:00Z" };
const adminUser = (factors = [FACTOR]) => ({
  id: "00000000-0000-4000-8000-0000000000aa", aud: "authenticated", role: "authenticated", email: ADMIN_EMAIL,
  email_confirmed_at: "2026-09-01T09:00:00Z", app_metadata: { provider: "email" }, user_metadata: {},
  created_at: "2026-09-01T09:00:00Z", updated_at: "2026-09-01T09:00:00Z", factors,
});
/* A session the pinned client will accept: it reads the level from the
   token's own payload and never checks the signature. */
const adminSession = (aal, factors) => {
  const t = now();
  const token = [b64u({ alg: "HS256", typ: "JWT" }), b64u({
    sub: adminUser().id, email: ADMIN_EMAIL, role: "authenticated", aud: "authenticated", aal,
    amr: [{ method: "password", timestamp: t }].concat(aal === "aal2" ? [{ method: "totp", timestamp: t }] : []),
    session_id: "walk-session", iat: t, exp: t + 3600,
  }), b64u("walk-signature")].join(".");
  return { access_token: token, token_type: "bearer", expires_in: 3600, expires_at: t + 3600,
    refresh_token: "walk-refresh", user: adminUser(factors) };
};

// ---------------------------------------------------------------- the world
/* One per scenario: who is signed in, what the API and the database answer,
   and a record of everything the pages asked for. */
function newWorld(over = {}) {
  return Object.assign({
    user: null,          // the signed-in hub account, or null for a stranger
    summary: null,       // GET /account/summary for that account
    api: {},             // "METHOD /path" -> (world, req) => [status, body]; a scenario's own answers
    calls: [],           // every API call: { method, path, query, body }
    rows: {},            // database table -> rows
    reads: [],           // database reads: { table }
    writes: [],          // database writes: { method, table, body }
    strays: [],          // requests no stub knew
    missing: [],         // files a page asked for that are not in the checkout
    copies: [],          // Web3Forms copies of the homepage form
    factors: undefined,  // the operator's second factors (undefined: one verified)
    dialog: "accept",    // how a prompt or a confirm is answered
  }, over);
}

const EMPTY_SUMMARY = {
  signed_in: true, email_confirmed: true, org: null, site: null,
  listings: [], requests: [], offers: [], introductions: [],
  orders_awaiting_confirm: [], orders_logged_this_month: [], fees_owed: [], open_strikes: [],
  declarations: { current: null, history: [], lines: [] }, evidence_counts: {}, statements: [],
  score: null, hubs_used: [],
};

/* The terms files are hard-wrapped at about 95 characters, so a paragraph, an
   aside in italics and a list item each arrive on more than one line. The
   reader must join them: on 6 October 2026 the live terms page showed every
   source line as its own paragraph, with the aside's asterisks visible. */
const WRAPPED_TERMS = "# Walk terms\n\n*Version 1.0 · effective 19 October 2026.*\n*Accepted at registration, and again on your next action after a new\nversion takes effect.*\n\n" +
  "The walk's stand-in text, written\nto be read rather than litigated. It wraps\nonto three lines.\n\n" +
  "## 1. A heading\n\n- one item that\n  wraps\n- two\n\n---\n\n**A title on its own line**\nRef [REQ-0001] · [hub] · [date]\n\nA last paragraph.";
const WRAPPED_HTML = {
  paragraphs: ["Version 1.0 · effective 19 October 2026. Accepted at registration, and again on your next action after a new version takes effect.",
    "The walk's stand-in text, written to be read rather than litigated. It wraps onto three lines.",
    "A title on its own line", "Ref [REQ-0001] · [hub] · [date]", "A last paragraph."],
  italics: ["Version 1.0 · effective 19 October 2026.", "Accepted at registration, and again on your next action after a new version takes effect."],
  items: ["one item that wraps", "two"],
  bold: ["A title on its own line"],
  rules: 1,
};
const readRendered = (root) => ({
  paragraphs: [...root.querySelectorAll("p")].map((p) => p.textContent.trim()),
  italics: [...root.querySelectorAll("em")].map((e) => e.textContent.trim()),
  items: [...root.querySelectorAll("li")].map((e) => e.textContent.trim()),
  bold: [...root.querySelectorAll("p > strong:only-child")].map((e) => e.textContent.trim()),
  rules: root.querySelectorAll("hr").length,
});

/* The worker's answers, as the pages meet them. Keyed by method and path. */
const API = {
  "GET /auth/me": (w) => (w.user ? [200, { ok: true, signed_in: true, member: w.user }] : [200, { ok: true, signed_in: false }]),
  "POST /auth/login": (w, req) => {
    if (req.body && req.body.email === USER.email && req.body.password === PASSWORD) { w.user = USER; return [200, { ok: true, member: USER }]; }
    return [401, { error: "invalid_credentials" }];
  },
  "POST /auth/logout": (w) => { w.user = null; return [200, { ok: true }]; },
  "POST /auth/register": () => [200, { ok: true }],
  // the site map's two lookups (plan 046): a place for a search, a place for a pin
  "GET /geocode/search": () => [200, { ok: true, point: { lat: 53.8, lng: -1.55 } }],
  "GET /geocode/reverse": () => [200, { ok: true, town: "Leeds", country: "United Kingdom", region: "uk" }],
  "POST /auth/resend-confirmation": () => [200, { ok: true }],
  "POST /auth/reset-request": () => [200, { ok: true }],
  "POST /auth/confirm": (w) => { w.user = USER; return [200, { ok: true, email: USER.email, member: USER }]; },
  "GET /terms/current": (w, req) => [200, { ok: true, id: 12, layer: req.query.layer || "platform", version: "1.0",
    title: "NexPoint terms (walk)", body_md: WRAPPED_TERMS }],
  "POST /requests": () => [200, { ok: true }],
  "GET /account/summary": (w) => (w.user ? [200, w.summary || EMPTY_SUMMARY] : [401, { error: "unauthenticated" }]),
  "GET /opportunities/briefs": () => [200, { ok: true, briefs: [] }],
  "GET /vocab": () => [200, { ok: true, items: [] }],
  "GET /attributes": () => [200, { ok: true, attributes: [] }],
  "GET /listings/mine": () => [200, { ok: true, listing: null }],
  "GET /host/application": () => [200, { ok: true, application: null }],
  "GET /listings/search": () => [200, { ok: true, results: [] }],
};

// ---------------------------------------------------------------- routing
function cors(request) {
  const h = request.headers();
  return {
    "access-control-allow-origin": h.origin || "*",
    "access-control-allow-credentials": "true",
    "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,HEAD,OPTIONS",
    "access-control-allow-headers": h["access-control-request-headers"] || "*",
    "access-control-expose-headers": "content-range",
    vary: "origin",
  };
}
const jsonBody = (request) => {
  try { return JSON.parse(request.postData() || "null"); } catch { return null; }
};

async function answerApi(world, route, request, url) {
  if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors(request) });
  const key = `${request.method()} ${url.pathname}`;
  const req = { method: request.method(), path: url.pathname, query: Object.fromEntries(url.searchParams), body: jsonBody(request),
    origin: request.headers().origin || "" };
  world.calls.push(req);
  /* Plan 052 item 1: /auth/me can fail at the network (meFailures, counted
     down) or never answer at all (meHang). */
  if (key === "GET /auth/me" && world.meFailures > 0) { world.meFailures--; return route.abort("failed"); }
  if (key === "GET /auth/me" && world.meHang) return;
  /* A route named in world.hang is never answered (the vocabulary, in the account walk). */
  if (world.hang && world.hang.has(key)) return;
  /* A path with an id in it is matched by its shape. */
  const shaped = key.replace(/\/\d+(\/|$)/g, "/:id$1");
  const fn = world.api[key] || world.api[shaped] || API[key] || API[shaped];
  if (!fn) {
    world.strays.push(`API ${key}`);
    return route.fulfill({ status: 404, headers: cors(request), contentType: "application/json", body: JSON.stringify({ error: "http_404" }) });
  }
  const [status, body] = fn(world, req);
  return route.fulfill({ status, headers: cors(request), contentType: "application/json", body: JSON.stringify(body) });
}

async function answerDb(world, route, request, url) {
  const headers = cors(request);
  const method = request.method();
  if (method === "OPTIONS") return route.fulfill({ status: 204, headers });
  const send = (status, body, extra = {}) => route.fulfill({
    status, headers: Object.assign({}, headers, extra), contentType: "application/json",
    body: body === undefined ? "" : JSON.stringify(body),
  });
  const p = url.pathname;
  const body = jsonBody(request);

  // --- the sign-in service
  if (p === "/auth/v1/token") {
    if (url.searchParams.get("grant_type") === "refresh_token") return send(200, adminSession(world.aal || "aal2", world.factors));
    if (body && body.email === ADMIN_EMAIL && body.password === PASSWORD) { world.aal = "aal1"; return send(200, adminSession("aal1", world.factors)); }
    return send(400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });
  }
  if (p === "/auth/v1/user") return send(200, adminUser(world.factors));
  /* Setting up a second factor: the QR and the key to type by hand. */
  if (p === "/auth/v1/factors" && method === "POST") return send(200, { id: "factor-new", type: "totp", friendly_name: "NexPoint admin",
    totp: { qr_code: "<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'></svg>", secret: "WALKSECRET", uri: "otpauth://totp/walk" } });
  if (p === "/auth/v1/logout") return send(204);
  if (/^\/auth\/v1\/factors\/[^/]+\/challenge$/.test(p)) return send(200, { id: "challenge-1", type: "totp", expires_at: now() + 300 });
  if (/^\/auth\/v1\/factors\/[^/]+\/verify$/.test(p)) {
    if (body && body.code === MFA_CODE) { world.aal = "aal2"; return send(200, adminSession("aal2", world.factors)); }
    return send(422, { code: 422, error_code: "mfa_verification_failed", msg: "Invalid TOTP code entered" });
  }

  // --- the tables
  const table = (p.match(/^\/rest\/v1\/([^/]+)$/) || [])[1];
  const rpc = (p.match(/^\/rest\/v1\/rpc\/([^/]+)$/) || [])[1];
  if (rpc) { world.reads.push({ table: "rpc:" + rpc }); return send(200, []); }
  if (table) {
    if (method === "GET" || method === "HEAD") {
      world.reads.push({ table });
      const rows = world.rows[table] || [];
      const range = rows.length ? `0-${rows.length - 1}/${rows.length}` : "*/0";
      if ((request.headers().accept || "").includes("vnd.pgrst.object+json")) {
        if (rows.length === 1) return send(200, rows[0], { "content-range": range });
        return send(406, { code: "PGRST116", details: `The result contains ${rows.length} rows`, hint: null,
          message: "JSON object requested, multiple (or no) rows returned" });
      }
      /* A paged read asks for a range; a short page ends it. */
      const from = Number((request.headers().range || "").split("-")[0]) || Number(url.searchParams.get("offset")) || 0;
      return method === "HEAD" ? send(200, undefined, { "content-range": range }) : send(200, rows.slice(from), { "content-range": range });
    }
    world.writes.push({ method, table, body });
    const back = (request.headers().prefer || "").includes("return=representation")
      ? (Array.isArray(body) ? body : [body]).map((r, i) => Object.assign({ id: 9000 + i }, r)) : undefined;
    return send(method === "POST" ? 201 : 200, back === undefined ? undefined : back);
  }
  world.strays.push(`DB ${method} ${p}`);
  return send(404, { message: "the walk has no stub for this" });
}

function serveFile(world, route, url) {
  const folder = FOLDERS[url.hostname];
  let rel = decodeURIComponent(url.pathname);
  let base = join(ROOT, folder);
  if (url.hostname === "nexpoint.co.uk" && (rel === "/admin" || rel.startsWith("/admin/"))) { base = ADMIN_DIR; rel = rel.slice("/admin".length) || "/"; }
  let file = resolve(join(base, rel));
  if (file !== base && !file.startsWith(base + sep)) return route.fulfill({ status: 403, body: "outside the site" });
  if (existsSync(file) && statSync(file).isDirectory()) {
    /* GitHub Pages sends a folder path without its slash to the slash. */
    if (!url.pathname.endsWith("/")) return route.fulfill({ status: 301, headers: { location: url.origin + url.pathname + "/" + url.search } });
    file = join(file, "index.html");
  }
  if (!existsSync(file)) {
    if (!/favicon\.ico$/.test(file)) world.missing.push(url.href);
    return route.fulfill({ status: 404, contentType: "text/plain", body: "not found" });
  }
  return route.fulfill({ status: 200, contentType: MIME[extname(file)] || "application/octet-stream",
    headers: { "access-control-allow-origin": "*" }, body: readFileSync(file) });
}

const TURNSTILE = `window.turnstile = {
  render: function (box, o) { setTimeout(function () { o.callback("walk-turnstile-token"); }, 0); return "walk-widget"; },
  remove: function () {}, reset: function () {} };`;

async function routeAll(context, world) {
  await context.route("**/*", async (route) => {
    const request = route.request();
    let url;
    try { url = new URL(request.url()); } catch { return route.abort(); }
    if (url.protocol === "data:" || url.protocol === "blob:" || url.protocol === "about:") return route.continue();
    const host = url.hostname;
    if (host in FOLDERS) return serveFile(world, route, url);
    if (host === API_HOST) return answerApi(world, route, request, url);
    if (host === DB_HOST) return answerDb(world, route, request, url);
    /* The pinned supabase-js build: the real file, so its integrity check holds. */
    if (host === "cdn.jsdelivr.net") return route.continue();
    if (host === "fonts.googleapis.com") return route.fulfill({ status: 200, contentType: "text/css", body: "" });
    if (host === "challenges.cloudflare.com") return route.fulfill({ status: 200, contentType: "text/javascript", body: TURNSTILE });
    if (host === "api.web3forms.com") {
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors(request) });
      world.copies.push(jsonBody(request));
      return route.fulfill({ status: 200, headers: cors(request), contentType: "application/json", body: JSON.stringify({ success: true }) });
    }
    /* Anything else (fonts, the visitor-tracking script) gets an empty answer.
       A write to somewhere the walk does not know is a failure. */
    if (request.method() !== "GET" && request.method() !== "HEAD" && request.method() !== "OPTIONS") world.strays.push(`${request.method()} ${url.origin}${url.pathname}`);
    return route.fulfill({ status: 204, body: "" });
  });
}

// ---------------------------------------------------------------- a visit
let browser;
async function visit(world, { seedAdmin = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  context.setDefaultTimeout(8000);
  await routeAll(context, world);
  if (seedAdmin) {
    await context.addInitScript(([key, value]) => {
      try { if (location.hostname === "nexpoint.co.uk") localStorage.setItem(key, value); } catch (e) {}
    }, [`sb-${DB_HOST.split(".")[0]}-auth-token`, JSON.stringify(adminSession("aal2"))]);
    world.aal = "aal2";
  }
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("page error: " + e.message));
  /* The browser logs a line of its own for every refused response, and the
     walk makes the API refuse on purpose. A file that is missing and a call
     no stub knows are both caught by name below, so that line is left out. */
  page.on("console", (m) => {
    if (m.type() === "error" && !/^Failed to load resource: the server responded with a status of/.test(m.text())) errors.push("console: " + m.text());
  });
  page.on("dialog", (d) => {
    world.dialogs = (world.dialogs || []).concat(d.message());
    (world.dialog === "dismiss" ? d.dismiss() : d.accept(world.dialogAnswer || "walk reason")).catch(() => {});
  });
  return { context, page, errors };
}
/* The checks every page ends with: nothing threw, nothing asked for a file
   that is not there, and nothing reached past the stubs. */
function clean(world, errors, what) {
  check(`${what}: no script errors`, errors.length === 0, errors.slice(0, 3).join(" | "));
  check(`${what}: every file it asked for exists`, world.missing.length === 0, world.missing.slice(0, 3).join(", "));
  check(`${what}: nothing reached past the stubs`, world.strays.length === 0, [...new Set(world.strays)].slice(0, 4).join(", "));
}
/* Wait for something the walk itself can see (a recorded call), not the page. */
async function until(fn, what, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await new Promise((r) => setTimeout(r, 50)); }
  throw new Error(`timed out waiting for ${what}`);
}
const apiCalls = (world, key) => world.calls.filter((c) => `${c.method} ${c.path}` === key);
const settled = (page) => page.waitForLoadState("networkidle").catch(() => {});

// ================================================================ the public pages
async function walkDoor() {
  area = "The door (a stranger)";
  const world = newWorld();
  const { context, page, errors } = await visit(world);
  await page.goto(`${APEX}/hub/`);
  await settled(page);
  await step("the door opens with its headline", async () => has(await page.textContent("h1"), "One trusted network.", "h1"));
  await step("a stranger is offered Sign in and Create your hub account", async () => {
    await page.waitForSelector("[data-np-account-slot] [data-np-join]");
    return has(await page.textContent("[data-np-account-slot]"), "Sign in", "the header slot");
  });
  await step("the door reads no hub data for a stranger", async () =>
    eq([...new Set(world.calls.map((c) => `${c.method} ${c.path}`))], ["GET /auth/me"], "API calls on load"));
  await step("Sign in opens the sign-in box", async () => {
    await page.click("[data-np-account-slot] [data-np-signin]");
    await page.waitForSelector("#signOverlay.open");
    await page.keyboard.press("Escape");
    await page.waitForSelector("#signOverlay.open", { state: "detached" });
  });

  // --- the desk form
  const fillDesk = async () => {
    await page.click("text=Talk to the desk");
    await page.waitForSelector("#introOverlay.open form");
    await page.fill("#iName", "Walk Tester");
    await page.fill("#iCompany", "ZZ Walk Test Ltd");
    await page.fill("#iEmail", "walk@example.com");
    await page.fill("#iNotes", "The scripted walk. Please ignore.");
  };
  await step("the desk form sends one request, with its trap field empty", async () => {
    await fillDesk();
    await page.click("#introContent button[type=submit]");
    await page.waitForSelector("#introContent .success");
    has(await page.textContent("#introContent .success"), "Received, in confidence.", "the success card");
    const sent = apiCalls(world, "POST /requests");
    eq(sent.length, 1, "requests sent");
    const b = sent[0].body;
    eq([b.side, b.brief_ref, b.company, b.contact_name, b.email, b.company_url],
      ["request_intro", "THE PORTAL", "ZZ Walk Test Ltd", "Walk Tester", "walk@example.com", ""], "the request body");
    has(b.payload.notes, "scripted walk", "the notes");
    await page.click("#introContent .success button");
  });
  await step("the desk form has a trap field no person can reach, and posts what a bot puts in it", async () => {
    await fillDesk();
    const trap = page.locator('#introContent [name="company_url"]');
    eq(await trap.count(), 1, "trap fields");
    const box = await trap.evaluate((n) => { const r = n.getBoundingClientRect(); return { right: r.right, tab: n.tabIndex, hidden: n.getAttribute("aria-hidden") }; });
    if (!(box.right < 0 && box.tab === -1 && box.hidden === "true")) throw new Error("the trap is reachable: " + JSON.stringify(box));
    await trap.evaluate((n) => { n.value = "https://spam.example"; });
    await page.click("#introContent button[type=submit]");
    await page.waitForSelector("#introContent .success");
    eq(apiCalls(world, "POST /requests").pop().body.company_url, "https://spam.example", "the posted trap value");
    await page.click("#introContent .success button");
  });
  await step("a request the worker refuses says so and gives the button back", async () => {
    world.api["POST /requests"] = () => [500, { error: "server_error" }];
    await fillDesk();
    await page.click("#introContent button[type=submit]");
    await page.waitForSelector("#introContent .form-error");
    has(await page.textContent("#introContent .form-error"), "That did not go through.", "the failure line");
    eq(await page.isDisabled("#introContent button[type=submit]"), false, "the button is disabled");
    delete world.api["POST /requests"];
    await page.keyboard.press("Escape");
  });

  // --- the Education list
  await step("the Education sign-up sends name and email, nothing else", async () => {
    await page.click("text=Put me on the list");
    await page.waitForSelector("#introOverlay.open form");
    await page.fill("#eName", "Walk Tester");
    await page.fill("#eEmail", "walk@example.com");
    await page.click("#introContent button[type=submit]");
    await page.waitForSelector("#introContent .success");
    has(await page.textContent("#introContent .success"), "You're on the list.", "the success card");
    const b = apiCalls(world, "POST /requests").pop().body;
    eq([b.hub, b.side, b.contact_name, b.email, b.company, b.company_url], ["education", "join_list", "Walk Tester", "walk@example.com", "", ""], "the request body");
    await page.click("#introContent .success button");
  });
  clean(world, errors, "the door");
  await context.close();
}

async function walkRegister() {
  area = "Create an account (validation)";
  const world = newWorld();
  const { context, page, errors } = await visit(world);
  await page.goto(`${APEX}/hub/`);
  await page.click("[data-np-account-slot] [data-np-join]");
  await page.waitForSelector('form[data-np-step="1"]');
  const onStep = async (n) => (await page.locator(`form[data-np-step="${n}"]`).count()) === 1;
  const submit = () => page.click("#npAccountContent button[type=submit]");

  await step("an empty form does not move on", async () => { await submit(); return (await onStep(1)) && (await page.locator("#qName:invalid").count()) === 1; });
  await step("a bad email does not move on", async () => {
    await page.fill("#qName", "Walk Tester"); await page.fill("#qCompany", "ZZ Walk Test Ltd");
    await page.fill("#qEmail", "not-an-email"); await page.locator("#qPass").pressSequentially("long-enough-1");
    await submit();
    return (await onStep(1)) && (await page.locator("#qEmail:invalid").count()) === 1;
  });
  await step("a seven-character password does not move on", async () => {
    await page.fill("#qEmail", "walk@example.com");
    await page.fill("#qPass", ""); await page.locator("#qPass").pressSequentially("short-7");
    await submit();
    return (await onStep(1)) && (await page.locator("#qPass:invalid").count()) === 1;
  });
  await step("the eye shows the password and hides it again (plan 046)", async () => {
    await page.fill("#qPass", ""); await page.locator("#qPass").pressSequentially(PASSWORD);
    eq(await page.getAttribute("#qPass", "type"), "password", "before the eye");
    await page.click('#npAccountContent .np-eye__btn');
    eq(await page.getAttribute("#qPass", "type"), "text", "after one press");
    eq(await page.getAttribute('#npAccountContent .np-eye__btn', "aria-pressed"), "true", "the eye's state");
    await page.click('#npAccountContent .np-eye__btn');
    eq(await page.getAttribute("#qPass", "type"), "password", "after the second press");
    return has(await page.textContent('#npAccountContent button[type=submit]'), "Continue", "the button");
  });
  await step("a complete first step moves on to where the site is", async () => {
    await page.fill("#qWebsite", "example.com");
    await submit();
    await page.waitForSelector('form[data-np-step="2"]');
    eq(await page.locator("#qMap").count(), 1, "the site map");
    return has(await page.textContent("#npAccountContent h2"), "Where is this site?", "step two");
  });
  await step("a place search fills town, country and region, which stay editable (plan 046)", async () => {
    await page.waitForSelector("#qMap .leaflet-container, #qMap.leaflet-container");
    await page.fill("#qPlace", "Leeds");
    await page.click("#qPlaceFind");
    await page.waitForFunction(() => document.querySelector("#qTown") && document.querySelector("#qTown").value === "Leeds");
    eq(apiCalls(world, "GET /geocode/search").pop().query.q, "Leeds", "the search asked for");
    eq(apiCalls(world, "GET /geocode/reverse").length, 1, "reverse lookups after a search");
    eq([await page.inputValue("#qTown"), await page.inputValue("#qCountry"), await page.inputValue("#qRegion")],
      ["Leeds", "United Kingdom", "UK"], "the three fields");
    eq(await page.locator("#qMap .leaflet-marker-icon").count(), 1, "the pin");
    await page.fill("#qTown", "Bradford");
    return (await page.inputValue("#qTown")) === "Bradford";
  });
  await step("a pin on the map fills the fields too, and a place the worker cannot name says so (plan 046)", async () => {
    await page.click("#qMap", { position: { x: 120, y: 90 } });
    await page.waitForFunction(() => document.querySelector("#qTown") && document.querySelector("#qTown").value === "Leeds");
    eq(apiCalls(world, "GET /geocode/reverse").length, 2, "reverse lookups after a pin");
    world.api["GET /geocode/search"] = () => [200, { ok: true, point: null }];
    await page.fill("#qPlace", "Nowhere in particular");
    await page.keyboard.press("Enter");
    await page.waitForSelector("#qMapNote:not([hidden])");
    eq(apiCalls(world, "POST /auth/register").length, 0, "registrations sent by Enter in the search box");
    delete world.api["GET /geocode/search"];
    has(await page.textContent("#qMapNote"), "could not place that", "the note");
    // a pin the worker cannot name is a miss too, and the fields are left alone
    world.api["GET /geocode/reverse"] = () => [200, { ok: true, town: null, country: null, region: null }];
    await page.fill("#qTown", "Keep me");
    await page.click("#qMap", { position: { x: 60, y: 60 } });
    await page.waitForFunction(() => document.querySelectorAll('#qMapNote:not([hidden])').length === 1);
    delete world.api["GET /geocode/reverse"];
    return (await page.inputValue("#qTown")) === "Keep me";
  });
  await step("the terms and the security check arrive, and unlock the button", async () => {
    await page.waitForSelector("#qTerms");
    await page.waitForSelector('form[data-np-step="2"] button[type=submit]:not([disabled])');
    eq(apiCalls(world, "GET /terms/current")[0].query.layer, "platform", "the terms layer asked for");
  });
  await step("no country, or no tick on the terms, sends nothing", async () => {
    await page.fill("#qCountry", "");
    await submit();
    eq(apiCalls(world, "POST /auth/register").length, 0, "registrations sent without a country");
    await page.fill("#qCountry", "United Kingdom");
    await submit();
    eq(apiCalls(world, "POST /auth/register").length, 0, "registrations sent without the tick");
    return (await page.locator("#qTerms:invalid").count()) === 1;
  });
  await step("a complete form registers once, with the terms version and the check's token", async () => {
    await page.fill("#qTown", "Leeds");
    await page.check("#qTerms");
    await submit();
    await page.waitForSelector("#npAccountContent .success");
    const sent = apiCalls(world, "POST /auth/register");
    eq(sent.length, 1, "registrations sent");
    const b = sent[0].body;
    eq([b.name, b.company, b.email, b.password, b.website, b.country, b.town, b.terms_version_id, b.turnstile_token, b.company_url],
      ["Walk Tester", "ZZ Walk Test Ltd", "walk@example.com", PASSWORD, "example.com", "United Kingdom", "Leeds", 12, "walk-turnstile-token", ""], "the register body");
  });
  await step("it says check your inbox, and signs nobody in", async () => {
    has(await page.textContent("#npAccountContent .success"), "Check your inbox", "the card");
    has(await page.textContent("#npAccountContent .success"), "walk@example.com", "the card");
    await page.click("#npAccountContent [data-np-done]");
    return has(await page.textContent("[data-np-account-slot]"), "Sign in", "the header slot");
  });
  await step("an address that already has an account is told to sign in", async () => {
    world.api["POST /auth/register"] = () => [409, { error: "account_exists" }];
    await page.click("[data-np-account-slot] [data-np-join]");
    await page.waitForSelector('form[data-np-step="1"]');
    await page.locator("#qPass").pressSequentially(PASSWORD);
    await submit();
    await page.waitForSelector("#qTerms");
    await page.check("#qTerms");
    await page.waitForSelector('form[data-np-step="2"] button[type=submit]:not([disabled])');
    await submit();
    await page.waitForSelector("#npAccountContent .np-sign-error:visible");
    return has(await page.textContent("#npAccountContent form .np-sign-error"), "already an account", "the refusal");
  });
  clean(world, errors, "the register form");
  await context.close();
}

const WALLED = [
  ["the Print Hub", `${PRINT}/`], ["Print Hub: find", `${PRINT}/find.html`], ["Print Hub: offer", `${PRINT}/offer.html`],
  ["the Mill Hub", `${MILL}/`], ["Mill Hub: find", `${MILL}/find.html`], ["Mill Hub: offer", `${MILL}/offer.html`],
  ["Opportunities", `${OPPS}/`], ["the account page", `${APEX}/hub/account/`],
];

async function walkWall() {
  area = "The sign-in wall (a stranger)";
  for (const [name, url] of WALLED) {
    const world = newWorld();
    const { context, page } = await visit(world);
    await step(`${name} sends a stranger to the door, with the way back`, async () => {
      await page.goto(url);
      await page.waitForURL((u) => u.origin === APEX && u.pathname === "/hub/" && u.searchParams.get("signin") === "1");
      eq(new URL(page.url()).searchParams.get("return"), url, "the return address");
      await page.waitForSelector("#signOverlay.open");
    });
    await step(`${name} asked the API for nothing but who is signed in`, async () =>
      eq([...new Set(world.calls.map((c) => `${c.method} ${c.path}`))].filter((k) => k !== "GET /auth/me"), [], "other API calls"));
    await context.close();
  }

  area = "Signing in at the door";
  const world = newWorld();
  const { context, page, errors } = await visit(world);
  await page.goto(`${PRINT}/find.html`);
  await page.waitForSelector("#signOverlay.open");
  await step("the sign-in box has the eye too (plan 046)", async () => {
    await page.fill("#sPass", "peek-at-me");
    await page.click("#signContent .np-eye__btn");
    eq(await page.getAttribute("#sPass", "type"), "text", "after one press");
    await page.click("#signContent .np-eye__btn");
    return (await page.getAttribute("#sPass", "type")) === "password";
  });
  await step("a wrong password says so and stays at the door", async () => {
    await page.fill("#sEmail", USER.email); await page.fill("#sPass", "wrong-password");
    await page.click("#signContent button[type=submit]");
    await page.waitForSelector("#signContent .np-sign-error:visible");
    has(await page.textContent("#signContent .np-sign-error"), "don't match", "the refusal");
    return new URL(page.url()).pathname === "/hub/";
  });
  await step("the right password goes back to the page that was asked for, now open", async () => {
    await page.fill("#sPass", PASSWORD);
    await page.click("#signContent button[type=submit]");
    await page.waitForURL(`${PRINT}/find.html`);
    await page.waitForSelector("body[data-np-open]");
    await page.waitForSelector(".np-chip");
    return has(await page.textContent(".np-chip__name"), "Walk Tester", "the chip");
  });
  await step("signing out closes the page and returns to the door", async () => {
    await page.click(".np-chip__out");
    await page.waitForURL((u) => u.origin === APEX && u.pathname === "/hub/");
    eq(apiCalls(world, "POST /auth/logout").length, 1, "sign-outs sent");
  });
  clean(world, errors, "the sign-in round trip");
  await context.close();
}

/* Plan 052 item 1: a signed-in visitor sent to the door by mistake (a slow
   page, a dropped /auth/me, a busy sign-in service) was left on the Global
   Hub's front page with ?return= ignored. */
async function walkDoorReturn() {
  area = "The door sends a signed-in visitor back (plan 052 item 1)";
  const doorWith = (ret) => `${APEX}/hub/?signin=1&return=${encodeURIComponent(ret)}`;
  {
    const world = newWorld({ user: USER });
    const { context, page, errors } = await visit(world);
    await step("a signed-in visitor at the door with ?return= goes straight back, page open", async () => {
      await page.goto(doorWith(`${PRINT}/find.html`));
      await page.waitForURL(`${PRINT}/find.html`);
      await page.waitForSelector("body[data-np-open]");
      return !(await page.isVisible("#signOverlay.open"));
    });
    clean(world, errors, "the door's way back");
    await context.close();
  }
  {
    const world = newWorld({ user: USER });
    const { context, page, errors } = await visit(world);
    /* A real page there, so a navigation would land (the catch-all's 204
       would leave the browser where it was and hide one). */
    let foreign = 0;
    await context.route("https://evil.example/**", (route) => { foreign++; return route.fulfill({ status: 200, contentType: "text/html", body: "<p>elsewhere</p>" }); });
    await step("a ?return= to another site is not followed", async () => {
      await page.goto(doorWith("https://evil.example/phish"));
      await settled(page);
      await page.waitForTimeout(300);
      const u = new URL(page.url());
      eq([u.origin, u.pathname], [APEX, "/hub/"], "where the visitor is");
      eq(foreign, 0, "requests to the other site");
    });
    clean(world, errors, "a foreign return");
    await context.close();
  }
  /* A dropped /auth/me is asked again, not read as signed out. The browser
     logs its own line for the aborted request, so `clean` is not used. */
  for (const [what, over] of [
    ["a network failure", { meFailures: 1 }],
    ["an unsure answer (signed_in null)", { api: { "GET /auth/me": (w) => {
      w.meAsked = (w.meAsked || 0) + 1;
      return w.meAsked === 1 ? [200, { signed_in: null, retry: true }] : [200, { ok: true, signed_in: true, member: w.user }];
    } } }],
  ]) {
    const world = newWorld(Object.assign({ user: USER }, over));
    const { context, page } = await visit(world);
    await step(`a first /auth/me ${what} then success keeps the page`, async () => {
      await page.goto(`${PRINT}/find.html`);
      await page.waitForSelector("body[data-np-open]");
      eq(page.url(), `${PRINT}/find.html`, "the page");
      eq(apiCalls(world, "GET /auth/me").length, 2, "times /auth/me was asked");
    });
    await context.close();
  }
  {
    const world = newWorld({ user: USER, meFailures: 2 });
    const { context, page } = await visit(world);
    await step("two network failures in a row go to the door, which sends the visitor back once it can tell", async () => {
      await page.goto(`${PRINT}/find.html`);
      await until(() => apiCalls(world, "GET /auth/me").length >= 3, "the door asking");
      await page.waitForURL(`${PRINT}/find.html`);
      await page.waitForSelector("body[data-np-open]");
      eq(apiCalls(world, "GET /auth/me").length, 4, "asked twice on the page, once at the door, once back on the page");
    });
    await context.close();
  }
  {
    /* The page can never tell, the door always can: one trip back, then the
       visitor stays at the door rather than bouncing for ever. */
    const world = newWorld({ user: USER, api: { "GET /auth/me": (w, req) => (req.origin === PRINT
      ? [200, { signed_in: null, retry: true }] : [200, { ok: true, signed_in: true, member: w.user }]) } });
    const { context, page } = await visit(world);
    await step("a page that never tells sends the visitor back once, then the door holds", async () => {
      await page.goto(`${PRINT}/find.html`);
      const fromPage = () => world.calls.filter((c) => c.path === "/auth/me" && c.origin === PRINT).length;
      await until(() => fromPage() >= 4, "the second visit to the page", 12000);
      await page.waitForURL((u) => u.origin === APEX && u.pathname === "/hub/");
      await page.waitForTimeout(3000);
      eq(fromPage(), 4, "the page asked twice on each of two visits, no third");
      eq(new URL(page.url()).pathname, "/hub/", "where the visitor is");
    });
    await context.close();
  }
  {
    /* Review, round 1: with sessionStorage refused, the way back carries
       np_back=1, and a return that already has it is not followed again:
       the sign-in box opens instead. */
    const world = newWorld({ user: USER, api: { "GET /auth/me": (w, req) => (req.origin === PRINT
      ? [200, { signed_in: null, retry: true }] : [200, { ok: true, signed_in: true, member: w.user }]) } });
    const { context, page } = await visit(world);
    await context.addInitScript(() => {
      Object.defineProperty(window, "sessionStorage", { configurable: true, get() { throw new Error("storage refused"); } });
    });
    await step("with no session storage, the np_back marker stops a second trip back", async () => {
      await page.goto(`${PRINT}/find.html`);
      const fromPage = () => world.calls.filter((c) => c.path === "/auth/me" && c.origin === PRINT).length;
      await until(() => fromPage() >= 4, "the second visit to the page", 12000);
      await page.waitForURL((u) => u.origin === APEX && u.pathname === "/hub/");
      await page.waitForSelector("#signOverlay.open");
      await page.waitForTimeout(3000);
      eq(fromPage(), 4, "the page asked twice on each of two visits, no third");
      eq(new URL(new URL(page.url()).searchParams.get("return")).searchParams.get("np_back"), "1", "the marker on the way back");
    });
    await context.close();
  }
  /* The wall timer: 20 seconds, and gone once the account module is in. */
  {
    const world = newWorld({ user: USER, meHang: true });
    const { context, page } = await visit(world);
    /* Review, round 1: with the wall timer gone once the module is in, a
       hanging /auth/me must not leave the page blank for ever. The fetch
       gives up after 8 s, asks once more after 1.5 s, then the door. */
    await step("a hanging /auth/me gives up at 8 s, asks again, then the door", async () => {
      await page.clock.install();
      await page.goto(`${PRINT}/find.html`);
      const fromPage = () => world.calls.filter((c) => c.path === "/auth/me" && c.origin === PRINT).length;
      await until(() => fromPage() === 1, "the account module asking");
      await page.clock.runFor(7000);
      await page.waitForTimeout(200);
      eq([new URL(page.url()).hostname, fromPage()], ["printhub.nexpoint.co.uk", 1], "at 7 s: the page, asked once");
      await page.clock.runFor(3000);
      await until(() => fromPage() === 2, "the second ask");
      await page.clock.runFor(9000);
      await page.waitForURL((u) => u.origin === APEX && u.pathname === "/hub/");
      eq(fromPage(), 2, "times the page asked");
    });
    await context.close();
  }
  {
    const world = newWorld({ user: USER });
    const { context, page } = await visit(world);
    await context.route("https://nexpoint.co.uk/assets/hub-account.js", (route) => route.fulfill({ status: 404, body: "" }));
    await step("with no account module the wall waits 20 seconds, not 10, then goes to the door", async () => {
      await page.clock.install();
      await page.goto(`${PRINT}/find.html`);
      await page.clock.runFor(15000);
      await page.waitForTimeout(200);
      eq(new URL(page.url()).hostname, "printhub.nexpoint.co.uk", "the host after 15 s");
      await page.clock.runFor(6000);
      await page.waitForURL((u) => u.origin === APEX && u.pathname === "/hub/");
    });
    await context.close();
  }
}

async function walkSignedIn() {
  area = "The hub pages (a signed-in account)";
  const pages = [["the door", `${APEX}/hub/`]].concat(WALLED.filter(([n]) => n !== "the account page"));
  for (const [name, url] of pages) {
    const world = newWorld({ user: USER });
    const { context, page, errors } = await visit(world);
    await step(`${name} opens for an account, with the chip`, async () => {
      await page.goto(url);
      if (url !== `${APEX}/hub/`) await page.waitForSelector("body[data-np-open]");
      await page.waitForSelector(".np-chip");
      has(await page.textContent(".np-chip__name"), "Walk Tester", "the chip's name");
      has(await page.textContent("[data-np-account-slot]"), "Sign out", "the chip's sign out");
      if (/Signed in/.test(await page.textContent("[data-np-account-slot]"))) throw new Error('the chip still says "Signed in"');
      // The Opportunities board has its own header with no Talk to the desk
      // button; everywhere else the chip sits right of it (plan 046).
      eq(await page.evaluate(() => {
        if (!/Talk to the desk/.test(document.querySelector("header").textContent)) return true;
        const slot = document.querySelector("[data-np-account-slot]");
        const before = slot && slot.previousElementSibling;
        return !!(before && /Talk to the desk/.test(before.textContent));
      }), true, "the chip sits right of Talk to the desk");
      await settled(page);
      const heading = (await page.locator("h1").first().textContent()) || "";
      if (!heading.trim()) throw new Error("the page has no headline");
    });
    await step(`${name} at phone width: the header fits and Sign out is on screen`, async () => {
      await page.setViewportSize({ width: 375, height: 740 });
      await page.waitForTimeout(150);
      const m = await page.evaluate(() => {
        const nav = document.querySelector("header .nav");
        const out = document.querySelector(".np-chip__out").getBoundingClientRect();
        const name = document.querySelector(".np-chip__name").getBoundingClientRect();
        return { navScroll: nav.scrollWidth, navClient: nav.clientWidth, inner: window.innerWidth,
          outRight: Math.round(out.right), outWidth: Math.round(out.width), nameRight: Math.round(name.right), nameWidth: Math.round(name.width) };
      });
      if (m.navScroll > m.navClient) throw new Error(`the header's row overflows: ${m.navScroll}px of content in ${m.navClient}px`);
      if (!m.nameWidth || m.nameRight > m.inner) throw new Error(`the name ends at ${m.nameRight}px in a ${m.inner}px window`);
      if (!m.outWidth || m.outRight > m.inner) throw new Error(`Sign out ends at ${m.outRight}px in a ${m.inner}px window`);
    });
    clean(world, errors, name);
    await context.close();
  }
}

/* The seeker's shortlist and its map (plan 052, items 23 and 24): the best
   three cards, a map with the seeker's town and the sites' towns, two sites
   in one town sharing one numbered pin, and one pick, on the map or a card. */
const MATCH_CARD = (id, town, lat, lng, lead, km, shortlist) => ({
  listing_id: id, town, country: "United Kingdom", point: lat === null ? null : { lat, lng },
  machines: [{ name: "HP MJF 5200", materials: ["pa12_nylon12"], count: 1, lead_time_days: lead }],
  materials: ["pa12_nylon12"], processes: ["mjf"], services: [], min_lead_time_days: lead,
  verified: true, distance_km: km, meets_lead_time: true, no_match_flag: false, shortlist,
});
const MATCHES = [
  MATCH_CARD("listing-a", "Leeds", 53.8, -1.55, 3, 5, true),
  MATCH_CARD("listing-b", "Leeds", 53.8, -1.55, 6, 5, true),
  MATCH_CARD("listing-c", "Bristol", 51.45, -2.59, 4, 270, true),
  MATCH_CARD("listing-d", "Glasgow", 55.86, -4.25, 2, 300, false),
];

async function walkFindMap() {
  area = "Finding capacity: the best three and the map";
  const world = newWorld({ user: USER });
  world.api["GET /listings/search"] = () => [200, { matches: MATCHES, no_match: false,
    seeker_point: { lat: 53.8, lng: -1.55 }, region: "uk", region_unknown: false }];
  world.api["POST /seeker-requests"] = () => [200, { ok: true, request_id: 501, ref: "PS-0501" }];
  world.api["POST /seeker-requests/picks"] = (w, req) => [200, { ok: true,
    introductions: req.body.listing_ids.map((id, i) => ({ id: 900 + i, ref: `INTRO-090${i}`, stage: "proposed" })) }];
  const { context, page, errors } = await visit(world);
  await page.goto(`${PRINT}/find.html`);
  await page.waitForSelector("body[data-np-open]");
  await page.waitForSelector("#findForm");

  await step("a search shows the three the worker marked, not the fourth", async () => {
    await page.fill("#fMaterial", "PA12"); await page.press("#fMaterial", "Enter");
    await page.fill("#fQuantity", "200");
    await page.fill("#fMaxLead", "10");
    await page.click("#findSubmit");
    await page.waitForSelector("#step2:not([hidden]) #capGrid .cap");
    eq(await page.locator("#capGrid .cap").count(), 3, "cards");
    eq(await page.locator('#capGrid [data-card="listing-d"]').count(), 0, "the fourth card");
    const q = apiCalls(world, "GET /listings/search")[0].query;
    return eq([q.town, q.country, q.max_lead_time_days], ["Leeds", "United Kingdom", "10"], "the search's town, country and lead time");
  });
  await step("the map shows the seeker's town and one pin per town, two Leeds sites on one pin", async () => {
    await page.waitForSelector("#matchMap:not([hidden]) .leaflet-container, #matchMap.leaflet-container");
    const pins = await page.$$eval("#matchMap .np-pin", (els) => els.map((e) => ({ text: e.textContent.trim(), cls: e.className })));
    eq(pins.length, 3, "pins (You, Leeds, Bristol)");
    eq(pins.filter((p) => /np-pin--you/.test(p.cls)).map((p) => p.text), ["You"], "the seeker's pin");
    eq(pins.filter((p) => /np-pin--group/.test(p.cls)).map((p) => p.text), ["2"], "the Leeds pin shows how many");
    eq(pins.filter((p) => !/np-pin--(you|group)/.test(p.cls)).map((p) => p.text), ["3"], "Bristol's pin is Site 3");
    const titles = await page.$$eval("#matchMap .leaflet-marker-icon", (els) => els.map((e) => e.getAttribute("title")));
    has(titles.join(" | "), "2 sites in Leeds, United Kingdom", "the Leeds pin's name");
  });
  await step("the shared pin opens a short anonymous list, and Choose ticks that card", async () => {
    await page.click("#matchMap .np-pin--group");
    await page.waitForSelector("#matchMap .np-pop");
    const pop = await page.textContent("#matchMap .np-pop");
    has(pop, "2 sites in Leeds, United Kingdom", "the list's head");
    has(pop, "Site 2", "the second Leeds site");
    for (const leak of ["listing-", "HP MJF", "Ltd"]) if (pop.includes(leak)) throw new Error(`the list shows ${leak}`);
    eq(await page.locator("#matchMap .np-pop [data-choose]").count(), 2, "Choose buttons");
    await page.click('#matchMap .np-pop [data-choose="listing-b"]');
    eq(await page.isChecked("#pick-listing-b"), true, "card 2 ticked");
    eq(await page.locator("#matchMap .np-pin.is-on").count(), 1, "lit pins");
    return has(await page.textContent("#pickCount"), "Site 2 picked", "the bar");
  });
  await step("one pick only: ticking another card moves the pick", async () => {
    await page.click('#capGrid [data-card="listing-c"] .cap__tick');
    eq(await page.isChecked("#pick-listing-c"), true, "card 3 ticked");
    eq(await page.isChecked("#pick-listing-b"), false, "card 2 unticked");
    eq(await page.locator("#capGrid input[data-pick]:checked").count(), 1, "ticks");
    const lit = await page.$$eval("#matchMap .np-pin.is-on", (els) => els.map((e) => e.textContent.trim()));
    return eq(lit, ["3"], "the lit pin");
  });
  await step("the request goes with the one site picked", async () => {
    await page.click("#pickContinue");
    await page.waitForSelector("#introTick");
    has(await page.textContent("#pickSummary"), "Bristol", "the summary");
    await page.check("#introTick");
    await page.click("#requestSubmit");
    await page.waitForSelector("#step3Body .success");
    return eq(apiCalls(world, "POST /seeker-requests/picks")[0].body.listing_ids, ["listing-c"], "the picks sent");
  });
  await step("at phone width the map and the cards fit the screen", async () => {
    await page.setViewportSize({ width: 375, height: 740 });
    await page.waitForTimeout(150);
    const m = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth,
      map: Math.round(document.getElementById("matchMap").getBoundingClientRect().right) }));
    if (m.map > m.inner) throw new Error(`the map ends at ${m.map}px in a ${m.inner}px window`);
  });
  clean(world, errors, "the find map");
  await context.close();
}

async function walkAccount() {
  area = "The account page";
  const soon = new Date(Date.now() + 3 * 864e5).toISOString();
  const world = newWorld({
    user: USER,
    summary: Object.assign({}, EMPTY_SUMMARY, {
      org: { id: 41, name: "ZZ Walk Test Ltd", role: "owner", sub_status: "trial", founding: true, host_print: "approved", host_mill: "none", fee_exempt_note: null },
      site: { org_id: 41, name: "ZZ Walk Test Ltd", town: "Leeds", country: "United Kingdom", host_print: "approved", host_mill: "none",
        sub_status: "trial", founding: true, paused: false, removed: false, verified: true },
      introductions: [{ id: 7, ref: "INT-0007", hub: "print", stage: "awaiting_acceptance", seeker_request_id: 3, accepted_a_at: null,
        accepted_b_at: null, acceptance_expires_at: soon, declined_at: null, created_at: new Date().toISOString(), role: "provider",
        introduced_at: null, counterpart: null }],
      offers: [{ introduction_id: 7, ref: "INT-0007", hub: "print", acceptance_expires_at: soon,
        request: { material: "pa12_nylon12", process: "fdm_fff", quantity: 40, cadence: "one_off", town: "Bristol", country: "United Kingdom" } }],
      // Plan 052, item 4: PS-/MS- codes are the worker's and the desk's; the seeker sees INTRO- only.
      requests: [
        { id: 3, ref: "PS-0046", hub: "print", material: "pa12_nylon12", quantity: 500, cadence: "recurring", status: "picked",
          created_at: new Date().toISOString(), no_match: false,
          picks: [{ introduction_id: 8, ref: "INTRO-0008", stage: "proposed", card: { town: "Leeds", country: "United Kingdom", materials: ["pa12_nylon12"], services: ["finishing_dyeing"],
            machines: [{ name: "HP MJF 5200", materials: ["pa12_nylon12"], count: 2, lead_time_days: 5 }] } },
            { introduction_id: 9, ref: "INTRO-0009", stage: "introduced", card: { town: "Derby", country: "United Kingdom", materials: ["pa12_nylon12"] } },
            { introduction_id: 10, ref: "INTRO-0010", stage: "awaiting_acceptance", card: { town: "Hull", country: "United Kingdom", materials: ["pa12_nylon12"] } }] },
        { id: 4, ref: "MS-0047", hub: "mill", material: "pa12_nylon12", quantity: 200, cadence: "once", status: "open",
          created_at: new Date().toISOString(), no_match: false, picks: [] },
        // Plan 052, item 3: a hand-routed request still carries no_match; its pick must show.
        { id: 5, ref: "PS-0048", hub: "print", material: "pa12_nylon12", quantity: 60, cadence: "once", status: "open",
          created_at: new Date().toISOString(), no_match: true,
          picks: [{ introduction_id: 11, ref: "INTRO-0011", stage: "awaiting_acceptance", card: { town: "Exeter", country: "United Kingdom", materials: ["pa12_nylon12"] } }] },
      ],
      hubs_used: ["print"],
    }),
  });
  const { context, page, errors } = await visit(world);
  await page.goto(`${APEX}/hub/account/`);
  await step("the account page opens and reads one summary", async () => {
    await page.waitForSelector("body[data-np-open]");
    await page.waitForSelector("#profile:not([hidden])");
    has(await page.textContent("#profile"), "ZZ Walk Test Ltd", "the profile section");
    eq(apiCalls(world, "GET /account/summary").length, 1, "summary reads");
  });
  await step("a request is known by INTRO- once it has one, and the page never shows REQ- or the PS- code", async () => {
    await page.waitForSelector("#introductions:not([hidden])");
    const text = await page.textContent("#introductions");
    has(text, "INTRO-0008", "the introduced pick");
    for (const gone of ["REQ-", "PS-0046", "MS-0047"])
      if (text.includes(gone)) throw new Error(`the account page still shows ${gone}`);
  });
  await step("a request flagged no_match still shows the pick put forward by hand (plan 052, item 3)", async () => {
    await page.waitForSelector("#introductions:not([hidden])");
    const text = await page.textContent("#introductions");
    has(text, "INTRO-0011", "the hand-routed pick");
    if (text.includes("No match yet")) throw new Error("a request with a pick still says No match yet");
  });
  await step("facts lines read as English: no underscore in a request card or an offer line (plan 052, item 10)", async () => {
    await page.waitForSelector("#introductions:not([hidden])");
    const lines = await page.$$eval("#introductions .acct-card .hint, #introductions .acct-row__meta span", (els) => els.map((e) => e.textContent));
    const facts = lines.filter((t) => /Recurring|One off|Once|PA12/.test(t));
    if (facts.length < 3) throw new Error(`expected the facts lines to render, saw ${JSON.stringify(lines)}`);
    for (const t of lines) if (t.includes("_")) throw new Error(`a facts line shows a raw term: ${t}`);
    has(facts.join(" | "), "One off", "the offer's cadence");
  });
  await step("the picks block reads in words: labelled materials, services and machines, no underscore, no [object Object]", async () => {
    await page.waitForSelector("#introductions:not([hidden])");
    await page.evaluate(() => document.querySelectorAll("#introductions details").forEach((d) => { d.open = true; }));
    const block = await page.textContent("#introductions .acct-pick");
    for (const bad of ["_", "[object Object]"]) if (block.includes(bad)) throw new Error(`the picks block shows ${bad}: ${block}`);
    has(block, "HP MJF 5200", "the machine name");
    has(block, "PA12", "the labelled material");
    has(block, "Services", "the services row");
  });
  await step("the progress bar has four steps, filled when done, ringed when waited on, green once introduced, the same for both sides (plan 052, items 12-14)", async () => {
    await page.waitForSelector("#introductions:not([hidden])");
    const chains = await page.$$eval("#introductions .status-chain", (ols) => ols.map((ol) => ({
      labels: [...ol.children].map((li) => li.textContent),
      classes: [...ol.children].map((li) => li.className.trim()),
      inDetails: !!ol.closest("details") })));
    const want = ["Requested", "Approved by NexPoint", "Awaiting provider", "Introduced"];
    if (chains.length !== 5) throw new Error(`expected 5 chains, saw ${chains.length}`);
    for (const c of chains) {
      eq(JSON.stringify(c.labels), JSON.stringify(want), "the step labels");
      eq(c.inDetails, false, "the chain is collapsed");
    }
    const by = (cls) => chains.filter((c) => JSON.stringify(c.classes) === JSON.stringify(cls));
    // proposed (seeker), awaiting_acceptance (seeker pick and provider row), introduced (seeker)
    eq(by(["is-done", "is-current", "", ""]).length, 1, "a proposed chain");
    eq(by(["is-done", "is-done", "is-current", ""]).length, 3, "the awaiting_acceptance chains, seeker and provider alike, and the hand-routed pick");
    eq(by(["is-done", "is-done", "is-done", "is-done is-green"]).length, 1, "the introduced chain");
    const text = await page.textContent("#introductions");
    for (const gone of ["In progress", "Accepted"]) if (text.includes(gone)) throw new Error(`the page still says ${gone}`);
  });
  await step("an offer waiting on the provider shows, with a way to have it sent again", async () => {
    await page.waitForSelector("#introductions:not([hidden])");
    has(await page.textContent("#introductions"), "INT-0007", "the introductions section");
    return (await page.locator('[data-act="intro-resend"][data-intro="7"]').count()) === 1;
  });
  await step("a resend the email provider refused says so, and gives the button back", async () => {
    world.api["POST /introductions/:id/resend"] = () => [502, { error: "send_failed" }];
    await page.click('[data-act="intro-resend"][data-intro="7"]');
    await page.waitForSelector("#introMsg-7:not([hidden])");
    has(await page.textContent("#introMsg-7"), "We could not send that just now.", "the message");
    eq(await page.isDisabled('[data-act="intro-resend"][data-intro="7"]'), false, "the button is disabled");
  });
  await step("a resend that worked says Sent again", async () => {
    world.api["POST /introductions/:id/resend"] = () => [200, { ok: true }];
    await page.click('[data-act="intro-resend"][data-intro="7"]');
    await page.waitForFunction(() => /Sent again/.test(document.getElementById("introMsg-7").textContent));
    eq(apiCalls(world, "POST /introductions/7/resend").length, 2, "resends sent");
  });
  clean(world, errors, "the account page");
  await context.close();

  area = "The account page (a closed introduction and a slow vocabulary)";
  {
    const closed = (id, ref, stage, role) => ({ id, ref, hub: "print", stage, seeker_request_id: 3, accepted_a_at: null, accepted_b_at: null,
      acceptance_expires_at: null, declined_at: null, created_at: new Date().toISOString(), role, introduced_at: null, counterpart: null });
    const world = newWorld({
      user: USER,
      hang: new Set(["GET /vocab", "GET /attributes"]),
      summary: Object.assign({}, EMPTY_SUMMARY, {
        org: { id: 41, name: "ZZ Walk Test Ltd", role: "owner", sub_status: "trial", founding: true, host_print: "approved", host_mill: "none", fee_exempt_note: null },
        site: { org_id: 41, name: "ZZ Walk Test Ltd", town: "Leeds", country: "United Kingdom", host_print: "approved", host_mill: "none",
          sub_status: "trial", founding: true, paused: false, removed: false, verified: true },
        introductions: [closed(21, "INT-0021", "dead", "provider"), closed(22, "INT-0022", "mystery_stage", "provider")],
        requests: [{ id: 3, ref: "PS-0050", hub: "print", material: "pa12_nylon12", quantity: 10, cadence: "once", status: "picked",
          created_at: new Date().toISOString(), no_match: false,
          picks: [{ introduction_id: 23, ref: "INTRO-0023", stage: "dead", card: { town: "Leeds", country: "United Kingdom", materials: ["pa12_nylon12"] } }] }],
        hubs_used: ["print"],
      }),
    });
    const { context, page, errors } = await visit(world);
    const t0 = Date.now();
    await page.goto(`${APEX}/hub/account/`);
    await step("with the vocabulary never answering, the account page still draws within a few seconds", async () => {
      await page.waitForSelector("#introductions .acct-card", { timeout: 6000 });
      const ms = Date.now() - t0;
      if (ms > 6000) throw new Error(`the page took ${ms} ms to draw`);
      has(await page.textContent("#introductions"), "INTRO-0023", "the request card");
      eq(apiCalls(world, "GET /vocab").filter((c) => c.query.hub === "mill").length, 0, "Mill vocabulary reads by a Print-only account");
    });
    await step("a closed introduction reads Closed: three steps done, the last a stop step, never Introduced (plan 052 review)", async () => {
      const chains = await page.$$eval("#introductions .status-chain", (ols) => ols.map((ol) => ({
        labels: [...ol.children].map((li) => li.textContent), classes: [...ol.children].map((li) => li.className.trim()) })));
      const closedChains = chains.filter((c) => c.labels[3] === "Closed");
      eq(closedChains.length, 2, "the closed chains (a provider row and a seeker pick)");
      for (const c of closedChains) eq(JSON.stringify(c.classes), JSON.stringify(["is-done", "is-done", "is-done", "is-stop"]), "a closed chain's classes");
      const rows = await page.$$eval("#introductions .acct-row__meta", (els) => els.map((e) => ({ ref: e.querySelector("b").textContent, line: e.querySelector(":scope > span").textContent })));
      const line = (ref) => (rows.find((r) => r.ref.includes(ref)) || { line: null }).line;
      eq(line("INT-0021"), "Closed.", "the closed provider row");
      eq(line("INT-0022"), "", "an unknown stage's line");
    });
    clean(world, errors, "the closed-introduction page");
    await context.close();
  }

  area = "The account page (an account that has done nothing yet)";
  {
    const world = newWorld({ user: USER, summary: Object.assign({}, EMPTY_SUMMARY) });
    const { context, page, errors } = await visit(world);
    await page.goto(`${APEX}/hub/account/`);
    await step("the page opens with Go to the Global Hub under the title, and no More of the network", async () => {
      await page.waitForSelector("body[data-np-open]");
      await page.waitForSelector("#profile:not([hidden])");
      has(await page.textContent("#goHub"), "Go to the Global Hub", "the button");
      eq(new URL(await page.getAttribute("#goHub", "href"), page.url()).pathname, "/hub/index.html", "where it goes");
      eq(await page.locator("#more").count(), 0, "More of the network sections");
      eq(apiCalls(world, "GET /opportunities/briefs").length, 0, "briefs reads");
    });
    await step("its one to-do line is Choose a hub, and it leaves the page for the door (plan 046)", async () => {
      await page.waitForSelector("#acctNeeds:not([hidden])");
      has(await page.textContent("#acctNeeds"), "Choose a hub", "the to-do block");
      const links = await page.locator("#acctNeeds a").all();
      eq(links.length, 1, "to-do lines");
      eq(new URL(await links[0].getAttribute("href"), page.url()).pathname, "/hub/index.html", "where the line goes");
      return has(await links[0].textContent(), "arrow_forward", "the trailing arrow");
    });
    await step("the needs block is headed Next step, sits in the head level with the Go button, and reads large and bold (plan 052)", async () => {
      has(await page.textContent("#acctNeeds h2"), "Next step", "the heading");
      eq(await page.locator(".acct-head #acctNeeds").count(), 1, "the block is inside .acct-head");
      const blockTop = (await page.locator("#acctNeeds").boundingBox()).y;
      const btnTop = (await page.locator("#goHub").boundingBox()).y;
      if (Math.abs(blockTop - btnTop) > 8) throw new Error(`block top ${blockTop} is not level with the button top ${btnTop}`);
      const f = await page.$eval("#acctNeeds h2", (el) => { const c = getComputedStyle(el); return { size: parseFloat(c.fontSize), weight: parseInt(c.fontWeight, 10) }; });
      if (f.size < 18 || f.weight < 700) throw new Error(`heading is ${f.size}px at weight ${f.weight}`);
    });
    clean(world, errors, "the new account's page");
    await context.close();
  }
}

/* Plan 052 wave 2: a provider answers an introduction on its account page
   (items 21, 22), through the session routes the worker already has, and an
   introduced row says the introduction is in the inbox rather than showing
   the other side's details (item 26). */
async function walkAccountAnswers() {
  area = "The account page (answering an introduction)";
  const soon = new Date(Date.now() + 3 * 864e5).toISOString();
  const intro = (id, over) => Object.assign({ id, ref: `INTRO-000${id}`, hub: "print", stage: "awaiting_acceptance",
    seeker_request_id: id, accepted_a_at: null, accepted_b_at: "2026-10-08T09:00:00Z", acceptance_expires_at: soon,
    declined_at: null, created_at: "2026-10-08T09:00:00Z", role: "provider", introduced_at: null }, over);
  const offer = (id) => ({ introduction_id: id, ref: `INTRO-000${id}`, hub: "print", acceptance_expires_at: soon,
    request: { material: "pa12_nylon12", quantity: 40, town: "Bristol", country: "United Kingdom" } });
  const summary = (intros, offers) => Object.assign({}, EMPTY_SUMMARY, {
    org: { id: 41, name: "ZZ Walk Test Ltd", role: "owner", sub_status: "trial", founding: true, host_print: "approved", host_mill: "none", fee_exempt_note: null },
    site: { org_id: 41, name: "ZZ Walk Test Ltd", town: "Leeds", country: "United Kingdom", host_print: "approved", host_mill: "none",
      sub_status: "trial", founding: true, paused: false, removed: false, verified: true },
    introductions: intros, offers, hubs_used: ["print"],
  });
  const world = newWorld({
    user: USER,
    summary: summary([intro(7), intro(9), intro(8, { stage: "introduced", accepted_a_at: "2026-10-07T10:00:00Z",
      introduced_at: "2026-10-07T10:00:00Z", acceptance_expires_at: null })], [offer(7), offer(9)]),
  });
  world.api["POST /introductions/accept"] = (w) => {
    w.summary = summary([intro(7, { stage: "introduced", accepted_a_at: "2026-10-08T12:00:00Z",
      introduced_at: "2026-10-08T12:00:00Z" }), intro(9)], [offer(9)]);
    return [200, { ok: true, stage: "introduced", ref: "INTRO-0007" }];
  };
  world.api["POST /introductions/decline"] = () => [200, { ok: true, stage: "declined", ref: "INTRO-0009" }];
  const { context, page, errors } = await visit(world);
  await page.goto(`${APEX}/hub/account/`);

  await step("an open offer shows Accept and Decline, and no longer says to answer from the email", async () => {
    await page.waitForSelector("#introductions:not([hidden])");
    eq(await page.locator('[data-act="intro-accept-open"][data-intro="7"]').count(), 1, "accept buttons for 7");
    eq(await page.locator('[data-act="intro-decline-open"][data-intro="7"]').count(), 1, "decline buttons for 7");
    eq(await page.locator('[data-act="intro-accept-open"][data-intro="8"]').count(), 0, "accept buttons on an introduced row");
    eq((await page.textContent("#introductions")).includes("Answer from the email"), false, "the old line");
  });
  await step("an introduced row says the introduction is in the inbox, with its INTRO ref, and no address", async () => {
    const text = await page.textContent("#introductions");
    has(text, "The introduction is in your inbox", "the inbox line");
    has(text, "INTRO-0008", "the ref");
    eq(/@/.test(text.replace(/introductions@nexpoint\.co\.uk/g, "")), false, "an email address on the page");
    eq(await page.locator("#introductions a[href^='mailto:']").count(), 0, "mail links");
  });
  await step("Accept opens the introduction terms with an unticked box; accepting unticked asks for the tick", async () => {
    await page.click('[data-act="intro-accept-open"][data-intro="7"]');
    await page.waitForSelector("#introAnswer-7 .terms-scroll");
    has(await page.textContent("#introAnswer-7"), "I accept the introduction terms, version 1.0", "the tick's label");
    eq(await page.isChecked("#introTick-7"), false, "the tick");
    eq(apiCalls(world, "GET /terms/current").at(-1).query.layer, "introduction", "the terms layer read");
    await page.click('[data-act="intro-accept-send"][data-intro="7"]');
    await page.waitForSelector("#introMsg-7:not([hidden])");
    has(await page.textContent("#introMsg-7"), "tick to accept", "the message");
    eq(apiCalls(world, "POST /introductions/accept").length, 0, "accepts sent unticked");
  });
  await step("ticked, Accept posts the introduction and the terms version, and the row re-renders as introduced", async () => {
    await page.check("#introTick-7");
    await page.click('[data-act="intro-accept-send"][data-intro="7"]');
    await until(() => apiCalls(world, "POST /introductions/accept").length === 1, "the accept post");
    eq(apiCalls(world, "POST /introductions/accept")[0].body, { introduction_id: 7, terms_version_id: 12 }, "the body");
    await page.waitForFunction(() => document.querySelectorAll('[data-act="intro-accept-open"][data-intro="7"]').length === 0, null, { timeout: 5000 });
    has(await page.textContent("#introductions"), "The introduction is in your inbox", "the inbox line after accepting");
  });
  await step("Decline opens a reason box; sending it posts the introduction and the reason", async () => {
    await page.click('[data-act="intro-decline-open"][data-intro="9"]');
    await page.waitForSelector("#introDecline-9:not([hidden])");
    await page.fill("#introReason-9", "No capacity that month");
    await page.click('[data-act="intro-decline-send"][data-intro="9"]');
    await until(() => apiCalls(world, "POST /introductions/decline").length === 1, "the decline post");
    eq(apiCalls(world, "POST /introductions/decline")[0].body, { introduction_id: 9, reason: "No capacity that month" }, "the body");
  });
  clean(world, errors, "answering on the account page");
  await context.close();
}

async function walkHomepage() {
  area = "The homepage";
  const world = newWorld();
  const { context, page, errors } = await visit(world);
  await page.goto(`${APEX}/`);
  await page.waitForSelector("#bookForm");
  await step("the intro-call form asks for a name and a work email before it sends", async () => {
    await page.click("#confirmBtn");
    await page.waitForSelector("#bookForm .form-error");
    has(await page.textContent("#bookForm .form-error"), "Add your name and a work email", "the prompt");
    eq(apiCalls(world, "POST /requests").length, 0, "requests sent");
  });
  await step("a complete form sends one request and one copy, and says thanks", async () => {
    await page.fill("#f-name", "Walk Tester"); await page.fill("#f-email", "walk@example.com");
    await page.fill("#f-company", "ZZ Walk Test Ltd"); await page.fill("#f-notes", "The scripted walk. Please ignore.");
    await page.click("#confirmBtn");
    await page.waitForSelector(".confirmed");
    has(await page.textContent(".confirmed"), "Thanks, message received.", "the confirmation");
    const sent = apiCalls(world, "POST /requests");
    eq(sent.length, 1, "requests sent");
    const b = sent[0].body;
    eq([b.hub, b.side, b.contact_name, b.email, b.company, b.payload.source, b.company_url],
      ["opportunities", "request_intro", "Walk Tester", "walk@example.com", "ZZ Walk Test Ltd", "homepage intro call", ""], "the request body");
    eq(world.copies.length, 1, "copies sent");
  });
  clean(world, errors, "the homepage");
  await context.close();

  const bot = newWorld();
  const second = await visit(bot);
  await second.page.goto(`${APEX}/`);
  await second.page.waitForSelector("#bookForm");
  await step("a filled trap field reaches the worker, and no copy is sent", async () => {
    const p = second.page;
    await p.fill("#f-name", "Bot"); await p.fill("#f-email", "bot@example.com");
    await p.locator('#bookForm [name="company_url"]').evaluate((n) => { n.value = "https://spam.example"; });
    await p.click("#confirmBtn");
    await p.waitForSelector(".confirmed");
    eq(apiCalls(bot, "POST /requests")[0].body.company_url, "https://spam.example", "the posted trap value");
    eq(bot.copies.length, 0, "copies sent");
  });
  await second.context.close();
}

async function walkLandings() {
  area = "Link landings and the legal pages";
  {
    const world = newWorld();
    const { context, page, errors } = await visit(world);
    const back = `${PRINT}/find.html`;
    await step("a confirmation link confirms, and offers the way back to where they were", async () => {
      await page.goto(`${APEX}/hub/confirm.html?t=walk-token&type=signup&return=${encodeURIComponent(back)}`);
      await page.waitForSelector("text=You're confirmed.");
      eq(apiCalls(world, "POST /auth/confirm").map((c) => c.body), [{ token_hash: "walk-token", type: "signup" }], "confirmations sent");
      eq(await page.getAttribute("a.btn.yes", "href"), back, "the way back");
    });
    clean(world, errors, "the confirmation page");
    await context.close();
  }
  {
    const world = newWorld();
    const { context, page } = await visit(world);
    await step("a confirmation link with a return address on localhost offers the account page only", async () => {
      await page.goto(`${APEX}/hub/confirm.html?t=walk-token&type=signup&return=${encodeURIComponent("http://localhost:8080/anything")}`);
      await page.waitForSelector("text=You're confirmed.");
      eq(await page.locator('a[href*="localhost"]').count(), 0, "links to localhost");
    });
    await context.close();
  }
  {
    const world = newWorld();
    const { context, page, errors } = await visit(world);
    await step("the terms page joins a wrapped paragraph, a wrapped aside and a wrapped list item", async () => {
      await page.goto(`${APEX}/hub/terms/`);
      await page.waitForSelector("#termsBody p");
      const got = await page.evaluate((read) => new Function("root", read)(document.getElementById("termsBody")), `return (${readRendered.toString()})(root);`);
      eq(got, WRAPPED_HTML, "the rendered terms");
      has(await page.textContent("#termsMeta"), "Version 1.0", "the meta line");
    });
    clean(world, errors, "the terms page");
    await context.close();
  }
  {
    const world = newWorld({ user: USER });
    const { context, page, errors } = await visit(world);
    await step("the shared reader on the hub pages joins wrapped lines the same way", async () => {
      await page.goto(`${APEX}/hub/`);
      await page.waitForFunction(() => window.NP && typeof NP.markdownLite === "function");
      const got = await page.evaluate(([md, read]) => {
        const root = document.createElement("div");
        root.innerHTML = NP.markdownLite(md);
        return new Function("root", read)(root);
      }, [WRAPPED_TERMS, `return (${readRendered.toString()})(root);`]);
      eq(got, WRAPPED_HTML, "the shared reader's output");
    });
    clean(world, errors, "the shared reader");
    await context.close();
  }
  for (const [name, url, sign] of [
    ["the privacy page", `${APEX}/hub/privacy.html`, "hosted in the UK"],
    ["the reset page", `${APEX}/hub/reset.html`, ""],
    ["the old portal address", `${APEX}/portal/`, ""],
  ]) {
    const world = newWorld();
    const { context, page, errors } = await visit(world);
    await step(`${name} opens`, async () => {
      await page.goto(url);
      await settled(page);
      if (name === "the old portal address") await page.waitForURL((u) => u.pathname === "/hub/");
      if (sign) await page.waitForSelector(`text=${sign}`);
    });
    clean(world, errors, name);
    await context.close();
  }
}

// ================================================================ the admin boards
const boards = () => readdirSync(ADMIN_DIR).filter((f) => f.endsWith(".html")).sort();

async function walkAdminDoor() {
  area = "The admin door (password, then the second factor)";
  const world = newWorld();
  const { context, page, errors } = await visit(world);
  await page.goto(`${APEX}/admin/health.html`);
  await step("a board shows only its sign-in card to a stranger, and reads no table", async () => {
    await page.waitForSelector("#login", { state: "visible" });
    eq(await page.isVisible("#admin"), false, "the board is showing");
    eq(world.reads.length, 0, "table reads before sign-in");
  });
  await step("a wrong password is refused in the card", async () => {
    await page.fill("#email", ADMIN_EMAIL); await page.fill("#pw", "wrong-password");
    await page.click("#login button[type=submit]");
    await page.waitForFunction(() => document.getElementById("loginErr").textContent.trim() !== "");
    has(await page.textContent("#loginErr"), "Invalid login credentials", "the refusal");
    eq(await page.isVisible("#admin"), false, "the board is showing");
  });
  await step("the right password asks for the six-digit code, and still shows no board", async () => {
    await page.fill("#pw", PASSWORD);
    await page.click("#login button[type=submit]");
    await page.waitForSelector("#nxMfaCode");
    has(await page.textContent("#nxMfa"), "six-digit code", "the prompt");
    eq(await page.isVisible("#admin"), false, "the board is showing");
    eq(world.reads.length, 0, "table reads before the code");
  });
  await step("a wrong code is refused, and the right one opens the board", async () => {
    await page.fill("#nxMfaCode", "000000");
    await page.click("#nxMfaForm button[type=submit]");
    await page.waitForFunction(() => document.getElementById("nxMfaErr").textContent.trim() !== "");
    eq(await page.isVisible("#admin"), false, "the board is showing");
    await page.fill("#nxMfaCode", MFA_CODE);
    await page.click("#nxMfaForm button[type=submit]");
    await page.waitForSelector("#admin", { state: "visible" });
    has(await page.textContent("#who"), ADMIN_EMAIL, "who is signed in");
    if (world.reads.length === 0) throw new Error("the board opened and read nothing");
  });
  clean(world, errors, "the admin door");
  await context.close();
}

async function walkBoards() {
  area = `Every admin board (${ADMIN_DIR === join(ROOT, "admin") ? "this repo's deploy copy" : ADMIN_DIR})`;
  for (const file of boards()) {
    const world = newWorld();
    const { context, page, errors } = await visit(world, { seedAdmin: true });
    await step(`${file} opens for a signed-in operator and reads its tables`, async () => {
      await page.goto(`${APEX}/admin/${file}`);
      await page.waitForSelector("#admin", { state: "visible" });
      eq(await page.isVisible("#login"), false, "the sign-in card is showing");
      /* The briefs board names its operator in #whoami; the rest use #who. */
      has(await page.textContent("#who, #whoami"), ADMIN_EMAIL, "who is signed in");
      await settled(page);
      if (world.reads.length === 0) throw new Error("the board read nothing");
    });
    await step(`${file} wrote nothing just by opening`, async () => eq(world.writes, [], "writes on load"));
    clean(world, errors, file);
    await context.close();
  }

  area = "Board buttons write to the stub, never the database";
  {
    const world = newWorld({ dialogAnswer: "the scripted walk" });
    world.rows.engine_lead_queue = [{
      id: 501, company: "zz-walk-test", display_name: "ZZ Walk Test Ltd", category: "provider", matched_json: [], reasoning: "walk",
      judge_reason: "walk", website: "https://example.com", quality: "B", judged: true, judge_confidence: 0.9,
      proposed_at: "2026-10-01T09:00:00Z", decided_at: null, decided_by: null, decision_note: null, status: "pending",
      prospect_type: "provider", recommended_campaign_id: null, campaign_id: null, source: "walk", list_overlap: null,
    }];
    const { context, page, errors } = await visit(world, { seedAdmin: true });
    await page.goto(`${APEX}/admin/leads.html`);
    await step("the Leads board shows the waiting company", async () => {
      await page.waitForSelector("#admin", { state: "visible" });
      await page.waitForSelector("text=ZZ Walk Test Ltd");
    });
    await step("Reject raises one intent, with the reason, and touches no other table", async () => {
      await page.click('button[onclick^="reject("]');
      await page.waitForFunction(() => /queued for the engine/.test(document.body.textContent));
      eq(world.writes.length, 1, "writes");
      const w = world.writes[0];
      const row = Array.isArray(w.body) ? w.body[0] : w.body;
      eq([w.method, w.table, row.type, row.payload_json.queue_row, row.payload_json.reason, row.requested_by],
        ["POST", "engine_intents", "reject-lead", 501, "the scripted walk", ADMIN_EMAIL], "the intent");
    });
    clean(world, errors, "the Leads board");
    await context.close();
  }
  {
    const world = newWorld();
    const { context, page, errors } = await visit(world, { seedAdmin: true });
    await page.goto(`${APEX}/admin/finder.html`);
    await step("the Finder's draft request raises one intent for the deal folder", async () => {
      await page.waitForSelector("#admin", { state: "visible" });
      await page.fill("#deal-slug", "zz-walk-test");
      await page.fill("#deal-title", "The scripted walk");
      await page.click('button:has-text("draft"), button:has-text("Draft")');
      await page.waitForFunction(() => /queued|requested/i.test(document.getElementById("deal-status").textContent));
      eq(world.writes.length, 1, "writes");
      const w = world.writes[0];
      const row = Array.isArray(w.body) ? w.body[0] : w.body;
      eq([w.table, row.type, row.payload_json.deal_slug, row.payload_json.draft, row.payload_json.active],
        ["engine_intents", "set-opportunity", "zz-walk-test", true, false], "the intent");
    });
    clean(world, errors, "the Finder board");
    await context.close();
  }
}

/* What the code review of 4 October 2026 changed on the boards,
   walked in a browser. This repo's admin/ is a deploy copy, so until the
   admin sync that carries them has merged the walk says so and moves on;
   WALK_ADMIN_DIR pointed at the engine's app/ walks them before the sync. */
const notes = [];
const REVIEWED = /failedSince/.test(readFileSync(join(ADMIN_DIR, "health.html"), "utf8"));
const SAME_NAME = /function sameName\(/.test(readFileSync(join(ADMIN_DIR, "organisations.html"), "utf8"));
const ago = (hours) => new Date(Date.now() - hours * 36e5).toISOString();


/* Plan 050 (record B6): two sites with one company name are told apart on the
   Organisations board by the town, read off the site's listing revision, and
   only while another row in the same list shares the name. */
async function walkOrganisationsNames() {
  area = "The Organisations board with two sites of one name";
  if (!SAME_NAME) {
    notes.push("The Organisations board in this copy predates plan 050's same-name town, so its check was not run. " +
      "It arrives with the admin sync; WALK_ADMIN_DIR=<engine>/app walks it now.");
    return;
  }
  const world = newWorld();
  world.rows.organisations = [
    { id: "org-a", name: "Bob Lab", domain: "boblab.example", sub_status: "active", sub_rate_gbp: 1000, sub_period: "annual", host_print: "live" },
    { id: "org-b", name: "Bob Lab", domain: null, sub_status: "none" },
    { id: "org-c", name: "Crux Orthotics", domain: "crux.example", sub_status: "none" },
    { id: "org-d", name: "Bob Lab", domain: null, sub_status: "none", removed_at: ago(30), removed_by: ADMIN_EMAIL, removed_reason: "the walk's test host" },
  ];
  world.rows.listings = [
    { id: "l-a", org_id: "org-a", hub: "print", status: "live", live_revision_id: 1 },
    { id: "l-b", org_id: "org-b", hub: "print", status: "pending", live_revision_id: null },
    { id: "l-d", org_id: "org-d", hub: "print", status: "live", live_revision_id: 3 },
  ];
  world.rows.listing_revisions = [
    { id: 1, listing_id: "l-a", town: "Bromsgrove" },
    { id: 2, listing_id: "l-b", town: "Leeds" },
    { id: 3, listing_id: "l-d", town: "Derby" },
  ];
  const { context, page, errors } = await visit(world, { seedAdmin: true });
  await page.goto(`${APEX}/admin/organisations.html`);
  /* The first line of a name cell: the name, and the town when it is shown. */
  const firstLines = (sel) => page.$$eval(sel, (tds) => tds.map((td) => {
    const d = document.createElement("div"); d.innerHTML = td.innerHTML.split("<br>")[0];
    return d.textContent.replace(/\s+/g, " ").trim();
  }));
  await step("Organisations: two working rows of one name carry their towns, and a lone name stays plain", async () => {
    await page.waitForSelector("#admin", { state: "visible" });
    await page.waitForSelector("#orgRows tr");
    await settled(page);
    /* Sorted: the stub hands rows back as seeded, but the two namesakes have no order of their own. */
    eq((await firstLines("#orgRows tr td:first-child")).sort(), ["Bob Lab · Bromsgrove", "Bob Lab · Leeds", "Crux Orthotics"], "the working list's names");
  });
  await step("Organisations: a removed namesake alone in the archive reads plain", async () => {
    eq(await firstLines("#archiveRows tr td:first-child"), ["Bob Lab"], "the archive's names");
  });
  await step("Organisations: the board read the revisions and wrote nothing", async () => {
    eq(world.reads.some((r) => r.table === "listing_revisions"), true, "a listing_revisions read");
    eq(world.writes, [], "writes on load");
  });
  clean(world, errors, "the Organisations board");
  await context.close();
}

async function walkReviewedBoards() {
  area = "The boards after the code review of 4 October";
  if (!REVIEWED) {
    notes.push("The boards in this copy predate the code review's fixes, so the checks for them were not run. " +
      "They arrive with the admin sync; WALK_ADMIN_DIR=<engine>/app walks them now.");
    return;
  }
  {
    const world = newWorld();
    world.rows.engine_health = [{ id: 1, generated_at: ago(3), ok: true, problems: [], warnings: [], jobs: [
      { job: "hub-sync", state: "ok", detail: "last run fine", last_run_id: "run-0002" },
      { job: "intent-drain", state: "ok", detail: "last run fine", last_run_id: "run-0001" }] }];
    world.rows.engine_runs = [
      { id: "run-0009", job: "intent-drain", status: "failed", started_at: ago(1), ended_at: ago(1) },
      { id: "run-0002", job: "hub-sync", status: "succeeded", started_at: ago(4), ended_at: ago(4) }];
    const { context, page, errors } = await visit(world, { seedAdmin: true });
    await page.goto(`${APEX}/admin/health.html`);
    await step("Health: a job that failed after the morning report turns the board red and is named", async () => {
      await page.waitForFunction(() => /needs attention/.test(document.getElementById("verdict").textContent));
      has(await page.textContent("#findings"), "intent-drain failed since the morning report", "the findings");
    });
    await step("Health: that job's row says failed, and the other still says ok", async () => {
      const rows = await page.$$eval("#jobs tbody tr", (trs) => trs.map((tr) => [...tr.cells].slice(0, 2).map((c) => c.textContent.trim())));
      eq(rows, [["hub-sync", "ok"], ["intent-drain", "failed"]], "the job table");
    });
    clean(world, errors, "the Health board");
    await context.close();
  }
  {
    const world = newWorld();
    world.rows.campaigns = [
      { id: 3101, name: "ZZ Walk warm", status: "ACTIVE", sent: 0, opened: 0, replied: 0, bounced: 0, synced_at: ago(1) },
      { id: 3102, name: "ZZ Walk cold", status: "PAUSED", sent: 0, opened: 0, replied: 0, bounced: 0, synced_at: ago(1) }];
    world.rows.nx_campaigns = [{ id: 1, name: "ZZ Walk campaign", opportunity_id: "opp-1", active: true }];
    world.rows.nx_campaign_versions = [{ id: 11, campaign_id: 1, version: "current", smartlead_campaign_id: 3101, will_approved_at: null, chris_approved_at: null }];
    world.rows.opportunities = [{ id: "opp-1", title: "ZZ Walk opportunity", active: true }];
    world.rows.engine_intents = [
      { id: 902, type: "link-campaign-version", payload_json: { campaign_id: 1, version: "former", smartlead_campaign_id: 3102 }, status: "pending", result_note: null },
      { id: 901, type: "approve-template", payload_json: { version_id: 11 }, status: "failed", result_note: "the template has no opt-out line" }];
    const { context, page, errors } = await visit(world, { seedAdmin: true });
    await page.goto(`${APEX}/admin/campaigns.html`);
    const pick = (v) => `select[data-camp="1"][data-version="${v}"]`;
    await step("Campaigns: a refused approval shows the engine's reason, and Approve is still offered", async () => {
      await page.waitForSelector("text=ZZ Walk campaign");
      has(await page.textContent("#admin"), "Approval failed: the template has no opt-out line", "the board");
      eq(await page.locator('button[onclick^="approve("]').count(), 1, "Approve buttons");
    });
    await step("Campaigns: a queued link says so, and its dropdown is not live", async () => {
      has(await page.textContent("#admin"), "Link queued", "the board");
      eq(await page.isDisabled(pick("former")), true, "the queued dropdown is disabled");
      eq(await page.isDisabled(pick("enquired")), false, "an untouched dropdown is disabled");
    });
    await step("Campaigns: changing a link asks first, and No writes nothing and puts the dropdown back", async () => {
      world.dialog = "dismiss";
      await page.selectOption(pick("enquired"), "3102");
      await page.waitForFunction((sel) => document.querySelector(sel).value === "", pick("enquired"));
      has((world.dialogs || []).join(" "), "ZZ Walk cold", "the question asked");
      eq(world.writes, [], "writes");
    });
    await step("Campaigns: Yes raises one intent for that version", async () => {
      world.dialog = "accept";
      await page.selectOption(pick("enquired"), "3102");
      await until(() => world.writes.length === 1, "one write");
      const row = [].concat(world.writes[0].body)[0];
      eq([world.writes[0].table, row.type, row.payload_json.campaign_id, row.payload_json.version, Number(row.payload_json.smartlead_campaign_id)],
        ["engine_intents", "link-campaign-version", 1, "enquired", 3102], "the intent");
    });
    clean(world, errors, "the Campaigns board");
    await context.close();
  }
  {
    const world = newWorld();
    world.rows.engine_lead_queue = [{
      id: 502, company: "zz-walk-blocked", display_name: "ZZ Walk Blocked Ltd", category: "provider", matched_json: [], reasoning: "walk",
      judge_reason: "walk", website: "https://example.com", quality: "C", judged: true, judge_confidence: 0.9,
      proposed_at: ago(72), decided_at: ago(48), decided_by: ADMIN_EMAIL, decision_note: "walk", status: "blocked",
      prospect_type: "provider", recommended_campaign_id: null, campaign_id: null, source: "walk", list_overlap: null }];
    world.rows.engine_intents = [{ id: 950, type: "unblock-lead", payload_json: { queue_row: 502 }, status: "failed", result_note: "the row has moved" }];
    const { context, page, errors } = await visit(world, { seedAdmin: true });
    await page.goto(`${APEX}/admin/leads.html`);
    await step("Leads: an unblock the engine refused says why, beside the button", async () => {
      await page.waitForSelector("#admin", { state: "visible" });
      await page.click('[data-tab="rejected"]');
      await page.waitForSelector("text=ZZ Walk Blocked Ltd");
      has(await page.textContent("#act-502"), "Engine could not action this: the row has moved", "the card");
      eq(await page.locator('#act-502 button[onclick^="unblock("]').count(), 1, "Unblock buttons");
    });
    clean(world, errors, "the Leads board");
    await context.close();
  }
  {
    const world = newWorld({ factors: [] });
    const { context, page, errors } = await visit(world);
    await page.goto(`${APEX}/admin/health.html`);
    await step("Second factor: backing out of the set-up returns to the sign-in card, and no table is read", async () => {
      await page.fill("#email", ADMIN_EMAIL); await page.fill("#pw", PASSWORD);
      await page.click("#login button[type=submit]");
      await page.waitForSelector("#nxMfaCancel");
      has(await page.textContent("#nxMfa"), "Set up your second factor", "the panel");
      eq((await page.textContent("#nxMfaCancel")).trim(), "Cancel", "the way out");
      await page.click("#nxMfaCancel");
      await page.waitForSelector("#login form", { state: "visible" });
      eq(await page.isVisible("#admin"), false, "the board is showing");
      eq(world.reads.length, 0, "table reads");
    });
    clean(world, errors, "the second-factor set-up");
    await context.close();
  }
}

// ================================================================ run
function findBrowser() {
  const tries = [process.env.WALK_BROWSER,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  const cache = join(homedir(), "Library", "Caches", "ms-playwright");
  if (existsSync(cache)) for (const d of readdirSync(cache).filter((n) => n.startsWith("chromium_headless_shell-")).sort().reverse()) {
    tries.push(join(cache, d, "chrome-headless-shell-mac-arm64", "chrome-headless-shell"));
  }
  return tries.find((p) => p && existsSync(p));
}

const exe = findBrowser();
if (!exe) { console.error("walk: no browser found. Set WALK_BROWSER to a Chrome or Chromium binary."); process.exit(2); }
browser = await chromium.launch({ executablePath: exe, headless: true });
const started = Date.now();
/* A part that cannot get going (the page it starts on is broken) is one
   failed check with the reason, and the parts after it still run. */
const parts = []
  .concat(ONLY !== "boards" ? [walkDoor, walkRegister, walkWall, walkDoorReturn, walkSignedIn, walkFindMap, walkAccount, walkAccountAnswers, walkHomepage, walkLandings] : [])
  .concat(ONLY !== "public" ? [walkAdminDoor, walkBoards, walkReviewedBoards, walkOrganisationsNames] : []);
try {
  for (const part of parts) {
    try { await part(); } catch (e) {
      check("this part of the walk ran to its end", false, String(e && e.message ? e.message : e).split("\n")[0].slice(0, 300));
    }
  }
} finally {
  await browser.close();
}

let last = "";
for (const r of results) {
  if (r.area !== last) { console.log(`\n${r.area}`); last = r.area; }
  console.log(`  ${r.ok ? "ok  " : "FAIL"} ${r.name}${r.ok ? "" : `\n         ${r.detail}`}`);
}
for (const n of notes) console.log(`\nnote: ${n}`);
const failed = results.filter((r) => !r.ok);
console.log(`\nwalk: ${results.length - failed.length} of ${results.length} checks passed in ${Math.round((Date.now() - started) / 1000)}s` +
  ` (browser ${browser.version()})`);
process.exit(failed.length ? 1 : 0);

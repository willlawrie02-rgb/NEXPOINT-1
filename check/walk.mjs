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
//   WALK_ONLY=boards (or public)   runs one half; WALK_ONLY=sign runs the
//       consultancy sign-up page alone.
//   WALK_ORIGIN=cloudflare-pages   serves the pages the way Cloudflare Pages
//       will (plan 053) instead of the way GitHub Pages does: .html
//       addresses redirect, unknown ones get 404.html, and the hub
//       subdomains go through the subdomain router's mapping.
import { chromium } from "playwright-core";
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, dirname, resolve, extname, sep } from "node:path";
import { homedir } from "node:os";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const ADMIN_DIR = process.env.WALK_ADMIN_DIR ? resolve(process.env.WALK_ADMIN_DIR) : join(ROOT, "admin");
const ONLY = process.env.WALK_ONLY || "";
const ORIGIN = process.env.WALK_ORIGIN || "github-pages";
if (!["github-pages", "cloudflare-pages"].includes(ORIGIN)) {
  console.error(`walk: WALK_ORIGIN must be github-pages or cloudflare-pages, not ${ORIGIN}`);
  process.exit(2);
}

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
  ".txt": "text/plain; charset=utf-8", ".xml": "application/xml", ".woff2": "font/woff2", ".mp4": "video/mp4",
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
/* The one row a write carried: a write of two rows, or of none, fails. */
const oneRow = (w) => {
  const rows = [].concat(w.body);
  if (rows.length !== 1) throw new Error(`the write carried ${rows.length} rows, want 1`);
  return rows[0];
};
const sortedKeys = (o) => (o && typeof o === "object" && !Array.isArray(o)
  ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortedKeys(o[k])])) : o);
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
  score: null, hubs_used: [], relationships: [],
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

/* The consultancy sign-up link (sign/), as the worker's /signup/* routes
   describe it: one state shape for both. A ready link carries the agreement
   the client signs: the Introduction Agreement, a blank line, then the
   Master Terms under its own "# " title, with the signer's fields left as "[completed when you sign]". The
   walk's stand-in has every construct the real text uses (headings at three
   levels, bold clause numbers, the fee table, bullets, a list followed
   straight on by a clause) and two hostile values a client field could
   carry, which must arrive as text. */
const SIGN_TOKEN = "e".repeat(64);
const SIGN_FILLER = Array.from({ length: 24 }, (_, i) =>
  `**9.${i + 1}** A stand-in clause, long enough that the agreement runs past the panel and has to be scrolled to be read to its end.`).join("\n\n");
const SIGN_AGREEMENT_TEXT = "# Introduction Agreement\n\nVersion 2.1, October 2026\n\n## Parties\n\n" +
  "Client: Midlands 3D Printing & Co <Ltd>\n\nAddress: 1 <img src=x onerror=\"window.__npPwned=1\"> Road, Stone\n\n" +
  "## 2. Fees\n\n### 2.1 Upfront Search and Engagement Fee\n\n**2.1.1** Amount: £5,000 (GBP)\n\n" +
  "**2.2.3** The applicable fee rates are:\n\n| Year after the introduction | NexPoint fee as a percentage of Gross Revenue |\n|---|---|\n" +
  "| Year 1 | 6% |\n| Year 2 | 5% |\n| After Year 5 | 0% |\n\n" +
  "**2.3** **Alternative or Additional Fees** – If the client wishes to expand the scope of the project NexPoint can quote accordingly.\n\n" +
  "**3.** **Reporting** - Within 14 days the Client must provide a statement showing:\n\n" +
  "- (a) each sale or transaction involving the Introduced Party;\n- (b) the relevant invoice dates, per-unit sales price and Gross Revenues;\n" +
  "**4.** **Invoicing for Recurring Fees**- NexPoint will issue quarterly invoices.\n\n" +
  "## Signature\n\nName: [completed when you sign]\n\nPosition: [completed when you sign]\n\nDate: [completed when you sign]\n\n" +
  "# Master Terms of Business and Introduction Agreement\n\nVersion 2.1, October 2026\n\n## 1. Parties\n\n" +
  "**1.1** A clause <script>window.__npPwned=2</script> with a script in it, and a lone * asterisk.\n\n" + SIGN_FILLER + "\n";
const SIGN_AGREEMENT = { version: "2.1", text: SIGN_AGREEMENT_TEXT, hash: "a".repeat(64) };
/* What the panel must show for that text. */
const SIGN_RENDERED = {
  h2: ["Introduction Agreement", "Master Terms of Business and Introduction Agreement"],
  h3: ["Parties", "2. Fees", "Signature", "1. Parties"],
  h4: ["2.1 Upfront Search and Engagement Fee"],
  head: ["Year after the introduction", "NexPoint fee as a percentage of Gross Revenue"],
  rows: [["Year 1", "6%"], ["Year 2", "5%"], ["After Year 5", "0%"]],
  items: ["(a) each sale or transaction involving the Introduced Party;", "(b) the relevant invoice dates, per-unit sales price and Gross Revenues;"],
  rules: 0,
  divided: [false, true],
  pending: 3,
};
/* Where the invoice goes unless the signer says otherwise: the accounts
   address NexPoint put on the link, or the signer's own (spec section 2b). */
const SIGN_INVOICE_DEFAULT = "accounts@midlands3d.example";
const signupState = (status, over = {}) => Object.assign({
  status, company: "Midlands 3D Printing & Co <Ltd>", signer_name: "Jo Bloggs",
  fee: { amount: 5000, currency: "GBP", display: "£5,000" },
  service: "Finding UK clinics for your insoles",
  signed_at: null, paid_at: null, invoice: null,
}, status === "ready" ? { agreement: SIGN_AGREEMENT, invoice_email_default: SIGN_INVOICE_DEFAULT } : {}, over);
const SIGN_BANK_GBP = { "Account name": "NexPoint Global Limited", "Sort code": "00-00-00", "Account number": "00000000" };
const signupInvoice = (over = {}) => Object.assign({ number: "INV-1011", amount_display: "£5,000", due_date: "2026-11-18",
  pay_url: "https://in.xero.com/walk-invoice", pay_by_bank: true, bank: SIGN_BANK_GBP }, over);
const signupLink = (w, req) => (w.signup && req.body && req.body.token === w.signup.token ? w.signup : null);

/* The worker's answers, as the pages meet them. Keyed by method and path. */
const API = {
  "GET /auth/me": (w) => (w.user ? [200, { ok: true, signed_in: true, member: w.user, closed: !!w.closed }] : [200, { ok: true, signed_in: false }]),
  /* Plan 069: the holder closes and reopens from the account page. A closed
     scenario sets w.closed = { at }; w.host says whether the account hosts
     (the dialog's words); w.live is the live-relationship count. A scenario
     with closeRoutes: false stands for a worker without the routes, whose
     profile answer carries no `closed` key. */
  "POST /account/close": (w, req) => {
    if (!w.user) return [401, { error: "sign in required" }];
    if (w.closed) return [409, { error: "already_closed" }];
    const typed = String((req.body || {}).confirm_name || "").trim().toLowerCase();
    if (typed !== w.user.company.toLowerCase()) return [422, { error: "name_mismatch" }];
    if ((req.body || {}).current_password !== PASSWORD) return [400, { error: "current_password_wrong" }];
    w.closed = { at: "2026-10-22T09:00:00Z" };
    return [200, { ok: true, closed_at: w.closed.at, host: !!w.host, relationships_live: w.live || 0 }];
  },
  "POST /account/reopen": (w) => {
    if (!w.user) return [401, { error: "sign in required" }];
    if (!w.closed) return [409, { error: "not_closed" }];
    w.closed = null;
    return [200, { ok: true, paused: false }];
  },
  "POST /auth/login": (w, req) => {
    if (req.body && req.body.email === USER.email && req.body.password === PASSWORD) { w.user = USER; return [200, { ok: true, member: USER }]; }
    return [401, { error: "invalid_credentials" }];
  },
  "POST /auth/logout": (w) => { w.user = null; return [200, { ok: true }]; },
  "POST /auth/register": () => [200, { ok: true }],
  // plan 073 (D7): the door's read of a portal invitation; a link with no live one
  "POST /auth/portal-invite": () => [404, { error: "not_found" }],
  // the site map's two lookups (plan 046): a place for a search, a place for a pin
  "GET /geocode/search": () => [200, { ok: true, point: { lat: 53.8, lng: -1.55 } }],
  "GET /geocode/reverse": () => [200, { ok: true, town: "Leeds", country: "United Kingdom", region: "uk" }],
  "POST /auth/resend-confirmation": () => [200, { ok: true }],
  "POST /auth/reset-request": () => [200, { ok: true }],
  "POST /auth/confirm": (w) => { w.user = USER; return [200, { ok: true, email: USER.email, member: USER }]; },
  "GET /terms/current": (w, req) => [200, { ok: true, id: 12, layer: req.query.layer || "platform", version: "1.0",
    title: "NexPoint terms (walk)", body_md: WRAPPED_TERMS }],
  "POST /requests": () => [200, { ok: true }],
  "GET /account/summary": (w) => {
    if (!w.user) return [401, { error: "unauthenticated" }];
    const s = w.summary || EMPTY_SUMMARY;
    if (!w.closed) return [200, Object.assign({}, s, { closed: null })];
    return [200, Object.assign({}, s, {
      closed: { at: w.closed.at, by_you: true, host_was: !!w.host, relationships_live: w.live || 0,
        retention_until: w.retentionUntil === undefined ? "2032-10-22" : w.retentionUntil, reopen: true },
      site: Object.assign({}, s.site || {}, { closed: true, removed: true }),
    })];
  },
  // the account's logo (plan 055, decision 25): none until a scenario says otherwise
  "GET /account/logo": (w) => (w.user ? [200, { ok: true, url: w.logo || null, expires_in: 60 }] : [401, { error: "sign in required" }]),
  "GET /opportunities/briefs": () => [200, { ok: true, briefs: [] }],
  "GET /vocab": () => [200, { ok: true, items: [] }],
  "GET /attributes": () => [200, { ok: true, attributes: [] }],
  "GET /listings/mine": () => [200, { ok: true, listing: null }],
  "GET /host/application": () => [200, { ok: true, application: null }],
  // plan 067: the search is a POST that accepts the introduction terms; no site by default
  "POST /listings/search": () => [200, { ok: true, search_id: 1, matches: [], no_match: true,
    seeker_point: null, region: null, region_unknown: true, terms_version: 12 }],
  // the account page's people sections (plan 052, wave 3): the user, the users, the invitations
  "GET /account/profile": (w) => (w.user ? [200, { ok: true, profile: w.profile || { name: w.user.name, email: w.user.email,
    phone: null, town: w.user.town, country: w.user.country, region: null, role: "owner", pending_email: null },
    account: w.closeRoutes === false ? { name: w.user.company, website: null }
      : { id: "org-walk", name: w.user.company, website: null, closed: w.closed || null, host: !!w.host } }]
    : [401, { error: "sign in required" }]),
  "GET /account/users": (w) => (w.user ? [200, { ok: true, users: w.users || [{ user_id: w.user.id, name: w.user.name,
    email: w.user.email, role: "owner", confirmed: true, joined_at: "2026-10-01T09:00:00Z", you: true }] }] : [401, { error: "sign in required" }]),
  "GET /account/invites": (w) => (w.user ? [200, { ok: true, invites: w.invites || [] }] : [401, { error: "sign in required" }]),
  /* The consultancy sign-up page (sign/): one link, kept on world.signup as
     { token, state, raised }. Accepting moves a ready link to signed, as the
     worker's /signup/accept does, refusing what it refuses; the next look
     after that finds the invoice raised (world.signup.raised), as the
     worker's own invoicing would. Any other token is the one bad-link answer. */
  "POST /signup/view": (w, req) => {
    const s = signupLink(w, req);
    if (!s) return [400, { error: "link_invalid" }];
    if (s.state.status === "signed" && s.raised) s.state = s.raised;
    return [200, { ok: true, state: s.state }];
  },
  "POST /signup/accept": (w, req) => {
    const s = signupLink(w, req);
    if (!s) return [400, { error: "link_invalid" }];
    if (s.state.status !== "ready") return [409, { error: "already_signed", state: s.state }];
    const b = req.body || {};
    if (b.agreement_hash !== s.state.agreement.hash) return [409, { error: "agreement_changed", state: s.state }];
    const name = String(b.signer_name || "").trim();
    const position = String(b.signer_position || "").trim();
    if (!name) return [422, { error: "signer_name required" }];
    if (!position) return [422, { error: "signer_position required" }];
    if (b.agree !== true) return [422, { error: "agreement not accepted" }];
    const invoiceEmail = String(b.invoice_email || "").trim().toLowerCase();
    if (!invoiceEmail) return [422, { error: "invoice_email required" }];
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(invoiceEmail)) return [422, { error: "invalid invoice_email" }];
    const po = String(b.purchase_order || "").trim();
    if (po.length > 50) return [422, { error: "purchase_order too long" }];
    s.state = signupState("signed", { signed_at: "2026-10-19T10:00:00Z", signed_name: name, signed_position: position,
      invoice_email: invoiceEmail, purchase_order: po || null });
    return [200, { ok: true, state: s.state }];
  },
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
  /* A route named in world.dropOnce fails at the network the first time it is asked. */
  if (world.dropOnce && world.dropOnce.has(key)) { world.dropOnce.delete(key); return route.abort("failed"); }
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
      const rows = FILTERED.has(table) ? postgrest(world.rows[table] || [], url.searchParams) : (world.rows[table] || []);
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

/* The tables whose reads the new pages filter (plan 072): the Inbox reads
   our open tasks (done_at is null) and the ones done in the last 14 days,
   and the cards still set aside (restored_at is null);
   System reads the Inbox's failed-run cards and a job's newest run that did
   work. For these the stub answers as PostgREST would: the filters, the
   order and the limit. Every other table answers its rows as given. */
const FILTERED = new Set(["crm_tasks", "crm_inbox_dismissals", "inbox", "engine_runs"]);
const NOT_FILTERS = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);
function postgrest(rows, params) {
  const unquote = (v) => v.replace(/^"(.*)"$/, "$1");
  const test = (cell, expr) => {
    if (expr.startsWith("not.")) return !test(cell, expr.slice(4));
    const dot = expr.indexOf("."), op = expr.slice(0, dot), arg = expr.slice(dot + 1);
    const v = cell == null ? null : String(cell);
    if (op === "is") return arg === "null" ? cell == null : String(cell) === arg;
    if (op === "in") return v != null && arg.replace(/^\(|\)$/g, "").split(",").map(unquote).includes(v);
    if (v == null) return false;
    return { eq: v === arg, neq: v !== arg, gt: v > arg, gte: v >= arg, lt: v < arg, lte: v <= arg }[op] ?? true;
  };
  let out = rows.filter((r) => [...params].every(([k, expr]) => NOT_FILTERS.has(k) || test(r[k], expr)));
  const order = params.get("order");
  if (order) {
    const [col, dir] = order.split(",")[0].split(".");
    out = out.slice().sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (dir === "desc" ? -1 : 1));
  }
  if (params.get("limit")) out = out.slice(0, Number(params.get("limit")));
  return out;
}

function serveFile(world, route, url) {
  if (ORIGIN === "cloudflare-pages") return servePages(world, route, url);
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

/* WALK_ORIGIN=cloudflare-pages (plan 053): answer the way Cloudflare Pages
   will. /x.html is a 308 to /x and /x/index.html a 308 to /x/, query kept;
   /x serves x.html; a folder without its slash is a 308 to the slash; a file
   asked for with a trailing slash is a 308 to drop it; anything missing gets
   the site's 404.html with status 404. `path` is the address on the apex,
   still URL-encoded; the answer is { file }, { redirect } or { missing }. */
function pagesAnswer(path) {
  if (path.endsWith("/index.html")) return { redirect: path.slice(0, -"index.html".length) };
  if (path.endsWith(".html")) return { redirect: path.slice(0, -".html".length) };
  if (path === "/admin") return { redirect: "/admin/" };
  let rel = decodeURIComponent(path);
  let base = ROOT;
  if (rel.startsWith("/admin/")) { base = ADMIN_DIR; rel = rel.slice("/admin".length); }
  const file = resolve(join(base, rel));
  if (file !== base && !file.startsWith(base + sep)) return { missing: true };
  const isFile = (f) => existsSync(f) && statSync(f).isFile();
  if (rel.endsWith("/")) {
    if (isFile(join(file, "index.html"))) return { file: join(file, "index.html") };
    if (file !== base && isFile(file + ".html")) return { redirect: path.replace(/\/+$/, "") };
    return { missing: true };
  }
  if (isFile(file)) return { file };
  if (isFile(file + ".html")) return { file: file + ".html" };
  if (isFile(join(file, "index.html"))) return { redirect: path + "/" };
  return { missing: true };
}

/* A redirect the walk answers is not routed again: Playwright sends the
   browser's next hop to the real network, which here is the live site (seen
   on 20 Oct: the live pages' Cloudflare email script turned up as a missing
   file). So a page load gets a stub that moves to the target itself, which
   the walk does route, keeping the hash as a real redirect would; any other
   request gets the target's answer straight away. */
function pagesRedirect(world, route, target, hops) {
  if (route.request().isNavigationRequest()) {
    return route.fulfill({ status: 200, contentType: MIME[".html"],
      body: `<!doctype html><script>location.replace(${JSON.stringify(target)} + location.hash)</script>` });
  }
  return servePages(world, route, new URL(target), hops + 1);
}

function servePages(world, route, url, hops = 0) {
  if (hops > 4) {
    world.missing.push(`${url.href} (more than four redirects)`);
    return route.fulfill({ status: 508, contentType: "text/plain", body: "too many redirects" });
  }
  const folder = FOLDERS[url.hostname];
  let path = url.pathname;
  if (folder) {
    /* The subdomain router's mapping, exactly as
       ~/Documents/Claude/Projects/Nexpoint/_system/subdomain-router/worker.js
       does it (plan 053 A1): a trailing index.html goes, any other .html goes,
       and the hub's folder goes in front. Keep the two in step. */
    if (path.endsWith("/index.html")) path = path.slice(0, -"index.html".length);
    else if (path.endsWith(".html")) path = path.slice(0, -".html".length);
    path = `/${folder}${path}`;
  }
  const answer = pagesAnswer(path);
  if (answer.redirect) {
    if (!folder) return pagesRedirect(world, route, url.origin + answer.redirect + url.search, hops);
    /* The router turns the origin's redirect into a 302 on the subdomain, and
       answers 502 rather than redirect an address to itself. */
    const back = answer.redirect.replace(new RegExp(`^/${folder}(?=[/?#]|$)`), "") || "/";
    const target = `${url.origin}${back}${url.search}`;
    if (target === url.origin + url.pathname + url.search) {
      world.missing.push(`${url.href} (the router would redirect it to itself)`);
      return route.fulfill({ status: 502, contentType: "text/plain", body: "redirect to itself" });
    }
    return pagesRedirect(world, route, target, hops);
  }
  if (answer.missing) {
    if (!/favicon\.ico$/.test(path)) world.missing.push(url.href);
    return route.fulfill({ status: 404, contentType: MIME[".html"], body: readFileSync(join(ROOT, "404.html")) });
  }
  return route.fulfill({ status: 200, contentType: MIME[extname(answer.file)] || "application/octet-stream",
    headers: { "access-control-allow-origin": "*" }, body: readFileSync(answer.file) });
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
    /* The sign-up page signs on the page itself (19 Oct 2026): DocuSign is out,
       so anything it asks of a DocuSign host is a failure. */
    if (/(^|\.)docusign\.(com|net)$/.test(host)) { world.strays.push(`DocuSign ${request.method()} ${host}${url.pathname}`); return route.abort(); }
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

// ================================================================ close and reopen (plan 069)
/* A host or seeker closes its own account from the settings page, behind the
   account's name typed and the current password; the account page then shows
   the closed notice with the date the records may go, keeps only what still
   applies, and offers Reopen; the hub forms show a notice in place of the
   form; a worker without the routes shows no Closing section. */
async function walkClose() {
  area = "Closing and reopening the account (plan 069)";
  const LINE = { line_id: 71, ref: "INTRO-0071", period: "2026-09", units: 40, value: 800, currency: "GBP", declared_at: "2026-10-02T09:00:00Z" };
  const hostSummary = () => Object.assign({}, EMPTY_SUMMARY, {
    org: { id: "org-walk", name: USER.company, role: "owner", host_print: "approved", host_mill: "none" },
    site: { org_id: "org-walk", name: USER.company, town: "Leeds", country: "United Kingdom", host_print: "approved", host_mill: "none",
      sub_status: "active", founding: false, paused: false, removed: false, verified: true },
    listings: [{ hub: "print", status: "live", live: { revision_id: 2, approved_at: "2026-10-01T09:00:00Z", summary: "PA12" }, pending: null }],
    statements: [{ quarter: "2026-Q3", status: "issued", issued_at: "2026-10-23", invoiced_at: null, paid_at: null, lines: [], totals: {} }],
    declarations: { current: null, history: [], lines: [], due_state: "none", items: [], awaiting_my_confirmation: [] },
  });
  const seekerSummary = () => Object.assign({}, EMPTY_SUMMARY, {
    org: { id: "org-walk", name: USER.company, role: "owner", host_print: "none", host_mill: "none" },
    site: { org_id: "org-walk", name: USER.company, town: "Leeds", country: "United Kingdom", host_print: "none", host_mill: "none",
      sub_status: "none", founding: false, paused: false, removed: false, verified: false },
    requests: [{ id: 5, ref: "PS-0005", hub: "print", material: "pa12_nylon12", quantity: 500, cadence: "recurring", status: "closed",
      created_at: "2026-10-01T09:00:00Z", no_match: false, picks: [] }],
    declarations: { current: null, history: [], lines: [], due_state: "none", items: [], awaiting_my_confirmation: [LINE] },
  });
  const worldFor = (over) => newWorld(Object.assign({ user: USER, users: [{ user_id: USER.id, name: USER.name, email: USER.email,
    role: "owner", confirmed: true, joined_at: "2026-10-01T09:00:00Z", you: true }] }, over));

  // a host closes, sees the closed page, and reopens
  {
    const world = worldFor({ host: true, live: 1, summary: hostSummary() });
    const { context, page, errors } = await visit(world);
    await page.goto(`${APEX}/hub/account/settings/`);
    await step("the Closing section shows for an open account, after Users", async () => {
      await page.waitForSelector("#closing:not([hidden])");
      has(await page.textContent("#closing"), "Closing your account", "the section");
      return eq(await page.locator('#closing [data-act="close-open"]').count(), 1, "the Close this account button");
    });
    await step("the dialog says the host text, and its Close button waits for the name", async () => {
      await page.click('[data-act="close-open"]');
      await page.waitForSelector("#closeOverlay.open");
      const t = await page.textContent("#closeText");
      has(t, "ends your Host Agreement now", "the host text");
      has(t, "six years after the last invoice", "the retention line");
      eq(await page.getAttribute("#closeGo", "disabled") !== null, true, "disabled before the name");
      await page.fill("#closeName", "zz walk test ltd");
      return eq(await page.getAttribute("#closeGo", "disabled"), null, "enabled once the name matches, case ignored");
    });
    await step("a wrong password shows the worker's words and closes nothing", async () => {
      await page.fill("#closePassword", "not-it");
      await page.click("#closeGo");
      await page.waitForSelector("#closeMsg:not([hidden])");
      has(await page.textContent("#closeMsg"), "That password is not right.", "the message");
      return eq(!!world.closed, false, "the account closed");
    });
    await step("the right pair posts the typed name and the password, and the page moves to the account page", async () => {
      await page.fill("#closePassword", PASSWORD);
      await page.click("#closeGo");
      await page.waitForURL((u) => u.pathname === "/hub/account/");
      const b = apiCalls(world, "POST /account/close").pop().body;
      eq(b, { confirm_name: "zz walk test ltd", current_password: PASSWORD }, "the body");
      return eq(!!world.closed, true, "the account");
    });
    await step("the closed account page shows the notice with the retention date, keeps declarations and fees for a host, and offers Reopen", async () => {
      await page.waitForSelector("#acctClosed");
      const t = await page.textContent("#acctClosed");
      has(t, "You closed this account on 22 Oct 2026", "the notice");
      has(t, "Host Agreement has ended", "the host line");
      has(t, "22 Oct 2032", "the retention date");
      await page.waitForSelector("#declarations:not([hidden])");
      await page.waitForSelector("#fees:not([hidden])");
      eq(await page.locator("#goHub:not([hidden])").count(), 0, "the hub door");
      eq(await page.locator("#waiting:not([hidden]), #introductions:not([hidden])").count(), 0, "sections that no longer apply");
      has(await page.textContent("#profile"), "Closed", "the profile card");
      return eq(await page.locator('#acctClosed [data-act="reopen"]').count(), 1, "the Reopen button");
    });
    await step("Reopen posts, and the page is open again", async () => {
      await page.click('#acctClosed [data-act="reopen"]');
      await page.waitForSelector("#waiting:not([hidden])");
      eq(apiCalls(world, "POST /account/reopen").length, 1, "reopen posts");
      eq(world.closed, null, "the account");
      return eq(await page.locator("#acctClosed").count(), 0, "the closed notice");
    });
    clean(world, errors, "closing as a host");
    await context.close();
  }

  // a seeker's dialog and closed page
  {
    // the closing day: the engine has not stamped retention_until yet
    const world = worldFor({ host: false, summary: seekerSummary(), retentionUntil: null });
    const { context, page, errors } = await visit(world);
    await page.goto(`${APEX}/hub/account/settings/`);
    await step("the dialog says the seeker text for an account that does not host", async () => {
      await page.waitForSelector("#closing:not([hidden])");
      await page.click('[data-act="close-open"]');
      await page.waitForSelector("#closeOverlay.open");
      const t = await page.textContent("#closeText");
      has(t, "Your open requests close", "the seeker text");
      return eq(/Host Agreement/.test(t), false, "the host text on a seeker's dialog");
    });
    await step("a closed seeker's account page keeps the lines to confirm and nothing of a host's", async () => {
      world.closed = { at: "2026-10-22T09:00:00Z" };
      await page.goto(`${APEX}/hub/account/`);
      await page.waitForSelector("#acctClosed");
      has(await page.textContent("#acctClosed"), "Your requests are closed", "the seeker line");
      has(await page.textContent("#acctClosed"), "or for six years from closure if there was none", "the rule, before the date is stamped");
      await page.waitForSelector("#waiting:not([hidden])");
      has(await page.textContent("#waiting"), "INTRO-0071", "the line to confirm");
      return eq(await page.locator("#declarations:not([hidden]), #fees:not([hidden]), #introductions:not([hidden])").count(), 0, "a host's sections");
    });
    await step("the settings page in closed mode shows This account is closed, You, and Reopen, and hides Logo and Users", async () => {
      await page.goto(`${APEX}/hub/account/settings/`);
      await page.waitForSelector("#closing:not([hidden])");
      await page.waitForSelector("#you:not([hidden])");
      has(await page.textContent("#closing"), "This account is closed", "the section");
      eq(await page.locator("#logo:not([hidden]), #users:not([hidden])").count(), 0, "Logo and Users");
      return eq(await page.locator('#closing [data-act="reopen"]').count(), 1, "the Reopen button");
    });
    await step("Reopen from the settings page posts and goes to the account page", async () => {
      await page.click('#closing [data-act="reopen"]');
      await page.waitForURL((u) => u.pathname === "/hub/account/");
      return eq(apiCalls(world, "POST /account/reopen").length, 1, "reopen posts");
    });
    clean(world, errors, "closing as a seeker");
    await context.close();
  }

  // the hub forms refuse a closed account with a notice, not a form
  {
    const world = worldFor({ host: false, closed: { at: "2026-10-22T09:00:00Z" }, summary: seekerSummary() });
    world.api["GET /listings/mine"] = () => [200, { ok: true, listing: null, status: "none" }];
    const { context, page, errors } = await visit(world);
    await step("Find shows the closed notice in place of the form", async () => {
      await page.goto(`${PRINT}/find.html`);
      await page.waitForSelector("body[data-np-closed]");
      await page.waitForSelector("#findMount .acct-closed-notice");
      has(await page.textContent("#findMount"), "This account is closed", "the notice");
      return eq(await page.locator("#findForm").count(), 0, "the form");
    });
    await step("the listing form shows the closed notice in place of the form", async () => {
      await page.goto(`${PRINT}/offer.html`);
      await page.waitForSelector("#hostAppBody .acct-closed-notice");
      has(await page.textContent("#hostAppBody"), "to list capacity", "the notice");
      return eq(await page.locator("#listingForm").count(), 0, "the form");
    });
    clean(world, errors, "the hub forms for a closed account");
    await context.close();
  }

  // a worker without the routes: the profile answer carries no `closed` key
  {
    const world = worldFor({ closeRoutes: false });
    const { context, page, errors } = await visit(world);
    await page.goto(`${APEX}/hub/account/settings/`);
    await step("a worker without the close routes shows no Closing section", async () => {
      await page.waitForSelector("#users:not([hidden])");
      await settled(page);
      return eq(await page.locator("#closing:not([hidden])").count(), 0, "the Closing section");
    });
    clean(world, errors, "the settings page before the worker deploys");
    await context.close();
  }
}

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
  // Plan 055: the hero's account-holder line is a button now, and ?join=1
  // (the main site's Join our network) lands with the questionnaire open.
  await step("the hero offers Create your hub account as a button, with Sign in underneath", async () => {
    has(await page.textContent(".hero-join button.btn-primary"), "Create your hub account", "the button");
    has(await page.textContent(".hero-join"), "Already have an account?", "the sign-in line");
    eq(await page.locator(".hero-join [data-np-join]").count(), 0, "a second data-np-join");
  });
  // Plan 055, point 6 (Will, 13 October 2026): the globe rises and fades on
  // load and the Global Portal film is revealed where it stood.
  await step("the globe gives way to the film: the film stands in the hero with one play button", async () => {
    await page.waitForFunction(() => {
      const g = document.querySelector(".hero-reveal .hero-globe");
      return g && getComputedStyle(g).visibility === "hidden";
    });
    await page.waitForFunction(() => getComputedStyle(document.querySelector(".hero-reveal .hero-film")).opacity === "1");
    const got = await page.evaluate(() => {
      const film = document.querySelector(".hero-reveal .hero-film"), v = document.getElementById("heroFilm");
      const r = film.getBoundingClientRect();
      return { opacity: getComputedStyle(film).opacity, ratio: Math.round(r.width / r.height * 100) / 100, controls: v.controls,
        play: getComputedStyle(document.getElementById("heroFilmPlay")).display !== "none",
        elsewhere: document.querySelectorAll("#how video").length, films: document.querySelectorAll("video").length };
    });
    eq([got.opacity, got.controls, got.play, got.elsewhere, got.films], ["1", false, true, 0, 1], "film opacity, controls, play button, films under How, films on the page");
    eq(got.ratio > 1.7 && got.ratio < 1.85, true, "the frame is 16 by 9");
  });
  await step("Play the film starts it and hands over to the browser's controls", async () => {
    await page.click("#heroFilmPlay");
    await page.waitForSelector(".hero-film.is-playing");
    eq(await page.evaluate(() => document.getElementById("heroFilm").controls), true, "controls after play");
    eq(await page.evaluate(() => getComputedStyle(document.getElementById("heroFilmPlay")).display), "none", "the play button");
    await page.evaluate(() => document.getElementById("heroFilm").pause());
  });
  await step("?join=1 opens the create-account box for a stranger", async () => {
    await page.goto(`${APEX}/hub/?join=1`);
    await page.waitForSelector('form[data-np-step="1"]');
    await page.keyboard.press("Escape");
    await page.goto(`${APEX}/hub/`);
    await settled(page);
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
  /* 15 Oct 2026: a password the sign-in service refused showed only "Check
     the details". Each refusal the registrant can put right is named, and
     anything else carries the server's reason for the desk. The form is
     still on step 2 from the step above, so each case just submits again. */
  const refusedWith = async (status, body, needle, label) => {
    world.api["POST /auth/register"] = () => [status, body];
    await page.waitForSelector('form[data-np-step="2"] button[type=submit]:not([disabled])');
    await submit();
    await page.waitForFunction((n) => (document.querySelector("#npAccountContent form .np-sign-error") || {}).textContent?.includes(n), needle);
    return has(await page.textContent("#npAccountContent form .np-sign-error"), needle, label);
  };
  await step("a password the sign-in service refuses is named, with its rule", () =>
    refusedWith(422, { error: "weak_password", detail: "Password should be at least 12 characters." },
      "That password was not accepted. Password should be at least 12 characters. Choose Go back", "the refusal"));
  await step("an address the sign-in service refuses is named", () =>
    refusedWith(422, { error: "email_invalid" }, "could not use that email address", "the refusal"));
  await step("terms that changed under the form ask for a refresh", () =>
    refusedWith(422, { error: "invalid terms_version_id" }, "Platform Terms have just been updated", "the refusal"));
  await step("any other refusal carries the server's reason", () =>
    refusedWith(502, { error: "organisation store failed (500)" }, 'quoting "organisation store failed (500)"', "the refusal"));
  clean(world, errors, "the register form");
  await context.close();
}

/* Plan 073 (D7): NexPoint's invitation email opens the door with ?join=. The
   form opens filled from the invitation and editable, the registration
   carries the token, and an invitation that has run out says one line over
   the ordinary form; nothing blocks the sign-up. */
const JOIN_TOKEN = "c".repeat(64);
async function walkJoin() {
  area = "Create an account from a portal invitation";
  const world = newWorld();
  world.api["POST /auth/portal-invite"] = () => [200, { ok: true, company_name: "ZZ Invited Lab Ltd", email: "invited@example.com" }];
  const { context, page, errors } = await visit(world);
  const submit = () => page.click("#npAccountContent button[type=submit]");
  const toStepTwo = async () => {
    await page.fill("#qName", "Walk Tester");
    await page.locator("#qPass").pressSequentially(PASSWORD);
    await submit();
    await page.waitForSelector('form[data-np-step="2"]');
    await page.fill("#qCountry", "United Kingdom");
    await page.waitForSelector("#qTerms");
    await page.check("#qTerms");
    await page.waitForSelector('form[data-np-step="2"] button[type=submit]:not([disabled])');
  };
  await page.goto(`${APEX}/hub/?join=${JOIN_TOKEN}`);
  await step("the link opens Create account filled from the invitation", async () => {
    await page.waitForSelector('form[data-np-step="1"]');
    eq(apiCalls(world, "POST /auth/portal-invite").map((c) => c.body), [{ token: JOIN_TOKEN }], "the door's read");
    eq([await page.inputValue("#qCompany"), await page.inputValue("#qEmail")],
      ["ZZ Invited Lab Ltd", "invited@example.com"], "the two fields");
    return (await page.locator("[data-np-join-note]").count()) === 0;
  });
  await step("both fields stay editable, and the registration carries the token with what was typed", async () => {
    await page.fill("#qCompany", "ZZ Invited Lab (Leeds) Ltd");
    await toStepTwo();
    await submit();
    await page.waitForSelector("#npAccountContent .success");
    const b = apiCalls(world, "POST /auth/register").pop().body;
    eq([b.company, b.email, b.portal_invite], ["ZZ Invited Lab (Leeds) Ltd", "invited@example.com", JOIN_TOKEN], "the register body");
  });
  await step("an invitation that ran out while the form was open is dropped, and the next press registers", async () => {
    await page.goto(`${APEX}/hub/?join=${JOIN_TOKEN}`);
    await page.waitForSelector('form[data-np-step="1"]');
    await toStepTwo();
    world.api["POST /auth/register"] = (w, req) => (req.body.portal_invite ? [422, { error: "invite_not_valid" }] : [200, { ok: true }]);
    await submit();
    await page.waitForFunction(() => (document.querySelector("#npAccountContent form .np-sign-error") || {}).textContent?.includes("expired"));
    has(await page.textContent("#npAccountContent form .np-sign-error"), "This invitation has expired. Ask NexPoint for a new one", "the line");
    await page.waitForSelector('form[data-np-step="2"] button[type=submit]:not([disabled])');
    await submit();
    await page.waitForSelector("#npAccountContent .success");
    const sent = apiCalls(world, "POST /auth/register").slice(-2).map((c) => c.body.portal_invite);
    eq(sent, [JOIN_TOKEN, undefined], "the token on the two presses");
    delete world.api["POST /auth/register"];
  });
  for (const [what, status, error] of [["an expired", 410, "invite_expired"], ["a used", 409, "invite_used"]]) {
    await step(`${what} invitation says one line over the ordinary form`, async () => {
      world.api["POST /auth/portal-invite"] = () => [status, { error }];
      await page.goto(`${APEX}/hub/?join=${JOIN_TOKEN}`);
      await page.waitForSelector("[data-np-join-note]");
      has(await page.textContent("[data-np-join-note]"), "This invitation has expired. Ask NexPoint for a new one, or create your account below.", "the line");
      eq([await page.inputValue("#qCompany"), await page.inputValue("#qEmail")], ["", ""], "the two fields");
      await page.fill("#qCompany", "ZZ Walk Test Ltd");
      await page.fill("#qEmail", "walk@example.com");
      await toStepTwo();
      await page.fill('form[data-np-step="2"] #qTown', "Leeds");
      const before = apiCalls(world, "POST /auth/register").length;
      await submit();
      await page.waitForSelector("#npAccountContent .success");
      const sent = apiCalls(world, "POST /auth/register");
      eq(sent.length, before + 1, "registrations sent");
      return !("portal_invite" in sent.pop().body);
    });
  }
  await step("a link that is not a token opens the ordinary form without asking", async () => {
    const before = apiCalls(world, "POST /auth/portal-invite").length;
    await page.goto(`${APEX}/hub/?join=not-a-token`);
    await page.waitForSelector('form[data-np-step="1"]');
    eq(apiCalls(world, "POST /auth/portal-invite").length, before, "reads of the invitation");
    return (await page.locator("[data-np-join-note]").count()) === 0;
  });
  clean(world, errors, "the invitation door");
  await context.close();
}

const WALLED = [
  ["the 3D Print Hub", `${PRINT}/`], ["3D Print Hub: find", `${PRINT}/find.html`], ["3D Print Hub: offer", `${PRINT}/offer.html`],
  ["the Mill Hub", `${MILL}/`], ["Mill Hub: find", `${MILL}/find.html`], ["Mill Hub: offer", `${MILL}/offer.html`],
  ["Opportunities", `${OPPS}/`], ["the account page", `${APEX}/hub/account/`],
  ["the account settings page", `${APEX}/hub/account/settings/`],
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
      // The Opportunities Board has its own header with no Talk to the desk
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

/* The seeker's shortlist and its map (plan 052, items 23 and 24; plan 055,
   decision 15; plan 067, D7 and Q3/Q4): the seeker accepts the introduction
   terms for the search before any name shows, the best three cards are
   named, a map with the seeker's town and every ranked site's town, two
   sites in one town sharing one numbered pin, a fourth site on the map only
   (a pin with no name and no Choose), and one pick, on the map or a card,
   sent in one call that goes straight to the site. */
const MATCH_CARD = (id, town, lat, lng, lead, km, shortlist, company) => ({
  listing_id: id, town, country: "United Kingdom", point: lat === null ? null : { lat, lng },
  machines: [{ name: "HP MJF 5200", materials: ["pa12_nylon12"], count: 1, lead_time_days: lead, monthly_capacity: 600, min_order: null }],
  materials: ["pa12_nylon12"], processes: ["mjf"], services: [], min_lead_time_days: lead,
  verified: true, distance_km: km, meets_lead_time: true, no_match_flag: false, shortlist,
  named: shortlist, ...(company ? { company } : {}),
});
const MATCHES = [
  MATCH_CARD("listing-a", "Leeds", 53.8, -1.55, 3, 5, true, "Acme Orthotics"),
  MATCH_CARD("listing-b", "Leeds", 53.8, -1.55, 6, 5, true, "Bravo Labs"),
  MATCH_CARD("listing-c", "Bristol", 51.45, -2.59, 4, 270, true, "Charlie Print"),
  MATCH_CARD("listing-d", "Glasgow", 55.86, -4.25, 2, 300, false),
];

async function walkFindMap() {
  area = "Finding capacity: the terms, the three by name, and the map";
  const world = newWorld({ user: USER });
  world.api["POST /listings/search"] = () => [200, { ok: true, search_id: 77, matches: MATCHES, no_match: false,
    seeker_point: { lat: 53.8, lng: -1.55 }, region: "uk", region_unknown: false, terms_version: 12 }];
  world.api["POST /seeker-requests"] = () => [200, { ok: true, request_id: 501, ref: "PS-0501",
    introduction: { id: 900, ref: "INTRO-0900", stage: "awaiting_acceptance" }, offer_sent: true }];
  const { context, page, errors } = await visit(world);
  await page.goto(`${PRINT}/find.html`);
  await page.waitForSelector("body[data-np-open]");
  await page.waitForSelector("#findForm");

  await step("the cadence question comes before the quantity", async () => {
    const order = await page.evaluate(() => {
      const cadence = document.getElementById("fCadence"), qty = document.getElementById("fQuantity");
      return !!(cadence && qty && (cadence.compareDocumentPosition(qty) & Node.DOCUMENT_POSITION_FOLLOWING));
    });
    eq(order, true, "Is this a one off? sits above How many");
    return has(await page.textContent("#fCadenceLabel"), "one off", "the cadence question");
  });
  await step("Find the sites that fit opens the terms gate: no search, no card, before the tick", async () => {
    has(await page.textContent("#findSubmit"), "Find the sites that fit", "the button");
    await page.fill("#fMaterial", "PA12"); await page.press("#fMaterial", "Enter");
    await page.fill("#fQuantity", "200");
    await page.fill("#fMaxLead", "10");
    await page.click("#findSubmit");
    await page.waitForSelector("#stepTerms:not([hidden]) #searchTick");
    has(await page.textContent("#stepTerms h2"), "Before we show you who fits", "the gate's heading");
    has(await page.textContent("#stepTerms"), "I accept the introduction terms, version 1.0", "the tick's words");
    eq(await page.locator("#step2:not([hidden])").count(), 0, "step 2 stays hidden");
    eq(await page.locator("#capGrid .cap").count(), 0, "no card before the tick");
    eq(apiCalls(world, "POST /listings/search").length, 0, "no search before the tick");
    eq(apiCalls(world, "GET /terms/current").length >= 1, true, "the introduction terms were fetched");
    await page.click("#searchAccept");
    has(await page.textContent("#searchTermsErr"), "Read the introduction terms and tick to accept them.", "refused until ticked");
    /* The ask can still be corrected while the gate is open: the search must
       run on what the form says at Accept, not on what it said at Find. */
    await page.fill("#fQuantity", "250");
    return eq(apiCalls(world, "POST /listings/search").length, 0, "still no search");
  });
  await step("the tick and Accept post the search with the terms version and the ask as the form now says it, and show the three by name", async () => {
    await page.check("#searchTick");
    await page.click("#searchAccept");
    await page.waitForSelector("#step2:not([hidden]) #capGrid .cap");
    eq(await page.locator("#stepTerms:not([hidden])").count(), 0, "the gate closes");
    const body = apiCalls(world, "POST /listings/search")[0].body;
    eq([body.hub, body.town, body.country, body.max_lead_time_days, body.quantity, body.terms_version_id],
      ["print", "Leeds", "United Kingdom", 10, 250, 12], "the search's hub, town, country, lead time, the corrected quantity and terms version");
    eq(body.material, "pa12_nylon12", "the first material is `material`, as the vocabulary names it");
    eq(Array.isArray(body.materials) && body.materials[0], "pa12_nylon12", "`materials` carries the list");
    eq(await page.locator("#capGrid .cap").count(), 3, "cards");
    eq(await page.locator('#capGrid [data-card="listing-d"]').count(), 0, "the fourth card");
    const names = await page.$$eval("#capGrid .cap h3", (els) => els.map((e) => e.textContent.trim()));
    eq(names, ["Acme Orthotics", "Bravo Labs", "Charlie Print"], "the three are named");
    has(await page.textContent('#capGrid [data-card="listing-a"]'), "Leeds, United Kingdom", "the town line beneath the name");
    has(await page.textContent("#matchIntro"), "The three sites that fit best, by name.", "the intro");
    return has(await page.textContent("#matchIntro"), "One more site on the map", "the intro counts the fourth");
  });
  await step("the three cards carry Best fit for your request", async () => {
    eq(await page.locator("#capGrid .cap .badge-best").count(), 3, "tags");
    has(await page.textContent("#capGrid .cap .badge-best"), "Best fit for your request", "the tag's words");
    return has(await page.textContent('#capGrid [data-card="listing-a"] dl'), "HP MJF 5200, 600 a month", "the machine's monthly capacity");
  });
  await step("the map shows the seeker's town and every ranked site, two Leeds sites on one pin, the fourth outlined", async () => {
    await page.waitForSelector("#matchMap:not([hidden]) .leaflet-container, #matchMap.leaflet-container");
    const pins = await page.$$eval("#matchMap .np-pin", (els) => els.map((e) => ({ text: e.textContent.trim(), cls: e.className })));
    eq(pins.length, 4, "pins (You, Leeds, Bristol, Glasgow)");
    eq(pins.filter((p) => /np-pin--you/.test(p.cls)).map((p) => p.text), ["You"], "the seeker's pin");
    eq(pins.filter((p) => /np-pin--group/.test(p.cls)).map((p) => p.text), ["2"], "the Leeds pin shows how many");
    eq(pins.filter((p) => !/np-pin--(you|group)/.test(p.cls)).map((p) => p.text), ["3", "4"], "Bristol's pin is Site 3, Glasgow's Site 4");
    eq(pins.filter((p) => /np-pin--best/.test(p.cls)).map((p) => p.text), ["2", "3"], "the best three are the filled pins");
    eq(pins.filter((p) => /np-pin--more/.test(p.cls)).map((p) => p.text), ["4"], "the fourth is outlined");
    const titles = await page.$$eval("#matchMap .leaflet-marker-icon", (els) => els.map((e) => e.getAttribute("title")));
    has(titles.join(" | "), "2 sites in Leeds, United Kingdom", "the Leeds pin's name");
  });
  await step("the Glasgow pin is a town and a rank: no name, no Choose, and the three-best-fits line; no card appears", async () => {
    await page.click("#matchMap .np-pin--more");
    await page.waitForSelector("#matchMap .np-pop");
    const pop = await page.textContent("#matchMap .np-pop");
    has(pop, "Site 4", "its rank");
    has(pop, "Glasgow", "its town");
    has(pop, "Only the three best fits are named and can be picked. Change your ask to see others, or tell the desk.", "the note");
    eq(await page.locator("#matchMap .np-pop [data-choose]").count(), 0, "no Choose on a pin beyond the three");
    for (const leak of ["listing-", "HP MJF", "Ltd", "Acme", "Bravo", "Charlie"]) if (pop.includes(leak)) throw new Error(`the popup shows ${leak}`);
    await page.waitForTimeout(150);
    eq(await page.locator('#capGrid [data-card="listing-d"]').count(), 0, "no fourth card");
    eq(await page.locator("#capGrid .cap").count(), 3, "the three cards stay");
    /* closed, and gone (Leaflet fades a popup out), before the next step opens another */
    await page.click("#matchMap .leaflet-popup-close-button");
    await page.waitForSelector("#matchMap .np-pop", { state: "detached" });
  });
  await step("the shared pin opens a short list of the two named sites, and Choose ticks that card", async () => {
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
  await step("the request names the site picked and goes to it in one call, and the success card names it", async () => {
    await page.click("#pickContinue");
    await page.waitForSelector("#step3:not([hidden]) #requestSubmit");
    const summary = await page.textContent("#pickSummary");
    has(summary, "The site you picked: Site 3, Charlie Print, Bristol, United Kingdom.", "the summary names the site");
    has(summary, "Your request goes straight to this site. Contact details are exchanged once it accepts.", "the summary's hint");
    eq(await page.locator("#introTermsBlock").count(), 0, "no second terms block: the terms were accepted at the search");
    has(await page.textContent("#requestSubmit"), "Send my request to Charlie Print", "the button names the site");
    await page.click("#requestSubmit");
    await page.waitForSelector("#step3Body .success");
    const body = apiCalls(world, "POST /seeker-requests")[0].body;
    eq([body.search_id, body.listing_id], [77, "listing-c"], "the request's search and listing");
    eq(typeof body.client_key, "string", "a client key rides with it");
    eq(apiCalls(world, "POST /seeker-requests/picks").length, 0, "the retired picks route is never called");
    const success = await page.textContent("#step3Body .success");
    has(success, "Sent. Your request has gone to Charlie Print, who have 14 days to answer. We tell you as soon as they do.", "the success card");
    for (const leak of ["listing-", "HP MJF"]) if (success.includes(leak)) throw new Error(`the success card shows ${leak}`);
    return has(await page.getAttribute("#step3Body .success a.btn", "href"), "/hub/account/", "the account button");
  });
  await step("nothing passing the hard filters: the pool is the closest fits, not the nearest, and the three best are still named", async () => {
    /* Plan 067, Q1: the fallback pool is every listing, flagged, ranked by the
       same weighted score; the page must not call it "the nearest". */
    world.api["POST /listings/search"] = () => [200, { ok: true, search_id: 78, no_match: true, terms_version: 12,
      matches: MATCHES.map((c) => ({ ...c, no_match_flag: true })),
      seeker_point: { lat: 53.8, lng: -1.55 }, region: "uk", region_unknown: false }];
    await page.click("#findSubmit");
    await page.waitForSelector("#stepTerms:not([hidden]) #searchTick");
    await page.check("#searchTick");
    await page.click("#searchAccept");
    await page.waitForSelector("#step2:not([hidden]) #capGrid .cap");
    const intro = await page.textContent("#matchIntro");
    has(intro, "Nothing fits your ask exactly. These are the closest fits we have, wherever they are; the three best are named.", "the intro");
    has(intro, "One more site on the map", "the intro still counts the fourth");
    if (intro.includes("nearest")) throw new Error("the intro still says nearest");
    const note = await page.textContent("#noMatch");
    has(note, "No exact match yet. These are the closest fits we have; pick one you would still like to meet, or tell the desk and we will route it by hand.", "the no-match note");
    if (note.includes("nearest")) throw new Error("the note still says nearest");
    const names = await page.$$eval("#capGrid .cap h3", (els) => els.map((e) => e.textContent.trim()));
    return eq(names, ["Acme Orthotics", "Bravo Labs", "Charlie Print"], "the three best of the pool are named");
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

/* The host's "where you ship" picker (plan 055, decision 17): the world map
   above the region chips on both offer pages, a click on a region ticking
   its chip, the chips still the truth, Worldwide and Own country only as
   pills on the card and nowhere else. The vocabulary stub answers nothing,
   so this also proves the picker on the seed regions. */
async function walkOfferMap() {
  area = "Offering capacity: where you ship";
  for (const [hub, url] of [["3D Print Hub", `${PRINT}/offer.html`], ["Mill Hub", `${MILL}/offer.html`]]) {
    const world = newWorld({ user: USER });
    const { context, page, errors } = await visit(world);
    await page.goto(url);
    await page.waitForSelector("body[data-np-open]");
    await page.waitForSelector("#listingForm");
    const region = (term) => `#shipsTo input[data-region="${term}"]`;
    const lit = (term) => page.$eval(region(term), (b) => b.closest(".pick").classList.contains("is-on"));
    const onMap = (term) => page.$eval(`#shipsToMap g[data-region="${term}"]`, (g) => g.hasAttribute("data-on"));

    await step(`${hub}: the picker card sits above the chips, with its two pills and no second button`, async () => {
      await page.waitForSelector('#shipsToMap svg[data-mode="pick"]');
      const order = await page.evaluate(() => {
        const map = document.getElementById("shipsToMap"), chips = document.getElementById("shipsTo");
        return map.parentElement === chips.parentElement && !!(map.compareDocumentPosition(chips) & Node.DOCUMENT_POSITION_FOLLOWING);
      });
      eq(order, true, "the card comes first in the section");
      eq(await page.locator("#shipsTo input[data-region]").count(), 10, "the region chips");
      eq(await page.$$eval("#shipsToMap .wm-pill", (els) => els.map((e) => e.textContent.trim())), ["Worldwide", "Own country only"], "the pills");
      eq(await page.locator("#shipsToOwn").count(), 0, "the old Own country only button");
      return eq(await page.locator("#shipsTo input[data-region]:checked").count(), 0, "nothing ticked yet");
    });
    await step(`${hub}: a click on Europe ticks its chip, a second click unticks it`, async () => {
      await page.dispatchEvent('#shipsToMap g[data-region="europe"] path.wm-hit', "click");
      eq(await page.isChecked(region("europe")), true, "the Europe chip");
      eq(await lit("europe"), true, "the chip lights");
      eq(await onMap("europe"), true, "the region lights");
      await page.dispatchEvent('#shipsToMap g[data-region="europe"] path.wm-hit', "click");
      eq(await page.isChecked(region("europe")), false, "the Europe chip after the second click");
      eq(await lit("europe"), false, "the chip goes out");
      return eq(await onMap("europe"), false, "the region goes out");
    });
    await step(`${hub}: a chip ticked by hand lights its region, and Worldwide ticks everything`, async () => {
      await page.click(`${region("asia")} + span`);
      eq(await page.isChecked(region("asia")), true, "the Asia chip");
      eq(await onMap("asia"), true, "Asia on the map");
      await page.click('#shipsToMap .wm-pill:has-text("Worldwide")');
      eq(await page.locator("#shipsTo input[data-region]:checked").count(), 10, "every chip ticked");
      eq(await page.$eval('#shipsToMap .wm-pill:has-text("Worldwide")', (e) => e.classList.contains("is-on")), true, "the pill lit");
      await page.click(`${region("africa")} + span`);
      eq(await page.isChecked(region("africa")), false, "Africa unticked");
      eq(await page.isChecked(region("worldwide")), false, "Worldwide unticked with it");
      return eq(await page.$eval('#shipsToMap .wm-pill:has-text("Worldwide")', (e) => e.classList.contains("is-on")), false, "the pill goes out");
    });
    await step(`${hub}: Own country only leaves the account's own region ticked`, async () => {
      await page.click('#shipsToMap .wm-pill:has-text("Own country only")');
      const on = await page.$$eval("#shipsTo input[data-region]:checked", (els) => els.map((e) => e.getAttribute("data-region")));
      eq(on, ["uk"], "the chips ticked for United Kingdom");
      eq(await onMap("uk"), true, "the UK lit on the map");
      return eq(await onMap("europe"), false, "Europe not lit");
    });
    clean(world, errors, `${hub}: the ship picker`);
    await context.close();
  }
}

/* The membership beside the Host Agreement, the name line, and an edit as a
   change (plan 068, D4, D6, D7 of the register of 20 Oct 2026): a first
   listing chooses yearly or monthly before the tick; a billed site is told
   nothing more is to choose; an edit saves and says what went live and what
   waits (a mixed save waiting in full, P1); a pending edit shows the change
   table. The 3D Print Hub page carries all of it; the Mill Hub loads the same
   module, and walkOfferMap proves both pages render the form. */
async function walkOfferCommit() {
  area = "Offering capacity: the membership, the name, and an edit as a change";
  const MINE_NONE = { ok: true, listing: null, live: null, pending: null, status: "none", host_terms_accepted_version_id: null,
    membership: { billed: false, period: null, rate: null }, pending_changes: [] };
  const LIVE_REV = { id: 2, listing_id: "listing-1", revision_no: 2, status: "approved", address_line: "1 Works Road", town: "Leeds",
    postcode: "LS1 1AA", country: "United Kingdom", lat: 53.8, lng: -1.55, geocoded_at: "2026-10-01T09:00:00Z", ships_to: ["uk"],
    services: [], quality_notes: "ISO 13485", billing_period: "annual", attributes: {}, materials_all: ["pa12_nylon12"],
    processes_all: ["mjf"], min_lead_time_days: 5, submitted_at: "2026-10-01T09:00:00Z",
    machines: [{ revision_id: 2, position: 0, name: "HP MJF 5200", materials: ["pa12_nylon12"], count: 2, lead_time_days: 5,
      notes: null, attributes: { monthly_capacity: 400 } }] };
  const MINE_LIVE = { ok: true, listing: { id: "listing-1", hub: "print", status: "live" }, live: LIVE_REV, pending: null,
    status: "live", host_terms_accepted_version_id: 12, membership: { billed: true, period: "annual", rate: 1000 }, pending_changes: [] };
  const open = async (mine) => {
    const world = newWorld({ user: USER });
    world.api["GET /listings/mine"] = () => [200, mine];
    const { context, page, errors } = await visit(world);
    await page.goto(`${PRINT}/offer.html`);
    await page.waitForSelector("body[data-np-open]");
    await page.waitForSelector("#listingForm");
    return { world, context, page, errors };
  };
  const fillFirst = async (page) => {
    await page.fill("#siteTown", "Leeds");
    await page.fill("#siteCountry", "United Kingdom"); await page.press("#siteCountry", "Enter");
    await page.click('#shipsTo input[data-region="uk"] + span');
    await page.fill("#m-1-machine", "HP MJF 5200"); await page.press("#m-1-machine", "Enter");
    await page.fill("#m-1-materials", "PA12"); await page.press("#m-1-materials", "Enter");
    await page.fill("#m-1-lead", "5");
    await page.fill("#m-1-capacity", "400");
    await page.waitForSelector("#hostTick");
    await page.check("#hostTick");
  };
  const posted = (world) => apiCalls(world, "POST /listings");

  // 1. a first listing
  {
    const { world, context, page, errors } = await open(MINE_NONE);
    await step("the membership panel sits beside the Host Agreement, before it, with Yearly and Monthly and neither ticked", async () => {
      await page.waitForSelector("#hostCommit #hostMembership");
      await page.waitForSelector("#hostCommit #hostTermsBlock .terms-scroll");
      const order = await page.evaluate(() => {
        const box = document.getElementById("hostCommit"), m = document.getElementById("hostMembership"), t = document.getElementById("hostTermsBlock");
        return m.parentElement === box && t.parentElement === box && !!(m.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING);
      });
      eq(order, true, "the membership first, the terms beside it, both in #hostCommit");
      eq(await page.locator('#hostMembership input[name="billing"]').count(), 2, "the two choices");
      eq(await page.locator('#hostMembership input[name="billing"]:checked').count(), 0, "nothing ticked yet");
      const panel = await page.textContent("#hostMembership");
      has(panel, "1,000 a year", "the yearly price"); has(panel, "100 a month", "the monthly price");
      has(panel, "invoiced in pounds", "the currency");
      return has(panel, "covers hosting on both the 3D Print Hub and the Mill Hub", "one fee, both hubs");
    });
    await step("the Site name says it is shown to seekers who have accepted the introduction terms", async () =>
      has(await page.textContent("#listingForm"), "shown to seekers who have accepted the introduction terms", "the name line"));
    await step("submitting without a choice says Choose yearly or monthly hosting. and posts nothing", async () => {
      await fillFirst(page);
      await page.click("#listingSubmit");
      await page.waitForSelector("#listingErr:not([style*='display: none'])");
      has(await page.textContent("#listingErr"), "Choose yearly or monthly hosting.", "the error line");
      return eq(posted(world).length, 0, "posts");
    });
    await step("choosing Monthly sends billing_period monthly and the page says thank you", async () => {
      world.api["POST /listings"] = () => [200, { ok: true, listing_id: "listing-1", revision_id: 1, revision_no: 1, status: "pending", geocoded: true }];
      await page.click('#hostMembership input[value="monthly"] + span');
      eq(await page.$eval('#hostMembership input[value="monthly"]', (b) => b.closest(".pick").classList.contains("is-on")), true, "the pill lights");
      await page.click("#listingSubmit");
      await until(() => posted(world).length > 0, "the POST");
      eq(posted(world)[0].body.billing_period, "monthly", "the period sent");
      await page.waitForSelector("#hostAppBody .success");
      return has(await page.textContent("#hostAppBody"), "Nothing is listed until we have checked it", "the thank-you");
    });
    clean(world, errors, "the first listing's form");
    await context.close();
  }

  // 2. a billed site (a Mill host listing on the 3D Print Hub)
  {
    const { world, context, page, errors } = await open({ ...MINE_NONE, membership: { billed: true, period: "monthly", rate: 100 } });
    await step("a billed site is told its membership covers both hubs, with nothing to choose", async () => {
      await page.waitForSelector("#hostMembership");
      const panel = await page.textContent("#hostMembership");
      has(panel, "covers both", "one fee"); has(panel, "nothing more to choose", "nothing to choose");
      has(panel, "100 a month", "the membership it has");
      return eq(await page.locator('#hostMembership input[name="billing"]').count(), 0, "no radios");
    });
    await step("its submission carries no billing_period", async () => {
      world.api["POST /listings"] = () => [200, { ok: true, listing_id: "listing-2", revision_id: 1, revision_no: 1, status: "pending", geocoded: true }];
      await fillFirst(page);
      await page.click("#listingSubmit");
      await until(() => posted(world).length > 0, "the POST");
      return eq("billing_period" in posted(world)[0].body, false, "billing_period in the body");
    });
    clean(world, errors, "the billed site's form");
    await context.close();
  }

  // 3. an edit made only of a lead time: live on save
  {
    const { world, context, page, errors } = await open(MINE_LIVE);
    await step("editing a live listing: the intro says what goes live on save, the button says Save changes, the membership is a statement", async () => {
      has(await page.textContent("#hostAppBody"), "goes live when you save it", "the intro line");
      eq((await page.textContent("#listingSubmit")).trim(), "Save changes", "the button");
      const panel = await page.textContent("#hostMembership");
      has(panel, "Your membership", "the heading"); has(panel, "yearly, 1,000 a year", "the membership on record");
      has(panel, "To change how you pay", "the route to change it");
      eq(await page.locator('#hostMembership input[name="billing"]').count(), 0, "no radios on an edit");
      return has(await page.textContent("#hostTermsBlock"), "still applies", "the accepted agreement");
    });
    await step("a lead time saved alone is Live now, and the page says everything is live", async () => {
      world.api["POST /listings"] = () => [200, { ok: true, listing_id: "listing-1", revision_id: 3, live_revision_id: 3, revision_no: 3, status: "live", geocoded: true,
        live_now: [{ field: "lead_time_days", machine: "HP MJF 5200", before: 5, after: 4, review: false }], waiting: [] }];
      await page.fill("#m-1-lead", "4");
      await page.click("#listingSubmit");
      await until(() => posted(world).length > 0, "the POST");
      const body = posted(world)[0].body;
      eq(body.machines[0].lead_time_days, 4, "the lead time sent");
      eq("billing_period" in body, false, "no period on an edit");
      await page.waitForSelector("#hostAppBody .success");
      const text = await page.textContent("#hostAppBody");
      has(text, "Saved.", "the heading"); has(text, "Live now", "the live list");
      has(text, "Lead time on HP MJF 5200: now 4 days (was 5)", "the line");
      has(text, "Everything you changed is live.", "the sentence");
      return eq(text.includes("Waiting for review"), false, "no waiting list");
    });
    clean(world, errors, "the edit that went live");
    await context.close();
  }

  // 4. an edit that mixes a lead time with a new machine: waits in full (P1)
  {
    const { world, context, page, errors } = await open(MINE_LIVE);
    await step("a lead time saved with a new printer waits in full: every line under Waiting for review, nothing Live now", async () => {
      world.api["POST /listings"] = () => [200, { ok: true, listing_id: "listing-1", revision_id: 3, live_revision_id: 2, revision_no: 3, status: "pending", geocoded: true,
        live_now: [], waiting: [{ field: "lead_time_days", machine: "HP MJF 5200", before: 5, after: 4, review: false },
          { field: "machine_added", machine: "Form 4", before: null, after: { name: "Form 4", materials: ["resin_sla"] }, review: true }] }];
      await page.fill("#m-1-lead", "4");
      await page.click("#addMachineRow");
      await page.fill("#m-2-machine", "Form 4"); await page.press("#m-2-machine", "Enter");
      await page.fill("#m-2-materials", "Resin SLA"); await page.press("#m-2-materials", "Enter");
      await page.fill("#m-2-lead", "3");
      await page.fill("#m-2-capacity", "50");
      await page.click("#listingSubmit");
      await until(() => posted(world).length > 0, "the POST");
      eq(posted(world)[0].body.machines.length, 2, "two machines sent");
      await page.waitForSelector("#hostAppBody .success .ldiff");
      const text = await page.textContent("#hostAppBody");
      has(text, "Waiting for review", "the waiting heading");
      const rows = await page.$$eval("#hostAppBody .ldiff tbody tr", (trs) => trs.map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent.trim())));
      eq(rows, [["Lead time on HP MJF 5200", "5 days", "4 days"], ["New printer", "none", "Form 4"]], "the table: the lead time waits too, and the new printer");
      has(text, "holds back the other changes saved with it", "why the whole update waits");
      return eq(text.includes("Live now"), false, "nothing live now");
    });
    clean(world, errors, "the mixed save");
    await context.close();
  }

  // 5. a pending edit, on return
  {
    const pending = { ...LIVE_REV, id: 3, revision_no: 3, status: "pending", town: "Bradford" };
    const world = newWorld({ user: USER });
    world.api["GET /listings/mine"] = () => [200, { ...MINE_LIVE, pending, status: "live_pending_edit",
      pending_changes: [{ field: "town", before: "Leeds", after: "Bradford", review: true }] }];
    const { context, page, errors } = await visit(world);
    await page.goto(`${PRINT}/offer.html`);
    await page.waitForSelector("body[data-np-open]");
    await step("a pending edit shows the change table, Town from Leeds to Bradford, and not the whole pending revision again", async () => {
      await page.waitForSelector("#hostAppBody .ldiff");
      const text = await page.textContent("#hostAppBody");
      has(text, "Under review. Your listing stays as it is until we have approved these changes", "the lock line");
      has(text, "Live now", "the live summary"); has(text, "Waiting for review", "the waiting heading");
      const cells = await page.$$eval("#hostAppBody .ldiff tbody tr:first-child td", (els) => els.map((e) => e.textContent.trim()));
      eq(cells, ["Town", "Leeds", "Bradford"], "the row");
      return eq(text.split("1 Works Road").length - 1, 1, "the address printed once, under Live now");
    });
    clean(world, errors, "the pending edit");
    await context.close();
  }
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
      // Plan 055, decision 8: one list, newest first, so the requests are dated before the offer.
      requests: [
        { id: 3, ref: "PS-0046", hub: "print", material: "pa12_nylon12", quantity: 500, cadence: "recurring", status: "picked",
          created_at: "2026-10-01T09:00:00Z", no_match: false,
          picks: [{ introduction_id: 8, ref: "INTRO-0008", stage: "proposed", card: { company: "Acme Orthotics", town: "Leeds", country: "United Kingdom", materials: ["pa12_nylon12"], services: ["finishing_dyeing"],
            machines: [{ name: "HP MJF 5200", materials: ["pa12_nylon12"], count: 2, lead_time_days: 5 }] } },
            { introduction_id: 9, ref: "INTRO-0009", stage: "introduced", card: { town: "Derby", country: "United Kingdom", materials: ["pa12_nylon12"] } },
            { introduction_id: 10, ref: "INTRO-0010", stage: "awaiting_acceptance", card: { town: "Hull", country: "United Kingdom", materials: ["pa12_nylon12"] } }] },
        { id: 4, ref: "MS-0047", hub: "mill", material: "pa12_nylon12", quantity: 200, cadence: "once", status: "open",
          created_at: "2026-10-02T09:00:00Z", no_match: false, picks: [] },
        // Plan 052, item 3: a hand-routed request still carries no_match; its pick must show.
        { id: 5, ref: "PS-0048", hub: "print", material: "pa12_nylon12", quantity: 60, cadence: "once", status: "open",
          created_at: "2026-10-03T09:00:00Z", no_match: true,
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
    const blocks = await page.$$eval("#introductions .acct-pick", (els) => els.map((e) => e.textContent));
    const block = blocks.find((b) => b.includes("INTRO-0008")) || "";
    for (const bad of ["_", "[object Object]"]) if (blocks.join(" ").includes(bad)) throw new Error(`the picks block shows ${bad}: ${blocks.join(" | ")}`);
    has(block, "HP MJF 5200", "the machine name");
    has(block, "PA12", "the labelled material");
    has(block, "Services", "the services row");
    /* plan 067: the seeker saw the site's name at the search, so its pick is named */
    has(block, "Acme Orthotics", "the site's name on the pick");
    const text = await page.textContent("#introductions");
    has(text, "The site you picked", "the picks heading");
    if (text.includes("What we put forward")) throw new Error("the account page still says What we put forward");
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
  await step("one Introductions list, newest first, with no What you asked for or Asked of you headings (plan 055, decision 8)", async () => {
    await page.waitForSelector("#introductions:not([hidden])");
    has(await page.textContent("#introductions .hint"), "Once both sides have accepted, the introduction arrives in your inbox, and is listed below.", "the hint");
    const subs = await page.$$eval("#introductions .acct-sub", (els) => els.map((e) => e.textContent.trim()));
    for (const gone of ["What you asked for", "Asked of you", "Everything else"]) if (subs.includes(gone)) throw new Error(`the sub-heading ${gone} is still there`);
    const order = await page.$$eval("#introductions > .acct-card, #introductions > .acct-row", (els) => els.map((e) => e.id || e.querySelector("h3").textContent.trim()));
    eq(order[0], "intro-7", "the newest item (the offer, dated today)");
    has(order[1], "INTRO-0011", "the next newest (the request of 3 October)");
    eq(order.length, 4, "items in the list");
  });
  await step("the account is on both sides, so each card carries a side tag: You asked, or Asked of you", async () => {
    const tags = await page.$$eval("#introductions .acct-tag", (els) => els.map((e) => e.textContent.trim()));
    eq(tags.filter((x) => x === "Asked of you").length, 1, "Asked of you tags");
    eq(tags.filter((x) => x === "You asked").length, 3, "You asked tags");
    eq(await page.$eval("#intro-7 .acct-tag", (e) => e.textContent.trim()), "Asked of you", "the offer's tag");
  });
  await step("an offer waiting on the provider shows, with a way to have the email sent again", async () => {
    await page.waitForSelector("#introductions:not([hidden])");
    has(await page.textContent("#introductions"), "INT-0007", "the introductions section");
    has(await page.textContent('[data-act="intro-resend"][data-intro="7"]'), "Send the email again", "the button");
    return (await page.locator('[data-act="intro-resend"][data-intro="7"]').count()) === 1;
  });
  await step("Waiting on you heads the reading column beside the rail and names the one open action, Answer 1 introduction, lit (plan 055, decision 10)", async () => {
    await page.waitForSelector("#waiting:not([hidden])");
    eq(await page.evaluate(() => document.getElementById("profile").previousElementSibling.id), "goHub", "the banner sits beside the Go to the Global Portal button");
    eq(await page.evaluate(() => document.querySelector(".acct-main .acct-section:not([hidden])").id), "waiting", "the first section of the reading column");
    has(await page.textContent("#waiting .hint"), "What needs your answer.", "the hint");
    const acts = await page.$$eval("#waiting .acct-action", (els) => els.map((e) => ({ text: e.textContent.replace(/\s+/g, " ").trim(), top: e.classList.contains("is-top"), href: e.getAttribute("href") })));
    eq(acts.length, 1, "actions");
    has(acts[0].text, "Answer 1 introduction", "the action");
    eq(acts[0].top, true, "the top action is lit");
    eq(acts[0].href, "#intro-7", "where it goes");
  });
  await step("the Answer action scrolls to the offer's row and marks it", async () => {
    await page.click("#waiting .acct-action.is-top");
    await page.waitForSelector("#intro-7.is-attention");
    // the page scrolls smoothly, so the row arrives over a few frames
    await page.waitForFunction(() => { const r = document.getElementById("intro-7").getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight; });
    eq(new URL(page.url()).hash, "#intro-7", "the address");
  });
  await step("the page's own links: a dot on Waiting on you, Account settings last, and no You or Users (plan 055)", async () => {
    const links = await page.$$eval("#acctNav a", (els) => els.map((e) => ({ text: e.textContent.trim(), href: e.getAttribute("href"), dot: !!e.querySelector(".acct-nav__dot") })));
    eq(links.map((l) => l.text), ["Your site", "Waiting on you", "Introductions", "Declarations", "Fees and standing", "Education", "Account settings"], "the links");
    eq(links.filter((l) => l.dot).map((l) => l.text), ["Waiting on you"], "the dotted link");
    eq(new URL(links.at(-1).href, page.url()).pathname, "/hub/account/settings/", "where Account settings goes");
  });
  await step("the banner offers Edit account or add users, to the settings page, and no picture buttons", async () => {
    has(await page.textContent("#profile a.acct-edit"), "Edit account or add users", "the link");
    eq(new URL(await page.getAttribute("#profile a.acct-edit", "href"), page.url()).pathname, "/hub/account/settings/", "where it goes");
    eq(await page.locator('#profile [data-act^="avatar"], #profile [data-act^="logo"]').count(), 0, "picture buttons on the banner");
  });
  await step("the Edit account link sits under the logo, lined up with its left edge", async () => {
    const pic = await page.locator("#acctPic").boundingBox();
    const btn = await page.locator("#profile a.acct-edit").boundingBox();
    eq(Math.round(btn.x), Math.round(pic.x), "the link's left edge");
    eq(btn.y >= pic.y + pic.height, true, "the link is below the logo");
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
    await step("the page opens with Go to the Global Portal under the title, and no More of the network", async () => {
      await page.waitForSelector("body[data-np-open]");
      await page.waitForSelector("#profile:not([hidden])");
      has(await page.textContent("#goHub"), "Go to the Global Portal", "the button");
      eq(new URL(await page.getAttribute("#goHub", "href"), page.url()).pathname, "/hub/index.html", "where it goes");
      eq(await page.locator("#more").count(), 0, "More of the network sections");
      eq(apiCalls(world, "GET /opportunities/briefs").length, 0, "briefs reads");
    });
    await step("Waiting on you is its one open action, List your site or ask a hub, lit, and it leaves the page for the door (plan 046, plan 055)", async () => {
      await page.waitForSelector("#waiting:not([hidden])");
      eq(await page.evaluate(() => document.getElementById("profile").previousElementSibling.id), "goHub", "the banner sits beside the Go to the Global Portal button");
      eq(await page.evaluate(() => document.querySelector(".acct-main .acct-section:not([hidden])").id), "waiting", "the first section of the reading column");
      eq(await page.locator("#acctNeeds").count(), 0, "the old Next step block");
      const links = await page.locator("#waiting .acct-action").all();
      eq(links.length, 1, "actions");
      has(await links[0].textContent(), "List your site, or ask a hub for what you need", "the action");
      eq(await links[0].getAttribute("class"), "acct-action is-top", "the one action is the lit one");
      eq(new URL(await links[0].getAttribute("href"), page.url()).pathname, "/hub/index.html", "where the line goes");
      has(await links[0].textContent(), "arrow_forward", "the trailing arrow");
      has(await page.textContent("#introductions"), "No introductions yet. Ask a hub for what you need, or list your site, and they appear here.", "the empty list");
    });
    clean(world, errors, "the new account's page");
    await context.close();
  }

  area = "The account page (nothing waiting)";
  {
    // Plan 055, decision 10: Waiting on you is never empty. A host with its
    // listing live and nothing due reads one line; a seeker with a request in
    // and nothing to answer reads the other.
    const host = newWorld({ user: USER, summary: Object.assign({}, EMPTY_SUMMARY, {
      org: { id: 41, name: "ZZ Walk Test Ltd", role: "owner", sub_status: "trial", host_print: "approved", host_mill: "none" },
      site: { org_id: 41, name: "ZZ Walk Test Ltd", town: "Leeds", country: "United Kingdom", host_print: "approved", host_mill: "none", verified: true },
      listings: [{ hub: "print", status: "live", live: { approved_at: "2026-10-01T09:00:00Z" } }],
      relationships: [{ introduction_id: 42, ref: "INTRO-0042", hub: "print", since: "2026-11-03T10:00:00Z" }],
      hubs_used: ["print"],
    }) });
    const seeker = newWorld({ user: USER, summary: Object.assign({}, EMPTY_SUMMARY, {
      org: { id: 41, name: "ZZ Walk Test Ltd", role: "owner", sub_status: "none", host_print: "none", host_mill: "none" },
      requests: [{ id: 3, ref: "PS-0050", hub: "print", material: "pa12_nylon12", quantity: 10, cadence: "once", status: "open",
        created_at: "2026-10-03T09:00:00Z", no_match: false, picks: [] }],
      hubs_used: ["print"],
    }) });
    for (const [who, world, line] of [["a host", host, "Nothing waiting on you. Your listing is live; introductions appear below as they arrive."],
      ["a seeker", seeker, "Nothing waiting on you. Ask a hub for what you need when you are ready."]]) {
      const { context, page, errors } = await visit(world);
      await page.goto(`${APEX}/hub/account/`);
      await step(`${who} with nothing due reads the never-empty line, and the nav carries no dot`, async () => {
        await page.waitForSelector("#waiting:not([hidden])");
        eq((await page.textContent("#waiting .acct-quiet")).trim(), line, "the line");
        eq(await page.locator("#waiting .acct-action").count(), 0, "actions");
        eq(await page.locator("#acctNav .acct-nav__dot").count(), 0, "dots");
      });
      if (who === "a host") await step("a host's Fees and standing lists its introduced customers with the day each relationship began (plan 055, decision 20)", async () => {
        await page.waitForSelector("#fees:not([hidden])");
        const subs = await page.$$eval("#fees .acct-sub", (els) => els.map((e) => e.textContent.trim()));
        eq(subs, ["Introduced customers", "Statements", "Open strikes"], "the sub-headings, in order");
        const text = await page.textContent("#fees .acct-list");
        has(text, "INTRO-0042", "the ref");
        has(text, "Relationship since 3 Nov 2026", "the since line");
      });
      clean(world, errors, `${who}'s quiet page`);
      await context.close();
    }
  }

  area = "The account page (a declared order to confirm)";
  {
    const soon = new Date(Date.now() + 3 * 864e5).toISOString();
    const world = newWorld({ user: USER, summary: Object.assign({}, EMPTY_SUMMARY, {
      org: { id: 41, name: "ZZ Walk Test Ltd", role: "owner", sub_status: "trial", host_print: "approved", host_mill: "none" },
      site: { org_id: 41, name: "ZZ Walk Test Ltd", town: "Leeds", country: "United Kingdom", host_print: "approved", host_mill: "none", verified: true },
      introductions: [{ id: 7, ref: "INTRO-0007", hub: "print", stage: "awaiting_acceptance", seeker_request_id: 3, accepted_a_at: null,
        accepted_b_at: null, acceptance_expires_at: soon, declined_at: null, created_at: new Date().toISOString(), role: "provider", introduced_at: null }],
      offers: [{ introduction_id: 7, ref: "INTRO-0007", hub: "print", acceptance_expires_at: soon,
        request: { material: "pa12_nylon12", quantity: 40, cadence: "one_off", town: "Bristol", country: "United Kingdom" } }],
      declarations: { due_state: "none", history: [], awaiting_my_confirmation: [
        { line_id: 55, ref: "INTRO-0008", period: "2026-09", units: 40, value: 1200, currency: "GBP", declared_at: "2026-10-02T09:00:00Z" }] },
      hubs_used: ["print"],
    }) });
    world.api["POST /declarations/lines/:id/confirm"] = () => [200, { ok: true }];
    const { context, page, errors } = await visit(world);
    await page.goto(`${APEX}/hub/account/`);
    await step("Waiting on you lists the open actions in order: Answer the introduction first, lit, then Confirm the declared order", async () => {
      await page.waitForSelector("#waiting:not([hidden])");
      const acts = await page.$$eval("#waiting .acct-action", (els) => els.map((e) => ({ text: e.querySelector("span:nth-child(2)").textContent.trim(), top: e.classList.contains("is-top") })));
      eq(acts.map((a) => a.text), ["Answer 1 introduction", "Confirm 1 declared order"], "the actions");
      eq(acts.map((a) => a.top), [true, false], "only the top one is lit");
      eq(await page.locator("#orders").count(), 0, "the old orders section");
      eq(await page.$$eval("#acctNav a", (els) => els.filter((e) => e.querySelector(".acct-nav__dot")).map((e) => e.textContent.trim())), ["Waiting on you"], "the dotted link");
    });
    await step("the declared line is answered inside Waiting on you: Confirm posts to the line, and says so", async () => {
      has(await page.textContent("#waiting .acct-sub"), "Declared orders to confirm", "the sub-heading");
      eq(await page.locator('#waiting [data-act="line-confirm"][data-line="55"]').count(), 1, "Confirm buttons");
      eq(await page.locator('#waiting [data-act="line-query"][data-line="55"]').count(), 1, "Query buttons");
      has(await page.textContent("#line-55"), "INTRO-0008", "the line's ref");
      has(await page.textContent("#line-55"), "September 2026", "the line's period");
      await page.click('#waiting [data-act="line-confirm"][data-line="55"]');
      await until(() => apiCalls(world, "POST /declarations/lines/55/confirm").length === 1, "the confirm post");
      await page.waitForSelector("#lineMsg-55:not([hidden])");
      has(await page.textContent("#lineMsg-55"), "Confirmed. Thank you.", "the message");
    });
    clean(world, errors, "the page with a declared order to confirm");
    await context.close();
  }
}

/* The account's logo (plan 055, decision 25; once the profile picture of plan
   052 task 3.5): added, changed and removed on the settings page, and shown
   where the monogram was on both pages. The settings page crops to a square
   and sends a JPEG; the worker answers a signed link, here a data: URL so the
   logo really draws without reaching past the stubs. */
const PIXEL_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PIXEL_URL = `data:image/png;base64,${PIXEL_PNG}`;
async function walkLogo() {
  area = "The account settings page: the logo";
  const world = newWorld({ user: USER });
  const { context, page, errors } = await visit(world);
  await page.goto(`${APEX}/hub/account/settings/`);
  await step("the settings page opens with its heading, its lede and the way back, and no dashboard or map script", async () => {
    await page.waitForSelector("body[data-np-open]");
    has(await page.textContent("h1"), "Account settings", "the heading");
    has(await page.textContent(".acct-head p"), "The account's logo, your own details, and who signs in.", "the lede");
    eq(new URL(await page.getAttribute("#backToAccount", "href"), page.url()).pathname, "/hub/account/", "where Back to your account goes");
    eq(await page.$$eval("script[src]", (els) => els.map((e) => e.getAttribute("src")).filter((s) => /dashboard|leaflet|match-map/.test(s))), [], "scripts the page has no use for");
  });
  await step("with no logo the Logo card shows the monogram and offers Add a logo", async () => {
    await page.waitForSelector("#logo:not([hidden])");
    await until(() => apiCalls(world, "GET /account/logo").length === 1, "the logo read");
    has(await page.textContent("#logo .hint"), "Shown on your account for everyone who signs in to it.", "the hint");
    eq((await page.textContent("#logo .acct-mono")).trim(), "ZW", "the monogram");
    eq(await page.locator("#logo img.acct-mono").count(), 0, "logos");
    has(await page.textContent('[data-act="logo-pick"]'), "Add a logo", "the button");
    return await page.isHidden('[data-act="logo-remove"]');
  });
  await step("a file the worker refuses says so, and the monogram stays", async () => {
    world.api["POST /account/logo"] = () => [400, { error: "not_an_image" }];
    await page.setInputFiles("#logoFile", { name: "logo.png", mimeType: "image/png", buffer: Buffer.from(PIXEL_PNG, "base64") });
    await page.waitForSelector("#logoMsg:not([hidden])");
    has(await page.textContent("#logoMsg"), "Choose a PNG or JPEG picture.", "the message");
    return (await page.locator("#logo img.acct-mono").count()) === 0;
  });
  await step("a logo chosen is sent once, squared as a JPEG, and replaces the monogram", async () => {
    world.api["POST /account/logo"] = (w) => { w.logo = PIXEL_URL; return [200, { ok: true, url: PIXEL_URL, expires_in: 60 }]; };
    await page.setInputFiles("#logoFile", { name: "logo.png", mimeType: "image/png", buffer: Buffer.from(PIXEL_PNG, "base64") });
    await page.waitForSelector("#logo img.acct-mono");
    const sent = apiCalls(world, "POST /account/logo");
    eq(sent.length, 2, "uploads (the refused one and this one)");
    has(String(sent[1].body && sent[1].body.image).slice(0, 23), "data:image/jpeg;base64,", "what was sent");
    eq(await page.getAttribute("#logo img.acct-mono", "src"), PIXEL_URL, "the logo shown");
    eq(await page.evaluate(() => document.querySelector("#logo img.acct-mono").naturalWidth), 1, "the logo drew");
    has(await page.textContent('[data-act="logo-pick"]'), "Change logo", "the button");
    return await page.isVisible('[data-act="logo-remove"]');
  });
  await step("Remove logo asks the worker once and puts the monogram back", async () => {
    world.api["POST /account/logo/remove"] = (w) => { w.logo = null; return [200, { ok: true }]; };
    await page.click('[data-act="logo-remove"]');
    await page.waitForSelector("#logo span.acct-mono");
    eq(apiCalls(world, "POST /account/logo/remove").length, 1, "removes");
    eq((await page.textContent("#logo .acct-mono")).trim(), "ZW", "the monogram");
    has(await page.textContent('[data-act="logo-pick"]'), "Add a logo", "the button");
    return await page.isHidden('[data-act="logo-remove"]');
  });
  clean(world, errors, "the logo");
  await context.close();

  area = "The account page: a logo already there";
  {
    const world = newWorld({ user: USER, logo: PIXEL_URL, summary: Object.assign({}, EMPTY_SUMMARY) });
    const { context, page, errors } = await visit(world);
    await page.goto(`${APEX}/hub/account/`);
    await step("the account page opens with the logo where the monogram was, read once, and only the settings link beside it", async () => {
      await page.waitForSelector("#profile img.acct-mono");
      eq(await page.getAttribute("#profile img.acct-mono", "src"), PIXEL_URL, "the logo shown");
      eq(apiCalls(world, "GET /account/logo").length, 1, "logo reads");
      eq(apiCalls(world, "GET /account/avatar").length, 0, "reads of the old picture route");
      eq(await page.locator("#profile input[type=file]").count(), 0, "file inputs on the banner");
    });
    await step("the settings page shows the same logo and offers Change logo", async () => {
      await page.goto(`${APEX}/hub/account/settings/`);
      await page.waitForSelector("#logo img.acct-mono");
      eq(await page.getAttribute("#logo img.acct-mono", "src"), PIXEL_URL, "the logo shown");
      return has(await page.textContent('[data-act="logo-pick"]'), "Change logo", "the button");
    });
    clean(world, errors, "the pages with a logo");
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
  // Plan 055, decision 7: the worker sends an offer for every provider introduction, whatever its stage.
  const offer = (id) => ({ introduction_id: id, ref: `INTRO-000${id}`, hub: "print", acceptance_expires_at: id === 8 ? null : soon,
    request: { material: "pa12_nylon12", process: "mjf", quantity: 40, cadence: "one_off", max_lead_time_days: 10, needed_by: "2026-11-03",
      services: ["finishing_dyeing"], notes: "Pairs, boxed per patient.", town: "Bristol", country: "United Kingdom", point: { lat: 51.45, lng: -2.59 } },
    site: { town: "Leeds", country: "United Kingdom", point: { lat: 53.8, lng: -1.55 } } });
  const summary = (intros, offers) => Object.assign({}, EMPTY_SUMMARY, {
    org: { id: 41, name: "ZZ Walk Test Ltd", role: "owner", sub_status: "trial", founding: true, host_print: "approved", host_mill: "none", fee_exempt_note: null },
    site: { org_id: 41, name: "ZZ Walk Test Ltd", town: "Leeds", country: "United Kingdom", host_print: "approved", host_mill: "none",
      sub_status: "trial", founding: true, paused: false, removed: false, verified: true },
    introductions: intros, offers, hubs_used: ["print"],
  });
  const world = newWorld({
    user: USER,
    summary: summary([intro(7), intro(9), intro(8, { stage: "introduced", accepted_a_at: "2026-10-07T10:00:00Z",
      introduced_at: "2026-10-07T10:00:00Z", acceptance_expires_at: null })], [offer(7), offer(9), offer(8)]),
  });
  world.api["POST /introductions/accept"] = (w) => {
    w.summary = summary([intro(7, { stage: "introduced", accepted_a_at: "2026-10-08T12:00:00Z",
      introduced_at: "2026-10-08T12:00:00Z", acceptance_expires_at: null }), intro(9)], [offer(7), offer(9)]);
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
  await step("an open offer carries the pair map: the request's town and your site, two pins, nothing to choose (plan 052, item 24)", async () => {
    await page.waitForSelector("#pairMap-7:not([hidden]) .np-pin");
    const pins = await page.$$eval("#pairMap-7 .np-pin", (els) => els.map((e) => ({ text: e.textContent.trim(), cls: e.className })));
    eq(pins.filter((p) => /np-pin--you/.test(p.cls)).map((p) => p.text), ["You"], "the provider's pin");
    eq(pins.filter((p) => /np-pin--ask/.test(p.cls)).map((p) => p.text), ["Request"], "the request's pin");
    const titles = await page.$$eval("#pairMap-7 .leaflet-marker-icon", (els) => els.map((e) => e.getAttribute("title") || ""));
    has(titles.join(" | "), "Leeds", "the site's town in a pin title");
    has(titles.join(" | "), "Bristol", "the request's town in a pin title");
    eq(await page.locator("#pairMap-7 [data-choose]").count(), 0, "Choose buttons on the pair map");
    eq(await page.locator("#introductions .acct-tag").count(), 0, "side tags on an account that is only asked");
  });
  await step("the need box is open on the Request pin: what they need, row by row, inside the map, with no close button (plan 055, decision 7)", async () => {
    await page.waitForSelector("#pairMap-7 .leaflet-popup .np-need");
    const need = await page.$eval("#pairMap-7 .leaflet-popup .np-need", (e) => ({
      head: e.querySelector(".np-need__head").textContent, where: e.querySelector(".np-need__where").textContent,
      rows: [...e.querySelectorAll("dt")].map((dt) => [dt.textContent, dt.nextElementSibling.textContent]),
      notes: (e.querySelector(".np-need__notes") || {}).textContent || "" }));
    eq(need.head, "What they need", "the box's title");
    eq(need.where, "Bristol, United Kingdom", "the request's town");
    eq(need.rows.map((r) => r[0]), ["Material", "Process", "Quantity", "Cadence", "Lead time", "Needed by", "Services"], "the rows");
    const by = Object.fromEntries(need.rows);
    eq(by.Quantity, "40 units", "the quantity");
    eq(by.Cadence, "One off", "the cadence");
    eq(by["Lead time"], "within 10 days", "the lead time");
    eq(by["Needed by"], "3 Nov 2026", "the date");
    for (const v of Object.values(by)) if (v.includes("_")) throw new Error(`a raw term in the box: ${v}`);
    has(need.notes, "Pairs, boxed per patient.", "the notes");
    eq(await page.locator("#pairMap-7 .leaflet-popup-close-button").count(), 0, "close buttons");
    const map = await page.locator("#pairMap-7").boundingBox();
    const pop = await page.locator("#pairMap-7 .leaflet-popup").boundingBox();
    if (pop.y < map.y || pop.y + pop.height > map.y + map.height || pop.x < map.x || pop.x + pop.width > map.x + map.width)
      throw new Error(`the box (${Math.round(pop.x)},${Math.round(pop.y)} ${Math.round(pop.width)}x${Math.round(pop.height)}) clips the map (${Math.round(map.x)},${Math.round(map.y)} ${Math.round(map.width)}x${Math.round(map.height)})`);
  });
  await step("an introduced row shows the pair map and the open need box too (plan 055, decision 7)", async () => {
    await page.waitForSelector("#pairMap-8:not([hidden]) .leaflet-popup .np-need");
    const pins = await page.$$eval("#pairMap-8 .np-pin", (els) => els.map((e) => e.textContent.trim()));
    eq(pins.sort(), ["Request", "You"], "the pins");
    has(await page.textContent("#pairMap-8 .np-need"), "What they need", "the box");
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

  area = "The account page (sent to one introduction)";
  {
    // Plan 055, decision 19: the offer email links to /hub/account/#intro-<id>,
    // and the old accept page sends its ?intro= there too.
    const world = newWorld({ user: USER, summary: summary([intro(7), intro(9), intro(8, { stage: "introduced", accepted_a_at: "2026-10-07T10:00:00Z",
      introduced_at: "2026-10-07T10:00:00Z", acceptance_expires_at: null })], [offer(7), offer(9), offer(8)]) });
    const { context, page, errors } = await visit(world);
    await step("#intro-<id> in the address scrolls to that row and marks it, and no other", async () => {
      await page.goto(`${APEX}/hub/account/#intro-9`);
      await page.waitForSelector("#intro-9.is-attention");
      eq(await page.locator("#introductions .acct-row.is-attention").count(), 1, "marked rows");
      // the page scrolls smoothly, so the row arrives over a few frames
      await page.waitForFunction(() => { const r = document.getElementById("intro-9").getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; });
      const style = await page.$eval("#intro-9", (e) => getComputedStyle(e).boxShadow);
      if (style === "none") throw new Error("the marked row has no outline");
    });
    await step("a change of hash moves the mark", async () => {
      await page.evaluate(() => { location.hash = "#intro-8"; });
      await page.waitForSelector("#intro-8.is-attention");
      eq(await page.locator("#intro-9.is-attention").count(), 0, "the old mark");
    });
    await step("the old accept page sends ?intro= to the account page's row, and nothing else to the account page", async () => {
      await page.goto(`${APEX}/hub/accept.html?intro=7&token=old`);
      await page.waitForURL((u) => u.origin === APEX && u.pathname === "/hub/account/" && u.hash === "#intro-7");
      await page.waitForSelector("#intro-7.is-attention");
      await page.goto(`${APEX}/hub/accept.html`);
      await page.waitForURL((u) => u.origin === APEX && u.pathname === "/hub/account/" && u.hash === "");
      eq(apiCalls(world, "GET /introductions/preview").length, 0, "reads of the old preview route");
    });
    await step("a stranger sent to one introduction comes back to it after signing in", async () => {
      await context.close();
      const w2 = newWorld({ summary: world.summary });
      const v2 = await visit(w2);
      await v2.page.goto(`${APEX}/hub/account/#intro-9`);
      await v2.page.waitForURL((u) => u.origin === APEX && u.pathname === "/hub/" && u.searchParams.get("signin") === "1");
      eq(new URL(v2.page.url()).searchParams.get("return"), `${APEX}/hub/account/#intro-9`, "the way back keeps the hash");
      await v2.page.waitForSelector("#signOverlay.open");
      await v2.page.fill("#sEmail", USER.email); await v2.page.fill("#sPass", PASSWORD);
      await v2.page.click("#signContent button[type=submit]");
      await v2.page.waitForURL((u) => u.origin === APEX && u.pathname === "/hub/account/" && u.hash === "#intro-9");
      await v2.page.waitForSelector("#intro-9.is-attention");
      await v2.context.close();
    });
    check("the deep link: no script errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  }
}

async function walkHomepage() {
  area = "The homepage";
  const world = newWorld();
  const { context, page, errors } = await visit(world);
  await page.goto(`${APEX}/`);
  await page.waitForSelector("#bookForm");
  // Plan 055 (Will, 12 Oct 2026): the main site's header carries the hub's
  // controls, as links to the door; the hero sends people to the hub.
  await step("the header offers Talk to the desk, then Sign in and Create your hub account as links to the door", async () => {
    await page.waitForSelector("[data-np-account-slot] a[data-np-join]");
    const header = await page.innerHTML("header.navbar");
    has(header, ">Talk to the desk</button>", "the desk button");
    eq(header.indexOf("Talk to the desk") < header.indexOf("data-np-account-slot"), true, "the desk button comes before the slot");
    eq(await page.getAttribute("[data-np-account-slot] a[data-np-join]", "href"), "/hub/?join=1", "the join link");
    has(await page.getAttribute("[data-np-account-slot] a[data-np-signin]", "href"), "/hub/?signin=1&return=", "the sign-in link");
    eq(await page.locator("header.navbar .navbar__portal").count(), 0, "lock links left");
    eq(await page.locator("header.navbar >> text=Get in touch").count(), 0, "Get in touch buttons left");
  });
  await step("the hero sends people to the hub, and Join our network opens the create-account box there", async () => {
    eq(await page.getAttribute(".hero__ctas a.btn--primary-lg", "href"), "https://nexpoint.co.uk/hub/", "Explore the Global Portal");
    eq(await page.getAttribute(".hero__ctas a.btn--ghost-lg", "href"), "https://nexpoint.co.uk/hub/?join=1", "Join our network");
  });
  // 13 October 2026 (Will): the hub door's reveal, repeated on the home page;
  // 14 October (Will, NEXPOINT-1 #124): it runs under the visitor's scroll,
  // both ways, rather than on a timer.
  const scrollUntil = async (test, step = 160, tries = 40) => {
    for (let i = 0; i < tries; i++) {
      if (await page.evaluate(test)) return true;
      await page.evaluate((dy) => window.scrollBy(0, dy), step);
      await page.waitForTimeout(120);
    }
    return page.evaluate(test);
  };
  await step("the globe stands over the film until the visitor scrolls, then gives way, and comes back at the top", async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(900);
    const got = await page.evaluate(() => {
      const v = document.getElementById("heroFilm"), stage = document.querySelector(".hero-reveal .globe-stage");
      const box = document.querySelector(".hero-reveal").getBoundingClientRect(), g = stage.getBoundingClientRect();
      // 14 October (Will, evening): the globe stands taller than the film box, so it is at least the box's size
      return { globeFillsItsBox: Math.round(g.width) === Math.round(box.width) && Math.round(g.height) >= Math.round(box.height) && g.width > 300,
        globeStays: !stage.classList.contains("is-gone") && getComputedStyle(stage).visibility !== "hidden",
        films: document.querySelectorAll("video").length, sections: document.querySelectorAll("section#film").length, controls: v.controls };
    });
    eq([got.globeFillsItsBox, got.globeStays, got.films, got.sections, got.controls], [true, true, 1, 0, false],
      "the globe fills its box, still there with no scroll, films on the page, a film section, controls before play");
    eq(await scrollUntil(() => document.querySelector(".hero-reveal .globe-stage").classList.contains("is-gone") &&
      document.querySelector(".hero-reveal .hero-film").classList.contains("is-live")), true, "the globe gone and the film in, on the way down");
    const after = await page.evaluate(() => {
      const film = document.querySelector(".hero-reveal .hero-film"), r = film.getBoundingClientRect();
      return { ratio: Math.round(r.width / r.height * 100) / 100, play: getComputedStyle(document.getElementById("heroFilmPlay")).display !== "none" };
    });
    eq(after.play, true, "the play button");
    eq(after.ratio > 1.7 && after.ratio < 1.85, true, "the frame is 16 by 9");
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForFunction(() => !document.querySelector(".hero-reveal .globe-stage").classList.contains("is-gone"));
  });
  await step("Play the film starts it and hands over to the browser's controls", async () => {
    await scrollUntil(() => document.querySelector(".hero-reveal .hero-film").classList.contains("is-live"));
    await page.click("#heroFilmPlay");
    await page.waitForSelector(".hero-film.is-playing");
    eq(await page.evaluate(() => document.getElementById("heroFilm").controls), true, "controls after play");
    await page.evaluate(() => { document.getElementById("heroFilm").pause(); window.scrollTo(0, 0); });
  });
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

  const holder = newWorld({ user: USER });
  const third = await visit(holder);
  await third.page.goto(`${APEX}/`);
  await step("a signed-in visitor sees their name and Sign out in the homepage header, right of Talk to the desk", async () => {
    await third.page.waitForSelector("[data-np-account-slot] .np-chip__name");
    has(await third.page.textContent("[data-np-account-slot] .np-chip__name"), "Walk Tester", "the chip");
    has(await third.page.textContent("[data-np-account-slot]"), "Sign out", "the slot");
    eq(await third.page.locator("[data-np-account-slot] [data-np-join]").count(), 0, "Create your hub account buttons");
  });
  clean(holder, third.errors, "the homepage, signed in");
  await third.context.close();
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
    ["the privacy page", `${APEX}/hub/privacy.html`, "six years after the last invoice"],
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

// ================================================================ the consultancy sign-up page
/* A client who said yes on a call opens the private link, reads the
   agreement on the page, signs it there by typing a name and a position and
   ticking that they agree, and is looking at an invoice they can pay that
   minute (spec 2026-10-19, sections 2a and 8). */
const fitsPhone = async (page, what) => {
  await page.setViewportSize({ width: 375, height: 800 });
  const wide = await page.evaluate(() => document.documentElement.scrollWidth);
  await page.setViewportSize({ width: 1280, height: 900 });
  return eq(wide <= 375, true, `${what} width at 375px (${wide})`);
};
const readAgreement = (page) => page.evaluate(() => {
  const box = document.getElementById("agreementText");
  const texts = (sel) => [...box.querySelectorAll(sel)].map((e) => e.textContent.trim());
  return {
    h2: texts("h2"), h3: texts("h3"), h4: texts("h4"), head: texts("thead th"),
    rows: [...box.querySelectorAll("tbody tr")].map((tr) => [...tr.children].map((td) => td.textContent.trim())),
    items: texts("li"), rules: box.querySelectorAll("hr").length,
    divided: [...box.querySelectorAll("h2")].map((h) => getComputedStyle(h).borderTopStyle === "solid"),
    pending: (box.textContent.match(/\[completed when you sign\]/g) || []).length,
  };
});
const signReady = async (page, position = "Director") => {
  await page.fill("#signerPosition", position);
  await page.check("#agree");
};
const SIGN_SENT = (over = {}) => Object.assign({ token: SIGN_TOKEN, signer_name: "Jo Bloggs", signer_position: "Director",
  invoice_email: SIGN_INVOICE_DEFAULT, purchase_order: "", agree: true, agreement_hash: "a".repeat(64) }, over);
async function walkSign() {
  area = "The consultancy sign-up page (sign/)";
  {
    const world = newWorld({ signup: { token: SIGN_TOKEN, state: signupState("ready"),
      raised: signupState("invoiced", { signed_at: "2026-10-19T10:00:00Z", signed_name: "Jo Bloggs", signed_position: "Director",
        invoice_email: "finance@midlands3d.example", purchase_order: "PO-4471", invoice: signupInvoice() }) } });
    const { context, page, errors } = await visit(world);
    await page.goto(`${APEX}/sign/?t=${SIGN_TOKEN}`);
    await step("the link opens on Welcome, with the company's name exactly as written", async () => {
      await page.waitForSelector("#signBtn");
      eq(apiCalls(world, "POST /signup/view").map((c) => c.body), [{ token: SIGN_TOKEN }], "the looks sent");
      return has(await page.textContent("h1"), "Welcome, Midlands 3D Printing & Co <Ltd>", "the heading");
    });
    await step("the welcome says this is the agreement that goes with the proposal", async () =>
      has(await page.textContent("#signBody > p"), "the agreement that goes with the proposal we sent you", "the welcome line"));
    await step("the summary names the retainer, the recurring fee and the two documents", async () => {
      const t = await page.textContent("#signBody");
      // The figure alone: "£5,000", never "£5,000 GBP" (final review, finding 8).
      if (t.includes("£5,000 GBP")) throw new Error("the summary repeats the currency after the figure");
      for (const part of ["£5,000 for six months", "six months of sales and marketing work", "6% of the revenue in the first year",
        "falling to 2% in the fifth", "nothing after", "Introduction Agreement", "Master Terms of Business", "NexPoint Global Ltd",
        "Finding UK clinics for your insoles"]) has(t, part, "the summary");
      // No territory (Will, 20 October 2026): the summary is the service, the retainer and the recurring fee.
      eq(await page.locator("dl.terms dt").allTextContents(), ["Purpose", "Retainer", "Recurring fee"], "the summary's rows");
      return eq(await page.textContent("#readBtn"), "Hide the agreement", "the reading button");
    });
    await step("the page loads nothing from DocuSign", async () => eq(await page.evaluate(() => !!window.DocuSign), false, "window.DocuSign"));
    await step("the page sends no referrer, so the link's token never leaves in one", async () =>
      eq(await page.getAttribute('meta[name="referrer"]', "content"), "no-referrer", "the referrer policy"));
    await step("the agreement is open on arrival; Hide the agreement folds it and Read the agreement opens it again", async () => {
      eq(await page.isVisible("#agreementText"), true, "the agreement on arrival");
      eq(await page.getAttribute("#readBtn", "aria-expanded"), "true", "the button's aria-expanded on arrival");
      await page.click("#readBtn");
      eq(await page.isVisible("#agreementText"), false, "the agreement after Hide");
      eq([await page.getAttribute("#readBtn", "aria-expanded"), await page.textContent("#readBtn")], ["false", "Read the agreement"],
        "the button once folded");
      await page.click("#readBtn");
      eq(await page.isVisible("#agreementText"), true, "the agreement after Read");
      eq(await page.getAttribute("#readBtn", "aria-expanded"), "true", "the button's aria-expanded once open");
      return eq(await page.textContent("#readBtn"), "Hide the agreement", "the button once open");
    });
    await step("the agreement reads as a document: headings, the fee table, the lists, the Master Terms under a title of its own", async () =>
      eq(await readAgreement(page), SIGN_RENDERED, "the rendered agreement"));
    await step("bold clause numbers are bold, and a stray asterisk stays an asterisk", async () => {
      const got = await page.evaluate(() => [...document.querySelectorAll("#agreementText strong")].map((e) => e.textContent));
      for (const want of ["2.1.1", "2.3", "Alternative or Additional Fees", "4.", "Invoicing for Recurring Fees"])
        if (!got.includes(want)) throw new Error(`no bold "${want}" in ${JSON.stringify(got.slice(0, 8))}`);
      const t = await page.textContent("#agreementText");
      if (t.includes("**")) throw new Error("a pair of asterisks shows in the agreement");
      return has(t, "a lone * asterisk", "the clause with an asterisk");
    });
    await step("markup in the agreement is shown as text, never run", async () => {
      const got = await page.evaluate(() => ({ els: document.querySelectorAll("#agreementText img, #agreementText script").length,
        pwned: window.__npPwned || 0, text: document.getElementById("agreementText").textContent }));
      eq([got.els, got.pwned], [0, 0], "elements made from the text, and what ran");
      has(got.text, "1 <img src=x onerror=\"window.__npPwned=1\"> Road", "the address");
      return has(got.text, "<script>window.__npPwned=2</script>", "the clause");
    });
    await step("the agreement scrolls inside a panel about 60% of the window tall", async () => {
      const got = await page.evaluate(() => {
        const b = document.getElementById("agreementText");
        return { ratio: b.clientHeight / innerHeight, scrolls: b.scrollHeight > b.clientHeight + 40, overflow: getComputedStyle(b).overflowY };
      });
      return eq([got.ratio > 0.5 && got.ratio < 0.7, got.scrolls, got.overflow], [true, true, "auto"], `panel ${JSON.stringify(got)}`);
    });
    await step("the ready page, agreement open, fits a phone's width", async () => fitsPhone(page, "the ready page"));
    await step("the form has the name filled in, an empty position, and the tick in the company's name", async () => {
      eq([await page.inputValue("#signerName"), await page.inputValue("#signerPosition"), await page.isChecked("#agree")],
        ["Jo Bloggs", "", false], "the fields");
      eq(await page.textContent("label[for=signerName]"), "Full name", "the name's label");
      eq(await page.textContent("label[for=signerPosition]"), "Position", "the position's label");
      has(await page.textContent("#agreeLabel"), "I have read the Introduction Agreement and the Master Terms of Business and agree to them on behalf of Midlands 3D Printing & Co <Ltd>", "the tick");
      return eq(await page.textContent("#signBtn"), "Sign the agreement", "the button");
    });
    await step("under the name and position: where the invoice goes, filled in, and an optional purchase order number", async () => {
      eq(await page.textContent("label[for=invoiceEmail]"), "Where should we send the invoice?", "the invoice email's label");
      eq([await page.getAttribute("#invoiceEmail", "type"), await page.getAttribute("#invoiceEmail", "required"), await page.inputValue("#invoiceEmail")],
        ["email", "", SIGN_INVOICE_DEFAULT], "the invoice email");
      eq(await page.textContent("#invoiceHelp"), "Xero sends the invoice and any reminders here.", "the help text");
      eq(await page.getAttribute("#invoiceEmail", "aria-describedby"), "invoiceHelp", "the help text's link");
      eq(await page.textContent("label[for=purchaseOrder]"), "Purchase order number (optional)", "the purchase order's label");
      eq([await page.getAttribute("#purchaseOrder", "maxlength"), await page.inputValue("#purchaseOrder")], ["50", ""], "the purchase order");
      return eq(await page.evaluate(() => {
        const at = (id) => document.getElementById(id);
        const after = (a, b) => !!(at(a).compareDocumentPosition(at(b)) & Node.DOCUMENT_POSITION_FOLLOWING);
        return [after("signerPosition", "invoiceEmail"), after("invoiceEmail", "purchaseOrder"), after("purchaseOrder", "agree")];
      }), [true, true, true], "the order: position, invoice email, purchase order, the tick");
    });
    await step("Sign the agreement waits for a name, a position and the tick", async () => {
      const off = async () => page.isDisabled("#signBtn");
      const seen = [await off()];
      await page.fill("#signerPosition", "Director"); seen.push(await off());
      await page.check("#agree"); seen.push(await off());
      await page.fill("#signerName", "   "); seen.push(await off());
      await page.fill("#signerName", "Jo Bloggs"); seen.push(await off());
      await page.fill("#signerPosition", ""); seen.push(await off());
      await page.fill("#signerPosition", "Director"); seen.push(await off());
      await page.uncheck("#agree"); seen.push(await off());
      await page.check("#agree"); seen.push(await off());
      await page.fill("#invoiceEmail", "  "); seen.push(await off());
      await page.fill("#invoiceEmail", SIGN_INVOICE_DEFAULT); seen.push(await off());
      await page.fill("#purchaseOrder", ""); seen.push(await off());
      return eq(seen, [true, true, false, true, false, true, false, true, false, true, false, false], "disabled after each change");
    });
    await step("signing sends the name, the position, the invoice email, the purchase order, the tick and the hash, once for two presses", async () => {
      await page.fill("#invoiceEmail", "  Finance@Midlands3D.example ");
      await page.fill("#purchaseOrder", "  PO-4471 ");
      await page.evaluate(() => { const b = document.getElementById("signBtn"); b.click(); b.click(); });
      await page.waitForFunction(() => /Your invoice is on its way/.test(document.body.textContent));
      return eq(apiCalls(world, "POST /signup/accept").map((c) => c.body),
        [SIGN_SENT({ invoice_email: "Finance@Midlands3D.example", purchase_order: "PO-4471" })], "acceptances sent");
    });
    await step("the signed page says where the invoice goes, with the purchase order", async () => {
      const t = await page.textContent("#invoiceTo");
      has(t, "Invoice to finance@midlands3d.example", "the signed page");
      return has(t, "purchase order PO-4471", "the signed page");
    });
    await step("the page asks again until the invoice is raised, then leads with Pay now", async () => {
      await page.waitForSelector("#payNow", { timeout: 9000 });
      eq(await page.textContent("#payNow"), "Pay now", "the main button");
      eq([await page.getAttribute("#payNow", "href"), await page.getAttribute("#payNow", "target")], ["https://in.xero.com/walk-invoice", "_blank"], "where Pay now goes");
      const t = await page.textContent("#signBody");
      for (const part of ["Agreement signed", "Signed by Jo Bloggs, Director", "INV-1011", "£5,000", "18 November 2026", "inbox",
        "Invoice to finance@midlands3d.example", "purchase order PO-4471"]) has(t, part, "the invoiced page");
      eq(await page.locator("#bank dt").allTextContents(), ["Account name", "Sort code", "Account number"], "the bank details");
      return eq(await page.evaluate(() => !!(document.getElementById("payNow").compareDocumentPosition(document.getElementById("bank")) & Node.DOCUMENT_POSITION_FOLLOWING)),
        true, "the bank details sit below Pay now");
    });
    await step("the invoiced page fits a phone's width", async () => fitsPhone(page, "the invoiced page"));
    clean(world, errors, "the sign-up page, ready to invoiced");
    await context.close();
  }
  {
    /* A new version of the agreement goes live while the page is open: the
       worker refuses the old text, and the client reloads to read the new. */
    const world = newWorld({ signup: { token: SIGN_TOKEN, state: signupState("ready") } });
    const { context, page, errors } = await visit(world);
    await page.goto(`${APEX}/sign/?t=${SIGN_TOKEN}`);
    await page.waitForSelector("#signBtn");
    world.signup.state = signupState("ready", { agreement: { version: "2.2", hash: "b".repeat(64),
      text: SIGN_AGREEMENT_TEXT + "\n**9.99** A clause added in the new version.\n" } });
    await step("an agreement changed since the page opened asks the client to reload, and offers Reload the page", async () => {
      await signReady(page);
      await page.click("#signBtn");
      await page.waitForSelector("#reloadBtn");
      eq(await page.textContent("#signMsg"), "The agreement was updated since you opened this page. Reload to read the current version.", "the line");
      eq(await page.textContent("#reloadBtn"), "Reload the page", "the button");
      return eq(await page.locator("#signBtn").count(), 0, "Sign the agreement buttons left");
    });
    await step("Reload the page shows the new text, and signing it sends the new hash", async () => {
      await page.click("#reloadBtn");
      await page.waitForSelector("#signBtn");
      eq(await page.isVisible("#agreementText"), true, "the new agreement, open on arrival");
      has(await page.textContent("#agreementText"), "A clause added in the new version.", "the agreement");
      await signReady(page);
      await page.click("#signBtn");
      await page.waitForFunction(() => /Agreement signed/.test(document.body.textContent));
      return eq(apiCalls(world, "POST /signup/accept").map((c) => c.body.agreement_hash), ["a".repeat(64), "b".repeat(64)], "hashes sent");
    });
    clean(world, errors, "the sign-up page, the agreement changed");
    await context.close();
  }
  {
    /* What the worker refuses is said in plain words, and the form stays. */
    const world = newWorld({ signup: { token: SIGN_TOKEN, state: signupState("ready") } });
    const words = [
      ["signer_name required", "Enter the full name of the person signing."],
      ["signer_position required", "Enter the position of the person signing."],
      ["signer_name too long", "That name is longer than the agreement can record. Shorten it and sign again."],
      ["signer_position too long", "That position is longer than the agreement can record. Shorten it and sign again."],
      ["agreement not accepted", "Tick the box to confirm you have read the agreement and agree to it."],
      ["signer_name has formatting characters", "Take the ** and any line breaks out of your name, then sign again."],
      ["signer_position has formatting characters", "Take the ** and any line breaks out of your position, then sign again."],
      ["invoice_email required", "Enter the email address for the invoice."],
      ["invalid invoice_email", "That invoice email address does not look right."],
      ["purchase_order too long", "Keep the purchase order number to 50 characters."],
      ["purchase_order has formatting characters", "Take ** and line breaks out of the purchase order number."],
      ["something new", "That did not go through. Try again in a moment, or email hello@nexpoint.co.uk."],
    ];
    let n = 0;
    world.api["POST /signup/accept"] = () => [n < words.length - 1 ? 422 : 500, { error: words[n++][0] }];
    const { context, page, errors } = await visit(world);
    await page.goto(`${APEX}/sign/?t=${SIGN_TOKEN}`);
    await page.waitForSelector("#signBtn");
    await signReady(page);
    for (const [error, line] of words) {
      await step(`"${error}" is said as: ${line}`, async () => {
        const before = n;
        await page.click("#signBtn");
        await until(() => n === before + 1, "the acceptance");
        await page.waitForFunction((l) => document.getElementById("signMsg").textContent === l, line);
        eq(await page.getAttribute("#signMsg", "class"), "msg bad", "the line's class");
        return eq([await page.isEnabled("#signBtn"), await page.inputValue("#signerPosition"), await page.inputValue("#invoiceEmail")],
          [true, "Director", SIGN_INVOICE_DEFAULT], "the button and the form");
      });
    }
    clean(world, errors, "the sign-up page, refusals");
    await context.close();
  }
  {
    /* The press does not reach the worker; the client presses again. A name
       with markup, accents, another script and an emoji goes as typed. The
       browser logs its own line for the dropped request, so `clean` is not used. */
    const HOSTILE = "<b>Zoë</b> \"Ō'Brien\" Иванова 李 🙂";
    const world = newWorld({ dropOnce: new Set(["POST /signup/accept"]), signup: { token: SIGN_TOKEN, state: signupState("ready") } });
    const { context, page } = await visit(world);
    await page.goto(`${APEX}/sign/?t=${SIGN_TOKEN}`);
    await page.waitForSelector("#signBtn");
    await step("a press that does not reach us says to check the connection, and the form stays", async () => {
      await page.fill("#signerName", `  ${HOSTILE}  `);
      await signReady(page, "Managing <i>Director</i>");
      await page.click("#signBtn");
      await page.waitForFunction(() => /Check your connection and try again/.test(document.getElementById("signMsg").textContent));
      eq(await page.textContent("#signMsg"), "That did not reach us. Check your connection and try again.", "the line");
      return eq(await page.isEnabled("#signBtn"), true, "the button");
    });
    await step("the name and position go as typed, trimmed, and come back as text", async () => {
      await page.click("#signBtn");
      await page.waitForFunction(() => /Agreement signed/.test(document.body.textContent));
      eq(apiCalls(world, "POST /signup/accept").map((c) => [c.body.signer_name, c.body.signer_position]).slice(-1),
        [[HOSTILE, "Managing <i>Director</i>"]], "what was sent");
      has(await page.textContent("#signBody"), `Signed by ${HOSTILE}, Managing <i>Director</i>`, "the signed page");
      return eq(await page.locator("#signBody b, #signBody i").count(), 0, "elements made from the name");
    });
    check("the sign-up page, a dropped press: nothing reached past the stubs", world.strays.length === 0, world.strays.slice(0, 3).join(", "));
    await context.close();
  }
  {
    /* Two tabs: the other tab has signed by the time this one presses. */
    const world = newWorld({ signup: { token: SIGN_TOKEN, state: signupState("ready") } });
    const { context, page, errors } = await visit(world);
    await page.goto(`${APEX}/sign/?t=${SIGN_TOKEN}`);
    await page.waitForSelector("#signBtn");
    world.signup.state = signupState("invoiced", { signed_at: "2026-10-19T10:00:00Z", signed_name: "Jo Bloggs", signed_position: "Director",
      invoice_email: SIGN_INVOICE_DEFAULT, purchase_order: null, invoice: signupInvoice() });
    await step("a link already signed in another tab goes straight to its invoice", async () => {
      await signReady(page);
      await page.click("#signBtn");
      await page.waitForSelector("#payNow");
      return has(await page.textContent("#signBody"), "Agreement signed", "the page");
    });
    await step("with no purchase order, the invoiced page says only where the invoice goes", async () => {
      eq(await page.textContent("#invoiceTo"), `Invoice to ${SIGN_INVOICE_DEFAULT}.`, "the line");
      return eq(/purchase order/i.test(await page.textContent("#signBody")), false, "a purchase order on the page");
    });
    clean(world, errors, "the sign-up page, two tabs");
    await context.close();
  }
  {
    const usd = signupState("invoiced", { fee: { amount: 5000, currency: "USD", display: "US$5,000" }, signed_at: "2026-10-19T10:00:00Z",
      invoice: signupInvoice({ amount_display: "US$5,000", pay_by_bank: false,
        bank: { "Account name": "NexPoint Global Limited", IBAN: "GB00WALK00000000000000", "BIC / SWIFT": "WALKGB2L" } }) });
    const world = newWorld({ signup: { token: SIGN_TOKEN, state: usd } });
    const { context, page, errors } = await visit(world);
    await page.goto(`${APEX}/sign/?t=${SIGN_TOKEN}`);
    await step("a dollar invoice leads with the bank transfer, Copy bank details the main button", async () => {
      await page.waitForSelector("#copyBank");
      eq(await page.locator("#payNow").count(), 0, "Pay now buttons");
      eq(await page.textContent("#copyBank"), "Copy bank details", "the main button");
      has(await page.textContent("#signBody"), "US$5,000", "the amount");
      eq(await page.locator("#bank dt").allTextContents(), ["Account name", "IBAN", "BIC / SWIFT"], "the bank details");
      eq(await page.evaluate(() => !!(document.getElementById("bank").compareDocumentPosition(document.getElementById("copyBank")) & Node.DOCUMENT_POSITION_FOLLOWING)),
        true, "the details come before the button");
      return eq([await page.textContent("#viewInvoice"), await page.getAttribute("#viewInvoice", "href")],
        ["View the invoice", "https://in.xero.com/walk-invoice"], "the invoice link");
    });
    await step("Copy bank details says it copied them", async () => {
      await page.click("#copyBank");
      return page.waitForFunction(() => /copied/i.test(document.getElementById("copyMsg").textContent)).then(() => true);
    });
    clean(world, errors, "the sign-up page, a dollar invoice");
    await context.close();
  }
  {
    const world = newWorld({ signup: { token: SIGN_TOKEN, state: signupState("paid", { signed_at: "2026-10-19T10:00:00Z",
      paid_at: "2026-10-25T09:30:00Z", invoice: signupInvoice() }) } });
    const { context, page, errors } = await visit(world);
    await page.goto(`${APEX}/sign/?t=${SIGN_TOKEN}`);
    await step("a paid link says paid, thank you, and what happens next", async () => {
      await page.waitForFunction(() => /Paid, thank you/.test(document.body.textContent));
      has(await page.textContent("#signBody"), "25 October 2026", "the date paid");
      return eq(await page.locator("#payNow, #copyBank").count(), 0, "ways to pay");
    });
    await page.goto(`${APEX}/sign/?t=${"f".repeat(64)}`);
    await step("a bad link says it is no longer valid and gives hello@", async () => {
      await page.waitForFunction(() => /no longer valid/.test(document.body.textContent));
      return has(await page.textContent("#signBody"), "hello@nexpoint.co.uk", "the help line");
    });
    const looks = apiCalls(world, "POST /signup/view").length;
    await page.goto(`${APEX}/sign/`);
    await step("a link with no token says the same, without asking the worker", async () => {
      await page.waitForFunction(() => /no longer valid/.test(document.body.textContent));
      return eq(apiCalls(world, "POST /signup/view").length, looks, "looks sent");
    });
    clean(world, errors, "the sign-up page, paid and bad links");
    await context.close();
  }
  {
    /* An older worker, or a link made before 20 October 2026, may still send a
       territory: the page never shows one, and says "agreement link", never "sign-up". */
    const world = newWorld({ signup: { token: SIGN_TOKEN, state: signupState("ready", { territory: "United Kingdom and Ireland" }) } });
    const { context, page, errors } = await visit(world);
    await page.goto(`${APEX}/sign/?t=${SIGN_TOKEN}`);
    await step("a territory in the answer is never shown", async () => {
      await page.waitForSelector("#signBtn");
      const t = await page.textContent("#signBody > .panel dl.terms");
      if (/territory/i.test(t) || t.includes("United Kingdom and Ireland")) throw new Error(`the summary shows a territory: ${t.slice(0, 160)}`);
      return eq(await page.locator("dl.terms dt").allTextContents(), ["Purpose", "Retainer", "Recurring fee"], "the summary's rows");
    });
    await page.goto(`${APEX}/sign/?t=${"f".repeat(64)}`);
    await step("the expired message says agreement links, not sign-up links", async () => {
      await page.waitForFunction(() => /no longer valid/.test(document.body.textContent));
      const t = await page.textContent("body");
      if (/sign-up/i.test(t)) throw new Error("the page still says sign-up");
      return has(await page.textContent("#signBody"), "Agreement links last 30 days", "the expired message");
    });
    clean(world, errors, "the sign-up page, no territory");
    await context.close();
  }
}

// ================================================================ the admin boards
/* Plan 072 (D7): a page that moved is a pointer, one sentence and an
   automatic move to its new page, marked <meta name="nx-moved">. It has no
   sign-in and reads nothing, so the boards' checks leave it out and
   walkMovedPages walks it instead. */
const adminText = (f) => readFileSync(join(ADMIN_DIR, f), "utf8");
const movedTo = (f) => (existsSync(join(ADMIN_DIR, f)) && adminText(f).match(/<meta name="nx-moved" content="([^"]+)"/) || [])[1] || null;
const adminPages = () => readdirSync(ADMIN_DIR).filter((f) => f.endsWith(".html")).sort();
const boards = () => adminPages().filter((f) => !movedTo(f));
/* The door is walked on System once the admin directory has it (plan 072:
   Health became System), on Health before. */
const DOOR_PAGE = existsSync(join(ADMIN_DIR, "system.html")) ? "system.html" : "health.html";
/* A CRM section whose plan has not built it yet still draws the shell's
   "Not built yet" panel, by the placeholder's own call (comingHtml({plan:'072',
   ...}) and so on); its own checks wait for the build. */
const built = (f) => existsSync(join(ADMIN_DIR, f)) && !/NXShell\.comingHtml\(\{plan:'\d{3}',/.test(adminText(f));

/* The door is walked on a CRM page and on two old-style boards (each has its
   own boot and doLogin; the hub boards share hub-board.js's). */
async function walkAdminDoor() {
  for (const file of [DOOR_PAGE, "leads.html", "print-hub.html"]) {
    if (existsSync(join(ADMIN_DIR, file))) await walkDoorOn(file);
  }
}
async function walkDoorOn(file) {
  area = `The admin door on ${file} (password, then the second factor)`;
  const world = newWorld();
  const { context, page, errors } = await visit(world);
  await page.goto(`${APEX}/admin/${file}`);
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
  clean(world, errors, `the admin door on ${file}`);
  await context.close();
}

/* What the Inbox and System read (plan 072), so they open on rows of every
   shape they draw: the view's two new columns (org_id, item_key), our tasks,
   the workspace checkboxes, the companies; the runs, the failing step and
   the morning report with each job's schedule line. A dismissal never
   reaches the page (the view leaves it out), so that table is empty. */
const systemRows = () => ({
  engine_health: [{ id: 1, generated_at: ago(2), ok: true, problems: [], warnings: [], jobs: [
    { job: "hourly-sync", state: "ok", detail: null, last_run_id: "run-hourly-1", schedule: "Every 2 hours" },
    { job: "hub-sync", state: "ok", detail: null, last_run_id: "run-hub-1", schedule: "Every 2 hours at :20" },
    { job: "intent-drain", state: "disabled", detail: null, last_run_id: null, schedule: "On demand" }] }],
  engine_runs: [
    { id: "run-hub-2", job: "hub-sync", status: "failed", started_at: ago(0.5), ended_at: ago(0.49) },
    { id: "run-hourly-1", job: "hourly-sync", status: "succeeded", started_at: ago(1), ended_at: ago(0.95) },
    { id: "run-hub-1", job: "hub-sync", status: "succeeded", started_at: ago(2.5), ended_at: ago(2.45) }],
  engine_steps: [{ run_id: "run-hub-2", seq: 0, name: "smartlead-pull", status: "failed",
    detail: "Smartlead timed out after 30 seconds", recorded_at: ago(0.49) }],
  engine_intents: [], engine_lead_queue: [],
});
const WALK_ORG = "00000000-0000-4000-8000-0000000000b1";
const inboxRows = () => ({
  inbox: [
    { kind: "listing", ref: "1", hub: "print", name: "ZZ Walk Test Ltd", status: "pending", created_at: ago(30), age_hours: 30,
      board: `company.html?org=${WALK_ORG}`, item_id: "1", org_id: WALK_ORG, item_key: "listing:1:new" },
    { kind: "failed_run", ref: "hub-sync", hub: null, name: "hub-sync", status: "failed", created_at: ago(0.5), age_hours: 0.5,
      board: "system.html", item_id: "run-hub-2", org_id: null, item_key: "failed_run:run-hub-2" }],
  /* One open task and one done this week: the page reads each with its own filter. */
  crm_tasks: [
    { id: 1, title: "Ring ZZ Walk Test Ltd about pricing", company_id: 1, due_on: null, source: "admin",
      pipedrive_activity_id: null, created_at: ago(5), created_by: ADMIN_EMAIL, updated_at: ago(5), updated_by: null,
      done_at: null, done_by: null },
    { id: 2, title: "Send the walk its notes", company_id: null, due_on: null, source: "admin",
      pipedrive_activity_id: null, created_at: ago(50), created_by: ADMIN_EMAIL, updated_at: ago(20), updated_by: ADMIN_EMAIL,
      done_at: ago(20), done_by: ADMIN_EMAIL }],
  /* A card set aside with Not now, still live (the view leaves its card out). */
  crm_inbox_dismissals: [{ id: 1, item_key: "registration:00000000-0000-4000-8000-0000000000c9", kind: "registration",
    reason: "Waiting for them to confirm", dismissed_at: ago(20), dismissed_by: ADMIN_EMAIL, restored_at: null, restored_by: null }],
  engine_tasks: [{ id: 1, owner: "Will", task: "Send the walk notes", source: "deals/zz-walk-test/notes/2026-10-23_walk.md", collected_at: ago(3) }],
  crm_companies: [{ id: 1, name: "ZZ Walk Test Ltd", slug: "zz-walk-test", archived_at: null }],
  /* Their newest filed email came in this week, so They wrote last lists them. */
  crm_email_index: [{ company_id: 1, sent_at: ago(26), subject: "Re: pricing for the walk", from_text: "Jo Walk <jo@zzwalk.example>",
    direction: "inbound", gone_at: null }],
  engine_intents: [],
});
const BOARD_ROWS = { "inbox.html": inboxRows, "system.html": systemRows };

async function walkBoards() {
  area = `Every admin board (${ADMIN_DIR === join(ROOT, "admin") ? "this repo's deploy copy" : ADMIN_DIR})`;
  for (const file of boards()) {
    const world = newWorld({ rows: BOARD_ROWS[file] ? BOARD_ROWS[file]() : {} });
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
      const row = oneRow(w);
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
      const row = oneRow(w);
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
/* Health's checks walk the page that carries Health: System once health.html
   has moved there (plan 072, D7), Health before. */
const HEALTH_PAGE = movedTo("health.html") || "health.html";
/* Both copies have carried the review's fixes since 4 October, so the checks
   run whenever the page is there. */
const REVIEWED = existsSync(join(ADMIN_DIR, HEALTH_PAGE));
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

/* Plan 065: Chris's CRM categorisation on the Prospects page. Every new
   button raises one intent and touches no other table. The deploy copy
   predates it until the admin sync; WALK_ADMIN_DIR=<engine>/app walks it now. */
const CRM = /PLAN065/.test(readFileSync(join(ADMIN_DIR, "leads.html"), "utf8"));
async function walkProspectsCrm() {
  area = "The Prospects page with Chris's classification";
  if (!CRM) {
    notes.push("The Prospects page in this copy predates plan 065, so its checks were not run. " +
      "It arrives with the admin sync; WALK_ADMIN_DIR=<engine>/app walks it now.");
    return;
  }
  const row = (id, extra) => ({
    id, company: `zz-walk-${id}`, display_name: `ZZ Walk ${id} Ltd`, category: "Cold", matched_json: [], reasoning: "walk",
    judge_reason: "walk", website: "https://example.com", quality: null, judged: true, judge_confidence: "medium",
    proposed_at: ago(24), decided_at: null, decided_by: null, decision_note: null, status: "pending",
    prospect_type: "Cold", recommended_campaign_id: null, campaign_id: null, source: "finder", list_overlap: null,
    sector: null, company_type: null, ...extra });
  const seed = (world) => {
    world.rows.engine_lead_queue = [row(601), row(602, { quality: "watch" }),
      row(603, { status: "approved", decided_at: ago(2), decided_by: ADMIN_EMAIL })];
    world.rows.prospect_options = [
      { field: "sector", value: "Insoles", position: 10, active: true },
      { field: "company_type", value: "Lab", position: 10, active: true }];
    world.rows.prospect_notes = [{ id: 1, company: "zz-walk-601", body: "Met at the fair.", by: ADMIN_EMAIL, at: ago(5) }];
  };
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  /* The page ships two skeleton .row placeholders, so wait for a rendered card. */
  const ROW = "#sections .row:not(.skeleton)";
  const one = async (name, act, expect) => {
    const world = newWorld({ dialogAnswer: "the scripted walk" });
    seed(world);
    const { context, page, errors } = await visit(world, { seedAdmin: true });
    await page.goto(`${APEX}/admin/leads.html`);
    await page.waitForSelector("#admin", { state: "visible" });
    await page.waitForSelector(ROW);
    await step(name, async () => {
      await act(page);
      await until(() => world.writes.length > 0, "the intent write");
      await pause(300);
      eq(world.writes.length, 1, "writes");
      const w = world.writes[0];
      const body = oneRow(w);
      eq([w.method, w.table, body.type], ["POST", "engine_intents", expect.type], "the intent");
      expect.check && expect.check(body.payload_json);
      has(await page.innerText("body"), "queued for the engine", "the page's confirmation");
    });
    clean(world, errors, "the Prospects page");
    await context.close();
  };
  await one("Save raises one edit-prospect with only the changed fields", async (page) => {
    await page.selectOption("#sector-601", "Insoles");
    await page.selectOption("#ctype-601", "Lab");
    await page.click("#save-601");
  }, { type: "edit-prospect", check: (p) => eq([p.queue_row, p.fields], [601, { sector: "Insoles", company_type: "Lab" }], "payload") });
  await one("Park raises one watch-lead", (page) => page.click('#act-601 button[onclick^="park("]'),
    { type: "watch-lead", check: (p) => eq(p.queue_row, 601, "row") });
  await one("Unpark on the Parked tab raises one unpark-lead", async (page) => {
    await page.click('[data-tab="parked"]');
    await page.click('#act-602 button[onclick^="unpark("]');
  }, { type: "unpark-lead", check: (p) => eq(p.queue_row, 602, "row") });
  await one("Return to prospect asks why and raises one intent", async (page) => {
    await page.click('[data-tab="leads"]');
    await page.click('#act-603 button[onclick^="returnLead("]');
  }, { type: "return-to-prospect", check: (p) => eq([p.queue_row, p.reason], [603, "the scripted walk"], "payload") });
  await one("Kill asks why and raises one block-lead", (page) => page.click('#act-601 button[onclick^="block("]'),
    { type: "block-lead", check: (p) => eq([p.queue_row, p.reason], [601, "the scripted walk"], "payload") });
  await one("Add note raises one add-prospect-note for the company", async (page) => {
    await page.fill("#note-601", "Software competitor, revisit in 2027.");
    await page.click('button[onclick^="addNote("][data-id="601"]');
  }, { type: "add-prospect-note", check: (p) => eq([p.company, p.body], ["zz-walk-601", "Software competitor, revisit in 2027."], "payload") });
  await one("Add a company raises one add-prospect", async (page) => {
    await page.click("#addOpen");
    await page.fill("#add-name", "ZZ Added Ltd");
    await page.selectOption("#add-type", "Known contact");
    await page.click("#add-go");
  }, { type: "add-prospect", check: (p) => eq([p.display_name, p.type, p.campaign_id], ["ZZ Added Ltd", "Known contact", null], "payload") });
  {
    const world = newWorld();
    seed(world);
    const { context, page, errors } = await visit(world, { seedAdmin: true });
    await page.goto(`${APEX}/admin/leads.html`);
    await step("Known contact greys the Campaign; the parked card cannot be graded; notes show", async () => {
      await page.waitForSelector("#admin", { state: "visible" });
      await page.waitForSelector(ROW);
      has(await page.textContent("#sections"), "Met at the fair.", "the note");
      await page.selectOption("#type-601", "Known contact");
      eq(await page.isDisabled("#camp-601"), true, "campaign disabled");
      await page.click('[data-tab="parked"]');
      eq(await page.isDisabled("#quality-602"), true, "parked quality disabled");
      eq(world.writes, [], "writes");
    });
    clean(world, errors, "the Prospects page");
    await context.close();
  }
  {
    /* Before migration 0065 the two new tables are unreadable (the stub answers
       any table with rows, so the walk makes these two refuse by route). */
    const world = newWorld();
    seed(world);
    const { context, page, errors } = await visit(world, { seedAdmin: true });
    await page.route(/\/rest\/v1\/prospect_(options|notes)/, (route) => route.fulfill({
      status: 404, contentType: "application/json",
      headers: { "access-control-allow-origin": "*", "access-control-allow-credentials": "true" },
      body: JSON.stringify({ code: "42P01", message: "relation does not exist", details: null, hint: null }) }));
    await page.goto(`${APEX}/admin/leads.html`);
    await step("Before migration 0065 the page says so and Accept still raises one accept-prospect", async () => {
      await page.waitForSelector("#admin", { state: "visible" });
      await page.waitForSelector(ROW);
      has(await page.textContent("#banner"), "0065", "the banner");
      await page.click('#act-601 button[onclick^="accept("]');
      await until(() => world.writes.length > 0, "the intent write");
      await pause(300);
      eq(world.writes.length, 1, "writes");
      const w = world.writes[0];
      const body = oneRow(w);
      eq([w.method, w.table, body.type, body.payload_json.queue_row], ["POST", "engine_intents", "accept-prospect", 601], "the intent");
    });
    clean(world, errors, "the Prospects page");
    await context.close();
  }
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
    await page.goto(`${APEX}/admin/${HEALTH_PAGE}`);
    if (HEALTH_PAGE === "health.html") {
      await step("Health: a job that failed after the morning report turns the board red and is named", async () => {
        await page.waitForFunction(() => /needs attention/.test(document.getElementById("verdict").textContent));
        has(await page.textContent("#findings"), "intent-drain failed since the morning report", "the findings");
      });
      await step("Health: that job's row says failed, and the other still says ok", async () => {
        const rows = await page.$$eval("#jobs tbody tr", (trs) => trs.map((tr) => [...tr.cells].slice(0, 2).map((c) => c.textContent.trim())));
        eq(rows, [["hub-sync", "ok"], ["intent-drain", "failed"]], "the job table");
      });
      clean(world, errors, "the Health board");
    } else {
      /* Plan 072: the same failure on System, which replaced Health. A pill's
         icon is a ligature, so the result is read from its last text node. */
      await step("System: a job that failed after the morning report gets its banner and is named in the report's findings", async () => {
        await page.waitForSelector('.banner.err[data-job="intent-drain"]');
        const found = await page.$$eval(".find .item-main", (els) => els.map((e) => e.textContent).join(" | "));
        has(found, "intent-drain failed after the morning report", "the findings");
        const note = await page.$eval('#page tbody tr[data-job="intent-drain"] td:last-child small', (e) => e.textContent.trim());
        eq(note, "Since the morning report", "the Result note");
      });
      await step("System: the drain, which the handler refuses, gets no Re-run now and says why", async () => {
        eq(await page.locator('[data-act="rerun"][data-job="intent-drain"]').count(), 0, "Re-run now buttons for the drain");
        has(await page.textContent('.banner.err[data-job="intent-drain"]'),
          "This job starts on its own within a minute of any button being pressed, so it has no Re-run here.", "the banner");
      });
      await step("System: that job's row says Failed, and the other still says OK", async () => {
        const rows = await page.$$eval("#page tbody tr", (trs) => trs.map((tr) =>
          [tr.dataset.job, tr.cells[5].querySelector(".st").lastChild.textContent.trim()]));
        eq(rows.sort(), [["hub-sync", "OK"], ["intent-drain", "Failed"]], "the job table, by name");
      });
      clean(world, errors, "System");
    }
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
      const row = oneRow(world.writes[0]);
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
    await page.goto(`${APEX}/admin/${DOOR_PAGE}`);
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

// ================================================================ the Inbox and System (plan 072)
/* Plan 072 (D7): the Dashboard and Tasks moved to the Inbox, Health to System.
   Each old address is a pointer that moves to its new page at once and reads
   nothing, so a bookmark still works and no old button is left live. */
async function walkMovedPages() {
  area = "The moved admin pages (plan 072)";
  /* Once a section is built, its old pages must point at it, and a pointer
     must point at a built page: a sync that carried half of plan 072 fails
     here rather than walking past it. */
  await step("the moved pages and the built sections agree", async () => {
    const wrong = [];
    const there = (f) => existsSync(join(ADMIN_DIR, f));
    if (built("inbox.html") || adminPages().some((f) => movedTo(f) === "inbox.html")) {
      for (const f of ["dashboard.html", "tasks.html"]) if (there(f) && movedTo(f) !== "inbox.html") wrong.push(`${f} does not point at inbox.html`);
    }
    if (built("system.html") && there("health.html") && movedTo("health.html") !== "system.html") wrong.push("health.html does not point at system.html");
    for (const f of adminPages()) if (movedTo(f) && !built(movedTo(f))) wrong.push(`${f} points at ${movedTo(f)}, which is not built`);
    if (built("system.html") && !REVIEWED) wrong.push("System is built but the review's checks would not run");
    if (wrong.length) throw new Error(wrong.join("; "));
  });
  const moved = adminPages().filter((f) => movedTo(f));
  if (!moved.length) {
    notes.push("No admin page in this copy has moved yet, so the moved-page checks were not run. " +
      "They arrive with the admin sync; WALK_ADMIN_DIR=<engine>/app walks them now.");
    return;
  }
  for (const file of moved) {
    const target = movedTo(file);
    const world = newWorld();
    const { context, page, errors } = await visit(world);
    await step(`${file} moves to ${target} and reads nothing`, async () => {
      const text = adminText(file);
      if (/<script/i.test(text)) throw new Error(`${file} carries a script`);
      if (/\son\w+\s*=/i.test(text)) throw new Error(`${file} carries an event handler`);
      if (/javascript:/i.test(text)) throw new Error(`${file} carries a javascript: address`);
      const refresh = (text.match(/<meta http-equiv="refresh" content="([^"]*)"/i) || [])[1];
      eq(refresh, `0; url=${target}`, "the refresh");
      if (!built(target)) throw new Error(`${file} moves to ${target}, which is not built`);
      const lands = [`/admin/${target}`, `/admin/${target.replace(/\.html$/, "")}`];
      await page.goto(`${APEX}/admin/${file}`);
      await page.waitForURL((u) => lands.includes(new URL(u).pathname));
      await page.waitForSelector("#login", { state: "visible" });
      eq(world.reads.length, 0, "table reads");
      eq(world.writes, [], "writes");
    });
    clean(world, errors, `${file}, moved`);
    await context.close();
  }
}

/* System: the failed run first with Re-run now, which raises one rerun-job
   intent; each job's schedule line from the morning report. The Inbox: Add
   task raises one add-task intent. A page still drawing the shell's "Not
   built yet" panel waits for the admin sync that builds it. */
async function walkInboxAndSystem() {
  area = "The Inbox and System (plan 072)";
  const later = [];
  if (!built("system.html")) later.push("System");
  else {
    const world = newWorld({ rows: systemRows() });
    const { context, page, errors } = await visit(world, { seedAdmin: true });
    await page.goto(`${APEX}/admin/system.html`);
    await step("System: the failed run comes first, with its failing step and Re-run now", async () => {
      await page.waitForSelector('.banner.err[data-job="hub-sync"]');
      has(await page.textContent('.banner.err[data-job="hub-sync"]'), "smartlead-pull", "the banner");
      eq(await page.locator('.banner.err[data-job="hub-sync"] [data-act="rerun"][data-job="hub-sync"]').count(), 1, "Re-run now buttons");
      eq(await page.evaluate(() => {
        const banner = document.querySelector('.banner.err[data-job="hub-sync"]'), panel = document.querySelector("#page .panel");
        return !!(banner && panel && (banner.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING));
      }), true, "the banner comes before the first panel");
    });
    await step("System: each job's row says when it runs, from the morning report", async () => {
      const runs = await page.$$eval("#page tbody tr", (trs) => trs.map((tr) => [tr.dataset.job, tr.cells[2].textContent.trim()]));
      eq(runs.sort(), [["hourly-sync", "Every 2 hours"], ["hub-sync", "Every 2 hours at :20"], ["intent-drain", "On demand"]], "the Runs column");
    });
    await step("System: Re-run now raises one rerun-job intent for that job and touches no other table", async () => {
      eq(world.writes, [], "writes before the click");
      await page.click('[data-act="rerun"][data-job="hub-sync"]');
      await until(() => world.writes.length >= 1, "one write");
      await settled(page);
      eq(world.writes.length, 1, "writes");
      const w = world.writes[0], row = oneRow(w);
      eq([w.method, w.table, row.type, sortedKeys(row.payload_json), row.requested_by],
        ["POST", "engine_intents", "rerun-job", { job: "hub-sync" }, ADMIN_EMAIL], "the intent");
    });
    clean(world, errors, "System");
    await context.close();
  }
  if (!built("inbox.html")) later.push("the Inbox");
  else {
    const world = newWorld({ rows: inboxRows() });
    const { context, page, errors } = await visit(world, { seedAdmin: true });
    await page.goto(`${APEX}/admin/inbox.html`);
    await step("Inbox: a card set aside with Not now shows under Set aside, with Put back", async () => {
      const aside = page.locator("details.archive", { hasText: "Set aside" });
      await aside.waitFor({ state: "attached" });
      has(await aside.locator("summary").textContent(), "Set aside (1)", "the archive's summary");
      has(await aside.textContent(), "Waiting for them to confirm", "the reason");
      eq(await aside.locator('[data-act="putBack"][data-key="registration:00000000-0000-4000-8000-0000000000c9"]').count(),
        1, "Put back on that card");
    });
    await step("Inbox: They wrote last lists the company whose newest email came in", async () => {
      const panel = page.locator("section.panel", { hasText: "They wrote last" });
      await panel.waitFor();
      has(await panel.textContent(), "ZZ Walk Test Ltd", "the panel");
      has(await panel.textContent(), "Re: pricing for the walk", "the panel");
    });
    await step("Inbox: Add task with a title raises one add-task intent and touches no other table", async () => {
      await page.waitForSelector('[data-act="taskOpen"]');
      eq(world.writes, [], "writes before the click");
      await page.click('[data-act="taskOpen"]');
      await page.fill("#tk-title", "Ring the walk about its pricing");
      await page.click('[data-act="taskAdd"]');
      await until(() => world.writes.length >= 1, "one write");
      await settled(page);
      eq(world.writes.length, 1, "writes");
      const w = world.writes[0], row = oneRow(w);
      eq([w.method, w.table, row.type, sortedKeys(row.payload_json), row.requested_by],
        ["POST", "engine_intents", "add-task", { company_id: null, due_on: null, title: "Ring the walk about its pricing" }, ADMIN_EMAIL],
        "the intent");
    });
    clean(world, errors, "the Inbox");
    await context.close();
  }
  if (built("inbox.html")) {
    const world = newWorld({ rows: inboxRows() });
    const { context, page, errors } = await visit(world, { seedAdmin: true });
    await page.goto(`${APEX}/admin/inbox.html`);
    await step("Inbox: Add task with a company picked from the list and a due date sends both", async () => {
      await page.waitForSelector('[data-act="taskOpen"]');
      await page.click('[data-act="taskOpen"]');
      await page.fill("#tk-title", "Send ZZ Walk the price list");
      /* Picking from the datalist puts the option's value in the box, as typing it does. */
      const name = await page.$eval("#tk-co-list option", (o) => o.value);
      eq(name, "ZZ Walk Test Ltd", "the first company offered");
      await page.fill("#tk-co", name);
      await page.fill("#tk-due", "2026-11-02");
      await page.click('[data-act="taskAdd"]');
      await until(() => world.writes.length >= 1, "one write");
      await settled(page);
      eq(world.writes.length, 1, "writes");
      const w = world.writes[0], row = oneRow(w);
      eq([w.table, row.type, sortedKeys(row.payload_json)],
        ["engine_intents", "add-task", { company_id: 1, due_on: "2026-11-02", title: "Send ZZ Walk the price list" }], "the intent");
    });
    clean(world, errors, "the Inbox, a task with a company and a date");
    await context.close();
  }
  const named = later.join(" and ");
  if (later.length) notes.push(`${named[0].toUpperCase() + named.slice(1)} in this copy ${later.length > 1 ? "are" : "is"} not built yet, so ${later.length > 1 ? "their" : "its"} checks were not run. ` +
    "They arrive with the admin sync; WALK_ADMIN_DIR=<engine>/app walks them now.");
}

// ================================================================ the people (plan 052, wave 3)
const INVITE_TOKEN = "a".repeat(64);
async function walkPeople() {
  area = "The account page: You and Users (plan 052, wave 3)";
  {
    const COLLEAGUE = { user_id: "00000000-0000-4000-8000-0000000000c1", name: "Cal League", email: "cal@example.com",
      role: "member", confirmed: true, joined_at: "2026-10-08T09:00:00Z", you: false };
    const world = newWorld({
      user: USER,
      summary: Object.assign({}, EMPTY_SUMMARY, { org: { id: 41, name: USER.company, role: "owner" } }),
      users: [{ user_id: USER.id, name: USER.name, email: USER.email, role: "owner", confirmed: true,
        joined_at: "2026-10-01T09:00:00Z", you: true }, COLLEAGUE],
      invites: [{ id: 3, email: "pending@example.com", created_at: "2026-10-08T09:00:00Z", expires_at: "2026-10-15T09:00:00Z" }],
    });
    world.api["POST /account/profile"] = (w, req) => {
      w.profile = Object.assign({ email: USER.email, role: "owner", pending_email: null }, req.body);
      return [200, { ok: true, profile: w.profile }];
    };
    world.api["POST /account/email"] = (w, req) => (req.body.current_password === PASSWORD
      ? [200, { ok: true, pending_email: req.body.new_email }] : [400, { error: "current_password_wrong" }]);
    world.api["POST /account/invites"] = (w, req) => {
      w.invites = w.invites.concat([{ id: 4, email: req.body.email, created_at: "2026-10-08T10:00:00Z", expires_at: "2026-10-15T10:00:00Z" }]);
      return [200, { ok: true, invite: { id: 4, email: req.body.email } }];
    };
    world.api["POST /account/invites/withdraw"] = (w, req) => {
      w.invites = w.invites.filter((i) => i.id !== req.body.id);
      return [200, { ok: true }];
    };
    world.api["POST /account/users/remove"] = (w, req) => {
      w.users = w.users.filter((u) => u.user_id !== req.body.user_id);
      return [200, { ok: true }];
    };
    const { context, page, errors } = await visit(world);
    await page.goto(`${APEX}/hub/account/settings/`);
    await step("You shows the user's own details, on the settings page", async () => {
      await page.waitForSelector("#you:not([hidden])");
      const t = await page.textContent("#you");
      has(t, USER.name, "the You section");
      return has(t, USER.email, "the You section");
    });
    await step("Users lists everyone on the account, marks the reader, and offers Remove on the colleague only", async () => {
      await page.waitForSelector("#users:not([hidden])");
      const t = await page.textContent("#users");
      has(t, "Cal League", "the Users section");
      has(t, "pending@example.com", "the waiting invitation");
      eq(await page.locator('#users [data-act="user-remove"]').count(), 1, "Remove buttons");
      return eq(await page.getAttribute('#users [data-act="user-remove"]', "data-user"), COLLEAGUE.user_id, "whom Remove removes");
    });
    await step("the sections come in order: Logo, You, Users, each with its own read, and nothing of the account page's", async () => {
      await page.waitForSelector("#logo:not([hidden])");
      const ids = await page.$$eval(".acct-section:not([hidden])", (els) => els.map((e) => e.id));
      eq(ids, ["logo", "you", "users", "closing"], "the sections");
      for (const k of ["GET /account/profile", "GET /account/users", "GET /account/invites", "GET /account/logo"]) eq(apiCalls(world, k).length, 1, `${k} reads`);
      eq(apiCalls(world, "GET /account/summary").length, 0, "summary reads");
      eq(await page.locator("#acctNav, #profile, #waiting, #introductions").count(), 0, "the account page's parts");
    });
    await step("Edit your details posts the person's own fields, and the section shows them saved", async () => {
      await page.click('[data-act="you-edit"]');
      await page.fill("#youTown", "York");
      await page.fill("#youPhone", "0113 222 2222");
      await page.click("#youSave");
      await page.waitForFunction(() => /Saved\./.test(document.getElementById("you").textContent));
      const b = apiCalls(world, "POST /account/profile").pop().body;
      eq([b.name, b.town, b.phone, b.country], [USER.name, "York", "0113 222 2222", USER.country], "the body");
      eq("email" in b || "org_id" in b, false, "an email or account in the body");
      return has(await page.textContent("#you"), "York", "the saved town");
    });
    await step("a wrong current password on the email change says so, and changes nothing", async () => {
      await page.click('[data-act="you-email"]');
      await page.fill("#youNewEmail", "walk.new@example.com");
      await page.fill("#youPassword", "not-it");
      await page.click("#youEmailSend");
      await page.waitForSelector("#youEmailMsg:not([hidden])");
      has(await page.textContent("#youEmailMsg"), "not your current password", "the message");
      return eq(await page.locator("#youPending").count(), 0, "a pending line");
    });
    await step("Change your email address sends the new address and the current password, and says a link is waiting", async () => {
      await page.fill("#youPassword", PASSWORD);
      await page.click("#youEmailSend");
      await page.waitForSelector("#youPending");
      eq(apiCalls(world, "POST /account/email").pop().body, { new_email: "walk.new@example.com", current_password: PASSWORD }, "the body");
      return has(await page.textContent("#youPending"), "walk.new@example.com", "the pending line");
    });
    await step("Send the invitation posts the address, and the waiting list shows it", async () => {
      await page.fill("#inviteEmail", "new.colleague@example.com");
      await page.click("#inviteSend");
      await page.waitForFunction(() => /new\.colleague@example\.com/.test(document.getElementById("users").textContent));
      eq(apiCalls(world, "POST /account/invites").pop().body, { email: "new.colleague@example.com" }, "the body");
      return has(await page.textContent("#inviteMsg"), "Invitation sent", "the message");
    });
    await step("Withdraw takes an invitation back", async () => {
      await page.click('[data-act="invite-withdraw"][data-invite="3"]');
      await page.waitForFunction(() => !/pending@example\.com/.test(document.getElementById("users").textContent));
      return eq(apiCalls(world, "POST /account/invites/withdraw").pop().body, { id: 3 }, "the body");
    });
    await step("Remove asks first, then removes the colleague", async () => {
      world.dialogs = [];
      await page.click('[data-act="user-remove"]');
      await page.waitForFunction(() => !/Cal League/.test(document.getElementById("userList").textContent));
      has((world.dialogs || []).join(" "), "Remove Cal League from", "the question asked");
      eq(apiCalls(world, "POST /account/users/remove").pop().body, { user_id: COLLEAGUE.user_id }, "the body");
      return has(await page.textContent("#usersMsg"), "Cal League has been removed.", "the message");
    });
    await step("the settings page fits a phone's width", async () => {
      await page.setViewportSize({ width: 375, height: 800 });
      const wide = await page.evaluate(() => document.documentElement.scrollWidth);
      await page.setViewportSize({ width: 1280, height: 900 });
      return eq(wide <= 375, true, `page width at 375px (${wide})`);
    });
    clean(world, errors, "the settings page");
    await context.close();
  }

  area = "The invitation page (plan 052, wave 3)";
  // (plan 069's close and reopen walk follows in walkClose)
  {
    const world = newWorld();
    world.api["POST /auth/invite"] = (w, req) => (req.body.token === INVITE_TOKEN
      ? [200, { ok: true, email: "cal@example.com", company: "ZZ Walk Test Ltd", inviter: "Walk Tester" }]
      : [400, { error: "invite_invalid" }]);
    world.api["POST /auth/register-invited"] = () => [200, { ok: true, confirm_required: true }];
    const { context, page, errors } = await visit(world);
    await page.goto(`${APEX}/hub/invite.html?t=${INVITE_TOKEN}`);
    await step("the page names the account, who invited, and the address", async () => {
      await page.waitForSelector("#invName");
      has(await page.textContent("h1"), "Join ZZ Walk Test Ltd.", "the heading");
      has(await page.textContent("#inviteBody"), "Walk Tester has invited you", "the line");
      return has(await page.textContent("#invEmail"), "cal@example.com", "the address");
    });
    await step("Join stays refused until the Platform Terms are ticked", async () => {
      await page.waitForSelector("#invTick");
      await page.fill("#invName", "Cal League");
      await page.fill("#invPass", "a-good-password");
      await page.click("#joinBtn");
      has(await page.textContent("#formErr"), "accept the Platform Terms", "the message");
      return eq(apiCalls(world, "POST /auth/register-invited").length, 0, "registrations sent");
    });
    await step("Join posts the token, the name, the password and the terms version, then says check your inbox", async () => {
      await page.check("#invTick");
      await page.click("#joinBtn");
      await page.waitForFunction(() => /Check your inbox/.test(document.body.textContent));
      const b = apiCalls(world, "POST /auth/register-invited").pop().body;
      return eq([b.token, b.name, b.password, b.terms_version_id], [INVITE_TOKEN, "Cal League", "a-good-password", 12], "the body");
    });
    await page.goto(`${APEX}/hub/invite.html?t=${"b".repeat(64)}`);
    await step("a used or expired invitation says so", async () => {
      await page.waitForFunction(() => /used or has expired/.test(document.body.textContent));
      return true;
    });
    clean(world, errors, "the invitation page");
    await context.close();
  }

  area = "The email-change page (plan 052, wave 3)";
  {
    const world = newWorld();
    world.api["POST /account/email/confirm"] = (w, req) => (req.body.token === INVITE_TOKEN
      ? [200, { ok: true, email: "walk.new@example.com" }] : [400, { error: "link_invalid" }]);
    const { context, page, errors } = await visit(world);
    await page.goto(`${APEX}/hub/email.html?t=${INVITE_TOKEN}`);
    await step("the link changes the address and says which one signs in now", async () => {
      await page.waitForFunction(() => /Your email address is changed/.test(document.body.textContent));
      has(await page.textContent("#emailBody"), "walk.new@example.com", "the new address");
      return eq(new URL(await page.getAttribute("#emailBody a", "href"), page.url()).pathname, "/hub/account/", "where the button goes");
    });
    await page.goto(`${APEX}/hub/email.html?t=${"c".repeat(64)}`);
    await step("a used or expired link says so", async () => {
      await page.waitForFunction(() => /used or has expired/.test(document.body.textContent));
      return true;
    });
    clean(world, errors, "the email-change page");
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
  .concat(ONLY !== "boards" ? [walkDoor, walkRegister, walkJoin, walkWall, walkDoorReturn, walkSignedIn, walkFindMap, walkAccount, walkLogo, walkAccountAnswers, walkHomepage, walkLandings, walkSign] : [])
  .concat(ONLY !== "public" ? [walkAdminDoor, walkBoards, walkMovedPages, walkInboxAndSystem, walkReviewedBoards, walkOrganisationsNames, walkProspectsCrm] : []);
/* The settings page's You and Users (plan 052, wave 3) walk straight after the account page. */
if (ONLY !== "boards") parts.splice(parts.indexOf(walkAccount) + 1, 0, walkPeople);
/* Closing and reopening the account (plan 069) walks straight after the settings page. */
if (ONLY !== "boards") parts.splice(parts.indexOf(walkPeople) + 1, 0, walkClose);
/* The listing form's ship picker (plan 055) walks straight after the find map. */
if (ONLY !== "boards") parts.splice(parts.indexOf(walkFindMap) + 1, 0, walkOfferMap);
/* The membership beside the terms and an edit as a change (plan 068) walk straight after the ship picker. */
if (ONLY !== "boards") parts.splice(parts.indexOf(walkOfferMap) + 1, 0, walkOfferCommit);
if (ONLY === "sign") parts.splice(0, parts.length, walkSign);
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

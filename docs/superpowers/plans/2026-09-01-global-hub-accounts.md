# Global Hub Accounts (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real member accounts for the Global Hub — a three-step questionnaire that fires when a visitor acts, worker-fronted Supabase Auth with a cross-subdomain session cookie, prefilled one-click actions for signed-in members, and a Members view in the admin app.

**Architecture:** The existing capture worker (`_system/portal-worker/`) gains an `/auth/*` surface that proxies Supabase Auth (no password ever stored by us) and sets an HttpOnly cookie on `.nexpoint.co.uk`, served via a new `api.nexpoint.co.uk` custom domain. A single shared client module `assets/hub-account.js` (website repo, apex only) owns the questionnaire, sign-in, the act gate and prefill; the per-hub `portal.js` copies delegate to it with the current anonymous forms as graceful fallback.

**Tech Stack:** Cloudflare Workers (no framework), Supabase (Auth + Postgres/REST), vanilla JS/CSS static site, vitest for worker unit tests (new — the only test infra in either repo).

**Spec:** `docs/superpowers/specs/2026-09-01-global-hub-accounts-design.md` (website repo). Phase 2 (explainer animation) is deliberately NOT in this plan — it gets its own plan after Phase 1 lands.

## Global Constraints

- **Two repos.** Worker tasks (1–4) run in `/Users/willlawrie/Documents/Claude/Projects/Nexpoint` (remote `Nexpoint-Agent-`), on branch `claude/hub-auth-worker`. Website tasks (5–10) run in `/Users/willlawrie/Documents/Claude/Projects/Nexpoint/website` (remote `NEXPOINT-1`), on the existing branch `claude/hub-accounts`. Push only to `origin claude/*`; Will merges. Never push to main.
- **Secrets never in code or committed files.** `SUPABASE_SERVICE_KEY`, `RESEND_API_KEY` etc. exist as Wrangler secrets; locally in `_system/portal-worker/.dev.vars` (gitignored). The anon key `sb_publishable_a2-WFA1i5tqkoHy52_aGzQ_6Yx3xtNo` and URL `https://synywukadvjpjjxjylwk.supabase.co` are public by design.
- **British English** in all user-facing copy (organisation, personalised). **No emoji ever.** CTAs verb-first and specific — never "Submit"/"Learn more". Fonts/colours per `brand/design-system.md`; reuse `portal.css` classes (`.modal`, `.form-grid`, `.field`, `.btn`, `.privacy`, `.success`) rather than inventing new ones.
- **The three `portal.js` copies** (`hub/assets/`, `printhub/assets/`, `millhub/assets/`) are byte-identical and must stay that way: edit `hub/assets/portal.js`, then literally copy the file over the other two.
- **Preserve the honeypot** (`company_url`) and existing validation on every worker route. Do not touch `/smartlead/control`, `/intents/ping`, or the legacy root capture route except where a task says so.
- **Worker deploys and Supabase dashboard changes are Will's steps** — the plan marks them ⚠️ HUMAN. Never run `npx wrangler deploy` or execute SQL against production yourself; prepare everything and hand over.
- Client fetches to the API must use `credentials: 'include'`; the API base is `https://api.nexpoint.co.uk` in production, `http://localhost:8787` when the page host is localhost.

---

### Task 1: Worker test scaffold + session cookie helpers

**Files:**
- Create: `_system/portal-worker/package.json`
- Create: `_system/portal-worker/auth.js`
- Test: `_system/portal-worker/auth.test.js`
- Modify: `_system/portal-worker/.gitignore` (create if absent — must cover `node_modules/` and `.dev.vars`)

**Interfaces:**
- Produces: `buildSessionCookie(session, apiHostname) → string`, `parseSessionCookie(cookieHeader) → {at, rt} | null`, `clearSessionCookie(apiHostname) → string`, exported from `auth.js`. Cookie name `np_session`, value = base64url of JSON `{at, rt}`, `Max-Age=2592000`, `HttpOnly; Secure; SameSite=Lax; Path=/`, plus `Domain=.nexpoint.co.uk` only when `apiHostname` ends with `nexpoint.co.uk` (omit on localhost so `wrangler dev` works).

- [ ] **Step 1: Create branch in the parent repo**

```bash
cd /Users/willlawrie/Documents/Claude/Projects/Nexpoint
git checkout main && git pull && git checkout -b claude/hub-auth-worker
```

- [ ] **Step 2: Create `package.json` and `.gitignore`, install vitest**

```json
{
  "name": "nexpoint-portal-worker",
  "private": true,
  "type": "module",
  "scripts": { "test": "vitest run" },
  "devDependencies": { "vitest": "^2.1.0" }
}
```

`.gitignore`:

```
node_modules/
.dev.vars
```

Run: `cd _system/portal-worker && npm install`

- [ ] **Step 3: Write the failing test**

`auth.test.js`:

```js
import { describe, it, expect } from "vitest";
import { buildSessionCookie, parseSessionCookie, clearSessionCookie } from "./auth.js";

const SESSION = { access_token: "at.abc", refresh_token: "rt.def" };

describe("session cookie", () => {
  it("round-trips a session through build and parse", () => {
    const cookie = buildSessionCookie(SESSION, "api.nexpoint.co.uk");
    expect(cookie).toMatch(/^np_session=/);
    expect(cookie).toContain("Domain=.nexpoint.co.uk");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    const header = cookie.split(";")[0]; // "np_session=<value>"
    expect(parseSessionCookie(header)).toEqual({ at: "at.abc", rt: "rt.def" });
  });
  it("omits Domain on localhost so wrangler dev works", () => {
    expect(buildSessionCookie(SESSION, "localhost")).not.toContain("Domain=");
  });
  it("returns null for absent or garbage cookies", () => {
    expect(parseSessionCookie("")).toBeNull();
    expect(parseSessionCookie("other=1; np_session=%%%")).toBeNull();
  });
  it("clears with Max-Age=0", () => {
    expect(clearSessionCookie("api.nexpoint.co.uk")).toContain("Max-Age=0");
  });
});
```

- [ ] **Step 4: Run to verify failure** — `npm test` → FAIL (auth.js missing).

- [ ] **Step 5: Implement `auth.js` (helpers only for now)**

```js
/**
 * Global Hub member auth (spec: website/docs/superpowers/specs/
 * 2026-09-01-global-hub-accounts-design.md). Proxies Supabase Auth;
 * the worker never sees a stored password, only forwards it over TLS.
 * Session rides an HttpOnly cookie scoped to .nexpoint.co.uk so one
 * sign-in covers the apex and every hub subdomain.
 */
const COOKIE_NAME = "np_session";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days ≈ refresh-token life

const b64uEncode = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64uDecode = (s) => {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

const onBrandDomain = (h) => /(^|\.)nexpoint\.co\.uk$/.test(h);

export function buildSessionCookie(session, apiHostname) {
  const value = b64uEncode(JSON.stringify({ at: session.access_token, rt: session.refresh_token }));
  const domain = onBrandDomain(apiHostname) ? "Domain=.nexpoint.co.uk; " : "";
  return `${COOKIE_NAME}=${value}; ${domain}Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`;
}

export function parseSessionCookie(cookieHeader) {
  const m = /(?:^|;\s*)np_session=([^;]+)/.exec(cookieHeader || "");
  if (!m) return null;
  try {
    const v = JSON.parse(b64uDecode(m[1]));
    return v && v.at && v.rt ? { at: v.at, rt: v.rt } : null;
  } catch { return null; }
}

export function clearSessionCookie(apiHostname) {
  const domain = onBrandDomain(apiHostname) ? "Domain=.nexpoint.co.uk; " : "";
  return `${COOKIE_NAME}=; ${domain}Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}
```

- [ ] **Step 6: Run to verify pass** — `npm test` → 4 passing.

- [ ] **Step 7: Commit**

```bash
git add _system/portal-worker/package.json _system/portal-worker/package-lock.json \
  _system/portal-worker/.gitignore _system/portal-worker/auth.js _system/portal-worker/auth.test.js
git commit -m "Worker: session cookie helpers + first test infra (vitest)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `/auth/register` — create the member, sign them in, take their pending request

**Files:**
- Modify: `_system/portal-worker/auth.js`
- Test: `_system/portal-worker/auth.test.js`

**Interfaces:**
- Consumes: cookie helpers from Task 1; `env.SUPABASE_URL`, `env.SUPABASE_ANON_KEY`, `env.SUPABASE_SERVICE_KEY`.
- Produces: `handleRegister(request, env, ctx, origin, apiHostname) → Response`, and internal `sbFetch(env, path, opts)`. Register body: `{name, company, email, password, phone?, region?, country?, town?, interests?, notes?, pending_request?, company_url?}`. Success `200 {ok:true, member:{name,company,email,region,country,town,interests}}` + `Set-Cookie`. Duplicate email → `409 {error:"account_exists"}`. Also produces `storeRequestRow(env, row) → {ok, id?}` (used again in Task 4).
- Interests whitelist: `["find_print","offer_print","mill_cell","opportunities","education"]`.

- [ ] **Step 1: Write the failing tests** (append to `auth.test.js`)

```js
import { vi, beforeEach, afterEach } from "vitest";
import { handleRegister } from "./auth.js";

const ENV = { SUPABASE_URL: "https://sb.test", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_KEY: "svc" };
const CTX = { waitUntil: () => {} };
const post = (body) => new Request("https://api.nexpoint.co.uk/auth/register", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const GOOD = { name: "Ana Lab", company: "Ana Orthotics", email: "ana@lab.com", password: "print-my-shells",
  region: "Europe", country: "Portugal", town: "Porto", interests: ["find_print"], notes: "SLS, 60 pairs/wk" };

function stubSupabase(overrides = {}) {
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    const u = String(url);
    if (u.includes("/auth/v1/admin/users"))
      return overrides.admin || new Response(JSON.stringify({ id: "u-1", email: "ana@lab.com" }), { status: 200 });
    if (u.includes("/auth/v1/token?grant_type=password"))
      return new Response(JSON.stringify({ access_token: "at.1", refresh_token: "rt.1",
        user: { id: "u-1", email: "ana@lab.com" } }), { status: 200 });
    if (u.includes("/rest/v1/member_profiles"))
      return new Response(null, { status: 201 });
    if (u.includes("/rest/v1/web_requests"))
      return new Response(JSON.stringify([{ id: 42 }]), { status: 201 });
    return new Response("unexpected " + u, { status: 500 });
  }));
}
beforeEach(() => stubSupabase());
afterEach(() => vi.unstubAllGlobals());

describe("handleRegister", () => {
  it("creates the user, signs in, stores the profile, sets the cookie", async () => {
    const r = await handleRegister(post(GOOD), ENV, CTX, "https://nexpoint.co.uk", "api.nexpoint.co.uk");
    expect(r.status).toBe(200);
    expect(r.headers.get("Set-Cookie")).toContain("np_session=");
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(body.member.company).toBe("Ana Orthotics");
    // profile insert used the service key
    const profileCall = fetch.mock.calls.find(([u]) => String(u).includes("member_profiles"));
    expect(profileCall[1].headers.apikey).toBe("svc");
  });
  it("stores a pending request with the new member id", async () => {
    const r = await handleRegister(post({ ...GOOD, pending_request: { hub: "print", side: "request_intro",
      brief_ref: "OPTION 1", payload: { notes: "near Porto" } } }), ENV, CTX, "https://nexpoint.co.uk", "api.nexpoint.co.uk");
    expect(r.status).toBe(200);
    const reqCall = fetch.mock.calls.find(([u]) => String(u).includes("web_requests"));
    expect(JSON.parse(reqCall[1].body).member_id).toBe("u-1");
  });
  it("409s a duplicate email without leaking detail", async () => {
    stubSupabase({ admin: new Response(JSON.stringify({ msg: "already been registered" }), { status: 422 }) });
    const r = await handleRegister(post(GOOD), ENV, CTX, "https://nexpoint.co.uk", "api.nexpoint.co.uk");
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("account_exists");
  });
  it("swallows the honeypot", async () => {
    const r = await handleRegister(post({ ...GOOD, company_url: "spam.biz" }), ENV, CTX, "https://nexpoint.co.uk", "api.nexpoint.co.uk");
    expect(r.status).toBe(200);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("422s a weak password", async () => {
    const r = await handleRegister(post({ ...GOOD, password: "short" }), ENV, CTX, "https://nexpoint.co.uk", "api.nexpoint.co.uk");
    expect(r.status).toBe(422);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm test` → new tests FAIL (`handleRegister` not exported).

- [ ] **Step 3: Implement in `auth.js`**

```js
const INTERESTS = ["find_print", "offer_print", "mill_cell", "opportunities", "education"];
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const jsonRes = (obj, status, origin, extra = {}) =>
  new Response(JSON.stringify(obj), { status, headers: {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Vary": "Origin",
    ...extra,
  } });

async function sbFetch(env, path, { method = "POST", key, token, body } = {}) {
  const headers = { apikey: key, "Content-Type": "application/json" };
  headers.Authorization = `Bearer ${token || key}`;
  const r = await fetch(`${env.SUPABASE_URL}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return r;
}

function cleanProfile(p) {
  return {
    name: (p.name || "").trim().slice(0, 200),
    company: (p.company || "").trim().slice(0, 200),
    email: (p.email || "").trim().toLowerCase().slice(0, 200),
    phone: (p.phone || "").trim().slice(0, 50) || null,
    region: (p.region || "").trim().slice(0, 100) || null,
    country: (p.country || "").trim().slice(0, 100) || null,
    town: (p.town || "").trim().slice(0, 100) || null,
    interests: Array.isArray(p.interests) ? p.interests.filter((i) => INTERESTS.includes(i)) : [],
    notes: (p.notes || "").trim().slice(0, 2000) || null,
  };
}

// Shared with /requests (worker.js imports this in Task 4): one place
// writes web_requests rows, so register's pending request and the live
// form path can't drift apart.
export async function storeRequestRow(env, row) {
  const r = await sbFetch(env, "/rest/v1/web_requests", {
    key: env.SUPABASE_SERVICE_KEY, body: row,
  });
  if (!r.ok) return { ok: false, status: r.status };
  const [saved] = await r.json().catch(() => [{}]);
  return { ok: true, id: saved && saved.id };
}

export async function handleRegister(request, env, ctx, origin, apiHostname) {
  let p;
  try { p = await request.json(); } catch { return jsonRes({ error: "bad json" }, 400, origin); }
  if (p.company_url) return jsonRes({ ok: true }, 200, origin); // honeypot
  const prof = cleanProfile(p);
  if (!prof.name || !prof.company) return jsonRes({ error: "name and company required" }, 422, origin);
  if (!EMAIL_RE.test(prof.email)) return jsonRes({ error: "valid email required" }, 422, origin);
  const password = typeof p.password === "string" ? p.password : "";
  if (password.length < 8 || password.length > 72)
    return jsonRes({ error: "password must be at least 8 characters" }, 422, origin);

  // 1) create the auth user (service role; email pre-confirmed = instant access)
  const created = await sbFetch(env, "/auth/v1/admin/users", {
    key: env.SUPABASE_SERVICE_KEY, body: { email: prof.email, password, email_confirm: true },
  });
  if (created.status === 422) return jsonRes({ error: "account_exists" }, 409, origin);
  if (!created.ok) return jsonRes({ error: `auth create failed (${created.status})` }, 502, origin);
  const user = await created.json();

  // 2) sign them in (password grant → session tokens)
  const grant = await sbFetch(env, "/auth/v1/token?grant_type=password", {
    key: env.SUPABASE_ANON_KEY, body: { email: prof.email, password },
  });
  if (!grant.ok) return jsonRes({ error: "sign-in after registration failed" }, 502, origin);
  const session = await grant.json();

  // 3) profile row (service role — anon has no access to member_profiles)
  const ins = await sbFetch(env, "/rest/v1/member_profiles", {
    key: env.SUPABASE_SERVICE_KEY, body: { user_id: user.id, ...prof },
  });
  if (!ins.ok && ins.status !== 409) return jsonRes({ error: `profile store failed (${ins.status})` }, 502, origin);

  // 4) the action that opened the gate, if any, becomes their first request
  if (p.pending_request && typeof p.pending_request === "object") {
    const q = p.pending_request;
    await storeRequestRow(env, {
      hub: q.hub, side: q.side,
      company: prof.company, contact_name: prof.name, email: prof.email,
      phone: prof.phone || "", location: [prof.town, prof.country].filter(Boolean).join(", "),
      brief_ref: (q.brief_ref || "").replace(/^BRIEF\s+/i, "").trim().slice(0, 20),
      payload: (q.payload && typeof q.payload === "object") ? q.payload : {},
      member_id: user.id,
    });
  }

  const member = { name: prof.name, company: prof.company, email: prof.email,
    region: prof.region, country: prof.country, town: prof.town, interests: prof.interests };
  return jsonRes({ ok: true, member }, 200, origin,
    { "Set-Cookie": buildSessionCookie(session, apiHostname) });
}
```

- [ ] **Step 4: Run to verify pass** — `npm test` → all passing.

- [ ] **Step 5: Commit** — `git add _system/portal-worker/auth.js _system/portal-worker/auth.test.js && git commit -m "Worker: /auth/register — member creation via Supabase Auth"` (with the Co-Authored-By trailer as in Task 1).

---

### Task 3: `/auth/login`, `/auth/logout`, `/auth/me`, and `resolveMember`

**Files:**
- Modify: `_system/portal-worker/auth.js`
- Test: `_system/portal-worker/auth.test.js`

**Interfaces:**
- Consumes: Task 1 helpers, Task 2 `sbFetch`/`jsonRes`/`cleanProfile`.
- Produces:
  - `handleLogin(request, env, ctx, origin, apiHostname)` — body `{email, password}`; 200 `{ok, member}` + cookie; bad credentials → `401 {error:"invalid_credentials"}`.
  - `handleLogout(request, env, ctx, origin, apiHostname)` — always 200 `{ok:true}` + clearing cookie.
  - `handleMe(request, env, ctx, origin, apiHostname)` — GET; `{signed_in:false}` without valid session; else `{signed_in:true, member}`; transparently refreshes an expired access token and rotates the cookie.
  - `resolveMember(request, env) → {memberId: string|null, setCookie: string|null}` — used by `/requests` in Task 4.
  - `handleAuth(request, env, ctx, origin, url) → Response|null` — routes `/auth/*` (register/login/logout POST, me GET), 405 otherwise; returns null for non-auth paths.

- [ ] **Step 1: Write the failing tests** (append; reuse `stubSupabase` by extending it)

```js
import { handleLogin, handleMe, handleLogout } from "./auth.js";

const cookieFor = (at, rt) => {
  // mirror buildSessionCookie's encoding for test requests
  const v = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify({ at, rt }))))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `np_session=${v}`;
};
const getMe = (cookie) => new Request("https://api.nexpoint.co.uk/auth/me", {
  method: "GET", headers: cookie ? { Cookie: cookie } : {},
});

function stubAuthApis({ userStatus = 200, refreshOk = true } = {}) {
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    const u = String(url);
    if (u.includes("/auth/v1/token?grant_type=password")) {
      const body = JSON.parse(init.body);
      if (body.password === "wrong") return new Response("{}", { status: 400 });
      return new Response(JSON.stringify({ access_token: "at.1", refresh_token: "rt.1",
        user: { id: "u-1", email: body.email } }), { status: 200 });
    }
    if (u.includes("/auth/v1/token?grant_type=refresh_token"))
      return refreshOk
        ? new Response(JSON.stringify({ access_token: "at.2", refresh_token: "rt.2",
            user: { id: "u-1", email: "ana@lab.com" } }), { status: 200 })
        : new Response("{}", { status: 400 });
    if (u.includes("/auth/v1/user"))
      return new Response(JSON.stringify({ id: "u-1", email: "ana@lab.com" }), { status: userStatus });
    if (u.includes("/auth/v1/logout")) return new Response(null, { status: 204 });
    if (u.includes("/rest/v1/member_profiles"))
      return new Response(JSON.stringify([{ user_id: "u-1", name: "Ana Lab", company: "Ana Orthotics",
        email: "ana@lab.com", region: "Europe", country: "Portugal", town: "Porto",
        interests: ["find_print"] }]), { status: 200 });
    return new Response("unexpected " + u, { status: 500 });
  }));
}

describe("login / me / logout", () => {
  it("logs in and returns the member with a cookie", async () => {
    stubAuthApis();
    const r = await handleLogin(new Request("https://api.nexpoint.co.uk/auth/login", { method: "POST",
      body: JSON.stringify({ email: "ana@lab.com", password: "print-my-shells" }) }),
      ENV, CTX, "https://nexpoint.co.uk", "api.nexpoint.co.uk");
    expect(r.status).toBe(200);
    expect((await r.json()).member.name).toBe("Ana Lab");
    expect(r.headers.get("Set-Cookie")).toContain("np_session=");
  });
  it("401s wrong credentials", async () => {
    stubAuthApis();
    const r = await handleLogin(new Request("https://api.nexpoint.co.uk/auth/login", { method: "POST",
      body: JSON.stringify({ email: "ana@lab.com", password: "wrong" }) }),
      ENV, CTX, "https://nexpoint.co.uk", "api.nexpoint.co.uk");
    expect(r.status).toBe(401);
  });
  it("me: signed_in false with no cookie, true with one", async () => {
    stubAuthApis();
    expect((await (await handleMe(getMe(null), ENV, CTX, "https://nexpoint.co.uk", "api.nexpoint.co.uk")).json()).signed_in).toBe(false);
    const r = await handleMe(getMe(cookieFor("at.1", "rt.1")), ENV, CTX, "https://nexpoint.co.uk", "api.nexpoint.co.uk");
    expect((await r.json()).member.company).toBe("Ana Orthotics");
  });
  it("me: refreshes an expired access token and rotates the cookie", async () => {
    stubAuthApis({ userStatus: 401 }); // first /user check fails → refresh path
    vi.mocked(fetch).mockImplementationOnce(async () => new Response("{}", { status: 401 })); // expired at
    const r = await handleMe(getMe(cookieFor("at.old", "rt.1")), ENV, CTX, "https://nexpoint.co.uk", "api.nexpoint.co.uk");
    expect((await r.json()).signed_in).toBe(true);
    expect(r.headers.get("Set-Cookie")).toContain("np_session=");
  });
  it("logout clears the cookie even without a session", async () => {
    stubAuthApis();
    const r = await handleLogout(new Request("https://api.nexpoint.co.uk/auth/logout", { method: "POST" }),
      ENV, CTX, "https://nexpoint.co.uk", "api.nexpoint.co.uk");
    expect(r.headers.get("Set-Cookie")).toContain("Max-Age=0");
  });
});
```

Note: the refresh test stubs `/auth/v1/user` to 401 once; after refresh the retry hits the same stub — set `userStatus: 401` then flip: implement the stub so `/auth/v1/user` returns 401 for `Bearer at.old` and 200 otherwise (check `init.headers.Authorization`), which is more faithful than call-count tricks. Adjust while implementing — the assertion that matters is `signed_in:true` + rotated cookie.

- [ ] **Step 2: Run to verify failure** — `npm test` → FAIL (functions not exported).

- [ ] **Step 3: Implement in `auth.js`**

```js
async function fetchUser(env, at) {
  const r = await sbFetch(env, "/auth/v1/user", { method: "GET", key: env.SUPABASE_ANON_KEY, token: at });
  return r.ok ? r.json() : null;
}
async function refreshSession(env, rt) {
  const r = await sbFetch(env, "/auth/v1/token?grant_type=refresh_token", {
    key: env.SUPABASE_ANON_KEY, body: { refresh_token: rt },
  });
  return r.ok ? r.json() : null;
}
// Cookie → live user, refreshing if the access token has aged out.
async function sessionUser(request, env, apiHostname) {
  const s = parseSessionCookie(request.headers.get("Cookie"));
  if (!s) return { user: null, setCookie: null };
  let user = await fetchUser(env, s.at);
  if (user) return { user, setCookie: null };
  const fresh = await refreshSession(env, s.rt);
  if (!fresh) return { user: null, setCookie: clearSessionCookie(apiHostname) };
  user = await fetchUser(env, fresh.access_token);
  return { user, setCookie: buildSessionCookie(fresh, apiHostname) };
}

async function memberFor(env, userId) {
  const r = await sbFetch(env, `/rest/v1/member_profiles?user_id=eq.${userId}` +
    `&select=name,company,email,region,country,town,interests`, {
    method: "GET", key: env.SUPABASE_SERVICE_KEY,
  });
  if (!r.ok) return null;
  const [row] = await r.json().catch(() => []);
  return row || null;
}

export async function handleLogin(request, env, ctx, origin, apiHostname) {
  let p;
  try { p = await request.json(); } catch { return jsonRes({ error: "bad json" }, 400, origin); }
  const email = (p.email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email) || typeof p.password !== "string")
    return jsonRes({ error: "invalid_credentials" }, 401, origin);
  const grant = await sbFetch(env, "/auth/v1/token?grant_type=password", {
    key: env.SUPABASE_ANON_KEY, body: { email, password: p.password },
  });
  if (!grant.ok) return jsonRes({ error: "invalid_credentials" }, 401, origin);
  const session = await grant.json();
  const member = await memberFor(env, session.user.id) ||
    { name: "", company: "", email, region: null, country: null, town: null, interests: [] };
  return jsonRes({ ok: true, member }, 200, origin,
    { "Set-Cookie": buildSessionCookie(session, apiHostname) });
}

export async function handleLogout(request, env, ctx, origin, apiHostname) {
  const s = parseSessionCookie(request.headers.get("Cookie"));
  if (s) ctx.waitUntil(sbFetch(env, "/auth/v1/logout", { key: env.SUPABASE_ANON_KEY, token: s.at }).catch(() => {}));
  return jsonRes({ ok: true }, 200, origin, { "Set-Cookie": clearSessionCookie(apiHostname) });
}

export async function handleMe(request, env, ctx, origin, apiHostname) {
  const { user, setCookie } = await sessionUser(request, env, apiHostname);
  if (!user) return jsonRes({ signed_in: false }, 200, origin, setCookie ? { "Set-Cookie": setCookie } : {});
  const member = await memberFor(env, user.id);
  return jsonRes({ signed_in: true, member }, 200, origin, setCookie ? { "Set-Cookie": setCookie } : {});
}

// For /requests: who is making this submission, if anyone?
export async function resolveMember(request, env) {
  const apiHostname = new URL(request.url).hostname;
  const { user, setCookie } = await sessionUser(request, env, apiHostname);
  return { memberId: user ? user.id : null, setCookie };
}

export function handleAuth(request, env, ctx, origin, url) {
  const apiHostname = url.hostname;
  if (url.pathname === "/auth/me")
    return request.method === "GET" ? handleMe(request, env, ctx, origin, apiHostname)
      : jsonRes({ error: "GET only" }, 405, origin);
  const posts = { "/auth/register": handleRegister, "/auth/login": handleLogin, "/auth/logout": handleLogout };
  const h = posts[url.pathname];
  if (!h) return null;
  if (request.method !== "POST") return jsonRes({ error: "POST only" }, 405, origin);
  return h(request, env, ctx, origin, apiHostname);
}
```

- [ ] **Step 4: Run to verify pass** — `npm test` → all passing.

- [ ] **Step 5: Commit** — `git add -A _system/portal-worker && git commit -m "Worker: login, logout, me, resolveMember"` (with trailer).

---

### Task 4: Wire auth into `worker.js`, migration SQL, custom domain — then hand deploy to Will

**Files:**
- Modify: `_system/portal-worker/worker.js`
- Modify: `_system/portal-worker/wrangler.toml`
- Create: `_system/portal-worker/migrations/2026-09-01-member-profiles.sql`
- Modify: `_system/portal-worker/README.md` (deploy + dashboard steps)
- Test: `_system/portal-worker/auth.test.js` (routing smoke test)

**Interfaces:**
- Consumes: `handleAuth`, `resolveMember`, `storeRequestRow` from auth.js.
- Produces: live endpoints under `https://api.nexpoint.co.uk`; `web_requests` rows now carry `member_id` when a session cookie is present; `education`/`join_list` accepted by `/requests`.

- [ ] **Step 1: Write the failing routing test** (append)

```js
import worker from "./worker.js";
it("routes GET /auth/me through the method gate", async () => {
  stubAuthApis();
  const r = await worker.fetch(getMe(null), ENV, CTX);
  expect(r.status).toBe(200);
  expect((await r.json()).signed_in).toBe(false);
});
```

- [ ] **Step 2: Run to verify failure** — the current worker answers `{"error":"POST only"}` with 405.

- [ ] **Step 3: Modify `worker.js`**

At the top: `import { handleAuth, resolveMember, storeRequestRow } from "./auth.js";`

In `CORS_HEADERS`, allow GET and credentials:

```js
const CORS_HEADERS = (origin) => ({
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Credentials": "true",
  "Vary": "Origin",
});
```

In `fetch`, route `/auth/*` before the POST-only gate:

```js
if (request.method === "OPTIONS") return preflight(origin);
const url = new URL(request.url);
if (url.pathname.startsWith("/auth/")) {
  const r = handleAuth(request, env, ctx, origin, url);
  if (r) return r;
}
if (request.method !== "POST") return json({ error: "POST only" }, 405, origin);
```

(Remove the later duplicate `const url = new URL(request.url);`.)

In `handleWebRequest`: extend the vocab and attach the member. Change the constants to

```js
const VALID_HUBS = ["print", "mill", "opportunities", "education"];
const VALID_SIDES = ["offer_capacity", "request_capacity", "list_opportunity", "request_intro", "join_list"];
```

and after the `row` object is built, before the Supabase insert:

```js
const member = await resolveMember(request, env);
if (member.memberId) row.member_id = member.memberId;
```

Replace the inline `fetch(.../web_requests ...)` block with `const stored = await storeRequestRow(env, row); if (!stored.ok) return json({ error: \`store failed (${stored.status})\` }, 502, origin); const saved = { id: stored.id };` and add `join_list: "Education list signup"` to `SIDE_LABEL`.

- [ ] **Step 4: Run to verify pass** — `npm test` → all passing.

- [ ] **Step 5: Add the custom domain route to `wrangler.toml`** (top level, above `[vars]`):

```toml
routes = [
  { pattern = "api.nexpoint.co.uk", custom_domain = true }
]
```

- [ ] **Step 6: Write the migration** — `migrations/2026-09-01-member-profiles.sql`:

```sql
-- Global Hub member accounts (spec 2026-09-01). Run once in the
-- Supabase SQL editor. Safe to re-run.
create table if not exists member_profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  name       text not null,
  company    text not null,
  email      text not null,
  phone      text,
  region     text,
  country    text,
  town       text,
  interests  text[] not null default '{}',
  notes      text,
  created_at timestamptz not null default now()
);
alter table member_profiles enable row level security;
-- Admin boards read it with the admins' own sessions; members are served
-- through the worker (service role), so no member-facing policy exists.
drop policy if exists member_profiles_admin_read on member_profiles;
create policy member_profiles_admin_read on member_profiles
  for select to authenticated
  using ((auth.jwt() ->> 'email') in ('willlawrie@nexpoint.co.uk', 'chris@nexpoint.co.uk'));

alter table web_requests add column if not exists member_id uuid references auth.users(id);
```

- [ ] **Step 7: Update `README.md`** — add an "Auth (2026-09)" section documenting the four endpoints, the cookie, and the one-time steps below, matching the file's existing tone.

- [ ] **Step 8: Local smoke test** — `npx wrangler dev` in one terminal, then:

```bash
curl -si http://localhost:8787/auth/me | head -3
```

Expected: `200` with `{"signed_in":false}` (uses `.dev.vars` for real Supabase keys; if `.dev.vars` is missing, note it in the handoff rather than guessing values).

- [ ] **Step 9: Commit and push**

```bash
git add -A _system/portal-worker && git commit -m "Worker: auth routes wired, member_id on requests, api custom domain

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push -u origin claude/hub-auth-worker
```

- [ ] **Step 10: ⚠️ HUMAN — hand Will the go-live list** (put it in the PR body):
  1. Run `migrations/2026-09-01-member-profiles.sql` in the Supabase SQL editor.
  2. Merge this branch, then `cd _system/portal-worker && npx wrangler deploy` — the `custom_domain = true` route creates the `api.nexpoint.co.uk` DNS record automatically (zone is already on Cloudflare).
  3. Verify: `curl -s https://api.nexpoint.co.uk/auth/me` → `{"signed_in":false}`.

**The website tasks below can be built and reviewed before the worker is deployed, but must not be MERGED until Step 10 is done** — the pages would call an API host that doesn't resolve.

---

### Task 5: `hub-account.js` core — bootstrap, chip, real sign-in

**Files:**
- Create: `assets/hub-account.js` (website repo root assets)
- Modify: `hub/index.html`
- Modify: `hub/assets/portal.js` (then copy to `printhub/assets/portal.js`, `millhub/assets/portal.js`)

**Interfaces:**
- Produces: global `NPAccount` with:
  - `NPAccount.api` — API base string.
  - `NPAccount.user` — `null` or the member object `{name, company, email, region, country, town, interests}`.
  - `NPAccount.ready` — Promise resolving after the initial `/auth/me`.
  - `NPAccount.signIn(email, password) → Promise<{ok}|{error}>`, `NPAccount.signOut()`.
  - `NPAccount.openQuestionnaire(opts)` and `NPAccount.gate(action)` — stubs in this task (`console.warn`), implemented in Task 6.
  - Dispatches `document` event `npaccount:change` whenever `user` changes.
- Consumes: `portal.css` classes; the existing `#signOverlay` modal on `hub/index.html`.

- [ ] **Step 1: Write `assets/hub-account.js`**

```js
/* NexPoint Global Hub — member account module (spec 2026-09-01).
   Served from the apex only; subdomain pages load it by absolute URL.
   Progressive enhancement: if this file fails to load, every form
   falls back to its original anonymous behaviour. */
(function () {
  'use strict';
  const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const API = local ? 'http://localhost:8787' : 'https://api.nexpoint.co.uk';

  async function call(path, opts) {
    const r = await fetch(API + path, Object.assign({ credentials: 'include' }, opts));
    return r.json().catch(() => ({ error: 'bad response' }));
  }

  const A = {
    api: API,
    user: null,
    ready: null,
    async refresh() {
      try {
        const d = await call('/auth/me', { method: 'GET' });
        A.user = d.signed_in ? d.member : null;
      } catch (e) { A.user = null; }
      document.dispatchEvent(new CustomEvent('npaccount:change'));
      renderChip();
      return A.user;
    },
    async signIn(email, password) {
      const d = await call('/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (d.ok) { A.user = d.member; document.dispatchEvent(new CustomEvent('npaccount:change')); renderChip(); }
      return d;
    },
    async signOut() {
      await call('/auth/logout', { method: 'POST' }).catch(() => {});
      A.user = null;
      document.dispatchEvent(new CustomEvent('npaccount:change'));
      renderChip();
    },
    // Implemented in the questionnaire build (Task 6):
    openQuestionnaire(opts) { console.warn('questionnaire not loaded', opts); },
    gate(action) { console.warn('gate not loaded', action); },
  };

  /* The signed-in chip replaces the nav's Sign in link + account CTA. */
  function renderChip() {
    const slot = document.querySelector('[data-np-account-slot]');
    if (!slot) return;
    if (A.user) {
      slot.innerHTML = '<span class="np-chip">Signed in · ' + escapeText(A.user.name || A.user.email) +
        ' <button type="button" class="np-chip__out">Sign out</button></span>';
      slot.querySelector('.np-chip__out').addEventListener('click', () => A.signOut());
    } else {
      slot.innerHTML = '<a href="#" data-np-signin>Sign in</a> ' +
        '<button class="btn btn-primary" data-np-join>Create your hub account</button>';
      slot.querySelector('[data-np-signin]').addEventListener('click', (e) => { e.preventDefault(); openSignIn(); });
      slot.querySelector('[data-np-join]').addEventListener('click', () => A.openQuestionnaire({}));
    }
  }
  function escapeText(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  window.NPAccount = A;
  A.ready = A.refresh();
})();
```

Add the chip styles to the end of `hub/assets/portal.css` (single copy — the hub subdomain pages already reference the apex module but keep their own CSS; add the same block to `printhub/assets/portal.css` and `millhub/assets/portal.css` if those exist as separate files, otherwise skip):

```css
.np-chip{display:inline-flex;align-items:center;gap:10px;font:600 12px/1 var(--font-body);color:var(--on-surface-var);letter-spacing:.02em}
.np-chip__out{background:none;border:none;color:var(--blue);font:600 12px/1 var(--font-body);cursor:pointer;padding:4px 0;text-transform:uppercase;letter-spacing:.05em}
```

- [ ] **Step 2: Wire `hub/index.html`** — in the header nav, wrap the sign-in link and the desk button's neighbour spot:

Replace

```html
<a href="#" onclick="event.preventDefault();openSignIn()">Sign in</a>
```

with

```html
<span data-np-account-slot><a href="#" onclick="event.preventDefault();openSignIn()">Sign in</a></span>
```

(the module re-renders the slot's contents; the inline handler is the no-JS-module fallback). Before the closing `</body>`, above the portal.js tag, add:

```html
<script src="../assets/hub-account.js"></script>
```

- [ ] **Step 3: Real sign-in** — in `hub/index.html`'s `#signContent`, change the button to `onclick="signSubmit()"`, add an error line under the fields:

```html
<p class="np-sign-error" style="display:none;color:#E5484D;font:500 13px/1.4 var(--font-body);margin-top:10px"></p>
```

replace the "Member accounts arrive with a later release" privacy line with:

```html
<div class="privacy">New here? <a href="#" onclick="event.preventDefault();closeAll();NPAccount.openQuestionnaire({})" style="color:var(--blue);font-weight:600">Create your hub account</a> — two minutes, in confidence.</div>
```

and in `hub/assets/portal.js` replace `signMock` with:

```js
async function signSubmit(){
  const email = (document.getElementById('sEmail') || {}).value || '';
  const pass = (document.getElementById('sPass') || {}).value || '';
  const err = document.querySelector('#signContent .np-sign-error');
  if (!window.NPAccount){ if (err){ err.style.display = 'block'; err.textContent = 'Accounts are briefly unavailable — email hello@nexpoint.co.uk and we will help directly.'; } return; }
  const d = await NPAccount.signIn(email.trim(), pass);
  if (d.ok){
    document.getElementById('signContent').innerHTML = `
      <div class="success">
        <div class="ok"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M4 12l6 6L20 6"/></svg></div>
        <h2>Welcome back, ${escapeHtml((NPAccount.user && NPAccount.user.name) || '')}.</h2>
        <p>You're signed in across every hub. Requests you make now arrive with your profile attached.</p>
        <div class="modal-actions" style="justify-content:center"><button class="btn btn-outline" onclick="closeAll()">Back to the Global Hub</button></div>
      </div>`;
  } else if (err){
    err.style.display = 'block';
    err.textContent = 'That email and password don\'t match an account. Check them, or create your hub account below.';
  }
}
```

(Keep the function name `signMock` OUT — search the three hub folders' HTML for `signMock(` and update any caller to `signSubmit()`.)

- [ ] **Step 4: Copy portal.js to the other hubs**

```bash
cp hub/assets/portal.js printhub/assets/portal.js
cp hub/assets/portal.js millhub/assets/portal.js
diff -q hub/assets/portal.js printhub/assets/portal.js && diff -q hub/assets/portal.js millhub/assets/portal.js
```

- [ ] **Step 5: Verify in the browser** — serve the site locally (`python3 -m http.server 8000`) with `npx wrangler dev` running in `_system/portal-worker`. Open `http://localhost:8000/hub/`. Expected: nav shows "Sign in" + "Create your hub account" (chip slot rendered, `/auth/me` returned `signed_in:false` in the network tab, no console errors). Sign-in with a wrong password shows the error line, not the success card.

- [ ] **Step 6: Commit** — `git add assets/hub-account.js hub/ printhub/ millhub/ && git commit -m "Hub: account module bootstrap and real sign-in"` (with trailer).

---

### Task 6: The three-step questionnaire and the act gate

**Files:**
- Modify: `assets/hub-account.js`
- Modify: `hub/assets/portal.css` (questionnaire steps styling; copy the added block to the printhub/millhub CSS copies if they are separate files)

**Interfaces:**
- Consumes: Task 5's `call`, `renderChip`, overlay markup conventions from `portal.css`.
- Produces (replacing the Task 5 stubs):
  - `NPAccount.openQuestionnaire({pending})` — three-step modal; on success the member is signed in, `pending` (if given) has been submitted as their first request, and the success card shows.
  - `NPAccount.gate(action)` where `action = {hub, side, brief_ref, payload, heading, confirmLine}`: signed-out → questionnaire with `pending = action`; signed-in → one-click confirm modal that POSTs `{hub, side, brief_ref, payload}` to `/requests` **with credentials** and shows the standard success card.
  - The module creates its own overlay `#npAccountOverlay` (appended to `<body>`) so it works on pages without `#introOverlay` (the opportunities page).

- [ ] **Step 1: Implement the questionnaire.** Replace the two stubs in `hub-account.js` with:

```js
  /* ── overlay ─────────────────────────────────────────────── */
  function overlay() {
    let ov = document.getElementById('npAccountOverlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.className = 'overlay'; ov.id = 'npAccountOverlay';
      ov.innerHTML = '<div class="modal" role="dialog" aria-modal="true" aria-label="Create your hub account">' +
        '<button class="close" aria-label="Close"><span class="material-symbols-outlined" aria-hidden="true">close</span></button>' +
        '<div id="npAccountContent"></div></div>';
      document.body.appendChild(ov);
      ov.addEventListener('click', (e) => { if (e.target === ov) hide(); });
      ov.querySelector('.close').addEventListener('click', hide);
    }
    return ov;
  }
  function show() { overlay().classList.add('open'); document.body.style.overflow = 'hidden'; }
  function hide() { const ov = document.getElementById('npAccountOverlay'); if (ov) ov.classList.remove('open'); document.body.style.overflow = ''; }
  function content() { overlay(); return document.getElementById('npAccountContent'); }

  /* ── the three steps ─────────────────────────────────────── */
  const INTEREST_OPTS = [
    ['find_print', 'Find 3D print capacity'],
    ['offer_print', 'Offer print capacity'],
    ['mill_cell', 'A milling cell of my own'],
    ['opportunities', 'The opportunities board'],
    ['education', 'Education and training'],
  ];
  const draft = {};

  function savedLoc() {
    try { return JSON.parse(sessionStorage.getItem('np_loc')) || {}; } catch (e) { return {}; }
  }

  function stepDots(n) {
    return '<div class="np-steps" aria-hidden="true">' +
      [1, 2, 3].map((i) => '<span class="np-step-dot' + (i <= n ? ' is-on' : '') + '"></span>').join('') + '</div>';
  }

  function step1(pending) {
    content().innerHTML = stepDots(1) + `
      <h2>Introduce yourself once.</h2>
      <p class="body">Two minutes, in confidence. One of us reads every profile personally.</p>
      <form data-np-step="1">
        <div class="form-grid">
          <div class="field"><label for="qName">Your name</label><input id="qName" required value="${esc(draft.name)}" placeholder="Full name"></div>
          <div class="field"><label for="qCompany">Company</label><input id="qCompany" required value="${esc(draft.company)}" placeholder="Held in confidence"></div>
          <div class="field"><label for="qEmail">Email</label><input id="qEmail" type="email" required value="${esc(draft.email)}" placeholder="you@company.com"></div>
          <div class="field"><label for="qPass">Choose a password</label><input id="qPass" type="password" required minlength="8" placeholder="At least 8 characters"></div>
        </div>
        <p class="np-sign-error" style="display:none"></p>
        <div class="modal-actions"><button class="btn btn-primary" type="submit">Continue to where you are</button></div>
      </form>`;
    content().querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      draft.name = qv('qName'); draft.company = qv('qCompany'); draft.email = qv('qEmail'); draft.password = qv('qPass');
      step2(pending);
    });
    show();
  }

  function step2(pending) {
    const l = savedLoc();
    content().innerHTML = stepDots(2) + `
      <h2>Where are you?</h2>
      <p class="body">Every hub answers by distance first — tell us once and never again.</p>
      <form data-np-step="2">
        <div class="form-grid">
          <div class="field"><label for="qRegion">Region</label><input id="qRegion" value="${esc(draft.region || l.region)}" placeholder="e.g. Europe"></div>
          <div class="field"><label for="qCountry">Country</label><input id="qCountry" required value="${esc(draft.country || l.country)}" placeholder="Country"></div>
          <div class="field full"><label for="qTown">Town or city</label><input id="qTown" value="${esc(draft.town || l.town)}" placeholder="Town"></div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-outline" type="button" data-np-back>Go back</button>
          <button class="btn btn-primary" type="submit">Continue to what you're after</button>
        </div>
      </form>`;
    content().querySelector('[data-np-back]').addEventListener('click', () => step1(pending));
    content().querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      draft.region = qv('qRegion'); draft.country = qv('qCountry'); draft.town = qv('qTown');
      step3(pending);
    });
  }

  function step3(pending) {
    content().innerHTML = stepDots(3) + `
      <h2>What are you after?</h2>
      <p class="body">Tick anything that applies — it shapes what we bring to you.</p>
      <form data-np-step="3">
        <div class="np-interests">` +
      INTEREST_OPTS.map(([v, label]) =>
        `<label class="np-interest"><input type="checkbox" value="${v}"${(draft.interests || []).includes(v) ? ' checked' : ''}> ${label}</label>`).join('') + `
        </div>
        <div class="field full" style="margin-top:16px"><label for="qNotes">Volumes and systems</label><textarea id="qNotes" placeholder="Anything that helps us weigh the fit">${esc(draft.notes)}</textarea></div>
        <input type="text" name="company_url" value="" style="position:absolute;left:-9999px" tabindex="-1" autocomplete="off" aria-hidden="true">
        <p class="np-sign-error" style="display:none"></p>
        <div class="privacy">Seen by NexPoint only. Never shared without your say-so.</div>
        <div class="modal-actions">
          <button class="btn btn-outline" type="button" data-np-back>Go back</button>
          <button class="btn btn-primary" type="submit">Create my hub account</button>
        </div>
      </form>`;
    content().querySelector('[data-np-back]').addEventListener('click', () => step2(pending));
    content().querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      draft.interests = Array.from(content().querySelectorAll('.np-interests input:checked')).map((i) => i.value);
      draft.notes = qv('qNotes');
      const btn = e.target.querySelector('button[type="submit"]');
      const orig = btn.textContent; btn.disabled = true; btn.textContent = 'Creating your account…';
      const body = { name: draft.name, company: draft.company, email: draft.email, password: draft.password,
        region: draft.region, country: draft.country, town: draft.town,
        interests: draft.interests, notes: draft.notes,
        company_url: e.target.querySelector('[name="company_url"]').value };
      if (pending) body.pending_request = { hub: pending.hub, side: pending.side,
        brief_ref: pending.brief_ref || '', payload: pending.payload || {} };
      const d = await call('/auth/register', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (d.ok) {
        A.user = d.member; document.dispatchEvent(new CustomEvent('npaccount:change')); renderChip();
        delete draft.password;
        successCard(pending
          ? 'Your account is live and your request is with us. Chris or Will reads every request personally — expect to hear within two working days.'
          : 'Your account is live across every hub. Anything you ask for now arrives with your profile attached.');
      } else {
        btn.disabled = false; btn.textContent = orig;
        const err = e.target.querySelector('.np-sign-error');
        err.style.display = 'block';
        err.textContent = d.error === 'account_exists'
          ? 'There\'s already an account for that email — close this and choose Sign in instead.'
          : 'That didn\'t save. Check the details and try again, or email hello@nexpoint.co.uk.';
      }
    });
  }

  function successCard(line) {
    content().innerHTML = `
      <div class="success">
        <div class="ok"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M4 12l6 6L20 6"/></svg></div>
        <h2>Received, in confidence.</h2>
        <p>${line}</p>
        <div class="modal-actions" style="justify-content:center"><button class="btn btn-outline" data-np-done>Back to the hub</button></div>
      </div>`;
    content().querySelector('[data-np-done]').addEventListener('click', hide);
  }

  function qv(id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; }
  function esc(v) { return escapeText(v == null ? '' : v); }

  A.openQuestionnaire = function (opts) { step1((opts || {}).pending || null); };

  /* ── the act gate ────────────────────────────────────────── */
  A.gate = function (action) {
    if (!A.user) { A.openQuestionnaire({ pending: action }); return; }
    const u = A.user;
    content().innerHTML = `
      ${action.brief_ref ? `<span class="ref">${esc(action.brief_ref)}</span>` : ''}
      <h2>${esc(action.heading || 'Ask us to introduce you')}</h2>
      <p class="body">${esc(action.confirmLine || 'One click — your profile travels with the request.')}</p>
      <div class="np-confirm">
        <p><strong>${esc(u.name)}</strong> · ${esc(u.company)}<br>${esc([u.town, u.country].filter(Boolean).join(', '))} · ${esc(u.email)}</p>
      </div>
      <div class="field full"><label for="gNotes">Anything specific? (optional)</label><textarea id="gNotes" placeholder="Timing, volumes, the machine in question"></textarea></div>
      <p class="np-sign-error" style="display:none"></p>
      <div class="modal-actions"><button class="btn btn-primary" data-np-send>${esc(action.heading || 'Request the introduction')}</button></div>`;
    show();
    content().querySelector('[data-np-send]').addEventListener('click', async (e) => {
      const btn = e.target; btn.disabled = true; btn.textContent = 'Sending…';
      const payload = Object.assign({}, action.payload || {});
      const extra = qv('gNotes'); if (extra) payload.notes = payload.notes ? payload.notes + ' — ' + extra : extra;
      const d = await call('/requests', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hub: action.hub, side: action.side, brief_ref: action.brief_ref || '',
          company: u.company, contact_name: u.name, email: u.email, phone: '',
          location: [u.town, u.country].filter(Boolean).join(', '), payload, company_url: '' }) });
      if (d.ok) successCard('Chris or Will reads every request personally — expect to hear within two working days.');
      else { btn.disabled = false; btn.textContent = action.heading || 'Request the introduction';
        const err = content().querySelector('.np-sign-error'); err.style.display = 'block';
        err.textContent = 'That didn\'t send. Try again, or email hello@nexpoint.co.uk.'; }
    });
  };
```

- [ ] **Step 2: Add the questionnaire styles** to `hub/assets/portal.css` (and the printhub/millhub CSS copies if separate files):

```css
.np-steps{display:flex;gap:8px;margin-bottom:22px}
.np-step-dot{width:26px;height:3px;border-radius:9999px;background:var(--border-card)}
.np-step-dot.is-on{background:var(--blue)}
.np-interests{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.np-interest{display:flex;align-items:center;gap:10px;font:500 14px/1.4 var(--font-body);color:var(--on-surface);border:1px solid var(--border-card);border-radius:8px;padding:11px 14px;cursor:pointer;transition:border-color var(--dur) var(--ease)}
.np-interest:hover{border-color:var(--blue)}
.np-interest input{accent-color:var(--blue)}
.np-confirm{border:1px solid var(--border-card);border-radius:8px;background:var(--surface);padding:14px 16px;margin:14px 0 6px;font:400 14px/1.6 var(--font-body)}
.np-sign-error{color:#E5484D;font:500 13px/1.4 var(--font-body);margin-top:10px}
@media (max-width:560px){.np-interests{grid-template-columns:1fr}}
```

- [ ] **Step 3: Verify in the browser** (local worker + static server): click "Create your hub account" → three steps advance and go back, saved finder location prefills step 2, honeypot field invisible, weak password blocked by `minlength`, successful registration shows the chip, network tab shows `Set-Cookie` on the register response; reload the page → still signed in.

- [ ] **Step 4: Commit** — `git add assets/hub-account.js hub/assets/portal.css printhub millhub && git commit -m "Hub: three-step questionnaire and act gate"` (with trailer).

---

### Task 7: Route every hub form through the gate; education stays light

**Files:**
- Modify: `hub/assets/portal.js` → copy to `printhub/assets/portal.js` and `millhub/assets/portal.js`
- Modify: `hub/index.html`
- Modify: `printhub/index.html`, `printhub/find.html`, `printhub/offer.html`, `millhub/index.html`, `millhub/find.html`, `millhub/offer.html` (script tag + any `signMock` callers)

**Interfaces:**
- Consumes: `NPAccount.gate`, `NPAccount.user`, `NPAccount.ready`, `npaccount:change`.
- Produces: `openIntro(ref, heading)` now delegates to the gate when the module is present (original anonymous modal as fallback); `sendRequest` carries cookies; offer-page forms prefill from the profile; a light `openEducationList()` for the education CTA.

- [ ] **Step 1: `sendRequest` gains credentials and the api base.** In `hub/assets/portal.js` replace the constant and fetch:

```js
const API_BASE = /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
  ? 'http://localhost:8787' : 'https://api.nexpoint.co.uk';
const CAPTURE_REQUESTS_URL = API_BASE + '/requests';
```

and in `sendRequest`, add `credentials: 'include'` to the fetch options — signed-in submissions then carry `member_id` server-side with no client change.

- [ ] **Step 2: `openIntro` delegates to the gate.** Wrap the existing body:

```js
function openIntro(ref, heading){
  if (window.NPAccount && typeof NPAccount.gate === 'function' && !NPAccount._failed){
    NPAccount.gate({ hub: hubOfPage(), side: ref ? 'request_intro' : 'request_capacity',
      brief_ref: ref || '', heading: heading || 'Ask us to introduce you', payload: {} });
    return;
  }
  /* fallback: original anonymous desk form, unchanged below */
  ...existing body...
}
```

(Keep `introSubmit` untouched — it is the fallback path.)

- [ ] **Step 3: Offer-page prefill.** In `initOfferPage`, after the location recall block, add:

```js
  const fillProfile = () => {
    const u = window.NPAccount && NPAccount.user; if (!u) return;
    const set = (id, v) => { const el = document.getElementById(id); if (el && !el.value && v) el.value = v; };
    set('jName', u.name); set('jCompany', u.company); set('jEmail', u.email);
    set('jCountry', u.country); set('jTown', u.town);
  };
  if (window.NPAccount){ NPAccount.ready.then(fillProfile); document.addEventListener('npaccount:change', fillProfile); }
```

- [ ] **Step 4: Education goes light.** Add to `hub/assets/portal.js`:

```js
function openEducationList(){
  const c = document.getElementById('introContent');
  c.innerHTML = `
    <h2>Put me on the Education Hub list</h2>
    <p class="body">Name and email — nothing else. We'll write when the first courses open.</p>
    <form onsubmit="return eduSubmit(event)">
      <div class="form-grid" style="grid-template-columns:1fr">
        <div class="field"><label for="eName">Your name</label><input id="eName" required placeholder="Full name"></div>
        <div class="field"><label for="eEmail">Email</label><input id="eEmail" type="email" required placeholder="you@company.com"></div>
      </div>
      <div class="modal-actions"><button class="btn btn-primary" type="submit">Put me on the list</button></div>
    </form>`;
  openOverlay('introOverlay');
}
function eduSubmit(e){
  e.preventDefault();
  const form = e.target, fields = serializeForm(form), state = formSendingState(form);
  sendRequest({ hub: 'education', side: 'join_list', company: '', contact_name: fields.eName || '',
    email: fields.eEmail || '', phone: '', location: '', brief_ref: '', payload: {}, company_url: '' },
  () => {
    document.getElementById('introContent').innerHTML = `
      <div class="success">
        <div class="ok"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M4 12l6 6L20 6"/></svg></div>
        <h2>You're on the list.</h2>
        <p>We'll write the moment the first courses open — nothing else lands in your inbox.</p>
        <div class="modal-actions" style="justify-content:center"><button class="btn btn-outline" onclick="closeAll()">Back to the Global Hub</button></div>
      </div>`;
  }, () => formFailState(form, state));
  return false;
}
```

and in `hub/index.html` change the Education CTA to `onclick="openEducationList()"`.

- [ ] **Step 4b: Privacy page accounts paragraph.** In `hub/privacy.html`, after the existing data-handling copy, add one short section in the page's own markup style:

> **Member accounts.** When you create a Global Hub account we store your name, company, contact details, location and what you told us you're after. It is seen by NexPoint only, never shared without your say-so, and deleted on request — email hello@nexpoint.co.uk.

- [ ] **Step 5: Script tags on the subdomain pages.** In each of `printhub/index.html`, `printhub/find.html`, `printhub/offer.html`, `millhub/index.html`, `millhub/find.html`, `millhub/offer.html`, add **above** the existing portal.js script tag:

```html
<script src="https://nexpoint.co.uk/assets/hub-account.js"></script>
```

(Absolute URL — a relative path would be routed into the hub's own folder by the subdomain router. On the hub home it's already relative from Task 5.) Wrap each page's nav sign-in link in `<span data-np-account-slot>…</span>` as in Task 5 Step 2.

- [ ] **Step 6: Copy portal.js to the other hubs** (same `cp` + `diff -q` commands as Task 5 Step 4).

- [ ] **Step 7: Verify in the browser** — signed out: "Ask us to introduce you" on a find page opens the questionnaire; completing it fires the pending request (`/auth/register` body includes `pending_request` in the network tab) and shows success. Signed in: the same button opens the one-click confirm with the profile summary; sending POSTs `/requests` with the cookie. Offer page shows prefilled name/company/email. Education CTA asks only name + email. With `hub-account.js` blocked (DevTools request blocking), `openIntro` falls back to the anonymous form and still submits.

- [ ] **Step 8: Commit** — `git add -A hub printhub millhub && git commit -m "Hubs: act gate on every form, education stays light"` (with trailer).

---

### Task 8: Opportunities page joins the account system

**Files:**
- Modify: `opportunities/index.html` (self-contained page — its own inline CSS/JS)

**Interfaces:**
- Consumes: `NPAccount` global (absolute script tag), `NPAccount.gate`.
- Produces: the board's "request an introduction" forms (`submitCapture` / `submitContact` around lines 1601/1815) route through the gate; the page's own sign-in form (`doSignIn`, ~line 1987) calls `NPAccount.signIn`.

- [ ] **Step 1: Load the module.** Add `<script src="https://nexpoint.co.uk/assets/hub-account.js"></script>` before the page's inline `<script>`. The module creates its own overlay, so no markup dependency.

- [ ] **Step 2: Gate the intro forms.** At the point where the page opens its capture/contact form for a brief (the click handler that renders the `submitCapture` / `submitContact` forms — read the surrounding code first), short-circuit:

```js
if (window.NPAccount && typeof NPAccount.gate === 'function') {
  NPAccount.gate({ hub: 'opportunities', side: 'request_intro', brief_ref: ref,
    heading: 'Ask us to introduce you', payload: { brief: ref } });
  return;
}
// fallback: existing inline form, unchanged
```

where `ref` is the brief reference variable in scope at that call site (verify its exact name — the briefs come from `briefs.json`). Leave `submitCapture`/`submitContact` themselves untouched as the fallback path. The legacy `CAPTURE_ENDPOINT` root-route posts remain for the fallback only.

- [ ] **Step 3: Real sign-in.** Replace `doSignIn`'s mock body with a call to `NPAccount.signIn(email, password)` mirroring Task 5 Step 3's `signSubmit` (success card copy: "You're signed in across every hub."); if `window.NPAccount` is absent keep the current behaviour.

- [ ] **Step 4: Verify in the browser** at `http://localhost:8000/opportunities/` — signed out: request-intro on a brief opens the questionnaire; signed in: one-click confirm carrying the brief ref; the page's sign-in works with a real account; console clean.

- [ ] **Step 5: Commit** — `git add opportunities/index.html && git commit -m "Opportunities: act gate and real sign-in"` (with trailer).

---

### Task 9: Admin Members view

**Files:**
- Create: `admin/members.html`
- Modify: `admin/index.html` and each other `admin/*.html` page's nav (one `<a>` line per file)

**Interfaces:**
- Consumes: the admin shell pattern — read `admin/index.html` first and mirror its nav markup, auth guard, and Supabase client setup exactly (`window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY)`, `sb.auth.signInWithPassword` guard). RLS from Task 4 lets the two admin emails `select` from `member_profiles`.
- Produces: `/admin/members.html` — table of members: name, company, location, interests, joined, requests made.

- [ ] **Step 1: Build the page.** Copy the shell (head, fonts, nav, sign-in guard) from `admin/index.html`, then the content is one table fed by:

```js
async function loadMembers(){
  const { data: members, error } = await sb.from('member_profiles')
    .select('user_id,name,company,email,region,country,town,interests,created_at')
    .order('created_at', { ascending: false });
  if (error){ document.getElementById('membersBody').innerHTML =
    `<tr><td colspan="6">Couldn't load members: ${esc(error.message)}</td></tr>`; return; }
  const { data: reqs } = await sb.from('web_requests').select('member_id').not('member_id', 'is', null);
  const counts = {};
  (reqs || []).forEach(r => { counts[r.member_id] = (counts[r.member_id] || 0) + 1; });
  document.getElementById('membersBody').innerHTML = members.length ? members.map(m => `
    <tr>
      <td><strong>${esc(m.name)}</strong><br><span class="muted">${esc(m.email)}</span></td>
      <td>${esc(m.company)}</td>
      <td>${esc([m.town, m.country].filter(Boolean).join(', ') || m.region || '—')}</td>
      <td>${esc((m.interests || []).join(', ') || '—')}</td>
      <td>${new Date(m.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
      <td>${counts[m.user_id] || 0}</td>
    </tr>`).join('') : '<tr><td colspan="6">No members yet.</td></tr>';
}
```

with matching `<thead>`: Member · Company · Location · Interests · Joined · Requests. Reuse the admin pages' existing table CSS classes (read them from the shell you copied); define `esc` the same way the shell does.

- [ ] **Step 2: Nav links.** Add `<a href="members.html">Members</a>` to the nav of every `admin/*.html` page, in the same markup style, positioned after the hub board links.

- [ ] **Step 3: Verify** — needs the migration run (Task 4 Step 10) to exist in Supabase; until then verify the page renders its shell and shows the error row gracefully. After migration: sign in as admin at `http://localhost:8000/admin/members.html`, see registered test members.

- [ ] **Step 4: Commit** — `git add admin/ && git commit -m "Admin: members view"` (with trailer).

---

### Task 10: Full verification pass, spec sync, push and PR handoff

**Files:**
- Modify: `docs/superpowers/specs/2026-09-01-global-hub-accounts-design.md` (two factual corrections)

- [ ] **Step 1: Correct the spec where reality differed** (found during planning):
  - §4.1: the CORS allowlist already contained all four origins; the change was credentials + GET, not the list.
  - §7: `/requests` does not create Pipedrive leads in the worker — the engine files unsynced `web_requests` rows on its journalled path. "Pipedrive on action" holds; the actor is the engine.

- [ ] **Step 2: Run the worker suite** — `cd /Users/willlawrie/Documents/Claude/Projects/Nexpoint/_system/portal-worker && npm test` → all green.

- [ ] **Step 3: Full browser pass** (local worker + static server), every check from Tasks 5–9 in one sweep, plus: sign out → chip reverts; `prefers-reduced-motion` unaffected (no animation in Phase 1); mobile width 375px — questionnaire steps usable, interest grid single-column; no horizontal scroll; console clean on hub, printhub find/offer, millhub find/offer, opportunities.

- [ ] **Step 4: Push both branches and hand over**

```bash
cd /Users/willlawrie/Documents/Claude/Projects/Nexpoint && git push -u origin claude/hub-auth-worker
cd website && git push origin claude/hub-accounts
```

PR bodies list Will's go-live order: **merge worker PR → run migration → wrangler deploy → curl check → merge website PR.** Include the ⚠️ HUMAN list from Task 4 Step 10 verbatim in the worker PR.

---

## Self-review notes (done at planning time)

- **Spec coverage:** journey/gate (T6, T7, T8) · join CTA (T5) · instant access (T2 `email_confirm:true`) · questionnaire 3 steps + `np_loc` prefill (T6) · sign-in real + chip (T5) · one-click confirm (T6 gate) · offer prefill (T7) · education light (T7) · privacy paragraph (T7 Step 4b) · member_profiles + member_id + RLS (T4) · admin members (T9) · api.nexpoint.co.uk + cookie (T1/T4) · Resend notify on join — the register path deliberately does NOT email; new members surface in admin. If Will wants join emails, it's a 3-line `notify()` call in `handleRegister` — noted in the worker PR body as an option. · Phase 2: separate plan, per the header.
- **Type consistency:** `NPAccount.gate(action)` shape `{hub, side, brief_ref, payload, heading, confirmLine}` used identically in T6 (definition), T7 (`openIntro`), T8 (opportunities). Cookie name `np_session` everywhere. `storeRequestRow` produced in T2, consumed in T4. `handleAuth(request, env, ctx, origin, url)` signature matches its T4 call site.
- **Placeholders:** none — every step carries its content; the two "read the surrounding code first" notes (T8 Step 2, T9 Step 1) are deliberate: those call sites are inside a 2,000-line self-contained page whose exact variable names the executor must confirm in situ, with the required behaviour fully specified here.

// The full test's own checks: the ZZ rule, the settings, and the locks on
// what a window may send. No browser, no network. Part of `npm run check`.
import { isZZ, isZZSlug, parseArgs, checkSettings, emptySettings, leftOut, unknownNames } from "./core.mjs";
import { lockVerdict, allow } from "./browser.mjs";
import { JOURNEYS } from "./journeys.mjs";
import { readFileSync } from "node:fs";

let failed = 0;
const ok = (name, pass) => { if (!pass) { failed += 1; console.error(`FAIL ${name}`); } };
const API = "https://api.nexpoint.co.uk", DB = "https://synywukadvjpjjxjylwk.supabase.co/rest/v1";

// The ZZ rule: ZZ, then a space or a hyphen, then something.
for (const yes of ["ZZ Walk Test", "ZZ-Owner", " ZZ Asker Test "]) ok(`isZZ ${yes}`, isZZ(yes));
for (const no of ["", "ZZ", "ZZ ", "ZZTop Ltd", "zz walk test", "Provider 3", "A ZZ Company", "ZZ_Test", null, undefined]) ok(`not isZZ ${no}`, !isZZ(no));
ok("slug", isZZSlug("zz-owner-test") && !isZZSlug("zzz") && !isZZSlug("acme-orthotics") && !isZZSlug("ZZ-owner"));

// The settings: a real company name stops the run before anything opens.
const filled = (company) => { const s = emptySettings(); s.accounts.host = { company, email: "a@example.com", password: "x" }; return s; };
ok("a ZZ host passes", checkSettings(filled("ZZ Host Test")).problems.length === 0 && checkSettings(filled("ZZ Host Test")).have.host);
ok("a real host is refused", checkSettings(filled("Acme Orthotics")).problems.length === 1);
ok("a half-filled account is refused", checkSettings({ accounts: { seeker: { company: "ZZ Seeker", email: "", password: "x" } } }).problems.length === 1);
ok("an address without {stamp} is refused", checkSettings({ new_account: { company: "ZZ New {stamp}", name: "ZZ New", email: "a@example.com", password: "x" } }).problems.length === 1);
ok("the template has no values", checkSettings(emptySettings()).problems.length === 0 && !Object.values(checkSettings(emptySettings()).have).some(Boolean));
ok("the example file is the template", JSON.stringify(JSON.parse(readFileSync(new URL("../fulltest.example.json", import.meta.url), "utf8"))) === JSON.stringify(emptySettings()));

// The locks.
const v = (kind, method, url, body, opts) => lockVerdict(kind, method, url, body, opts);
const intent = (type, payload) => ({ type, payload_json: payload, requested_by: "x" });
ok("reads pass", v("admin", "GET", `${DB}/membership_invoices?select=*`) === "" && v("account", "GET", `${API}/account/summary`) === "");
ok("signing is stopped outside its own step", v("account", "POST", `${API}/signup/accept`) !== "" && v("admin", "POST", `${API}/signup/accept`) !== ""
  && v("account", "POST", `${API}/signup/accept`, null, { sign: true }) === "");
ok("a search passes", v("account", "POST", `${API}/listings/search`) === "");
ok("an account path no journey sends is stopped", v("account", "POST", `${API}/account/no-such-path`) !== "" && v("account", "POST", `${API}/orders`) !== "");
ok("accepting an introduction passes (Will, 12 November)", v("account", "POST", `${API}/introductions/accept`) === "");
ok("an account window never writes to the database", v("account", "POST", `${DB}/engine_intents`, intent("add-note", {})) !== "");
ok("a note passes", v("admin", "POST", `${DB}/engine_intents`, intent("add-note", { company_id: 1 })) === "");
for (const type of ["add-campaign-member", "change-campaign", "switch-campaign", "link-campaign-version", "approve-template", "delete-campaign",
  "rerun-job", "reroute-introduction", "mark-paid", "record-fee-paid", "record-sub-paid", "erase-account", "update-linkedin-queue", "set-opportunity",
  "no-such-intent", ""]) {
  ok(`${type || "an empty type"} is stopped`, v("admin", "POST", `${DB}/engine_intents`, intent(type, {})) !== "");
}
ok("delete-user passes", v("admin", "POST", `${DB}/engine_intents`, intent("delete-user", {})) === "");
ok("accept with no campaign passes", v("admin", "POST", `${DB}/engine_intents`, intent("accept-prospect", { campaign_ids: [] })) === "");
ok("accept onto a campaign is stopped", v("admin", "POST", `${DB}/engine_intents`, intent("accept-prospect", { campaign_ids: [3] })) !== ""
  && v("admin", "POST", `${DB}/engine_intents`, intent("accept-prospect", {})) !== ""
  && v("admin", "POST", `${DB}/engine_intents`, intent("accept-prospect", JSON.stringify({ campaign_ids: [3] }))) !== "");
ok("a payload sent as text is read", v("admin", "POST", `${DB}/engine_intents`, intent("accept-prospect", JSON.stringify({ campaign_ids: [] }))) === "");
ok("declining a request passes (the seeker's post, 8.3)", v("admin", "POST", `${DB}/engine_intents`, intent("review-web-request", { status: "declined" })) === "");
ok("one bad row stops the lot", v("admin", "POST", `${DB}/engine_intents`, [intent("add-note", {}), intent("rerun-job", {})]) !== "");
ok("a body that cannot be read is stopped", v("admin", "POST", `${DB}/engine_intents`, null) !== "");
ok("a fast save passes", v("admin", "POST", `${DB}/rpc/crm_add_note`, { p: {} }) === "");
ok("a campaign change is stopped by the fast route too", v("admin", "POST", `${DB}/rpc/crm_change_campaign`, { p: {} }) !== ""
  && v("admin", "POST", `${DB}/rpc/crm_no_such_function`, { p: {} }) !== "");
ok("a prospect edit passes; one that names a campaign does not", v("admin", "POST", `${DB}/rpc/crm_edit_prospect`, { p: { fields: { sectors: ["a"] } } }) === ""
  && v("admin", "POST", `${DB}/rpc/crm_edit_prospect`, { p: { fields: { campaign_ids: [2] } } }) !== ""
  && v("admin", "POST", `${DB}/rpc/crm_edit_prospect`, { p: {} }) !== ""
  && v("admin", "POST", `${DB}/engine_intents`, intent("edit-prospect", { fields: { campaign_ids: [2] } })) !== ""
  && v("admin", "POST", `${DB}/engine_intents`, intent("edit-prospect", { fields: { sectors: [] } })) === "");
ok("other hosts take reads only, bar the human check", v("account", "POST", "https://api.web3forms.com/submit") !== ""
  && v("account", "GET", "https://fonts.googleapis.com/css2") === "" && v("account", "POST", "https://challenges.cloudflare.com/cdn-cgi/x") === "");
ok("the sign-in service: sign-in and the second factor only", v("admin", "PUT", "https://synywukadvjpjjxjylwk.supabase.co/auth/v1/user", {}) !== ""
  && v("admin", "POST", "https://synywukadvjpjjxjylwk.supabase.co/auth/v1/factors/abc/verify", {}) === ""
  && v("account", "POST", "https://synywukadvjpjjxjylwk.supabase.co/auth/v1/token", {}) !== "");
ok("another function is stopped", v("admin", "POST", `${DB}/rpc/hub_close_account`, {}) !== "");
ok("publishing passes, other table writes do not", v("admin", "PATCH", `${DB}/board_opportunities?id=eq.1`, { status: "live", updated_at: "x" }) === ""
  && v("admin", "PATCH", `${DB}/board_opportunities?id=eq.1`, { status: "withheld", updated_at: "x" }) !== ""
  && v("admin", "PATCH", `${DB}/board_opportunities?status=eq.draft`, { status: "live", updated_at: "x" }) !== ""
  && v("admin", "PATCH", `${DB}/organisations?id=eq.1`, {}) !== "" && v("admin", "DELETE", `${DB}/board_opportunities?id=eq.1`) !== ""
  && v("admin", "POST", `${DB}/crm_settings`, {}) !== "");
ok("the admin's own sign-in passes", v("admin", "POST", "https://synywukadvjpjjxjylwk.supabase.co/auth/v1/token?grant_type=password", {}) === "");
ok("a consultancy link, its reissue and its revoke pass; Smartlead does not", v("admin", "POST", `${API}/consultancy/links`) === ""
  && v("admin", "POST", `${API}/consultancy/links/revoke`) === "" && v("admin", "POST", `${API}/consultancy/links/reissue`) === ""
  && v("admin", "POST", `${API}/smartlead/control`) !== "");

// The script: every step says what it does and what it should show, and ids are unique.
const ids = new Set();
for (const j of JOURNEYS) {
  ok(`${j.id} is unique`, !ids.has(j.id)); ids.add(j.id);
  const steps = new Set();
  for (const s of j.steps) {
    ok(`${j.id}/${s.id} is whole`, s.id && s.does && s.shows && typeof s.run === "function" && !steps.has(s.id));
    steps.add(s.id);
  }
}
const args = parseArgs([]);
const off = JOURNEYS.filter((j) => j.optIn);
ok("journeys that are off unless named stay off", off.every((j) => /uses up an account/.test(leftOut(j, args, {}, { termsVersion: "1.3" }))));
ok("terms journeys are off on 1.3", JOURNEYS.filter((j) => (j.needs || []).includes("terms2")).every((j) => /not switched on/.test(leftOut(j, args, { host: true, seeker: true, veteran: true }, { termsVersion: "1.3", terms2: false }))));
ok("unknown names are caught", unknownNames(JOURNEYS, ["hubs", "accept", "nonsense"]).join() === "accept,nonsense");
ok("options", parseArgs(["--dry", "--only", "hubs,board", "--with=accept"]).only.length === 2 && parseArgs(["--with=accept"]).with[0] === "accept");

// allow() refuses the never-list, whatever a journey file asks.
let refusedNever = false;
try { allow({ adminIntents: ["change-campaign"] }); } catch { refusedNever = true; }
ok("allow() refuses a campaign intent", refusedNever);

console.log(failed ? `fulltest selftest: ${failed} failed` : "fulltest-selftest-ok");
process.exit(failed ? 1 : 0);

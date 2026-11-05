// The full test's own checks: the ZZ rule, the settings, and the locks on
// what a window may send. No browser, no network. Part of `npm run check`.
import { isZZ, isZZSlug, parseArgs, checkSettings, emptySettings, leftOut, unknownNames } from "./core.mjs";
import { lockVerdict } from "./browser.mjs";
import { JOURNEYS } from "./journeys.mjs";
import { readFileSync } from "node:fs";

let failed = 0;
const ok = (name, pass) => { if (!pass) { failed += 1; console.error(`FAIL ${name}`); } };
const API = "https://api.nexpoint.co.uk", DB = "https://synywukadvjpjjxjylwk.supabase.co/rest/v1";

// The ZZ rule: ZZ, then a space or a hyphen, then something.
for (const yes of ["ZZ Walk Test", "ZZ-Owner", " ZZ Asker Test "]) ok(`isZZ ${yes}`, isZZ(yes));
for (const no of ["", "ZZ", "ZZ ", "ZZTop Ltd", "zz walk test", "Provider 3", "A ZZ Company", "ZZ_Test", null, undefined]) ok(`not isZZ ${no}`, !isZZ(no));
ok("slug", isZZSlug("zz-owner-test") && !isZZSlug("zzz") && !isZZSlug("midlands-3d") && !isZZSlug("ZZ-owner"));

// The settings: a real company name stops the run before anything opens.
const filled = (company) => { const s = emptySettings(); s.accounts.host = { company, email: "a@example.com", password: "x" }; return s; };
ok("a ZZ host passes", checkSettings(filled("ZZ Host Test")).problems.length === 0 && checkSettings(filled("ZZ Host Test")).have.host);
ok("a real host is refused", checkSettings(filled("Midlands 3D")).problems.length === 1);
ok("a half-filled account is refused", checkSettings({ accounts: { seeker: { company: "ZZ Seeker", email: "", password: "x" } } }).problems.length === 1);
ok("an address without {stamp} is refused", checkSettings({ new_account: { company: "ZZ New {stamp}", name: "ZZ New", email: "a@example.com", password: "x" } }).problems.length === 1);
ok("the template has no values", checkSettings(emptySettings()).problems.length === 0 && !Object.values(checkSettings(emptySettings()).have).some(Boolean));
ok("the example file is the template", JSON.stringify(JSON.parse(readFileSync(new URL("../fulltest.example.json", import.meta.url), "utf8"))) === JSON.stringify(emptySettings()));

// The locks.
const v = (kind, method, url, body, opts) => lockVerdict(kind, method, url, body, opts);
const intent = (type, payload) => ({ type, payload_json: payload, requested_by: "x" });
ok("reads pass", v("admin", "GET", `${DB}/membership_invoices?select=*`) === "" && v("account", "GET", `${API}/account/summary`) === "");
ok("signing is stopped everywhere", v("account", "POST", `${API}/signup/accept`) !== "" && v("admin", "POST", `${API}/signup/accept`) !== "");
ok("a search passes", v("account", "POST", `${API}/listings/search`) === "");
ok("closing an account is stopped", v("account", "POST", `${API}/account/close`) !== "");
ok("accept is stopped unless asked for", v("account", "POST", `${API}/introductions/accept`) !== "" && v("account", "POST", `${API}/introductions/accept`, null, { accept: true }) === "");
ok("an account window never writes to the database", v("account", "POST", `${DB}/engine_intents`, intent("add-note", {})) !== "");
ok("a note passes", v("admin", "POST", `${DB}/engine_intents`, intent("add-note", { company_id: 1 })) === "");
for (const type of ["approve-listing", "approve-listing-revision", "raise-fee-invoice", "invite-to-portal", "delete-account", "erase-account",
  "rerun-job", "record-sub-paid", "mark-paid", "add-provider", "reissue-acceptance", "defer-membership-billing", "change-campaign", "remove-org", ""]) {
  ok(`${type || "an empty type"} is stopped`, v("admin", "POST", `${DB}/engine_intents`, intent(type, {})) !== "");
}
ok("delete-user is stopped unless asked for", v("admin", "POST", `${DB}/engine_intents`, intent("delete-user", {})) !== ""
  && v("admin", "POST", `${DB}/engine_intents`, intent("delete-user", {}), { deleteLogin: true }) === "");
ok("accept with no campaign passes", v("admin", "POST", `${DB}/engine_intents`, intent("accept-prospect", { campaign_ids: [] })) === "");
ok("accept onto a campaign is stopped", v("admin", "POST", `${DB}/engine_intents`, intent("accept-prospect", { campaign_ids: [3] })) !== ""
  && v("admin", "POST", `${DB}/engine_intents`, intent("accept-prospect", {})) !== ""
  && v("admin", "POST", `${DB}/engine_intents`, intent("accept-prospect", JSON.stringify({ campaign_ids: [3] }))) !== "");
ok("a payload sent as text is read", v("admin", "POST", `${DB}/engine_intents`, intent("accept-prospect", JSON.stringify({ campaign_ids: [] }))) === "");
ok("declining a request is stopped", v("admin", "POST", `${DB}/engine_intents`, intent("review-web-request", { status: "declined" })) !== "");
ok("one bad row stops the lot", v("admin", "POST", `${DB}/engine_intents`, [intent("add-note", {}), intent("approve-listing", {})]) !== "");
ok("a body that cannot be read is stopped", v("admin", "POST", `${DB}/engine_intents`, null) !== "");
ok("a fast save passes", v("admin", "POST", `${DB}/rpc/crm_add_note`, { p: {} }) === "");
ok("another function is stopped", v("admin", "POST", `${DB}/rpc/hub_close_account`, {}) !== "");
ok("publishing passes, other table writes do not", v("admin", "PATCH", `${DB}/board_opportunities?id=eq.1`, {}) === ""
  && v("admin", "PATCH", `${DB}/organisations?id=eq.1`, {}) !== "" && v("admin", "DELETE", `${DB}/board_opportunities?id=eq.1`) !== ""
  && v("admin", "POST", `${DB}/crm_settings`, {}) !== "");
ok("the admin's own sign-in passes", v("admin", "POST", "https://synywukadvjpjjxjylwk.supabase.co/auth/v1/token?grant_type=password", {}) === "");
ok("a consultancy link and its revoke pass; a reissue does not", v("admin", "POST", `${API}/consultancy/links`) === ""
  && v("admin", "POST", `${API}/consultancy/links/revoke`) === "" && v("admin", "POST", `${API}/consultancy/links/reissue`) !== ""
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
ok("journeys that use up an account are off unless named", off.length > 0 && off.every((j) => /uses up an account/.test(leftOut(j, args, {}, { termsVersion: "1.3" }))));
ok("terms journeys are off on 1.3", JOURNEYS.filter((j) => (j.needs || []).includes("terms2")).every((j) => /not switched on/.test(leftOut(j, args, { host: true, seeker: true, veteran: true }, { termsVersion: "1.3", terms2: false }))));
ok("unknown names are caught", unknownNames(JOURNEYS, ["hubs", "accept", "nonsense"]).join() === "nonsense");
ok("options", parseArgs(["--dry", "--only", "hubs,board", "--with=accept"]).only.length === 2 && parseArgs(["--with=accept"]).with[0] === "accept");

console.log(failed ? `fulltest selftest: ${failed} failed` : "fulltest-selftest-ok");
process.exit(failed ? 1 : 0);

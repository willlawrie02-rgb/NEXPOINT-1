// The full test's runner: the command line, the settings file, the ZZ rule,
// what a run remembers between runs, and the loop that takes each step.
//
// Nothing private lives in this file or beside it. Account names, addresses,
// passwords and keys are read from a settings file on the operator's own
// machine (SETTINGS_PATH below), never from this repository.
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, chmodSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline";

export const APEX = "https://nexpoint.co.uk";
export const PRINT = "https://printhub.nexpoint.co.uk";
export const MILL = "https://millhub.nexpoint.co.uk";
export const OPPS = "https://opportunities.nexpoint.co.uk";
export const API = "https://api.nexpoint.co.uk";
export const DB_HOST = "synywukadvjpjjxjylwk.supabase.co";
/* Every host a page of ours is served from. A step that would open a page
   anywhere else is refused before the browser is asked. */
export const OUR_HOSTS = new Set(["nexpoint.co.uk", "printhub.nexpoint.co.uk", "millhub.nexpoint.co.uk",
  "opportunities.nexpoint.co.uk"]);

export const HOME_DIR = join(homedir(), ".nexpoint");
export const SETTINGS_PATH = join(HOME_DIR, "full-test.json");
export const STATE_PATH = join(HOME_DIR, "full-test-state.json");
export const REPORTS_DIR = join(homedir(), "Documents", "NexPoint-full-test");

// ---------------------------------------------------------------- the ZZ rule
/* A test record's name starts ZZ, then a space or a hyphen, then something
   (Will, 4 November 2026). Nothing else is a test record. */
const ZZ = /^ZZ[ -]\S/;
export const isZZ = (name) => ZZ.test(String(name == null ? "" : name).trim());
/* A folder name or a web address part for a test company: zz-something. */
export const isZZSlug = (slug) => /^zz-[a-z0-9]/.test(String(slug == null ? "" : slug).trim());
export class Refused extends Error {}
const lower = (s) => String(s == null ? "" : s).trim().toLowerCase();
/* Call before acting on anything with a name. It throws, and the step stops,
   when the name is not a test one. */
export function mustBeZZ(name, what) {
  if (!isZZ(name)) throw new Refused(`refused: ${what} is named ${JSON.stringify(String(name || "").slice(0, 60))}, which is not a ZZ test name`);
  return true;
}

// ---------------------------------------------------------------- the command line
export const USAGE = `The full test, on ZZ test accounts only.

  npm run fulltest                 the whole test, in a Chrome window you can watch
  npm run fulltest -- --dry        list every step it would take; opens nothing
  npm run fulltest -- --setup      answer a few questions; it writes the settings file for you
  npm run fulltest -- --init       write an empty settings file to fill in by hand
  npm run fulltest -- --headless   no window (the admin and anything that needs you is skipped)
  npm run fulltest -- --only hubs,board     run these journeys only (names from --dry)
  npm run fulltest -- --skip admin          leave these out
  npm run fulltest -- --with <journey>      switch on a journey that is off unless named (none is, at present)
  npm run fulltest -- --phone      take the whole script at phone width, not only the phone pass
  npm run fulltest -- --fresh      forget what earlier runs left waiting and start again
  npm run fulltest -- --settings <file>   --report-dir <folder>
`;
const list = (v) => String(v || "").split(",").map((s) => s.trim()).filter(Boolean);
export function parseArgs(argv) {
  const a = { dry: false, init: false, setup: false, headless: false, phone: false, fresh: false, help: false,
    only: [], skip: [], with: [], settings: SETTINGS_PATH, reportDir: REPORTS_DIR, hostEmail: "", seekerEmail: "" };
  const flags = { "--dry": "dry", "--init": "init", "--setup": "setup", "--headless": "headless", "--phone": "phone", "--fresh": "fresh",
    "--help": "help", "-h": "help" };
  const values = { "--only": "only", "--skip": "skip", "--with": "with", "--settings": "settings", "--report-dir": "reportDir",
    "--host-email": "hostEmail", "--seeker-email": "seekerEmail" };
  for (let i = 0; i < argv.length; i++) {
    const [key, inline] = argv[i].split(/=(.*)/s);
    if (flags[key]) { a[flags[key]] = true; continue; }
    if (values[key]) {
      const v = inline !== undefined ? inline : argv[++i];
      if (v === undefined || String(v).startsWith("--")) throw new Refused(`${key} needs a value`);
      const name = values[key];
      a[name] = Array.isArray(a[name]) ? a[name].concat(list(v)) : /Email$/.test(name) ? String(v).trim() : resolve(String(v).replace(/^~(?=\/)/, homedir()));
      continue;
    }
    throw new Refused(`unknown option ${argv[i]}`);
  }
  return a;
}

// ---------------------------------------------------------------- the settings file
/* The shape of the settings file. check/fulltest.example.json is this with
   every value empty; --init writes it to SETTINGS_PATH. */
export const ROLES = ["host", "seeker", "veteran"];
export const ROLE_NOTES = {
  host: "a ZZ account that lists capacity on both hubs and owns the test opportunity",
  seeker: "a ZZ account that searches, picks the ZZ host and asks for introductions",
  veteran: "a ZZ account that accepted Platform Terms 1.3 and never 2.0 (it signs in and meets no Platform Terms box)",
};
export function emptySettings() {
  const account = () => ({ company: "", email: "", password: "" });
  return {
    "//": "The full test's settings. Keep this file out of every repository. Every company name must start ZZ, then a space or a hyphen.",
    accounts: Object.fromEntries(ROLES.map((r) => [r, r === "host"
      ? { ...account(), "//": "folder is the company's folder name in the workspace (zz-something), for the consultancy link.", folder: "" } : account()])),
    new_account: {
      "//": "Registration and the invitation each make a new person on every run. {stamp} becomes the run's date and time, and both addresses must carry it. Use addresses you can open.",
      company: "ZZ Full Test {stamp}", name: "ZZ Full Test", email: "", invite_email: "", change_email: "", password: "", town: "", country: "",
    },
    admin: { "//": "Your admin address, to recognise your session. No password: you sign in yourself, in the window.", email: "" },
    mail: {
      "//": "Read-only mailbox checks through Microsoft Graph. Leave blank and every email is listed for you to check by hand.",
      "// secret": "Give client_secret, or client_secret_file: the path of a file that holds it.",
      "// mailboxes": "The mailboxes this app may read. Mail to name+anything@ lands in name@.",
      "// copied": "The addresses every introduction email must copy in (the worker's DESK_COPY), and the address those emails come from.",
      tenant_id: "", client_id: "", client_secret: "", client_secret_file: "", mailboxes: [], sent_from: "", desk: "", copied: [], intro_from: "",
    },
  };
}
export function loadSettings(path) {
  if (!existsSync(path)) {
    throw new Refused(`no settings file at ${path}. Run "npm run fulltest -- --init", then fill it in.`);
  }
  /* The file holds passwords: it must be the operator's alone. */
  const mode = statSync(path).mode & 0o777;
  if (mode & 0o077) throw new Refused(`${path} can be read by other users of this Mac (mode ${mode.toString(8)}). Run: chmod 600 "${path}"`);
  let s;
  try { s = JSON.parse(readFileSync(path, "utf8")); } catch (e) { throw new Refused(`${path} is not valid JSON: ${e.message}`); }
  return s;
}
/* What the settings allow, and why not where they do not. Nothing is opened
   before this passes: a company name that is not a ZZ one stops the run. */
export function checkSettings(s, { withJourneys = [] } = {}) {
  const problems = [];
  const have = {};
  const accounts = (s && s.accounts) || {};
  for (const role of ROLES) {
    const a = accounts[role] || {};
    const filled = ["company", "email", "password"].filter((k) => String(a[k] || "").trim());
    if (!filled.length) { have[role] = false; continue; }
    if (filled.length < 3) { problems.push(`accounts.${role} is half filled: it needs company, email and password`); continue; }
    if (!isZZ(a.company)) { problems.push(`accounts.${role}.company is not a ZZ test name (ZZ, then a space or a hyphen)`); continue; }
    have[role] = true;
  }
  const emails = ROLES.filter((r) => have[r]).map((r) => String(accounts[r].email).trim().toLowerCase());
  if (new Set(emails).size !== emails.length) problems.push("two accounts share one email address: each role needs its own account");
  const n = (s && s.new_account) || {};
  have.new_account = !!(String(n.email || "").trim() && String(n.password || "").trim());
  if (have.new_account && !isZZ(String(n.company || "").replace("{stamp}", "1"))) {
    problems.push("new_account.company is not a ZZ test name (ZZ, then a space or a hyphen)");
  }
  for (const k of ["email", "invite_email", "change_email"]) {
    if (String(n[k] || "").trim() && !String(n[k]).includes("{stamp}")) problems.push(`new_account.${k} must carry {stamp}, so each run uses a new address`);
  }
  if (have.new_account && lower(n.email) === lower(n.invite_email)) problems.push("new_account.email and invite_email must differ");
  if (have.new_account && !isZZ(n.name)) problems.push("new_account.name is not a ZZ test name: the person is named ZZ too, so Contacts shows a test person");
  const m = (s && s.mail) || {};
  const mailKeys = [m.tenant_id, m.client_id, m.client_secret || m.client_secret_file, [].concat(m.mailboxes || []).join("")]
    .filter((v) => String(v || "").trim());
  if (mailKeys.length && mailKeys.length < 4) {
    problems.push("mail is half filled: it needs tenant_id, client_id, a secret (or client_secret_file) and mailboxes, or none of them");
  }
  have.mail = mailKeys.length === 4;
  const folder = String((accounts.host || {}).folder || "").trim();
  if (folder && !isZZSlug(folder)) problems.push("accounts.host.folder is not a ZZ folder name (zz-something)");
  have.admin = !!String(((s && s.admin) || {}).email || "").trim();
  return { problems, have };
}
export function writeTemplate(path) {
  if (existsSync(path)) throw new Refused(`${path} already exists; it was left as it is.`);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(emptySettings(), null, 2) + "\n", { mode: 0o600 });
  chmodSync(path, 0o600);
}

// ---------------------------------------------------------------- what a run remembers
/* Some steps wait on the engine (a sync every two hours) or on a person.
   The run writes down what it made and where each journey stopped, so the
   next run carries on from there. The file holds record numbers and test
   names only: no password, no key, no link that opens anything. */
export function loadState(path, fresh) {
  /* Invoices raised and not yet voided are kept even by --fresh: each one
     must be voided in Xero whatever the next run does. */
  let s = {};
  try { if (existsSync(path)) s = JSON.parse(readFileSync(path, "utf8")); } catch { s = {}; }
  const invoices = (s.invoices || []).filter((i) => !i.voided);
  return fresh ? { made: {}, at: {}, invoices } : { made: s.made || {}, at: s.at || {}, invoices };
}
export function saveState(path, state) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
}

// ---------------------------------------------------------------- asking the operator
/* The run stops and waits for the person at the keyboard. In a headless run
   there is nobody to ask, so the step is skipped and listed for the hand. */
export function askEnter(question) {
  return new Promise((done) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`\n>>> ${question}\n    Press Return when done, or type "skip" and Return to leave it: `, (answer) => {
      rl.close();
      done(String(answer || "").trim().toLowerCase() !== "skip");
    });
  });
}

/* The same, for a line of text: a link pasted from an email. */
export function askLine(question) {
  return new Promise((done) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`\n>>> ${question}\n    Paste it and press Return, or just press Return to leave it: `, (answer) => {
      rl.close();
      done(String(answer || "").trim());
    });
  });
}

// ---------------------------------------------------------------- outcomes
/* Differed, but the steps after it do not depend on it, so the journey carries on. */
export class Soft extends Error {}
export class Waiting extends Error {}   // not wrong: something else must happen first (a sync, a person)
export class Skipped extends Error {}   // this step does not apply on this run
export class ByHand extends Error {}    // the runner cannot judge this; it goes on the hand list
export const wait = (why) => { throw new Waiting(why); };
export const skip = (why) => { throw new Skipped(why); };
export const hand = (why) => { throw new ByHand(why); };
export function differs(what, got, want) {
  throw new Error(`${what}: got ${JSON.stringify(String(got == null ? "" : got).replace(/\s+/g, " ").trim().slice(0, 200))}` +
    (want === undefined ? "" : `, expected ${JSON.stringify(String(want).slice(0, 200))}`));
}
const firstLine = (e) => String(e && e.message ? e.message : e).split("\n")[0].slice(0, 400);

// ---------------------------------------------------------------- choosing journeys
/* Names --with takes that are not journeys. Accepting is always run now
   (Will, 12 November 2026): the introduction email copies Will and Chris in. */
export const EXTRAS = [];
/* A journey's group is the part of its id before the dot: --only hubs runs
   hubs.print and hubs.mill; --only hubs.print runs that one. */
const names = (j) => [j.id, j.id.split(".")[0]];
const picked = (j, chosen) => chosen.some((c) => names(j).includes(c));
export function unknownNames(journeys, chosen) {
  const all = new Set(journeys.flatMap(names).concat(EXTRAS));
  return chosen.filter((c) => !all.has(c));
}
/* Why a journey is left out of this run, or "" when it runs. */
export function leftOut(j, args, have, world) {
  if (args.only.length && !picked(j, args.only)) return "not in --only";
  if (picked(j, args.skip)) return "left out by --skip";
  if (j.optIn && !picked(j, args.with)) return `uses up an account: off unless named (--with ${j.id})`;
  for (const need of j.needs || []) {
    if (need === "terms2") {
      if (world.termsVersion === null) continue;            // a dry run with no network: say nothing
      if (!world.terms2) return `Terms 2.0 is not switched on (the live site reports ${world.termsVersion || "no version"})`;
      continue;
    }
    if (need === "window") { if (args.headless) return "needs the Chrome window and you at the keyboard"; continue; }
    if (!have[need]) {
      return ROLES.includes(need) ? `accounts.${need} is not filled in (${ROLE_NOTES[need]})`
        : need === "new_account" ? "new_account is not filled in"
          : need === "mail" ? "mail is not filled in" : need === "admin" ? "admin.email is not filled in" : `needs ${need}`;
    }
  }
  return "";
}

// ---------------------------------------------------------------- the dry run
export function dryList(journeys, args, have, world, out = console.log) {
  let n = 0;
  for (const j of journeys) {
    const why = leftOut(j, args, have, world);
    out(`\n${j.id}  ${j.title}${j.optIn ? "  [uses up an account]" : ""}`);
    if (j.from) out(`    from: ${j.from}`);
    if (why) out(`    WOULD SKIP: ${why}`);
    for (const s of j.steps) {
      n += 1;
      out(`  ${String(n).padStart(3)}. ${s.does}`);
      out(`       should show: ${s.shows}`);
    }
  }
  return n;
}

// ---------------------------------------------------------------- the run
/* Takes every journey in order. A step that throws is recorded with its
   reason and a screenshot, and the journey stops there (its later steps
   depend on it); the next journey still runs. */
export async function runAll(journeys, ctx) {
  const { args, have, world, state, results, log } = ctx;
  for (const j of journeys) {
    const why = leftOut(j, args, have, world);
    log(`\n${j.id}  ${j.title}`);
    if (why) {
      for (const s of j.steps) results.push({ journey: j, step: s, pass: ctx.pass, status: "skipped", detail: why });
      log(`  skipped: ${why}`);
      continue;
    }
    const key = j.id;
    let stopped = "";
    for (let i = 0; i < j.steps.length; i++) {
      const s = j.steps[i];
      const r = { journey: j, step: s, pass: ctx.pass, status: "as written", detail: "", shot: "" };
      results.push(r);
      if (stopped) { r.status = "not reached"; r.detail = stopped; continue; }
      /* A step an earlier run finished is not taken twice: it made a record. */
      if (s.once && state.at[key] && state.at[key].done && state.at[key].done.includes(s.id)) {
        r.status = "as written"; r.detail = "done on an earlier run"; log(`  done before  ${s.does}`); continue;
      }
      ctx.current = { journey: j, step: s, key };
      /* A step calls ctx.did() the moment it has done the thing that cannot
         be taken back, so a check that fails after it never sends it twice. */
      ctx.did = () => {
        if (!s.once) return;
        state.at[key] = state.at[key] || {};
        if (!(state.at[key].done || []).includes(s.id)) state.at[key].done = (state.at[key].done || []).concat(s.id);
        saveState(ctx.statePath, state);
      };
      const blockedBefore = ctx.blocked.length;
      try {
        const note = await s.run(ctx);
        /* A save the locks stopped is never "as written", whatever the page showed. */
        if (ctx.blocked.length > blockedBefore) throw new Refused(`refused: the locks stopped ${ctx.blocked.slice(blockedBefore).join("; ")}`);
        if (typeof note === "string") r.detail = note;
        ctx.did();
        log(`  as written   ${s.does}`);
      } catch (e) {
        r.detail = firstLine(e);
        if (e instanceof Waiting) { r.status = "waiting"; stopped = `waits on an earlier step: ${r.detail}`; }
        else if (e instanceof Skipped) { r.status = "skipped"; }
        else if (e instanceof ByHand) { r.status = "by hand"; }
        else if (e instanceof Soft) { r.status = "differed"; }
        else {
          r.status = e instanceof Refused ? "refused" : "differed";
          stopped = `an earlier step ${r.status}: ${s.does}`;
        }
        if (r.status === "differed" || r.status === "refused") r.shot = await ctx.shot(`${j.id}-${s.id}`).catch(() => "");
        log(`  ${r.status.toUpperCase().padEnd(12)} ${s.does}\n               ${r.detail}`);
      }
      saveState(ctx.statePath, state);
    }
    /* A journey whose every step was as written starts from the top on the
       next run. Anything less keeps what it made, so nothing is sent twice. */
    const mine = results.filter((r) => r.journey === j && r.pass === ctx.pass);
    if (mine.every((r) => r.status === "as written")) { delete state.at[key]; delete state.made[key]; saveState(ctx.statePath, state); }
    if (ctx.afterJourney) await ctx.afterJourney(j).catch(() => {});
  }
}

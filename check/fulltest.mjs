// The full test (launch checklist, the gate before launch): a real Chrome
// walks the LIVE site as the ZZ test accounts, every journey end to end, and
// writes a report.
//
//   npm run fulltest              the whole test, in a window you can watch
//   npm run fulltest -- --dry     lists every step; opens nothing, sends nothing
//   npm run fulltest -- --help    the other options
//
// Unlike the scripted walk (check/walk.mjs), nothing here is stubbed: it
// signs in, searches, posts and saves for real. So it only ever acts on
// records whose name starts ZZ, then a space or a hyphen, and it refuses to
// start when it cannot confirm that. Approving a first listing, signing a
// consultancy agreement and raising a fee invoice make real Xero invoices
// (Will, 12 November 2026): each is listed, and the run stops for every one
// to be voided. It never puts a company on a campaign (Smartlead). See
// check/fulltest/browser.mjs for the locks and check/fulltest/journeys.mjs
// for the script.
//
// Account names, passwords and keys live in ~/.nexpoint/full-test.json on
// the operator's machine. This repository is public: it holds the empty
// template (check/fulltest.example.json) and nothing else.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { APEX, API, STATE_PATH, USAGE, Refused, parseArgs, loadSettings, checkSettings, writeTemplate, emptySettings,
  loadState, saveState, unknownNames, dryList, runAll } from "./fulltest/core.mjs";
import { findBrowser, shot } from "./fulltest/browser.mjs";
import { Mail } from "./fulltest/mail.mjs";
import { JOURNEYS, BY_HAND } from "./fulltest/journeys.mjs";
import { writeHtml, writeMarkdown, verdict } from "./fulltest/report.mjs";

const pad = (n) => String(n).padStart(2, "0");
const stampNow = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
/* What the live site says of itself. Two reads, no session, nothing sent. */
async function readWorld() {
  const world = { build: "", termsVersion: "", terms2: false };
  const get = (url) => fetch(url, { signal: AbortSignal.timeout(10000) });
  try {
    /* build.txt names the commit the site was built from. A site that does not publish one answers its 404 page. */
    const r = await get(`${APEX}/build.txt`), line = r.ok ? (await r.text()).trim().split("\n")[0] : "";
    world.build = /^[0-9a-f]{7,40}$/.test(line) ? line.slice(0, 12) : "";
  } catch { /* the report says "not read" */ }
  try {
    /* On 1.3 there is no seeker document, and the worker answers 422 for the layer. */
    const seeker = await get(`${API}/terms/current?layer=seeker`);
    const platform = await (await get(`${API}/terms/current?layer=platform`)).json();
    world.termsVersion = String(platform.version || "");
    world.terms2 = seeker.ok && parseFloat(world.termsVersion) >= 2;
  } catch { /* reported by the first step */ }
  return world;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(USAGE); return 0; }
  if (args.setup) {
    const { runSetup } = await import("./fulltest/setup.mjs");
    if (!!args.hostEmail !== !!args.seekerEmail) throw new Refused("--host-email and --seeker-email go together");
    return runSetup(args.settings, args.hostEmail ? { host: args.hostEmail, seeker: args.seekerEmail, renew: args.fresh } : null);
  }
  if (args.init) {
    writeTemplate(args.settings);
    console.log(`Wrote an empty settings file to ${args.settings}\nFill it in (every company name starts ZZ), then run: npm run fulltest -- --dry`);
    return 0;
  }
  const unknown = unknownNames(JOURNEYS, [].concat(args.only, args.skip, args.with));
  if (unknown.length) throw new Refused(`no journey is called ${unknown.join(", ")}. Run with --dry to see the names.`);

  /* The dry run works with no settings file at all: it lists the script. */
  let settings = emptySettings(), have = {}, problems = [];
  try {
    settings = loadSettings(args.settings);
    ({ have, problems } = checkSettings(settings, { withJourneys: args.with }));
  } catch (e) {
    if (!args.dry) throw e;
    console.log(`note: ${e.message}`);
  }
  if (problems.length) throw new Refused(`the settings file will not do:\n  - ${problems.join("\n  - ")}`);

  if (args.dry) {
    const world = { build: "", termsVersion: null, terms2: false };
    console.log("The full test: every step it would take. Nothing is opened and nothing is sent.");
    const n = dryList(JOURNEYS, args, have, world);
    console.log(`\n${n} steps in ${JOURNEYS.length} journeys, listed in script order; a run takes them by pass (computer, then phone, then last).`);
    if (JOURNEYS.some((j) => j.optIn)) console.log("Journeys marked [uses up an account] run only when named with --with.");
    console.log("Terms 2.0 journeys (terms.*) are skipped until the live site reports version 2.0.");
    return 0;
  }

  const exe = findBrowser(args);
  if (!exe) throw new Refused("no Chrome found. Install Google Chrome, or set WALK_BROWSER to a Chrome or Chromium binary.");
  const world = await readWorld();
  const started = new Date(), when = stampNow(started);
  const dir = join(args.reportDir, when);
  mkdirSync(join(dir, "shots"), { recursive: true });
  const state = loadState(STATE_PATH, args.fresh);
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ executablePath: exe, headless: args.headless, slowMo: args.headless ? 0 : 120 });
  const results = [];
  const ctx = {
    args, settings, have, world, state, statePath: STATE_PATH, results, browser, log: console.log,
    stamp: when.replace(/^\d{4}-/, "").replace("_", "-"), shotsDir: join(dir, "shots"),
    windows: {}, spare: [], blocked: [], quiet: new Set(), signNow: false, adminDeclined: false, notes: [], left: [], cache: {}, mailRows: [], lastWindow: null,
    mail: new Mail(settings, started), pass: "computer", size: "computer",
  };
  ctx.shot = (name) => shot(ctx, name);
  console.log(`The full test, on ZZ accounts only. Site build: ${world.build || "not read"}. Terms live: ${world.termsVersion || "not read"}.`);
  console.log(`Report: ${dir}`);
  let crashed = "";
  try {
    for (const pass of ["computer", "phone", "last"]) {
      ctx.pass = pass === "phone" ? "phone" : args.phone ? "whole script at phone width" : "computer";
      ctx.size = pass === "phone" || args.phone ? "phone" : "computer";
      await runAll(JOURNEYS.filter((j) => j.pass === pass), ctx);
    }
  } catch (e) {
    crashed = String(e && e.message ? e.message : e).split("\n")[0];
    console.error(`\nThe run stopped early: ${crashed}`);
  } finally {
    saveState(STATE_PATH, state);
    await browser.close().catch(() => {});
  }

  const byHand = BY_HAND.slice();
  for (const r of ctx.mailRows.filter((m) => m.hand)) byHand.push(`Email to check: ${r.what}, to ${r.to} (${r.result}).`);
  for (const r of results.filter((x) => x.status === "by hand")) byHand.push(`${r.step.does}: ${r.detail}`);
  for (const n of ctx.notes) byHand.push(`Note: ${n}`);
  if (crashed) byHand.unshift(`The run stopped early (${crashed}); the steps after it were not taken.`);
  const run = { results, byHand, mail: ctx.mailRows, invoices: state.invoices || [], left: [...new Set(ctx.left)], meta: { when: when.replace("_", " "), build: world.build, termsVersion: world.termsVersion,
    browser: `Chrome ${browser.version()}${args.headless ? ", no window" : ""}`, command: `npm run fulltest${process.argv.length > 2 ? ` -- ${process.argv.slice(2).join(" ")}` : ""}` } };
  const html = writeHtml(dir, run);
  writeMarkdown(dir, run);
  console.log(`\nfulltest: ${verdict(results)}`);
  console.log(`Report: ${html}`);
  if (!args.headless && process.platform === "darwin") {
    const { spawn } = await import("node:child_process");
    spawn("open", [html], { stdio: "ignore", detached: true }).unref();
  }
  return crashed || results.some((r) => r.status === "differed" || r.status === "refused") ? 1 : 0;
}

/* A step waits for a response before it presses; when the press fails, that
   wait fails later with nobody listening. Node would end the run there, with
   no report: the step has already been recorded, so it is only noted. */
process.on("unhandledRejection", (e) => {
  console.log(`  (a wait the step had already given up on: ${String(e && e.message ? e.message : e).split("\n")[0].slice(0, 160)})`);
});

main().then((code) => process.exit(code), (e) => {
  console.error(e instanceof Refused ? `fulltest: ${e.message}` : e);
  process.exit(2);
});

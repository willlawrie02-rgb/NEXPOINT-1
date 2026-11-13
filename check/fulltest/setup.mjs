// The full test's settings, asked as plain questions in Terminal, so nobody
// has to edit JSON by hand. Passwords are typed unseen and go straight into
// the settings file on the operator's own machine; nothing is printed back.
import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline";
import { emptySettings, checkSettings, isZZ } from "./core.mjs";

/* One reader for the whole conversation, so nothing typed ahead is lost. */
let rl = null, muted = false;
const lines = [], waiting = [];
function reader() {
  if (rl) return rl;
  rl = createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
  /* A password is typed unseen: while muted, nothing the keyboard sends is echoed. */
  const write = rl._writeToOutput.bind(rl);
  rl._writeToOutput = (text) => {
    if (!muted) return write(text);
    const prompt = rl.getPrompt();
    if (prompt && String(text).startsWith(prompt)) write(prompt);   // a redraw shows the question, never what was typed
  };
  rl.on("line", (l) => { const w = waiting.shift(); if (w) w(l); else lines.push(l); });
  rl.on("close", () => { for (const w of waiting.splice(0)) w(null); });
  return rl;
}
function ask(question, { hidden = false, fallback = "" } = {}) {
  reader();
  rl.setPrompt(`${question}${fallback ? ` [${fallback}]` : ""}: `);
  rl.prompt();
  muted = hidden;
  return new Promise((done) => {
    const got = (answer) => {
      muted = false;
      if (hidden || !process.stdin.isTTY) process.stdout.write("\n");
      if (answer === null) { console.log("\nStopped: nothing was saved."); process.exit(1); }
      done(String(answer || "").trim() || fallback);
    };
    if (lines.length) got(lines.shift()); else waiting.push(got);
  });
}
async function account(label, s, suggestion) {
  console.log(`\nThe ${label} account (already registered and confirmed on the site):`);
  for (;;) {
    const company = await ask("  Company name, exactly as registered", { fallback: s.company || suggestion });
    if (!isZZ(company)) { console.log("  That is not a test name. It must start ZZ, then a space or a hyphen."); continue; }
    s.company = company;
    break;
  }
  for (;;) {
    const email = await ask("  Email address", { fallback: s.email || "" });
    if (!/^\S+@\S+\.\S+$/.test(email)) { console.log("  That is not an email address."); continue; }
    s.email = email;
    break;
  }
  for (;;) {
    const password = await ask("  Password (typed unseen)", { hidden: true });
    if (!password && s.password) break;            // Return keeps the one already there
    if (!password) { console.log("  A password is needed."); continue; }
    s.password = password;
    break;
  }
}

const madeUp = () => `Zz-${randomBytes(12).toString("base64url")}9a`;
export async function runSetup(path, auto = null) {
  /* Start from the settings in use; the first time, from the file a session
     prepared (mail and addresses filled in); else the empty template. */
  const prepared = join(dirname(path), "full-test.new.json");
  let s = emptySettings(), from = "an empty template";
  for (const p of [path, prepared]) {
    if (!existsSync(p)) continue;
    try {
      const got = JSON.parse(readFileSync(p, "utf8"));
      if (p === path && !String(((got.mail || {}).tenant_id) || "").trim() && existsSync(prepared)) continue;   // an older file with no mail set up
      s = { ...emptySettings(), ...got }; from = p; break;
    } catch { /* try the next */ }
  }
  console.log(`The full test's settings. Starting from ${from}.${auto ? "" : "\nPress Return to keep what is shown in [brackets]."}`);
  s.accounts = s.accounts || {};
  for (const role of ["host", "seeker"]) s.accounts[role] = { company: "", email: "", password: "", ...(s.accounts[role] || {}) };
  if (auto) {
    /* No questions: the runner registers both accounts itself on its first
       run, so their passwords are made here and never shown to anyone. */
    for (const [role, name] of [["host", "ZZ Full Test Host"], ["seeker", "ZZ Full Test Seeker"]]) {
      const a = s.accounts[role];
      a.company = a.company || name;
      a.email = auto[role];
      a.password = auto.renew ? madeUp() : a.password || madeUp();
    }
    /* Only before the accounts exist: a new password for an account already registered would lock the runner out. */
    if (auto.renew) s.new_account = { ...(s.new_account || {}), password: "" };
  } else {
    await account("host", s.accounts.host, "ZZ Full Test Host");
    await account("seeker", s.accounts.seeker, "ZZ Full Test Seeker");
  }
  s.new_account = s.new_account || {};
  if (!String(s.new_account.password || "").trim()) {
    /* The runner's own account, registered fresh each run: its password is made here and never shown. */
    s.new_account.password = madeUp();
    console.log("\nA password was made for the account the test registers by itself each run.");
  }
  const { problems } = checkSettings(s);
  if (problems.length) { console.log(`\nNot saved. The settings will not do:\n  - ${problems.join("\n  - ")}`); if (rl) rl.close(); return 1; }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  if (existsSync(path)) copyFileSync(path, join(dirname(path), "full-test.old.json"));
  writeFileSync(path, JSON.stringify(s, null, 2) + "\n", { mode: 0o600 });
  chmodSync(path, 0o600);
  console.log(`\nSaved to ${path}. Nothing typed here was shown or sent anywhere.`);
  if (rl) rl.close();
  return 0;
}

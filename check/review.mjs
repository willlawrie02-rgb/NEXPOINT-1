// Code review of 4 October 2026 (launch checklist, Phase 4): three things the
// review found on the public pages, each kept from coming back. Where a
// function can be lifted out of its page and run, it is run; the rest is read.
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const fails = [];
const fail = (msg) => fails.push(msg);

// ---------------------------------------------------------------- the trap field
// The worker drops any request whose company_url is filled. That only works
// where the form has such a field for a bot to fill: the three forms a
// stranger may send used to post a hard-coded empty string.
const TRAP = /<input[^>]*name="company_url"[^>]*>/;
const formIn = (t, opener) => {
  const from = t.indexOf(opener);
  return from < 0 ? "" : t.slice(from, t.indexOf("</form>", from));
};
const bodyOf = (t, name) => {
  const m = t.match(new RegExp("function " + name + "\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}"));
  return m ? m[0] : "";
};
{
  const home = read("index.html");
  if (!TRAP.test(formIn(home, '<form id="bookForm"'))) fail("index.html: the intro-call form has no company_url field for a bot to fill");
  const send = home.slice(home.indexOf("async function submitForm"), home.indexOf("function render()"));
  if (/company_url:\s*''/.test(send)) fail("index.html: the intro-call form posts a hard-coded empty company_url");

  const portal = read("hub/assets/portal.js");
  const forms = [
    ["the desk form", 'introSubmit(event)', "introSubmit"],
    ["the Education sign-up", 'eduSubmit(event)', "eduSubmit"],
  ];
  for (const [what, opener, handler] of forms) {
    const form = formIn(portal, `<form onsubmit="return ${opener}">`);
    if (!TRAP.test(form) && !/\$\{TRAP_FIELD\}/.test(form)) fail(`hub/assets/portal.js: ${what} has no company_url field for a bot to fill`);
    const body = bodyOf(portal, handler);
    if (!body) fail(`hub/assets/portal.js: ${handler} was not found`);
    else if (/company_url:\s*''/.test(body)) fail(`hub/assets/portal.js: ${what} posts a hard-coded empty company_url`);
  }
  if (/\$\{TRAP_FIELD\}/.test(portal) && !TRAP.test((portal.match(/const TRAP_FIELD\s*=\s*'[^\n]*/) || [""])[0]))
    fail("hub/assets/portal.js: TRAP_FIELD is not a company_url input");
}

// ---------------------------------------------------------------- the return address
// A return address on localhost is a development allowance. On the live site
// it sent a newly confirmed customer to their own machine.
function returnCheck(file, fnName, call) {
  const t = read(file);
  const m = t.match(new RegExp("function " + fnName + "\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\s*\\}"));
  if (!m) { fail(`${file}: ${fnName} was not found`); return; }
  const run = (pageHost, ret) => {
    const location = {
      hostname: pageHost,
      href: `https://${pageHost}/hub/confirm.html`,
      search: "?return=" + encodeURIComponent(ret),
    };
    const local = /^(localhost|127\.0\.0\.1)$/.test(pageHost);
    try {
      return new Function("location", "local", "ret", `${m[0]}; return ${call};`)(location, local, ret);
    } catch (e) { return "threw: " + e.message; }
  };
  const cases = [
    ["nexpoint.co.uk", "https://print.nexpoint.co.uk/find.html", true],
    ["nexpoint.co.uk", "https://nexpoint.co.uk/hub/account.html", true],
    ["nexpoint.co.uk", "https://example.com/", false],
    ["nexpoint.co.uk", "http://localhost:8080/anything", false],
    ["nexpoint.co.uk", "http://127.0.0.1:8080/anything", false],
    ["localhost", "http://localhost:8080/hub/account.html", true],
  ];
  for (const [host, ret, allowed] of cases) {
    const got = run(host, ret);
    if (typeof got === "string" && got.startsWith("threw")) { fail(`${file}: ${fnName} ${got}`); return; }
    if (!!got !== allowed) fail(`${file}: ${fnName} on ${host} ${allowed ? "refuses" : "follows"} a return to ${ret}`);
  }
}
returnCheck("hub/confirm.html", "safeReturnTo", "safeReturnTo()");
returnCheck("assets/hub-account.js", "safeReturn", "safeReturn(ret)");

// ---------------------------------------------------------------- the resend that failed
// The worker answers send_failed when the email provider refuses the message.
// The page has words of its own for it, and gives the button back.
{
  const t = read("hub/assets/dashboard.js");
  const m = t.match(/function resendIntro\(btn\) \{[\s\S]*?\n  \}/);
  const generic = (t.match(/var GENERIC_ERROR = '([^']*)'/) || [])[1];
  if (!m) fail("hub/assets/dashboard.js: resendIntro was not found");
  else {
    const said = [];
    let given = false;
    const btn = { getAttribute: () => "7", disabled: false, textContent: "Send it again" };
    const resend = new Function("post", "el", "busy", "say", "isNotBuilt", "GENERIC_ERROR", `${m[0]}; return resendIntro;`)(
      () => Promise.resolve({ error: "send_failed" }),
      () => ({}),
      () => () => { given = true; },
      (node, text, bad) => said.push([text, !!bad]),
      (d) => d && d.error === "http_404",
      generic,
    );
    resend(btn);
    await new Promise((r) => setTimeout(r, 0));
    const [text, bad] = said[0] || ["", false];
    if (!text) fail("hub/assets/dashboard.js: a failed resend says nothing");
    else {
      if (/^Sent again/.test(text)) fail('hub/assets/dashboard.js: a failed resend still says "Sent again."');
      if (text === generic || /^That did not go through/.test(text)) fail("hub/assets/dashboard.js: send_failed has no words of its own (the general message is shown)");
      if (!bad) fail("hub/assets/dashboard.js: the send_failed message is not marked as a failure");
      if (text.includes("—")) fail("hub/assets/dashboard.js: an em-dash in the send_failed message");
    }
    if (!given) fail("hub/assets/dashboard.js: the button is not given back after send_failed");
  }
}

if (fails.length) {
  console.error(`review: ${fails.length} problem(s)`);
  for (const f of fails) console.error("  " + f);
  process.exit(1);
}
console.log("review-ok");

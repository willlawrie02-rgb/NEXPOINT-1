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
// where the form has such a field for a bot to fill: the forms a stranger
// may send used to post a hard-coded empty string. And the field must be
// one no browser fills on its own: on 29 October 2026 Chrome filled a trap
// named company_url from a saved address when a real person accepted an
// autofill suggestion, and the worker dropped the registration. So the trap
// is named np_check, its name, id, label and placeholder say nothing
// autofill reads as a website, company or organisation field, and its one
// autocomplete token is one-time-code, which browsers honour and never fill
// from a saved address; each form posts its value as company_url.
const TRAP = /<input[^>]*name="np_check"[^>]*>/;
const AUTOFILL_WORDS = /url|web|site|compan|organi[sz]|business|firm|name|mail|tel|fax|phone|address|street|city|town|post|zip|country|region|state|province|county|locality|org|first|last|surname|user|login|card|cvc|cvv|csc|otp/i;
const formIn = (t, opener) => {
  const from = t.indexOf(opener);
  return from < 0 ? "" : t.slice(from, t.indexOf("</form>", from));
};
const bodyOf = (t, name) => {
  const m = t.match(new RegExp("function " + name + "\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}"));
  return m ? m[0] : "";
};
function trapCheck(where, markup) {
  if (!markup) { fail(`${where}: form not found`); return; }
  const m = markup.match(TRAP);
  if (!m) { fail(`${where} has no trap field (name="np_check") for a bot to fill`); return; }
  const tag = m[0];
  if (!/autocomplete="one-time-code"/.test(tag)) fail(`${where}: the trap's autocomplete token is not one-time-code, so a browser may fill it`);
  for (const attr of ["name", "placeholder", "aria-label"]) {
    const v = (tag.match(new RegExp(`\\b${attr}="([^"]*)"`)) || [])[1] || "";
    if (AUTOFILL_WORDS.test(v)) fail(`${where}: the trap's ${attr} ("${v}") reads as a field autofill fills`);
  }
  // no id: nothing to label it by, and nothing for autofill to read
  if (/\bid="/.test(tag)) fail(`${where}: the trap has an id`);
  if (/<label[^>]*>[^<]*<input[^>]*name="np_check"/.test(markup)) fail(`${where}: the trap sits inside a label`);
  if (!/tabindex="-1"/.test(tag) || !/aria-hidden="true"/.test(tag)) fail(`${where}: the trap is in the tab order or read by assistive technology`);
}
{
  const home = read("index.html");
  trapCheck("index.html: the intro-call form", formIn(home, '<form id="bookForm"'));
  const send = home.slice(home.indexOf("async function submitForm"), home.indexOf("function render()"));
  if (/company_url:\s*''/.test(send)) fail("index.html: the intro-call form posts a hard-coded empty company_url");
  if (!/const trap = e\.target\.querySelector\('\[name="np_check"\]'\)\.value/.test(home)) fail("index.html: the intro-call form does not read the trap field");

  const portal = read("hub/assets/portal.js");
  const forms = [
    ["the desk form", 'introSubmit(event)', "introSubmit"],
    ["the Education sign-up", 'eduSubmit(event)', "eduSubmit"],
  ];
  for (const [what, opener, handler] of forms) {
    const form = formIn(portal, `<form onsubmit="return ${opener}">`);
    if (!TRAP.test(form) && !/\$\{TRAP_FIELD\}/.test(form)) fail(`hub/assets/portal.js: ${what} has no trap field for a bot to fill`);
    const body = bodyOf(portal, handler);
    if (!body) fail(`hub/assets/portal.js: ${handler} was not found`);
    else if (!/company_url:\s*trapValue\(form\)/.test(body)) fail(`hub/assets/portal.js: ${what} does not post the trap field as company_url`);
  }
  trapCheck("hub/assets/portal.js: TRAP_FIELD", (portal.match(/const TRAP_FIELD\s*=\s*'([^\n]*)';/) || ["", ""])[1]);
  if (!/querySelector\('\[name="np_check"\]'\)/.test(portal)) fail("hub/assets/portal.js: trapValue does not read the trap field");

  const account = read("assets/hub-account.js");
  trapCheck("assets/hub-account.js: the register form", formIn(account, '<form data-np-step="2">'));
  if (!/company_url:\s*e\.target\.querySelector\('\[name="np_check"\]'\)\.value/.test(account)) fail("assets/hub-account.js: the register form does not post the trap field as company_url");

  const opps = read("opportunities/index.html");
  trapCheck("opportunities/index.html: the capture form", formIn(opps, '<form onsubmit="event.preventDefault();submitCapture(this)">'));
  if (!/company_url:\s*fd\.get\('np_check'\)\|\|''/.test(opps)) fail("opportunities/index.html: the capture form does not post the trap field as company_url");
  if (!/if\(fd\.get\('np_check'\)\)\s*return showSuccess\(\);/.test(opps)) fail("opportunities/index.html: a filled trap is not dropped");
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

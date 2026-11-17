// Code review of 4 October 2026 (launch checklist, Phase 4): three things the
// review found on the public pages, each kept from coming back. Where a
// function can be lifted out of its page and run, it is run; the rest is read.
import { readFileSync, existsSync } from "node:fs";
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

// ---------------------------------------------------------------- the password rule
// Plan 093 (14 November 2026): the two pages that take a password say and
// check the live sign-in rule, the same one the worker checks (auth.js
// PASSWORD_MIN, passwordMissingKind): at least 8 characters, with a
// lower-case letter, a capital letter, a number and a symbol. The pages share
// no script, so each carries its own copy; this keeps the copies in step, and
// runs each page's own check on a few passwords.
{
  const RULE = "Use at least 8 characters, with a lower-case letter, a capital letter, a number and a symbol.";
  const cases = [["Walkpassword1", "Add a symbol."], ["walk-password-1", "Add a capital letter."],
    ["Walk-password", "Add a number."], ["WALK-PASSWORD-1", "Add a lower-case letter."], ["Walk-password-1", null]];
  for (const file of ["hub/confirm.html", "hub/reset.html"]) {
    const t = read(file);
    if (!/const MIN_LENGTH = 8;/.test(t)) fail(`${file}: MIN_LENGTH is not 8, the live minimum`);
    if (!t.includes(`const RULE = '${RULE}';`)) fail(`${file}: the rule's sentence is not the agreed one`);
    if (!/minlength="\$\{MIN_LENGTH\}"/.test(t)) fail(`${file}: the boxes' minlength does not follow MIN_LENGTH`);
    const from = t.indexOf("const SYMBOLS");
    const to = t.indexOf("/* The sign-in service's own refusal");
    if (from < 0 || to < 0) { fail(`${file}: the rule's check was not found`); continue; }
    let got;
    try {
      got = new Function(t.slice(from, to) + "\nreturn (pw) => missingKindLine(pw);")();
    } catch (e) { fail(`${file}: the rule's check does not run (${e.message})`); continue; }
    for (const [pw, want] of cases) {
      const line = got(pw);
      if (line !== want) fail(`${file}: ${pw} gives ${JSON.stringify(line)}, not ${JSON.stringify(want)}`);
    }
  }
}

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

// ---------------------------------------------------------------- plan 095: the pages a signed-in company uses
// The audit of 14 November 2026 found three faults on them. The account page
// told a paused host its listing was live, and told a host hidden for an
// unpaid membership invoice to email and "we will put it back"; the listing
// form dropped a material that was typed and not clicked; and the host had no
// button to send the introduction email again when it did not go.
// listingNotice is lifted out and every row of the plan's table is run; the
// rest is read.
{
  const dash = read("hub/assets/dashboard.js");
  const ta = read("hub/assets/typeahead.js");
  const lf = read("hub/assets/listing-form.js");

  if (dash.includes("we will put it back")) fail('hub/assets/dashboard.js: still says "we will put it back" (plan 095)');
  for (const want of ["NexPoint has paused your listing", "Pay the invoice", "Send the introduction email again"]) {
    if (!dash.includes(want)) fail(`hub/assets/dashboard.js: missing "${want}" (plan 095)`);
  }
  for (const want of ["commitMultiOnBlur", "pending:"]) {
    if (!ta.includes(want)) fail(`hub/assets/typeahead.js: missing "${want}" (plan 095)`);
  }
  for (const want of ["leftoverIn(", "TA[k].commit()"]) {
    if (!lf.includes(want)) fail(`hub/assets/listing-form.js: missing "${want}" (plan 095)`);
  }

  // No em-dash in any line that carries the plan's new words.
  const NEW_WORDS = [
    [dash, "hub/assets/dashboard.js", ["paused your listing", "hidden from the hubs", "embership invoice", "Paid already?",
      "Hidden from seekers for now", "did not go", "has not gone yet", "is on its way", "Send the introduction email again",
      "already been answered and its email has gone", "could not check that just now"]],
    [lf, "hub/assets/listing-form.js", ["is not on the", "Select from the list"]],
  ];
  for (const [text, file, marks] of NEW_WORDS) {
    for (const line of text.split("\n")) {
      if (line.includes("—") && marks.some((m) => line.includes(m))) fail(`${file}: an em-dash in the plan 095 words: ${line.trim().slice(0, 80)}`);
    }
  }

  // listingNotice, run on every row of the plan's table.
  const m = dash.match(/function listingNotice\(s\) \{[\s\S]*?\n  \}/);
  if (!m) fail("hub/assets/dashboard.js: listingNotice was not found");
  else {
    const HELLO = "hello@nexpoint.co.uk";
    const API_BASE = "https://api.nexpoint.co.uk";
    const notice = new Function("esc", "fmtDate", "isHost", "HELLO", "API_BASE", `${m[0]}; return listingNotice;`)(
      (x) => String(x == null ? "" : x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
      (iso) => ({ "2099-12-01": "1 Dec 2099", "2020-01-15": "15 Jan 2020" })[iso] || String(iso),
      (s) => !!s.host,
      HELLO,
      API_BASE,
    );
    const payUrl = `${API_BASE}/membership/pay/` + "ab".repeat(32);
    // A due day far ahead, so the case reads "is due by" whatever day the check runs.
    const inv = { number: "INV-0042", amount_text: "£1,000", due_on: "2099-12-01", pay_url: payUrl };
    const words = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const BUTTON = `<a class="btn btn-primary acct-btn-sm" href="${payUrl}" target="_blank" rel="noopener">Pay the invoice</a>`;
    const PAID = "Paid already? A payment can take a few working days to reach us. Email hello@nexpoint.co.uk if you would like us to check.";
    const rows = [
      ["paused by NexPoint", { host: true, pausedByDesk: true, hiddenUnpaid: false, invoice: null },
        "NexPoint has paused your listing, so nobody searching the hubs can see it. Email hello@nexpoint.co.uk and we will tell you why and what happens next.", false, true],
      ["paused, with an invoice that is only due", { host: true, pausedByDesk: true, hiddenUnpaid: false, invoice: inv },
        "NexPoint has paused your listing, so nobody searching the hubs can see it. Email hello@nexpoint.co.uk and we will tell you why and what happens next.", false, true],
      ["unpaid, invoice known", { host: true, pausedByDesk: false, hiddenUnpaid: true, invoice: inv },
        "Your listing is hidden from the hubs because membership invoice INV-0042 for £1,000 is unpaid. Nothing has been deleted, and your listing comes back once the payment reaches us. Pay the invoice " + PAID, true, true],
      ["unpaid, invoice not known", { host: true, pausedByDesk: false, hiddenUnpaid: true, invoice: null },
        "Your listing is hidden from the hubs because your membership invoice is unpaid. Nothing has been deleted, and your listing comes back once the payment reaches us. The invoice email has the button to pay; email hello@nexpoint.co.uk if you cannot find it.", false, true],
      ["both, invoice known", { host: true, pausedByDesk: true, hiddenUnpaid: true, invoice: inv },
        "Your listing is hidden from the hubs. Membership invoice INV-0042 for £1,000 is unpaid, and NexPoint has also paused your listing, so paying does not bring it back on its own. Email hello@nexpoint.co.uk and we will tell you what happens next. Pay the invoice " + PAID, true, true],
      ["both, invoice not known", { host: true, pausedByDesk: true, hiddenUnpaid: true, invoice: null },
        "Your listing is hidden from the hubs. Your membership invoice is unpaid, and NexPoint has also paused your listing, so paying does not bring it back on its own. Email hello@nexpoint.co.uk and we will tell you what happens next.", false, true],
      ["an invoice that is simply due", { host: true, pausedByDesk: false, hiddenUnpaid: false, invoice: inv },
        "Membership invoice INV-0042 for £1,000 is due by 1 Dec 2099. Pay the invoice", true, false],
      // Follow-up of 14 November: past its due day, on a host not yet hidden.
      ["an invoice past its due day", { host: true, pausedByDesk: false, hiddenUnpaid: false, invoice: { ...inv, due_on: "2020-01-15" } },
        "Membership invoice INV-0042 for £1,000 was due on 15 Jan 2020. Pay the invoice", true, false],
      ["an invoice that is due, with no date", { host: true, pausedByDesk: false, hiddenUnpaid: false, invoice: { ...inv, due_on: null } },
        "Membership invoice INV-0042 for £1,000 is waiting to be paid. Pay the invoice", true, false],
      ["a pay link that is not one", { host: true, pausedByDesk: false, hiddenUnpaid: true, invoice: { ...inv, pay_url: "javascript:alert(1)" } },
        "Your listing is hidden from the hubs because membership invoice INV-0042 for £1,000 is unpaid. Nothing has been deleted, and your listing comes back once the payment reaches us.", false, true],
      // Follow-up of 14 November: the right path and token on another address draws no button.
      ...["https://elsewhere.example", "https://api.nexpoint.co.uk.elsewhere.example", "http://api.nexpoint.co.uk"].map((origin) =>
        [`a pay link on ${origin}`, { host: true, pausedByDesk: false, hiddenUnpaid: true, invoice: { ...inv, pay_url: `${origin}/membership/pay/` + "ab".repeat(32) } },
          "Your listing is hidden from the hubs because membership invoice INV-0042 for £1,000 is unpaid. Nothing has been deleted, and your listing comes back once the payment reaches us.", false, true]),
      ["a pay link with more after the token", { host: true, pausedByDesk: false, hiddenUnpaid: true, invoice: { ...inv, pay_url: payUrl + "/x" } },
        "Your listing is hidden from the hubs because membership invoice INV-0042 for £1,000 is unpaid. Nothing has been deleted, and your listing comes back once the payment reaches us.", false, true],
      ["nothing wrong and no invoice", { host: true, pausedByDesk: false, hiddenUnpaid: false, invoice: null }, "", false, false],
      ["not a host", { host: false, pausedByDesk: true, hiddenUnpaid: true, invoice: inv }, "", false, false],
      ["a closed account", { host: true, closed: { at: "2026-11-01" }, pausedByDesk: true, hiddenUnpaid: true, invoice: inv }, "", false, false],
    ];
    for (const [name, s, want, button, alarm] of rows) {
      let html;
      try { html = notice(s); } catch (e) { fail(`hub/assets/dashboard.js: listingNotice threw on "${name}": ${e.message}`); continue; }
      if (words(html) !== want) fail(`hub/assets/dashboard.js: listingNotice, ${name}: reads "${words(html)}"`);
      if (html.includes(BUTTON) !== button) fail(`hub/assets/dashboard.js: listingNotice, ${name}: the Pay the invoice button is ${button ? "missing" : "shown"}`);
      if (want && html.includes('<div class="acct-notice">') !== alarm) fail(`hub/assets/dashboard.js: listingNotice, ${name}: ${alarm ? "is not shown as a notice" : "is shown as an alarm"}`);
      if (html.includes("—")) fail(`hub/assets/dashboard.js: listingNotice, ${name}: an em-dash`);
    }
    // What the worker sends is escaped before it reaches the page.
    const odd = notice({ host: true, hiddenUnpaid: true, invoice: { ...inv, number: '<b>"x"</b>' } });
    if (odd.includes("<b>")) fail("hub/assets/dashboard.js: listingNotice does not escape the invoice number");
  }

  // The refusals the button for the introduction email can also meet. The
  // button is told apart by data-kind="release"; the offer's button has none.
  const r = dash.match(/function resendIntro\(btn\) \{[\s\S]*?\n  \}/);
  const generic = (dash.match(/var GENERIC_ERROR = '([^']*)'/) || [])[1];
  if (r) {
    for (const [code, starts, isBad, kind] of [
      ["this introduction has already been answered", "This introduction has already been answered and its email has gone.", false, "release"],
      ["email log unavailable", "We could not check that just now.", true, "release"],
      // Follow-up of 14 November: after an attempt that did not go, the worker
      // still answers too_soon for two minutes; nothing was sent, so the
      // introduction email's button must not say "Sent".
      ["too_soon", "We tried a moment ago. Try again in two minutes.", false, "release"],
      ["too_soon", "Sent in the last two minutes.", false, null],
    ]) {
      const said = [];
      const resend = new Function("post", "el", "busy", "say", "isNotBuilt", "GENERIC_ERROR", `${r[0]}; return resendIntro;`)(
        () => Promise.resolve({ error: code }),
        () => ({}),
        () => () => {},
        (node, text, bad) => said.push([text, !!bad]),
        (d) => d && d.error === "http_404",
        generic,
      );
      resend({ getAttribute: (name) => (name === "data-kind" ? kind : "7"), disabled: false, textContent: "Send the introduction email again" });
      await new Promise((done) => setTimeout(done, 0));
      const [text, bad] = said[0] || ["", false];
      const which = kind ? "the introduction email's button" : "the offer's button";
      if (!text.startsWith(starts)) fail(`hub/assets/dashboard.js: "${code}" on ${which} has no words of its own (reads "${text}")`);
      if (kind === "release" && /^Sent/.test(text)) fail(`hub/assets/dashboard.js: "${code}" on ${which} says Sent when nothing was sent`);
      if (bad !== isBad) fail(`hub/assets/dashboard.js: "${code}" is ${isBad ? "not marked" : "marked"} as a failure`);
      if (text.includes("—")) fail(`hub/assets/dashboard.js: an em-dash in the "${code}" message`);
    }
  }
}

// ---------------------------------------------------------------- plan 098: a blank declaration is not a nil return
// The audit of 14 November 2026 found that the page worked out "nothing this
// month" from an empty form: one stray press filed a nil return, and a blank
// row beside a filled one declared nothing for itself without a word. Every
// row is now answered (a value, or its Nothing tick), and a month with no
// orders at all asks once more. declAnswers is lifted out and every row of
// the plan's table is run; the rest is read.
{
  const dash = read("hub/assets/dashboard.js");
  const FILE = "hub/assets/dashboard.js";

  if (dash.includes("nothing_this_month: lines.length === 0")) fail(`${FILE}: the nil flag is still worked out from an empty form (plan 098)`);
  if (!dash.includes('data-act="decl-nil-confirm"')) fail(`${FILE}: the nil return has no confirm button (plan 098)`);
  if (!dash.includes("nothing_for: answers.nothingFor")) fail(`${FILE}: the declaration does not send nothing_for (plan 098)`);
  if (!dash.includes('data-act="decl-change"')) fail(`${FILE}: a sent declaration has no Change this declaration button (plan 098)`);
  if (!dash.includes('data-act="decl-keep"') || !/act === 'decl-keep'\) \{ declReopen = null;/.test(dash))
    fail(`${FILE}: a reopened declaration has no Keep what I sent way back (plan 098)`);
  // A host on two hubs declares each on its own form, so a nil month says which hub it covers.
  for (const [what, re] of [
    ["the nil-return question", /no orders came through any of your ' \+ \(declHubName\(hub\)/],
    ["the confirm button", /'">Confirm no orders' \+ \(declHubName\(hub\)/],
    ["the words after a nil return", /'Sent\. No orders declared' \+ \(declHubName\(hub\)/],
  ]) {
    if (!re.test(dash)) fail(`${FILE}: ${what} does not name the hub (plan 098)`);
  }
  const hubNames = (dash.match(/var HUB_LABEL = (\{[^}]*\})/) || [])[1] || "";
  for (const want of ["print: '3D Print Hub'", "mill: 'Mill Hub'"]) {
    if (!hubNames.includes(want)) fail(`${FILE}: HUB_LABEL does not give ${want} for the declaration words (plan 098)`);
  }

  // The plan's words, each one present and none on a line with an em-dash.
  const WORDS = [
    "One line per introduction. Enter what came through, or tick Nothing where no orders came through. Every introduction needs one or the other.",
    ": enter a value, or tick Nothing if no orders came through.",
    " has figures and a Nothing tick. Clear the figures or untick Nothing.",
    // The nil-return words name the hub the form covers (follow-up of 14 November).
    "You are declaring that no orders came through any of your ",
    "introductions in ",
    ". Your declaration is the record. Confirm it, or go back and enter what came through.",
    "Confirm no orders",
    "Go back to the form",
    "Sent. No orders declared",
    "Every introduction needs an answer: a value, or a tick under Nothing. If you have answered them all, reload the page and declare again.",
    "One introduction has both figures and a Nothing tick. Clear one of them and send again.",
    // Step 6: a sent declaration can be changed until its month is on a statement.
    "Change this declaration",
    "Keep what I sent",
    "You are changing your declaration for ",
    ". What you send now replaces what you sent before, so answer every introduction again.",
    "Sent. Your declaration for ",
    " has been replaced.",
  ];
  for (const want of WORDS) {
    if (!dash.includes(want)) fail(`${FILE}: missing "${want}" (plan 098)`);
  }
  for (const line of dash.split("\n")) {
    if (line.includes("—") && WORDS.some((w) => line.includes(w))) fail(`${FILE}: an em-dash in the plan 098 words: ${line.trim().slice(0, 80)}`);
  }

  // declAnswers, run on every row of the plan's table. It is pure: nothing
  // from the page is handed to it.
  const m = dash.match(/function declAnswers\(rows\) \{[\s\S]*?\n  \}/);
  if (!m) fail(`${FILE}: declAnswers was not found`);
  else {
    const answers = new Function(`${m[0]}; return declAnswers;`)();
    const row = (id, over = {}) => ({ id, ref: "INTRO-000" + id, units: "", value: "", currency: "GBP", nothing: false, ...over });
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const cases = [
      ["one row, all empty, not ticked", [row(7)],
        (a) => a.blocked && a.blocked.why === "blank" && a.blocked.ref === "INTRO-0007" && same(a.lines, []) && same(a.nothingFor, [])],
      ["one row, ticked, empty", [row(7, { nothing: true })],
        (a) => a.blocked === null && same(a.lines, []) && same(a.nothingFor, [7])],
      ["one row, units and no value", [row(7, { units: "3" })],
        (a) => a.blocked && a.blocked.why === "value" && same(a.lines, [])],
      ["one row, a value and a tick", [row(7, { value: "10", nothing: true })],
        (a) => a.blocked && a.blocked.why === "both" && same(a.lines, []) && same(a.nothingFor, [])],
      ["two rows: a value, and a tick", [row(7, { value: "10" }), row(8, { nothing: true })],
        (a) => a.blocked === null && same(a.nothingFor, [8]) &&
          same(a.lines, [{ introduction_id: 7, units: null, value: 10, currency: "GBP" }])],
      ["two rows: a value, and a blank", [row(7, { value: "10" }), row(8)],
        (a) => a.blocked && a.blocked.why === "blank" && a.blocked.ref === "INTRO-0008" && a.blocked.id === 8],
      ["one row, a typed nought, not ticked", [row(7, { value: "0" })],
        (a) => a.blocked === null && same(a.nothingFor, []) &&
          same(a.lines, [{ introduction_id: 7, units: null, value: 0, currency: "GBP" }])],
      // Plan 104 (R7-25): Units is a whole number or empty; a decimal or a minus is refused on the page.
      ["one row, a decimal in Units beside a value", [row(7, { units: "1.5", value: "10" })],
        (a) => a.blocked && a.blocked.why === "units" && a.blocked.ref === "INTRO-0007" && same(a.lines, [])],
      ["one row, a minus in Units beside a value", [row(7, { units: "-3", value: "10" })],
        (a) => a.blocked && a.blocked.why === "units" && same(a.lines, [])],
      ["one row, whole Units and a value", [row(7, { units: "3", value: "10" })],
        (a) => a.blocked === null && same(a.nothingFor, []) &&
          same(a.lines, [{ introduction_id: 7, units: 3, value: 10, currency: "GBP" }])],
    ];
    for (const [name, rows, ok] of cases) {
      let got;
      try { got = answers(rows); } catch (e) { fail(`${FILE}: declAnswers threw on "${name}": ${e.message}`); continue; }
      if (!ok(got)) fail(`${FILE}: declAnswers, ${name}: gives ${JSON.stringify(got)}`);
    }
  }
}

// ---------------------------------------------------------------- Plan 104 (round 7 audit, 17 November 2026)
// Fixes for the first weeks after launch, each kept from coming back. Each
// finding has its own part below; where a function can be lifted out of its
// page and run, it is run, and the rest is read.
{
  const dash = read("hub/assets/dashboard.js");
  const DASH = "hub/assets/dashboard.js";
  // The plan's words in a file: each one present, none on a line with an em-dash.
  const wordsIn = (file, text, words, finding) => {
    for (const want of words) {
      if (!text.includes(want)) fail(`${file}: missing "${want}" (plan 104, ${finding})`);
    }
    for (const line of text.split("\n")) {
      if (line.includes("—") && words.some((w) => line.includes(w))) fail(`${file}: an em-dash in the plan 104 words (${finding}): ${line.trim().slice(0, 80)}`);
    }
  };

  // R7-16: the declaration form says what to do about a currency it does not offer.
  wordsIn(DASH, dash, ["If you invoiced in any currency other than pounds, euros or US dollars, email "], "R7-16");

  // R7-25: four small slips where a person is told the wrong thing.
  // (c) A decimal or a minus in Units gets words, and is not sent. The three
  // rows for declAnswers sit in the plan 098 table above, where it is lifted out.
  wordsIn(DASH, dash, [
    " as a whole number, such as 12, or leave Units empty.",
    "Units must be a whole number, such as 12. Correct the Units box, or leave it empty, and send again.",
  ], "R7-25");
  if (!dash.includes("'Enter Units for ' + b.ref + ' as a whole number, such as 12, or leave Units empty.'"))
    fail(`${DASH}: the page has no words for a decimal or a minus in Units (plan 104, R7-25)`);
  if (!/line_units_invalid: 'Units must be a whole number/.test(dash)) fail(`${DASH}: line_units_invalid has no words of its own (plan 104, R7-25)`);
  // (a) The reset page ignores a second Enter while the first send is in flight.
  {
    const reset = read("hub/reset.html");
    const from = reset.indexOf("async function setPassword(token){");
    const body = from < 0 ? "" : reset.slice(from, reset.indexOf("\n}", from));
    const guard = body.indexOf("if (!btn || btn.disabled) return;");
    const lock = body.indexOf("btn.disabled = true");
    if (!body) fail("hub/reset.html: setPassword was not found (plan 104, R7-25)");
    else if (guard < 0 || lock < 0 || guard > lock) fail("hub/reset.html: setPassword does not leave when a send is already in flight (plan 104, R7-25)");
  }
  // (b) The invitation page the same.
  {
    const invite = read("hub/assets/invite.js");
    const from = invite.indexOf("function join() {");
    const body = from < 0 ? "" : invite.slice(from, invite.indexOf("\n  }", from));
    const guard = body.indexOf("if (btn.disabled) return;");
    const lock = body.indexOf("btn.disabled = true");
    if (!body) fail("hub/assets/invite.js: join was not found (plan 104, R7-25)");
    else if (guard < 0 || lock < 0 || guard > lock) fail("hub/assets/invite.js: join does not leave when a send is already in flight (plan 104, R7-25)");
  }
  // (d) The sign-in box gets its form back each time it opens: a card is put
  // up through signShowCard, which keeps the form's own nodes.
  {
    const portal = read("hub/assets/portal.js");
    if (!portal.includes("signFormNodes")) fail("hub/assets/portal.js: the sign-in form's nodes are not kept while a card stands in their place (plan 104, R7-25)");
    if (portal.includes("getElementById('signContent').innerHTML =")) fail("hub/assets/portal.js: a card is written straight over the sign-in form (plan 104, R7-25)");
  }

  // R7-18: a paused or hidden account is not offered buttons the worker always
  // refuses; the page says when it can answer instead. The three functions
  // are pure, so they are lifted out and every row of the plan's table is run.
  {
    const HELD_WORDS = {
      rowHost: "You can answer this introduction once your listing is back on the hubs.",
      rowOther: "This introduction cannot be answered for now. Email hello@nexpoint.co.uk and we will tell you what happens next.",
      oneHost: "1 introduction is waiting for your answer. You can answer it once your listing is back on the hubs.",
      manyHost: "3 introductions are waiting for your answer. You can answer them once your listing is back on the hubs.",
      oneOther: "1 introduction is waiting for your answer, and cannot be answered for now. Email hello@nexpoint.co.uk and we will tell you what happens next.",
      manyOther: "3 introductions are waiting for your answer, and cannot be answered for now. Email hello@nexpoint.co.uk and we will tell you what happens next.",
      noneHost: "Nothing waiting on you. Your listing is not showing on the hubs for now.",
    };
    const lifted = [
      dash.match(/function answersHeld\(s\) \{[\s\S]*?\n  \}/),
      dash.match(/function heldRowWords\(host\) \{[\s\S]*?\n  \}/),
      dash.match(/function heldWaitingWords\(host, n\) \{[\s\S]*?\n  \}/),
    ];
    if (lifted.some((m) => !m)) fail(`${DASH}: answersHeld, heldRowWords or heldWaitingWords was not found (plan 104, R7-18)`);
    else {
      let fns = null;
      try {
        fns = new Function(`${lifted.map((m) => m[0]).join("\n")}; return { answersHeld, heldRowWords, heldWaitingWords };`)();
      } catch (e) { fail(`${DASH}: the held functions could not be lifted out: ${e.message} (plan 104, R7-18)`); }
      if (fns) {
        const cases = [
          ["answersHeld, paused by the desk", () => fns.answersHeld({ pausedByDesk: true }), true],
          ["answersHeld, hidden for an unpaid invoice", () => fns.answersHeld({ hiddenUnpaid: true }), true],
          ["answersHeld, neither", () => fns.answersHeld({}), false],
          ["answersHeld, no site", () => fns.answersHeld(null), false],
          ["answersHeld, a closed account", () => fns.answersHeld({ pausedByDesk: true, closed: { at: "x" } }), false],
          ["heldRowWords, a host", () => fns.heldRowWords(true), HELD_WORDS.rowHost],
          ["heldRowWords, no listing", () => fns.heldRowWords(false), HELD_WORDS.rowOther],
          ["heldWaitingWords, a host, one", () => fns.heldWaitingWords(true, 1), HELD_WORDS.oneHost],
          ["heldWaitingWords, a host, three", () => fns.heldWaitingWords(true, 3), HELD_WORDS.manyHost],
          ["heldWaitingWords, no listing, one", () => fns.heldWaitingWords(false, 1), HELD_WORDS.oneOther],
          ["heldWaitingWords, no listing, three", () => fns.heldWaitingWords(false, 3), HELD_WORDS.manyOther],
          ["heldWaitingWords, a host, none", () => fns.heldWaitingWords(true, 0), HELD_WORDS.noneHost],
          ["heldWaitingWords, no listing, none", () => fns.heldWaitingWords(false, 0), ""],
        ];
        for (const [name, run, want] of cases) {
          let got;
          try { got = run(); } catch (e) { fail(`${DASH}: ${name} threw: ${e.message} (plan 104, R7-18)`); continue; }
          if (got !== want) fail(`${DASH}: ${name}: gives ${JSON.stringify(got)}, want ${JSON.stringify(want)} (plan 104, R7-18)`);
        }
      }
    }
    if (!dash.includes("answerable(i) && !held")) fail(`${DASH}: Accept and Decline are still drawn for an account that cannot answer (plan 104, R7-18)`);
    if (!dash.includes("showResend && !held && i.stage === 'awaiting_acceptance'")) fail(`${DASH}: Send the email again is still drawn for an account that cannot answer (plan 104, R7-18)`);
    // None of the seven sentences, as the page's code writes them, sits on a line with an em-dash.
    const PARTS = [
      HELD_WORDS.rowHost, HELD_WORDS.rowOther, HELD_WORDS.noneHost,
      "1 introduction is waiting for your answer", " introductions are waiting for your answer",
      " once your listing is back on the hubs.",
      ", and cannot be answered for now. Email hello@nexpoint.co.uk and we will tell you what happens next.",
    ];
    for (const line of dash.split("\n")) {
      if (line.includes("—") && PARTS.some((w) => line.includes(w))) fail(`${DASH}: an em-dash in the plan 104 words (R7-18): ${line.trim().slice(0, 80)}`);
    }
  }

  // R7-20: a repeat pick and an eleventh request in a day are refused by the
  // worker; the find page has words for each of its three new answers.
  wordsIn("hub/assets/find.js", read("hub/assets/find.js"), [
    "You have already asked this company, and it has not answered yet.",
    "You already have an introduction with this company",
    "which is the most allowed in a day.",
    "We could not check that just now. Try again in a minute",
  ], "R7-20");

  // R7-21: the home page does not wait for the visitor tracking company. Its
  // tag sits at the foot, after the page's own inline script, never in the
  // head; and the header and footer logo is the small file, not the 2,362
  // pixel original.
  {
    const home = read("index.html");
    const headEnd = home.indexOf("</head>");
    const TRACKER = "365-syndicate";
    if (headEnd < 0) fail("index.html: no </head> found (plan 104, R7-21)");
    else {
      if (home.slice(0, headEnd).includes(TRACKER)) fail("index.html: the tracking tag is in the head, where a slow answer holds up the whole page (plan 104, R7-21)");
      const body = home.slice(headEnd);
      const tags = [...body.matchAll(/<script\b[^>]*>/g)].filter((m) => m[0].includes(TRACKER));
      const inline = [...body.matchAll(/<script>/g)];
      const lastInline = inline.length ? inline[inline.length - 1].index : -1;
      if (tags.length !== 1) fail(`index.html: the body holds ${tags.length} tracking scripts, want exactly one (plan 104, R7-21)`);
      else if (lastInline < 0 || tags[0].index < lastInline) fail("index.html: the tracking script is not after the page's last inline script (plan 104, R7-21)");
    }
    if (/<img\b[^>]*\bsrc="assets\/nexpoint-logo\.png"/.test(home)) fail("index.html: an image still loads the full-size logo (plan 104, R7-21)");
    const small = join(ROOT, "assets/nexpoint-logo-156.png");
    if (!existsSync(small)) fail("assets/nexpoint-logo-156.png is missing (plan 104, R7-21)");
    else {
      // A PNG's width is bytes 16 to 19, as check/sweep.mjs's imageSize reads it.
      const png = readFileSync(small);
      const isPng = png.length > 24 && png.readUInt32BE(0) === 0x89504e47;
      const width = isPng ? png.readUInt32BE(16) : 0;
      if (!isPng) fail("assets/nexpoint-logo-156.png is not a PNG (plan 104, R7-21)");
      else if (width > 400) fail(`assets/nexpoint-logo-156.png is ${width} pixels wide, want 400 or less (plan 104, R7-21)`);
    }
  }
}

if (fails.length) {
  console.error(`review: ${fails.length} problem(s)`);
  for (const f of fails) console.error("  " + f);
  process.exit(1);
}
console.log("review-ok");

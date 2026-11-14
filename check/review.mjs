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

// ---------------------------------------------------------------- plan 095: the pages a signed-in company uses
// The audit of 14 November 2026 found four faults on them. The account page
// told a paused host its listing was live, and told a host hidden for an
// unpaid membership invoice to email and "we will put it back"; the listing
// form dropped a material that was typed and not clicked; the host had no
// button to send the introduction email again when it did not go; and the
// find form did not say who reads its last box. listingNotice is lifted out
// and every row of the plan's table is run; the rest is read.
{
  const dash = read("hub/assets/dashboard.js");
  const ta = read("hub/assets/typeahead.js");
  const lf = read("hub/assets/listing-form.js");
  const find = read("hub/assets/find.js");

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
  if (!find.includes("reads it only once it accepts")) fail("hub/assets/find.js: the notes box does not say who reads it (plan 095)");

  // No em-dash in any line that carries the plan's new words.
  const NEW_WORDS = [
    [dash, "hub/assets/dashboard.js", ["paused your listing", "hidden from the hubs", "embership invoice", "Paid already?",
      "Hidden from seekers for now", "did not go", "has not gone yet", "is on its way", "Send the introduction email again",
      "already been answered and its email has gone", "could not check that just now"]],
    [lf, "hub/assets/listing-form.js", ["is not on the", "Select from the list"]],
    [find, "hub/assets/find.js", ["should know? (optional)", "reads it only once it accepts"]],
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
    const notice = new Function("esc", "fmtDate", "isHost", "HELLO", `${m[0]}; return listingNotice;`)(
      (x) => String(x == null ? "" : x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
      (iso) => (iso === "2026-12-01" ? "1 Dec 2026" : String(iso)),
      (s) => !!s.host,
      HELLO,
    );
    const payUrl = "https://portal.example/membership/pay/" + "ab".repeat(32);
    const inv = { number: "INV-0042", amount_text: "£1,000", due_on: "2026-12-01", pay_url: payUrl };
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
        "Membership invoice INV-0042 for £1,000 is due by 1 Dec 2026. Pay the invoice", true, false],
      ["an invoice that is due, with no date", { host: true, pausedByDesk: false, hiddenUnpaid: false, invoice: { ...inv, due_on: null } },
        "Membership invoice INV-0042 for £1,000 is waiting to be paid. Pay the invoice", true, false],
      ["a pay link that is not one", { host: true, pausedByDesk: false, hiddenUnpaid: true, invoice: { ...inv, pay_url: "javascript:alert(1)" } },
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

  // The two refusals the button for the introduction email can also meet.
  const r = dash.match(/function resendIntro\(btn\) \{[\s\S]*?\n  \}/);
  const generic = (dash.match(/var GENERIC_ERROR = '([^']*)'/) || [])[1];
  if (r) {
    for (const [code, starts, isBad] of [
      ["this introduction has already been answered", "This introduction has already been answered and its email has gone.", false],
      ["email log unavailable", "We could not check that just now.", true],
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
      resend({ getAttribute: () => "7", disabled: false, textContent: "Send the introduction email again" });
      await new Promise((done) => setTimeout(done, 0));
      const [text, bad] = said[0] || ["", false];
      if (!text.startsWith(starts)) fail(`hub/assets/dashboard.js: "${code}" has no words of its own (reads "${text}")`);
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

  // The plan's words, each one present and none on a line with an em-dash.
  const WORDS = [
    "One line per introduction. Enter what came through, or tick Nothing where no orders came through. Every introduction needs one or the other.",
    ": enter a value, or tick Nothing if no orders came through.",
    " has figures and a Nothing tick. Clear the figures or untick Nothing.",
    "You are declaring that no orders came through any of your introductions in ",
    ". Your declaration is the record. Confirm it, or go back and enter what came through.",
    "Confirm no orders in ",
    "Go back to the form",
    "Sent. No orders declared for ",
    "Every introduction needs an answer: a value, or a tick under Nothing. If you have answered them all, reload the page and declare again.",
    "One introduction has both figures and a Nothing tick. Clear one of them and send again.",
    // Step 6: a sent declaration can be changed until its month is on a statement.
    "Change this declaration",
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
    ];
    for (const [name, rows, ok] of cases) {
      let got;
      try { got = answers(rows); } catch (e) { fail(`${FILE}: declAnswers threw on "${name}": ${e.message}`); continue; }
      if (!ok(got)) fail(`${FILE}: declAnswers, ${name}: gives ${JSON.stringify(got)}`);
    }
  }
}

if (fails.length) {
  console.error(`review: ${fails.length} problem(s)`);
  for (const f of fails) console.error("  " + f);
  process.exit(1);
}
console.log("review-ok");

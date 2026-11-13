// The full test's report: one HTML page and one Markdown file, written
// beside the screenshots, outside this repository.
import { writeFileSync } from "node:fs";
import { join, basename } from "node:path";

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ORDER = ["differed", "refused", "waiting", "by hand", "skipped", "not reached", "as written"];
const LABEL = { "as written": "As written", differed: "Differed", refused: "Refused", waiting: "Waiting", "by hand": "By hand",
  skipped: "Skipped", "not reached": "Not reached" };

export function tally(results) {
  const t = Object.fromEntries(ORDER.map((k) => [k, 0]));
  for (const r of results) t[r.status] = (t[r.status] || 0) + 1;
  return t;
}
/* One line for the terminal and the top of the report. */
export function verdict(results) {
  const t = tally(results);
  const parts = ORDER.filter((k) => t[k]).map((k) => `${t[k]} ${LABEL[k].toLowerCase()}`);
  return `${results.length} steps: ${parts.join(", ") || "none taken"}`;
}

function groups(results) {
  const out = [];
  for (const r of results) {
    const key = `${r.pass}|${r.journey.id}`;
    let g = out[out.length - 1];
    if (!g || g.key !== key) { g = { key, pass: r.pass, journey: r.journey, rows: [] }; out.push(g); }
    g.rows.push(r);
  }
  return out;
}

export function writeMarkdown(dir, run) {
  const { results, byHand, mail, meta, invoices = [], left = [] } = run;
  const lines = [`# The full test, ${meta.when}`, "", verdict(results), "",
    `Site build: ${meta.build || "not read"}. Terms live: ${meta.termsVersion || "not read"}. Browser: ${meta.browser || "none"}.`,
    meta.command ? `Command: \`${meta.command}\`` : "", ""];
  const wrong = results.filter((r) => r.status === "differed" || r.status === "refused");
  lines.push("## What differed", "");
  if (!wrong.length) lines.push("Nothing: every step taken was as written.", "");
  for (const r of wrong) {
    lines.push(`- **${r.journey.title}** (${r.pass}): ${r.step.does}`, `  - Should show: ${r.step.shows}`, `  - ${LABEL[r.status]}: ${r.detail}`,
      r.shot ? `  - Screenshot: shots/${basename(r.shot)}` : "");
  }
  const waiting = results.filter((r) => r.status === "waiting");
  if (waiting.length) {
    lines.push("", "## Waiting: run the test again once these have happened", "");
    for (const r of waiting) lines.push(`- **${r.journey.title}**: ${r.detail}`);
  }
  lines.push("", "## Xero invoices this test raised", "");
  if (!invoices.length) lines.push("None.");
  for (const i of invoices) lines.push(`- ${i.what}${i.number ? `, Xero ${i.number}` : ""}${i.company ? `, ${i.company}` : ""}${i.amount ? `, ${i.amount}` : ""}: ${i.voided ? "voided" : "**not voided yet**"}`);
  lines.push("", "## Test data this run made", "");
  if (!left.length) lines.push("Nothing.");
  for (const x of left) lines.push(`- ${x}`);
  lines.push("", "## For you to do by hand", "");
  for (const h of byHand) lines.push(`- ${h}`);
  if (mail.length) {
    lines.push("", "## Emails", "", "| Email | To | Result |", "|---|---|---|");
    for (const m of mail) lines.push(`| ${m.what} | ${m.to} | ${m.result} |`);
  }
  lines.push("", "## Every step", "");
  for (const g of groups(results)) {
    lines.push(`### ${g.journey.title} (${g.pass})`, "", "| Step | Should show | Result |", "|---|---|---|");
    for (const r of g.rows) {
      lines.push(`| ${r.step.does} | ${r.step.shows} | ${LABEL[r.status]}${r.detail ? `: ${r.detail}` : ""} |`.replace(/\n/g, " "));
    }
    lines.push("");
  }
  const path = join(dir, "report.md");
  writeFileSync(path, lines.filter((l) => l !== "").join("\n").replace(/\n(#+ )/g, "\n\n$1") + "\n");
  return path;
}

const CSS = `
:root{--blue:#005CC8;--green:#8BC53F;--bg:#F5F7FA;--alt:#ECEFF3;--surface:#FFFFFF;--fg:#0E1626;--fg1:#2C3444;--fg2:#5A6474;--border:#E3E7ED;--danger:#E5484D}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg1);font:400 15px/1.55 "Inter",system-ui,sans-serif}
main{max-width:1120px;margin:0 auto;padding:40px 24px 80px}
h1,h2,h3{font-family:"Montserrat",system-ui,sans-serif;color:var(--fg);letter-spacing:-0.02em}
h1{font-size:32px;margin:0 0 8px}h2{font-size:22px;margin:40px 0 12px}h3{font-size:17px;margin:28px 0 8px}
p{margin:0 0 12px}.meta{color:var(--fg2);font-size:14px}
.tiles{display:flex;flex-wrap:wrap;gap:12px;margin:20px 0}
.tile{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:14px 18px;min-width:120px}
.tile b{display:block;font:700 26px/1 "Montserrat",system-ui,sans-serif;color:var(--fg)}
.tile span{font-size:13px;color:var(--fg2)}
.card{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:16px 20px;margin:0 0 12px}
.card.bad{border-left:4px solid var(--danger)}.card.wait{border-left:4px solid var(--blue)}
table{width:100%;border-collapse:collapse;background:var(--surface);border:1px solid var(--border);border-radius:8px;overflow:hidden}
th,td{text-align:left;vertical-align:top;padding:9px 12px;border-bottom:1px solid var(--border);font-size:14px}
th{font:600 11px/1 "Inter",system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:var(--fg2);background:var(--alt)}
tr:last-child td{border-bottom:0}
.pill{display:inline-block;border-radius:9999px;padding:2px 10px;font-size:12px;font-weight:600;white-space:nowrap}
.s-as-written{background:rgba(139,197,63,.20);color:var(--fg)}
.s-differed,.s-refused{background:rgba(229,72,77,.12);color:var(--fg);box-shadow:inset 0 0 0 1px var(--danger)}
.s-waiting{background:rgba(0,92,200,.10);color:var(--blue)}
.s-by-hand,.s-skipped,.s-not-reached{background:var(--alt);color:var(--fg2)}
.detail{color:var(--fg2);font-size:13px;margin-top:4px;overflow-wrap:anywhere}
a{color:var(--blue)}img{max-width:100%;border:1px solid var(--border);border-radius:6px;margin-top:8px}
ul{padding-left:20px}li{margin:0 0 6px}
details{margin:0 0 10px}summary{cursor:pointer;font:600 16px/1.4 "Montserrat",system-ui,sans-serif;color:var(--fg);padding:8px 0}
@media (max-width:640px){main{padding:24px 16px 56px}th:nth-child(2),td:nth-child(2){display:none}}
`;

export function writeHtml(dir, run) {
  /* invoices and left were read here and never taken from the run: the first live run
     (13 November) ended on "invoices is not defined" and wrote no report. */
  const { results, byHand, mail, meta, invoices = [], left = [] } = run;
  const t = tally(results);
  const pill = (s) => `<span class="pill s-${s.replace(/ /g, "-")}">${LABEL[s]}</span>`;
  const wrong = results.filter((r) => r.status === "differed" || r.status === "refused");
  const waiting = results.filter((r) => r.status === "waiting");
  const h = [];
  h.push(`<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`,
    `<title>Full test, ${esc(meta.when)}</title>`,
    `<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=Montserrat:wght@600;700&display=swap" rel="stylesheet">`,
    `<style>${CSS}</style></head><body><main>`,
    `<h1>The full test</h1><p class="meta">${esc(meta.when)} · site build ${esc(meta.build || "not read")} · terms live ${esc(meta.termsVersion || "not read")} · ${esc(meta.browser || "no browser")}</p>`,
    `<div class="tiles">${ORDER.filter((k) => t[k]).map((k) => `<div class="tile"><b>${t[k]}</b><span>${LABEL[k]}</span></div>`).join("")}</div>`);
  h.push(`<h2>What differed</h2>`);
  if (!wrong.length) h.push(`<div class="card">Nothing: every step taken was as written.</div>`);
  for (const r of wrong) {
    h.push(`<div class="card bad"><strong>${esc(r.journey.title)}</strong> <span class="meta">(${esc(r.pass)})</span><br>${esc(r.step.does)}`,
      `<div class="detail">Should show: ${esc(r.step.shows)}</div><div class="detail">${LABEL[r.status]}: ${esc(r.detail)}</div>`,
      r.shot ? `<a href="shots/${esc(basename(r.shot))}"><img src="shots/${esc(basename(r.shot))}" alt="The screen when this step differed" loading="lazy"></a>` : "", `</div>`);
  }
  if (waiting.length) {
    h.push(`<h2>Waiting: run the test again once these have happened</h2>`);
    for (const r of waiting) h.push(`<div class="card wait"><strong>${esc(r.journey.title)}</strong><div class="detail">${esc(r.detail)}</div></div>`);
  }
  h.push(`<h2>Xero invoices this test raised</h2><div class="card"><ul>${invoices.length ? invoices.map((i) => `<li>${esc(i.what)}${i.number ? `, Xero ${esc(i.number)}` : ""}${i.company ? `, ${esc(i.company)}` : ""}${i.amount ? `, ${esc(i.amount)}` : ""}: ${i.voided ? "voided" : "<strong>not voided yet</strong>"}</li>`).join("") : "<li>None.</li>"}</ul></div>`);
  h.push(`<h2>Test data this run made</h2><div class="card"><ul>${left.length ? left.map((x) => `<li>${esc(x)}</li>`).join("") : "<li>Nothing.</li>"}</ul></div>`);
  h.push(`<h2>For you to do by hand</h2><div class="card"><ul>${byHand.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`);
  if (mail.length) {
    h.push(`<h2>Emails</h2><table><tr><th>Email</th><th>To</th><th>Result</th></tr>`,
      mail.map((m) => `<tr><td>${esc(m.what)}</td><td>${esc(m.to)}</td><td>${esc(m.result)}</td></tr>`).join(""), `</table>`);
  }
  h.push(`<h2>Every step</h2>`);
  for (const g of groups(results)) {
    const bad = g.rows.some((r) => r.status === "differed" || r.status === "refused");
    h.push(`<details${bad ? " open" : ""}><summary>${esc(g.journey.title)} <span class="meta">(${esc(g.pass)}, ${g.rows.length} steps)</span></summary>`,
      `<table><tr><th>Step</th><th>Should show</th><th>Result</th></tr>`);
    for (const r of g.rows) {
      h.push(`<tr><td>${esc(r.step.does)}</td><td>${esc(r.step.shows)}</td><td>${pill(r.status)}${r.detail ? `<div class="detail">${esc(r.detail)}</div>` : ""}</td></tr>`);
    }
    h.push(`</table></details>`);
  }
  h.push(`</main></body></html>`);
  const path = join(dir, "report.html");
  writeFileSync(path, h.join("\n"));
  return path;
}

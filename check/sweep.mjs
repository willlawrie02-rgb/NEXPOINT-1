// Copy and speed sweep (plan 039): the public pages agree with each other and
// paint fast. Each rule below is a thing that was wrong once; the check keeps
// it from coming back. The admin boards are synced from another repo and are
// out of scope here.
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const PUBLIC_DIRS = ["hub", "printhub", "millhub", "opportunities", "portal"];
const fails = [];
const fail = (msg) => fails.push(msg);
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

function* walk(dir, ext) {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, name);
    const st = statSync(join(ROOT, rel));
    if (st.isDirectory()) yield* walk(rel, ext);
    else if (name.endsWith(ext)) yield rel;
  }
}
const pages = ["index.html", ...PUBLIC_DIRS.flatMap((d) => [...walk(d, ".html")])].sort();
const scripts = [...walk("assets", ".js"), ...walk(join("hub", "assets"), ".js")];

// ---------------------------------------------------------------- copy
const stripComments = (t) =>
  t.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/[^\n]*/g, "$1");

for (const p of pages) {
  const t = read(p);
  // The company is NexPoint Global Ltd (Companies House 17214028, confirmed by
  // Will on 5 October 2026); "NexPoint Ltd" is an unrelated company's name.
  if (/NexPoint Ltd\b|NexPoint Limited\b/.test(stripComments(t))) fail(`${p}: says "NexPoint Ltd" (the company is NexPoint Global Ltd)`);
  if (/forty years/i.test(t)) fail(`${p}: says "forty years" (the figure is 20+ years)`);
  if (/member portal/i.test(t)) fail(`${p}: says "member portal"`);
  if (stripComments(t).includes("—")) fail(`${p}: an em-dash in outward copy`);
  const reach = t.match(/Global reach across [^<]*/);
  if (reach && !/UK, EU, North America, Middle East, Australia and Asia\./.test(reach[0])) {
    fail(`${p}: the footer's regions are not the six (UK, EU, North America, Middle East, Australia and Asia)`);
  }
}
{
  const home = read("index.html");
  if (/Two services/.test(home)) fail('index.html: still says "Two services" (there are three service lines)');
  if (!/Three services/.test(home)) fail('index.html: the services heading does not say "Three services"');
  if (!/Hub Management &amp; Development/.test(home)) fail("index.html: the third service line, Hub Management & Development, is missing");
  const priv = read("hub/privacy.html");
  if ((priv.match(/hosted in the UK/g) || []).length !== 1) fail('hub/privacy.html: the database line must say "hosted in the UK" exactly once');
  const print = read("printhub/index.html");
  if (!/Certified labs near your customers print your work\./.test(print)) fail("printhub/index.html: the hero does not lead with local capacity");
  if (/No freight, no customs, no import taxes/.test(print)) fail("printhub/index.html: the hero still leads with the cross-border line");
  const block = print.slice(print.indexOf('<div class="rows">'));
  const leads = [...block.slice(0, block.indexOf("</section>")).matchAll(/<span class="lead">([^<]*)<\/span>/g)].map((m) => m[1]);
  if (!leads.length) fail("printhub/index.html: the use-case rows were not found");
  else if (!/^Later, cross-border/.test(leads[leads.length - 1])) fail("printhub/index.html: the cross-border use case is not the last row, softened to the add-on it is");
}

// ---------------------------------------------------------------- descriptions and labels
// The site audit of 5 October 2026 marked two things as errors on the live
// pages. A page a visitor or a link preview can reach says what it is in one
// or two sentences; the link landings (they only make sense with a token)
// and the old portal redirect are left out. And a link or button that carries
// an aria-label hides its icon from assistive technology, or a screen reader
// user hears "lock Global Hub" where the label says "Global Hub".
const NO_DESCRIPTION = new Set(["hub/accept.html", "hub/check.html", "hub/confirm.html", "hub/reset.html", "portal/index.html"]);
const unescape = (t) => t.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
for (const p of pages) {
  const t = read(p);
  const found = [...t.matchAll(/<meta\s+name="description"\s+content="([^"]*)"\s*\/?>/g)].map((m) => unescape(m[1]));
  if (!NO_DESCRIPTION.has(p)) {
    if (found.length !== 1) fail(`${p}: needs exactly one meta description (found ${found.length})`);
    else if (found[0].length < 110 || found[0].length > 160) fail(`${p}: the meta description is ${found[0].length} characters (110 to 160)`);
    else if (/\bmembers?\b|\bmembership\b/i.test(found[0])) fail(`${p}: the meta description says "member"`);
  }
  const markup = t.replace(/<script[\s\S]*?<\/script>/g, "");
  for (const m of markup.matchAll(/<(a|button)\b[^>]*aria-label="([^"]*)"[^>]*>([\s\S]*?)<\/\1>/g)) {
    for (const icon of m[3].matchAll(/<span[^>]*material-symbols-outlined[^>]*>/g)) {
      if (!/aria-hidden="true"/.test(icon[0])) fail(`${p}: the "${m[2]}" ${m[1] === "a" ? "link" : "button"} has an icon that is not hidden from screen readers`);
    }
  }
}

// ---------------------------------------------------------------- icons
// One subset for the whole site: every page that draws icons loads the same
// stylesheet URL, so the font is cached across pages and no page can miss an
// icon that a shared script injects.
const used = new Set();
const addAll = (re, t, g = 1) => { for (const m of t.matchAll(re)) used.add(m[g]); };
for (const f of [...pages, ...scripts]) {
  const t = read(f);
  addAll(/material-symbols-outlined[^>]*>\s*([a-z0-9_]+)\s*</g, t);
  // names chosen in a template expression: ${cond ? 'a' : 'b'} or ${MAP[key] || 'c'}
  for (const m of t.matchAll(/material-symbols-outlined[^>]*>\$\{([^}]*)\}/g)) {
    addAll(/'([a-z][a-z0-9_]+)'/g, m[1]);
    for (const id of m[1].matchAll(/([A-Z_]{3,})\[/g)) {
      const obj = t.match(new RegExp(id[1] + "\\s*=\\s*\\{([^}]*)\\}"));
      if (obj) addAll(/:\s*'([a-z][a-z0-9_]+)'/g, obj[1]);
    }
  }
  // names passed to a script's own icon helpers
  if (/function icon\(/.test(t)) {
    addAll(/\bicon\('([a-z0-9_]+)'\)/g, t);
    addAll(/\bhead\('([a-z0-9_]+)'/g, t);
    addAll(/\bempty\([^;\n]*,\s*'([a-z0-9_]+)'\)/g, t);
    addAll(/\bicon:\s*'([a-z0-9_]+)'/g, t);
    addAll(/ico \|\| '([a-z0-9_]+)'/g, t);
  }
  // names drawn by a stylesheet rule
  addAll(/content:\s*"([a-z0-9_]+)"[^}]*Material Symbols/g, t);
}
const wanted = [...used].sort();
const links = new Set();
for (const p of pages) {
  const t = read(p);
  const m = t.match(/<link[^>]*href="(https:\/\/fonts\.googleapis\.com\/css2\?family=Material\+Symbols\+Outlined[^"]*)"/);
  const live = stripComments(t.replace(/<style[\s\S]*?<\/style>/g, ""));
  const draws = /material-symbols-outlined/.test(live) || /["'][^"']*hub-account\.js["']/.test(live);
  if (!m) {
    if (draws) fail(`${p}: draws icons but does not load the icon font`);
    continue;
  }
  const url = m[1].replace(/&amp;/g, "&");
  links.add(url);
  const names = (url.match(/[?&]icon_names=([^&]*)/) || [, ""])[1].split(",").filter(Boolean);
  if (!names.length) { fail(`${p}: loads the whole icon font (no icon_names subset)`); continue; }
  if (names.join(",") !== [...names].sort().join(",")) fail(`${p}: icon_names must be sorted alphabetically`);
  const missing = wanted.filter((n) => !names.includes(n));
  if (missing.length) fail(`${p}: the icon subset is missing ${missing.join(", ")}`);
  const extra = names.filter((n) => !used.has(n));
  if (extra.length) fail(`${p}: the icon subset carries unused names: ${extra.join(", ")}`);
}
if (links.size > 1) fail(`the pages load ${links.size} different icon stylesheets; there should be one, so it is cached across pages`);

// ---------------------------------------------------------------- images
function imageSize(file) {
  const b = readFileSync(file);
  if (b[0] === 0x89 && b.toString("ascii", 1, 4) === "PNG") return [b.readUInt32BE(16), b.readUInt32BE(20)];
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i < b.length) {
      if (b[i] !== 0xff) { i += 1; continue; }
      const marker = b[i + 1];
      const len = b.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
      i += 2 + len;
    }
  }
  return null;
}
for (const p of pages) {
  const html = read(p).replace(/<script[\s\S]*?<\/script>/gi, "");
  for (const [tag] of html.matchAll(/<img\b[^>]*>/g)) {
    const src = (tag.match(/\bsrc="([^"]+)"/) || [])[1];
    if (!src || src.startsWith("data:")) continue;
    const w = Number((tag.match(/\bwidth="(\d+)"/) || [])[1]);
    const h = Number((tag.match(/\bheight="(\d+)"/) || [])[1]);
    if (!w || !h) { fail(`${p}: <img src="${src}"> has no width and height (the page shifts as it loads)`); continue; }
    if (/^(https?:)?\/\//.test(src)) continue; // a third-party image: sized, but its file is not ours to measure
    const file = join(ROOT, dirname(p), src);
    if (!existsSync(file)) continue; // the links check reports a missing file
    const real = imageSize(file);
    if (real && Math.abs(w / h - real[0] / real[1]) > 0.01) fail(`${p}: <img src="${src}"> is sized ${w}x${h} but the file is ${real[0]}x${real[1]} (wrong shape)`);
  }
}
{
  const door = read("hub/index.html");
  const firstCard = door.match(/<img\b[^>]*src="assets\/img\/print-hub\.jpg"[^>]*>/);
  if (firstCard && !/fetchpriority="high"/.test(firstCard[0])) fail('hub/index.html: the first hub card image should carry fetchpriority="high"');
  const thirdCard = door.match(/<img\b[^>]*src="assets\/img\/product-hub\.jpg"[^>]*>/);
  if (thirdCard && !/loading="lazy"/.test(thirdCard[0])) fail('hub/index.html: the third hub card sits below the first screen and should be lazy');
}

// ---------------------------------------------------------------- the hub stylesheet
for (const p of pages.filter((x) => x.startsWith("printhub/") || x.startsWith("millhub/"))) {
  const t = read(p);
  if (/insertAdjacentHTML\([^)]*portal\.css/.test(t)) fail(`${p}: the hub stylesheet is injected by a script (it should be a static link)`);
  const css = t.indexOf('<link rel="stylesheet" href="https://nexpoint.co.uk/hub/assets/portal.css">');
  const font = t.indexOf("https://fonts.googleapis.com/css2");
  if (css < 0) fail(`${p}: no static link to the hub stylesheet`);
  else if (font >= 0 && css > font) fail(`${p}: the hub stylesheet link should come before the font links`);
  if (!/window\.NP_APEX\s*=/.test(t)) fail(`${p}: window.NP_APEX is gone (portal.js needs it)`);
}

if (fails.length) {
  console.error(`sweep: ${fails.length} problem(s)`);
  for (const f of fails) console.error("  " + f);
  process.exit(1);
}
console.log(`sweep-ok (${pages.length} pages, ${wanted.length} icons in one subset)`);

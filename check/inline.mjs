// The scripts written inside the pages (audit of 11 November 2026, finding
// 10b-02). check:js runs `node --check` on every script that is a file. A
// script written between <script> tags is not a file, so nothing read it:
// about 750 lines in index.html and about 775 in opportunities/index.html
// could carry a slip through the check and break the enquiry form or the
// whole board on merge. This lifts each one out and runs the same check on it.
//
//   node check/inline.mjs                 every page of the site but admin/
//   node check/inline.mjs a.html b.html   those pages only
//
// admin/ is the engine's deploy copy and is checked where it is written.
// A script is padded with blank lines so that a fault is reported at its line
// in the page, not at its line in the script. Only syntax is checked: nothing
// is run, and an inline handler in an attribute (onclick="...") is not read.
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const SKIP = new Set(["admin", "node_modules", "dist", ".git", ".github"]);

function pages(dir = ROOT) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP.has(e.name)) out.push(...pages(join(dir, e.name))); }
    else if (e.name.endsWith(".html")) out.push(join(dir, e.name));
  }
  return out.sort();
}

/* Every inline script of a page, in order: { line, module, code }. Comments
   are stepped over, so a script tag written inside one is not read as code.
   A script with a src has no body of its own, and a type that is not
   JavaScript (JSON-LD, a template) is data. */
const JS_TYPES = new Set(["", "text/javascript", "application/javascript", "module"]);
export function inlineScripts(html) {
  const found = [];
  const lower = html.toLowerCase();
  let at = 0;
  while (at < html.length) {
    const comment = lower.indexOf("<!--", at);
    const open = lower.indexOf("<script", at);
    if (open < 0) break;
    if (comment >= 0 && comment < open) {
      const end = lower.indexOf("-->", comment + 4);
      if (end < 0) break;
      at = end + 3;
      continue;
    }
    const tagEnd = html.indexOf(">", open);
    if (tagEnd < 0) break;
    const close = lower.indexOf("</script", tagEnd);
    if (close < 0) break;
    const attrs = html.slice(open + 7, tagEnd);
    const type = ((attrs.match(/\btype\s*=\s*["']?([^"'\s>]*)/i) || [])[1] || "").toLowerCase();
    const code = html.slice(tagEnd + 1, close);
    if (!/\bsrc\s*=/i.test(attrs) && JS_TYPES.has(type) && code.trim()) {
      found.push({ line: html.slice(0, tagEnd + 1).split("\n").length, module: type === "module", code });
    }
    at = close + 9;
  }
  return found;
}

const asked = process.argv.slice(2).map((p) => resolve(p));
const files = asked.length ? asked : pages();
const scratch = mkdtempSync(join(tmpdir(), "np-inline-"));
const fails = [];
let count = 0, withScripts = 0;
try {
  for (const file of files) {
    const rel = relative(ROOT, file);
    const scripts = inlineScripts(readFileSync(file, "utf8"));
    if (scripts.length) withScripts++;
    scripts.forEach((s, i) => {
      count++;
      /* .cjs is read as a classic script and .mjs as a module, whatever the
         folder around them says. */
      const tmp = join(scratch, `${rel.replace(/[^\w.-]+/g, "_")}.${i}.${s.module ? "mjs" : "cjs"}`);
      writeFileSync(tmp, "\n".repeat(s.line - 1) + s.code);
      const r = spawnSync(process.execPath, ["--check", tmp], { encoding: "utf8" });
      if (r.status !== 0) {
        /* Node names the file and line first and the fault further down; the
           padding makes that line the page's own. */
        const said = String(r.stderr || r.stdout || "");
        const where = (said.match(/:(\d+)\s*$/m) || [])[1];
        const what = (said.match(/^\w*Error: .*$/m) || ["does not parse"])[0];
        fails.push(`${rel}${where ? ":" + where : ""}: ${what} (the inline script that starts at line ${s.line})`);
      }
    });
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

/* The two pages the finding named must still be read: a page that loses its
   inline script altogether, or a reader that stops finding it, is a failure
   here and not a quiet pass. */
if (!asked.length) {
  for (const must of ["index.html", "opportunities/index.html"]) {
    let n = 0;
    try { n = inlineScripts(readFileSync(join(ROOT, must), "utf8")).length; } catch (e) { n = 0; }
    if (!n) fails.push(`${must}: no inline script was found to check (the page or this reader has changed)`);
  }
}

if (fails.length) {
  console.error(`inline: ${fails.length} problem(s)`);
  for (const f of fails) console.error("  " + f);
  process.exit(1);
}
console.log(`inline-ok (${count} scripts in ${withScripts} pages)`);

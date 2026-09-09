// Internal link checker: every relative href/src in every HTML page must
// resolve to a file on disk. External URLs, anchors, mailto/tel and
// protocol-relative links are out of scope. Fails listing each miss.
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve, sep } from "node:path";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const SKIP = new Set([".git", ".worktrees", "node_modules", ".claude", ".superpowers", ".impeccable"]);

function* htmlFiles(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* htmlFiles(p);
    else if (name.endsWith(".html")) yield p;
  }
}

const ATTR = /(?:href|src)\s*=\s*"([^"]+)"/g;
const misses = [];
for (const file of htmlFiles(ROOT)) {
  // Static markup only: JS-built URLs and template literals inside
  // <script> blocks are not checkable from disk.
  const html = readFileSync(file, "utf8").replace(/<script[\s\S]*?<\/script>/gi, "");
  for (const [, raw] of html.matchAll(ATTR)) {
    if (/^(https?:)?\/\//i.test(raw)) continue;          // external / protocol-relative
    if (/^(#|mailto:|tel:|javascript:|data:)/i.test(raw)) continue;
    let path = raw.split("#")[0].split("?")[0];
    if (!path) continue;                                   // pure fragment
    let target = path.startsWith("/")
      ? join(ROOT, path)
      : join(dirname(file), path);
    if (path.endsWith("/")) target = join(target, "index.html");
    if (!existsSync(target)) {
      // a folder link without trailing slash still serves index.html on Pages
      if (existsSync(join(target, "index.html"))) continue;
      misses.push(`${file.slice(ROOT.length + 1)} -> ${raw}`);
    }
  }
}

if (misses.length) {
  console.error(`BROKEN INTERNAL LINKS (${misses.length}):`);
  for (const m of misses) console.error("  " + m);
  process.exit(1);
}
console.log("links-ok");

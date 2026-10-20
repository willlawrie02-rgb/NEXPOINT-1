// The build (plan 053): what Cloudflare Pages publishes. Every tracked file
// goes into a fresh dist/, minus the denylist below, so a new page folder is
// published by default, as it was on GitHub Pages. dist/build.txt names the
// commit and the build time, so `curl https://nexpoint.co.uk/build.txt`
// answers "is my merge live?". Plain Node, no dependencies: the Pages build
// needs no `npm ci`.
//
//   npm run build
//
// A file that must never be published joins DENY (a file) or DENY_DIRS (a
// folder) here.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const OUT = join(ROOT, "dist");
const DENY_DIRS = [".github/", "check/"];
const DENY = new Set(["package.json", "package-lock.json", "CLAUDE.md", ".htmlvalidate.json",
  ".gitignore", ".nojekyll", "CNAME"]);
// Cloudflare Pages' limits are 25 MiB a file and 20,000 files a deploy.
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 19000;

const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const fail = (msg) => { console.error(`build: ${msg}`); process.exit(1); };

// Without a git repository (a Vercel preview builds from the files alone),
// the checkout is walked instead, leaving out what .gitignore keeps out of git.
const UNTRACKED = new Set([".git", "node_modules", "dist", ".claude", ".worktrees", ".superpowers", ".vscode", ".idea", ".DS_Store"]);
function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (UNTRACKED.has(name) || name.endsWith(".log")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield relative(ROOT, p).split("\\").join("/");
  }
}
let listed;
let source = "git ls-files";
try { listed = git("ls-files", "-z").split("\0").filter(Boolean); }
catch { listed = [...walk(ROOT)]; source = "the checkout (no git repository)"; }
const files = listed.filter((f) => !DENY.has(f) && !DENY_DIRS.some((d) => f.startsWith(d)));
if (files.length > MAX_FILES) fail(`${files.length} files, over the ${MAX_FILES} limit`);

rmSync(OUT, { recursive: true, force: true });
let largest = { file: "", size: 0 };
const gone = [];
for (const f of files) {
  const src = join(ROOT, f);
  if (!existsSync(src)) { gone.push(f); continue; }
  const { size } = statSync(src);
  if (size > MAX_BYTES) fail(`${f} is ${(size / 1048576).toFixed(1)} MiB, over Cloudflare Pages' 25 MiB a file`);
  if (size > largest.size) largest = { file: f, size };
  mkdirSync(dirname(join(OUT, f)), { recursive: true });
  copyFileSync(src, join(OUT, f));
}
if (gone.length) fail(`tracked but missing from the checkout: ${gone.slice(0, 5).join(", ")}`);

let commit = process.env.CF_PAGES_COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA;
if (!commit) { try { commit = git("rev-parse", "HEAD").trim(); } catch { commit = "unknown"; } }
writeFileSync(join(OUT, "build.txt"), `${commit}\n${new Date().toISOString()}\n`);

console.log(`build: ${files.length} files from ${source} and build.txt in dist/ (commit ${commit.slice(0, 7)}); ` +
  `largest ${largest.file} at ${(largest.size / 1048576).toFixed(1)} MiB`);

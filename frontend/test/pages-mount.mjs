/** Every tab in the header must have a page mounted behind it.
 *
 *  Run: node test/pages-mount.mjs
 *
 *  This exists because adding the Coverage tab rendered a blank window. The
 *  tab, the route, the path map and the render switch were all updated; the
 *  hand-written list of pages to mount was not. Switching to it hid every
 *  other page and rendered nothing in their place -- no error, no empty state,
 *  just a blank window, which is the hardest kind of bug to read.
 *
 *  The list is now derived from TABS, so the two cannot drift. This checks
 *  that it stayed derived, and that every tab still reaches a branch of the
 *  render switch.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "App.tsx"), "utf8");

const tabs = [...src.matchAll(/\{\s*value:\s*"([a-z-]+)"/g)].map((m) => m[1]);
let failed = 0;

function check(name, ok, detail) {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}: ${detail}`);
  }
}

check("tabs were found", tabs.length > 0, "no TABS entries parsed -- this check has gone stale");

check(
  "the mounted list is derived from TABS",
  /const MOUNTED:\s*Page\[\]\s*=\s*\[\s*\.\.\.TABS\.map/.test(src),
  "MOUNTED is no longer built from TABS, so a new tab can render a blank page again",
);

check(
  "no second hand-written page list",
  !/\[\s*(?:"[a-z-]+"\s*,\s*){5,}"landing"\s*\]\s*as\s*Page\[\]/.test(src),
  "a hard-coded page array is back; it is the thing that drifted",
);

// Every tab must reach a branch of the render switch, or it mounts and shows
// nothing -- the same blank window by a different route. One tab is the
// chain's final else rather than a test of its own, so it is named here
// instead of being excused by a looser pattern.
const FALLBACK = "ask";
const missing = tabs.filter(
  (t) => t !== FALLBACK && !new RegExp(`p === "${t}"`).test(src),
);
check(
  "every tab has a branch in the render switch",
  missing.length === 0,
  `no branch renders: ${missing.join(", ")}`,
);

check(
  `the fallback branch still renders the "${FALLBACK}" page`,
  /\)\s*:\s*\(\s*<AskPage/.test(src),
  `"${FALLBACK}" has no branch of its own and the final else no longer renders it, `
    + "so it would mount blank",
);

// And a path, or the URL will not survive a reload.
const noPath = tabs.filter((t) => !new RegExp(`(^|\\s|")${t}"?\\s*:\\s*"/`, "m").test(src));
check(
  "every tab has an entry in PATHS",
  noPath.length === 0,
  `no path for: ${noPath.join(", ")}`,
);

console.log(`\n${tabs.length} tabs: ${tabs.join(", ")}`);
console.log(failed ? `${failed} check(s) failed` : "all checks passed");
process.exit(failed ? 1 : 0);

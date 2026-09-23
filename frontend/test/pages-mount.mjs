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

// --- the browser tab title ------------------------------------------------
//
// Same failure as MOUNTED, in a different costume. document.title used to be a
// twelve-branch ternary written out per page, parallel to TABS. The product
// was renamed to Spark AI Spine and ten of the twelve branches kept saying
// "Docling"; the tab bar read "Ask RAG" while the title it was meant to match
// read "Ask"; and a page added without a branch fell through to the else and
// was titled "Docling Convert Studio". None of that raises an error -- the tab
// just says the wrong thing, which is the kind of wrong nobody files.

check(
  "the page title is derived from TABS",
  /TABS\.find\(\(t\) => t\.value === page\)\?\.label/.test(src) &&
    /document\.title = label/.test(src),
  "document.title is written out per page again, so it can drift from the tab bar",
);

const product = src.match(/const PRODUCT = "([^"]+)"/);
check("the product is named once, in PRODUCT", Boolean(product),
      "no PRODUCT constant -- the name is spelled inline and will drift");

if (product) {
  // Every title the app can produce, evaluated the way the effect evaluates it.
  const labels = new Map(
    [...src.matchAll(/\{\s*value:\s*"([a-z-]+)",\s*label:\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]),
  );
  const titles = [...tabs, "landing"].map((p) =>
    labels.has(p)
      ? `${product[1]} — ${labels.get(p)}`
      : `${product[1]} — Enterprise Document Intelligence`,
  );
  const stale = titles.filter((t) => /docling/i.test(t));
  check(
    `no page is titled after the old product name (${titles.length} pages checked)`,
    stale.length === 0,
    `still titled Docling: ${stale.join(", ")}`,
  );
}

console.log(`\n${tabs.length} tabs: ${tabs.join(", ")}`);
console.log(failed ? `${failed} check(s) failed` : "all checks passed");
process.exit(failed ? 1 : 0);

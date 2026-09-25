/** The four history panels are one panel.
 *
 *  Run: node test/run-history.mjs
 *
 *  Ask RAG had a right-side drawer; the Evidence Agent, the Fit-Gap Copilot
 *  and InsightLens each had a <Menu> written out separately, and the three had
 *  drifted -- one showed relative time and two showed a sliced ISO string, one
 *  armed its delete and one deleted on the first press, none could be
 *  filtered. Selecting a run in any of them replaced the page you were
 *  reading, because loading a run overwrites ten to eighteen pieces of state.
 *
 *  They share RunHistoryDrawer now. This checks the sharing holds: that no
 *  page has grown its own history panel again, that each one still passes the
 *  parts only it can know, and that selecting a run opens it in the drawer
 *  rather than loading it into the page behind.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
let failed = 0;
const check = (name, ok, detail) => {
  if (ok) console.log(`  ok   ${name}`);
  else { failed++; console.log(`  FAIL ${name}: ${detail}`); }
};

const read = (p) => readFileSync(join(SRC, p), "utf8");

/** Just the <RunHistoryDrawer …/> element from a page.
 *
 *  Checks below must run against this, not the whole file. FitGapPage has an
 *  attachment list with its own `onDelete=`, and a whole-file test for "this
 *  page passes no onDelete" matched it and failed on a page that was correct.
 *  Same shape of mistake as matching `stopPropagation` anywhere in a file. */
function element(src) {
  const at = src.indexOf("<RunHistoryDrawer");
  if (at < 0) return "";
  const end = src.indexOf("\n        />", at);
  const end2 = src.indexOf("\n            />", at);
  const stop = Math.min(...[end, end2].filter((n) => n > 0));
  return src.slice(at, stop > 0 ? stop : src.length);
}
const drawer = read("components/RunHistoryDrawer.tsx");

// The three that were menus, and what each must still pass in.
const PAGES = [
  { file: "pages/EvidencePage.tsx", title: "Past investigations", detail: "PastInvestigation",
    fetch: "evidence.run", load: "open", noun: '["investigation", "investigations"]' },
  { file: "pages/RolloutPage.tsx", title: "Past runs", detail: "PastAnalysis",
    fetch: "rollout.run", load: "loadRun", noun: '["run", "runs"]' },
  { file: "pages/FitGapPage.tsx", title: "Previous runs", detail: "PastRegister",
    fetch: "fitgap.run", load: "loadRun", noun: '["run", "runs"]' },
];

for (const page of PAGES) {
  const src = read(page.file);
  const name = page.file.replace("pages/", "");
  const el = element(src);
  check(`${name} has a <RunHistoryDrawer> element to check`, el.length > 0,
        "nothing parsed -- these checks have gone stale");

  check(`${name} uses the shared drawer`,
        /import RunHistoryDrawer, \{[^}]*\} from "\.\.\/components\/RunHistoryDrawer"/.test(src)
          && src.includes("<RunHistoryDrawer"),
        "this page has its own history panel again");

  // The bug this replaced: a <Menu> anchored to the history button.
  check(`${name} no longer anchors a history menu`,
        !/historyAnchor/.test(src),
        "historyAnchor is back -- the dropdown was the thing that had drifted three ways");

  check(`${name} renders its own detail (${page.detail})`,
        new RegExp(`renderDetail=\\{\\(run\\) => <${page.detail} run=\\{run\\}[^>]*/>\\}`).test(el),
        `no ${page.detail} passed as renderDetail`);

  check(`${name} fetches one run with ${page.fetch}`,
        el.includes(`fetchDetail={${page.fetch}}`),
        `fetchDetail is not ${page.fetch}`);

  // The whole point: the card opens the run HERE. If a page wired
  // onLoadIntoPage to the card click instead, the drawer would be a
  // differently-shaped menu.
  check(`${name} loads into the page only from the footer button`,
        new RegExp(`onLoadIntoPage=\\{(?:\\(id\\) => void )?${page.load}`).test(el),
        `onLoadIntoPage is not wired to ${page.load}`);

  check(`${name} names the panel "${page.title}"`,
        el.includes(`title="${page.title}"`),
        "the header title changed; the three panels are meant to read alike but not identically");

  check(`${name} passes its noun as ${page.noun}`,
        el.includes(`noun={${page.noun}}`),
        "the drawer counts items with this, so an empty or wrong noun reads as a bug");
}

// --- what only the shared component can guarantee ----------------------------

// The feature itself. A card that called onLoadIntoPage would make this a
// menu with a filter box: the page behind would still be replaced, which is
// the thing that was wrong. Selecting shows the run HERE; only the footer
// button loads it. A structural test that stops at "the drawer is imported"
// does not notice this being swapped back, so it is checked on its own.
{
  const from = drawer.indexOf("{shown.map((r) => (");
  const to = drawer.indexOf("{/* ---------- one run");
  const card = from > 0 && to > from ? drawer.slice(from, to) : "";
  check("the list card parsed", card.length > 0, "this check has gone stale");
  check("selecting a run opens it in the drawer",
        /onClick=\{\(\) => show\(r\.id\)\}/.test(card),
        "the card no longer calls show(), so it is not opening the detail pane");
  check("selecting a run does not load it into the page",
        !/onLoadIntoPage/.test(card),
        "the card loads the run into the page -- that is the behaviour this replaced");

  const footer = to > 0 ? drawer.slice(to) : "";
  check("the footer button is the only way to load into the page",
        (footer.match(/onLoadIntoPage\(/g) ?? []).length === 1,
        "onLoadIntoPage is called from more than one place in the detail pane");
}

check("the drawer opens on the list, not on whatever was last read",
      /if \(!open\) \{[\s\S]{0,200}setOpenId\(null\)/.test(drawer),
      "closing the drawer no longer resets it to the list");

check("the list can be filtered",
      /const needle = search\.trim\(\)\.toLowerCase\(\)/.test(drawer)
        && /items\.filter\(/.test(drawer),
      "the filter box is gone -- that was one of the three things the menus could not do");

check("a two-press delete is available to a page that asks for it",
      /armDelete && armed !== id/.test(drawer),
      "armDelete no longer arms, so the Fit-Gap Copilot's decisions are one stray click from gone");

// InsightLens has no DELETE endpoint. A trash icon that throws is worse than none.
check("delete is optional, and InsightLens does not offer it",
      /onDelete\?: \(id: string\) => void \| Promise<void>/.test(drawer)
        && /\{onDelete && \(/.test(drawer)
        && !/onDelete=/.test(element(read("pages/FitGapPage.tsx"))),
      "InsightLens shows a delete button, but /api/fitgap/runs has no DELETE");

const rollout = read("pages/RolloutPage.tsx");
check("the Fit-Gap Copilot asks for the two-press delete",
      /armDelete\b/.test(element(rollout)),
      "an analysis carries decisions recorded against it; one click must not be enough");

// --- one relative-time helper, not three -------------------------------------
//
// AskHistoryDrawer and EvidencePage each held their own copy of when(). They
// had not drifted yet, which is the only reason this is a check and not a bug.
for (const f of ["components/AskHistoryDrawer.tsx", ...PAGES.map((p) => p.file)]) {
  check(`${f.split("/").pop()} has no private copy of when()`,
        !/function when\(iso/.test(read(f)),
        "relative time is exported from RunHistoryDrawer");
}

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);

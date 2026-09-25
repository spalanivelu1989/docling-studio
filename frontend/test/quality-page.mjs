/** The Answer Quality workspace has to agree with the arithmetic behind it.
 *
 *  Run: node test/quality-page.mjs
 *
 *  quality.py decides; the page draws. Several lists exist on both sides,
 *  and nothing at runtime notices when one side changes and the other does
 *  not. Each of these fails silently in the browser:
 *
 *  1. A failure type added to quality.FAILURES and not to the page: its chip
 *     has no colour, and opening its answers lands on the wrong metric.
 *  2. The score bands (0.7 / 0.4) drifting between the three places that
 *     colour a score: the same 0.65 would be green on one screen and amber on
 *     the next.
 *  3. A review verdict the page offers and the server refuses, or the reverse.
 *  4. A call in api.ts to a /api/quality endpoint app.py does not serve.
 *  5. The page telling people to run a command evaluation.py does not have.
 *  6. The experiment table colouring a move the server calls unchanged.
 *  7. A tab with no route, which renders a blank window on reload.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(here, "..", ...p), "utf8");
const repo = (...p) => readFileSync(join(here, "..", "..", ...p), "utf8");

const q = (f) => read("src", "components", "quality", f);
const charts = q("charts.tsx");
const explorerView = q("ExplorerView.tsx");
const experimentsView = q("ExperimentsView.tsx");
const judgeView = q("JudgeView.tsx");
const parts = q("parts.tsx");
const page = read("src", "pages", "QualityPage.tsx");
const appTsx = read("src", "App.tsx");
const api = read("src", "api.ts");
const scorecard = read("src", "components", "QualityScorecard.tsx");
const drawer = read("src", "components", "MetricDetailDrawer.tsx");
const qualityPy = repo("quality.py");
const storePy = repo("ask_store.py");
const appPy = repo("app.py");
const evaluationPy = repo("evaluation.py");

let failed = 0;
function check(name, ok, detail) {
  if (ok) console.log(`  ok   ${name}`);
  else { failed++; console.log(`  FAIL ${name}: ${detail}`); }
}
const same = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

// --- 1. failure types ---------------------------------------------------------

const pyFailures = [...qualityPy.matchAll(/\{"key": "(\w+)", "label":/g)].map((m) => m[1]);
const tsFailures = [...(/key: ("[\w"| ]+");\s*\n\s*label: string;\s*\n\s*rule/.exec(api)?.[1] ?? "")
  .matchAll(/"(\w+)"/g)].map((m) => m[1]);
const focus = [...(/export const FOCUS[^{]+\{([\s\S]*?)\};/.exec(explorerView)?.[1] ?? "")
  .matchAll(/^\s+(\w+):/gm)].map((m) => m[1]);
const coloured = [...(/export function failureColour[\s\S]*?\n\}/.exec(charts)?.[0] ?? "")
  .matchAll(/case "(\w+)"/g)].map((m) => m[1]);

check("quality.py declares the six failure types", pyFailures.length === 6, `parsed [${pyFailures}]`);
check("api.ts types the same failure keys", same(pyFailures, tsFailures),
  `quality.py [${pyFailures}] vs api.ts [${tsFailures}]`);
check("every failure type opens on a metric", same(pyFailures, focus),
  `FOCUS in ExplorerView.tsx has [${focus}]`);
check("every failure type has a colour", same(pyFailures, coloured),
  `failureColour in charts.tsx handles [${coloured}]`);

// --- 2. the score bands -------------------------------------------------------

const bands = (src) => {
  const m = /(?:value|v) >= (0\.\d+) \? theme\.palette\.success\.main\s*\n?\s*: (?:value|v) >= (0\.\d+) \? theme\.palette\.warning\.main/.exec(src);
  return m ? `${m[1]}/${m[2]}` : null;
};
const b = { charts: bands(charts), scorecard: bands(scorecard), drawer: bands(drawer) };
check("the three score-colouring functions were found", Object.values(b).every(Boolean),
  JSON.stringify(b));
check("all three colour a score with the same bands",
  new Set(Object.values(b)).size === 1, JSON.stringify(b));

// --- 3. review verdicts -------------------------------------------------------

const pyVerdicts = [...(/VERDICTS = \(([^)]*)\)/.exec(storePy)?.[1] ?? "").matchAll(/"(\w+)"/g)].map((m) => m[1]);
const uiVerdicts = [...(/const VERDICT_LABEL = \{([^}]*)\}/.exec(parts)?.[1] ?? "").matchAll(/(\w+):/g)].map((m) => m[1]);
const apiVerdicts = [...(/review: \(runId: string, verdict: ([^,]+),/.exec(api)?.[1] ?? "").matchAll(/"(\w+)"/g)].map((m) => m[1]);
check("the review buttons offer exactly the verdicts the server accepts",
  pyVerdicts.length === 3 && same(pyVerdicts, uiVerdicts) && same(pyVerdicts, apiVerdicts),
  `ask_store [${pyVerdicts}] · ReviewBar [${uiVerdicts}] · api.ts [${apiVerdicts}]`);
check("quality.py buckets the judge into the same three verdicts",
  same(pyVerdicts, [...(/BUCKETS = \(([^)]*)\)/.exec(qualityPy)?.[1] ?? "").matchAll(/"(\w+)"/g)].map((m) => m[1])),
  "the agreement matrix's columns would not line up with the reviewers' verdicts");

// --- 4. endpoints -------------------------------------------------------------

const called = [...new Set([...api.matchAll(/`\/api\/quality\/([a-z]+)/g)].map((m) => m[1]))];
for (const path of called) {
  check(`app.py serves /api/quality/${path}`,
    new RegExp(`@app\\.(get|post|delete)\\("/api/quality/${path}`).test(appPy),
    "api.ts calls an endpoint that returns 404");
}
check("app.py serves the review endpoint",
  /@app\.post\("\/api\/ask\/runs\/\{run_id\}\/review"\)/.test(appPy) && /\/review`/.test(api),
  "the verdict buttons would post to nothing");

// --- 5. what the page tells people to run exists ------------------------------

for (const [file, src] of [["JudgeView.tsx", judgeView], ["ExperimentsView.tsx", experimentsView]]) {
  for (const m of src.matchAll(/python evaluation\.py (\w+)/g)) {
    check(`${file}: "evaluation.py ${m[1]}" is a real command`,
      new RegExp(`add_parser\\("${m[1]}"`).test(evaluationPy),
      "the page sends people to a command that does not exist");
  }
}

// --- 6. the experiment table and the server agree on noise --------------------

const noise = /^NOISE = (0\.\d+)/m.exec(qualityPy)?.[1];
const cellLine = /value >= (0\.\d+) \? theme\.palette\.success\.main : value <= -(0\.\d+)/.exec(experimentsView);
check("a delta the server calls unchanged is not coloured as a change",
  noise && cellLine && cellLine[1] === noise && cellLine[2] === noise,
  `NOISE ${noise} vs DeltaCell ${cellLine?.slice(1)}`);

// --- 7. the page is reachable -------------------------------------------------

check("RAG Metrics is a tab", /\{ value: "quality", label: "RAG Metrics"/.test(appTsx), "no TABS entry");
check("the tab has a path", /quality: "\/quality"/.test(appTsx), "PATHS has no quality entry");
check("the path resolves back to the tab", /startsWith\("\/quality"\)\) return "quality"/.test(appTsx),
  "reloading /quality lands on the landing page");
check("the render switch mounts the page", /p === "quality" \? \(\s*<QualityPage/.test(appTsx),
  "the tab would switch to a blank page");
check("the server answers /quality", /@app\.get\("\/quality", response_class=HTMLResponse\)/.test(appPy),
  "a reload of /quality would be a 404");

// --- honesty ------------------------------------------------------------------

check("every view says so until the judge has been checked against people",
  /\{!checked && <TrustNote/.test(page), "the page presents unchecked scores as settled");
const minReviews = /^MIN_REVIEWS = (\d+)/m.exec(qualityPy)?.[1];
check("the page's fallback review threshold matches quality.py",
  new RegExp(`min_reviews \\?\\? ${minReviews}`).test(page),
  `quality.MIN_REVIEWS is ${minReviews}`);
check("the quadrant draws the line the server reports, not its own",
  /<Quadrant points=\{data\.points\} line=\{data\.line\}/.test(explorerView)
  && !/line=\{0\.7\}/.test(explorerView),
  "a hard-coded threshold would drift from ASK_LOW_QUALITY");

// --- the theme ----------------------------------------------------------------

const quiet = readdirSync(join(here, "..", "src", "components", "quality")).map((f) => [f, q(f)]);
quiet.push(["QualityPage.tsx", page]);
for (const [file, src] of quiet) {
  const hex = /["'`]#[0-9a-fA-F]{3,8}\b/.exec(src);
  check(`${file} writes no colour of its own`, !hex, `found ${hex?.[0]}`);
}

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);

/** The quality scorecard has to agree with the judge that fills it.
 *
 *  Run: node test/rag-quality.mjs
 *
 *  Four files have to say the same thing about one set of metric names --
 *  evaluation.py emits them, ask_store.py filters on them, api.ts types them
 *  and QualityScorecard.tsx draws them -- and nothing at runtime notices when
 *  one of them drifts. A tile for a metric the backend never produces renders
 *  forever empty; a metric the backend emits and the page does not list is
 *  simply invisible. Both look like the feature working.
 *
 *  What this catches, all silent in the browser:
 *
 *  1. A metric added to WEIGHTS and not to the page, or the reverse.
 *  2. A quality filter offered by the drawer that the store cannot answer.
 *  3. The scorecard rendering a missing score as 0.00. A judge that timed out
 *     and an answer that deserved nothing are opposite facts, and the whole
 *     panel is built on keeping them apart.
 *  4. A poll with no terminal condition -- the one that keeps asking a
 *     finished evaluation how it is getting on for as long as the tab is open.
 *  5. The reference-only metrics quietly entering the overall score, which
 *     would make a run scored with a reference incomparable with one scored
 *     without and nobody would see it happen.
 *  6. A hardcoded colour in the scorecard. The dark theme is Catppuccin
 *     Frappe and every score widget in the app reads its bands off the
 *     palette; one that does not will look right in light mode only.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(here, "..", ...p), "utf8");
const repo = (...p) => readFileSync(join(here, "..", "..", ...p), "utf8");

const card = read("src", "components", "QualityScorecard.tsx");
const drawer = read("src", "components", "AskHistoryDrawer.tsx");
const page = read("src", "pages", "AskPage.tsx");
const api = read("src", "api.ts");
const evaluation = repo("evaluation.py");
const store = repo("ask_store.py");
const app = repo("app.py");
const rag = repo("rag.py");

let failed = 0;
function check(name, ok, detail) {
  if (ok) console.log(`  ok   ${name}`);
  else { failed++; console.log(`  FAIL ${name}: ${detail}`); }
}

/** The value of a module-level tuple or dict literal, as text.
 *
 *  Single-line first. A greedy multi-line match run against
 *  `REFERENCE_ONLY = ("a", "b")` sails past the closing bracket to the next
 *  one at the start of a line and swallows two unrelated tables -- which it
 *  did, and which made this file pass while claiming coherence was a
 *  reference-only metric. */
function pyBlock(src, name) {
  const line = new RegExp(`^${name}[^=\\n]*= [\\(\\{](.*)[\\)\\}]\\s*$`, "m").exec(src);
  if (line) return line[1];
  const block = new RegExp(`^${name}[^=\\n]*= [\\(\\{]([\\s\\S]*?)^[\\)\\}]`, "m").exec(src);
  return block ? block[1] : "";
}
const pyNames = (src, name) =>
  [...pyBlock(src, name).matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);

// --- the metric names agree across all four files -----------------------------

const weighted = pyNames(evaluation, "WEIGHTS");
const referenceOnly = pyNames(evaluation, "REFERENCE_ONLY");
const safety = pyNames(evaluation, "SAFETY");

check(
  "evaluation.py declares the metrics this test expects to find",
  weighted.length >= 5 && referenceOnly.length === 2 && safety.length >= 2,
  `parsed WEIGHTS=[${weighted}] REFERENCE_ONLY=[${referenceOnly}] SAFETY=[${safety}]`,
);

const titles = [...card.matchAll(/^  ([a-z_]+): "/gm)].map((m) => m[1]);
const explains = [...card.matchAll(/^  ([a-z_]+):(?:\s*$|\s*")/gm)].map((m) => m[1]);

for (const name of [...weighted, ...referenceOnly]) {
  check(
    `the scorecard has a title for ${name}`,
    titles.includes(name),
    `TITLES in QualityScorecard.tsx has [${titles.join(", ")}]`,
  );
}
for (const name of [...weighted, ...referenceOnly, ...safety]) {
  check(
    `the scorecard explains ${name} on hover`,
    explains.includes(name),
    "a tile with no explanation is a number nobody can act on",
  );
}

// The page's fallback list, used when /api/rag/status has not arrived yet.
const fallback = /const online = status\?\.online\?\.length[\s\S]*?\[([\s\S]*?)\];/.exec(card);
const fallbackNames = fallback ? [...fallback[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]) : [];
check(
  "the scorecard's fallback tile list is exactly the weighted metrics",
  fallbackNames.length === weighted.length && weighted.every((n) => fallbackNames.includes(n)),
  `fallback=[${fallbackNames}] weighted=[${weighted}]`,
);

// --- reference-only metrics stay out of the overall score ---------------------

check(
  "the overall score is computed over WEIGHTS only",
  /for name, weight in WEIGHTS\.items\(\):/.test(evaluation),
  "if overall() iterated the metrics it was given instead, a run scored with a "
  + "reference would not be comparable with one scored without",
);
check(
  "no reference-only metric is weighted",
  referenceOnly.every((n) => !weighted.includes(n)),
  `${referenceOnly.filter((n) => weighted.includes(n))} is both`,
);
check(
  "the reference-only judges are only built when a reference exists",
  /if reference:\n\s+jobs \+= \[/.test(evaluation),
  "they would otherwise be scored against an empty string and return a number",
);

// --- a missing score is never drawn as zero -----------------------------------

check(
  "a null score renders as an em-dash, not 0.00",
  /\{value === null \? "—" : value\.toFixed\(2\)\}/.test(card),
  "a judge that did not return would read as an answer that deserved nothing",
);
check(
  "a null score draws no progress bar",
  /\{value === null \? \([\s\S]{0,400}?Not assessable/.test(card),
  "an empty bar reads as a bar at zero",
);
check(
  "the history badge stays silent for an unscored run",
  /if \(run\.eval_status !== "done" \|\| run\.overall === null \|\| run\.overall === undefined\) return null;/.test(drawer),
  "an unscored question would carry a badge that reads as a score",
);

// --- the panel can explain its own absence ------------------------------------

check(
  "the server says why scoring is unavailable",
  /info\["evaluation"\] = evaluation_status\(\)/.test(app) && /"detail": why/.test(evaluation),
  "the page could only show an empty panel and let the reader guess",
);
check(
  "the scorecard reads that reason rather than rendering nothing",
  /if \(status && !status\.available && state === "none"\)/.test(card),
  "an unavailable judge and an unscored answer would look identical",
);
check(
  "a skipped evaluation is distinguished from a failed one",
  /state === "skipped"/.test(card) && /"status": "skipped"/.test(app),
  "'we chose not to score this' and 'scoring broke' must not look the same",
);

// --- the poll terminates ------------------------------------------------------

check(
  "the page polls only while the evaluation is running",
  /if \(!runId \|\| evaluation\?\.status !== "running"\) return;/.test(page),
  "the effect would poll a finished evaluation forever",
);
check(
  "the poll reschedules itself only on a running status",
  /if \(got\.status === "running"\) timer = setTimeout\(poll, \d+\);/.test(page),
  "a terminal status would keep the timer alive",
);
check(
  "the poll is cancelled on unmount",
  /return \(\) => \{\s*\n\s*stopped = true;\s*\n\s*clearTimeout\(timer\);/.test(page),
  "leaving the page mid-evaluation would keep fetching",
);

// --- the filters agree with the store -----------------------------------------

const storeFilters = [...pyBlock(store, "QUALITY_FILTERS").matchAll(/^\s{4}"([a-z]+)":/gm)]
  .map((m) => m[1]);
const offered = [...drawer.matchAll(/\{ key: "([a-z]*)", label:/g)].map((m) => m[1]);

check(
  "ask_store declares the four segments",
  storeFilters.length === 4,
  `parsed [${storeFilters}]`,
);
check(
  "every segment the drawer offers, the store can answer",
  offered.filter((k) => k).every((k) => storeFilters.includes(k)),
  `drawer offers [${offered.filter(Boolean)}], store answers [${storeFilters}]`,
);
check(
  "the drawer offers an 'all' segment with an empty key",
  offered.includes(""),
  "with no way back to the unfiltered list, a filter is a trap",
);
check(
  "the type admits exactly those values",
  storeFilters.every((k) => new RegExp(`"${k}"`).test(
    /export type QualityFilter =([^;]+);/.exec(api)?.[1] ?? "")),
  "the page could ask for a filter the type forbids, or vice versa",
);
check(
  "the unscored filter reaches runs with no evaluation row at all",
  /"unscored": "e\.run_id IS NULL/.test(store),
  "a question that was never judged has no row to match on",
);
check(
  "an unknown filter is ignored rather than rejected",
  /if quality in QUALITY_FILTERS:/.test(store),
  "a browser holding a stale filter would get a 500 instead of the list",
);

// --- the trace is carried end to end ------------------------------------------

check(
  "rag.py hands out the trace id before any work",
  /yield "trace", \{"id": run\.trace_id, "url": run\.url\(\)\}/.test(rag),
  "without it a stored run and its Langfuse trace cannot be connected",
);
check(
  "app.py writes it down",
  /_try\(ask_store\.save_trace, conn, run_id, data\["id"\]\)/.test(app),
  "the score would have no trace to attach to",
);
check(
  "api.ts types the trace event as optional",
  /trace\?: \(t: \{ id: string; url: string \}\) => void;/.test(api),
  "a required handler would break every existing caller of ask()",
);
// The page used to offer a link from the answer to its Langfuse trace. It was
// taken out on request (2026-09-25): the audience for this page is a client,
// not the team debugging it. The trace is still recorded -- the scores above
// need it -- so the link can come back without touching the backend.
check(
  "the page no longer links to the trace",
  !/setTraceUrl|traceUrl=\{traceUrl\}|Open trace/.test(page),
  "a trace link is back on the Ask page, which was removed on purpose",
);

// --- the arithmetic is shown, not just the total ------------------------------

check(
  "the overall score carries its weights in a tooltip",
  /A weighted mean of the judges that returned:/.test(card)
  && /terms\?\.weights \|\| \{\}/.test(card),
  "a headline figure that cannot be taken apart is one nobody will trust twice",
);
check(
  "the tooltip names the judges that were dropped",
  /terms\?\.dropped\?\.length/.test(card),
  "a score over four judges and a score over seven would look identical",
);
check(
  "the tooltip says when a safety flag capped the total",
  /terms\?\.capped/.test(card) && /Capped at \{terms\.cap/.test(card),
  "a capped score reads as a measurement unless it says otherwise",
);

// --- the metric drawer --------------------------------------------------------

const detail = read("src", "components", "MetricDetailDrawer.tsx");

// Every shape evaluation.py can emit, the drawer must draw. A kind it does not
// know renders as nothing, which looks exactly like a metric with no working.
const kinds = [...evaluation.matchAll(/return \{"kind": "(\w+)", "items"/g)].map((m) => m[1]);
check(
  "evaluation.py emits the four working shapes",
  kinds.length === 4,
  `parsed [${kinds}]`,
);
for (const kind of kinds) {
  check(
    `the drawer draws the ${kind} shape`,
    new RegExp(`kind === "${kind}"`).test(detail),
    "an unhandled shape renders as nothing, which looks like a metric with no working",
  );
}

for (const name of [...weighted, ...referenceOnly, ...safety]) {
  check(
    `the drawer says how ${name} is measured`,
    new RegExp(`^  ${name}:`, "m").test(detail),
    "METHOD in MetricDetailDrawer.tsx has no entry, so the panel is blank",
  );
}

check(
  "the tiles are clickable and reachable from the keyboard",
  /role=\{onOpen \? "button" : undefined\}/.test(card)
  && /tabIndex=\{onOpen \? 0 : undefined\}/.test(card)
  && /e\.key === "Enter" \|\| e\.key === " "/.test(card),
  "a div that only responds to a mouse is not a button",
);
check(
  "the scorecard opens the drawer rather than navigating",
  /<MetricDetailDrawer/.test(card) && /setOpenMetric/.test(card),
  "the answer and its excerpts must stay on screen beside the detail",
);
check(
  "the metric is switched from inside the drawer",
  /onPick=\{setOpenMetric\}/.test(card) && /onPick\(name\)/.test(detail),
  "closing and reopening to compare two metrics is the thing being avoided",
);
check(
  "the safety judges are reachable even though they have no tile",
  /safetyJudges\.filter\(\(n\) => metrics\[n\]\)/.test(card),
  "their rubric is the most likely thing to be questioned and the least visible",
);
check(
  "an excerpt verdict with no number says so rather than guessing",
  /Excerpt not identified/.test(detail),
  "an unnumbered verdict drawn as excerpt 1 points at the wrong document",
);
check(
  "the drawer writes no colour of its own",
  !/#[0-9a-fA-F]{6}/.test(detail),
  `found ${(/#[0-9a-fA-F]{6}/.exec(detail) || [])[0]} in MetricDetailDrawer.tsx`,
);
check(
  "api.ts types every working shape the backend emits",
  kinds.every((k) => new RegExp(`kind: "${k}"`).test(api)),
  "a shape the type does not admit cannot be narrowed in the drawer",
);

// --- the theme ----------------------------------------------------------------

check(
  "the scorecard takes its band colours from the palette",
  /theme\.palette\.success\.main/.test(card)
  && /theme\.palette\.warning\.main/.test(card)
  && /theme\.palette\.error\.main/.test(card),
  "thresholds written as hexes look right in one theme only",
);
check(
  "the scorecard writes no colour of its own",
  !/#[0-9a-fA-F]{6}/.test(card),
  `found ${(/#[0-9a-fA-F]{6}/.exec(card) || [])[0]} in QualityScorecard.tsx`,
);

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);

/** The investigation log's traces must stay reachable and stay in step with
 *  the backend that produces them -- for BOTH agents that have one.
 *
 *  Run: node test/agent-trace.mjs
 *
 *  Two kinds of drift this catches, both silent in the browser:
 *
 *  1. The panel stops being reachable. A drawer that is imported, typed and
 *     rendered but never opened is indistinguishable from a missing feature --
 *     the log looks exactly the same, the rows just do nothing. That is the
 *     Coverage blank-screen failure in a different costume.
 *
 *  2. The trace kinds drift apart. evidence/trace.py decides what a call
 *     returns; the drawer decides what it can draw. Add an engine on one side
 *     only and the panel opens empty on a call that did bring evidence back,
 *     which reads as "nothing was found" rather than "nobody wrote the
 *     renderer".
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(here, "..", ...p), "utf8");

const pages = {
  Evidence: read("src", "pages", "EvidencePage.tsx"),
  Rollout: read("src", "pages", "RolloutPage.tsx"),
};
const drawer = read("src", "components", "AgentTraceDrawer.tsx");
const api = read("src", "api.ts");
const backend = readFileSync(join(here, "..", "..", "fitgap", "trace.py"), "utf8");

let failed = 0;
function check(name, ok, detail) {
  if (ok) console.log(`  ok   ${name}`);
  else { failed++; console.log(`  FAIL ${name}: ${detail}`); }
}

// --- reachable ----------------------------------------------------------------

for (const [agent, page] of Object.entries(pages)) {
  check(
    `${agent}: the trace drawer is mounted`,
    /<AgentTraceDrawer\b/.test(page),
    `AgentTraceDrawer is not rendered by ${agent}Page`,
  );

  check(
    `${agent}: something opens it`,
    /setTraceCall\(/.test(page),
    "nothing calls setTraceCall, so the drawer can never open",
  );

  check(
    `${agent}: a call row opens it`,
    /onClick=\{c\.trace \? \(\) => setTraceCall\(c\)/.test(page),
    "the investigation row no longer opens the trace for its call",
  );

  check(
    `${agent}: a row without a trace is not a button`,
    /cursor: c\.trace \? "pointer" : "default"/.test(page),
    "every row looks clickable, including the failed ones that open nothing",
  );

  check(
    `${agent}: the keyboard reaches it too`,
    /onKeyDown=\{c\.trace/.test(page) && /tabIndex=\{c\.trace/.test(page),
    "the row is mouse-only, so the panel cannot be opened from the keyboard",
  );

  check(
    `${agent}: retrieved passages are matched against what the answer used`,
    /cited=\{citedChunks\}/.test(page),
    "a retrieved passage is no longer marked when the finished answer rests on it",
  );
}

// --- the log has to outlive the run ------------------------------------------
//
// Rollout's log lived inside its Progress panel, which renders only while
// `!analysis`. So the log vanished at the exact moment the run finished, and a
// run reopened from history -- which always has an analysis -- never showed one
// at all. Every trace was built, stored and streamed correctly, and none of it
// was reachable. Nothing errors in that state; the panel is simply not there.

{
  const src = pages.Rollout;
  // The log block, wherever it now lives.
  const logAt = src.indexOf("{calls.map((c, i) => (");
  check("Rollout renders a call log at all", logAt > 0, "the log block is gone");

  if (logAt > 0) {
    // Walk back to the nearest enclosing render guard and make sure it is not
    // one that hides itself once the run has produced something.
    const before = src.slice(0, logAt);
    const guard = before.lastIndexOf("{(running || stages.length > 0) && !analysis && (");
    const closed = guard > 0 && before.indexOf("</Paper>", guard) > 0;
    check(
      "the log is not inside a panel that hides once the analysis arrives",
      guard < 0 || closed,
      "the call log sits under `!analysis`, so it disappears the moment the run finishes",
    );

    check(
      "a finished run still shows the log",
      /\{\(calls\.length > 0 \|\| running \|\| \(runId && !running\)\) && \(/.test(src),
      "the log panel's guard no longer covers a reopened run",
    );

    check(
      "a run with no log says why",
      /recorded before the log kept what each call returned/.test(src) &&
        /calls\.length === 0 && !running/.test(src),
      "a run stored before the log existed renders nothing at all, which reads as a missing feature",
    );
  }
}

const page = pages.Evidence;

// --- the cross-link to the answer ---------------------------------------------
//
// This is the point of the feature: not "what came back" but "what of it
// carried the answer". Without both halves the panel is a log viewer.

check(
  "the drawer marks a cited passage",
  /citedSet\.has\(h\.chunk_id\)/.test(drawer),
  "the drawer no longer distinguishes a passage the answer used from one it merely retrieved",
);

check(
  "graph findings are matched against the answer's graph facts",
  /citedNodes=\{citedGraph\.nodes\}/.test(page) && /graph_facts/.test(page),
  "graph nodes are no longer credited from the answer's graph facts",
);

// --- in step with the backend --------------------------------------------------

const backendKinds = [...backend.matchAll(/"kind":\s*"(\w+)"/g)].map((m) => m[1]);
const drawnKinds = [...drawer.matchAll(/trace\?\.kind === "(\w+)"/g)].map((m) => m[1]);

check(
  "every trace kind the backend emits has a renderer",
  backendKinds.length > 0 && backendKinds.every((k) => drawnKinds.includes(k)),
  `backend emits [${[...new Set(backendKinds)].join(", ")}], the drawer draws [${drawnKinds.join(", ")}]`,
);

check(
  "the call type carries a trace",
  /trace\?:\s*EvidenceTrace \| null;/.test(api),
  "EvidenceToolCall has no trace field, so nothing typed can reach the drawer",
);

check(
  "a passage keeps its text, not just its id",
  /text:\s*string;/.test(api) && /"text": r\.get\("text"\)/.test(backend),
  "the trace stores a pointer to a chunk; re-indexing renumbers chunks, so it would show the wrong passage or none",
);

// --- history, the same way on both pages --------------------------------------
//
// Both agents keep every run, and both should offer them the same way: a
// button in the top right, not a panel that sits between the question and the
// answer on one page and a button on the other. Two pages doing the same job
// two ways is the thing a reader has to learn twice.
//
// What that button opens used to be an anchored <Menu>, and these checks said
// so. It is a right-side drawer now, shared with InsightLens and Ask RAG, so
// everything about the panel itself -- that it filters, that it opens a run
// beside the page instead of replacing it, that delete arms where the record
// carries decisions -- is checked in run-history.mjs across all three pages
// rather than here across two. What stays here is the part that is about
// THESE two pages agreeing: where the button is.

for (const [name, src] of Object.entries(pages)) {
  check(
    `${name} opens its history from a header button`,
    /startIcon=\{<History(Icon)? size=\{14\} \/>\}/.test(src)
      && /onClick=\{\(\) => setHistoryOpen\(true\)\}/.test(src),
    "the history is somewhere other than the header button the other page uses",
  );

  check(
    `${name} can delete a run from it`,
    /onDelete=\{remove\}/.test(src),
    "the only way to remove a run is the API",
  );
}

check(
  "Evidence no longer keeps a second, inline history",
  !/Previous investigations/.test(pages.Evidence),
  "two affordances for one thing, and only one of them gets maintained",
);

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);

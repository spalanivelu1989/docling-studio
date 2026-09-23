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

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);

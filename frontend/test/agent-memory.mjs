/** The memory toggle has to be wired all the way through, and has to keep
 *  saying what memory is.
 *
 *  Run: node test/agent-memory.mjs
 *
 *  Three kinds of drift this catches, all silent in the browser:
 *
 *  1. The toggle is decorative. A Switch bound to state that is never put in
 *     the request body looks identical to a working one -- it moves, it
 *     remembers, and the run behaves exactly as if it were off. This is the
 *     Rollout log failure again: rendered, typed, and reaching nothing.
 *
 *  2. The panel stops saying "not evidence". The whole safety argument for
 *     showing recalled notes beside retrieved passages is that the page never
 *     lets them be mistaken for each other. A tidy-up that drops the warning
 *     leaves a panel that reads like a source list.
 *
 *  3. The console goes dark. The log is the only record of the agent's
 *     reasoning, the prompt it was really handed, and a submission that was
 *     rejected and re-made -- none of which has a panel of its own, so a
 *     broken wire here loses them silently rather than visibly.
 *
 *  4. The frontend and the backend disagree about the event. app.py streams
 *     one `memory` frame; if api.ts stops dispatching it, the panel is dead
 *     code and the run looks like it never consulted anything.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(here, "..", ...p), "utf8");
const repo = (...p) => readFileSync(join(here, "..", "..", ...p), "utf8");

const page = read("src", "pages", "EvidencePage.tsx");
const api = read("src", "api.ts");
const agent = repo("evidence", "agent.py");
const memory = repo("fitgap", "memory.py");
const app = repo("app.py");
const drawer = read("src", "components", "AgentLogDrawer.tsx");

let failed = 0;
function check(name, ok, detail) {
  if (ok) console.log(`  ok   ${name}`);
  else { failed++; console.log(`  FAIL ${name}: ${detail}`); }
}

// --- the toggle actually reaches the run --------------------------------------

check(
  "the page has a memory switch",
  /checked=\{useMemory && !memoryOff\}/.test(page),
  "no Switch is bound to useMemory",
);

check(
  "the switch is sent with the question",
  /askEvidence\(\{[^}]*memory:\s*useMemory/s.test(page),
  "the toggle moves but the request body does not carry it, so every run is memory-off",
);

check(
  "the request type carries it",
  /memory\?:\s*boolean/.test(api),
  "askEvidence's body type has no memory field",
);

check(
  "the endpoint accepts it",
  /memory:\s*bool = False/.test(app),
  "EvidenceQuestion has no memory field, so the flag is dropped at the door",
);

check(
  "the endpoint passes it to the agent",
  /memory=body\.memory/.test(app),
  "the endpoint reads the flag and does not hand it on",
);

// --- the event gets back ------------------------------------------------------

check(
  "the agent emits a memory event",
  /yield "memory", event/.test(agent),
  "nothing is streamed, so the page can never show what was recalled",
);

check(
  "api.ts dispatches it",
  /event === "memory"/.test(api),
  "the frame arrives and is thrown away",
);

check(
  "the run records it",
  /save_memory\(conn, run_id, data\)/.test(app),
  "a reopened run cannot say whether memory steered it",
);

// --- it keeps saying what it is -----------------------------------------------

check(
  "the memory panel can be collapsed",
  /onClick=\{\(\) => setMemoryOpen\(\(o\) => !o\)\}/.test(page)
    && /<Collapse in=\{memoryOpen\}>/.test(page),
  "six recalled notes push the investigation below the fold with no way to fold them",
);

check(
  "collapsing it is remembered",
  /localStorage\.setItem\("evidence\.memoryOpen"/.test(page)
    && /localStorage\.getItem\("evidence\.memoryOpen"\)/.test(page),
  "the panel reopens on every reload, so folding it away is worth nothing",
);

check(
  "reading the preference cannot throw the page away",
  /try \{ return localStorage\.getItem\("evidence\.memoryOpen"\) !== "0"; \} catch \{ return true; \}/
    .test(page),
  "localStorage throws in private mode; an unguarded read at render takes the page with it",
);

check(
  "the not-evidence chip is outside the collapse",
  page.indexOf('label="not evidence"') < page.indexOf("<Collapse in={memoryOpen}>"),
  "folded away, the panel would sit above the retrieved passages saying nothing about what it is",
);

check(
  "the panel says memory is not evidence",
  /label="not evidence"/.test(page) && /not<\/b> evidence and cannot be cited/.test(page),
  "the panel shows recalled notes beside retrieved passages with nothing distinguishing them",
);

check(
  "the preface tells the agent the same thing",
  /NOT\nEVIDENCE/.test(agent),
  "the model is handed notes with no warning that quoting them is wasted effort",
);

check(
  "holdout is enforced in one named rule, not inline",
  /def allowed\(enabled: bool, holdout: bool\) -> bool:/.test(memory)
    && /agent_memory\.allowed\(memory, holdout\)/.test(agent),
  "the holdout rule is inline and can be simplified away without anything noticing",
);

check(
  "the toggle is disabled under holdout",
  /const memoryOff = holdout \|\| !mem\?\.available;/.test(page),
  "the switch can be turned on for a holdout run, which then silently ignores it",
);

check(
  "only verified claims are written down",
  /kept = \[c for c in answer\.claims if c\.sources\]/.test(agent),
  "a claim whose quotes were discarded would be remembered as fact",
);

// --- the session log ----------------------------------------------------------

check(
  "the page has a Logs button",
  /startIcon=\{<Terminal size=\{15\} \/>\}/.test(page) && /setLogOpen\(true\)/.test(page),
  "nothing opens the console",
);

check(
  "the console is rendered",
  /<AgentLogDrawer/.test(page) && /open=\{logOpen\}/.test(page),
  "the button toggles state nothing reads -- the Coverage blank-screen failure again",
);

check(
  "live lines reach it",
  /log:\s*\(e\)\s*=>\s*setLog\(/.test(page) && /event === "log"/.test(api),
  "the frames arrive and are thrown away, so the console is empty during a run",
);

check(
  "a reopened run restores its log",
  /setLog\(run\.log \?\? \[\]\)/.test(page),
  "the log exists only while the tab is open, which is what storing it was for",
);

check(
  "the endpoint persists it",
  /ev_store\.save_log\(conn, run_id, log\)/.test(app),
  "nothing is written, so a reopened investigation has no log to restore",
);

check(
  "the agent is asked to narrate",
  /SAY WHAT YOU ARE DOING, in one sentence, before each tool call/.test(agent),
  "without the instruction the model goes straight to its tools and the log has no reasoning at all",
);

check(
  "reasoning blocks are read, not discarded",
  /yield "thinking", \{"turn": turns/.test(agent),
  "text blocks go back into messages and nowhere else",
);

check(
  "a tool line points at its stored call",
  /"call": len\(calls\) - 1/.test(app) && /onOpenCall\(entry\.call!\)/.test(drawer),
  "the console cannot open the evidence a call returned, so it needs its own copy",
);

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);

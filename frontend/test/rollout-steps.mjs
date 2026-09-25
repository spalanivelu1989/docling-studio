/** The Process alignment tab maps each deviation and fit to the As-Is steps
 *  it names. The step ids are the agent's own, and their shape varies by run
 *  ("AS-04", "IN-RET-030"): a pattern too narrow for one of them marks every
 *  step "Not mapped" while the data is all there.
 *
 *  Run: node test/rollout-steps.mjs
 */
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/components/rollout/premium.ts", import.meta.url), "utf8");
let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${!ok && detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
};

const m = src.match(/export const STEP_ID = (\/.+\/[a-z]*);/);
check("premium.ts declares STEP_ID", !!m);
if (m) {
  const STEP_ID = eval(m[1]);
  for (const id of ["AS-04", "AS-13", "IN-RET-030", "IN-RET-140", "DE-RET-2", "S-1", "BR-O2C-005"]) {
    check(`${id} is a step id`, STEP_ID.test(id));
  }
  for (const not of ["n/a", "to", "RET", "030", "-030", "IN-RET"]) {
    check(`"${not}" is not a step id`, !STEP_ID.test(not));
  }
}
// Run stepsOf itself: its source, stripped of types by the TypeScript compiler.
const ts = (await import("typescript")).default;
const fn = src.slice(src.indexOf("export const STEP_ID"), src.indexOf("\n}\n", src.indexOf("export function stepsOf")) + 3);
const js = ts.transpileModule(fn.replace(/export /g, ""), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
const stepsOf = new Function(`${js}; return stepsOf;`)();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The shapes runs have produced, matched against that run's own ids.
check("IN-RET ids", same(stepsOf("IN-RET-030", ["IN-RET-010", "IN-RET-030"]).ids, ["IN-RET-030"]));
const doc = ["5.1", "5.2", "5.3", "5.10", "5.14"];
check("the document's own numbers (5.10 is not 5.1)", same(stepsOf("5.10", doc).ids, ["5.10"]));
check("several, with punctuation", same(stepsOf("5.1, 5.3; (5.14).", doc).ids, ["5.1", "5.3", "5.14"]));
check("a range is a span, not each step", stepsOf("5.3 to 5.10", doc).spans && !stepsOf("5.3 to 5.10", doc).ids.length);
check("n/a is nothing", same(stepsOf("n/a", doc).ids, []));
check("an id the run does not have is not matched", same(stepsOf("5.99", doc).ids, []));
check("without known ids, the old shapes still match", same(stepsOf("AS-04, AS-13").ids, ["AS-04", "AS-13"]));
check("the view passes this run's ids", /stepsOf\(d\.as_is_step_id, known\)/.test(
  readFileSync(new URL("../src/components/rollout/ProcessAlignmentView.tsx", import.meta.url), "utf8")));

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);

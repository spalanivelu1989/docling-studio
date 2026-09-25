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
check("stepsOf filters with STEP_ID", /\.filter\(\(t\) => STEP_ID\.test\(t\)\)/.test(src));

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);

/** The workshop pack has to stay downloadable in every format it claims.
 *
 *  Run: node test/rollout-export.mjs
 *
 *  What this catches, all silent in the browser:
 *
 *  1. A button with no href. `href={undefined}` on a MUI Button renders a
 *     <button> that looks identical to a link and does nothing when clicked.
 *     That is the same class of failure as the Rollout log panel that was
 *     rendered, typed and unreachable.
 *
 *  2. A format the page offers and the server does not accept, or the other
 *     way round. The endpoint branches on a string; the page builds that
 *     string. Nothing else keeps the two lists in step.
 *
 *  3. The PDF button offered on a machine that cannot render one. WeasyPrint
 *     needs system libraries, so "can this server make a PDF" is a real
 *     question with a real negative answer.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(here, "..", ...p), "utf8");
const repo = (...p) => readFileSync(join(here, "..", "..", ...p), "utf8");

const page = read("src", "pages", "RolloutPage.tsx");
const api = read("src", "api.ts");
const app = repo("app.py");
const pdf = repo("rollout", "pdf.py");

let failed = 0;
function check(name, ok, detail) {
  if (ok) console.log(`  ok   ${name}`);
  else { failed++; console.log(`  FAIL ${name}: ${detail}`); }
}

// --- every format the page offers, the server accepts -------------------------

const offered = [...page.matchAll(/rollout\.exportUrl\(runId,\s*"(\w+)"\)/g)].map((m) => m[1]);
const accepted = ["pdf", "json", "md"].filter((f) =>
  f === "md" ? /filename="\{run_id\}\.md"/.test(app) : new RegExp(`format == "${f}"`).test(app));

check(
  "the page offers pdf, md and json",
  ["pdf", "md", "json"].every((f) => offered.includes(f)),
  `page offers [${[...new Set(offered)].join(", ")}]`,
);

check(
  "every format the page offers, the endpoint accepts",
  offered.every((f) => accepted.includes(f)),
  `page offers [${[...new Set(offered)].join(", ")}], endpoint accepts [${accepted.join(", ")}]`,
);

check(
  "the url builder types the same set",
  /format: "md" \| "json" \| "pdf"/.test(api),
  "the page can ask for a format the type does not admit, or vice versa",
);

// --- the PDF button is honest -------------------------------------------------

check(
  "the server says whether it can render a PDF",
  /"pdf": \{"available": _pdf_ok, "detail": _pdf_why\}/.test(app),
  "status carries no pdf block, so the page cannot know",
);

check(
  "the page reads that before offering the button",
  /const pdfReady = status\?\.pdf\?\.available !== false;/.test(page)
    && /disabled=\{!pdfReady\}/.test(page),
  "the button is always shown and fails at the download instead",
);

check(
  "a disabled PDF button carries no href",
  /href=\{pdfReady \? rollout\.exportUrl\(runId, "pdf"\) : undefined\}/.test(page),
  "a disabled MUI Button with an href still renders an anchor",
);

check(
  "an unrenderable PDF is a 503 with a reason, not a stack trace",
  /raise HTTPException\(503, f"This server cannot render PDFs\. \{why\}"\)/.test(app),
  "the analysis is fine and every other format works; that should not be a 500",
);

// --- one document, two formats ------------------------------------------------

check(
  "the PDF is rendered from the Markdown pack",
  /to_markdown\(run\)/.test(pdf),
  "the PDF builds its own content, so a section added to one will go missing from the other",
);

check(
  "the run id is baked into the page footer",
  /content: "%\(runid\)s";/.test(pdf) && !/string\(runid\)/.test(pdf),
  "string-set only fires for an element that generates a box; a hidden one renders no footer",
);

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);

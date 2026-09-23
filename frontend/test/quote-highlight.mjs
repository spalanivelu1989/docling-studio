/** Does a cited quote actually light up in the document it came from?
 *
 *  Run: node test/quote-highlight.mjs
 *
 *  This is not a unit test of a regex. It takes every quote the stored
 *  Evidence Agent runs actually cited, renders the real chunk and the real
 *  document the way Markdown.tsx renders them, and asks whether the highlight
 *  would mark anything -- against the TEXT NODES, because that is all a
 *  highlight gets to see. A quote that crosses an element boundary has no
 *  single text node holding it, which is the failure this exists to catch:
 *  seven of the eighteen stored quotes are Markdown table rows, and before the
 *  pipe was treated as a cut, not one of them highlighted.
 *
 *  The fixture is produced by test/quote-highlight-fixture.py, which reads the
 *  runs out of Postgres. Regenerate it after a re-index.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { marked } from "marked";

const here = dirname(fileURLToPath(import.meta.url));

// --- the helper under test, copied verbatim from Markdown.tsx --------------
// Copied rather than imported: the source is TSX and this runs under plain
// node. quote-highlight-fixture.py re-syncs it and warns if they have drifted.
function locateRegex(quote, haystack) {
  const escape = (f) =>
    f.slice(0, 300).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  const fragments = quote
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    // `_` is deliberately not a cut: it is a word character in SPARK_FS_L2C.
    .split(/\*+|__|~~|`|\||\r?\n|^\s*[-+]\s+|^\s*\d+\.\s+/gm)
    .map((part) => part.trim())
    .filter((part) => part.length >= 12);
  if (!fragments.length) return null;
  // Counted against the raw Markdown rather than the rendered text: repetition
  // is repetition either way, and this needs no second parse of a 1 MB sheet.
  const seen = new Map();
  for (const f of fragments) {
    try {
      seen.set(f, (haystack.match(new RegExp(escape(f), "gi")) || []).length);
    } catch {
      seen.set(f, Number.MAX_SAFE_INTEGER);
    }
  }
  const chosen = [...fragments]
    .sort((a, b) => (seen.get(a) ?? 0) - (seen.get(b) ?? 0))
    .slice(0, 2);
  try {
    return new RegExp(chosen.map(escape).join("|"), "gi");
  } catch {
    return null;
  }
}

/** What Markdown.tsx's highlighter can see: the text of one element at a time,
 *  never a span across two. */
function textNodes(html) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .split(/<[^>]+>/g)
    .map((t) =>
      t.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
       .replace(/&quot;/g, '"').replace(/&#39;/g, "'"))
    .filter((t) => t.trim());
}

function marks(regex, markdown) {
  if (!regex) return 0;
  const html = marked.parse(markdown, { async: false });
  let n = 0;
  for (const node of textNodes(html)) {
    regex.lastIndex = 0;
    n += (node.match(regex) || []).length;
  }
  return n;
}

const cites = JSON.parse(readFileSync(join(here, "quote-highlight.fixture.json"), "utf8"));
if (!cites.length) {
  console.log("no stored citations to check -- run the fixture script first");
  process.exit(0);
}

// Highlighting AT ALL is only half of it. A quote cut into fragments and
// matched by the longest of them marked 325 rows of one hierarchy sheet --
// which highlights the document rather than locating the passage in it, and
// reads as a broken page. The rarest-fragment rule keeps this under ten, so
// anything approaching a page of marks is the old bug coming back.
const TOO_MANY = 40;

let failed = 0;
for (const c of cites) {
  const inDoc = marks(locateRegex(c.quote, c.doc), c.doc);
  const inChunk = marks(locateRegex(c.quote, c.chunk), c.chunk);
  if (inDoc > TOO_MANY) {
    failed++;
    console.log(`  FAIL ${c.chunk_id}: ${inDoc} marks in the document -- that is not locating anything`);
    console.log(`       ${JSON.stringify(c.quote.slice(0, 90))}`);
  } else if (!inChunk) {
    failed++;
    console.log(`  FAIL ${c.chunk_id}: the quote does not highlight in its own excerpt`);
    console.log(`       ${JSON.stringify(c.quote.slice(0, 90))}`);
  } else if (!inDoc) {
    failed++;
    console.log(`  FAIL ${c.chunk_id}: highlights in the excerpt but not in the full document`);
    console.log(`       ${JSON.stringify(c.quote.slice(0, 90))}`);
  } else {
    console.log(`  ok   ${c.chunk_id}  ${inChunk} in excerpt, ${inDoc} in document`);
  }
}
console.log(`\n${cites.length - failed}/${cites.length} cited quotes highlight in both views`);
process.exit(failed ? 1 : 0);

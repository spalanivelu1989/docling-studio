# The workshop pack as a PDF

The Fit-Gap Copilot's analysis downloads as a PDF from the **PDF** button beside
Markdown and JSON. It is the same document as the Markdown pack — rendered from
`export.to_markdown`, not built separately, so a section added to one cannot go
missing from the other.

This note is about the part that took the work: making tables readable.

---

## What a pack actually contains

Measured across twelve real analyses:

| Shape | How much |
| --- | --- |
| Table rows, by column count | 2 cols: 134 · 3: 72 · 4: 86 · **5: 198** · 6: 13 · **7: 226** · **10: 125** |
| Longest single cell | 1,025 characters |
| Longest unbreakable token | `sample_BKP_Customer_Returns.clean_xml` (37 characters) |
| Nested list items | 100 |

A ten-column deviation register and a 1,025-character cell in the same
document, on A4. That is the problem in one line.

---

## What went wrong, and what fixed it

The first version let the browser size columns by content. On the register that
meant a prose column squeezed to one word per line, five rows to a page, and
**the last column pushed off the paper entirely** — not truncated, gone.

Four things fixed it, and each was found by rendering real packs and reading
the result rather than trusting the bytes.

### 1. Wide tables turn the page

`@page wide { size: A4 landscape }`, applied to any table with more than six
columns, or any table whose columns need more millimetres than portrait has.
269mm instead of 178mm. The register now fits on one page instead of three
truncated ones.

### 2. Columns are allocated in millimetres, not in "weights"

The first attempt scored columns in abstract units and added a constant for
padding. The constant was worth more weight than the padding was worth width,
so the whole scale came out short and **187 identifiers across twelve packs
were broken in half** — `GAP-0 / 1`, `REQUIRES_DECISI / ON`, `Materialit / y`.

Now every column first gets what it *needs* — its padding, its collapsed
border, and its longest unbreakable token. What is left is shared out by what
each column *wants*, which is the 75th percentile of its content. An identifier
that breaks in half is unreadable and, worse, quotable wrong.

### 3. Character widths are measured, not counted

Counting characters gets upper case wrong by a third in one direction and lower
case wrong in the other. `REQUIRES_DECISION` is seventeen characters and as wide
as twenty-three lowercase ones; `Harmonization` is thirteen and wider than
fourteen. Both broke.

`_CHAR_WIDTH` in `rollout/pdf.py` is a real measurement: every character
rendered at 7.8pt through WeasyPrint and divided by the width of a lowercase
"n". It predicts real width to within 1%. Regenerate it the same way if the
font stack ever changes.

### 4. The exceptional cell gets room too

The 75th percentile describes the typical cell and says nothing about the
outlier. A `Rule` column of blanks with one ninety-character annotation in it
took the minimum width and turned that cell into ten lines, beside two columns
that were entirely empty. A column now also asks for enough width that its
tallest cell is at most four lines.

---

## What is still allowed to break

A thirty-seven character file name and a full ISO timestamp fit no column at
any width. Those break — but at a seam. `_seams()` inserts `<wbr>` after each
underscore, slash, dot and colon in a very long token, so
`sample_BKP_Customer_Returns.clean_xml` breaks after a separator rather than
mid-word. `<wbr>` occupies no width and copies as nothing.

---

## The test that matters

`test_no_identifier_is_ever_broken_in_half` renders a pack built from the
shapes that actually failed, walks the resulting layout, and finds any cell
whose single token was split across lines. It tells a legitimate wrap at a
space apart from a mid-token break by joining the rendered lines with no
separator and asking whether the result occurs verbatim in the source:
`GAP-11` does, `Localization-adjustedalignment` (which was two words) does not.

Estimating is what got this wrong four times running. The test measures.

```
$ python rollout/test_rollout.py
70/70 passed
```

Across all twelve stored packs: **0 broken tokens**.

---

## Setup

WeasyPrint needs pango, cairo and gdk-pixbuf:

```bash
brew install pango cairo gdk-pixbuf
```

Without them `/api/rollout/status` reports `pdf.available: false`, the button
is disabled with the reason in its tooltip, and the export endpoint answers 503
rather than 500 — the analysis is fine and Markdown and JSON still work.

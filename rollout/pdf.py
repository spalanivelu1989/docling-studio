"""The workshop pack as a PDF.

Rendered from `export.to_markdown` rather than from the run, so the PDF and the
Markdown are the same document in two formats. Anything else and they drift --
a section added to one and forgotten in the other is invisible until somebody
compares two files nobody thought to compare.

Markdown to HTML to PDF, because the pack is mostly tables and a table is the
one thing that has to survive the trip. WeasyPrint lays out real CSS tables
with repeating headers and sane page breaks; drawing them by hand into a PDF
canvas means reimplementing column widths, row splitting and header repetition,
badly.

WeasyPrint needs pango, cairo and gdk-pixbuf, which this project already
expects for other reasons (docling[tesserocr] pulls in system libraries too).
It is still optional here: `available()` says so and the endpoint turns a
missing library into an answer rather than a stack trace, because a machine
that cannot make a PDF can still make every other export.
"""

from __future__ import annotations

import datetime as _dt
import html as _html
import re

# A4 with margins a workshop pack can be read from and written on. The running
# footer carries the run id on every page: a pack is printed, split up and
# handed round, and a loose page that cannot say which analysis it came from is
# worse than no page.
_STYLESHEET = """
@page {
  size: A4;
  margin: 18mm 16mm 20mm 16mm;
  @top-right {
    content: string(doctitle);
    font: 8pt "Helvetica Neue", Helvetica, Arial, sans-serif;
    color: #7a7a7a;
  }
  @bottom-left {
    content: "%(runid)s";
    font: 8pt ui-monospace, "SF Mono", Menlo, monospace;
    color: #9a9a9a;
  }
  @bottom-right {
    content: "Page " counter(page) " of " counter(pages);
    font: 8pt "Helvetica Neue", Helvetica, Arial, sans-serif;
    color: #7a7a7a;
  }
}
/* The first page carries no running header: the title is right there. */
@page :first { @top-right { content: ""; } }

/* A ten-column register cannot be read on A4 portrait, whatever the widths --
   before this, its last column ran off the paper and was simply lost. The page
   turns instead. Workshop packs are printed and a landscape page among
   portrait ones is ordinary; a truncated table is not. */
@page wide {
  size: A4 landscape;
  margin: 14mm 14mm 16mm 14mm;
}
table.wide { page: wide; }

body {
  font: 9.5pt/1.5 "Helvetica Neue", Helvetica, Arial, sans-serif;
  color: #1d1d1f;
  hyphens: none;
}

h1 {
  string-set: doctitle content();
  font-size: 19pt; line-height: 1.25; font-weight: 700;
  margin: 0 0 4mm 0; padding-bottom: 3mm;
  border-bottom: 2px solid #1d1d1f;
}
h2 {
  font-size: 12.5pt; font-weight: 700; margin: 8mm 0 2.5mm 0;
  padding-bottom: 1.5mm; border-bottom: 1px solid #d6d6d8;
  /* A heading alone at the foot of a page is a lie about what follows it. */
  break-after: avoid;
}
h3 { font-size: 10.5pt; font-weight: 700; margin: 5mm 0 1.5mm 0; break-after: avoid; }
h4 { font-size: 9.5pt; font-weight: 700; margin: 4mm 0 1mm 0; break-after: avoid; }

p  { margin: 0 0 2.5mm 0; orphans: 2; widows: 2; }
ul, ol { margin: 0 0 2.5mm 0; padding-left: 5.5mm; }
li { margin-bottom: 1mm; }

em { color: #55555a; }

/* Tables carry the analysis, so they get the care. thead repeats on every
   page a table spills onto, and a row is never split across the break.

   `fixed` is what makes the colgroup binding: under `auto` the browser may
   ignore a declared width whenever the content argues, and on a column holding
   a 1,000-character sentence it always does. */
table {
  width: 100%%; border-collapse: collapse; margin: 0 0 3.5mm 0;
  font-size: 8.5pt; line-height: 1.38;
  table-layout: fixed;
}
thead { display: table-header-group; }
tr { break-inside: avoid; }
th {
  text-align: left; font-weight: 700; background: #f2f2f4;
  border-bottom: 1px solid #c8c8cc; padding: 1.5mm 1.8mm;
}
td { border-bottom: 1px solid #e6e6e9; padding: 1.5mm 1.8mm; vertical-align: top; }
/* A fixed column cannot widen for a long word, so the word has to yield. Source
   file names run past fifty characters with nothing to break on, and without
   this they paint straight over the next column. */
th, td { overflow-wrap: break-word; word-break: normal; hyphens: none; }
/* A wide table has more to say and less room per column. */
table.wide { font-size: 7.8pt; line-height: 1.32; }
table.wide th, table.wide td { padding: 1.2mm 1.4mm; }
/* Codes, counts and fractions read as one token or not at all. */
td code { white-space: nowrap; }
/* The provenance block at the top is a two-column key/value table. */
table:first-of-type td:first-child { font-weight: 600; width: 34%%; }
/* `to_markdown` opens it with `| | |`, a header row of two empty cells.
   Markdown has no headerless table, so the row is real and renders as a grey
   bar over nothing. Removing the row in HTML would need a parser; hiding the
   one that is empty does not, and leaves a table that starts at its first
   real row. */
thead.empty { display: none; }

code {
  font: 8.5pt ui-monospace, "SF Mono", Menlo, monospace;
  background: #f2f2f4; padding: 0.3mm 1mm; border-radius: 1mm;
}
pre {
  font: 8pt/1.45 ui-monospace, "SF Mono", Menlo, monospace;
  background: #f7f7f9; border: 1px solid #e6e6e9; border-radius: 1.5mm;
  padding: 2.5mm; white-space: pre-wrap; word-break: break-word;
  break-inside: avoid;
}
blockquote {
  margin: 0 0 2.5mm 0; padding: 0 0 0 3mm;
  border-left: 2px solid #d6d6d8; color: #55555a;
}
hr { border: 0; border-top: 1px solid #e6e6e9; margin: 5mm 0; }

.footnote {
  margin-top: 8mm; padding-top: 2.5mm; border-top: 1px solid #e6e6e9;
  font-size: 7.5pt; color: #8a8a8e;
}
"""


def available() -> tuple[bool, str]:
    """Whether a PDF can be made here, and why not when it cannot.

    WeasyPrint imports its system libraries at import time, so a missing pango
    is an ImportError/OSError here rather than a failure half way through a
    render.
    """
    try:
        import weasyprint  # noqa: F401
    except Exception as exc:
        return False, (f"{type(exc).__name__}: {exc}"[:300]
                       + " — WeasyPrint needs pango, cairo and gdk-pixbuf "
                         "(`brew install pango cairo gdk-pixbuf`).")
    return True, ""


# --- tables -------------------------------------------------------------------
# The pack is mostly tables, and they are not all the same shape: a two-column
# provenance block, a five-column score table, and a ten-column deviation
# register. Left to itself the browser sizes columns by content, which on the
# register meant a prose column squeezed to one word per line, five rows to a
# page, and the last column pushed off the paper entirely.
#
# So each table is measured before it is rendered, and told what its columns
# are worth. Measured from the Markdown rather than the HTML because a pipe
# table is trivially parseable and the two are in the same order.

# Above this many columns a table cannot be read on A4 portrait, whatever the
# widths. The register has ten.
LANDSCAPE_AT = 6

# A table is laid out in millimetres, so it is allocated in millimetres. The
# first attempt allocated in abstract "weights" with a constant added for
# padding, which quietly compressed every column: the constant was worth more
# weight than the padding was worth width, so the scale came out 12% short and
# 187 identifiers across twelve real packs were broken in half.
#
# Content width between the margins, per page orientation.
PORTRAIT_MM = 210.0 - 2 * 16.0
LANDSCAPE_MM = 297.0 - 2 * 14.0

# Width of one lowercase "n" at each table's font size, measured through
# WeasyPrint. See _CHAR_WIDTH below.
MM_PER_UNIT_WIDE = 1.5299                     # 7.8pt
MM_PER_UNIT = MM_PER_UNIT_WIDE * 8.5 / 7.8    # 8.5pt

# What a cell spends before any text fits: padding on both sides, plus the
# collapsed border it shares with its neighbour. The border is a third of a
# millimetre and was the last thing still breaking identifiers -- it ate the
# safety margin exactly, so the column that needed 11.2mm of text was given
# 11.2mm of box and 10.9mm of room.
BORDER_MM = 0.6
PAD_MM_WIDE = 2 * 1.4 + BORDER_MM
PAD_MM = 2 * 1.8 + BORDER_MM

# No column is narrower than this, however little it holds: a column thinner
# than its own heading reads as a rendering fault.
MIN_MM = 9.0

# How many lines the tallest cell in a column may be asked to take, when there
# is width to spare. The 75th percentile describes the typical cell and says
# nothing about the exceptional one: a column of empty Rule cells with a single
# ninety-character annotation in it has a low 75th percentile, took the minimum
# width, and turned that one cell into ten lines beside three empty columns.
MAX_LINES = 4.0

# Above this many columns a table cannot be read on A4 portrait, whatever the
# widths. The deviation register has ten.
LANDSCAPE_AT = 6

# A column is widened to hold its longest unbreakable token, up to here. An
# identifier that breaks in half is unreadable and, worse, quotable wrong; past
# this width it is a file name, and a file name may break.
TOKEN_CAP_MM = 42.0


def _cells(row: str) -> list[str]:
    return [c.strip() for c in row.strip().strip("|").split("|")]


# Characters are not the same width, and a column measured in characters gets
# it wrong in both directions: REQUIRES_DECISION is seventeen characters and as
# wide as twenty-three lowercase ones, while "Harmonization" is thirteen and
# wider than the fourteen a naive count would allow it. Both broke across two
# lines in a column sized by counting.
#
# So the table below is MEASURED, not guessed: every character rendered at
# 7.8pt through WeasyPrint itself and divided by the width of a lowercase "n".
# Regenerate it the same way if the font stack changes.
_CHAR_WIDTH = {}
for _chars, _w in (
    ("ijl", 0.40), ("I()", 0.47), (" .,:;'", 0.50), ("f", 0.52), ("t", 0.57),
    ("r/", 0.60), ("-", 0.70), ("z", 0.86), ("svy_", 0.90), ("xkJ", 0.93),
    ("ace", 0.97), ("hnuL0123456789", 1.00), ("goFT", 1.03), ("bdpq", 1.07),
    ("EVXZ", 1.10), ("APSY", 1.17), ("K", 1.20), ("BR", 1.23), ("D", 1.27),
    ("CHNU", 1.30), ("w", 1.36), ("GOQ", 1.37), ("m", 1.53), ("M", 1.57),
    ("W", 1.67), ("%", 1.80),
):
    for _ch in _chars:
        _CHAR_WIDTH[_ch] = _w

# Anything not in the table -- an em-dash, an accent, a currency sign.
_DEFAULT_WIDTH = 1.05
# Bold is wider than the text it labels, and a heading repeated on every page
# is the most visible thing that can break.
_BOLD = 1.06
# The measurement is of one font at one size, and the renderer may resolve the
# stack differently. A column that is 5% too wide costs nothing; one that is 5%
# too narrow breaks an identifier in half.
_SAFETY = 1.05


def _width(text: str, bold: bool = False) -> float:
    """Roughly how wide `text` is, in lowercase-"n" units."""
    total = sum(_CHAR_WIDTH.get(ch, _DEFAULT_WIDTH) for ch in text)
    return total * (_BOLD if bold else 1.0)


def _tokens(text: str) -> list[str]:
    """The runs of text that must not be broken across lines.

    Split on spaces only. A hyphen or an underscore inside REQUIRES_DECISION or
    GAP-01 is part of the identifier, not an invitation to wrap there."""
    return [t for t in text.split() if t]


def _p75(values: list[float]) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    return float(ordered[min(len(ordered) - 1, int(len(ordered) * 0.75))])


def _needs(header: list[str], tokens: list[list[str]], wide: bool) -> list[float]:
    """The millimetres each column cannot do without: its padding plus its
    longest unbreakable token."""
    unit = MM_PER_UNIT_WIDE if wide else MM_PER_UNIT
    pad = PAD_MM_WIDE if wide else PAD_MM
    out = []
    for k, head in enumerate(header):
        longest = max([_width(head, bold=True)] + [_width(t) for t in tokens[k]] + [0.0])
        out.append(max(MIN_MM, pad + min(TOKEN_CAP_MM, _SAFETY * unit * longest)))
    return out


def _allocate(header: list[str], tokens: list[list[str]],
              lengths: list[list[float]], wide: bool) -> list[float]:
    """Column shares for one table, as fractions of its width.

    Two passes. Every column first gets what it NEEDS: its padding plus its
    longest unbreakable token, so nothing that must stay whole is asked to
    break. Whatever is left over is then shared out by what each column WANTS,
    which is the 75th percentile of its content -- the 75th rather than the
    mean so one long cell widens a column of codes a little and not a lot, and
    rather than the maximum, because then it would.
    """
    total_mm = LANDSCAPE_MM if wide else PORTRAIT_MM
    unit = MM_PER_UNIT_WIDE if wide else MM_PER_UNIT
    pad = PAD_MM_WIDE if wide else PAD_MM

    need = _needs(header, tokens, wide)
    # What a column would like: enough for its typical cell, and enough that
    # its tallest cell is not made into a column of single words.
    want = [max(MIN_MM,
                pad + unit * max(_p75(lengths[k]),
                                 max(lengths[k] or [0.0]) / MAX_LINES))
            for k in range(len(header))]

    # More is needed than there is. Nothing can be done about that except share
    # the shortfall, so the widest columns are the ones that give way.
    if sum(need) >= total_mm:
        return [n / sum(need) for n in need]

    spare = total_mm - sum(need)
    appetite = [max(0.0, want[k] - need[k]) for k in range(len(need))]
    if sum(appetite) > 0:
        mm = [need[k] + spare * appetite[k] / sum(appetite) for k in range(len(need))]
    else:
        mm = [n + spare / len(need) for n in need]
    return [m / total_mm for m in mm]


def measure(md: str) -> list[tuple[list[float], bool]]:
    """Per table: its column shares (0 to 1), and whether it needs a landscape
    page."""
    out: list[tuple[list[float], bool]] = []
    lines = md.split("\n")
    i = 0
    while i < len(lines):
        if not lines[i].startswith("|") or i + 1 >= len(lines):
            i += 1
            continue
        if not set(lines[i + 1].replace("|", "").replace(" ", "")) <= set("-:"):
            i += 1
            continue
        header = _cells(lines[i])
        lengths: list[list[float]] = [[] for _ in header]
        tokens: list[list[str]] = [[] for _ in header]
        j = i + 2
        while j < len(lines) and lines[j].startswith("|"):
            for k, cell in enumerate(_cells(lines[j])[:len(header)]):
                # Markup is not width: **bold** and `code` cost four and two
                # characters that are never drawn.
                plain = cell.replace("**", "").replace("`", "")
                lengths[k].append(_width(plain))
                tokens[k].extend(_tokens(plain))
            j += 1
        # Wide by column count, or because it does not fit: a five-column table
        # holding a file name and a timestamp needs more than A4 portrait has,
        # and squeezing it breaks both of them rather than one.
        wide = len(header) > LANDSCAPE_AT
        if not wide and sum(_needs(header, tokens, wide=False)) > PORTRAIT_MM:
            wide = True
        out.append((_allocate(header, tokens, lengths, wide), wide))
        i = j
    return out


_TABLE = re.compile(r"<table>")


def _size_tables(html: str, widths: list[tuple[list[float], bool]]) -> str:
    """Give every table a colgroup, and the wide ones a landscape page.

    `table-layout: fixed` comes with the colgroup: without it the browser is
    free to ignore the widths whenever the content argues, which on a column
    holding a 1,000-character sentence it always does.
    """
    parts, at, seen = [], 0, 0
    for match in _TABLE.finditer(html):
        cols, wide = widths[seen] if seen < len(widths) else ([], False)
        seen += 1
        klass = " class='wide'" if wide else ""
        group = ("<colgroup>"
                 + "".join(f"<col style='width:{w * 100:.4g}%'>" for w in cols)
                 + "</colgroup>") if cols else ""
        parts.append(html[at:match.start()])
        parts.append(f"<table{klass}>{group}")
        at = match.end()
    parts.append(html[at:])
    return "".join(parts)


def _markdown_to_html(md: str) -> str:
    from markdown_it import MarkdownIt

    return (MarkdownIt("commonmark")
            .enable("table")
            .enable("strikethrough")
            .render(md))


# A token this wide will not fit any column, so it is going to break. Where it
# breaks is still a choice.
_SEAM = re.compile(r"(?<=[_/.:,])(?=[^\s<>&])")
_LONG_TOKEN = re.compile(r"[^\s<>&]{26,}")


def _seams(html: str) -> str:
    """Offer a break after each underscore, slash, dot or colon in a very long
    token, so "sample_BKP_Customer_Returns.clean_xml" breaks after a separator
    instead of in the middle of a word. <wbr> is a break opportunity that
    occupies no width and copies as nothing."""
    return _LONG_TOKEN.sub(lambda m: _SEAM.sub("<wbr>", m.group(0)), html)


def _html_body(md: str) -> str:
    """Markdown to the HTML that goes in the document, sized and tidied."""
    body = _seams(_size_tables(_markdown_to_html(md), measure(md)))
    body = _EMPTY_CELL.sub('<td style="color:#b0b0b4">—</td>', body)
    return _BLANK_HEAD.sub(
        lambda m: m.group(0).replace("<thead>", '<thead class="empty">'), body)


# `to_markdown` writes a bare em-dash row for an absent number. Left alone the
# browser renders it as a hyphen at 8.5pt, which reads as a minus sign in a
# column of percentages.
_EMPTY_CELL = re.compile(r"<td>\s*—\s*</td>")

# A <thead> whose every cell is empty. See the `thead.empty` rule above.
_BLANK_HEAD = re.compile(r"<thead>\s*<tr>(?:\s*<th[^>]*>\s*</th>)+\s*</tr>\s*</thead>")


def _css_string(value: str) -> str:
    """`value` as a CSS string literal body. Run ids are tame, but a footer
    built by concatenation is a footer that can be escaped out of."""
    return value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", " ")


def stylesheet(run_id: str = "") -> str:
    """The print stylesheet, with the run id baked into the running footer.

    Baked rather than carried by `string-set`, because string-set only fires
    for an element that generates a box -- the hidden <div> that used to hold
    it produced no box and no footer, which is exactly the kind of thing that
    looks fine until somebody prints it."""
    return _STYLESHEET % {"runid": _css_string(run_id)}


def render(run: dict, markdown: str | None = None) -> bytes:
    """The workshop pack as PDF bytes.

    `markdown` is accepted so a caller that already has the pack does not build
    it twice, and so a test can render a known document rather than a run.
    """
    from weasyprint import CSS, HTML

    from .export import to_markdown

    body = _html_body(markdown if markdown is not None else to_markdown(run))

    run_id = str(run.get("id") or "")
    when = _dt.datetime.now().strftime("%d %B %Y at %H:%M")
    footnote = (f"Generated {_html.escape(when)} from analysis "
                f"<code>{_html.escape(run_id)}</code>. The agent proposes; the workshop decides.")

    document = (
        "<!doctype html><html lang='en'><head><meta charset='utf-8'>"
        f"<title>{_html.escape(run_id or 'Fit-to-Standard analysis')}</title></head><body>"
        f"{body}"
        f"<p class='footnote'>{footnote}</p>"
        "</body></html>"
    )
    return HTML(string=document).write_pdf(stylesheets=[CSS(string=stylesheet(run_id))])


def filename(run: dict) -> str:
    """A name that says what the pack is without opening it."""
    bits = [b for b in (run.get("country"), run.get("scope_label")
                        or (run.get("analysis") or {}).get("template_process")) if b]
    stem = " - ".join(str(b) for b in bits) or str(run.get("id") or "analysis")
    stem = re.sub(r'[\\/:*?"<>|]+', " ", stem).strip()
    stem = re.sub(r"\s+", " ", stem)[:110]
    return f"Fit-to-Standard - {stem}.pdf"

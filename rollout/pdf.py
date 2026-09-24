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
   page a table spills onto, and a row is never split across the break. */
table {
  width: 100%%; border-collapse: collapse; margin: 0 0 3.5mm 0;
  font-size: 8.5pt; line-height: 1.4;
}
thead { display: table-header-group; }
tr { break-inside: avoid; }
th {
  text-align: left; font-weight: 700; background: #f2f2f4;
  border-bottom: 1px solid #c8c8cc; padding: 1.6mm 2mm;
}
td { border-bottom: 1px solid #e6e6e9; padding: 1.6mm 2mm; vertical-align: top; }
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


def _markdown_to_html(md: str) -> str:
    from markdown_it import MarkdownIt

    return (MarkdownIt("commonmark")
            .enable("table")
            .enable("strikethrough")
            .render(md))


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

    body = _markdown_to_html(markdown if markdown is not None else to_markdown(run))
    body = _EMPTY_CELL.sub('<td style="color:#b0b0b4">—</td>', body)
    body = _BLANK_HEAD.sub(lambda m: m.group(0).replace("<thead>", '<thead class="empty">'), body)

    run_id = str(run.get("id") or "")
    when = _dt.datetime.now().strftime("%d %B %Y at %H:%M")
    footnote = (f"Generated {_html.escape(when)} from analysis "
                f"<code>{_html.escape(run_id)}</code>. The agent proposes; the workshop decides.")

    document = (
        "<!doctype html><html><head><meta charset='utf-8'>"
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

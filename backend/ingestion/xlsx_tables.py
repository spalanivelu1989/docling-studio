"""Spreadsheet -> Markdown, one table per worksheet.

Docling segments a worksheet into contiguous non-empty blocks, so a single
blank spacer row splits one logical table into several. The header row ends up
orphaned in a table of its own, and every following fragment promotes its first
data row to a header -- losing that row and mislabelling the rest.

Spreadsheets use blank rows for looks, not structure, so this module treats a
sheet as one table: it expands merged cells, drops blank spacer rows, lifts
leading single-cell rows out as titles, and escapes the characters that would
otherwise break a Markdown table.
"""

from __future__ import annotations

import datetime as dt
from pathlib import Path

from openpyxl import load_workbook
from openpyxl.worksheet.worksheet import Worksheet

# Beyond this a Markdown table stops being readable and is usually a sign the
# sheet is a data dump rather than something a person reads in a document.
MAX_COLS = 40


def _fmt(value: object) -> str:
    """Render a cell value the way a reader would expect to see it."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, dt.datetime):
        # Midnight almost always means the cell is a date, not a timestamp.
        if (value.hour, value.minute, value.second) == (0, 0, 0):
            return value.strftime("%Y-%m-%d")
        return value.strftime("%Y-%m-%d %H:%M")
    if isinstance(value, dt.date):
        return value.strftime("%Y-%m-%d")
    if isinstance(value, dt.time):
        return value.strftime("%H:%M")
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def _escape(text: str) -> str:
    """Neutralise the two characters that would break a Markdown table row."""
    return text.replace("|", "\\|").replace("\n", "<br>").replace("\r", "")


def _grid(ws: Worksheet) -> list[list[str]]:
    """Read the sheet into a dense grid, expanding merged ranges.

    openpyxl reports a merged range's value on its top-left cell only, leaving
    the rest None. Vertical merges are row labels covering several rows, so
    their value is copied down to keep each row self-contained. Horizontal
    merges are banners spanning the sheet width -- copying those sideways would
    repeat one title across every column and disguise it as a full data row, so
    they stay in their first cell.
    """
    rows = [[_fmt(v) for v in row] for row in ws.iter_rows(values_only=True)]
    if not rows:
        return []
    width = max(len(r) for r in rows)
    for row in rows:
        row.extend([""] * (width - len(row)))

    for rng in ws.merged_cells.ranges:
        anchor = _fmt(ws.cell(rng.min_row, rng.min_col).value)
        if not anchor or rng.min_col != rng.max_col:
            continue  # blank, or a horizontal banner: leave it in place
        for r in range(rng.min_row, rng.max_row + 1):
            if r <= len(rows) and rng.min_col <= width:
                rows[r - 1][rng.min_col - 1] = anchor
    return rows


def _trim(rows: list[list[str]]) -> list[list[str]]:
    """Drop blank rows, and blank columns at the left and right edges."""
    rows = [r for r in rows if any(cell.strip() for cell in r)]
    if not rows:
        return []
    used = [i for i in range(len(rows[0])) if any(r[i].strip() for r in rows)]
    if not used:
        return []
    lo, hi = used[0], used[-1]
    return [r[lo : hi + 1] for r in rows]


def _split_titles(rows: list[list[str]]) -> tuple[list[str], list[list[str]]]:
    """Peel off leading rows that hold a single cell -- sheet titles, not data."""
    i = 0
    while i < len(rows) and sum(1 for c in rows[i] if c.strip()) <= 1:
        i += 1
    titles = [next(c for c in r if c.strip()) for r in rows[:i]]
    return titles, rows[i:]


def _table(rows: list[list[str]]) -> str:
    """Emit a Markdown table, first row as the header."""
    width = max(len(r) for r in rows)
    padded = [r + [""] * (width - len(r)) for r in rows]
    header, body = padded[0], padded[1:]
    # An unnamed column still needs a placeholder or the pipes misalign.
    header = [_escape(c) or f"col{i + 1}" for i, c in enumerate(header)]

    out = ["| " + " | ".join(header) + " |"]
    out.append("|" + "|".join([" --- "] * width) + "|")
    for row in body:
        out.append("| " + " | ".join(_escape(c) for c in row) + " |")
    return "\n".join(out)


def sheet_to_markdown(ws: Worksheet) -> str:
    """Convert one worksheet to a Markdown section."""
    parts = [f"## {ws.title}"]
    rows = _trim(_grid(ws))
    if not rows:
        parts.append("_Empty sheet._")
        return "\n\n".join(parts)

    titles, body = _split_titles(rows)
    parts.extend(titles)
    # Trim again: a column may have held nothing but the titles just removed.
    body = _trim(body)

    if not body:
        # Nothing wide enough to be a table; the sheet is just prose.
        return "\n\n".join(parts)

    if len(body[0]) > MAX_COLS:
        parts.append(
            f"_{len(body)} rows x {len(body[0])} columns; too wide to render "
            f"as a table._"
        )
        return "\n\n".join(parts)

    parts.append(_table(body))
    return "\n\n".join(parts)


def sheet_count(path: Path) -> int:
    wb = load_workbook(path, data_only=True, read_only=True)
    try:
        return len(wb.worksheets)
    finally:
        wb.close()


def workbook_to_markdown(path: Path, title: str | None = None) -> str:
    """Convert every worksheet in a workbook to Markdown.

    `title` names the document when the file on disk is a temporary copy whose
    stem would otherwise become the heading.
    """
    # data_only=True returns the last values Excel cached for formula cells,
    # which is what a reader sees; the formula text itself is not useful here.
    wb = load_workbook(path, data_only=True, read_only=False)
    try:
        sections = [f"# {title or path.stem}"]
        for ws in wb.worksheets:
            sections.append(sheet_to_markdown(ws))
        return "\n\n".join(sections) + "\n"
    finally:
        wb.close()


if __name__ == "__main__":
    import sys

    for arg in sys.argv[1:]:
        print(workbook_to_markdown(Path(arg)))

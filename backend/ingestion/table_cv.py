"""Ruled tables in images, recovered with classic image processing + Tesseract.

Tesseract reads glyphs, not layout, so on a table screenshot it returns the
right words with the rows run together. Most tables in these decks (SAP GUI
grids, Excel ranges pasted as pictures) draw their cell borders, and those
borders are exactly the structure Tesseract throws away. So:

1. Mark brightness steps between neighbouring pixels. SAP grid lines are a
   pale grey on pale blue, and some SAP borders are only a change of cell
   colour, so looking for dark pixels misses them.
2. Open with long thin kernels to keep only horizontal and vertical strokes.
3. A horizontal stroke only counts as a row border if it crosses or touches at
   least two vertical strokes. Underlined link text in SAP cells is a
   horizontal stroke too, but it never meets a column border.
4. Each connected group of borders with enough rows and columns is a table.
   Its row and column positions define a grid; a border missing between two
   grid cells means they are one merged cell.
5. Every merged cell is OCR'd on its own, so a cell's words cannot leak into
   its neighbours the way they do when the whole image is read at once.

Merged cells spanning rows are repeated down each row they cover, so every
Markdown row stands on its own. Cells spanning columns keep their text in the
first column only.
"""

from __future__ import annotations

import re
import statistics
from dataclasses import dataclass, field

import cv2
import numpy as np
from PIL import Image
from tesserocr import PSM, PyTessBaseAPI

# Brightness change between neighbouring pixels that can be a border.
EDGE_STEP = 10
# Borders closer than this (px, original resolution) are the same line.
MERGE_TOL = 4
# A drawn border must cover this share of a cell edge to count as present.
BORDER_COVERAGE = 0.6
# Share of a table's height a column border must cover.
MIN_COLUMN_SPAN = 0.5
# Share of a missing border's length text must cover to count as crossing it.
CROSSING_SHARE = 0.05
# Narrower than this, a gap between two borders is an icon, not a column.
MIN_COLUMN_WIDTH = 20
MIN_ROWS = 2
MIN_COLS = 2
# Below this, a "table" is a form field box or a button, not data.
MIN_FILLED_CELLS = 4
# Cell text read with less confidence than this, and that short, is a checkbox
# or an icon glyph rather than a value.
MIN_CELL_CONF = 45.0
# Upscale for each cell before OCR. Measured on the reference tables: 2x 89%,
# 3x 91%, 4x 94%, 5x 91% of cells exact.
CELL_SCALE = 4
# Mean cell confidence below which a detected grid is not trusted as a table.
# On this corpus real tables read at 76-95, grids found in diagrams at 51-74.
MIN_TABLE_CONF = 75.0
# Pixels inside a cell's edge where its border strokes can sit.
BORDER_BAND = 3
# Darkest-to-lightest spread below which a cell holds no text.
MIN_CELL_CONTRAST = 20
# Border fragments and checkbox edges read as punctuation at a cell's edges.
_EDGE_JUNK = re.compile(r"^[\s|\[\]{}()_‘'`\"~,.:;!-]+|[\s|\[\]{}_‘'`\"~,:;!]+$")


@dataclass
class Table:
    left: int
    top: int
    right: int
    bottom: int
    rows: list[list[str]] = field(default_factory=list)
    confidence: float = 0.0

    def to_markdown(self) -> str:
        width = max(len(r) for r in self.rows)
        lines = []
        for i, row in enumerate(self.rows):
            cells = [c.replace("|", "\\|").replace("\n", " ") for c in row]
            cells += [""] * (width - len(cells))
            lines.append("| " + " | ".join(cells) + " |")
            if i == 0:
                lines.append("|" + "---|" * width)
        return "\n".join(lines)


def _line_masks(gray: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Horizontal and vertical border strokes.

    Borders are found as brightness *steps* rather than dark pixels: SAP draws
    many cell borders as nothing more than a change of background colour
    (a cyan key column against grey rows), which no darkness threshold sees,
    while a thin grey rule is simply two steps a pixel apart.
    """
    h, w = gray.shape
    g = gray.astype(np.int16)
    dy = np.zeros_like(g)
    dy[:-1] = np.abs(np.diff(g, axis=0))
    dx = np.zeros_like(g)
    dx[:, :-1] = np.abs(np.diff(g, axis=1))
    ey = ((dy >= EDGE_STEP) * 255).astype(np.uint8)
    ex = ((dx >= EDGE_STEP) * 255).astype(np.uint8)
    # Short enough to keep the row border of a narrow SAP column (a unit or a
    # checkbox, ~40px); stray text edges this short are filtered out later.
    hk = cv2.getStructuringElement(cv2.MORPH_RECT, (max(15, w // 60), 1))
    vk = cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(12, h // 40)))
    horiz = cv2.morphologyEx(ey, cv2.MORPH_OPEN, hk)
    vert = cv2.morphologyEx(ex, cv2.MORPH_OPEN, vk)
    return horiz, vert


def _segments(mask: np.ndarray) -> list[tuple[int, int, int, int]]:
    """Bounding boxes (x0, y0, x1, y1) of each stroke in a line mask."""
    n, _, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    return [
        (x, y, x + w - 1, y + h - 1)
        for x, y, w, h, _ in stats[1:n]
    ]


def _touches(h: tuple, v: tuple, tol: int = MERGE_TOL) -> bool:
    hx0, hy0, hx1, hy1 = h
    vx0, vy0, vx1, vy1 = v
    return (
        hx0 - tol <= vx1 and vx0 <= hx1 + tol
        and vy0 - tol <= hy1 and hy0 <= vy1 + tol
    )


def _cluster(values: list[float], tol: int = MERGE_TOL) -> list[int]:
    out: list[list[float]] = []
    for v in sorted(values):
        if out and v - out[-1][-1] <= tol:
            out[-1].append(v)
        else:
            out.append([v])
    return [round(statistics.mean(c)) for c in out]


def _coverage(mask: np.ndarray, x0: int, y0: int, x1: int, y1: int) -> float:
    """Share of positions along a thin strip where the mask has any ink."""
    strip = mask[max(y0, 0):y1 + 1, max(x0, 0):x1 + 1]
    if strip.size == 0:
        return 0.0
    along = strip.any(axis=0) if (x1 - x0) > (y1 - y0) else strip.any(axis=1)
    return float(along.mean())


def _table_body(
    ys: list[int], xs: list[int], vert: np.ndarray
) -> tuple[list[int], list[int]]:
    """The longest run of rows that share one column layout, and its columns.

    Line detection cannot tell a table from the toolbar strip or form fields
    ruled right above it, so one grid often holds both. The table is the part
    whose rows keep the same column borders; letter strokes that happen to
    reach both row lines, and furniture above or below, fall outside it.
    """
    t = MERGE_TOL
    rows = [
        {
            i for i, x in enumerate(xs)
            if _coverage(vert, x - t, ys[r] + t, x + t, ys[r + 1] - t) >= BORDER_COVERAGE
        }
        for r in range(len(ys) - 1)
    ]
    best = (0, 0, set())
    for start in range(len(rows)):
        counts: dict[int, int] = {}
        misses = 0
        end = start
        for r in range(start, len(rows)):
            n = r - start
            common = {i for i, k in counts.items() if k * 2 >= n} if n else rows[r]
            if n and len(rows[r] & common) * 2 < len(common):
                misses += 1
                # One odd row (a full-width caption, a blank line) is allowed.
                if misses > 1:
                    break
            else:
                misses = 0
                end = r
            for i in rows[r]:
                counts[i] = counts.get(i, 0) + 1
        length = end - start + 1
        cols = {i for i, k in counts.items() if k >= length * MIN_COLUMN_SPAN}
        if (length, len(cols)) > (best[1] - best[0], len(best[2])):
            best = (start, end + 1, cols)
    start, stop, cols = best
    body = ys[start:stop + 1]
    kept: list[int] = []
    for i in sorted(cols):
        x = xs[i]
        # An icon repeated in every row lines up like a border, but leaves a
        # "column" narrower than any real one.
        if kept and x - kept[-1] < MIN_COLUMN_WIDTH:
            if _coverage(vert, x - t, body[0], x + t, body[-1]) <= _coverage(
                vert, kept[-1] - t, body[0], kept[-1] + t, body[-1]
            ):
                continue
            kept.pop()
        kept.append(x)
    return body, kept


def _find_grids(
    horiz: np.ndarray, vert: np.ndarray
) -> list[tuple[list[int], list[int], tuple]]:
    """Row and column border positions for each table-like grid."""
    width = horiz.shape[1]
    hs = [s for s in _segments(horiz) if s[2] - s[0] >= 30 and s[3] - s[1] <= 8]
    vs = [s for s in _segments(vert) if s[3] - s[1] >= 10 and s[2] - s[0] <= 8]
    # A column border spans at least one row, so it meets two row borders. A
    # tall letter above an underline is a vertical stroke too, but meets one.
    t = MERGE_TOL
    vs = [v for v in vs if len({h[1] // (2 * t) for h in hs if _touches(h, v)}) >= 2]
    # Row borders meet column borders, or run most of the way across the image
    # (a table with a single divider). Underlined link text does neither.
    rows = [
        h for h in hs
        if sum(_touches(h, v) for v in vs) >= 2
        or (h[2] - h[0] >= width * 0.6 and any(_touches(h, v) for v in vs))
    ]
    # The last column's row borders meet only the one border to their left,
    # but they continue a row border already found.
    hs = rows + [
        h for h in hs
        if h not in rows
        and any(_touches(h, v) for v in vs)
        and any(abs(h[1] - r[1]) <= t and (r[2] + 2 * t >= h[0] or h[2] + 2 * t >= r[0]) for r in rows)
    ]
    if not hs or not vs:
        return []

    grid = np.zeros_like(horiz)
    for x0, y0, x1, y1 in hs + vs:
        grid[y0:y1 + 1, x0:x1 + 1] = 255
    grid = cv2.dilate(grid, np.ones((2 * MERGE_TOL + 1,) * 2, np.uint8))

    grids = []
    for gx0, gy0, gx1, gy1 in _segments(grid):
        def inside(s):
            return gx0 <= s[0] and s[2] <= gx1 and gy0 <= s[1] and s[3] <= gy1

        ys = _cluster([(s[1] + s[3]) / 2 for s in hs if inside(s)])
        xs = _cluster([(s[0] + s[2]) / 2 for s in vs if inside(s)])
        # Tables drawn without an outer border still end at the grid's edge.
        box = (gx0 + t, gy0 + t, gx1 - t, gy1 - t)
        if ys and ys[0] - box[1] > 2 * t:
            ys.insert(0, box[1])
        if ys and box[3] - ys[-1] > 2 * t:
            ys.append(box[3])
        if len(ys) < 2:
            continue
        ys, xs = _table_body(ys, xs, vert)
        if xs and xs[0] - box[0] > 2 * t:
            xs.insert(0, box[0])
        if xs and box[2] - xs[-1] > 2 * t:
            xs.append(box[2])
        box = (box[0], ys[0], box[2], ys[-1])
        if len(ys) - 1 >= MIN_ROWS and len(xs) - 1 >= MIN_COLS:
            grids.append((ys, xs, box))
    return grids


def _merged_cells(
    ys: list[int], xs: list[int], horiz: np.ndarray, vert: np.ndarray
) -> list[list[tuple[int, int]]]:
    """Groups of (row, col) grid cells that share no drawn border."""
    nr, nc = len(ys) - 1, len(xs) - 1
    parent = {(r, c): (r, c) for r in range(nr) for c in range(nc)}

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    t = MERGE_TOL
    for r in range(nr):
        for c in range(nc):
            if c + 1 < nc and _coverage(
                vert, xs[c + 1] - t, ys[r] + t, xs[c + 1] + t, ys[r + 1] - t
            ) < BORDER_COVERAGE:
                parent[find((r, c + 1))] = find((r, c))
            if r + 1 < nr and _coverage(
                horiz, xs[c] + t, ys[r + 1] - t, xs[c + 1] - t, ys[r + 1] + t
            ) < BORDER_COVERAGE:
                parent[find((r + 1, c))] = find((r, c))

    groups: dict = {}
    for cell in parent:
        groups.setdefault(find(cell), []).append(cell)
    out = []
    for group in groups.values():
        rs = {r for r, _ in group}
        cs = {c for _, c in group}
        # A real merged cell is a rectangle. Anything else is the grid running
        # into non-table furniture (toolbars, window frames): keep cells apart.
        if len(group) != len(rs) * len(cs):
            out.extend([cell] for cell in group)
        else:
            out.append(group)
    return out


def _split_unless_crossed(
    group: list[tuple[int, int]], ys: list[int], xs: list[int], ink: np.ndarray
) -> list[list[tuple[int, int]]]:
    """Undo a merge whose missing border no text actually crosses.

    A border can be missing because the cell really is merged, or because the
    screenshot simply did not draw it (SAP leaves some columns unruled). Text
    tells them apart: a merged cell's label is free to straddle the gap, while
    separate cells each keep their text inside their own row or column.
    """
    rs = sorted({r for r, _ in group})
    cs = sorted({c for _, c in group})
    x0, x1 = xs[cs[0]] + 3, xs[cs[-1] + 1] - 3
    y0, y1 = ys[rs[0]] + 3, ys[rs[-1] + 1] - 3

    def separate(borders, strip, spans):
        # A few specks on a border are anti-aliasing, not a label crossing it.
        crossed = any(s.size and s.mean() > CROSSING_SHARE for s in map(strip, borders))
        filled = sum(1 for s in spans if s.any())
        return not crossed and filled >= 2

    if len(rs) > 1 and separate(
        [ys[r] for r in rs[1:]],
        lambda b: ink[b - 2:b + 3, x0:x1].any(axis=0),
        [ink[ys[r] + 3:ys[r + 1] - 2, x0:x1] for r in rs],
    ):
        return [
            piece
            for r in rs
            for piece in _split_unless_crossed([(r, c) for c in cs], ys, xs, ink)
        ]
    if len(cs) > 1 and separate(
        [xs[c] for c in cs[1:]],
        lambda b: ink[y0:y1, b - 2:b + 3].any(axis=1),
        [ink[y0:y1, xs[c] + 3:xs[c + 1] - 2] for c in cs],
    ):
        return [
            piece
            for c in cs
            for piece in _split_unless_crossed([(r, c) for r in rs], ys, xs, ink)
        ]
    return [group]

def _is_checkbox(bw: np.ndarray) -> str | None:
    """'☑' or '' for a cell holding only a checkbox, None for anything else.

    Tesseract reads an empty checkbox as "O" or "[]" and a ticked one as "M",
    so both have to be recognised as shapes before they reach it.
    """
    fg = (bw == 0).astype(np.uint8)
    n, _, stats, _ = cv2.connectedComponentsWithStats(fg, connectivity=8)
    if n < 2:
        return None
    i = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    x, y, w, h, area = stats[i]
    others = fg.sum() - area
    square = 0.75 <= w / max(h, 1) <= 1.33 and h >= bw.shape[0] * 0.45
    if not square or area > w * h * 0.5 or others > area * 0.3:
        return None
    # All four sides drawn: a "G" or an "O" is roughly square too, but open or
    # round at the corners.
    part = fg[y:y + h, x:x + w]
    edge = max(2, min(w, h) // 8)
    sides = (part[:edge].any(axis=0), part[-edge:].any(axis=0),
             part[:, :edge].any(axis=1), part[:, -edge:].any(axis=1))
    if min(s.mean() for s in sides) < 0.85:
        return None
    inner = fg[y + h // 4:y + h - h // 4, x + w // 4:x + w - w // 4]
    return "☑" if inner.mean() > 0.12 else ""


def _ocr_cell(
    api: PyTessBaseAPI, gray: np.ndarray, lines: np.ndarray, box: tuple, scale: int
) -> tuple[str, float]:
    x0, y0, x1, y1 = box
    crop = gray[y0 + 1:y1, x0 + 1:x1].copy()
    if crop.size == 0 or crop.shape[0] < 6 or crop.shape[1] < 4:
        return "", 0.0
    # Paint the borders out rather than cropping inside them: SAP key columns
    # start their text a pixel or two from the border, and a wide margin cuts
    # "514" down to "14".
    ruled = lines[y0 + 1:y1, x0 + 1:x1] > 0
    # Only strokes hugging the cell's own edges are borders; a vertical
    # stroke in the middle of the cell is part of a letter.
    frame = np.ones_like(ruled)
    frame[BORDER_BAND:-BORDER_BAND, BORDER_BAND:-BORDER_BAND] = False
    ruled &= frame
    crop[ruled] = int(np.median(crop[~ruled])) if (~ruled).any() else 255
    _, ink = cv2.threshold(crop, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    # Otsu splits even a flat background in two; a real glyph stands out more.
    if int(crop.max()) - int(crop.min()) < MIN_CELL_CONTRAST or (ink > 0).sum() < 8:
        return "", 0.0
    big = cv2.resize(crop, None, fx=scale, fy=scale, interpolation=cv2.INTER_LANCZOS4)
    # Binarise per cell: shaded rows, coloured key columns and white-on-dark
    # headers each get their own threshold, and Tesseract sees black on white.
    _, bw = cv2.threshold(big, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    if (bw == 0).mean() > 0.5:
        bw = 255 - bw
    box_mark = _is_checkbox(bw)
    if box_mark is not None:
        return box_mark, 100.0
    api.SetImage(Image.fromarray(cv2.copyMakeBorder(
        bw, 20, 20, 20, 20, cv2.BORDER_CONSTANT, value=255
    )))
    text = _EDGE_JUNK.sub("", " ".join(api.GetUTF8Text().split()))
    conf = float(api.MeanTextConf())
    if not text or (conf < MIN_CELL_CONF and len(text) <= 3):
        return "", conf
    # Rules and scrollbar edges read as dashes: mostly punctuation is no value.
    # Dots and commas are left out of the count: "U..." and "1,025.500" are values.
    letters = sum(ch.isalnum() for ch in text)
    if letters < 0.5 * len(re.sub(r"[\s.,]", "", text)):
        return "", conf
    # A lone lowercase fragment is an icon (SAP's edit pencil reads as "a").
    if len(text) <= 2 and text.islower() and conf < 90:
        return "", conf
    return text, conf


def find_tables(
    gray: np.ndarray, lang: str, tessdata: str, scale: int = CELL_SCALE
) -> list[Table]:
    """Every ruled table in a grayscale image, top to bottom."""
    horiz, vert = _line_masks(gray)
    # Text pixels only: dark strokes minus the ruling lines themselves.
    ink = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY_INV, 15, 12
    )
    # The edge masks mark the step next to a rule, not always the rule itself.
    ink[cv2.dilate(cv2.bitwise_or(horiz, vert), np.ones((3, 3), np.uint8)) > 0] = 0
    ink = ink > 0
    lines = cv2.bitwise_or(horiz, vert)
    tables: list[Table] = []
    with PyTessBaseAPI(psm=PSM.SINGLE_BLOCK, lang=lang, path=tessdata) as api:
        for ys, xs, box in _find_grids(horiz, vert):
            nr, nc = len(ys) - 1, len(xs) - 1
            rows = [[""] * nc for _ in range(nr)]
            confs = []
            filled = 0
            groups = [
                piece
                for group in _merged_cells(ys, xs, horiz, vert)
                for piece in _split_unless_crossed(group, ys, xs, ink)
            ]
            while groups:
                group = groups.pop()
                r0 = min(r for r, _ in group)
                r1 = max(r for r, _ in group)
                c0 = min(c for _, c in group)
                c1 = max(c for _, c in group)
                text, conf = _ocr_cell(api, gray, lines, (xs[c0], ys[r0], xs[c1 + 1], ys[r1 + 1]), scale)
                if not text:
                    continue
                # The same mark once per row ("CO CO CO CO") is a column of
                # per-row icons whose row borders were not drawn, not one
                # merged cell: read each row on its own instead.
                words = text.split()
                if r1 > r0 and len(words) >= r1 - r0 and len(set(words)) <= 2:
                    groups.extend([(r, c) for c in range(c0, c1 + 1)] for r in range(r0, r1 + 1))
                    continue
                filled += 1
                confs.append(conf)
                for r in range(r0, r1 + 1):
                    rows[r][c0] = text
            rows = [r for r in rows if any(r)]
            if filled < MIN_FILLED_CELLS or len(rows) < MIN_ROWS:
                continue
            # Drop columns that no row uses (spacer and checkbox columns).
            keep = [c for c in range(nc) if any(r[c] for r in rows)]
            if len(keep) < MIN_COLS:
                continue
            rows = [[r[c] for c in keep] for r in rows]
            confidence = statistics.mean(confs)
            # Grids that come out of a diagram or an icon strip read as noise.
            if confidence < MIN_TABLE_CONF:
                continue
            tables.append(Table(*box, rows=rows, confidence=confidence))
    return sorted(tables, key=lambda t: (t.top, t.left))

"""Tesseract OCR for raster images embedded in Office documents.

Docling's own image pipeline runs a layout model that is tuned for full pages.
On the small, tightly-cropped screenshots people paste into slides it
mis-segments badly: it garbles a table screenshot into word salad, and it
classifies a boxes-and-arrows diagram as a single "Picture" region so nothing
inside it is ever read. This module talks to Tesseract directly instead.

Two things make the difference on slide crops:

* **Upscale first.** Pasted screenshots are often ~100-200px tall. Tesseract
  wants roughly 30px of x-height, so we grayscale and upsample with LANCZOS.
* **Use sparse-text mode (PSM 11).** The default page-segmentation modes assume
  flowing paragraphs and mangle text that sits inside separate boxes or cells.

Word boxes are then grouped into the *blocks* they sit in, not into full-width
lines. On a flowchart three unrelated boxes share a y-coordinate, and line
grouping interleaves them word by word into unreadable salad; growing each word
box by about a line height and merging the overlaps recovers one block per box.
Blocks that line up into aligned columns are emitted as a Markdown table, and
everything else as one label per line.

This recovers the *labels* in a diagram. It does not recover the arrows between
them -- see pptx_flow for that, which reads the real connectors out of the
PowerPoint file rather than guessing from pixels.
"""

from __future__ import annotations

import os
import statistics
from dataclasses import dataclass
from pathlib import Path

from PIL import Image
from tesserocr import RIL, PSM, PyTessBaseAPI, iterate_level

DEFAULT_SCALE = 3

# The tesserocr wheel bundles the library but no language data, so it has to be
# pointed at a real tessdata directory before it can recognise anything.
_TESSDATA_CANDIDATES = (
    "/opt/homebrew/share/tessdata",  # Homebrew on Apple silicon
    "/usr/local/share/tessdata",  # Homebrew on Intel
    "/usr/share/tesseract-ocr/5/tessdata",  # Debian/Ubuntu
    "/usr/share/tessdata",
)


def default_tessdata() -> str:
    """Locate Tesseract language data, honouring TESSDATA_PREFIX if set."""
    env = os.environ.get("TESSDATA_PREFIX")
    if env and Path(env).is_dir():
        return env
    for path in _TESSDATA_CANDIDATES:
        if Path(path).is_dir():
            return path
    return _TESSDATA_CANDIDATES[0]


DEFAULT_TESSDATA = default_tessdata()
# Per-word floor for dropping stray marks read as "Sve tw &awVw". Kept low
# because correct words on anti-aliased slide text can still score in the 30s.
MIN_CONF = 25.0

# Whole-image floor. Below this the image is decorative and everything Tesseract
# "read" from it is noise, so none of it should reach the Markdown.
MIN_BLOCK_CONF = 70.0

# Fewer labelled boxes than this is a callout or a caption, not a process worth
# asking the vision model to trace arrows through.
MIN_BLOCKS_FOR_DIAGRAM = 5


@dataclass
class Word:
    text: str
    left: int
    top: int
    right: int
    bottom: int
    conf: float

    @property
    def ymid(self) -> float:
        return (self.top + self.bottom) / 2

    @property
    def height(self) -> int:
        return self.bottom - self.top


def _preprocess(path: Path, scale: int) -> Image.Image:
    return _prepare(Image.open(path), scale)


def gray_image(path: Path) -> Image.Image:
    """The image as OCR sees it, at its own size: flattened and grayscale."""
    return _prepare(Image.open(path), 1)


def _prepare(img: Image.Image, scale: int) -> Image.Image:
    # Flatten transparency onto white; slide PNGs are frequently RGBA and a
    # bare convert("L") turns transparent pixels black, swallowing the text.
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        bg = Image.new("RGBA", img.size, (255, 255, 255, 255))
        img = Image.alpha_composite(bg, img)
    img = img.convert("L")
    if scale > 1:
        img = img.resize((img.width * scale, img.height * scale), Image.LANCZOS)
    return img


def _read_words(img: Image.Image, lang: str, tessdata: str) -> list[Word]:
    words: list[Word] = []
    with PyTessBaseAPI(psm=PSM.SPARSE_TEXT, lang=lang, path=tessdata) as api:
        api.SetImage(img)
        api.Recognize()
        it = api.GetIterator()
        if it is None:
            return words
        for w in iterate_level(it, RIL.WORD):
            # tesserocr raises RuntimeError("No text returned") rather than
            # returning None for a word it could not read -- common on images
            # that hold no text at all.
            try:
                text = (w.GetUTF8Text(RIL.WORD) or "").strip()
                conf = w.Confidence(RIL.WORD)
                box = w.BoundingBox(RIL.WORD)
            except RuntimeError:
                continue
            if not text or conf < MIN_CONF or box is None:
                continue
            words.append(Word(text, box[0], box[1], box[2], box[3], conf))
    return words


@dataclass
class Block:
    words: list[Word]

    @property
    def left(self) -> int:
        return min(w.left for w in self.words)

    @property
    def top(self) -> int:
        return min(w.top for w in self.words)

    @property
    def conf(self) -> float:
        return statistics.mean(w.conf for w in self.words)

    @property
    def text(self) -> str:
        """Read the block's own words in their own reading order."""
        return " ".join(
            w.text for line in _group_lines(self.words) for w in line
        )


def _cluster_blocks(words: list[Word], gx: float = 1.6, gy: float = 0.9) -> list[Block]:
    """Group words into the visual blocks they sit in.

    Grouping purely by y-coordinate spans the whole image, which is right for a
    table row but wrong for a diagram: three unrelated boxes at the same height
    get interleaved word by word. Growing each word's box by roughly one line
    height and merging the ones that then overlap recovers the real blocks.
    """
    if not words:
        return []
    h = statistics.median(w.height for w in words)
    px, py = h * gx, h * gy
    parent = list(range(len(words)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i, a in enumerate(words):
        for j in range(i + 1, len(words)):
            b = words[j]
            if (
                a.left - px <= b.right
                and b.left - px <= a.right
                and a.top - py <= b.bottom
                and b.top - py <= a.bottom
            ):
                ra, rb = find(i), find(j)
                if ra != rb:
                    parent[rb] = ra

    groups: dict[int, list[Word]] = {}
    for i, w in enumerate(words):
        groups.setdefault(find(i), []).append(w)
    blocks = [Block(ws) for ws in groups.values()]
    # Reading order: down the image, then across.
    blocks.sort(key=lambda b: (round(b.top / (h * 2)), b.left))
    return blocks


def _rows_of(blocks: list[Block], tol: float) -> list[list[Block]]:
    """Group blocks into visual rows by their top edge."""
    rows: list[list[Block]] = []
    for b in sorted(blocks, key=lambda b: b.top):
        if rows and abs(b.top - rows[-1][0].top) <= tol:
            rows[-1].append(b)
        else:
            rows.append([b])
    return [sorted(r, key=lambda b: b.left) for r in rows]


def _group_lines(words: list[Word]) -> list[list[Word]]:
    """Cluster words into visual lines by vertical overlap."""
    if not words:
        return []
    tol = statistics.median(w.height for w in words) * 0.6
    lines: list[list[Word]] = []
    for w in sorted(words, key=lambda w: w.ymid):
        if lines and abs(w.ymid - statistics.mean(x.ymid for x in lines[-1])) <= tol:
            lines[-1].append(w)
        else:
            lines.append([w])
    return [sorted(line, key=lambda w: w.left) for line in lines]


def _render_line(line: list[Word], gap_factor: float = 2.5) -> str:
    """Join a line, turning unusually wide gaps into column separators."""
    if len(line) == 1:
        return line[0].text
    gaps = [b.left - a.right for a, b in zip(line, line[1:])]
    # A "normal" word space is the typical gap; anything far wider is a column
    # boundary in the original table or a jump between diagram boxes.
    threshold = max(statistics.median(gaps) * gap_factor, line[0].height * 1.5)
    out = line[0].text
    for gap, word in zip(gaps, line[1:]):
        out += (" | " if gap > threshold else " ") + word.text
    return out


@dataclass
class OcrResult:
    text: str
    confidence: float
    words: int
    blocks: int = 0
    is_table: bool = False

    @property
    def is_diagram(self) -> bool:
        """Whether this looks like boxes-and-arrows rather than text or a table.

        Blocks scattered across the image without lining up into columns are
        what a flowchart leaves behind: each box OCRs as its own cluster. That
        is the case where the arrows are worth recovering, and the only case
        where the vision model has anything to add over the labels themselves.
        """
        return (
            self.is_text
            and not self.is_table
            and self.blocks >= MIN_BLOCKS_FOR_DIAGRAM
        )

    @property
    def is_text(self) -> bool:
        """Whether this looks like real text rather than a decorative image.

        Tesseract will happily read "text" out of a photograph or a gradient,
        producing pages of plausible-looking noise. Confidence separates the
        two cleanly: across this corpus genuine text scores 76-96 while
        decorative images (icons, stock photos, abstract backgrounds) never
        break 61.
        """
        return bool(self.text) and self.confidence >= MIN_BLOCK_CONF


def _is_grid(rows: list[list[Block]]) -> bool:
    """Whether the blocks line up as a table rather than scattered boxes.

    A table has several rows of the same width whose columns share left edges.
    A flowchart does not: its boxes sit wherever the diagram needed them.
    """
    full = [r for r in rows if len(r) >= 2]
    if len(full) < 2:
        return False
    width = statistics.mode([len(r) for r in full])
    if width < 2:
        return False
    same = [r for r in full if len(r) == width]
    if len(same) < max(2, len(full) * 0.6):
        return False

    # Cells in a column must share a left edge. Scattered diagram boxes happen
    # to fall into rows of two, but their columns do not line up.
    height = statistics.median(w.height for r in rows for b in r for w in b.words)
    for col in range(width):
        lefts = [r[col].left for r in same]
        if max(lefts) - min(lefts) > height * 2.5:
            return False
    return True


def _grid_rows(blocks: list[Block]) -> list[list[Block]] | None:
    """The blocks arranged as table rows, or None if they are not a table."""
    if not blocks:
        return None
    height = statistics.median(w.height for b in blocks for w in b.words)
    rows = _rows_of(blocks, height * 1.5)
    return rows if _is_grid(rows) else None


def _render_blocks(blocks: list[Block], rows: list[list[Block]] | None) -> str:
    """Lay blocks out as a table when they form a grid, else one per line."""
    if not blocks:
        return ""
    if rows is not None:
        width = statistics.mode([len(r) for r in rows if len(r) >= 2])
        out = []
        for r in rows:
            cells = [b.text.replace("|", "\\|") for b in r]
            cells += [""] * (width - len(cells))
            out.append("| " + " | ".join(cells[:width]) + " |")
        return "\n".join(out)
    return "\n\n".join(b.text for b in blocks if b.text.strip())


def read(
    path: Path,
    lang: str = "eng",
    tessdata: str | None = None,
    scale: int = DEFAULT_SCALE,
) -> OcrResult:
    """OCR one image once, returning its text and how sure Tesseract was."""
    return read_image(Image.open(path), lang, tessdata, scale)


def read_image(
    img: Image.Image,
    lang: str = "eng",
    tessdata: str | None = None,
    scale: int = DEFAULT_SCALE,
) -> OcrResult:
    """`read` for an image already in memory, such as one with regions masked out."""
    words = _read_words(
        _prepare(img, scale), lang, tessdata or default_tessdata()
    )
    blocks = _cluster_blocks(words)
    # A block of one or two characters at low confidence is an arrowhead or a
    # gateway glyph read as letters, not a label.
    blocks = [
        b for b in blocks if len(b.text) > 2 or b.conf >= 80
    ]
    rows = _grid_rows(blocks)
    text = _render_blocks(blocks, rows)
    conf = statistics.mean([w.conf for w in words]) if words else 0.0
    return OcrResult(
        text=text,
        confidence=conf,
        words=len(words),
        blocks=len(blocks),
        is_table=rows is not None,
    )


def ocr_to_markdown(path: Path, **kw: object) -> str:
    """Text only; see `read` when the confidence matters."""
    return read(path, **kw).text  # type: ignore[arg-type]


def mean_confidence(path: Path, **kw: object) -> float:
    return read(path, **kw).confidence  # type: ignore[arg-type]


if __name__ == "__main__":
    import sys

    for arg in sys.argv[1:]:
        p = Path(arg)
        r = read(p)
        verdict = "text" if r.is_text else "decorative / unreadable"
        print(f"===== {p.name} (conf {r.confidence:.1f}, {verdict}) =====")
        print(r.text)
        print()

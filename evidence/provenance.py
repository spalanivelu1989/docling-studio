"""How a document came to exist, which is not the same as what it says.

`md_chunker` strips the HTML comments that record which engine read each
picture -- deliberately, since they describe the conversion and not the
content. The consequence is that nothing downstream can tell a sentence typed
by an author from one a vision model read off a screenshot. This module gets
that back by going to the source file named in `rag_documents.source`, so no
re-indexing is needed.

Granularity is per document. A finer answer would mean re-chunking and
re-embedding the whole corpus; per document is enough to say "almost
everything in this file was transcribed by a model", which is the case that
matters.
"""

from __future__ import annotations

import re
import threading
from dataclasses import dataclass, field
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

# The markers converter.py writes next to each picture it processed.
_VLM = re.compile(r"<!--[^>]*read by (?:Claude|GPT|Qwen)[^>]*-->", re.I)
_OCR = re.compile(r"<!--\s*OCR of [^>]*?(?:confidence|via)[^>]*-->", re.I)
_UNREADABLE = re.compile(r"<!--\s*no readable text in[^>]*-->", re.I)
_ANY_COMMENT = re.compile(r"<!--.*?-->", re.S)
_LOW_CONF = re.compile(r"confidence\s+([0-9.]+)", re.I)

# An email or a meeting note records a discussion, not an implemented state.
_DISCUSSION_BODY = re.compile(r"^(?:To|From|Cc|Sent|Subject):\s|^FYI\s*@|^Dear\s+\w", re.M)
_DISCUSSION_NAME = re.compile(r"(transcript|minutes|\bMoM\b|meeting|WS\d|workshop|RE[_ ]|FW[_ ])", re.I)

# Unfilled boilerplate left behind when an author copied the FS template.
BOILERPLATE = re.compile(
    r"(\*\s*Add (?:details|acronyms|the|a|any)\b"
    r"|\*\s*(?:Describe|Provide|Specify|List|Insert|Explain)\b"
    r"|<Insert\b|\[Insert\b|\bTBD\b|<[A-Z][a-z]+ name>"
    r"|Add details on all the other documents)",
    re.I,
)

_TABLE_SEP = re.compile(r"^[\s|:-]+$")


@dataclass
class Provenance:
    """What is known about how one document was produced."""

    source: str
    title: str = ""
    exists: bool = True
    chars: int = 0
    vlm_images: int = 0
    ocr_images: int = 0
    unreadable_images: int = 0
    low_confidence_ocr: int = 0
    prose_chars: int = 0
    table_cells: int = 0
    empty_cells: int = 0
    boilerplate_hits: int = 0
    is_discussion: bool = False
    is_template: bool = False
    notes: list[str] = field(default_factory=list)

    @property
    def images(self) -> int:
        return self.vlm_images + self.ocr_images + self.unreadable_images

    @property
    def machine_read_ratio(self) -> float:
        """Share of this document's pictures that a model or OCR engine read.

        A proxy, not a measurement: it counts pictures, not characters, because
        the transcribed text is spliced in where the picture was and cannot be
        separated again once the marker is stripped.
        """
        return 0.0 if not self.images else round(
            (self.vlm_images + self.ocr_images) / self.images, 3)

    @property
    def mostly_machine_read(self) -> bool:
        """Enough of the page came from pictures that a quote probably did too."""
        return self.images >= 5 and self.prose_chars < 250 * self.images

    @property
    def sparse_ratio(self) -> float:
        return 0.0 if not self.table_cells else round(self.empty_cells / self.table_cells, 3)

    def flags(self) -> list[str]:
        out = []
        if self.mostly_machine_read:
            out.append("mostly_machine_read")
        if self.unreadable_images:
            out.append("has_unreadable_images")
        if self.is_discussion:
            out.append("discussion")
        if self.is_template:
            out.append("template")
        if self.sparse_ratio >= 0.6 and self.table_cells >= 100:
            out.append("sparse_table")
        if self.boilerplate_hits >= 5:
            out.append("unfilled_boilerplate")
        return out

    def summary(self) -> str:
        """One line the agent can read, in its tool results."""
        bits = []
        if self.mostly_machine_read:
            bits.append(
                f"{self.vlm_images + self.ocr_images} of {self.images} pictures were read by a "
                f"model or OCR and there is little typed prose — treat quoted values as transcribed")
        elif self.vlm_images or self.ocr_images:
            bits.append(f"{self.vlm_images + self.ocr_images} picture(s) read by a model or OCR")
        if self.unreadable_images:
            bits.append(f"{self.unreadable_images} picture(s) could not be read at all")
        if self.is_discussion:
            bits.append("this is an email or meeting note — it records discussion, not an implemented state")
        if self.is_template:
            bits.append("this is a blank template, not a filled document")
        if "sparse_table" in self.flags():
            bits.append(f"{self.sparse_ratio:.0%} of its table cells are empty")
        if "unfilled_boilerplate" in self.flags():
            bits.append(f"{self.boilerplate_hits} unfilled template phrases remain in it")
        return "; ".join(bits)

    def as_dict(self) -> dict:
        return {
            "title": self.title,
            "flags": self.flags(),
            "machine_read_ratio": self.machine_read_ratio,
            "images": self.images,
            "unreadable_images": self.unreadable_images,
            "note": self.summary(),
        }


_lock = threading.Lock()
_cache: dict[str, tuple[float, Provenance]] = {}


def of(source: str, title: str = "") -> Provenance:
    """Read (and cache, by mtime) the provenance of one source file."""
    path = Path(source)
    if not path.is_absolute():
        path = BASE_DIR / source
    key = str(path)
    try:
        mtime = path.stat().st_mtime
    except OSError:
        return Provenance(source=source, title=title, exists=False,
                          notes=["source file is not on disk; provenance unknown"])
    with _lock:
        hit = _cache.get(key)
        if hit and hit[0] == mtime:
            return hit[1]
    p = _read(path, source, title)
    with _lock:
        _cache[key] = (mtime, p)
    return p


def _read(path: Path, source: str, title: str) -> Provenance:
    text = path.read_text(encoding="utf-8", errors="ignore")
    body = _ANY_COMMENT.sub("", text)

    rows = [l for l in body.splitlines() if l.startswith("|") and not _TABLE_SEP.match(l)]
    cells = [c.strip() for l in rows for c in l.split("|")[1:-1]]
    prose = "\n".join(l for l in body.splitlines()
                      if l.strip() and not l.startswith("|") and not l.startswith("#"))

    return Provenance(
        source=source,
        title=title or path.stem,
        chars=len(text),
        vlm_images=len(_VLM.findall(text)),
        ocr_images=len(_OCR.findall(text)),
        unreadable_images=len(_UNREADABLE.findall(text)),
        low_confidence_ocr=sum(1 for m in _LOW_CONF.findall(text) if _float(m) < 60),
        prose_chars=len(prose),
        table_cells=len(cells),
        empty_cells=sum(1 for c in cells if not c),
        boilerplate_hits=len(BOILERPLATE.findall(body)),
        is_discussion=bool(_DISCUSSION_BODY.search(body)) or bool(_DISCUSSION_NAME.search(path.name)),
        # "Template" in the file name is the one reliable signal; boilerplate
        # phrases alone are not, because filled specs keep some of them.
        is_template="template" in path.name.lower(),
    )


def _float(s: str) -> float:
    try:
        return float(s)
    except ValueError:
        return 100.0


def is_boilerplate(quote: str) -> bool:
    """True when a quote is unfilled template text rather than content.

    Checked per quote, which is sharper than any document-level flag: a filled
    specification still carries boilerplate in the sections nobody completed,
    and citing one of those is citing nothing.
    """
    q = quote.strip()
    if not q:
        return True
    if BOILERPLATE.search(q):
        return True
    # A row of empty table cells, e.g. "|  |  |  |"
    if q.startswith("|") and not [c for c in q.split("|")[1:-1] if c.strip()]:
        return True
    return False

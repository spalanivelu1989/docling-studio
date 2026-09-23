"""Which documents count as separate sources, and which are the same thing twice.

The scoring rule pays for corroboration: a second document that agrees is
worth +0.15. That is only sound if the second document is genuinely a second
document. The corpus holds two versions of one specification (cosine 0.974),
four fills of one FS template (0.94-0.97) and three variants of one sample
workbook -- counting any of those pairs as agreement inflates confidence for
free.

Nothing new is indexed. The comparison uses the chunk embeddings already in
pgvector: the mean of a document's chunk vectors is its centroid, and two
centroids close in cosine are near-duplicates.
"""

from __future__ import annotations

import re
import sys
import threading
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import rag  # noqa: E402

# 0.93 sits above every unrelated pair measured on this corpus. It is not
# sufficient on its own: four different specifications written from the same FS
# template reach 0.94-0.97 purely on shared boilerplate, and calling those one
# source would suppress real corroboration. A pair is only treated as the same
# source when it ALSO shares an identity -- a ticket number, or most of a title.
DUPLICATE_AT = float(__import__("os").environ.get("EVIDENCE_DUPLICATE_AT", "0.93"))
TITLE_OVERLAP_AT = 0.5

_TICKET = re.compile(r"\b(?:SPARK|L2C|GAP)[-_ ]?(\d{4,6})\b", re.I)
_STOP = {"spark", "l2c", "fs", "docx", "xlsx", "pptx", "pdf", "final", "version",
         "copy", "updated", "draft", "the", "and", "for", "of"}


def _tokens(title: str) -> set[str]:
    words = re.findall(r"[a-z0-9]+", title.lower())
    return {w for w in words if w not in _STOP and not w.isdigit() and len(w) > 2}


def _same_identity(a: str, b: str) -> bool:
    """Do these two titles name the same artefact, rather than two artefacts
    that happen to be written from one template?"""
    ta, tb = set(_TICKET.findall(a)), set(_TICKET.findall(b))
    if ta and tb:
        return bool(ta & tb)          # same ticket number -> same artefact
    if ta or tb:
        return False                  # one is ticketed and the other is not
    wa, wb = _tokens(a), _tokens(b)
    if not wa or not wb:
        return False
    return len(wa & wb) / len(wa | wb) >= TITLE_OVERLAP_AT

# The vector type modifier has to be a literal -- Postgres rejects a bind
# parameter there -- so the dimension is interpolated. It comes from rag.py's
# configuration, never from a caller.
def _centroids_sql() -> str:
    return f"""
WITH cen AS (
    SELECT document_id, AVG(embedding)::vector({int(rag.EMBED_DIMENSION)}) AS v
    FROM rag_chunks GROUP BY document_id
)
SELECT a.document_id, b.document_id, 1 - (a.v <=> b.v) AS sim
FROM cen a JOIN cen b ON a.document_id < b.document_id
WHERE 1 - (a.v <=> b.v) >= %(threshold)s
"""


@dataclass
class Duplicates:
    """Near-duplicate groups over the indexed corpus, by document title."""

    groups: list[set[str]]
    pairs: dict[tuple[str, str], float]

    def group_of(self, title: str) -> set[str]:
        for g in self.groups:
            if title in g:
                return g
        return {title}

    def same_source(self, a: str, b: str) -> bool:
        return a == b or self.group_of(a) == self.group_of(b) and a in self.group_of(b)

    def similarity(self, a: str, b: str) -> float | None:
        return self.pairs.get((a, b)) or self.pairs.get((b, a))

    def independent_count(self, titles) -> int:
        """How many genuinely separate sources a set of documents amounts to."""
        seen: list[set[str]] = []
        for t in set(titles):
            g = self.group_of(t)
            if not any(g & s for s in seen):
                seen.append(g)
        return len(seen)

    def note_for(self, titles) -> str:
        titles = list(dict.fromkeys(titles))
        n = self.independent_count(titles)
        if n == len(titles):
            return ""
        dupes = []
        for i, a in enumerate(titles):
            for b in titles[i + 1:]:
                s = self.similarity(a, b)
                if s is not None:
                    dupes.append(f"“{a[:44]}” and “{b[:44]}” are near-identical ({s:.2f})")
        return (f"{len(titles)} documents but only {n} independent source(s)"
                + ("; " + "; ".join(dupes[:3]) if dupes else ""))


_lock = threading.Lock()
_cached: Duplicates | None = None


def load(conn=None, force: bool = False) -> Duplicates:
    global _cached
    with _lock:
        if _cached is not None and not force:
            return _cached
    # One pass over the whole corpus. This used to be one pass per category
    # database, with the pairs resolved to titles inside the loop and only then
    # merged, and it could not see the same document filed under two
    # categories -- the comparison never crossed a database. It does now.
    #
    # Without a corpus there is nothing to compare, which is not an error: the
    # scorer asks for this on every run, and an installation with no index yet
    # should score its evidence as independent rather than fail.
    pairs_by_title: list[tuple[str, str, float]] = []
    reachable = True
    try:
        c = conn if conn is not None else rag.connection()
        rows = c.execute(_centroids_sql(), {"threshold": DUPLICATE_AT}).fetchall()
        titles = dict(c.execute("SELECT id, title FROM rag_documents").fetchall())
        pairs_by_title = [
            (titles[a_id], titles[b_id], float(sim))
            for a_id, b_id, sim in rows
            if titles.get(a_id) and titles.get(b_id)
        ]
    except Exception as exc:
        # Not cached below, so a corpus that is briefly unreachable disables
        # this for one call rather than for the life of the process.
        reachable = False
        print(f"  ! near-duplicate check skipped: {exc.__class__.__name__}: "
              f"{str(exc).splitlines()[0]}", file=sys.stderr)

    pairs: dict[tuple[str, str], float] = {}
    # Union-find over the near-duplicate pairs, so a chain of three versions
    # collapses to one group rather than two overlapping pairs.
    parent: dict[str, str] = {}

    def find(x: str) -> str:
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: str, b: str) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    for a, b, sim in pairs_by_title:
        if not _same_identity(a, b):
            continue
        pairs[(a, b)] = round(sim, 3)
        union(a, b)

    grouped: dict[str, set[str]] = {}
    for t in parent:
        grouped.setdefault(find(t), set()).add(t)

    dupes = Duplicates(groups=[g for g in grouped.values() if len(g) > 1], pairs=pairs)
    if reachable:
        with _lock:
            _cached = dupes
    return dupes

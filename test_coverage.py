"""What the coverage report notices, and what it refuses to invent.

Run: python test_coverage.py

No Postgres and no graph build: the three stores are stubbed, because what is
being tested is the comparison, not how each store is read. Every case here is
a way the three can drift apart, and each was found in the real corpus before
it was written down:

  * a deck on disk and in the graph but not indexed -- traversal can name it,
    retrieval cannot reach it, so nothing may be cited from it;
  * a PDF the corpus files as DR and the graph files as UNFILED, because one
    goes by the stored category and the other by the folder;
  * a document whose only copy is its Markdown, with no original to review the
    conversion against.

The last test is the one that matters most: a clean corpus must report clean.
A checker that always finds something is a checker nobody reads.
"""

from __future__ import annotations

import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

import app  # noqa: E402
import coverage  # noqa: E402
import knowledge_graph as kg  # noqa: E402
import rag  # noqa: E402

ROOT_TMP = Path(tempfile.mkdtemp(prefix="docling-coverage-")).resolve()
TMP = ROOT_TMP
_REAL = {}


def setup() -> None:
    _REAL["base"] = coverage.BASE
    _REAL["folders"] = kg.source_folders
    _REAL["graph"] = kg.extract_graph
    _REAL["documents"] = rag.documents
    _REAL["original"] = app._original_of
    coverage.BASE = ROOT_TMP


def teardown() -> None:
    coverage.BASE = _REAL["base"]
    kg.source_folders = _REAL["folders"]
    kg.extract_graph = _REAL["graph"]
    rag.documents = _REAL["documents"]
    app._original_of = _REAL["original"]
    shutil.rmtree(ROOT_TMP, ignore_errors=True)


_case = 0


def world(files: dict[str, str], indexed: list, graph: list[tuple[str, str]],
          originals: set[str] | None = None) -> dict:
    """Lay out one scenario: `files` is {relative path: category of its folder},
    `indexed` and `graph` are the relative paths each store knows about.

    Each call gets a tree of its own. Sharing one would let a file written by
    an earlier test satisfy a later one, and a suite that passes because of
    what ran before it is not telling anybody anything."""
    global _case, TMP
    _case += 1
    TMP = ROOT_TMP / f"case{_case}"
    TMP.mkdir(parents=True, exist_ok=True)
    coverage.BASE = TMP
    for rel in list(files) + [g[0] for g in graph]:
        p = TMP / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        if rel in files and not p.exists():
            p.write_text("# doc\n")

    folders: dict[Path, str] = {}
    for rel, code in files.items():
        folders[(TMP / rel).parent] = code
    kg.source_folders = lambda: sorted(folders.items(), key=lambda kv: (kv[1], str(kv[0])))

    rag.documents = lambda: [
        {"id": i, "source": str((TMP / rel).resolve()), "title": Path(rel).stem,
         "category": cat, "chunks": 3, "tokens": 100, "indexed_at": None}
        for i, (rel, cat) in enumerate(indexed, 1)
    ] if indexed and isinstance(indexed[0], tuple) else [
        {"id": i, "source": str((TMP / rel).resolve()), "title": Path(rel).stem,
         "category": files.get(rel, "DR"), "chunks": 3, "tokens": 100, "indexed_at": None}
        for i, rel in enumerate(indexed, 1)
    ]

    kg.extract_graph = lambda: {"nodes": [
        {"type": "document", "source": rel, "label": Path(rel).stem,
         "category": cat, "degree": 2} for rel, cat in graph
    ]}

    keep = originals if originals is not None else set(files)
    app._original_of = lambda path: (
        Path(str(path) + ".orig") if str(Path(path).resolve().relative_to(TMP)) in keep else None
    )
    return coverage.collect()


def kinds(report: dict, name_part: str) -> list[str]:
    return sorted(i["kind"] for i in report["issues"] if name_part in i["source"])


# --- the tests ----------------------------------------------------------------

def test_a_corpus_that_agrees_reports_clean():
    """A checker that always finds something is a checker nobody reads."""
    r = world(files={"dr/markdown/a_pptx.md": "DR", "pkg/markdown/b_docx.md": "PKG"},
              indexed=["dr/markdown/a_pptx.md", "pkg/markdown/b_docx.md"],
              graph=[("dr/markdown/a_pptx.md", "DR"), ("pkg/markdown/b_docx.md", "PKG")])
    assert r["issues"] == [], f"invented problems: {r['issues']}"
    assert r["summary"]["clean"] == 2
    assert r["summary"]["on_disk"] == r["summary"]["indexed"] == r["summary"]["in_graph"] == 2


def test_on_disk_and_in_the_graph_but_not_indexed():
    """The real one: traversal names a deck that retrieval cannot reach."""
    r = world(files={"dr/markdown/deck_pptx.md": "DR"},
              indexed=[],
              graph=[("dr/markdown/deck_pptx.md", "DR")])
    assert kinds(r, "deck_pptx") == ["not_indexed"]
    assert r["summary"]["not_indexed"] == 1
    assert r["summary"]["clean"] == 0


def test_indexed_but_invisible_to_the_graph():
    r = world(files={"dr/markdown/only_docx.md": "DR"},
              indexed=["dr/markdown/only_docx.md"],
              graph=[])
    assert kinds(r, "only_docx") == ["not_in_graph"]


def test_indexed_but_the_file_is_gone():
    """Chunks stay retrievable and go on citing a file nobody can open."""
    r = world(files={}, indexed=["dr/markdown/ghost_pdf.md"], graph=[])
    assert "file_missing" in kinds(r, "ghost_pdf")
    assert r["summary"]["file_missing"] == 1


def test_the_two_stores_can_disagree_about_the_category():
    """The corpus goes by the stored category, the graph by the folder."""
    r = world(files={"knowledge_base/returns_pdf.md": "UNFILED"},
              indexed=[("knowledge_base/returns_pdf.md", "DR")],
              graph=[("knowledge_base/returns_pdf.md", "UNFILED")])
    assert "category_mismatch" in kinds(r, "returns_pdf")
    detail = next(i["detail"] for i in r["issues"] if i["kind"] == "category_mismatch")
    assert "corpus says DR" in detail and "graph says UNFILED" in detail


def test_a_document_with_no_original_is_noted_not_hidden():
    r = world(files={"knowledge_base/md_only_pdf.md": "UNFILED"},
              indexed=["knowledge_base/md_only_pdf.md"],
              graph=[("knowledge_base/md_only_pdf.md", "UNFILED")],
              originals=set())
    assert kinds(r, "md_only_pdf") == ["no_original"]
    assert r["summary"]["no_original"] == 1


def test_a_shadowed_twin_is_reported_rather_than_dropped():
    """The graph keys its scan by file NAME, so the second file of a name is
    never walked. Silently absent is the worst kind of absent."""
    r = world(files={"dr/markdown/same_pdf.md": "DR", "pkg/markdown/same_pdf.md": "PKG"},
              indexed=["dr/markdown/same_pdf.md", "pkg/markdown/same_pdf.md"],
              graph=[("dr/markdown/same_pdf.md", "DR")])
    assert r["summary"]["shadowed"] == 1, "a name collision went unreported"
    shadow = next(i for i in r["issues"] if i["kind"] == "shadowed")
    assert "Kept instead" in shadow["detail"]


def test_issues_are_ordered_worst_first():
    r = world(files={"dr/markdown/x_pptx.md": "DR"},
              indexed=["dr/markdown/y_pdf.md"],
              graph=[("dr/markdown/x_pptx.md", "DR")])
    order = [i["kind"] for i in r["issues"]]
    assert order.index("file_missing") < order.index("not_indexed"), order


def test_every_issue_kind_has_an_explanation():
    for kind in coverage.SEVERITY:
        assert coverage.ISSUE_HELP.get(kind), f"{kind} has a severity but nothing explaining it"


def main() -> int:
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    setup()
    failed = 0
    try:
        for fn in tests:
            try:
                fn()
            except Exception as exc:
                failed += 1
                print(f"  FAIL {fn.__name__}: {exc.__class__.__name__}: {exc}")
            else:
                print(f"  ok   {fn.__name__}")
    finally:
        teardown()
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

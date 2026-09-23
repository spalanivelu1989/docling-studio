"""Finding the original document behind an indexed Markdown file.

Run: python test_originals.py

No Postgres, no network: this is about where a file is looked for, so it runs
against a throwaway tree laid out like the real one.

The review page pairs a document with its own Markdown, and nothing in the
database says where the document is -- rag_documents stores the Markdown path,
because the Markdown is what was chunked. So the original is recovered by
convention, from two places:

  * beside the markdown/ folder it was indexed from, which covers everything
    converted in bulk;
  * the upload job that produced it, for anything added through the browser.
    knowledge_base/ holds only Markdown, but .workdir/<id>/ keeps the file the
    upload was given until that upload is cleared. Missing this second place is
    why a PDF added from the browser reported "nothing to compare against"
    while its own pages sat rendered on disk.
"""

from __future__ import annotations

import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

import app  # noqa: E402

TMP = Path(tempfile.mkdtemp(prefix="docling-originals-"))
_REAL_WORKDIR = app.WORKDIR


def setup() -> None:
    app.WORKDIR = TMP / ".workdir"
    app.WORKDIR.mkdir(parents=True)


def teardown() -> None:
    app.WORKDIR = _REAL_WORKDIR
    shutil.rmtree(TMP, ignore_errors=True)


def corpus_doc(folder: str, stem: str, suffix: str, with_original: bool) -> Path:
    """<folder>/markdown/<stem>_<ext>.md, optionally beside <folder>/<stem>.<ext>."""
    md_dir = TMP / folder / "markdown"
    md_dir.mkdir(parents=True, exist_ok=True)
    md = md_dir / f"{stem}_{suffix}.md"
    md.write_text("# doc\n")
    if with_original:
        (TMP / folder / f"{stem}.{suffix}").write_text("original bytes")
    return md


def upload_job(job_id: str, name: str, suffix: str, keep_source: bool = True) -> Path:
    job = app.WORKDIR / job_id
    job.mkdir(parents=True, exist_ok=True)
    (job / "name.txt").write_text(name)
    if keep_source:
        (job / f"source.{suffix}").write_text("original bytes")
    return job


# --- the tests ----------------------------------------------------------------

def test_an_original_beside_the_markdown_folder_is_found():
    md = corpus_doc("spark/pkg", "Pricing", "xlsx", with_original=True)
    found = app._original_of(md)
    assert found is not None, "the ordinary case stopped working"
    assert found.name == "Pricing.xlsx"
    assert found.parent.name == "pkg", "looked in markdown/ rather than beside it"


def test_a_browser_upload_is_recovered_from_its_job():
    """The reported bug: knowledge_base/ holds only Markdown, so this used to
    report 'nothing to compare against' while the PDF sat in .workdir."""
    md_dir = TMP / "knowledge_base"
    md_dir.mkdir(parents=True, exist_ok=True)
    md = md_dir / "Customer Returns_pdf.md"
    md.write_text("# returns\n")
    upload_job("47df0166bbc1", "Customer Returns.pdf", "pdf")

    found = app._original_of(md)
    assert found is not None, "the upload job holding the original was not found"
    assert found.name == "source.pdf"
    assert found.parent.name == "47df0166bbc1"


def test_the_original_beside_it_wins_over_an_upload():
    """Both exist: prefer the corpus copy, which is the one that will still be
    there after somebody clears their uploads."""
    md = corpus_doc("spark/dr", "Returns", "pptx", with_original=True)
    upload_job("deadbeef0001", "Returns.pptx", "pptx")
    found = app._original_of(md)
    assert found.parent.name == "dr", "an upload job shadowed the corpus copy"


def test_a_cleared_upload_finds_nothing():
    """Clearing the upload really does remove the only copy. Saying so is the
    point; pretending otherwise would send the page to a file that is gone."""
    md_dir = TMP / "knowledge_base"
    md_dir.mkdir(parents=True, exist_ok=True)
    md = md_dir / "Gone_pdf.md"
    md.write_text("# gone\n")
    upload_job("cafebabe0001", "Gone.pdf", "pdf", keep_source=False)
    assert app._original_of(md) is None


def test_a_job_for_a_different_document_is_not_offered():
    md_dir = TMP / "knowledge_base"
    md_dir.mkdir(parents=True, exist_ok=True)
    md = md_dir / "Wanted_pdf.md"
    md.write_text("# wanted\n")
    upload_job("0badc0de0001", "Something Else.pdf", "pdf")
    assert app._original_of(md) is None, "matched an unrelated upload by suffix alone"


def test_the_match_ignores_case():
    md_dir = TMP / "knowledge_base"
    md_dir.mkdir(parents=True, exist_ok=True)
    md = md_dir / "Report_PDF.md"
    md.write_text("# r\n")
    upload_job("1111aaaa2222", "report.pdf", "pdf")
    assert app._original_of(md) is not None, "case alone defeated the lookup"


def test_a_markdown_with_no_suffix_in_its_name_has_no_original():
    md_dir = TMP / "knowledge_base"
    md_dir.mkdir(parents=True, exist_ok=True)
    md = md_dir / "notes.md"
    md.write_text("# notes\n")
    assert app._original_name(md) is None
    assert app._original_of(md) is None


def test_an_original_in_a_format_we_cannot_open_is_refused():
    """A .zip beside the Markdown is not something the preview pane can show,
    and offering it would fail further downstream."""
    md = corpus_doc("spark/pkg", "Bundle", "zip", with_original=True)
    assert app._original_of(md) is None


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

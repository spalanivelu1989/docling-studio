"""A category chosen by a person has to survive on disk.

Run: python test_category_durability.py

Needs Postgres (a throwaway database), not Ollama and not an API key: the
embedding call is stubbed, because what is being tested is where the decision
is written, not what the vectors are.

The bug this closes: choosing a category in the UI wrote it to the database row
and nowhere else. Three things then went wrong at once.

  * The knowledge graph builds from Markdown and never reads the database, so
    it filed the document by the folder instead -- DR on the row, UNFILED in
    the graph, for the same file.
  * `rag.py index` re-derives the category from the file, so re-indexing the
    folder SILENTLY RESET the document to whatever the folder implied. The
    choice was not just invisible, it was destructible.
  * And recording it naively would have been worse than the disease: front
    matter changes the file, a changed file re-embeds, and re-embedding
    renumbers every chunk id -- staling the citations in stored runs. Writing
    down a decision must not cost the evidence.

So the last test here is the one that matters: recording a category must not
move a single chunk id.
"""

from __future__ import annotations

import sys
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import numpy as np

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

import knowledge_graph as kg  # noqa: E402
import rag  # noqa: E402

TEST_DATABASE = "docling_test_category"
_original_base_url = rag.base_url
_original_embed = rag.embed


def _url(name: str) -> str:
    p = urlsplit(_original_base_url())
    return urlunsplit((p.scheme, p.netloc, f"/{name}", p.query, p.fragment))


def _admin():
    import psycopg

    return psycopg.connect(_url("postgres"), autocommit=True)


def setup() -> None:
    with _admin() as c:
        c.execute(f'DROP DATABASE IF EXISTS "{TEST_DATABASE}" WITH (FORCE)')
        c.execute(f'CREATE DATABASE "{TEST_DATABASE}"')
    rag.base_url = lambda: _url(TEST_DATABASE)
    rag.close()
    rag._schema_ready = False
    rag.create_schema(rag.connection(schema=False))
    # No Ollama here: a deterministic vector per text is enough to store rows.
    rag.embed = lambda texts, _kind: [
        np.ones(rag.EMBED_DIMENSION, dtype=np.float32) / np.sqrt(rag.EMBED_DIMENSION)
        for _ in texts
    ]


def teardown() -> None:
    rag.close()
    rag.base_url = _original_base_url
    rag.embed = _original_embed
    with _admin() as c:
        c.execute(f'DROP DATABASE IF EXISTS "{TEST_DATABASE}" WITH (FORCE)')


import tempfile  # noqa: E402

TMP = Path(tempfile.mkdtemp(prefix="docling-category-")).resolve()


def a_file(folder: str, name: str, body: str = "# Returns\n\nSome body text.\n") -> Path:
    d = TMP / folder
    d.mkdir(parents=True, exist_ok=True)
    p = d / name
    p.write_text(body)
    return p


def chunk_ids(path: Path) -> list[int]:
    return [r[0] for r in rag.connection().execute(
        "SELECT c.id FROM rag_chunks c JOIN rag_documents d ON d.id = c.document_id"
        " WHERE d.source = %s ORDER BY c.id", (str(path.resolve()),)).fetchall()]


# --- the tests ----------------------------------------------------------------

def test_declaring_a_category_is_idempotent_and_keeps_other_keys():
    text = "---\ntitle: Returns\n---\n\n# Returns\n"
    once = rag.declare_category(text, "DR")
    twice = rag.declare_category(once, "DR")
    assert once == twice, "declaring the same category twice changed the file"
    assert rag.front_matter(once)["category"] == "DR"
    assert rag.front_matter(once)["title"] == "Returns", "an unrelated key was dropped"
    assert once.count("category:") == 1, "a second category key was added"


def test_front_matter_never_reaches_a_chunk():
    plain = a_file("pkg/markdown", "plain_docx.md")
    declared = a_file("pkg/markdown", "declared_docx.md",
                      rag.declare_category("# Returns\n\nSome body text.\n", "DR"))
    assert rag.chunk_file(plain)[0].content == rag.chunk_file(declared)[0].content


def test_the_fingerprint_ignores_the_category():
    """Otherwise recording one re-embeds the document it is recording."""
    body = "# Returns\n\nSome body text.\n"
    assert (rag.fingerprint(body)
            == rag.fingerprint(rag.declare_category(body, "DR"))
            == rag.fingerprint(rag.declare_category(body, "PKG")))


def test_category_for_prefers_the_file_over_the_folder():
    p = a_file("knowledge_base", "returns_pdf.md",
               rag.declare_category("# Returns\n", "DR"))
    assert rag.category_for(p) == "DR", "the folder outranked the file's own declaration"


def test_the_graph_reads_the_declaration_too():
    """The graph builds from Markdown and never reads the database, so this is
    the only way it can agree with the corpus."""
    p = a_file("kb_graph", "declared_pdf.md", rag.declare_category("# R\n", "DR"))
    real = kg.source_folders
    kg.source_folders = lambda: [(p.parent, "UNFILED")]
    try:
        [(_, _, code)] = kg.collect_files()
    finally:
        kg.source_folders = real
    assert code == "DR", f"the graph filed a DR document as {code}"


def test_re_indexing_no_longer_resets_the_choice():
    """The destructive half of the bug: indexing re-derives the category from
    the file, so a choice kept only on the row was wiped by the next index."""
    p = a_file("knowledge_base", "keeps_pdf.md")
    rag.index_path(p, category="DR")
    assert rag.documents()[0]["category"] == "DR"

    rag.record_category(p, "DR")            # what the UI now does at ingest
    rag.index_path(p)                       # a later bulk re-index, no category given
    assert rag.documents()[0]["category"] == "DR", \
        "re-indexing reset the document to the folder's category"


def test_recording_a_category_moves_no_chunk_ids():
    """The one that protects stored runs: a citation is a chunk id."""
    p = a_file("knowledge_base", "stable_pdf.md",
               "# Returns\n\nOne.\n\n## More\n\nTwo.\n")
    rag.index_path(p, category="DR")
    before = chunk_ids(p)
    assert before, "nothing was indexed, so this proves nothing"

    changed = rag.record_category(p, "PKG")
    assert changed, "the file was not actually rewritten"
    rag.index_path(p)                       # the next index sees the new bytes

    assert chunk_ids(p) == before, "recording a category renumbered the chunks"
    assert rag.documents()[0]["category"] == "PKG"


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
        import shutil
        shutil.rmtree(TMP, ignore_errors=True)
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

"""Unit tests for the guarantees the corpus schema makes.

Run: python test_rag.py

These need Postgres, but not the corpus and not Ollama. Everything happens in a
throwaway database that is created and dropped here, with vectors made up on
the spot -- what is being tested is the schema and the queries around it, not
what bge-m3 thinks of anything.

Each of these was a bug, or was unrepresentable only after the per-category
databases were merged back into one:

  * a source path is an identity again -- UNIQUE(source) held per database, so
    the same file could be indexed twice and one delete removed both;
  * re-tagging a document carries its chunks in one statement, rather than in a
    second one that could fail on its own and leave them disagreeing;
  * a scoped search cannot see another category, which used to be true because
    the rows were somewhere else and is now true because of a WHERE clause;
  * documents_named returns one row per document, which is what the delete
    endpoint needs to refuse an ambiguous name;
  * deleting a document takes its chunks with it.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np

import rag

TEST_DATABASE = "docling_test_rag"
_original_base_url = rag.base_url


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


def teardown() -> None:
    rag.close()
    rag.base_url = _original_base_url
    with _admin() as c:
        c.execute(f'DROP DATABASE IF EXISTS "{TEST_DATABASE}" WITH (FORCE)')


def vector(seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    v = rng.standard_normal(rag.EMBED_DIMENSION).astype(np.float32)
    return v / np.linalg.norm(v)


def add(source: str, category: str, *texts: str, seed: int = 0) -> int:
    """One document and its chunks, written the way store() writes them."""
    conn = rag.connection()
    with conn.transaction():
        doc = conn.execute(
            "INSERT INTO rag_documents (source, title, fingerprint, category)"
            " VALUES (%s, %s, %s, %s) RETURNING id",
            (source, Path(source).stem, f"fp-{source}", category),
        ).fetchone()[0]
        for i, text in enumerate(texts):
            conn.execute(
                "INSERT INTO rag_chunks (document_id, chunk_index, heading_path, content,"
                " tokens, embedding, category, tsv)"
                f" VALUES (%s, %s, '', %s, %s, %s, %s, to_tsvector('{rag.TEXT_SEARCH_CONFIG}', %s))",
                (doc, i, text, len(text.split()), vector(seed + i), category, text),
            )
    return doc


def clear() -> None:
    rag.connection().execute("TRUNCATE TABLE rag_documents CASCADE")


# --- the tests ----------------------------------------------------------------

def test_a_source_path_can_only_be_indexed_once():
    clear()
    add("/corpus/pkg/spec.md", "PKG", "the package says this")
    try:
        add("/corpus/pkg/spec.md", "DR", "the design record says that")
    except Exception:
        pass
    else:
        raise AssertionError("the same path was indexed twice; UNIQUE(source) is not holding")
    assert rag.counts() == (1, 1)


def test_two_files_of_one_name_are_two_documents():
    # A name is not an identity and never was: an upload lands in
    # knowledge_base/ whatever it is filed under. This is the case the delete
    # endpoint has to refuse rather than guess at.
    clear()
    add("/corpus/knowledge_base/spec.md", "UNFILED", "one")
    add("/corpus/pkg/markdown/spec.md", "PKG", "two")
    named = rag.documents_named("spec.md")
    assert len(named) == 2, named
    assert {n["source"] for n in named} == {"/corpus/knowledge_base/spec.md",
                                            "/corpus/pkg/markdown/spec.md"}
    assert {n["category"] for n in named} == {"UNFILED", "PKG"}


def test_retagging_a_document_carries_its_chunks():
    clear()
    add("/corpus/pkg/moving.md", "PKG", "alpha", "beta", "gamma")
    rag.recategorise(rag.connection(), Path("/corpus/pkg/moving.md"), "DR")
    rows = rag.connection().execute(
        "SELECT DISTINCT c.category FROM rag_chunks c"
        " JOIN rag_documents d ON d.id = c.document_id WHERE d.source = %s",
        ("/corpus/pkg/moving.md",),
    ).fetchall()
    assert rows == [("DR",)], rows
    assert rag.totals() == [("DR", 1, 3)]


def test_a_chunk_cannot_disagree_with_its_document():
    # The foreign key on (document_id, category), not a repair pass.
    clear()
    doc = add("/corpus/pkg/fixed.md", "PKG", "alpha")
    try:
        rag.connection().execute(
            "UPDATE rag_chunks SET category = 'DR' WHERE document_id = %s", (doc,)
        )
    except Exception:
        return
    raise AssertionError("a chunk was moved to a category its document is not in")


def test_a_scoped_search_cannot_see_another_category():
    clear()
    add("/corpus/pkg/a.md", "PKG", "delivery block on the sales order", seed=1)
    add("/corpus/dr/b.md", "DR", "delivery block on the sales order", seed=2)
    for scope, expect in ((["PKG"], {"PKG"}), (["DR"], {"DR"}), (None, {"PKG", "DR"})):
        hits = rag.search("delivery block", k=8, mode="hybrid",
                          query_vector=vector(1), categories=scope)
        assert hits, f"nothing came back for {scope}"
        assert {h.category for h in hits} == expect, (scope, [h.category for h in hits])


def test_a_chunk_key_is_checked_against_the_row():
    # "PKG:412" used to name the database to look in. It now names what the row
    # must say, so a key from somewhere else fails instead of returning a
    # different chunk that happens to share an id.
    clear()
    add("/corpus/pkg/keyed.md", "PKG", "alpha")
    cid = rag.connection().execute("SELECT id FROM rag_chunks").fetchone()[0]
    assert rag.chunk(f"PKG:{cid}")["content"] == "alpha"
    assert rag.chunk(f"DR:{cid}") is None
    assert rag.chunk(f"PKG:{cid + 9999}") is None


def test_deleting_a_document_takes_its_chunks():
    clear()
    add("/corpus/pkg/gone.md", "PKG", "alpha", "beta")
    add("/corpus/pkg/stays.md", "PKG", "gamma")
    assert rag.counts() == (2, 3)
    assert rag.delete_document("gone.md") == 1
    assert rag.counts() == (1, 1)
    assert rag.connection().execute("SELECT count(*) FROM rag_chunks").fetchone()[0] == 1


def test_a_delete_can_be_aimed_by_source():
    clear()
    add("/corpus/knowledge_base/same.md", "UNFILED", "one")
    add("/corpus/pkg/markdown/same.md", "PKG", "two")
    assert rag.delete_document("same.md", source="/corpus/pkg/markdown/same.md") == 1
    left = rag.documents_named("same.md")
    assert [d["source"] for d in left] == ["/corpus/knowledge_base/same.md"]
    # And without one it still removes every document of that name, which is
    # why the endpoint refuses an ambiguous delete before it gets here.
    assert rag.delete_document("same.md") == 1
    assert rag.documents_named("same.md") == []


def test_the_corpus_statistics_cover_the_scope_and_nothing_else():
    # BM25 used to be scored against statistics assembled from one set per
    # database. One table means one query; these are the numbers that used to
    # be added up, and a chunk has to score the same either way.
    clear()
    add("/corpus/pkg/a.md", "PKG", "delivery block", "delivery block", seed=3)
    add("/corpus/dr/b.md", "DR", "delivery block", seed=4)
    n_pkg, avg_pkg, df_pkg = rag.corpus_stats(rag.connection(), "delivery", ["PKG"])
    n_dr, avg_dr, df_dr = rag.corpus_stats(rag.connection(), "delivery", ["DR"])
    n_all, avg_all, df_all = rag.corpus_stats(rag.connection(), "delivery", None)
    assert (n_pkg, n_dr, n_all) == (2, 1, 3)
    assert df_all["deliveri"] == df_pkg["deliveri"] + df_dr["deliveri"]
    assert abs(avg_all - (n_pkg * avg_pkg + n_dr * avg_dr) / n_all) < 1e-9


def test_a_reserved_code_is_not_a_category():
    assert "UPLOAD" in rag.RESERVED_CODES
    assert "UPLOAD" not in rag.known_categories()


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

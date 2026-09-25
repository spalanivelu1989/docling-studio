"""Unit tests for the Ask RAG history.

Run: python test_ask_store.py

Needs Postgres, but not the corpus, not Ollama and not an Anthropic key:
everything happens in a throwaway database created and dropped here. What is
being tested is the promises the history makes, each of which is a way it could
quietly be useless:

  * a question is recorded before the answer exists, so an abandoned one is
    still in the history rather than lost;
  * the excerpts survive an abandoned run -- they are saved when retrieval
    finishes, not when the model finishes;
  * a failed question keeps the part of the answer that was written;
  * a run that never finished reports itself as abandoned, without the row
    being rewritten to say so;
  * the list view does not carry the excerpts or the whole answer;
  * retention actually trims, oldest first;
  * deleting one question leaves the others alone.
"""

from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))

import ask_store
import rag

TEST_DATABASE = "docling_test_ask"
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
    ask_store.create_schema(ask_store.connect())


def teardown() -> None:
    rag.close()
    rag.base_url = _original_base_url
    with _admin() as c:
        c.execute(f'DROP DATABASE IF EXISTS "{TEST_DATABASE}" WITH (FORCE)')


def clear() -> None:
    # CASCADE, because ask_evaluations references ask_runs. Without it every
    # test in this file fails on the foreign key rather than on its subject.
    ask_store.connect().execute("TRUNCATE TABLE ask_runs CASCADE")
    ask_store.connect().commit()


def start(run_id: str, question: str = "why?", **kw) -> None:
    conn = ask_store.connect()
    ask_store.start_run(conn, {
        "id": run_id, "question": question, "mode": kw.get("mode", "hybrid"),
        "k": kw.get("k", 8), "categories": kw.get("categories", []),
        "answer_model": "claude-opus-5", "embed_model": "bge-m3",
        "corpus_fingerprint": kw.get("corpus_fingerprint", "fp"),
    })


def excerpts(n: int) -> list[dict]:
    return [{"n": i + 1, "title": f"doc {i}", "section": "", "content": "x" * 200,
             "category": "PKG", "score": 0.1, "similarity": 0.7, "bm25": None,
             "vector_rank": i + 1, "keyword_rank": None} for i in range(n)]


# --- the tests ----------------------------------------------------------------

def test_a_question_is_recorded_before_it_is_answered():
    clear()
    start("ask_1", "what triggers a billing split?")
    row = ask_store.get_run(ask_store.connect(), "ask_1")
    assert row is not None, "the question was not recorded until it had an answer"
    assert row["question"] == "what triggers a billing split?"
    assert row["status"] == "running" and row["answer"] == ""


def test_excerpts_survive_a_question_that_is_never_answered():
    """The tab was closed while Claude was writing. What the search found is
    the half people go back for, so it must not depend on the model finishing."""
    clear()
    start("ask_2")
    ask_store.save_sources(ask_store.connect(), "ask_2", excerpts(8), ["split", "bill"])
    row = ask_store.get_run(ask_store.connect(), "ask_2")
    assert len(row["sources"]) == 8, "an abandoned question lost its excerpts"
    assert row["terms"] == ["split", "bill"], "the highlight terms were not kept"
    assert row["status"] == "running"


def test_a_failed_question_keeps_what_was_written():
    clear()
    start("ask_3")
    ask_store.fail_run(ask_store.connect(), "ask_3", "Overloaded", "half an ans")
    row = ask_store.get_run(ask_store.connect(), "ask_3")
    assert row["status"] == "failed"
    assert row["error"] == "Overloaded"
    assert row["answer"] == "half an ans", "the partial answer was thrown away"


def test_an_unfinished_question_reports_abandoned_without_being_rewritten():
    clear()
    start("ask_4")
    conn = ask_store.connect()
    stale = datetime.now(timezone.utc) - timedelta(minutes=ask_store.STALE_AFTER_MINUTES + 1)
    conn.execute("UPDATE ask_runs SET started_at = %s WHERE id = %s", (stale, "ask_4"))
    conn.commit()
    assert ask_store.get_run(conn, "ask_4")["status"] == "abandoned"
    stored = conn.execute("SELECT status FROM ask_runs WHERE id = %s", ("ask_4",)).fetchone()[0]
    assert stored == "running", "the row was mutated; it no longer records that it was interrupted"


def test_the_list_view_does_not_carry_the_excerpts():
    """Fifty rows of eight excerpts each is a megabyte the panel never shows."""
    clear()
    start("ask_5")
    ask_store.save_sources(ask_store.connect(), "ask_5", excerpts(8), [])
    ask_store.finish_run(ask_store.connect(), "ask_5", "A" * 5000,
                         {"seconds": 3, "input_tokens": 10, "output_tokens": 20})
    [row] = ask_store.list_runs(ask_store.connect())
    assert row["sources"] == 8, "the count of excerpts is what the panel shows"
    assert not isinstance(row["sources"], list), "the list view is carrying whole excerpts"
    assert len(row["summary"]) <= 180, "the list view is carrying the whole answer"


def test_retention_trims_the_oldest_first():
    clear()
    conn = ask_store.connect()
    for i in range(6):
        start(f"ask_r{i}", f"question {i}")
        conn.execute("UPDATE ask_runs SET started_at = now() - %s * interval '1 minute'"
                     " WHERE id = %s", (10 - i, f"ask_r{i}"))
    conn.commit()
    assert ask_store.trim(conn, keep=3) == 3
    kept = {r["id"] for r in ask_store.list_runs(conn)}
    assert kept == {"ask_r3", "ask_r4", "ask_r5"}, f"trimmed the wrong rows: {kept}"


def test_deleting_one_question_leaves_the_others():
    clear()
    start("ask_6a")
    start("ask_6b")
    assert ask_store.delete_run(ask_store.connect(), "ask_6a") is True
    assert ask_store.delete_run(ask_store.connect(), "ask_6a") is False, "deleted a row twice"
    assert {r["id"] for r in ask_store.list_runs(ask_store.connect())} == {"ask_6b"}


def test_the_filter_matches_question_text_only():
    clear()
    start("ask_7a", "how is returnable packaging handled?")
    start("ask_7b", "what triggers a billing split?")
    conn = ask_store.connect()
    assert [r["id"] for r in ask_store.list_runs(conn, search="packaging")] == ["ask_7a"]
    assert [r["id"] for r in ask_store.list_runs(conn, search="BILLING")] == ["ask_7b"]
    assert ask_store.list_runs(conn, search="nothing here") == []


def test_the_schema_is_brought_up_once_however_many_requests_arrive():
    """The bug this is here for: every endpoint called create_schema, whose
    ALTER TABLE ... ADD COLUMN IF NOT EXISTS takes an exclusive lock even when
    the column exists. Two requests together -- the quality dashboard loading
    two views -- deadlocked, and Postgres killed one of them."""
    import threading

    calls = []
    real = ask_store._create_schema
    ask_store._create_schema = lambda conn: (calls.append(1), real(conn))
    ask_store._ready.clear()
    errors = []

    def request():
        try:
            ask_store.create_schema(ask_store.connect())
            ask_store.connect().execute("SELECT count(*) FROM ask_runs").fetchone()
        except Exception as exc:
            errors.append(exc)
        finally:
            rag.close()

    try:
        threads = [threading.Thread(target=request) for _ in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
    finally:
        ask_store._create_schema = real
    assert not errors, errors
    assert len(calls) == 1, f"the DDL ran {len(calls)} times for 8 concurrent requests"


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

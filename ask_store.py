"""Postgres persistence for Ask RAG questions.

Ask used to be ask-and-forget: the answer streamed to the browser and, once the
box was retyped, there was nothing left of it. That is fine for a throwaway
question and wrong for the rest -- someone asks the same thing three days apart
and has no way to see that the corpus answered differently, and a good answer
found on a Tuesday cannot be handed to anyone.

So the run is written down. One row per question, in the main database beside
the corpus it read, holding:

  * what was asked and how -- the question, the search mode, k, the categories
    in scope, the two models and a fingerprint of the corpus;
  * what came back -- the answer, and the excerpts it was written from.

Two decisions worth stating, because they are the reason this is not simply
`evidence_runs` with the columns renamed.

The excerpt TEXT is stored, not the chunk ids. Storing ids would be a quarter
of the bytes and would be wrong: re-indexing renumbers chunks, so a reopened
answer would show today's chunk under yesterday's citation and quietly
misattribute it. A history you cannot trust is worse than none, so a run keeps
the excerpts it actually read.

And the history is CAPPED. An investigation is minutes long and deliberate;
a question is ten seconds and casual, so these rows accumulate far faster than
the Evidence Agent's ever will. The oldest are trimmed past RETENTION so a
year of asking cannot quietly grow the database the corpus lives in.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

import rag  # noqa: E402

# How many questions to keep. Older rows are trimmed as new ones arrive.
# Measured at about 7 KB a run -- eight excerpts plus the answer, TOASTed --
# so 500 is roughly 3 MB, which is noise beside a 126 MB corpus.
RETENTION = int(os.environ.get("ASK_HISTORY_LIMIT", "500"))

# A question whose SSE stream was dropped -- tab closed, browser quit -- never
# reaches finish_run. Reported as abandoned rather than mutated, so the row
# keeps the fact that it was interrupted. Far shorter than the Evidence
# Agent's thirty minutes: a question that has not finished in five is gone.
STALE_AFTER_MINUTES = 5


def database_url() -> str:
    """The main database, beside the corpus the question read."""
    return rag.base_url()


def connect():
    """Shared and cached per thread, so callers must not close it;
    rag.close() releases a thread's connection."""
    return rag.connection(schema=False)


def create_schema(conn=None) -> None:
    conn = conn or connect()
    with conn.transaction():
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS ask_runs (
                id            text PRIMARY KEY,
                question      text NOT NULL,
                mode          text NOT NULL DEFAULT 'hybrid',
                k             int  NOT NULL DEFAULT 8,
                categories    jsonb NOT NULL DEFAULT '[]'::jsonb,
                answer_model  text NOT NULL DEFAULT '',
                embed_model   text NOT NULL DEFAULT '',
                corpus_fingerprint text NOT NULL DEFAULT '',
                started_at    timestamptz NOT NULL DEFAULT now(),
                finished_at   timestamptz,
                status        text NOT NULL DEFAULT 'running',
                seconds       real NOT NULL DEFAULT 0,
                input_tokens  int NOT NULL DEFAULT 0,
                output_tokens int NOT NULL DEFAULT 0,
                answer        text NOT NULL DEFAULT '',
                sources       jsonb NOT NULL DEFAULT '[]'::jsonb,
                terms         jsonb NOT NULL DEFAULT '[]'::jsonb,
                error         text NOT NULL DEFAULT ''
            )"""
        )
        conn.execute("CREATE INDEX IF NOT EXISTS ask_runs_started_idx"
                     " ON ask_runs (started_at DESC)")


def start_run(conn, run: dict) -> None:
    conn.execute(
        """INSERT INTO ask_runs
           (id, question, mode, k, categories, answer_model, embed_model, corpus_fingerprint)
           VALUES (%(id)s, %(question)s, %(mode)s, %(k)s, %(categories)s,
                   %(answer_model)s, %(embed_model)s, %(corpus_fingerprint)s)
           ON CONFLICT (id) DO NOTHING""",
        {**run, "categories": json.dumps(run.get("categories") or [])},
    )
    conn.commit()


def save_sources(conn, run_id: str, sources: list[dict], terms: list[str]) -> None:
    """Written as soon as retrieval finishes, before the model writes a word.

    A question that is abandoned mid-answer still leaves behind what the
    search found, which is the half people actually go back for."""
    conn.execute("UPDATE ask_runs SET sources = %s, terms = %s WHERE id = %s",
                 (json.dumps(sources, default=str), json.dumps(terms), run_id))
    conn.commit()


def finish_run(conn, run_id: str, answer: str, done: dict) -> None:
    conn.execute(
        """UPDATE ask_runs
           SET answer = %s, status = 'done', finished_at = now(),
               seconds = %s, input_tokens = %s, output_tokens = %s
           WHERE id = %s""",
        (answer, done.get("seconds", 0), done.get("input_tokens", 0),
         done.get("output_tokens", 0), run_id),
    )
    conn.commit()
    trim(conn)


def fail_run(conn, run_id: str, message: str, answer: str = "") -> None:
    """A failed question is kept, not dropped -- including whatever the model
    had written before it failed. 'It stopped halfway through' is a fact about
    the run, and throwing the row away loses it."""
    conn.execute(
        "UPDATE ask_runs SET status = 'failed', finished_at = now(),"
        " error = %s, answer = %s WHERE id = %s",
        (message[:2000], answer, run_id),
    )
    conn.commit()


def trim(conn, keep: int | None = None) -> int:
    """Drop everything past the newest `keep` runs. Called after each finished
    question rather than on a timer, so there is no sweeper to forget to run."""
    keep = RETENTION if keep is None else keep
    removed = conn.execute(
        """DELETE FROM ask_runs WHERE id IN (
               SELECT id FROM ask_runs ORDER BY started_at DESC OFFSET %s)
           RETURNING id""",
        (keep,),
    ).fetchall()
    conn.commit()
    return len(removed)


def _status(status: str, started_at) -> str:
    from datetime import datetime, timedelta, timezone

    if status == "running" and started_at and (
            datetime.now(timezone.utc) - started_at > timedelta(minutes=STALE_AFTER_MINUTES)):
        return "abandoned"
    return status


_COLUMNS = ("id, question, mode, k, categories, answer_model, embed_model,"
            " corpus_fingerprint, started_at, finished_at, status, seconds,"
            " input_tokens, output_tokens, answer, sources, terms, error")


def _row(r) -> dict:
    return {
        "id": r[0], "question": r[1], "mode": r[2], "k": r[3],
        "categories": r[4] or [], "answer_model": r[5], "embed_model": r[6],
        "corpus_fingerprint": r[7],
        "started_at": r[8].isoformat() if r[8] else None,
        "finished_at": r[9].isoformat() if r[9] else None,
        "status": _status(r[10], r[8]), "seconds": r[11],
        "input_tokens": r[12], "output_tokens": r[13],
        "answer": r[14], "sources": r[15] or [], "terms": r[16] or [],
        "error": r[17],
    }


def get_run(conn, run_id: str) -> dict | None:
    r = conn.execute(f"SELECT {_COLUMNS} FROM ask_runs WHERE id = %s", (run_id,)).fetchone()
    return _row(r) if r else None


def list_runs(conn, limit: int = 50, search: str = "") -> list[dict]:
    """The history panel: enough to recognise a question and decide whether to
    reopen it. Deliberately does not select `sources` or `answer` -- they are
    most of the row, and fifty of them is a megabyte nobody asked for."""
    where, params = "", []
    if search.strip():
        where = "WHERE question ILIKE %s"
        params.append(f"%{search.strip()}%")
    params.append(limit)
    rows = conn.execute(
        f"""SELECT id, question, mode, k, categories, status, started_at, finished_at,
                   seconds, answer_model, jsonb_array_length(sources),
                   left(answer, 180), input_tokens, output_tokens, error
            FROM ask_runs {where} ORDER BY started_at DESC LIMIT %s""",
        params,
    ).fetchall()
    return [
        {
            "id": r[0], "question": r[1], "mode": r[2], "k": r[3],
            "categories": r[4] or [], "status": _status(r[5], r[6]),
            "started_at": r[6].isoformat() if r[6] else None,
            "finished_at": r[7].isoformat() if r[7] else None,
            "seconds": r[8], "answer_model": r[9], "sources": r[10] or 0,
            # The opening of the answer, so the panel is scannable without
            # opening anything. Truncated in SQL rather than in the browser:
            # there is no reason to send 1,400 characters fifty times over.
            "summary": r[11] or "",
            "input_tokens": r[12], "output_tokens": r[13], "error": r[14],
        }
        for r in rows
    ]


def delete_run(conn, run_id: str) -> bool:
    removed = conn.execute(
        "DELETE FROM ask_runs WHERE id = %s RETURNING id", (run_id,)).fetchall()
    conn.commit()
    return bool(removed)


def clear(conn) -> int:
    removed = conn.execute("DELETE FROM ask_runs RETURNING id").fetchall()
    conn.commit()
    return len(removed)


def stats(conn=None) -> dict[str, Any]:
    conn = conn or connect()
    create_schema(conn)
    runs, answered = conn.execute(
        "SELECT count(*), count(*) FILTER (WHERE status = 'done') FROM ask_runs"
    ).fetchone()
    return {"runs": runs, "answered": answered, "retention": RETENTION,
            "database": rag.database_name(database_url())}

"""Postgres persistence for Rollout Agent runs.

These tables are not per-category, for the same reason the Fit/Gap register's
are not -- a run reads every category it is pointed at and records one result --
so they carry no category column and sit in the main database beside the corpus
they were written from.

What a run could see is part of reproducing it, so the record keeps the corpus
fingerprint, the categories, the prompt hash and the names of the attached
documents. The attachments themselves are swept within hours; the names are
all a reopened analysis can honestly show.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import rag  # noqa: E402

def database_url() -> str:
    """Where the runs and decisions live: the main database, beside the corpus
    they were written from."""
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
            CREATE TABLE IF NOT EXISTS rollout_runs (
                id            text PRIMARY KEY,
                subject       text NOT NULL DEFAULT 'country_as_is',
                scope_bpml    text NOT NULL,
                scope_label   text NOT NULL DEFAULT '',
                country       text NOT NULL DEFAULT '',
                country_context text NOT NULL DEFAULT '',
                sap_release   text NOT NULL DEFAULT '',
                gt_version    text NOT NULL DEFAULT '',
                question      text NOT NULL DEFAULT '',
                model         text NOT NULL DEFAULT '',
                prompt_hash   text NOT NULL DEFAULT '',
                categories    jsonb NOT NULL DEFAULT '[]'::jsonb,
                uploads       jsonb NOT NULL DEFAULT '{}'::jsonb,
                corpus_fingerprint text NOT NULL DEFAULT '',
                started_at    timestamptz NOT NULL DEFAULT now(),
                finished_at   timestamptz,
                status        text NOT NULL DEFAULT 'running',
                input_tokens  int NOT NULL DEFAULT 0,
                output_tokens int NOT NULL DEFAULT 0,
                asis          jsonb,
                analysis      jsonb,
                scores        jsonb,
                gates         jsonb,
                sources       jsonb NOT NULL DEFAULT '{}'::jsonb
            )"""
        )
        # CREATE TABLE IF NOT EXISTS does not add a column to a table that
        # already exists, so a database created before runs had a subject
        # needs this. The default is what every one of those runs was.
        conn.execute("ALTER TABLE rollout_runs ADD COLUMN IF NOT EXISTS"
                     " subject text NOT NULL DEFAULT 'country_as_is'")
        # What the analysis was built from. Added late, so existing runs have
        # no record and the page shows the traceability as unavailable for
        # them rather than as empty.
        conn.execute("ALTER TABLE rollout_runs ADD COLUMN IF NOT EXISTS"
                     " sources jsonb NOT NULL DEFAULT '{}'::jsonb")
        # The investigation log, with the evidence each call returned. Rollout
        # kept none of this: the log streamed to the browser and was gone on
        # reload, so a reopened run showed its conclusions with no working at
        # all. Runs recorded before this column have an empty list, and the
        # page says so rather than showing an empty log.
        conn.execute("ALTER TABLE rollout_runs ADD COLUMN IF NOT EXISTS"
                     " calls jsonb NOT NULL DEFAULT '[]'::jsonb")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS rollout_decisions (
                id         bigserial PRIMARY KEY,
                run_id     text NOT NULL REFERENCES rollout_runs(id) ON DELETE CASCADE,
                gap_id     text NOT NULL,
                reviewer   text NOT NULL,
                verdict    text NOT NULL,
                disposition text NOT NULL DEFAULT '',
                comment    text NOT NULL DEFAULT '',
                decided_at timestamptz NOT NULL DEFAULT now()
            )"""
        )
        conn.execute("CREATE INDEX IF NOT EXISTS rollout_decisions_run_idx"
                     " ON rollout_decisions (run_id)")


def start_run(conn, run: dict) -> None:
    conn.execute(
        """INSERT INTO rollout_runs
           (id, subject, scope_bpml, scope_label, country, country_context, sap_release,
            gt_version, question, model, prompt_hash, categories, uploads, corpus_fingerprint)
           VALUES (%(id)s, %(subject)s, %(scope_bpml)s, %(scope_label)s, %(country)s,
                   %(country_context)s, %(sap_release)s, %(gt_version)s, %(question)s,
                   %(model)s, %(prompt_hash)s,
                   %(categories)s, %(uploads)s, %(corpus_fingerprint)s)
           ON CONFLICT (id) DO NOTHING""",
        {"subject": "country_as_is", **run,
         "categories": json.dumps(run.get("categories") or []),
         "uploads": json.dumps(run.get("uploads") or {})},
    )
    conn.commit()


def save_asis(conn, run_id: str, asis: dict) -> None:
    conn.execute("UPDATE rollout_runs SET asis = %s WHERE id = %s", (json.dumps(asis), run_id))
    conn.commit()


def save_calls(conn, run_id: str, calls: list[dict]) -> None:
    """The log so far, rewritten in full after each call.

    Whole-list rather than append-one for the reason the Evidence Agent's is:
    a dropped connection should still leave the row holding everything that
    happened up to the drop."""
    conn.execute("UPDATE rollout_runs SET calls = %s WHERE id = %s",
                 (json.dumps(calls, default=str), run_id))
    conn.commit()


def _short_label(matched: str) -> str:
    """Condense the agent's template-process statement into a row label.

    `template_process` is a paragraph: the process, its ancestry, the dash
    codes either side of it and what the match rests on. That belongs in the
    export, where there is room for it -- but `scope_label` is what the run
    history menu puts on one line, so pasting the first 200 characters of a
    paragraph there turns every unscoped run into a wall of text.

    The cut is at the first bracket, which is where these statements reliably
    stop naming the process and start qualifying it. A statement that opens
    with a bracket, or has none, falls back to a word-boundary trim."""
    text = re.sub(r"[*`]", "", (matched or "").strip())
    head = text.split("(")[0].strip(" ,;:-")
    if len(head) < 12:
        head = text
    if len(head) > 90:
        head = head[:90].rsplit(" ", 1)[0] + "\u2026"
    return head


def finish_run(conn, run_id: str, analysis: dict, scores: dict, gates: dict,
               tokens: tuple[int, int], status: str = "done",
               sources: dict | None = None) -> None:
    """Store the result, and label a run that named no Global Template process
    with the one the agent matched.

    COALESCE on the empty string rather than an unconditional write: a run that
    named a process keeps the analyst's label, and only a run that did not
    borrows the agent's. Either way the row says what was compared against,
    which is what makes an unscoped run auditable at all."""
    matched = _short_label(analysis.get("template_process") or "")
    conn.execute(
        """UPDATE rollout_runs SET analysis = %s, scores = %s, gates = %s, status = %s,
                  finished_at = now(), input_tokens = %s, output_tokens = %s,
                  sources = %s,
                  scope_label = CASE WHEN scope_label = '' THEN %s ELSE scope_label END
           WHERE id = %s""",
        (json.dumps(analysis), json.dumps(scores), json.dumps(gates), status,
         tokens[0], tokens[1], json.dumps(sources or {}), matched, run_id),
    )
    conn.commit()


def fail_run(conn, run_id: str, message: str) -> None:
    conn.execute(
        "UPDATE rollout_runs SET status = 'failed', finished_at = now(),"
        " gates = %s WHERE id = %s",
        (json.dumps({"error": message}), run_id),
    )
    conn.commit()


_COLUMNS = ("id, subject, scope_bpml, scope_label, country, country_context,"
            " sap_release, gt_version,"
            " question, model, prompt_hash, categories, uploads, corpus_fingerprint,"
            " started_at, finished_at, status, input_tokens, output_tokens,"
            " asis, analysis, scores, gates, sources, calls")


# A run whose SSE stream was dropped -- the browser closed, the tab was
# abandoned -- never reaches finish_run and would sit at "running" for ever.
# Reported as abandoned rather than mutated, so the row keeps the fact that it
# was interrupted rather than finished.
STALE_AFTER_MINUTES = 30


def _stale(started_at) -> bool:
    from datetime import datetime, timedelta, timezone

    return datetime.now(timezone.utc) - started_at > timedelta(minutes=STALE_AFTER_MINUTES)


def _status(status: str, started_at) -> str:
    if status == "running" and started_at and _stale(started_at):
        return "abandoned"
    return status


def _row(r) -> dict:
    return {
        "id": r[0], "subject": r[1], "scope_bpml": r[2], "scope_label": r[3], "country": r[4],
        "country_context": r[5], "sap_release": r[6], "gt_version": r[7], "question": r[8],
        "model": r[9], "prompt_hash": r[10], "categories": r[11] or [], "uploads": r[12] or {},
        "corpus_fingerprint": r[13],
        "started_at": r[14].isoformat() if r[14] else None,
        "finished_at": r[15].isoformat() if r[15] else None,
        "status": _status(r[16], r[14]), "input_tokens": r[17], "output_tokens": r[18],
        "asis": r[19] or {}, "analysis": r[20] or {}, "scores": r[21] or {}, "gates": r[22] or {},
        "sources": r[23] or {},
        "calls": r[24] or [],
    }


def get_run(conn, run_id: str) -> dict | None:
    r = conn.execute(f"SELECT {_COLUMNS} FROM rollout_runs WHERE id = %s", (run_id,)).fetchone()
    if not r:
        return None
    run = _row(r)
    run["decisions"] = get_decisions(conn, run_id)
    return run


def list_runs(conn, limit: int = 40) -> list[dict]:
    rows = conn.execute(
        """SELECT id, scope_bpml, scope_label, country, status, started_at, finished_at,
                  model, categories, uploads, scores, subject
           FROM rollout_runs ORDER BY started_at DESC LIMIT %s""",
        (limit,),
    ).fetchall()
    out = []
    for r in rows:
        scores = r[10] or {}
        out.append({
            "id": r[0], "scope_bpml": r[1], "scope_label": r[2], "country": r[3],
            "status": _status(r[4], r[5]),
            "started_at": r[5].isoformat() if r[5] else None,
            "finished_at": r[6].isoformat() if r[6] else None,
            "model": r[7], "categories": r[8] or [], "uploads": r[9] or {},
            "subject": r[11],
            "gt_alignment": scores.get("gt_alignment"),
            "harmonization_potential": scores.get("harmonization_potential"),
            "deviations": (scores.get("counts") or {}).get("deviations", 0),
            "must_discuss": ((scores.get("counts") or {}).get("workshop") or {}).get("MUST_DISCUSS", 0),
        })
    return out


def save_decision(conn, run_id: str, gap_id: str, reviewer: str, verdict: str,
                  disposition: str = "", comment: str = "") -> dict:
    row = conn.execute(
        """INSERT INTO rollout_decisions (run_id, gap_id, reviewer, verdict, disposition, comment)
           VALUES (%s, %s, %s, %s, %s, %s) RETURNING id, decided_at""",
        (run_id, gap_id, reviewer, verdict, disposition, comment),
    ).fetchone()
    conn.commit()
    return {"id": row[0], "run_id": run_id, "gap_id": gap_id, "reviewer": reviewer,
            "verdict": verdict, "disposition": disposition, "comment": comment,
            "decided_at": row[1].isoformat()}


def delete_run(conn, run_id: str) -> bool:
    """Remove one run. Its decisions go with it: rollout_decisions declares
    ON DELETE CASCADE, so a verdict cannot outlive the analysis it was made
    against and be reported against nothing."""
    removed = conn.execute(
        "DELETE FROM rollout_runs WHERE id = %s RETURNING id", (run_id,)).fetchall()
    conn.commit()
    return bool(removed)


def get_decisions(conn, run_id: str) -> list[dict]:
    rows = conn.execute(
        "SELECT id, gap_id, reviewer, verdict, disposition, comment, decided_at"
        " FROM rollout_decisions WHERE run_id = %s ORDER BY decided_at",
        (run_id,),
    ).fetchall()
    return [{"id": r[0], "gap_id": r[1], "reviewer": r[2], "verdict": r[3],
             "disposition": r[4], "comment": r[5],
             "decided_at": r[6].isoformat() if r[6] else None} for r in rows]


def stats(conn=None) -> dict[str, Any]:
    conn = conn or connect()
    create_schema(conn)
    runs = conn.execute("SELECT count(*) FROM rollout_runs").fetchone()[0]
    decisions = conn.execute("SELECT count(*) FROM rollout_decisions").fetchone()[0]
    return {"runs": runs, "decisions": decisions,
            "database": rag.database_name(database_url())}

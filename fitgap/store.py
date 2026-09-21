"""Postgres persistence for runs, entries and reviews (handover §5, §10).

Reviews sit alongside entries and never overwrite them: the register has to
keep showing what the Copilot proposed next to what the human decided, or the
next evaluation has nothing to measure.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import rag  # noqa: E402

from .schemas import FitGapEntry, Review, VerifiedEntry  # noqa: E402


def connect():
    return rag.connect()


def create_schema(conn=None) -> None:
    own = conn is None
    conn = conn or connect()
    try:
        with conn.transaction():
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS fitgap_runs (
                    id            text PRIMARY KEY,
                    mode          text NOT NULL,
                    scope_bpml    text NOT NULL,
                    scope_label   text NOT NULL DEFAULT '',
                    question      text NOT NULL DEFAULT '',
                    country       jsonb,
                    model         text NOT NULL DEFAULT '',
                    prompt_hash   text NOT NULL DEFAULT '',
                    params        jsonb NOT NULL DEFAULT '{}'::jsonb,
                    holdout       boolean NOT NULL DEFAULT false,
                    corpus_fingerprint text NOT NULL DEFAULT '',
                    started_at    timestamptz NOT NULL DEFAULT now(),
                    finished_at   timestamptz,
                    status        text NOT NULL DEFAULT 'running',
                    input_tokens  int NOT NULL DEFAULT 0,
                    output_tokens int NOT NULL DEFAULT 0,
                    synthesis     jsonb
                )"""
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS fitgap_entries (
                    id             bigserial PRIMARY KEY,
                    run_id         text NOT NULL REFERENCES fitgap_runs(id) ON DELETE CASCADE,
                    bpml_code      text NOT NULL,
                    step_name      text NOT NULL DEFAULT '',
                    classification text NOT NULL,
                    confidence     real NOT NULL DEFAULT 0,
                    materiality    text NOT NULL DEFAULT 'low',
                    status         text NOT NULL DEFAULT 'proposed',
                    evidence_valid boolean NOT NULL DEFAULT true,
                    entry          jsonb NOT NULL,
                    issues         jsonb NOT NULL DEFAULT '[]'::jsonb,
                    tool_calls     int NOT NULL DEFAULT 0,
                    seconds        real NOT NULL DEFAULT 0,
                    created_at     timestamptz NOT NULL DEFAULT now(),
                    UNIQUE (run_id, bpml_code)
                )"""
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS fitgap_reviews (
                    id         bigserial PRIMARY KEY,
                    entry_id   bigint NOT NULL REFERENCES fitgap_entries(id) ON DELETE CASCADE,
                    reviewer   text NOT NULL,
                    verdict    text NOT NULL,
                    corrected_classification text,
                    comment    text NOT NULL DEFAULT '',
                    created_at timestamptz NOT NULL DEFAULT now()
                )"""
            )
            conn.execute("CREATE INDEX IF NOT EXISTS fitgap_entries_run_idx ON fitgap_entries (run_id)")
            conn.execute("CREATE INDEX IF NOT EXISTS fitgap_reviews_entry_idx ON fitgap_reviews (entry_id)")
    finally:
        if own:
            conn.close()


def corpus_fingerprint(conn) -> str:
    """The hash of the indexed corpus, so a run can be reproduced against the
    exact material it saw (§10)."""
    import hashlib

    rows = conn.execute("SELECT fingerprint FROM rag_documents ORDER BY source").fetchall()
    h = hashlib.sha256()
    for (f,) in rows:
        h.update(f.encode())
    return h.hexdigest()[:16]


def start_run(conn, run: dict) -> None:
    conn.execute(
        """INSERT INTO fitgap_runs
           (id, mode, scope_bpml, scope_label, question, country, model, prompt_hash,
            params, holdout, corpus_fingerprint)
           VALUES (%(id)s, %(mode)s, %(scope_bpml)s, %(scope_label)s, %(question)s, %(country)s,
                   %(model)s, %(prompt_hash)s, %(params)s, %(holdout)s, %(corpus_fingerprint)s)
           ON CONFLICT (id) DO NOTHING""",
        {**run,
         "country": json.dumps(run.get("country")) if run.get("country") else None,
         "params": json.dumps(run.get("params", {}))},
    )
    conn.commit()


def save_entry(conn, run_id: str, result: VerifiedEntry) -> int:
    e = result.entry
    row = conn.execute(
        """INSERT INTO fitgap_entries
           (run_id, bpml_code, step_name, classification, confidence, materiality, status,
            evidence_valid, entry, issues, tool_calls, seconds)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
           ON CONFLICT (run_id, bpml_code) DO UPDATE SET
             classification = EXCLUDED.classification, confidence = EXCLUDED.confidence,
             materiality = EXCLUDED.materiality, entry = EXCLUDED.entry,
             issues = EXCLUDED.issues, evidence_valid = EXCLUDED.evidence_valid
           RETURNING id""",
        (run_id, e.bpml_code, e.step_name, e.classification, e.confidence, e.materiality,
         e.status, result.evidence_valid, json.dumps(e.model_dump()),
         json.dumps([i.model_dump() for i in result.issues]), result.tool_calls, result.seconds),
    ).fetchone()
    conn.commit()
    return int(row[0])


def finish_run(conn, run_id: str, synthesis: dict, tokens: tuple[int, int], status: str = "done") -> None:
    conn.execute(
        """UPDATE fitgap_runs SET finished_at = now(), status = %s, synthesis = %s,
           input_tokens = %s, output_tokens = %s WHERE id = %s""",
        (status, json.dumps(synthesis), tokens[0], tokens[1], run_id),
    )
    conn.commit()


def list_runs(conn, limit: int = 40) -> list[dict]:
    rows = conn.execute(
        """SELECT r.id, r.mode, r.scope_bpml, r.scope_label, r.question, r.holdout, r.status,
                  r.started_at, r.finished_at, r.model,
                  (SELECT count(*) FROM fitgap_entries e WHERE e.run_id = r.id) AS entries,
                  r.synthesis
           FROM fitgap_runs r ORDER BY r.started_at DESC LIMIT %s""",
        (limit,),
    ).fetchall()
    out = []
    for r in rows:
        synth = r[11] or {}
        # A run whose SSE stream was dropped (the browser closed, the tab was
        # abandoned) never reaches finish_run and would sit at "running" for
        # ever. Report it as abandoned rather than mutating the row, which
        # would lose the fact that it was interrupted rather than finished.
        status = r[6]
        if status == "running" and r[7] and _stale(r[7]):
            status = "abandoned"
        out.append({
            "id": r[0], "mode": r[1], "scope_bpml": r[2], "scope_label": r[3], "question": r[4],
            "holdout": r[5], "status": status,
            "started_at": r[7].isoformat() if r[7] else None,
            "finished_at": r[8].isoformat() if r[8] else None,
            "model": r[9], "entries": r[10],
            "reuse_pct": (synth.get("reuse") or {}).get("reuse_pct"),
            "coverage_pct": (synth.get("reuse") or {}).get("coverage_pct"),
        })
    return out


STALE_AFTER_MINUTES = 30


def _stale(started_at) -> bool:
    from datetime import datetime, timedelta, timezone

    return datetime.now(timezone.utc) - started_at > timedelta(minutes=STALE_AFTER_MINUTES)


def get_run(conn, run_id: str) -> dict | None:
    r = conn.execute(
        """SELECT id, mode, scope_bpml, scope_label, question, country, model, prompt_hash,
                  params, holdout, corpus_fingerprint, started_at, finished_at, status,
                  input_tokens, output_tokens, synthesis
           FROM fitgap_runs WHERE id = %s""",
        (run_id,),
    ).fetchone()
    if not r:
        return None
    run = {
        "id": r[0], "mode": r[1], "scope_bpml": r[2], "scope_label": r[3], "question": r[4],
        "country": r[5], "model": r[6], "prompt_hash": r[7], "params": r[8], "holdout": r[9],
        "corpus_fingerprint": r[10],
        "started_at": r[11].isoformat() if r[11] else None,
        "finished_at": r[12].isoformat() if r[12] else None,
        "status": r[13], "input_tokens": r[14], "output_tokens": r[15],
        "synthesis": r[16] or {},
    }
    run["entries"] = get_entries(conn, run_id)
    return run


def get_entries(conn, run_id: str) -> list[dict]:
    rows = conn.execute(
        """SELECT e.id, e.entry, e.issues, e.evidence_valid, e.tool_calls, e.seconds,
                  COALESCE(json_agg(json_build_object(
                      'id', v.id, 'reviewer', v.reviewer, 'verdict', v.verdict,
                      'corrected_classification', v.corrected_classification,
                      'comment', v.comment, 'created_at', v.created_at
                  ) ORDER BY v.created_at) FILTER (WHERE v.id IS NOT NULL), '[]')
           FROM fitgap_entries e
           LEFT JOIN fitgap_reviews v ON v.entry_id = e.id
           WHERE e.run_id = %s
           GROUP BY e.id ORDER BY e.bpml_code""",
        (run_id,),
    ).fetchall()
    out = []
    for r in rows:
        out.append({"id": r[0], **r[1], "issues": r[2], "evidence_valid": r[3],
                    "tool_calls": r[4], "seconds": r[5], "reviews": r[6]})
    out.sort(key=lambda e: tuple(int(x) if x.isdigit() else 0 for x in e["bpml_code"].split(".")))
    return out


def add_review(conn, entry_id: int, review: Review) -> dict:
    row = conn.execute(
        """INSERT INTO fitgap_reviews (entry_id, reviewer, verdict, corrected_classification, comment)
           VALUES (%s,%s,%s,%s,%s) RETURNING id, created_at""",
        (entry_id, review.reviewer, review.verdict, review.corrected_classification, review.comment),
    ).fetchone()
    conn.commit()
    return {"id": int(row[0]), "created_at": row[1].isoformat(), **review.model_dump()}


def entry_json(row: dict) -> FitGapEntry:
    return FitGapEntry(**{k: v for k, v in row.items()
                          if k in FitGapEntry.model_fields})


def to_results(entries: list[dict]) -> list[VerifiedEntry]:
    """Rehydrate stored rows into what synthesis.py expects."""
    from .schemas import VerifyIssue

    out = []
    for row in entries:
        out.append(VerifiedEntry(
            entry=entry_json(row),
            issues=[VerifyIssue(**i) for i in (row.get("issues") or [])],
            tool_calls=row.get("tool_calls", 0), seconds=row.get("seconds", 0.0),
        ))
    return out


def stats(conn) -> dict[str, Any]:
    runs = conn.execute("SELECT count(*) FROM fitgap_runs").fetchone()[0]
    entries = conn.execute("SELECT count(*) FROM fitgap_entries").fetchone()[0]
    reviews = conn.execute("SELECT count(*) FROM fitgap_reviews").fetchone()[0]
    return {"runs": runs, "entries": entries, "reviews": reviews}

"""Postgres persistence for runs over the evaluation set.

`python evaluation.py experiment` answers the 27 ground-truthed questions and
scores every answer, with the two metrics live traffic can never have --
correctness and context recall -- because these questions come with a known
answer. Until now the results went only to Langfuse, as a dataset run.

That is enough to chart them and not enough to explain them. Langfuse holds
the scores; the reason a score moved lives in the judge's working and in the
excerpts each run retrieved, and neither of those reaches Langfuse. Comparing
two runs question by question -- "Q7 regressed because four more excerpts came
back and two of them contradict each other" -- needs both runs' working side
by side, so each run is kept here as well.

Two tables: one row per run, holding the configuration that makes two runs
comparable or not, and one row per question answered.
"""

from __future__ import annotations

import json
import sys
import threading
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

import rag  # noqa: E402


def connect():
    """Shared and cached per thread, so callers must not close it."""
    return rag.connection(schema=False)


# Once per process per database, for the reason ask_store gives in full: DDL
# on every request is how concurrent requests come to deadlock.
_ready: set[str] = set()
_ready_lock = threading.Lock()


def create_schema(conn=None) -> None:
    key = rag.base_url()
    if key in _ready:
        return
    with _ready_lock:
        if key in _ready:
            return
        _create_schema(conn or connect())
        _ready.add(key)


def _create_schema(conn) -> None:
    with conn.transaction():
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS eval_experiments (
                id           text PRIMARY KEY,
                name         text NOT NULL,
                started_at   timestamptz NOT NULL DEFAULT now(),
                finished_at  timestamptz,
                status       text NOT NULL DEFAULT 'running',
                config       jsonb NOT NULL DEFAULT '{}'::jsonb,
                baseline     boolean NOT NULL DEFAULT false,
                langfuse_url text NOT NULL DEFAULT '',
                error        text NOT NULL DEFAULT ''
            )"""
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS eval_experiment_items (
                experiment_id text NOT NULL
                              REFERENCES eval_experiments(id) ON DELETE CASCADE,
                item_id       text NOT NULL,
                question      text NOT NULL DEFAULT '',
                part          text NOT NULL DEFAULT '',
                answer        text NOT NULL DEFAULT '',
                sources       jsonb NOT NULL DEFAULT '[]'::jsonb,
                metrics       jsonb NOT NULL DEFAULT '{}'::jsonb,
                overall       real,
                safety        real,
                input_tokens  int NOT NULL DEFAULT 0,
                output_tokens int NOT NULL DEFAULT 0,
                seconds       real NOT NULL DEFAULT 0,
                error         text NOT NULL DEFAULT '',
                PRIMARY KEY (experiment_id, item_id)
            )"""
        )


def start(conn, experiment_id: str, name: str, config: dict) -> None:
    conn.execute(
        "INSERT INTO eval_experiments (id, name, config) VALUES (%s, %s, %s)",
        (experiment_id, name, json.dumps(config)),
    )
    conn.commit()


def save_item(conn, experiment_id: str, item: dict) -> None:
    """One answered question. Written as each finishes, so a run that dies at
    question twenty keeps the nineteen it did."""
    conn.execute(
        """INSERT INTO eval_experiment_items
           (experiment_id, item_id, question, part, answer, sources, metrics,
            overall, safety, input_tokens, output_tokens, seconds, error)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
           ON CONFLICT (experiment_id, item_id) DO UPDATE SET
             answer = EXCLUDED.answer, sources = EXCLUDED.sources,
             metrics = EXCLUDED.metrics, overall = EXCLUDED.overall,
             safety = EXCLUDED.safety, input_tokens = EXCLUDED.input_tokens,
             output_tokens = EXCLUDED.output_tokens, seconds = EXCLUDED.seconds,
             error = EXCLUDED.error""",
        (experiment_id, item["item_id"], item.get("question", ""),
         item.get("part", ""), item.get("answer", ""),
         json.dumps(item.get("sources") or []),
         json.dumps(item.get("metrics") or {}),
         item.get("overall"), item.get("safety"),
         item.get("input_tokens") or 0, item.get("output_tokens") or 0,
         item.get("seconds") or 0, (item.get("error") or "")[:2000]),
    )
    conn.commit()


def finish(conn, experiment_id: str, status: str = "done", error: str = "",
           langfuse_url: str = "") -> None:
    conn.execute(
        """UPDATE eval_experiments SET status = %s, error = %s,
           langfuse_url = %s, finished_at = now() WHERE id = %s""",
        (status, error[:2000], langfuse_url, experiment_id),
    )
    conn.commit()


def set_baseline(conn, experiment_id: str) -> bool:
    """Make this run the one others are compared against, and only this one.

    One baseline, not a flag per run: "compare against the accepted run" has
    to mean a single thing, or two people accepting different runs silently
    compare against different references."""
    found = conn.execute("SELECT 1 FROM eval_experiments WHERE id = %s",
                         (experiment_id,)).fetchone()
    if not found:
        return False
    conn.execute("UPDATE eval_experiments SET baseline = (id = %s)", (experiment_id,))
    conn.commit()
    return True


def delete(conn, experiment_id: str) -> bool:
    gone = conn.execute("DELETE FROM eval_experiments WHERE id = %s RETURNING id",
                        (experiment_id,)).fetchall()
    conn.commit()
    return bool(gone)


def list_experiments(conn) -> list[dict[str, Any]]:
    rows = conn.execute(
        """SELECT e.id, e.name, e.started_at, e.finished_at, e.status, e.config,
                  e.baseline, e.langfuse_url, e.error,
                  count(i.item_id), avg(i.overall),
                  avg((i.metrics -> 'correctness' ->> 'value')::real),
                  avg((i.metrics -> 'faithfulness' ->> 'value')::real)
           FROM eval_experiments e
           LEFT JOIN eval_experiment_items i ON i.experiment_id = e.id
           GROUP BY e.id ORDER BY e.started_at DESC"""
    ).fetchall()
    return [
        {"id": r[0], "name": r[1],
         "started_at": r[2].isoformat() if r[2] else None,
         "finished_at": r[3].isoformat() if r[3] else None,
         "status": r[4], "config": r[5] or {}, "baseline": r[6],
         "langfuse_url": r[7], "error": r[8], "items": r[9],
         "overall": round(float(r[10]), 4) if r[10] is not None else None,
         "correctness": round(float(r[11]), 4) if r[11] is not None else None,
         "faithfulness": round(float(r[12]), 4) if r[12] is not None else None}
        for r in rows
    ]


def get(conn, experiment_id: str) -> dict | None:
    head = conn.execute(
        """SELECT id, name, started_at, status, config, baseline, langfuse_url
           FROM eval_experiments WHERE id = %s""", (experiment_id,)).fetchone()
    if not head:
        return None
    items = conn.execute(
        """SELECT item_id, question, part, answer, sources, metrics, overall,
                  safety, input_tokens, output_tokens, seconds, error
           FROM eval_experiment_items WHERE experiment_id = %s
           ORDER BY item_id""", (experiment_id,)).fetchall()
    return {
        "id": head[0], "name": head[1],
        "started_at": head[2].isoformat() if head[2] else None,
        "status": head[3], "config": head[4] or {}, "baseline": head[5],
        "langfuse_url": head[6],
        "items": [
            {"item_id": i[0], "question": i[1], "part": i[2], "answer": i[3],
             "sources": i[4] or [], "metrics": i[5] or {}, "overall": i[6],
             "safety": i[7], "input_tokens": i[8], "output_tokens": i[9],
             "seconds": i[10], "error": i[11]}
            for i in items
        ],
    }

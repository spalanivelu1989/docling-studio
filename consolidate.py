#!/usr/bin/env python
"""Merge the per-category databases into one, carrying the embeddings across.

    python consolidate.py baseline      record what the split system does, before anything moves
    python consolidate.py preflight     the checks that must pass before a merge is safe
    python consolidate.py run           create the merged database and copy everything into it
    python consolidate.py verify        prove the merged database answers like the split one did

`run` is purely additive. It creates a new database and reads the old ones; it
never writes to, deletes from or drops `docling_pkg`, `docling_dr`,
`docling_fitgap` or `docling_rollout`. That is what makes the rollback free --
stop the merged code, start the old code, and the old databases are still there,
untouched -- and it is also why the rehearsal and the real migration are the same
command with a different `--target`.

    python consolidate.py run --target merge_rehearsal      rehearsal
    python consolidate.py run                               the real thing (target: docling)

Nothing is re-embedded. The vectors move as data because the model and the
dimension do not change; re-embedding 7,450 chunks would take about 18 minutes,
and copying them takes under a second.

Row ids collide between the two corpora (both start at 1), so one side has to
move. DR keeps its ids and PKG is offset, because the stored runs cite 190 DR
chunks and only 60 PKG ones -- see OFFSET below and `migration_plan.md` §8.

`docling_session` is never touched. An analyst's attachment lives in a schema of
its own in a database of its own, and that separation is a guarantee InsightLens
and the Fit-Gap Copilot make; this migration does not weaken it.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import psycopg
from dotenv import load_dotenv

BASE = Path(__file__).resolve().parent
load_dotenv(BASE / ".env", override=False)

# {source database: how much to add to every id it contributes}. DR keeps its
# ids; PKG moves. Ten million is far above any id either corpus will reach, so
# an id in the merged table still says where it came from at a glance.
OFFSET = {"docling_dr": 0, "docling_pkg": 10_000_000}
RUN_STORES = {
    "docling_fitgap": ("fitgap_runs", "fitgap_entries", "fitgap_reviews"),
    "docling_rollout": ("rollout_runs", "rollout_decisions"),
}
DEFAULT_TARGET = "docling"
BASELINE = BASE / "backup" / "baseline.json"
EMBED_DIMENSION = int(os.environ.get("RAG_EMBED_DIMENSION", "1024"))

# The questions the migration is judged on. Ten from the eval set, chosen to
# span both corpora, exact identifiers and ordinary prose.
QUESTIONS = [
    "How does Solvay@eCommerce connect to SOVOS?",
    "What does SPARK-21999 cover?",
    "Does a Forecast Check delivery block stop a purchase requisition being created?",
    "For a commission contract, is the contract settled by self-billing?",
    "Should sales from ECC to S/4HANA be avoided during the interim period?",
    "Which M3 order types does the eCommerce-SAP interface support?",
    "Which external systems does the L2C landscape integrate with?",
    "Which process step does SPARK-18542 belong to, and is it a FIT?",
    "Who validated 7.1.12.3?",
    "What is the approval limit for a credit memo?",
]
SCOPES: list[list[str] | None] = [["PKG"], ["DR"], ["PKG", "DR"], None]
# Retrieval is approximate, so "the same" is a threshold, not an equality. Eighty
# chunks are compared per scope (ten questions, top eight); the measured
# agreement before any change was 78-80, and anything below this is a failure.
AGREEMENT_FLOOR = 76
RECALL_FLOOR = 0.95


# --- plumbing -----------------------------------------------------------------


def base_parts():
    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL is not set (add it to .env)")
    return urlsplit(url)


def url_for(name: str) -> str:
    p = base_parts()
    return urlunsplit((p.scheme, p.netloc, f"/{name}", p.query, p.fragment))


def connect(name: str, autocommit: bool = True):
    conn = psycopg.connect(url_for(name), autocommit=autocommit)
    try:
        from pgvector.psycopg import register_vector

        register_vector(conn)
    except Exception:
        pass  # only the retrieval comparison needs the adapter
    return conn


def exists(name: str) -> bool:
    with connect("postgres") as c:
        return bool(c.execute("SELECT 1 FROM pg_database WHERE datname = %s", (name,)).fetchone())


def say(*parts: Any) -> None:
    print(*parts, flush=True)


def rule(title: str) -> None:
    say(f"\n{title}\n{'-' * len(title)}")


class Failed(Exception):
    """A check that must pass did not."""


# --- preflight ----------------------------------------------------------------


def preflight(target: str = DEFAULT_TARGET) -> dict:
    """The eight conditions that make a merge safe (migration_plan.md §9.1).

    Check 1 is the one that can actually fail, and it is the reason the whole
    migration exists: `source` is declared UNIQUE and is only unique per
    database. If it ever fails, decide which copy is canonical and delete the
    other before migrating -- do not invent a disambiguating key."""
    rule("Preflight")
    problems: list[str] = []
    found: dict[str, Any] = {"documents": {}, "chunks": {}}
    by_source: dict[str, list[str]] = {}

    for db in OFFSET:
        if not exists(db):
            problems.append(f"{db} does not exist")
            continue
        with connect(db) as c:
            dim = c.execute(
                "SELECT atttypmod FROM pg_attribute"
                " WHERE attrelid = 'rag_chunks'::regclass AND attname = 'embedding'"
            ).fetchone()[0]
            if dim != EMBED_DIMENSION:
                problems.append(f"{db}: embedding is vector({dim}), expected vector({EMBED_DIMENSION})")

            for source, in c.execute("SELECT source FROM rag_documents").fetchall():
                by_source.setdefault(source, []).append(db)

            dupes = c.execute(
                "SELECT document_id, chunk_index, count(*) FROM rag_chunks"
                " GROUP BY 1, 2 HAVING count(*) > 1"
            ).fetchall()
            if dupes:
                problems.append(f"{db}: {len(dupes)} duplicated (document_id, chunk_index) pairs")

            drift = c.execute(
                "SELECT count(*) FROM rag_chunks c JOIN rag_documents d ON d.id = c.document_id"
                " WHERE c.category <> d.category"
            ).fetchone()[0]
            if drift:
                problems.append(f"{db}: {drift} chunks whose category differs from their document's")

            empty = c.execute(
                "SELECT count(*) FROM rag_documents d"
                " WHERE NOT EXISTS (SELECT 1 FROM rag_chunks c WHERE c.document_id = d.id)"
            ).fetchone()[0]
            if empty:
                say(f"  note   {db}: {empty} document(s) with no chunks; they will be copied as they are")

            for cat, docs, chunks in c.execute(
                "SELECT d.category, count(DISTINCT d.id), count(c.id) FROM rag_documents d"
                " LEFT JOIN rag_chunks c ON c.document_id = d.id GROUP BY 1 ORDER BY 1"
            ).fetchall():
                found["documents"][cat] = found["documents"].get(cat, 0) + docs
                found["chunks"][cat] = found["chunks"].get(cat, 0) + chunks

    shared = {s: dbs for s, dbs in by_source.items() if len(dbs) > 1}
    if shared:
        problems.append(
            f"{len(shared)} source path(s) indexed in more than one database; "
            f"UNIQUE(source) cannot be enforced. First: {next(iter(shared))}"
        )

    if exists(target):
        with connect(target) as c:
            held = c.execute("SELECT to_regclass('rag_documents')").fetchone()[0]
        if held:
            problems.append(f"{target} already holds rag_documents; drop it or pick another --target")

    busy = []
    with connect("postgres") as c:
        for db, n in c.execute(
            "SELECT datname, count(*) FROM pg_stat_activity"
            " WHERE datname = ANY(%s) AND pid <> pg_backend_pid() GROUP BY 1",
            (list(OFFSET) + list(RUN_STORES),),
        ).fetchall():
            busy.append(f"{db} ({n})")
    if busy:
        say(f"  WARN   something is still connected: {', '.join(busy)}."
            f" Stop the server before `run`; reading is safe, but a write during the copy would be lost.")

    for label, count in (("documents", found["documents"]), ("chunks", found["chunks"])):
        say(f"  {label:10} " + "  ".join(f"{k} {v}" for k, v in sorted(count.items()))
            + f"   total {sum(count.values())}")

    if problems:
        for p in problems:
            say(f"  FAIL   {p}")
        raise Failed(f"{len(problems)} precondition(s) failed")
    say("  ok     every precondition holds")
    return found


# --- the copy -----------------------------------------------------------------

DOC_COLUMNS = "id, source, title, fingerprint, indexed_at, category"
CHUNK_COLUMNS = "id, document_id, chunk_index, heading_path, content, tokens, embedding, category, tsv"


def create_target(target: str) -> None:
    if not exists(target):
        with connect("postgres") as c:
            c.execute(f'CREATE DATABASE "{target}"')
        say(f"  created database {target}")
    with connect(target) as c:
        c.execute("CREATE EXTENSION IF NOT EXISTS vector")
        c.execute(
            f"""
            CREATE TABLE IF NOT EXISTS rag_documents (
                id          bigserial PRIMARY KEY,
                source      text NOT NULL UNIQUE,
                title       text NOT NULL,
                fingerprint text NOT NULL,
                indexed_at  timestamptz NOT NULL DEFAULT now(),
                category    text NOT NULL DEFAULT 'UNFILED',
                UNIQUE (id, category)
            )"""
        )
        # No foreign key and no indexes yet: both are added after the copy,
        # where they cost a fraction of what they cost per row.
        c.execute(
            f"""
            CREATE TABLE IF NOT EXISTS rag_chunks (
                id           bigserial PRIMARY KEY,
                document_id  bigint NOT NULL,
                chunk_index  int NOT NULL,
                heading_path text NOT NULL,
                content      text NOT NULL,
                tokens       int NOT NULL,
                embedding    vector({EMBED_DIMENSION}) NOT NULL,
                category     text NOT NULL DEFAULT 'UNFILED',
                tsv          tsvector,
                UNIQUE (document_id, chunk_index)
            )"""
        )
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS rag_categories (
                code        text PRIMARY KEY,
                label       text NOT NULL,
                description text NOT NULL DEFAULT '',
                folder      text NOT NULL DEFAULT ''
            )"""
        )
        # Chunk ids appear in exported runs, in Langfuse traces and in
        # screenshots, none of which can be rewritten. This is how a key written
        # before the migration is still resolvable afterwards.
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS rag_chunk_id_map (
                old_database text   NOT NULL,
                kind         text   NOT NULL,          -- 'document' or 'chunk'
                old_id       bigint NOT NULL,
                new_id       bigint NOT NULL,
                category     text   NOT NULL,
                migrated_at  timestamptz NOT NULL DEFAULT now(),
                PRIMARY KEY (old_database, kind, old_id)
            )"""
        )
        say(f"  schema ready in {target}")


def copy_table(src, dst, table: str, columns: str, select: str) -> int:
    """Stream rows between two databases through Postgres's own COPY format,
    which round-trips a vector and a tsvector exactly."""
    n = 0
    with src.cursor() as scur, dst.cursor() as dcur:
        with scur.copy(f"COPY ({select}) TO STDOUT (FORMAT binary)") as out, \
             dcur.copy(f"COPY {table} ({columns}) FROM STDIN (FORMAT binary)") as into:
            for block in out:
                into.write(block)
        n = dcur.rowcount if dcur.rowcount and dcur.rowcount > 0 else 0
    return n


def copy_corpus(target: str) -> dict:
    rule("Copying the corpus")
    moved = {}
    with connect(target, autocommit=False) as dst:
        for db, offset in sorted(OFFSET.items(), key=lambda kv: kv[1]):
            with connect(db, autocommit=False) as src:
                t0 = time.perf_counter()
                docs = copy_table(
                    src, dst, "rag_documents", DOC_COLUMNS,
                    f"SELECT id + {offset}, source, title, fingerprint, indexed_at, category"
                    f" FROM rag_documents",
                )
                chunks = copy_table(
                    src, dst, "rag_chunks", CHUNK_COLUMNS,
                    f"SELECT id + {offset}, document_id + {offset}, chunk_index, heading_path,"
                    f" content, tokens, embedding, category, tsv FROM rag_chunks",
                )
                for kind, table in (("document", "rag_documents"), ("chunk", "rag_chunks")):
                    copy_table(
                        src, dst, "rag_chunk_id_map", "old_database, kind, old_id, new_id, category",
                        f"SELECT '{db}', '{kind}', id, id + {offset}, category FROM {table}",
                    )
                with src.cursor() as c:
                    cats = c.execute(
                        "SELECT code, label, description, folder FROM rag_categories"
                    ).fetchall()
                with dst.cursor() as c:
                    c.executemany(
                        "INSERT INTO rag_categories (code, label, description, folder)"
                        " VALUES (%s, %s, %s, %s) ON CONFLICT (code) DO NOTHING", cats,
                    )
                moved[db] = {"documents": docs, "chunks": chunks, "offset": offset}
                say(f"  {db:16} {docs:>4} documents  {chunks:>6} chunks"
                    f"  offset {offset:>10,}   {time.perf_counter() - t0:.1f}s")
        dst.commit()

    with connect(target) as c:
        for table in ("rag_documents", "rag_chunks"):
            c.execute(
                f"SELECT setval(pg_get_serial_sequence('{table}', 'id'),"
                f" coalesce((SELECT max(id) FROM {table}), 0) + 1, false)"
            )
        say("  sequences set above the highest id in each table")
    return moved


def build_indexes(target: str) -> None:
    rule("Indexes and constraints")
    with connect(target) as c:
        # A big maintenance_work_mem is not optional. HNSW builds vary run to
        # run, and a graph built under memory pressure can come out degenerate
        # and silently return a fraction of the true nearest neighbours; `verify`
        # measures recall for exactly this reason.
        c.execute("SET maintenance_work_mem = '512MB'")
        steps = [
            ("chunk -> document foreign key",
             "ALTER TABLE rag_chunks ADD CONSTRAINT rag_chunks_document_fkey"
             " FOREIGN KEY (document_id, category) REFERENCES rag_documents (id, category)"
             " ON DELETE CASCADE ON UPDATE CASCADE"),
            ("vector index (hnsw)",
             "CREATE INDEX IF NOT EXISTS rag_chunks_embedding_idx"
             " ON rag_chunks USING hnsw (embedding vector_cosine_ops)"),
            ("full-text index (gin)",
             "CREATE INDEX IF NOT EXISTS rag_chunks_tsv_idx ON rag_chunks USING gin (tsv)"),
            ("chunk category",
             "CREATE INDEX IF NOT EXISTS rag_chunks_category_idx ON rag_chunks (category)"),
            ("document category",
             "CREATE INDEX IF NOT EXISTS rag_documents_category_idx ON rag_documents (category)"),
        ]
        for label, sql in steps:
            t0 = time.perf_counter()
            try:
                c.execute(sql)
            except psycopg.errors.DuplicateObject:
                say(f"  {label:32} already there")
                continue
            say(f"  {label:32} {time.perf_counter() - t0:5.1f}s")
        c.execute("ANALYZE rag_documents")
        c.execute("ANALYZE rag_chunks")
        size = c.execute("SELECT pg_size_pretty(pg_database_size(current_database()))").fetchone()[0]
        say(f"  {target} is {size}")


# --- the run stores -----------------------------------------------------------


def copy_run_stores(target: str) -> None:
    """Move the Fit-Gap and Rollout run stores into the merged database.

    pg_dump rather than hand-written DDL: these tables have grown columns by
    ALTER over several releases, and reproducing them by hand is how a column
    goes missing. Nothing here holds a vector or collides on an id."""
    rule("Run stores")
    for db, tables in RUN_STORES.items():
        if not exists(db):
            say(f"  {db} does not exist; nothing to copy")
            continue
        args = ["pg_dump", "--no-owner", "--no-acl", "--no-privileges"]
        for t in tables:
            args += ["-t", t]
        args.append(url_for(db))
        dump = subprocess.run(args, capture_output=True, text=True)
        if dump.returncode:
            raise Failed(f"pg_dump {db} failed: {dump.stderr.strip()}")
        load = subprocess.run(
            ["psql", "--quiet", "--no-psqlrc", "-v", "ON_ERROR_STOP=1", url_for(target)],
            input=dump.stdout, capture_output=True, text=True,
        )
        if load.returncode:
            raise Failed(f"loading {db} into {target} failed: {load.stderr.strip()[:500]}")
        with connect(target) as c:
            counts = {t: c.execute(f"SELECT count(*) FROM {t}").fetchone()[0] for t in tables}
        say(f"  {db:16} " + ", ".join(f"{t} {n}" for t, n in counts.items()))


_KEY = re.compile(r"^([A-Z][A-Z0-9_]*):(\d+)$")
_KEY_IN_TEXT = re.compile(r"\b([A-Z][A-Z0-9_]*):(\d+)\b")
# Fields that hold text copied verbatim out of a document. A chunk id is not
# rewritten inside these even if one appears: the whole point of a quote is that
# it is what the document says, and the verifier checks it character for
# character against the chunk.
VERBATIM = {"quote", "content", "text", "full_text", "excerpt", "snippet", "markdown"}


def _remap_text(text: str, moved: dict[tuple[str, int], int], hits: list[str]) -> str:
    """Rewrite chunk ids written into prose.

    The model cites chunks in two ways: in a `chunk_id` field, and inline in
    its own sentences -- "Credit segment configuration (PKG:531)". Both are
    references a reader follows, so both move. Only a token naming a chunk that
    actually moved is touched, so an id-shaped string that is not one is left
    alone."""
    def swap(m: re.Match) -> str:
        new = moved.get((m.group(1), int(m.group(2))))
        if new is None:
            return m.group(0)
        hits.append(f"{m.group(0)} -> {m.group(1)}:{new} (prose)")
        return f"{m.group(1)}:{new}"

    return _KEY_IN_TEXT.sub(swap, text)


def _remap(value: Any, moved: dict[tuple[str, int], int], hits: list[str],
           verbatim: bool = False) -> Any:
    """Point a stored run's citations at the ids its chunks now have.

    Three shapes carry a chunk id: the value of a `chunk_id` field, a key of the
    `sources.chunks` map, and a mention inside the model's own prose. All three
    are rewritten; text the run quoted from a document is not."""
    if isinstance(value, dict):
        out = {}
        for k, v in value.items():
            m = _KEY.match(k) if isinstance(k, str) else None
            new = moved.get((m.group(1), int(m.group(2)))) if m else None
            if new is not None:
                hits.append(f"{k} -> {m.group(1)}:{new}")
                k = f"{m.group(1)}:{new}"
            if k == "chunk_id" and isinstance(v, str):
                m2 = _KEY.match(v)
                to = moved.get((m2.group(1), int(m2.group(2)))) if m2 else None
                if to is not None:
                    hits.append(f"{v} -> {m2.group(1)}:{to}")
                    v = f"{m2.group(1)}:{to}"
                out[k] = v
                continue
            out[k] = _remap(v, moved, hits, verbatim or k in VERBATIM)
        return out
    if isinstance(value, list):
        return [_remap(v, moved, hits, verbatim) for v in value]
    if isinstance(value, str) and not verbatim:
        return _remap_text(value, moved, hits)
    return value


def remap_citations(target: str) -> dict:
    """Point the stored runs at the ids their chunks now have.

    Only the copies inside the merged database are touched. The originals in
    docling_fitgap and docling_rollout keep the ids they were written with, so
    the record of what the run actually cited survives in two forms: the
    original, and rag_chunk_id_map."""
    rule("Chunk citations in stored runs")
    with connect(target) as c:
        moved = {
            (cat, old): new
            for old, new, cat in c.execute(
                "SELECT old_id, new_id, category FROM rag_chunk_id_map"
                " WHERE kind = 'chunk' AND old_id <> new_id"
            ).fetchall()
        }
        if not moved:
            say("  no ids moved; nothing to rewrite")
            return {}
        report: dict[str, int] = {}
        for table, key in (("fitgap_entries", "id"), ("fitgap_runs", "id"),
                           ("rollout_runs", "id"), ("rollout_decisions", "id")):
            if not c.execute("SELECT to_regclass(%s)", (table,)).fetchone()[0]:
                continue
            columns = [
                r[0] for r in c.execute(
                    "SELECT column_name FROM information_schema.columns"
                    " WHERE table_name = %s AND data_type IN ('json', 'jsonb')", (table,)
                ).fetchall()
            ]
            rewritten = prose = 0
            for column in columns:
                for row_id, value in c.execute(f"SELECT {key}, {column} FROM {table}").fetchall():
                    if value is None:
                        continue
                    hits: list[str] = []
                    updated = _remap(value, moved, hits)
                    if hits:
                        c.execute(
                            f"UPDATE {table} SET {column} = %s WHERE {key} = %s",
                            (json.dumps(updated), row_id),
                        )
                        rewritten += len(hits)
                        prose += sum(1 for h in hits if h.endswith("(prose)"))
            if rewritten:
                report[table] = rewritten
                say(f"  {table:20} {rewritten} citation(s) repointed"
                    + (f", {prose} of them written into prose" if prose else ""))
        if not report:
            say("  nothing cited a moved id")
        return report


# --- baselines and verification ----------------------------------------------


def _hits(conn, question: str, vector, scope, k: int = 8):
    import rag

    return rag.search(question, k, conn=conn, mode="hybrid",
                      query_vector=vector, categories=scope)


def _fingerprint_of(hit) -> list[str]:
    return [hit.title, hit.heading_path, hashlib.sha1(hit.content.encode()).hexdigest()[:12]]


def baseline() -> dict:
    """What the split system does today, recorded so the merged one can be held
    to it. Run this before anything moves; it cannot be recovered afterwards.

    This is the one command that needs the *old* rag.py -- it measures the
    split system, and the merged one cannot. Once rag.py has been collapsed,
    `verify` reads what this wrote and the baseline file is the only record
    left of how the corpus behaved before."""
    sys.path.insert(0, str(BASE))
    import rag

    if not hasattr(rag, "shards"):
        raise Failed(
            "rag.py has already been merged, so there is no split system left to "
            f"measure. The baseline captured before the merge is at "
            f"{BASELINE.relative_to(BASE) if BASELINE.is_file() else BASELINE} -- "
            "use `verify`, which reads it."
        )

    rule("Baseline")
    out: dict[str, Any] = {"captured_at": time.strftime("%Y-%m-%d %H:%M:%S"), "questions": QUESTIONS}

    out["totals"] = [list(row) for row in rag.totals()]
    say(f"  totals   " + "  ".join(f"{c} {d}/{ch}" for c, d, ch in rag.totals()))

    out["digest"] = {}
    for db in OFFSET:
        with connect(db) as c:
            for (cat,) in c.execute("SELECT DISTINCT category FROM rag_documents ORDER BY 1").fetchall():
                out["digest"][cat] = {
                    "embeddings": c.execute(
                        "SELECT md5(string_agg(embedding::text, ',' ORDER BY d.source, c.chunk_index))"
                        " FROM rag_chunks c JOIN rag_documents d ON d.id = c.document_id"
                        " WHERE c.category = %s", (cat,)).fetchone()[0],
                    "tsv": c.execute(
                        "SELECT md5(string_agg(tsv::text, ',' ORDER BY d.source, c.chunk_index))"
                        " FROM rag_chunks c JOIN rag_documents d ON d.id = c.document_id"
                        " WHERE c.category = %s", (cat,)).fetchone()[0],
                    "content": c.execute(
                        "SELECT md5(string_agg(content, ',' ORDER BY d.source, c.chunk_index))"
                        " FROM rag_chunks c JOIN rag_documents d ON d.id = c.document_id"
                        " WHERE c.category = %s", (cat,)).fetchone()[0],
                }
        say(f"  digest   {db}: content and vector digests recorded")

    # Every scope the 21 stored runs were actually made under, so §10.9 can hold
    # the merged system to the same corpus fingerprint.
    scopes = {(): True}
    for db, tables in RUN_STORES.items():
        if not exists(db):
            continue
        with connect(db) as c:
            for table in tables:
                if not c.execute("SELECT to_regclass(%s)", (table,)).fetchone()[0]:
                    continue
                cols = [r[0] for r in c.execute(
                    "SELECT column_name FROM information_schema.columns"
                    " WHERE table_name = %s AND column_name = 'categories'", (table,)).fetchall()]
                if not cols:
                    continue
                for (cats,) in c.execute(f"SELECT categories FROM {table}").fetchall():
                    scopes[tuple(sorted(cats or []))] = True
    import fitgap.store as fg_store

    out["fingerprints"] = {}
    for scope in sorted(scopes):
        out["fingerprints"][",".join(scope)] = fg_store.corpus_fingerprint(categories=list(scope) or None)
    say(f"  runs     {len(scopes)} distinct run scope(s): "
        + ", ".join(",".join(s) or "all" for s in sorted(scopes)))

    say("  embedding the questions...")
    vectors = {q: rag.embed([q], "search_query")[0] for q in QUESTIONS}
    out["vectors"] = {q: [float(x) for x in v] for q, v in vectors.items()}

    out["retrieval"] = {}
    out["stats"] = {}
    out["recall"] = {}
    for scope in SCOPES:
        label = ",".join(scope) if scope else "all"
        out["retrieval"][label] = {
            q: [_fingerprint_of(h) for h in rag.search(q, 8, mode="hybrid",
                                                       query_vector=vectors[q], categories=scope)]
            for q in QUESTIONS
        }
        targets = rag.shards(scope)
        parts = [rag.corpus_stats(rag.shard_connection(u), QUESTIONS[0], c) for u, c in targets]
        n, avgdl, df = rag.merge_stats(parts) if len(parts) > 1 else parts[0]
        out["stats"][label] = {"chunks": n, "avgdl": round(avgdl, 6),
                               "df": {k: int(v) for k, v in sorted(df.items())}}
        out["recall"][label] = round(_recall_split(rag, vectors, scope), 4)
        say(f"  {label:8} top-8 recorded, {n} chunks, avgdl {avgdl:.2f},"
            f" recall@40 {out['recall'][label]:.2f}")

    BASELINE.parent.mkdir(exist_ok=True)
    BASELINE.write_text(json.dumps(out, indent=1))
    say(f"\n  written to {BASELINE.relative_to(BASE)}")
    return out


def _recall_split(rag, vectors, scope) -> float:
    """HNSW recall@40 in the split system, measured against an exact scan of the
    same databases, so the merged system has something honest to beat."""
    total = matched = 0
    for url, cats in rag.shards(scope):
        conn = rag.shard_connection(url)
        for q, v in vectors.items():
            conn.execute("SET enable_indexscan = off")
            exact = {r[0] for r in conn.execute(
                "SELECT id FROM rag_chunks WHERE category = ANY(%s) ORDER BY embedding <=> %s LIMIT 40",
                (cats or [c for c, _, _ in rag.totals()], v)).fetchall()}
            conn.execute("SET enable_indexscan = on")
            got = {cid for cid, _ in rag.vector_ranking(conn, v, categories=cats)}
            total += len(exact)
            matched += len(exact & got)
    return matched / total if total else 1.0


def verify(target: str = DEFAULT_TARGET) -> bool:
    """Hold the merged database to what the baseline recorded."""
    sys.path.insert(0, str(BASE))
    import numpy as np
    import rag

    if not BASELINE.is_file():
        raise Failed(f"no baseline at {BASELINE}; run `consolidate.py baseline` first")
    want = json.loads(BASELINE.read_text())
    rule(f"Verifying {target}")
    conn = rag.connect(url=url_for(target))
    conn.execute(f"SET hnsw.ef_search = {rag.EF_SEARCH}")
    try:
        conn.execute("SET hnsw.iterative_scan = relaxed_order")
    except Exception:
        pass
    ok = True

    def check(label: str, passed: bool, detail: str = "") -> None:
        nonlocal ok
        ok = ok and passed
        say(f"  {'ok  ' if passed else 'FAIL'}  {label:46} {detail}")

    # 1. counts
    rows = conn.execute(
        "SELECT d.category, count(DISTINCT d.id), count(c.id) FROM rag_documents d"
        " LEFT JOIN rag_chunks c ON c.document_id = d.id GROUP BY 1 ORDER BY 1"
    ).fetchall()
    got = {r[0]: (r[1], r[2]) for r in rows}
    expect = {c: (d, ch) for c, d, ch in want["totals"]}
    check("§10.1 document and chunk counts per category", got == expect,
          "  ".join(f"{k} {v[0]}/{v[1]}" for k, v in sorted(got.items())))

    # 2. the content and the vectors came across byte for byte
    for cat, digests in want["digest"].items():
        now = {
            "embeddings": conn.execute(
                "SELECT md5(string_agg(embedding::text, ',' ORDER BY d.source, c.chunk_index))"
                " FROM rag_chunks c JOIN rag_documents d ON d.id = c.document_id"
                " WHERE c.category = %s", (cat,)).fetchone()[0],
            "tsv": conn.execute(
                "SELECT md5(string_agg(tsv::text, ',' ORDER BY d.source, c.chunk_index))"
                " FROM rag_chunks c JOIN rag_documents d ON d.id = c.document_id"
                " WHERE c.category = %s", (cat,)).fetchone()[0],
            "content": conn.execute(
                "SELECT md5(string_agg(content, ',' ORDER BY d.source, c.chunk_index))"
                " FROM rag_chunks c JOIN rag_documents d ON d.id = c.document_id"
                " WHERE c.category = %s", (cat,)).fetchone()[0],
        }
        for what, digest in sorted(digests.items()):
            check(f"§10.2 {cat} {what} digest", now[what] == digest,
                  (digest or "")[:12] if now[what] == digest else f"{digest} -> {now[what]}")

    # 3. no chunk disagrees with its document, and it cannot
    drift = conn.execute(
        "SELECT count(*) FROM rag_chunks c JOIN rag_documents d ON d.id = c.document_id"
        " WHERE c.category <> d.category").fetchone()[0]
    check("§10.3 every chunk agrees with its document", drift == 0, f"{drift} disagree")
    fk = conn.execute(
        "SELECT count(*) FROM pg_constraint WHERE conname = 'rag_chunks_document_fkey'"
    ).fetchone()[0]
    check("§10.3 the composite foreign key is in place", fk == 1)

    # 4. source is an identity again
    dupes = conn.execute(
        "SELECT count(*) FROM (SELECT source FROM rag_documents GROUP BY 1 HAVING count(*) > 1) x"
    ).fetchone()[0]
    check("§10.4 source is unique", dupes == 0, f"{dupes} repeated")

    # 5. the sequences will not hand out an id that is already taken
    for table in ("rag_documents", "rag_chunks"):
        # `pg_sequences.last_value` is null until the sequence has been read, so
        # the only honest way to ask what it will hand out next is to take one --
        # and then put it back, so running verify twice is not a way to burn ids.
        seq, mx = conn.execute(
            f"SELECT pg_get_serial_sequence('{table}', 'id'), (SELECT max(id) FROM {table})"
        ).fetchone()
        nxt = conn.execute("SELECT nextval(%s)", (seq,)).fetchone()[0]
        conn.execute("SELECT setval(%s, %s, false)", (seq, nxt))
        check(f"§10.5 {table} hands out an unused id next", nxt > mx, f"next {nxt} > max {mx}")

    # 6. the same questions come back with the same chunks
    vectors = {q: np.asarray(v, dtype=np.float32) for q, v in want["vectors"].items()}
    for scope in SCOPES:
        label = ",".join(scope) if scope else "all"
        agreed = total = 0
        for q in QUESTIONS:
            before = [tuple(f) for f in want["retrieval"][label][q]]
            after = [tuple(_fingerprint_of(h))
                     for h in _hits(conn, q, vectors[q], scope)]
            total += len(before)
            agreed += len(set(before) & set(after))
        check(f"§10.6 retrieval agrees, scope {label}", agreed >= AGREEMENT_FLOOR,
              f"{agreed}/{total} chunks (floor {AGREEMENT_FLOOR})")

    # 7. the vector index is not degenerate
    for scope in SCOPES:
        label = ",".join(scope) if scope else "all"
        matched = total = 0
        for q, v in vectors.items():
            where, params = rag._category_filter(scope)
            conn.execute("SET enable_indexscan = off")
            exact = {r[0] for r in conn.execute(
                f"SELECT id FROM rag_chunks{where} ORDER BY embedding <=> %s LIMIT 40",
                (*params, v)).fetchall()}
            conn.execute("SET enable_indexscan = on")
            got = {r[0] for r in conn.execute(
                f"SELECT id FROM rag_chunks{where} ORDER BY embedding <=> %s LIMIT 40",
                (*params, v)).fetchall()}
            total += len(exact)
            matched += len(exact & got)
        recall = matched / total if total else 1.0
        check(f"§10.7 hnsw recall@40, scope {label}", recall >= RECALL_FLOOR,
              f"{recall:.2f} (was {want['recall'][label]:.2f} split)")

    # 8. BM25 scores against the same corpus statistics as before
    for scope in SCOPES:
        label = ",".join(scope) if scope else "all"
        n, avgdl, df = rag.corpus_stats(conn, QUESTIONS[0], scope)
        was = want["stats"][label]
        same = (n == was["chunks"] and abs(avgdl - was["avgdl"]) < 1e-6
                and {k: int(v) for k, v in df.items()} == was["df"])
        check(f"§10.8 corpus statistics, scope {label}", same,
              f"{n} chunks, avgdl {avgdl:.2f}")

    # 9. a run can still be reproduced against the material it read
    for label, digest in sorted(want["fingerprints"].items()):
        now = _fingerprint_in(conn, label.split(",") if label else None)
        check(f"§10.9 corpus fingerprint, scope {label or 'all'}", now == digest,
              f"{digest} -> {now}" if now != digest else digest)

    say("\n  " + ("every check passed" if ok else "SOMETHING FAILED -- do not switch over"))
    return ok


def _fingerprint_in(conn, categories) -> str:
    """fitgap.store.corpus_fingerprint, computed in one database instead of
    across the shards. Same input, same hash: it covers (source, fingerprint)
    and never a row id, so the id offset cannot move it."""
    if categories:
        rows = conn.execute(
            "SELECT source, fingerprint FROM rag_documents WHERE category = ANY(%s)",
            (list(categories),)).fetchall()
    else:
        rows = conn.execute("SELECT source, fingerprint FROM rag_documents").fetchall()
    h = hashlib.sha256()
    for _, fp in sorted(rows):
        h.update(fp.encode())
    return h.hexdigest()[:16]


# --- entry point --------------------------------------------------------------


def run(target: str, skip_runs: bool = False) -> None:
    started = time.perf_counter()
    preflight(target)
    rule(f"Building {target}")
    create_target(target)
    copy_corpus(target)
    build_indexes(target)
    if not skip_runs:
        copy_run_stores(target)
        remap_citations(target)
    say(f"\n  done in {time.perf_counter() - started:.1f}s."
        f" Nothing was written to {', '.join(sorted(OFFSET))}.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    for name, help_ in (
        ("baseline", "record what the split system does, before anything moves"),
        ("preflight", "the checks that must pass before a merge is safe"),
        ("run", "create the merged database and copy everything into it"),
        ("verify", "prove the merged database answers like the split one did"),
    ):
        p = sub.add_parser(name, help=help_)
        if name != "baseline":
            p.add_argument("--target", default=DEFAULT_TARGET,
                           help=f"the database to build (default {DEFAULT_TARGET})")
        if name == "run":
            p.add_argument("--skip-run-stores", action="store_true",
                           help="corpus only; leave fitgap_* and rollout_* where they are")
    args = parser.parse_args()
    try:
        if args.command == "baseline":
            baseline()
        elif args.command == "preflight":
            preflight(args.target)
        elif args.command == "run":
            run(args.target, args.skip_run_stores)
        elif args.command == "verify":
            if not verify(args.target):
                sys.exit(1)
    except Failed as exc:
        sys.exit(f"\n  stopped: {exc}")


if __name__ == "__main__":
    main()

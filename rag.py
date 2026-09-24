"""Ask questions about the converted Markdown files (retrieval-augmented generation).

    python rag.py index solvay-spark/pkg/markdown   chunk, embed and store the files
    python rag.py search "Who validated 7.1.12.3?"  show the closest chunks
    python rag.py ask "Who validated 7.1.12.3?"     answer from those chunks
    python rag.py categories                        what is indexed, per category

Indexing splits each .md file into sections (md_chunker), embeds every chunk
with Cohere Embed and stores the text and vector in Postgres with pgvector,
next to a full-text index of the same text. A question is looked up both ways:

* vector search -- the question is embedded and Postgres returns the chunks
  nearest in meaning (cosine distance);
* keyword search -- the chunks containing the question's words, ranked by
  BM25, so exact identifiers such as "7.1.12.3" or "M-090-030" are found even
  when the embedding treats them as noise.

The two rankings are merged with reciprocal rank fusion, and Claude writes an
answer from the top chunks only, citing them.

Every document carries a category -- PKG for the package documents, DR for
design reviews -- and a search can be restricted to some of them. The category
is a column, not a database: one corpus, one index, one row per chunk, and
scoping a search is a WHERE clause. See the "categories" section below for how
a file gets its category.

Settings come from the environment or the project's .env:

    DATABASE_URL        e.g. postgresql://user:password@localhost:5432/docling
    ANTHROPIC_API_KEY   for `ask`
    OLLAMA_HOST         default http://127.0.0.1:11434
    RAG_EMBED_MODEL     default bge-m3
    RAG_EMBED_DIMENSION default 1024
    RAG_ANSWER_MODEL    default claude-opus-5
    RAG_HNSW_EF_SEARCH  default 800 (see _tune)

The chunk text goes to Ollama when indexing, and the question plus the
retrieved chunks go to Anthropic when asking.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import re
import sys
import threading
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
from dotenv import load_dotenv

import md_chunker
import tracing
from md_chunker import Chunk, chunk_file, with_context

load_dotenv(Path(__file__).with_name(".env"), override=False)

OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434").rstrip("/")
EMBED_MODEL = os.environ.get("RAG_EMBED_MODEL", "bge-m3")
EMBED_DIMENSION = int(os.environ.get("RAG_EMBED_DIMENSION", "1024"))
ANSWER_MODEL = os.environ.get("RAG_ANSWER_MODEL", "claude-opus-5")
EMBED_BATCH = int(os.environ.get("RAG_EMBED_BATCH", "32"))
DEFAULT_K = 8
# Each search method proposes this many chunks before the rankings are fused.
CANDIDATES = 40
# Reciprocal rank fusion: a chunk scores 1 / (RRF_K + rank) in each ranking.
# 60 is the constant from the original RRF paper; it keeps one first place from
# outweighing agreement between the two methods.
RRF_K = 60
# Postgres text-search configuration: English stemming ("owners" -> "owner").
TEXT_SEARCH_CONFIG = "english"
MODES = ("hybrid", "vector", "keyword")
# HNSW walks the index before it applies a WHERE clause, so a filtered search
# returns whatever survives the walk -- at the default ef_search of 40, asking
# for 40 chunks from one category of several comes back with a handful. See
# _tune below.
#
# 800 rather than 200 because one index over every category is a bigger graph
# than one index per category was, and a walk that collects 200 candidates from
# it finds fewer of the true nearest neighbours. Measured over ten questions
# against an exact scan, searching every category: 0.85 at 200, 0.88 at 400,
# 0.98 at 600 and above. 0.98 is what the per-category indexes gave, because a
# search across two of them collected 40 candidates from each and kept the best
# 40 -- two small walks beat one large one, and ef_search is how the single
# index buys that back. It costs about 0.7 ms a query against a search that
# takes 180.
EF_SEARCH = int(os.environ.get("RAG_HNSW_EF_SEARCH", "800"))

BASE = Path(__file__).resolve().parent


# --- categories ---------------------------------------------------------------
#
# A category is metadata, not embedded text. A three-letter code means nothing
# to bge-m3, and adding "Category: PKG" to every chunk of a category would move
# that whole cluster by the same constant vector without making any chunk in it
# easier to tell apart. Keeping the category out of the vector also means
# re-tagging a document is an UPDATE rather than 50 embedding calls.
#
# Every category lives in the same tables, told apart by a column. The corpus
# was split across a database per category for one release; it was merged back
# because `rag_documents.source` is declared UNIQUE and could only be unique
# per database, so the same file could be indexed twice and one DELETE removed
# both. In one table that state cannot be written down. See migration_plan.md.
#
# Adding a category still takes no code change. Drop the Markdown in
# solvay-spark/<code>/markdown and index it: the folder names the category and
# the row records it. CATEGORIES below only carries the labels and descriptions
# worth showing in the UI; a category that is not in it is still a category, and
# rag_categories is the registry of the ones that exist.

UNFILED = "UNFILED"

CATEGORIES: dict[str, dict[str, str]] = {
    "PKG": {
        "label": "PKG",
        "description": "Package documents, converted from solvay-spark/pkg",
        "folder": "solvay-spark/pkg/markdown",
    },
    "DR": {
        "label": "DR",
        "description": "Design review documents",
        "folder": "solvay-spark/dr/markdown",
    },
    UNFILED: {
        "label": "Unfiled",
        "description": "Added from the web UI without a category, or indexed before categories existed",
        "folder": "knowledge_base",
    },
}

# <anything>/<code>/markdown names its category, so a new category needs no
# entry above: solvay-spark/dr/markdown is DR whether or not anyone said so.
MARKDOWN_FOLDER = "markdown"

# Codes that name a store rather than a corpus, and must never be accepted as a
# document category.
#
# SESSION is the database holding InsightLens's and the Fit-Gap Copilot's
# uploaded documents, one Postgres schema per session, and UPLOAD is the
# category their chunks carry inside it. Keeping an attachment out of the corpus
# is structural -- it is in another database entirely, and this list only stops
# someone filing a document under the same name.
RESERVED_CODES = {"FITGAP", "ROLLOUT", "SESSION", "UPLOAD"}

# A category code reaches SQL as text in exactly one place -- ts_stat takes its
# query as a string literal, so it cannot be a bind parameter -- and every code
# is checked against this before it gets there.
_CATEGORY_CODE = re.compile(r"[A-Z][A-Z0-9_]{0,31}")
_FRONT_MATTER = re.compile(r"\A---\r?\n(.*?)\r?\n---\r?\n", re.S)


def check_category(code: str) -> str:
    """The code, upper-cased, or ValueError. Every path into SQL goes through
    here; a code that is well formed but not in CATEGORIES is still accepted,
    so a new category needs no code change to start using."""
    code = (code or "").strip().upper()
    if not _CATEGORY_CODE.fullmatch(code):
        raise ValueError(f"not a category code: {code!r} (letters, digits and _, starting with a letter)")
    return code


def front_matter(text: str) -> dict[str, str]:
    """The `key: value` pairs of a leading `---` block, keys lower-cased."""
    m = _FRONT_MATTER.match(text)
    if not m:
        return {}
    fields: dict[str, str] = {}
    for line in m.group(1).splitlines():
        key, sep, value = line.partition(":")
        if sep and key.strip():
            fields[key.strip().lower()] = value.strip().strip("\"'")
    return fields


def category_for(path: Path, explicit: str | None = None, text: str | None = None) -> str:
    """The category of a Markdown file: an explicit choice first, then the
    file's own front matter, then the folder it sits in, then UNFILED.

    `text` is the file's contents when the caller has already read them; pass
    "" to skip the front matter and decide on the folder alone, which is what
    backfilling an old row does when the file may no longer be there."""
    if explicit:
        return check_category(explicit)
    if text is None:
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            text = ""
    declared = front_matter(text).get("category")
    if declared:
        return check_category(declared)
    parent = path.resolve().parent
    for code, meta in CATEGORIES.items():
        folder = meta.get("folder")
        if folder and (BASE / folder).resolve() == parent:
            return code
    # <anything>/<code>/markdown, so a folder for a category nobody registered
    # still files itself correctly.
    if parent.name == MARKDOWN_FOLDER:
        try:
            return check_category(parent.parent.name)
        except ValueError:
            pass
    return UNFILED


def declare_category(text: str, code: str) -> str:
    """`text` with `category: <code>` recorded in its front matter.

    Keeps any other keys that are already there, and rewrites the category key
    rather than adding a second one."""
    code = check_category(code)
    m = _FRONT_MATTER.match(text)
    if not m:
        return f"---\ncategory: {code}\n---\n\n{text.lstrip()}"
    kept = [
        line for line in m.group(1).splitlines()
        if line.partition(":")[0].strip().lower() != "category"
    ]
    block = "\n".join(["category: " + code, *kept])
    return f"---\n{block}\n---\n" + text[m.end():]


def record_category(path: Path, code: str) -> bool:
    """Write the category into the file, so the decision lives on disk.

    A category chosen in the UI used to be stored on the database row and
    nowhere else. The graph builds from Markdown and never reads the database,
    so it filed the document by the folder instead and the two disagreed -- and
    worse, re-indexing the folder reset the document to whatever the folder
    implied, silently discarding the choice. Recording it in the file fixes
    both: `category_for` reads front matter ahead of the folder, and the file
    now answers the question by itself.

    Returns True when the file was changed. Costs no re-embedding: front
    matter is outside the fingerprint."""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return False
    if front_matter(text).get("category", "").strip().upper() == check_category(code):
        return False
    path.write_text(declare_category(text, code), encoding="utf-8")
    return True


def base_url() -> str:
    """DATABASE_URL: the database holding the corpus, the run stores and the
    category registry. Everything but an analyst's attachments is in it."""
    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL is not set (add it to .env)")
    return url


def sibling_database(name: str) -> str:
    """A database beside the main one, named after it: with
    DATABASE_URL=.../docling, sibling_database("session") is .../docling_session.

    There is exactly one of these, and uploads.py owns it. An analyst's
    attachment lives in a schema of its own in a database of its own, and that
    separation is a guarantee InsightLens and the Fit-Gap Copilot make: a search
    of the corpus cannot reach it, because it is not in the corpus database."""
    from urllib.parse import urlsplit, urlunsplit

    parts = urlsplit(base_url())
    base = parts.path.lstrip("/") or "docling"
    return urlunsplit((parts.scheme, parts.netloc, f"/{base}_{name.lower()}", parts.query, parts.fragment))


def database_name(url: str) -> str:
    from urllib.parse import urlsplit

    return urlsplit(url).path.lstrip("/")


def database_exists(url: str) -> bool:
    """Whether a database has been created yet. The session database is created
    by its first write, so anything that only wants to tidy up or report has to
    be able to ask without creating one."""
    import psycopg
    from urllib.parse import urlsplit, urlunsplit

    parts = urlsplit(url)
    maintenance = urlunsplit((parts.scheme, parts.netloc, "/postgres", parts.query, parts.fragment))
    try:
        with psycopg.connect(maintenance, autocommit=True, connect_timeout=5) as conn:
            return bool(
                conn.execute(
                    "SELECT 1 FROM pg_database WHERE datname = %s", (database_name(url),)
                ).fetchone()
            )
    except Exception:
        return False


_DISCOVERY_TTL = 60.0  # seconds; a database another process created or dropped shows up within this

# (checked at, exists). Time-limited in both directions: a database created or
# dropped by another process -- or by hand -- must not stay wrong until this
# one restarts.
_exists_cache: dict[str, tuple[float, bool]] = {}


def database_live(url: str) -> bool:
    """database_exists, cached for _DISCOVERY_TTL. Anything on the path of a
    request should ask this rather than database_exists, which opens a
    connection to the maintenance database every time."""
    import time as _time

    hit = _exists_cache.get(url)
    if hit and _time.monotonic() - hit[0] < _DISCOVERY_TTL:
        return hit[1]
    alive = database_exists(url)
    _exists_cache[url] = (_time.monotonic(), alive)
    return alive


def ensure_sibling(name: str) -> str:
    """The url of a sibling database, created if it is not there yet."""
    url = sibling_database(name)
    if database_live(url):
        return url
    import psycopg
    import time as _time
    from urllib.parse import urlsplit, urlunsplit

    parts = urlsplit(url)
    maintenance = urlunsplit((parts.scheme, parts.netloc, "/postgres", parts.query, parts.fragment))
    dbname = database_name(url)
    with psycopg.connect(maintenance, autocommit=True) as conn:
        if not conn.execute("SELECT 1 FROM pg_database WHERE datname = %s", (dbname,)).fetchone():
            conn.execute(f'CREATE DATABASE "{dbname}"')
    _exists_cache[url] = (_time.monotonic(), True)
    return url


def known_categories() -> list[str]:
    """Every category this installation knows about: the registry in the
    database, and the ones described above in case the registry is unreachable.

    A category exists because a row says so, not because a database is named
    after it. That is the difference the merge made, and it is why a code that
    names a store -- SESSION, UPLOAD -- can no longer be mistaken for a corpus."""
    found = set(CATEGORIES)
    try:
        conn = connection()
        if conn.execute("SELECT to_regclass('rag_categories')").fetchone()[0]:
            found |= {r[0] for r in conn.execute("SELECT code FROM rag_categories").fetchall()}
        found |= {r[0] for r in conn.execute("SELECT DISTINCT category FROM rag_documents").fetchall()}
    except Exception:
        pass  # before the first index there is nothing to read; the registry above stands
    return sorted(c for c in found if c not in RESERVED_CODES)


def describe(code: str) -> dict:
    meta = CATEGORIES.get(code, {})
    return {
        "code": code,
        "label": meta.get("label", code),
        "description": meta.get("description", ""),
        "folder": meta.get("folder", f"solvay-spark/{code.lower()}/{MARKDOWN_FOLDER}"),
    }


ANSWER_SYSTEM = """\
You answer questions about project documents from an SAP implementation \
(workshop slides, process flows, specifications, spreadsheets). You are given \
numbered excerpts retrieved from those documents.

Answer only from the excerpts. Cite the excerpts you used with their numbers in \
square brackets, like [2] or [1][4]. If the excerpts do not contain the answer, \
say that plainly and say what they do cover; do not fill gaps from general SAP \
knowledge.

Each excerpt carries the category of the document it came from, such as PKG \
for the package documents. Say which category an answer rests on when \
excerpts from different categories disagree.

The documents were converted to Markdown automatically. Text from pictures was \
read by OCR and can contain misread characters, and flowcharts traced from \
pictures can have wrong or missing arrows, so mention it when an answer rests \
on such text."""


# --- embedding ----------------------------------------------------------------


def embed(texts: list[str], input_type: str = "") -> list[np.ndarray]:
    """Embed texts using Ollama bge-m3."""
    if not texts:
        return []
    import httpx

    url = f"{OLLAMA_HOST}/api/embed"
    vectors: list[np.ndarray] = []
    for start in range(0, len(texts), EMBED_BATCH):
        batch = texts[start : start + EMBED_BATCH]
        try:
            with httpx.Client(timeout=120.0, trust_env=False) as client:
                res = client.post(url, json={"model": EMBED_MODEL, "input": batch})
                if res.status_code == 200:
                    data = res.json()
                    embs = data.get("embeddings", [])
                    vectors += [np.asarray(v, dtype=np.float32) for v in embs]
                elif res.status_code == 404:
                    # Fallback to older Ollama /api/embeddings endpoint
                    for t in batch:
                        single_res = client.post(
                            f"{OLLAMA_HOST}/api/embeddings",
                            json={"model": EMBED_MODEL, "prompt": t},
                        )
                        single_res.raise_for_status()
                        vectors.append(np.asarray(single_res.json()["embedding"], dtype=np.float32))
                else:
                    res.raise_for_status()
        except Exception as exc:
            raise RuntimeError(
                f"Failed to generate embeddings from Ollama ({EMBED_MODEL}): {exc}. "
                f"Make sure Ollama is running and '{EMBED_MODEL}' is downloaded (`ollama pull {EMBED_MODEL}`)."
            ) from exc

    return vectors


# --- storage ------------------------------------------------------------------


def connect(url: str | None = None):
    """A fresh connection to the corpus database, or to `url`.

    Most callers want `connection()` instead, which hands out a cached one. This
    is for the paths that need a connection of their own: the CLI, and the
    session database, which uploads.py opens with its own search_path."""
    import psycopg
    from pgvector.psycopg import register_vector

    url = url or base_url()
    # Autocommit, so each `with conn.transaction()` below is a real transaction
    # rather than a savepoint inside one that is never committed.
    conn = psycopg.connect(url, autocommit=True)
    conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
    register_vector(conn)
    _tune(conn)
    return conn


def _tune(conn) -> None:
    """Keep approximate vector search honest once a category filter is in play.

    HNSW is an approximate index: Postgres walks it, collects about ef_search
    candidates, and applies the WHERE clause to what comes back. Filter to a
    category that is a tenth of the corpus and a request for 40 chunks returns
    about four -- quietly, with no error, and they are not the best four
    either. pgvector 0.8 can keep walking until the limit is filled; ef_search
    is raised as well, which is the only lever older versions have.

    The size of ef_search matters more now that one index covers every category
    than it did when each category had one of its own -- see EF_SEARCH."""
    conn.execute(f"SET hnsw.ef_search = {EF_SEARCH}")
    try:
        conn.execute("SET hnsw.iterative_scan = relaxed_order")
    except Exception:  # pgvector < 0.8: ef_search alone has to carry it
        pass


_local = threading.local()
_schema_ready = False
_schema_lock = threading.Lock()


def connection(schema: bool = True):
    """The corpus connection for this thread, reused across searches, with the
    schema checked once per process. psycopg connections are not thread safe,
    so these are never shared between threads."""
    global _schema_ready
    conn = getattr(_local, "conn", None)
    if conn is None or conn.closed:
        conn = _local.conn = connect()
    if schema:
        with _schema_lock:
            first = not _schema_ready
            _schema_ready = True
        if first:
            create_schema(conn)
    return conn


def close() -> None:
    """Release this thread's connection. A worker calls this when it is done;
    the schema check is per process and is not undone."""
    conn = getattr(_local, "conn", None)
    if conn is not None:
        try:
            conn.close()
        except Exception:
            pass
    _local.conn = None


def create_schema(conn, rebuild: bool = False) -> None:
    with conn.transaction():
        _create_tables(conn, rebuild)
    stored = conn.execute(
        "SELECT atttypmod FROM pg_attribute"
        " WHERE attrelid = 'rag_chunks'::regclass AND attname = 'embedding'"
    ).fetchone()[0]
    if stored != EMBED_DIMENSION:
        # Schema dimension changed (e.g. from Cohere 1536 to bge-m3 1024), automatically rebuild
        with conn.transaction():
            _create_tables(conn, rebuild=True)


def _create_tables(conn, rebuild: bool) -> None:
    if rebuild:
        conn.execute("DROP TABLE IF EXISTS rag_chunks, rag_documents")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS rag_documents (
            id          bigserial PRIMARY KEY,
            source      text NOT NULL UNIQUE,   -- path of the .md file; an identity again
            title       text NOT NULL,          -- original document, e.g. "X (pptx)"
            fingerprint text NOT NULL,          -- file content + chunking and embedding settings
            indexed_at  timestamptz NOT NULL DEFAULT now()
        )"""
    )
    conn.execute(
        f"""
        CREATE TABLE IF NOT EXISTS rag_chunks (
            id           bigserial PRIMARY KEY,
            document_id  bigint NOT NULL REFERENCES rag_documents(id) ON DELETE CASCADE,
            chunk_index  int NOT NULL,
            heading_path text NOT NULL,
            content      text NOT NULL,
            tokens       int NOT NULL,
            embedding    vector({EMBED_DIMENSION}) NOT NULL,
            UNIQUE (document_id, chunk_index)
        )"""
    )
    # Approximate nearest-neighbour index for cosine distance (the <=> operator).
    conn.execute(
        "CREATE INDEX IF NOT EXISTS rag_chunks_embedding_idx"
        " ON rag_chunks USING hnsw (embedding vector_cosine_ops)"
    )
    # Full-text index for keyword search. Added with ALTER so an index built
    # before keyword search existed gains it without re-embedding.
    conn.execute("ALTER TABLE rag_chunks ADD COLUMN IF NOT EXISTS tsv tsvector")
    conn.execute("CREATE INDEX IF NOT EXISTS rag_chunks_tsv_idx ON rag_chunks USING gin (tsv)")
    missing = conn.execute(
        "SELECT c.id, d.title, c.heading_path, c.content"
        " FROM rag_chunks c JOIN rag_documents d ON d.id = c.document_id WHERE c.tsv IS NULL"
    ).fetchall()
    with conn.cursor() as cur:
        cur.executemany(
            f"UPDATE rag_chunks SET tsv = to_tsvector('{TEXT_SEARCH_CONFIG}', %s) WHERE id = %s",
            [(keyword_text(with_context(t, h, c)), i) for i, t, h, c in missing],
        )
    _create_category_columns(conn)


def _create_category_columns(conn) -> None:
    """The category, added with ALTER so an index built before categories
    existed gains it without re-embedding.

    It is denormalised onto rag_chunks as well as rag_documents. Both rankings
    query rag_chunks on its own, and joining rag_documents in to reach the
    category would only give the planner a reason to stop using the HNSW
    index. UNFILED is the default, so existing rows stay valid; _backfill_
    categories then places them by the folder they were indexed from."""
    for table in ("rag_documents", "rag_chunks"):
        conn.execute(
            f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT '{UNFILED}'"
        )
    conn.execute("CREATE INDEX IF NOT EXISTS rag_chunks_category_idx ON rag_chunks (category)")
    conn.execute("CREATE INDEX IF NOT EXISTS rag_documents_category_idx ON rag_documents (category)")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS rag_categories (
            code        text PRIMARY KEY,
            label       text NOT NULL,
            description text NOT NULL DEFAULT '',
            folder      text NOT NULL DEFAULT ''
        )"""
    )
    # Seeded, never overwritten: a label edited in the database stays edited.
    with conn.cursor() as cur:
        cur.executemany(
            "INSERT INTO rag_categories (code, label, description, folder)"
            " VALUES (%s, %s, %s, %s) ON CONFLICT (code) DO NOTHING",
            [(c, m["label"], m["description"], m["folder"]) for c, m in CATEGORIES.items()],
        )
    _backfill_categories(conn)
    _link_chunks_to_documents(conn)


def _backfill_categories(conn) -> None:
    """Place documents indexed before categories existed by the folder they
    came from, and repair any chunk whose category has drifted from its
    document's."""
    rows = conn.execute(
        "SELECT id, source FROM rag_documents WHERE category = %s", (UNFILED,)
    ).fetchall()
    placed: dict[str, list[int]] = {}
    for doc_id, source in rows:
        # "" for the text: the file may be gone, and the folder decides anyway.
        code = category_for(Path(source), text="")
        if code != UNFILED:
            placed.setdefault(code, []).append(doc_id)
    for code, ids in placed.items():
        conn.execute("UPDATE rag_documents SET category = %s WHERE id = ANY(%s)", (code, ids))
    conn.execute(
        "UPDATE rag_chunks c SET category = d.category FROM rag_documents d"
        " WHERE d.id = c.document_id AND c.category <> d.category"
    )
    if placed:
        for code, ids in placed.items():
            conn.execute(
                "INSERT INTO rag_categories (code, label, description, folder) VALUES (%s, %s, '', '')"
                " ON CONFLICT (code) DO NOTHING",
                (code, CATEGORIES.get(code, {}).get("label", code)),
            )


def _link_chunks_to_documents(conn) -> None:
    """Make a chunk's category follow its document's, in the schema rather than
    by repair.

    rag_chunks.category is denormalised (see above), and nothing stopped it
    drifting from rag_documents.category -- _backfill_categories exists to fix
    that drift after the fact, which is an admission that it happens. A foreign
    key on (document_id, category) makes the drift unrepresentable, and
    ON UPDATE CASCADE means re-tagging a document carries its chunks with it in
    the same statement rather than in a second one that can fail on its own.

    Added with ALTER so an index built before this gains it. The plain
    document_id key it replaces is dropped: the composite one implies it."""
    if conn.execute(
        "SELECT 1 FROM pg_constraint WHERE conname = 'rag_chunks_document_fkey'"
    ).fetchone():
        return
    conn.execute(
        "UPDATE rag_chunks c SET category = d.category FROM rag_documents d"
        " WHERE d.id = c.document_id AND c.category <> d.category"
    )
    with conn.transaction():
        conn.execute(
            "ALTER TABLE rag_documents ADD CONSTRAINT rag_documents_id_category_key"
            " UNIQUE (id, category)"
        )
        for (name,) in conn.execute(
            "SELECT conname FROM pg_constraint"
            " WHERE conrelid = 'rag_chunks'::regclass AND contype = 'f'"
        ).fetchall():
            conn.execute(f'ALTER TABLE rag_chunks DROP CONSTRAINT "{name}"')
        conn.execute(
            "ALTER TABLE rag_chunks ADD CONSTRAINT rag_chunks_document_fkey"
            " FOREIGN KEY (document_id, category) REFERENCES rag_documents (id, category)"
            " ON DELETE CASCADE ON UPDATE CASCADE"
        )


# Codes like M-090-030 or L-110-140-010. Postgres splits them at the hyphens
# into "m", "-090", "-030", which also match every other M-090-... step.
_CODE = re.compile(r"\b([A-Za-z][A-Za-z0-9]{0,3})-(\d{2,3}(?:-\d{2,3})+)\b")


def keyword_text(text: str) -> str:
    """Text for the full-text index: each code is added again as one word, with
    its parent codes, so M-090-030-010 is also found by a search for M-090-030."""
    words = []
    for m in _CODE.finditer(text):
        parts = [m.group(1), *m.group(2).split("-")]
        words += ["".join(parts[:n]) for n in range(3, len(parts) + 1)]
    return text + ("\n" + " ".join(words) if words else "")


def fingerprint(text: str) -> str:
    """Identifies what would be embedded from this text.

    Front matter is excluded, because md_chunker strips it before chunking:
    none of it reaches a vector, so a change to it is not a change to the
    index. That matters because the category is RECORDED in front matter --
    without this, writing down which corpus a document belongs to would
    re-embed the whole file and renumber every chunk id, staling the citations
    in stored runs. Recording a decision must not cost the evidence.

    No document carried front matter when this was introduced, so every
    existing fingerprint is unchanged by it."""
    settings = (
        f"{EMBED_MODEL}:{EMBED_DIMENSION}:{md_chunker.TARGET_TOKENS}:"
        f"{md_chunker.MAX_TOKENS}:{md_chunker.MIN_TOKENS}\n"
    )
    # The blank line a front-matter block leaves behind is not content either:
    # without dropping it, RECORDING a category on a file that had none would
    # change the hash and re-embed the very document being filed.
    body = md_chunker._strip_front_matter(text).lstrip("\r\n")
    return hashlib.sha256((settings + body).encode()).hexdigest()


def store(
    conn,
    path: Path,
    chunks: list[Chunk],
    vectors: list[np.ndarray],
    fingerprint_: str,
    category: str = UNFILED,
) -> None:
    category = check_category(category)
    with conn.transaction():
        conn.execute("DELETE FROM rag_documents WHERE source = %s", (str(path),))
        doc_id = conn.execute(
            "INSERT INTO rag_documents (source, title, fingerprint, category)"
            " VALUES (%s, %s, %s, %s) RETURNING id",
            (
                str(path),
                chunks[0].title if chunks else md_chunker.document_title(path),
                fingerprint_,
                category,
            ),
        ).fetchone()[0]
        with conn.cursor() as cur:
            cur.executemany(
                "INSERT INTO rag_chunks"
                " (document_id, chunk_index, heading_path, content, tokens, embedding, category, tsv)"
                f" VALUES (%s, %s, %s, %s, %s, %s, %s, to_tsvector('{TEXT_SEARCH_CONFIG}', %s))",
                [
                    (doc_id, c.index, c.heading_path, c.content, c.tokens, v, category,
                     keyword_text(c.embedding_text()))
                    for c, v in zip(chunks, vectors)
                ],
            )
        conn.execute(
            "INSERT INTO rag_categories (code, label, description, folder) VALUES (%s, %s, '', '')"
            " ON CONFLICT (code) DO NOTHING",
            (category, CATEGORIES.get(category, {}).get("label", category)),
        )


def recategorise(conn, path: Path, category: str) -> None:
    """Move a document to another category without touching its vectors.

    One statement: the foreign key on (document_id, category) is ON UPDATE
    CASCADE, so the chunks follow the document rather than being updated after
    it in a second statement that could fail on its own."""
    category = check_category(category)
    with conn.transaction():
        doc = conn.execute(
            "UPDATE rag_documents SET category = %s WHERE source = %s RETURNING id",
            (category, str(path)),
        ).fetchone()
        if doc:
            conn.execute(
                "INSERT INTO rag_categories (code, label, description, folder) VALUES (%s, %s, '', '')"
                " ON CONFLICT (code) DO NOTHING",
                (category, CATEGORIES.get(category, {}).get("label", category)),
            )


# --- indexing -----------------------------------------------------------------


def index_file(conn, path: Path, force: bool = False, on_embed=None, category: str | None = None) -> dict:
    """Chunk, embed and store one .md file, replacing what the index held for
    that path. Skips the embedding call when the file and settings are unchanged."""
    path = path.resolve()
    text = path.read_text(encoding="utf-8")
    code = category_for(path, category, text)
    fingerprint_ = fingerprint(text)
    row = conn.execute(
        "SELECT fingerprint, category FROM rag_documents WHERE source = %s", (str(path),)
    ).fetchone()
    chunks = chunk_file(path)
    result = {
        "status": "unchanged" if row and row[0] == fingerprint_ and not force else ("updated" if row else "added"),
        "title": md_chunker.document_title(path),
        "category": code,
        "chunks": len(chunks),
        "tokens": sum(c.tokens for c in chunks),
    }
    if result["status"] == "unchanged":
        # The category is deliberately not part of the fingerprint, so that
        # re-tagging costs an UPDATE instead of re-embedding every chunk. That
        # also means it cannot wait for the file to change.
        if row[1] != code:
            recategorise(conn, path, code)
            result["recategorised"] = row[1]
        return result
    if on_embed:
        on_embed(len(chunks))
    vectors = embed([c.embedding_text() for c in chunks], "search_document")
    store(conn, path, chunks, vectors, fingerprint_, code)
    return result


def index_path(path: Path, force: bool = False, on_embed=None, category: str | None = None) -> dict:
    """index_file, filed under the category the file belongs to."""
    code = category_for(path, category)
    return index_file(connection(), path, force, on_embed, code)


def index(folder: Path, rebuild: bool = False, force: bool = False, category: str | None = None) -> None:
    folder = folder.resolve()
    files = sorted(folder.glob("*.md"))
    if not files:
        sys.exit(f"No .md files in {folder}")
    # Normally every file in a folder shares its category, but front matter can
    # send one elsewhere, so each file is placed on its own.
    placed = {path: category_for(path, category) for path in files}
    conn = connect()
    try:
        create_schema(conn, rebuild)
        for i, path in enumerate(files, 1):
            code = placed[path]
            result = index_file(
                conn, path, force,
                on_embed=lambda n, i=i, path=path, code=code: print(
                    f"[{i}/{len(files)}] {path.name} -> {code}: {n} chunks, embedding...", flush=True
                ),
                category=code,
            )
            if result["status"] == "unchanged":
                was = result.get("recategorised")
                print(f"[{i}/{len(files)}] {path.name}: unchanged" + (f", re-tagged {was} -> {code}" if was else ""))

        # Files deleted from the folder leave the index.
        keep = set(str(path) for path in files)
        rows = conn.execute("SELECT source FROM rag_documents").fetchall()
        gone = [src for (src,) in rows if Path(src).parent == folder and src not in keep]
        with conn.transaction():
            for src in gone:
                conn.execute("DELETE FROM rag_documents WHERE source = %s", (src,))
        if gone:
            print(f"Removed {len(gone)} stale document{'s' if len(gone) != 1 else ''} from the index")

        for code, docs, chunks in totals():
            print(f"  {code:<10} {docs:>4} documents  {chunks:>6} chunks")
    finally:
        conn.close()


def totals(categories: Sequence[str] | None = None) -> list[tuple[str, int, int]]:
    """[(category, documents, chunks), ...]."""
    where, params = _category_filter(categories, "d.category")
    return sorted(
        (row[0], row[1], row[2])
        for row in connection().execute(
            "SELECT d.category, count(DISTINCT d.id), count(c.id)"
            " FROM rag_documents d LEFT JOIN rag_chunks c ON c.document_id = d.id"
            f"{where} GROUP BY d.category",
            params,
        ).fetchall()
    )


def counts(categories: Sequence[str] | None = None) -> tuple[int, int]:
    """(documents, chunks)."""
    rows = totals(categories)
    return sum(d for _, d, _ in rows), sum(c for _, _, c in rows)


def documents() -> list[dict]:
    """Every indexed document."""
    out = [
        {
            "id": r[0], "source": r[1], "title": r[2], "category": r[3],
            "chunks": int(r[4]), "tokens": int(r[5]), "indexed_at": r[6],
        }
        for r in connection().execute(
            "SELECT d.id, d.source, d.title, d.category, count(c.id), coalesce(sum(c.tokens), 0),"
            " d.indexed_at FROM rag_documents d LEFT JOIN rag_chunks c ON c.document_id = d.id"
            " GROUP BY d.id, d.source, d.title, d.category, d.indexed_at"
        ).fetchall()
    ]
    out.sort(key=lambda d: (d["indexed_at"] is None, d["indexed_at"]), reverse=True)
    return out


def find_document(filename: str) -> str | None:
    """The source path of an indexed document, by file name."""
    row = connection().execute(
        "SELECT source FROM rag_documents WHERE source LIKE %s OR source = %s LIMIT 1",
        (f"%/{filename}", filename),
    ).fetchone()
    return row[0] if row else None


def documents_named(filename: str) -> list[dict]:
    """Every indexed document whose file has this name.

    A file name is still not an identity -- knowledge_base/X.md and
    solvay-spark/pkg/markdown/X.md are two documents -- but a source path is
    one again, which it could not be while a category had a database of its
    own and UNIQUE(source) only held inside each."""
    return [
        {"id": r[0], "title": r[1], "source": r[2], "category": r[3]}
        for r in connection().execute(
            "SELECT id, title, source, category FROM rag_documents"
            " WHERE source LIKE %s OR source = %s ORDER BY id",
            (f"%/{filename}", filename),
        ).fetchall()
    ]


def delete_document(filename: str, category: str | None = None,
                    source: str | None = None) -> int:
    """Remove a document. Deletes its chunks with it: the foreign key on
    rag_chunks is ON DELETE CASCADE.

    With neither `source` nor `category` this removes every document of that
    name. `source` identifies one exactly; the API endpoint passes it when the
    name is shared."""
    sql = "DELETE FROM rag_documents WHERE (source LIKE %s OR source = %s)"
    args: list = [f"%/{filename}", filename]
    if source:
        sql += " AND source = %s"
        args.append(source)
    if category:
        sql += " AND category = %s"
        args.append(check_category(category))
    conn = connection()
    with conn.transaction():
        return len(conn.execute(sql + " RETURNING id", tuple(args)).fetchall())


def chunk(key: str) -> dict | None:
    """One chunk by its Hit.key ("PKG:412"), or by a bare row id.

    The prefix names the category the chunk is filed under. It used to name the
    database as well, and route the lookup; now it is checked against what the
    row says, so a key from somewhere else cannot quietly return the wrong
    chunk."""
    code, _, digits = str(key).rpartition(":")
    if not digits.isdigit():
        return None
    if code:
        try:
            code = check_category(code)
        except ValueError:
            return None
    row = connection().execute(
        "SELECT c.id, d.title, d.source, c.heading_path, c.content, c.tokens, c.category"
        " FROM rag_chunks c JOIN rag_documents d ON d.id = c.document_id WHERE c.id = %s",
        (int(digits),),
    ).fetchone()
    if not row or (code and row[6] != code):
        return None
    return {
        "chunk_id": f"{row[6]}:{row[0]}", "title": row[1], "source": row[2],
        "heading_path": row[3], "content": row[4], "tokens": row[5], "category": row[6],
    }


def duplicate_sources(title: str, source: str) -> list[str]:
    """The same document indexed from somewhere else."""
    return [
        r[0]
        for r in connection().execute(
            "SELECT source FROM rag_documents WHERE title = %s AND source <> %s",
            (title, source),
        ).fetchall()
    ]


def clear_index(categories: Sequence[str] | None = None) -> None:
    """Delete indexed documents and chunks, in some categories or in all."""
    conn = connect()
    try:
        with conn.transaction():
            if categories:
                conn.execute(
                    "DELETE FROM rag_documents WHERE category = ANY(%s)",
                    ([check_category(c) for c in categories],),
                )
            else:
                conn.execute("TRUNCATE TABLE rag_documents CASCADE")
    finally:
        conn.close()
    scope = ", ".join(categories) if categories else "every category"
    print(f"✓ Cleared {scope}: documents and chunks removed.")


def reset_schema(categories: Sequence[str] | None = None) -> None:
    """Drop the tables and recreate them with the configured vector dimension."""
    if categories:
        sys.exit("reset drops the whole index; use `clear --category` to empty one category")
    conn = connect()
    try:
        create_schema(conn, rebuild=True)
    finally:
        conn.close()
    print(f"✓ Reset schema: tables recreated with vector({EMBED_DIMENSION}).")


def _category_filter(categories: Sequence[str] | None, column: str = "category") -> tuple[str, list]:
    """A WHERE clause restricting to categories, as a bind parameter."""
    if not categories:
        return "", []
    return f" WHERE {column} = ANY(%s)", [[check_category(c) for c in categories]]


@dataclass
class Hit:
    chunk_id: int
    title: str
    source: str
    heading_path: str
    content: str
    category: str
    score: float  # fused score; higher is better
    vector_rank: int | None  # position in each ranking, None if not proposed
    keyword_rank: int | None
    similarity: float | None  # cosine similarity to the question, when vector search proposed it
    bm25: float | None  # keyword score, when keyword search proposed it

    @property
    def key(self) -> str:
        """The row id and the category it is filed under, "PKG:412".

        The id alone would do now that there is one table, but the prefix is
        what every stored run, export and trace already carries, and `chunk`
        checks it against the row -- so a key from somewhere else fails rather
        than quietly returning a different chunk."""
        return f"{self.category}:{self.chunk_id}"

    def ranks(self) -> str:
        v = f"#{self.vector_rank}" if self.vector_rank else "-"
        k = f"#{self.keyword_rank}" if self.keyword_rank else "-"
        return f"vector {v}, keyword {k}"


def vector_ranking(
    conn,
    query_vector: np.ndarray,
    limit: int = CANDIDATES,
    categories: Sequence[str] | None = None,
) -> list[tuple[int, float]]:
    """(chunk id, cosine similarity), most similar first."""
    where, params = _category_filter(categories)
    rows = conn.execute(
        f"SELECT id, 1 - (embedding <=> %s) FROM rag_chunks{where}"
        " ORDER BY embedding <=> %s LIMIT %s",
        (query_vector, *params, query_vector, limit),
    ).fetchall()
    return [(r[0], float(r[1])) for r in rows]


# BM25 over the full-text index. Postgres's own ts_rank ignores how rare a word
# is, so a question's "production" would count as much as its "7.1.12.3"; BM25
# weights each word by inverse document frequency.
#
# The corpus statistics -- how many chunks there are, how long they are on
# average, and how many contain each word -- are computed over the categories
# being searched, so a chunk scores the same wherever it is filed. This used to
# be assembled from one set of statistics per database and added up, because
# document frequency computed inside a category of one chunk makes every word
# look common, the scores come out near zero, and merging by score would bury
# the whole category under a larger one. One table means one query and no
# reassembly; the numbers it returns are the same ones.
#
# ts_stat takes its query as a string literal rather than a bind parameter,
# which is why check_category guards every code that reaches these functions.
def _scope_sql(categories: Sequence[str] | None) -> str:
    if not categories:
        return ""
    codes = ", ".join("'" + check_category(c) + "'" for c in categories)
    return f" WHERE category IN ({codes})"


_STATS = """
WITH terms AS (
    SELECT DISTINCT lexeme FROM unnest(to_tsvector('{cfg}', %(q)s))
)
SELECT
    (SELECT count(*) FROM rag_chunks{scope}),
    (SELECT coalesce(avg(length(tsv)), 0) FROM rag_chunks{scope}),
    (SELECT coalesce(json_object_agg(word, ndoc), '{{}}'::json)
       FROM ts_stat('{inner}') WHERE word IN (SELECT lexeme FROM terms))
"""


def corpus_stats(conn, question: str, categories: Sequence[str] | None = None) -> tuple[int, float, dict]:
    """(chunks, average length, {word: chunks containing it}) over the scope."""
    scope = _scope_sql(categories)
    sql = _STATS.format(
        cfg=TEXT_SEARCH_CONFIG, scope=scope,
        inner=("SELECT tsv FROM rag_chunks" + scope).replace("'", "''"),
    )
    n, avgdl, df = conn.execute(sql, {"q": keyword_text(question)}).fetchone()
    return int(n), float(avgdl), dict(df or {})


_BM25 = """
WITH query AS (
    SELECT string_agg(quote_literal(lexeme), ' | ')::tsquery AS tsq
    FROM (SELECT DISTINCT lexeme FROM unnest(to_tsvector('{cfg}', %(q)s))) t
), df AS (
    SELECT word, ndoc FROM unnest(%(words)s::text[], %(ndocs)s::bigint[]) AS u(word, ndoc)
)
SELECT c.id, sum(
    ln(1 + (%(n)s - df.ndoc + 0.5) / (df.ndoc + 0.5))
    * cardinality(t.positions) * (%(k1)s + 1)
    / (cardinality(t.positions) + %(k1)s * (1 - %(b)s + %(b)s * length(c.tsv) / %(avgdl)s))
) AS score
FROM rag_chunks c
CROSS JOIN query
CROSS JOIN LATERAL unnest(c.tsv) AS t
JOIN df ON df.word = t.lexeme
WHERE c.tsv @@ query.tsq{filter}
GROUP BY c.id
ORDER BY score DESC
LIMIT %(limit)s
"""


def keyword_ranking(
    conn,
    question: str,
    limit: int = CANDIDATES,
    categories: Sequence[str] | None = None,
    stats: tuple[int, float, dict] | None = None,
) -> list[tuple[int, float]]:
    """(chunk id, BM25 score), best first. `stats` are the corpus statistics to
    score against; without them this database's own are used, which is right
    when it is the only one being searched."""
    n, avgdl, df = stats if stats is not None else corpus_stats(conn, question, categories)
    if not n or not avgdl or not df:
        return []
    sql = _BM25.format(cfg=TEXT_SEARCH_CONFIG, filter=_scope_sql(categories).replace(" WHERE ", " AND c."))
    rows = conn.execute(
        sql,
        {
            "q": keyword_text(question), "k1": 1.2, "b": 0.75, "limit": limit,
            "n": n, "avgdl": avgdl,
            "words": list(df), "ndocs": [int(v) for v in df.values()],
        },
    ).fetchall()
    return [(r[0], float(r[1])) for r in rows]


def query_terms(conn, question: str) -> list[str]:
    """The words keyword search looks for: stemmed, stop words removed."""
    rows = conn.execute(
        f"SELECT DISTINCT lexeme FROM unnest(to_tsvector('{TEXT_SEARCH_CONFIG}', %s))",
        (keyword_text(question),),
    ).fetchall()
    return [r[0] for r in rows]


def fuse(vector: list[tuple[Any, float]], keyword: list[tuple[Any, float]], k: int) -> list[tuple[Any, float]]:
    """Reciprocal rank fusion of the two rankings: (chunk key, score), best first."""
    scores: dict[Any, float] = {}
    for ranking in (vector, keyword):
        for rank, (chunk_id, _) in enumerate(ranking, 1):
            scores[chunk_id] = scores.get(chunk_id, 0.0) + 1 / (RRF_K + rank)
    best = sorted(scores, key=scores.get, reverse=True)[:k]
    return [(i, scores[i]) for i in best]


def _rows(conn, ids: list[int]) -> dict[int, tuple]:
    rows = conn.execute(
        "SELECT c.id, d.title, d.source, c.heading_path, c.content, c.category"
        " FROM rag_chunks c JOIN rag_documents d ON d.id = c.document_id WHERE c.id = ANY(%s)",
        (ids,),
    ).fetchall()
    return {r[0]: r[1:] for r in rows}


def _load_hits(conn, fused, vector, keyword) -> list[Hit]:
    if not fused:
        return []
    by_id = _rows(conn, [cid for cid, _ in fused])
    vector_pos = {cid: (n, sim) for n, (cid, sim) in enumerate(vector, 1)}
    keyword_pos = {cid: (n, sc) for n, (cid, sc) in enumerate(keyword, 1)}
    hits = []
    for cid, score in fused:
        v = vector_pos.get(cid, (None, None))
        kw = keyword_pos.get(cid, (None, None))
        hits.append(Hit(cid, *by_id[cid], score, v[0], kw[0], v[1], kw[1]))
    return hits


def rank(
    question: str,
    query_vector: np.ndarray | None,
    mode: str,
    categories: Sequence[str] | None,
    conn=None,
) -> tuple[Any, list, list]:
    """Both rankings over the categories in scope, best first.

    They are run separately and fused rather than combined in SQL, because
    reciprocal rank fusion works on positions and a chunk has to be able to
    appear in one ranking and not the other."""
    conn = conn if conn is not None else connection()
    scope = [check_category(c) for c in categories] if categories else None
    vector: list[tuple[int, float]] = []
    keyword: list[tuple[int, float]] = []
    if mode in ("hybrid", "vector") and query_vector is not None:
        vector = vector_ranking(conn, query_vector, categories=scope)
    if mode in ("hybrid", "keyword"):
        keyword = keyword_ranking(conn, question, categories=scope)
    return conn, vector[:CANDIDATES], keyword[:CANDIDATES]


def search(
    question: str,
    k: int = DEFAULT_K,
    conn=None,
    mode: str = "hybrid",
    query_vector: np.ndarray | None = None,
    categories: Sequence[str] | None = None,
) -> list[Hit]:
    """The top k chunks for a question, over every category or the ones named."""
    if mode in ("hybrid", "vector") and query_vector is None:
        [query_vector] = embed([question], "search_query")
    conn, vector, keyword = rank(question, query_vector, mode, categories, conn)
    return _load_hits(conn, fuse(vector, keyword, k), vector, keyword)


def build_prompt(question: str, hits: list[Hit]) -> str:
    # The category is worth the handful of tokens here even though it is kept
    # out of the embedding: it lets the answer say which kind of document a
    # claim came from, and it costs nothing to change.
    excerpts = "\n\n".join(
        f'<excerpt id="{n}" document="{h.title}" category="{h.category}"'
        f' section="{h.heading_path}">\n{h.content}\n</excerpt>'
        for n, h in enumerate(hits, 1)
    )
    return f"<excerpts>\n{excerpts}\n</excerpts>\n\nQuestion: {question}"


def answer_stream(question: str, hits: list[Hit], run=None):
    """Yield ("thinking", None) when Claude starts reasoning, ("text", str) for
    each piece of the answer, and finally ("usage", {...}).

    `run` is the caller's trace, if it has one. The generation is recorded by
    the Anthropic instrumentor rather than by hand, so all this has to do is
    make the run current while the request is made -- see `tracing.Run.current`
    for why that cannot be done once around the whole loop."""
    import anthropic

    client = anthropic.Anthropic()
    with (run or tracing.Run(None, {})).current(), client.messages.stream(
        model=ANSWER_MODEL,
        max_tokens=16000,
        system=ANSWER_SYSTEM,
        messages=[{"role": "user", "content": build_prompt(question, hits)}],
    ) as stream:
        for event in stream:
            if event.type == "content_block_start" and event.content_block.type == "thinking":
                yield "thinking", None
            elif event.type == "content_block_delta" and event.delta.type == "text_delta":
                yield "text", event.delta.text
        usage = stream.get_final_message().usage
    yield "usage", {"input_tokens": usage.input_tokens, "output_tokens": usage.output_tokens}


def ask_events(
    question: str,
    k: int = DEFAULT_K,
    mode: str = "hybrid",
    categories: Sequence[str] | None = None,
):
    """The whole pipeline as a sequence of events for a UI: ("stage", {...})
    as each step starts and finishes, ("sources", [...]), ("token", str) while
    Claude writes, and ("done", {...}). Errors propagate to the caller."""
    import time

    started = time.perf_counter()
    scope = [check_category(c) for c in categories] if categories else []
    # One trace per question. The retrieval stages are observations of their
    # own because "the answer was wrong" is usually a retrieval problem, and a
    # trace that shows only the generation cannot tell you that.
    run = tracing.start_run(
        "answer-question",
        input={"question": question, "categories": scope or "all", "mode": mode, "k": k},
        metadata={"model": ANSWER_MODEL, "embed_model": EMBED_MODEL},
        tags=["rag-ask", f"mode-{mode}"],
    )

    def stage(key, status, detail="", t0=None):
        info = {"key": key, "status": status, "detail": detail}
        if t0 is not None:
            info["ms"] = round((time.perf_counter() - t0) * 1000)
        return "stage", info

    # What was searched is shown by the category filter on the page, and which
    # categories the excerpts came from is reported by the "fuse" stage; the
    # steps here are the pipeline, so there is no stage of its own for scope.
    where = ", ".join(scope) if scope else "every category"

    query_vector = None
    if mode in ("hybrid", "vector"):
        t0 = time.perf_counter()
        yield stage("embed", "running", f"Ollama {EMBED_MODEL}")
        with run.step("embed-question", as_type="embedding", model=EMBED_MODEL,
                      input=question) as span:
            [query_vector] = embed([question], "search_query")
            span.update(output={"dimensions": len(query_vector)})
        yield stage("embed", "done", f"{len(query_vector)}-dimension vector from Ollama {EMBED_MODEL}", t0)

    terms: list[str] = []
    if mode in ("hybrid", "keyword"):
        terms = query_terms(connection(), question)
        # Show codes as typed, not as their index forms ("m090030", "-090").
        codes = [m.group(0) for m in _CODE.finditer(question)]
        joined = set(keyword_text(" ".join(codes)).split()) - set(" ".join(codes).split())
        shown = codes + [
            t for t in terms
            if len(t) > 1 and not t.startswith("-") and t not in {w.lower() for w in joined}
        ]
        running = stage("keyword", "running", "Looking for: " + ", ".join(shown))
        running[1]["terms"] = terms  # the page highlights these in the sources
        yield running

    t0 = time.perf_counter()
    if mode in ("hybrid", "vector"):
        yield stage("vector", "running", "Nearest chunks by cosine similarity")
    with run.step("search-corpus", as_type="retriever",
                  input={"question": question, "mode": mode},
                  metadata={"categories": scope or known_categories()}) as span:
        conn, vector, keyword = rank(question, query_vector, mode, scope or None)
        span.update(output={"vector_candidates": len(vector),
                            "keyword_candidates": len(keyword),
                            "best_similarity": round(vector[0][1], 4) if vector else None})
    if mode in ("hybrid", "vector"):
        best = f", best similarity {vector[0][1]:.3f}" if vector else ""
        yield stage("vector", "done", f"{len(vector)} candidates{best}", t0)
    if mode in ("hybrid", "keyword"):
        yield stage(
            "keyword", "done",
            f"{len(keyword)} best matches" if keyword else "No chunk contains these words",
            t0,
        )

    t0 = time.perf_counter()
    yield stage("fuse", "running", "Reciprocal rank fusion")
    with run.step("fuse-and-load", as_type="retriever",
                  input={"k": k, "vector": len(vector), "keyword": len(keyword)}) as span:
        hits = _load_hits(conn, fuse(vector, keyword, k), vector, keyword)
        # The excerpts themselves, which is what the answer is actually built
        # from and the first thing to read when an answer looks wrong.
        span.update(output=[{"n": n, "title": h.title, "section": h.heading_path,
                             "category": h.category, "score": h.score,
                             "content": h.content}
                            for n, h in enumerate(hits, 1)])
    if not hits:
        raise RuntimeError(
            f"Nothing matched in {where}. Is the index empty? Run `python rag.py index <folder>`."
        )
    both = sum(1 for h in hits if h.vector_rank and h.keyword_rank)
    docs = len({h.title for h in hits})
    found = sorted({h.category for h in hits})
    detail = f"Top {len(hits)} chunks from {docs} document{'s' * (docs != 1)}"
    if mode == "hybrid":
        detail += f"; {both} found by both searches"
    detail += f"; {', '.join(found)}"
    yield stage("fuse", "done", detail, t0)

    yield "sources", [
        {
            "n": n, "title": h.title, "section": h.heading_path, "content": h.content,
            "category": h.category,
            "score": h.score, "similarity": h.similarity, "bm25": h.bm25,
            "vector_rank": h.vector_rank, "keyword_rank": h.keyword_rank,
            "file": Path(h.source).name,
            "source_path": h.source,
        }
        for n, h in enumerate(hits, 1)
    ]

    t0 = time.perf_counter()
    yield stage("answer", "running", f"Sending {len(hits)} excerpts to {ANSWER_MODEL}")
    writing = False
    # Kept only for the trace: the trace's output is taken from its root
    # observation and is what the tracing table shows, so a root that reports
    # token counts and not the answer makes every row unreadable at a glance.
    written: list[str] = []
    for kind, value in answer_stream(question, hits, run):
        if kind == "thinking":
            yield stage("answer", "running", f"{ANSWER_MODEL} is reasoning over the excerpts")
        elif kind == "text":
            if not writing:
                writing = True
                yield stage("answer", "running", f"{ANSWER_MODEL} is writing")
            written.append(value)
            yield "token", value
        else:
            yield stage(
                "answer", "done",
                f"{ANSWER_MODEL}: {value['input_tokens']:,} tokens in, {value['output_tokens']:,} out",
                t0,
            )
            run.end(output={"answer": "".join(written),
                            "sources": len(hits),
                            "documents": sorted({h.title for h in hits}),
                            **value})
            yield "done", {"seconds": round(time.perf_counter() - started, 1), **value}


def ask(
    question: str,
    k: int = DEFAULT_K,
    out=sys.stdout,
    mode: str = "hybrid",
    categories: Sequence[str] | None = None,
) -> str:
    """Stream Claude's answer to `out` and return it."""
    hits = search(question, k, mode=mode, categories=categories)
    if not hits:
        sys.exit("The index is empty; run `python rag.py index <folder>` first")
    parts = []
    for kind, value in answer_stream(question, hits):
        if kind == "text":
            parts.append(value)
            out.write(value)
            out.flush()
    out.write("\n\nSources:\n")
    for n, h in enumerate(hits, 1):
        out.write(f"  [{n}] [{h.category}] {h.title} -- {h.heading_path or '(top)'}  ({h.ranks()})\n")
    return "".join(parts)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)

    def category_arg(p, help_="restrict to these categories (PKG, DR, ...)"):
        p.add_argument("--category", "-c", action="append", metavar="CODE", help=help_)

    p = sub.add_parser("index", help="chunk, embed and store every .md file in a folder")
    p.add_argument("folder", type=Path, nargs="?", default=Path("solvay-spark/pkg/markdown"))
    p.add_argument("--force", action="store_true", help="re-embed files even if unchanged")
    p.add_argument("--rebuild", action="store_true", help="drop the tables and start over")
    p.add_argument(
        "--category", "-c", metavar="CODE",
        help="the category for every file in the folder, overriding the folder convention",
    )

    for name, help_ in (("search", "show the chunks closest to a question"), ("ask", "answer a question")):
        p = sub.add_parser(name, help=help_)
        p.add_argument("question")
        p.add_argument("-k", type=int, default=DEFAULT_K, help=f"chunks to retrieve (default {DEFAULT_K})")
        p.add_argument(
            "--mode", choices=MODES, default="hybrid",
            help="hybrid (default): vector + keyword; or either one alone",
        )
        category_arg(p)

    p = sub.add_parser("chunks", help="print how a file is chunked (no API calls)")
    p.add_argument("file", type=Path)

    sub.add_parser("categories", help="what each category holds")

    p = sub.add_parser("retag", help="change a document's category without re-embedding it")
    p.add_argument("file", type=Path)
    p.add_argument("category")

    category_arg(sub.add_parser("clear", help="delete indexed documents and chunks"))
    category_arg(sub.add_parser("reset", help="drop tables and recreate the schema"))

    args = parser.parse_args()
    if args.command == "index":
        index(args.folder, rebuild=args.rebuild, force=args.force, category=args.category)
    elif args.command == "clear":
        clear_index(args.category)
    elif args.command == "reset":
        reset_schema(args.category)
    elif args.command == "categories":
        held = {code: (docs, chunks) for code, docs, chunks in totals()}
        codes = sorted(set(known_categories()) | set(held))
        width = max((len(c) for c in codes), default=8)
        print(f"  {'CODE':<{width}}  {'DOCS':>5} {'CHUNKS':>7}  FOLDER")
        for code in codes:
            docs, chunks = held.get(code, (0, 0))
            print(f"  {code:<{width}}  {docs:>5} {chunks:>7}  {describe(code)['folder']}")
        docs, chunks = counts()
        print(f"\n  {database_name(base_url())}: {docs} documents, {chunks} chunks")
    elif args.command == "retag":
        code = check_category(args.category)
        path = args.file.resolve()
        # The vectors do not move and nothing is re-embedded: the category is
        # deliberately not part of the fingerprint, and the chunks follow the
        # document through the foreign key.
        conn = connection()
        row = conn.execute(
            "SELECT category FROM rag_documents WHERE source = %s", (str(path),)
        ).fetchone()
        if row is None:
            sys.exit(f"{path.name} is not indexed; run `python rag.py index {path.parent}` first")
        recategorise(conn, path, code)
        # Record it on disk too, or the next `index` over this folder resets
        # the document to whatever the folder implies and the choice is lost.
        recorded = record_category(path, code)
        print(f"{path.name}: {row[0]} -> {code}"
              + (" (recorded in the file)" if recorded else ""))
    elif args.command == "search":
        for n, h in enumerate(search(args.question, args.k, mode=args.mode, categories=args.category), 1):
            print(f"\n[{n}] [{h.category}] {h.title} -- {h.heading_path or '(top)'}  ({h.ranks()})")
            print("    " + h.content[:300].replace("\n", "\n    "))
    elif args.command == "ask":
        ask(args.question, args.k, mode=args.mode, categories=args.category)
    elif args.command == "chunks":
        for c in chunk_file(args.file):
            print(f"\n===== chunk {c.index}: ~{c.tokens} tokens =====")
            print(c.embedding_text())


if __name__ == "__main__":
    main()

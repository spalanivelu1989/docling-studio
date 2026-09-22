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
design reviews -- and a category can have a database of its own. Searching
covers every database the requested categories span; see the "categories"
section below for how a file gets its category and where that category lives.

Settings come from the environment or the project's .env:

    DATABASE_URL        e.g. postgresql://user:password@localhost:5432/docling
    RAG_DATABASE_URL_*  a category with a database of its own, by code:
                        RAG_DATABASE_URL_PKG=postgresql://.../docling_pkg
    ANTHROPIC_API_KEY   for `ask`
    OLLAMA_HOST         default http://127.0.0.1:11434
    RAG_EMBED_MODEL     default bge-m3
    RAG_EMBED_DIMENSION default 1024
    RAG_ANSWER_MODEL    default claude-opus-5
    RAG_HNSW_EF_SEARCH  default 200 (see _tune)

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
EF_SEARCH = int(os.environ.get("RAG_HNSW_EF_SEARCH", "200"))

BASE = Path(__file__).resolve().parent


# --- categories ---------------------------------------------------------------
#
# A category is metadata, not embedded text. A three-letter code means nothing
# to bge-m3, and adding "Category: PKG" to every chunk of a category would move
# that whole cluster by the same constant vector without making any chunk in it
# easier to tell apart. Keeping the category out of the vector also means
# re-tagging a document is an UPDATE rather than 50 embedding calls.
#
# Every category is isolated in a database of its own, named after the one in
# DATABASE_URL: with DATABASE_URL=.../docling, PKG lives in docling_pkg and DR
# in docling_dr. DATABASE_URL itself holds no documents -- it is the base name
# the rest are derived from, and where the tables that are not per-category
# (fitgap's runs and reviews) live.
#
# Adding a category therefore takes no code change. Drop the Markdown in
# solvay-spark/<code>/markdown and index it: the folder names the category, and
# its database is created on the first write. CATEGORIES below only carries the
# labels and descriptions worth showing in the UI, and
# RAG_DATABASE_URL_<CODE> overrides where one category lives -- another server,
# or a name that does not follow the convention.

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

# Databases that follow the <base>_<code> naming convention but hold no
# documents. They are not categories: they must never appear in a category
# listing, a filter or a search, even though database_url() still names them.
RESERVED_CODES = {"FITGAP"}

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


def base_url() -> str:
    """DATABASE_URL: the database the per-category names are derived from, and
    where the tables that are not per-category live. It holds no documents."""
    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL is not set (add it to .env)")
    return url


def database_url(category: str | None = None) -> str:
    """The database a category is isolated in -- docling_pkg for PKG, unless
    RAG_DATABASE_URL_PKG says otherwise. Without a category, the base."""
    from urllib.parse import urlsplit, urlunsplit

    if not category:
        return base_url()
    code = check_category(category)
    override = os.environ.get(f"RAG_DATABASE_URL_{code}")
    if override:
        return override
    parts = urlsplit(base_url())
    name = parts.path.lstrip("/") or "docling"
    return urlunsplit((parts.scheme, parts.netloc, f"/{name}_{code.lower()}", parts.query, parts.fragment))


def database_name(url: str) -> str:
    from urllib.parse import urlsplit

    return urlsplit(url).path.lstrip("/")


def database_exists(url: str) -> bool:
    """Whether a category's database has been created yet. A category that has
    never been indexed has none, and searching has to step over it rather than
    fail."""
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
_discovered: tuple[float, dict[str, str]] | None = None

# (checked at, exists). Time-limited in both directions: a database created or
# dropped by another process -- or by hand -- must not stay wrong until this
# one restarts.
_exists_cache: dict[str, tuple[float, bool]] = {}


def _live(url: str) -> bool:
    import time as _time

    hit = _exists_cache.get(url)
    if hit and _time.monotonic() - hit[0] < _DISCOVERY_TTL:
        return hit[1]
    alive = database_exists(url)
    _exists_cache[url] = (_time.monotonic(), alive)
    return alive


def known_categories() -> list[str]:
    """Every category this installation knows about: the ones described above,
    the ones with an environment variable of their own, and the ones whose
    database already exists."""
    found = set(CATEGORIES)
    found |= {
        key[len("RAG_DATABASE_URL_"):]
        for key in os.environ
        if key.startswith("RAG_DATABASE_URL_") and _CATEGORY_CODE.fullmatch(key[len("RAG_DATABASE_URL_"):])
    }
    found |= set(_databases_by_convention())
    return sorted(found - RESERVED_CODES)


def _databases_by_convention() -> dict[str, str]:
    """Cached: this opens a connection to the maintenance database, and it is
    on the path of every search."""
    global _discovered
    import time as _time

    if _discovered and _time.monotonic() - _discovered[0] < _DISCOVERY_TTL:
        return _discovered[1]
    found = _scan_databases()
    _discovered = (_time.monotonic(), found)
    return found


def _scan_databases() -> dict[str, str]:
    """{category: database} for every `<base>_<code>` database on the server."""
    import psycopg
    from urllib.parse import urlsplit, urlunsplit

    parts = urlsplit(base_url())
    prefix = (parts.path.lstrip("/") or "docling") + "_"
    maintenance = urlunsplit((parts.scheme, parts.netloc, "/postgres", parts.query, parts.fragment))
    out: dict[str, str] = {}
    try:
        with psycopg.connect(maintenance, autocommit=True, connect_timeout=5) as conn:
            for (name,) in conn.execute(
                "SELECT datname FROM pg_database WHERE datname LIKE %s AND NOT datistemplate",
                (prefix.replace("_", "\\_") + "%",),
            ).fetchall():
                code = name[len(prefix):].upper()
                if _CATEGORY_CODE.fullmatch(code) and code not in RESERVED_CODES:
                    out[code] = urlunsplit(
                        (parts.scheme, parts.netloc, f"/{name}", parts.query, parts.fragment)
                    )
    except Exception:
        pass
    return out


def shards(categories: Sequence[str] | None = None) -> list[tuple[str, list[str]]]:
    """[(database url, the categories to look for in it), ...], skipping the
    databases that do not exist yet.

    One category per database is the rule, so the category list is normally a
    single code; it stays a list because RAG_DATABASE_URL_* can point two
    categories at the same database, and the filter has to be right when it
    does."""
    wanted = [check_category(c) for c in categories] if categories else known_categories()
    grouped: dict[str, list[str]] = {}
    for code in wanted:
        url = database_url(code)
        if not _live(url):
            continue
        if code not in grouped.setdefault(url, []):
            grouped[url].append(code)
    # An index built before categories existed still has its rows in the base
    # database. They stay searchable until `rag.py migrate` moves them out.
    if _base_holds_documents():
        base = base_url()
        for code in wanted:
            if code not in grouped.setdefault(base, []):
                grouped[base].append(code)
    return sorted(grouped.items())


_base_documents: bool | None = None


def _base_holds_documents() -> bool:
    global _base_documents
    if _base_documents is None:
        try:
            conn = shard_connection(base_url(), schema=False)
            table = conn.execute("SELECT to_regclass('rag_documents')").fetchone()[0]
            _base_documents = bool(
                table and conn.execute("SELECT 1 FROM rag_documents LIMIT 1").fetchone()
            )
        except Exception:
            _base_documents = False
    return _base_documents


def ensure_database(category: str) -> str:
    """The url of a category's database, created if it is not there yet.

    Writing is where a category earns its database, so this runs on indexing
    and never on searching -- a question about a category nobody has indexed
    finds nothing rather than quietly creating an empty database for it."""
    code = check_category(category)
    url = database_url(code)
    if _live(url):
        return url
    import psycopg
    from urllib.parse import urlsplit, urlunsplit

    parts = urlsplit(url)
    maintenance = urlunsplit((parts.scheme, parts.netloc, "/postgres", parts.query, parts.fragment))
    name = database_name(url)
    with psycopg.connect(maintenance, autocommit=True) as conn:
        if not conn.execute("SELECT 1 FROM pg_database WHERE datname = %s", (name,)).fetchone():
            conn.execute(f'CREATE DATABASE "{name}"')
    import time as _time

    _exists_cache[url] = (_time.monotonic(), True)
    global _discovered
    _discovered = None  # the new database has to be visible to the next search
    return url


def describe(code: str) -> dict:
    meta = CATEGORIES.get(code, {})
    url = database_url(code)
    return {
        "code": code,
        "label": meta.get("label", code),
        "description": meta.get("description", ""),
        "folder": meta.get("folder", f"solvay-spark/{code.lower()}/{MARKDOWN_FOLDER}"),
        "database": database_name(url),
        "exists": _live(url),
        "configured": bool(os.environ.get(f"RAG_DATABASE_URL_{code}")),
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


def connect(category: str | None = None, url: str | None = None):
    """A connection to the database holding `category` (the default database
    when no category is named)."""
    import psycopg
    from pgvector.psycopg import register_vector

    url = url or database_url(category)
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
    is raised as well, which is the only lever older versions have."""
    conn.execute(f"SET hnsw.ef_search = {EF_SEARCH}")
    try:
        conn.execute("SET hnsw.iterative_scan = relaxed_order")
    except Exception:  # pgvector < 0.8: ef_search alone has to carry it
        pass


_local = threading.local()
_schema_ready: set[str] = set()
_schema_lock = threading.Lock()


def shard_connection(url: str, schema: bool = True):
    """One connection per database per thread, reused across searches, with the
    schema checked once per database per process. psycopg connections are not
    thread safe, so these are never shared between threads."""
    cache = getattr(_local, "shards", None)
    if cache is None:
        cache = _local.shards = {}
    conn = cache.get(url)
    if conn is None or conn.closed:
        conn = cache[url] = connect(url=url)
    if schema:
        with _schema_lock:
            first = url not in _schema_ready
            _schema_ready.add(url)
        if first:
            create_schema(conn)
    return conn


def close_shards() -> None:
    """Close this thread's cached connections."""
    for conn in getattr(_local, "shards", {}).values():
        try:
            conn.close()
        except Exception:
            pass
    _local.shards = {}


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
            source      text NOT NULL UNIQUE,   -- path of the .md file
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
    settings = (
        f"{EMBED_MODEL}:{EMBED_DIMENSION}:{md_chunker.TARGET_TOKENS}:"
        f"{md_chunker.MAX_TOKENS}:{md_chunker.MIN_TOKENS}\n"
    )
    return hashlib.sha256((settings + text).encode()).hexdigest()


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
    """Move a document to another category without touching its vectors."""
    category = check_category(category)
    with conn.transaction():
        doc = conn.execute(
            "UPDATE rag_documents SET category = %s WHERE source = %s RETURNING id",
            (category, str(path)),
        ).fetchone()
        if doc:
            conn.execute("UPDATE rag_chunks SET category = %s WHERE document_id = %s", (category, doc[0]))
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
    """index_file, into whichever database the file's category belongs to."""
    code = category_for(path, category)
    return index_file(shard_connection(ensure_database(code)), path, force, on_embed, code)


def index(folder: Path, rebuild: bool = False, force: bool = False, category: str | None = None) -> None:
    folder = folder.resolve()
    files = sorted(folder.glob("*.md"))
    if not files:
        sys.exit(f"No .md files in {folder}")
    # Normally every file in a folder shares its category, but front matter can
    # send one elsewhere, so each file is placed on its own.
    placed = {path: category_for(path, category) for path in files}
    conns: dict[str, Any] = {}

    def conn_for(url: str):
        if url not in conns:
            conns[url] = connect(url=url)
            create_schema(conns[url], rebuild)
        return conns[url]

    try:
        for i, path in enumerate(files, 1):
            code = placed[path]
            result = index_file(
                conn_for(ensure_database(code)), path, force,
                on_embed=lambda n, i=i, path=path, code=code: print(
                    f"[{i}/{len(files)}] {path.name} -> {code}: {n} chunks, embedding...", flush=True
                ),
                category=code,
            )
            if result["status"] == "unchanged":
                was = result.get("recategorised")
                print(f"[{i}/{len(files)}] {path.name}: unchanged" + (f", re-tagged {was} -> {code}" if was else ""))

        # Files deleted from the folder leave the index -- and so does a row in
        # a database the file no longer belongs to, which is what happens when
        # a document changes category and its new category lives elsewhere.
        keep = {str(path): placed[path] for path in files}
        removed = 0
        for url, _ in shards():
            conn = conn_for(url)
            rows = conn.execute("SELECT source FROM rag_documents").fetchall()
            gone = [
                src for (src,) in rows
                if Path(src).parent == folder and (src not in keep or database_url(keep[src]) != url)
            ]
            with conn.transaction():
                for src in gone:
                    conn.execute("DELETE FROM rag_documents WHERE source = %s", (src,))
            removed += len(gone)
        if removed:
            print(f"Removed {removed} stale document{'s' if removed != 1 else ''} from the index")

        for code, docs, chunks in totals():
            print(f"  {code:<10} {docs:>4} documents  {chunks:>6} chunks")
    finally:
        for conn in conns.values():
            conn.close()


def totals(categories: Sequence[str] | None = None) -> list[tuple[str, int, int]]:
    """[(category, documents, chunks), ...] across every database."""
    out: list[tuple[str, int, int]] = []
    for url, cats in shards(categories):
        conn = shard_connection(url)
        where, params = _category_filter(cats, "d.category")
        out += [
            (row[0], row[1], row[2])
            for row in conn.execute(
                "SELECT d.category, count(DISTINCT d.id), count(c.id)"
                " FROM rag_documents d LEFT JOIN rag_chunks c ON c.document_id = d.id"
                f"{where} GROUP BY d.category",
                params,
            ).fetchall()
        ]
    return sorted(out)


def counts(categories: Sequence[str] | None = None) -> tuple[int, int]:
    """(documents, chunks) across every database."""
    rows = totals(categories)
    return sum(d for _, d, _ in rows), sum(c for _, _, c in rows)


def documents() -> list[dict]:
    """Every indexed document, from every database."""
    out: list[dict] = []
    for url, cats in shards():
        conn = shard_connection(url)
        where, params = _category_filter(cats, "d.category")
        out += [
            {
                "id": r[0], "source": r[1], "title": r[2], "category": r[3],
                "chunks": int(r[4]), "tokens": int(r[5]), "indexed_at": r[6],
            }
            for r in conn.execute(
                "SELECT d.id, d.source, d.title, d.category, count(c.id), coalesce(sum(c.tokens), 0),"
                " d.indexed_at FROM rag_documents d LEFT JOIN rag_chunks c ON c.document_id = d.id"
                f"{where} GROUP BY d.id, d.source, d.title, d.category, d.indexed_at",
                params,
            ).fetchall()
        ]
    out.sort(key=lambda d: (d["indexed_at"] is None, d["indexed_at"]), reverse=True)
    return out


def find_document(filename: str) -> str | None:
    """The source path of an indexed document, by file name, in any database."""
    for url, _ in shards():
        row = shard_connection(url).execute(
            "SELECT source FROM rag_documents WHERE source LIKE %s OR source = %s LIMIT 1",
            (f"%/{filename}", filename),
        ).fetchone()
        if row:
            return row[0]
    return None


def delete_document(filename: str) -> int:
    """Remove a document from whichever database holds it."""
    removed = 0
    for url, _ in shards():
        conn = shard_connection(url)
        with conn.transaction():
            removed += len(
                conn.execute(
                    "DELETE FROM rag_documents WHERE source LIKE %s OR source = %s RETURNING id",
                    (f"%/{filename}", filename),
                ).fetchall()
            )
    return removed


def chunk(key: str) -> dict | None:
    """One chunk by its Hit.key ("PKG:412"). A bare row id is read from the
    default database, which is what a key meant before categories existed."""
    code, _, digits = str(key).rpartition(":")
    if not digits.isdigit():
        return None
    try:
        url = database_url(check_category(code)) if code else database_url(None)
    except ValueError:
        return None
    row = shard_connection(url).execute(
        "SELECT c.id, d.title, d.source, c.heading_path, c.content, c.tokens, c.category"
        " FROM rag_chunks c JOIN rag_documents d ON d.id = c.document_id WHERE c.id = %s",
        (int(digits),),
    ).fetchone()
    if not row:
        return None
    return {
        "chunk_id": f"{row[6]}:{row[0]}", "title": row[1], "source": row[2],
        "heading_path": row[3], "content": row[4], "tokens": row[5], "category": row[6],
    }


def duplicate_sources(title: str, source: str) -> list[str]:
    """The same document indexed from somewhere else -- in any database, since
    a document filed under two categories now lives in two of them."""
    out: list[str] = []
    for url, _ in shards():
        out += [
            r[0]
            for r in shard_connection(url).execute(
                "SELECT source FROM rag_documents WHERE title = %s AND source <> %s",
                (title, source),
            ).fetchall()
        ]
    return out


def clear_index(categories: Sequence[str] | None = None) -> None:
    """Delete indexed documents and chunks, in one category or in all of them."""
    for url, cats in shards(categories):
        conn = connect(url=url)
        try:
            with conn.transaction():
                if cats:
                    conn.execute("DELETE FROM rag_documents WHERE category = ANY(%s)", (cats,))
                else:
                    conn.execute("TRUNCATE TABLE rag_documents CASCADE")
        finally:
            conn.close()
    scope = ", ".join(categories) if categories else "every category"
    print(f"✓ Cleared {scope}: documents and chunks removed.")


def reset_schema(categories: Sequence[str] | None = None) -> None:
    """Drop existing tables and recreate them cleanly with the configured vector dimensions."""
    for url, _ in shards(categories):
        conn = connect(url=url)
        try:
            create_schema(conn, rebuild=True)
        finally:
            conn.close()
    print(f"✓ Reset schema: tables recreated with vector({EMBED_DIMENSION}).")


def create_database(category: str) -> str:
    """Create a category's database and put the schema in it."""
    code = check_category(category)
    url = ensure_database(code)
    conn = connect(url=url)
    try:
        create_schema(conn)
    finally:
        conn.close()
    name = database_name(url)
    print(f"{code}: {name} ready")
    return name


def move_category(category: str, quiet: bool = False) -> dict:
    """Move a category's rows into the database it belongs to, carrying the
    embeddings across rather than paying Ollama to compute them again."""
    code = check_category(category)
    target_url = ensure_database(code)
    target = shard_connection(target_url)
    moved = {"documents": 0, "chunks": 0}
    elsewhere = [url for url, _ in shards() if url != target_url]
    if _base_holds_documents() and base_url() not in elsewhere and base_url() != target_url:
        elsewhere.append(base_url())
    for url in elsewhere:
        source = shard_connection(url, schema=False)
        if not source.execute("SELECT to_regclass('rag_documents')").fetchone()[0]:
            continue
        docs = source.execute(
            "SELECT id, source, title, fingerprint, indexed_at FROM rag_documents WHERE category = %s",
            (code,),
        ).fetchall()
        for doc_id, src, title, fp, indexed_at in docs:
            chunks = source.execute(
                "SELECT chunk_index, heading_path, content, tokens, embedding, tsv"
                " FROM rag_chunks WHERE document_id = %s ORDER BY chunk_index",
                (doc_id,),
            ).fetchall()
            with target.transaction():
                target.execute("DELETE FROM rag_documents WHERE source = %s", (src,))
                new_id = target.execute(
                    "INSERT INTO rag_documents (source, title, fingerprint, category, indexed_at)"
                    " VALUES (%s, %s, %s, %s, %s) RETURNING id",
                    (src, title, fp, code, indexed_at),
                ).fetchone()[0]
                with target.cursor() as cur:
                    cur.executemany(
                        "INSERT INTO rag_chunks (document_id, chunk_index, heading_path,"
                        " content, tokens, embedding, category, tsv)"
                        " VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
                        [(new_id, ci, hp, ct, tk, emb, code, tsv) for ci, hp, ct, tk, emb, tsv in chunks],
                    )
            with source.transaction():
                source.execute("DELETE FROM rag_documents WHERE id = %s", (doc_id,))
            moved["documents"] += 1
            moved["chunks"] += len(chunks)
    global _base_documents
    _base_documents = None
    if not quiet:
        print(f"{code}: moved {moved['documents']} documents, {moved['chunks']} chunks"
              f" into {database_name(target_url)}")
    return moved


def migrate() -> dict:
    """Give every category the database it belongs to.

    This is the upgrade path for an index built before categories existed: the
    rows are tagged by the folder they came from (create_schema does that), and
    then each category's rows are carried out of the base database into its
    own. Nothing is re-embedded."""
    conn = shard_connection(base_url(), schema=False)
    table = conn.execute("SELECT to_regclass('rag_documents')").fetchone()[0]
    if not table:
        print("Nothing to migrate: the base database has no index in it")
        return {}
    create_schema(conn)  # tags whatever is still UNFILED by its folder
    codes = [r[0] for r in conn.execute("SELECT DISTINCT category FROM rag_documents").fetchall()]
    moved = {}
    for code in sorted(codes):
        moved[code] = move_category(code)
    left = conn.execute("SELECT count(*) FROM rag_documents").fetchone()[0]
    print(f"Base database {database_name(base_url())} now holds {left} documents")
    return moved


# --- retrieval and answering --------------------------------------------------


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
        """Identifies the chunk across databases: row ids restart in each one,
        but a category lives in exactly one database."""
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
# average, and how many contain each word -- are collected across every
# database being searched and then handed to each one, rather than each
# database scoring against itself. That matters as soon as categories are
# isolated: document frequency computed inside a category of one chunk makes
# every word look common, the scores come out near zero, and merging by score
# would bury the whole category under a larger one. With one set of statistics
# for the whole search, a chunk scores the same wherever it is stored.
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
    """(chunks, average length, {word: chunks containing it}) for one database."""
    scope = _scope_sql(categories)
    sql = _STATS.format(
        cfg=TEXT_SEARCH_CONFIG, scope=scope,
        inner=("SELECT tsv FROM rag_chunks" + scope).replace("'", "''"),
    )
    n, avgdl, df = conn.execute(sql, {"q": keyword_text(question)}).fetchone()
    return int(n), float(avgdl), dict(df or {})


def merge_stats(parts: Sequence[tuple[int, float, dict]]) -> tuple[int, float, dict]:
    """One corpus out of several: counts and document frequencies add up, and
    the average length is weighted by how many chunks each contributed."""
    total = sum(n for n, _, _ in parts)
    avgdl = (sum(n * a for n, a, _ in parts) / total) if total else 0.0
    df: dict[str, int] = {}
    for _, _, part in parts:
        for word, ndoc in part.items():
            df[word] = df.get(word, 0) + int(ndoc)
    return total, avgdl, df


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


def _load_hits(conns: dict, fused, vector, keyword) -> list[Hit]:
    """Hits across databases. A chunk key is (database key, row id)."""
    if not fused:
        return []
    wanted: dict[Any, list[int]] = {}
    for (db, chunk_id), _ in fused:
        wanted.setdefault(db, []).append(chunk_id)
    by_key = {
        (db, chunk_id): row
        for db, ids in wanted.items()
        for chunk_id, row in _rows(conns[db], ids).items()
    }
    vector_pos = {key: (n, sim) for n, (key, sim) in enumerate(vector, 1)}
    keyword_pos = {key: (n, sc) for n, (key, sc) in enumerate(keyword, 1)}
    hits = []
    for key, score in fused:
        v = vector_pos.get(key, (None, None))
        kw = keyword_pos.get(key, (None, None))
        hits.append(Hit(key[1], *by_key[key], score, v[0], kw[0], v[1], kw[1]))
    return hits


def _rank_shards(
    question: str,
    query_vector: np.ndarray | None,
    mode: str,
    categories: Sequence[str] | None,
    conn=None,
) -> tuple[dict, list, list]:
    """Run both rankings in every database the categories span and merge them.

    Both rankings merge by score, and both scores are comparable across
    databases: cosine similarity is absolute, and the BM25 scores are computed
    against one set of corpus statistics gathered from every database in the
    search (see corpus_stats). Isolating a category therefore does not change
    where its chunks rank."""
    if conn is not None:
        targets = [(None, conn, [check_category(c) for c in categories] if categories else [])]
    else:
        targets = [(url, shard_connection(url), cats) for url, cats in shards(categories)]
    conns = {db: c for db, c, _ in targets}
    vector: list[tuple[Any, float]] = []
    keyword: list[tuple[Any, float]] = []
    stats = None
    if mode in ("hybrid", "keyword") and len(targets) > 1:
        stats = merge_stats([corpus_stats(c, question, cats) for _, c, cats in targets])
    for db, c, cats in targets:
        if mode in ("hybrid", "vector") and query_vector is not None:
            vector += [((db, cid), sim) for cid, sim in vector_ranking(c, query_vector, categories=cats)]
        if mode in ("hybrid", "keyword"):
            keyword += [((db, cid), sc) for cid, sc in keyword_ranking(c, question, categories=cats, stats=stats)]
    vector.sort(key=lambda pair: pair[1], reverse=True)
    keyword.sort(key=lambda pair: pair[1], reverse=True)
    return conns, vector[:CANDIDATES], keyword[:CANDIDATES]


def search(
    question: str,
    k: int = DEFAULT_K,
    conn=None,
    mode: str = "hybrid",
    query_vector: np.ndarray | None = None,
    categories: Sequence[str] | None = None,
) -> list[Hit]:
    """The top k chunks for a question. With no `categories` this covers every
    database; with `conn` it stays inside that one connection's database."""
    if mode in ("hybrid", "vector") and query_vector is None:
        [query_vector] = embed([question], "search_query")
    conns, vector, keyword = _rank_shards(question, query_vector, mode, categories, conn)
    return _load_hits(conns, fuse(vector, keyword, k), vector, keyword)


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


def answer_stream(question: str, hits: list[Hit]):
    """Yield ("thinking", None) when Claude starts reasoning, ("text", str) for
    each piece of the answer, and finally ("usage", {...})."""
    import anthropic

    client = anthropic.Anthropic()
    with client.messages.stream(
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

    def stage(key, status, detail="", t0=None):
        info = {"key": key, "status": status, "detail": detail}
        if t0 is not None:
            info["ms"] = round((time.perf_counter() - t0) * 1000)
        return "stage", info

    # What was searched is shown by the category filter on the page, and which
    # categories the excerpts came from is reported by the "fuse" stage; the
    # steps here are the pipeline, so there is no stage of its own for scope.
    where = ", ".join(scope) if scope else "every category"
    targets = shards(scope or None)

    query_vector = None
    if mode in ("hybrid", "vector"):
        t0 = time.perf_counter()
        yield stage("embed", "running", f"Ollama {EMBED_MODEL}")
        [query_vector] = embed([question], "search_query")
        yield stage("embed", "done", f"{len(query_vector)}-dimension vector from Ollama {EMBED_MODEL}", t0)

    terms: list[str] = []
    if mode in ("hybrid", "keyword"):
        probe = shard_connection(targets[0][0])
        terms = query_terms(probe, question)
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
    conns, vector, keyword = _rank_shards(question, query_vector, mode, scope or None)
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
    hits = _load_hits(conns, fuse(vector, keyword, k), vector, keyword)
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
        }
        for n, h in enumerate(hits, 1)
    ]

    t0 = time.perf_counter()
    yield stage("answer", "running", f"Sending {len(hits)} excerpts to {ANSWER_MODEL}")
    writing = False
    for kind, value in answer_stream(question, hits):
        if kind == "thinking":
            yield stage("answer", "running", f"{ANSWER_MODEL} is reasoning over the excerpts")
        elif kind == "text":
            if not writing:
                writing = True
                yield stage("answer", "running", f"{ANSWER_MODEL} is writing")
            yield "token", value
        else:
            yield stage(
                "answer", "done",
                f"{ANSWER_MODEL}: {value['input_tokens']:,} tokens in, {value['output_tokens']:,} out",
                t0,
            )
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

    sub.add_parser("categories", help="what each category holds, and where")

    p = sub.add_parser("createdb", help="create a category's database")
    p.add_argument("category")

    p = sub.add_parser(
        "move", help="move a category's rows into its own database, carrying the embeddings across"
    )
    p.add_argument("category")

    sub.add_parser(
        "migrate", help="give every category its own database (nothing is re-embedded)"
    )

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
        print(f"  {'CODE':<{width}}  {'DOCS':>5} {'CHUNKS':>7}  DATABASE")
        for code in codes:
            docs, chunks = held.get(code, (0, 0))
            meta = describe(code)
            state = "" if meta["exists"] else "  (not created yet)"
            print(f"  {code:<{width}}  {docs:>5} {chunks:>7}  {meta['database']}{state}")
        base = database_name(base_url())
        if _base_holds_documents():
            print(f"\n  {base} still holds documents; run `python rag.py migrate` to move them out")
        else:
            print(f"\n  base: {base} (no documents by design)")
    elif args.command == "createdb":
        create_database(args.category)
    elif args.command == "move":
        move_category(args.category)
    elif args.command == "migrate":
        migrate()
    elif args.command == "retag":
        code = check_category(args.category)
        path = args.file.resolve()
        # Re-tag where the document is, then move that category's rows into the
        # right database -- the vectors travel with it, nothing is re-embedded.
        found = None
        for url, _ in shards():
            conn = shard_connection(url)
            row = conn.execute(
                "SELECT category FROM rag_documents WHERE source = %s", (str(path),)
            ).fetchone()
            if row:
                found = row[0]
                recategorise(conn, path, code)
                break
        if found is None:
            sys.exit(f"{path.name} is not indexed; run `python rag.py index {path.parent}` first")
        move_category(code, quiet=True)
        print(f"{path.name}: {found} -> {code} ({database_name(database_url(code))})")
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

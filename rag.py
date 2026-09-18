"""Ask questions about the converted Markdown files (retrieval-augmented generation).

    python rag.py index solvay-spark/markdown     chunk, embed and store the files
    python rag.py search "Who validated 7.1.12.3?"  show the closest chunks
    python rag.py ask "Who validated 7.1.12.3?"     answer from those chunks

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

Settings come from the environment or the project's .env:

    COHERE_API_KEY      Cohere key (CO_API_KEY also works)
    DATABASE_URL        e.g. postgresql://user:password@localhost:5432/docling
    ANTHROPIC_API_KEY   for `ask`
    RAG_EMBED_MODEL     default embed-v4.0
    RAG_EMBED_DIMENSION default 1536 (embed-v4.0 also offers 256, 512, 1024)
    RAG_ANSWER_MODEL    default claude-opus-5

The chunk text goes to Cohere when indexing, and the question plus the
retrieved chunks go to Anthropic when asking.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path

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

ANSWER_SYSTEM = """\
You answer questions about project documents from an SAP implementation \
(workshop slides, process flows, specifications, spreadsheets). You are given \
numbered excerpts retrieved from those documents.

Answer only from the excerpts. Cite the excerpts you used with their numbers in \
square brackets, like [2] or [1][4]. If the excerpts do not contain the answer, \
say that plainly and say what they do cover; do not fill gaps from general SAP \
knowledge.

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


def connect():
    import psycopg
    from pgvector.psycopg import register_vector

    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL is not set (add it to .env)")
    # Autocommit, so each `with conn.transaction()` below is a real transaction
    # rather than a savepoint inside one that is never committed.
    conn = psycopg.connect(url, autocommit=True)
    conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
    register_vector(conn)
    return conn


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


def store(conn, path: Path, chunks: list[Chunk], vectors: list[np.ndarray], fingerprint_: str) -> None:
    with conn.transaction():
        conn.execute("DELETE FROM rag_documents WHERE source = %s", (str(path),))
        doc_id = conn.execute(
            "INSERT INTO rag_documents (source, title, fingerprint) VALUES (%s, %s, %s) RETURNING id",
            (str(path), chunks[0].title if chunks else md_chunker.document_title(path), fingerprint_),
        ).fetchone()[0]
        with conn.cursor() as cur:
            cur.executemany(
                "INSERT INTO rag_chunks (document_id, chunk_index, heading_path, content, tokens, embedding, tsv)"
                f" VALUES (%s, %s, %s, %s, %s, %s, to_tsvector('{TEXT_SEARCH_CONFIG}', %s))",
                [
                    (doc_id, c.index, c.heading_path, c.content, c.tokens, v, keyword_text(c.embedding_text()))
                    for c, v in zip(chunks, vectors)
                ],
            )


# --- indexing -----------------------------------------------------------------


def index_file(conn, path: Path, force: bool = False, on_embed=None) -> dict:
    """Chunk, embed and store one .md file, replacing what the index held for
    that path. Skips the embedding call when the file and settings are unchanged."""
    path = path.resolve()
    text = path.read_text(encoding="utf-8")
    fingerprint_ = fingerprint(text)
    row = conn.execute("SELECT fingerprint FROM rag_documents WHERE source = %s", (str(path),)).fetchone()
    chunks = chunk_file(path)
    result = {
        "status": "unchanged" if row and row[0] == fingerprint_ and not force else ("updated" if row else "added"),
        "title": md_chunker.document_title(path),
        "chunks": len(chunks),
        "tokens": sum(c.tokens for c in chunks),
    }
    if result["status"] == "unchanged":
        return result
    if on_embed:
        on_embed(len(chunks))
    vectors = embed([c.embedding_text() for c in chunks], "search_document")
    store(conn, path, chunks, vectors, fingerprint_)
    return result


def index(folder: Path, rebuild: bool = False, force: bool = False) -> None:
    files = sorted(folder.resolve().glob("*.md"))
    if not files:
        sys.exit(f"No .md files in {folder}")
    conn = connect()
    create_schema(conn, rebuild)
    known = dict(conn.execute("SELECT source, fingerprint FROM rag_documents").fetchall())

    for i, path in enumerate(files, 1):
        result = index_file(
            conn, path, force,
            on_embed=lambda n: print(f"[{i}/{len(files)}] {path.name}: {n} chunks, embedding...", flush=True),
        )
        if result["status"] == "unchanged":
            print(f"[{i}/{len(files)}] {path.name}: unchanged")

    # Files deleted from the folder leave the index too.
    current = {str(p) for p in files}
    gone = [s for s in known if Path(s).parent == folder.resolve() and s not in current]
    with conn.transaction():
        for s in gone:
            conn.execute("DELETE FROM rag_documents WHERE source = %s", (s,))
    if gone:
        print(f"Removed {len(gone)} deleted file{'s' if len(gone) != 1 else ''} from the index")

    docs, chunks = conn.execute(
        "SELECT (SELECT count(*) FROM rag_documents), (SELECT count(*) FROM rag_chunks)"
    ).fetchone()
    print(f"Index holds {chunks} chunks from {docs} documents")
    conn.close()


def clear_index() -> None:
    """Delete all indexed documents and chunks from pgvector."""
    conn = connect()
    try:
        with conn.transaction():
            conn.execute("TRUNCATE TABLE rag_documents CASCADE")
        print("✓ Successfully cleared pgvector: all documents and chunks removed.")
    finally:
        conn.close()


def reset_schema() -> None:
    """Drop existing tables and recreate them cleanly with the configured vector dimensions."""
    conn = connect()
    try:
        create_schema(conn, rebuild=True)
        print(f"✓ Successfully reset schema: tables recreated with vector({EMBED_DIMENSION}).")
    finally:
        conn.close()


# --- retrieval and answering --------------------------------------------------


@dataclass
class Hit:
    chunk_id: int
    title: str
    source: str
    heading_path: str
    content: str
    score: float  # fused score; higher is better
    vector_rank: int | None  # position in each ranking, None if not proposed
    keyword_rank: int | None
    similarity: float | None  # cosine similarity to the question, when vector search proposed it
    bm25: float | None  # keyword score, when keyword search proposed it

    def ranks(self) -> str:
        v = f"#{self.vector_rank}" if self.vector_rank else "-"
        k = f"#{self.keyword_rank}" if self.keyword_rank else "-"
        return f"vector {v}, keyword {k}"


def vector_ranking(conn, query_vector: np.ndarray, limit: int = CANDIDATES) -> list[tuple[int, float]]:
    """(chunk id, cosine similarity), most similar first."""
    rows = conn.execute(
        "SELECT id, 1 - (embedding <=> %s) FROM rag_chunks ORDER BY embedding <=> %s LIMIT %s",
        (query_vector, query_vector, limit),
    ).fetchall()
    return [(r[0], float(r[1])) for r in rows]


# BM25 over the full-text index. Postgres's own ts_rank ignores how rare a word
# is, so a question's "production" would count as much as its "7.1.12.3"; BM25
# weights each word by inverse document frequency. Any word may match (OR).
_BM25 = f"""
WITH terms AS (
    SELECT DISTINCT lexeme FROM unnest(to_tsvector('{TEXT_SEARCH_CONFIG}', %(q)s))
), query AS (
    SELECT string_agg(quote_literal(lexeme), ' | ')::tsquery AS tsq FROM terms
), corpus AS (
    SELECT count(*) AS n, avg(length(tsv)) AS avgdl FROM rag_chunks
), df AS (
    SELECT word, ndoc FROM ts_stat('SELECT tsv FROM rag_chunks')
    WHERE word IN (SELECT lexeme FROM terms)
)
SELECT c.id, sum(
    ln(1 + (corpus.n - df.ndoc + 0.5) / (df.ndoc + 0.5))
    * cardinality(t.positions) * (%(k1)s + 1)
    / (cardinality(t.positions) + %(k1)s * (1 - %(b)s + %(b)s * length(c.tsv) / corpus.avgdl))
) AS score
FROM rag_chunks c
CROSS JOIN query
CROSS JOIN corpus
CROSS JOIN LATERAL unnest(c.tsv) AS t
JOIN df ON df.word = t.lexeme
WHERE c.tsv @@ query.tsq
GROUP BY c.id
ORDER BY score DESC
LIMIT %(limit)s
"""


def keyword_ranking(conn, question: str, limit: int = CANDIDATES) -> list[tuple[int, float]]:
    """(chunk id, BM25 score), best first."""
    rows = conn.execute(
        _BM25, {"q": keyword_text(question), "k1": 1.2, "b": 0.75, "limit": limit}
    ).fetchall()
    return [(r[0], float(r[1])) for r in rows]


def query_terms(conn, question: str) -> list[str]:
    """The words keyword search looks for: stemmed, stop words removed."""
    rows = conn.execute(
        f"SELECT DISTINCT lexeme FROM unnest(to_tsvector('{TEXT_SEARCH_CONFIG}', %s))",
        (keyword_text(question),),
    ).fetchall()
    return [r[0] for r in rows]


def fuse(vector: list[tuple[int, float]], keyword: list[tuple[int, float]], k: int) -> list[tuple[int, float]]:
    """Reciprocal rank fusion of the two rankings: (chunk id, score), best first."""
    scores: dict[int, float] = {}
    for ranking in (vector, keyword):
        for rank, (chunk_id, _) in enumerate(ranking, 1):
            scores[chunk_id] = scores.get(chunk_id, 0.0) + 1 / (RRF_K + rank)
    best = sorted(scores, key=scores.get, reverse=True)[:k]
    return [(i, scores[i]) for i in best]


def load_hits(conn, fused, vector, keyword) -> list[Hit]:
    if not fused:
        return []
    ids = [i for i, _ in fused]
    rows = conn.execute(
        "SELECT c.id, d.title, d.source, c.heading_path, c.content"
        " FROM rag_chunks c JOIN rag_documents d ON d.id = c.document_id WHERE c.id = ANY(%s)",
        (ids,),
    ).fetchall()
    by_id = {r[0]: r[1:] for r in rows}
    vector_pos = {cid: (n, sim) for n, (cid, sim) in enumerate(vector, 1)}
    keyword_pos = {cid: (n, sc) for n, (cid, sc) in enumerate(keyword, 1)}
    hits = []
    for chunk_id, score in fused:
        v = vector_pos.get(chunk_id, (None, None))
        kw = keyword_pos.get(chunk_id, (None, None))
        hits.append(Hit(chunk_id, *by_id[chunk_id], score, v[0], kw[0], v[1], kw[1]))
    return hits


def search(
    question: str,
    k: int = DEFAULT_K,
    conn=None,
    mode: str = "hybrid",
    query_vector: np.ndarray | None = None,
) -> list[Hit]:
    conn = conn or connect()
    vector: list[tuple[int, float]] = []
    keyword: list[tuple[int, float]] = []
    if mode in ("hybrid", "vector"):
        if query_vector is None:
            [query_vector] = embed([question], "search_query")
        vector = vector_ranking(conn, query_vector)
    if mode in ("hybrid", "keyword"):
        keyword = keyword_ranking(conn, question)
    return load_hits(conn, fuse(vector, keyword, k), vector, keyword)


def build_prompt(question: str, hits: list[Hit]) -> str:
    excerpts = "\n\n".join(
        f'<excerpt id="{n}" document="{h.title}" section="{h.heading_path}">\n{h.content}\n</excerpt>'
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


def ask_events(question: str, k: int = DEFAULT_K, mode: str = "hybrid"):
    """The whole pipeline as a sequence of events for a UI: ("stage", {...})
    as each step starts and finishes, ("sources", [...]), ("token", str) while
    Claude writes, and ("done", {...}). Errors propagate to the caller."""
    import time

    started = time.perf_counter()

    def stage(key, status, detail="", t0=None):
        info = {"key": key, "status": status, "detail": detail}
        if t0 is not None:
            info["ms"] = round((time.perf_counter() - t0) * 1000)
        return "stage", info

    conn = connect()
    try:
        vector: list[tuple[int, float]] = []
        keyword: list[tuple[int, float]] = []
        if mode in ("hybrid", "vector"):
            t0 = time.perf_counter()
            yield stage("embed", "running", f"Ollama {EMBED_MODEL}")
            [query_vector] = embed([question], "search_query")
            yield stage("embed", "done", f"{len(query_vector)}-dimension vector from Ollama {EMBED_MODEL}", t0)

            t0 = time.perf_counter()
            yield stage("vector", "running", "Nearest chunks by cosine similarity")
            vector = vector_ranking(conn, query_vector)
            best = f", best similarity {vector[0][1]:.3f}" if vector else ""
            yield stage("vector", "done", f"{len(vector)} candidates{best}", t0)
        if mode in ("hybrid", "keyword"):
            t0 = time.perf_counter()
            terms = query_terms(conn, question)
            # Show codes as typed, not as their index forms ("m090030", "-090").
            codes = [m.group(0) for m in _CODE.finditer(question)]
            joined = set(keyword_text(" ".join(codes)).split()) - set(" ".join(codes).split())
            shown = codes + [t for t in terms if len(t) > 1 and not t.startswith("-") and t not in {w.lower() for w in joined}]
            running = stage("keyword", "running", "Looking for: " + ", ".join(shown))
            running[1]["terms"] = terms  # the page highlights these in the sources
            yield running
            keyword = keyword_ranking(conn, question)
            yield stage(
                "keyword", "done",
                f"{len(keyword)} best matches for {', '.join(shown)}" if keyword else "No chunk contains these words",
                t0,
            )

        t0 = time.perf_counter()
        yield stage("fuse", "running", "Reciprocal rank fusion")
        hits = load_hits(conn, fuse(vector, keyword, k), vector, keyword)
        if not hits:
            raise RuntimeError("Nothing matched. Is the index empty? Run `python rag.py index <folder>`.")
        both = sum(1 for h in hits if h.vector_rank and h.keyword_rank)
        docs = len({h.title for h in hits})
        detail = f"Top {len(hits)} chunks from {docs} document{'s' * (docs != 1)}"
        if mode == "hybrid":
            detail += f"; {both} found by both searches"
        yield stage("fuse", "done", detail, t0)
    finally:
        conn.close()

    yield "sources", [
        {
            "n": n, "title": h.title, "section": h.heading_path, "content": h.content,
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


def ask(question: str, k: int = DEFAULT_K, out=sys.stdout, mode: str = "hybrid") -> str:
    """Stream Claude's answer to `out` and return it."""
    hits = search(question, k, mode=mode)
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
        out.write(f"  [{n}] {h.title} -- {h.heading_path or '(top)'}  ({h.ranks()})\n")
    return "".join(parts)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("index", help="chunk, embed and store every .md file in a folder")
    p.add_argument("folder", type=Path, nargs="?", default=Path("solvay-spark/markdown"))
    p.add_argument("--force", action="store_true", help="re-embed files even if unchanged")
    p.add_argument("--rebuild", action="store_true", help="drop the tables and start over")

    for name, help_ in (("search", "show the chunks closest to a question"), ("ask", "answer a question")):
        p = sub.add_parser(name, help=help_)
        p.add_argument("question")
        p.add_argument("-k", type=int, default=DEFAULT_K, help=f"chunks to retrieve (default {DEFAULT_K})")
        p.add_argument(
            "--mode", choices=MODES, default="hybrid",
            help="hybrid (default): vector + keyword; or either one alone",
        )

    p = sub.add_parser("chunks", help="print how a file is chunked (no API calls)")
    p.add_argument("file", type=Path)

    sub.add_parser("clear", help="delete all indexed documents and chunks from pgvector")
    sub.add_parser("reset", help="drop tables and recreate schema cleanly with vector(1024)")

    args = parser.parse_args()
    if args.command == "index":
        index(args.folder, rebuild=args.rebuild, force=args.force)
    elif args.command == "clear":
        clear_index()
    elif args.command == "reset":
        reset_schema()
    elif args.command == "search":
        for n, h in enumerate(search(args.question, args.k, mode=args.mode), 1):
            print(f"\n[{n}] {h.title} -- {h.heading_path or '(top)'}  ({h.ranks()})")
            print("    " + h.content[:300].replace("\n", "\n    "))
    elif args.command == "ask":
        ask(args.question, args.k, mode=args.mode)
    elif args.command == "chunks":
        for c in chunk_file(args.file):
            print(f"\n===== chunk {c.index}: ~{c.tokens} tokens =====")
            print(c.embedding_text())


if __name__ == "__main__":
    main()

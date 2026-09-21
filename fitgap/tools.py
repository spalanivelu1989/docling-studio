"""The only window the Copilot has onto the corpus (handover §4.1).

Every tool wraps something that already exists -- rag.search for retrieval,
knowledge_graph for identity, bpml for scope -- and adds two things the agent
needs and the existing code has no reason to provide: a retrieval log, so the
verifier can prove a cited chunk was actually returned in this run, and
holdout masking, so an evaluation run cannot read the answer key off a file
path (§8.3).
"""

from __future__ import annotations

import fnmatch
import re
import sys
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import knowledge_graph  # noqa: E402
import rag  # noqa: E402

from . import bpml  # noqa: E402

# --- holdout (§8.3) -----------------------------------------------------------
# The corpus contains the answer key: a fit register names the verdict, and a
# path like "3. GAPs - Development/..." gives it away without being read. In
# holdout mode the registers are excluded and the tell-tale tokens are stripped
# from everything the agent sees. Originals are kept for scoring.

HOLDOUT_DOC_GLOBS = (
    "*L2C - Fits*", "*Reports listed as FITs and GAPs*", "*FITs with missing description*",
    "*- Fits.*", "*Fit-Gap*", "*FitGap*",
)
HOLDOUT_PATH_GLOBS = ("*FITs - Config*", "*GAPs - Development*", "*/2. FIT*", "*/3. GAP*")
_LABEL_TOKEN = re.compile(r"\b(FITs?|GAPs?|Fits?|Gaps?)\b")


def _matches(text: str, globs: tuple[str, ...]) -> bool:
    low = text.lower()
    return any(fnmatch.fnmatch(low, g.lower()) for g in globs)


def is_held_out(doc: str, source: str = "") -> bool:
    return _matches(doc, HOLDOUT_DOC_GLOBS) or _matches(source or doc, HOLDOUT_PATH_GLOBS)


def mask_label(text: str) -> str:
    """Blank the FIT/GAP tokens that encode the verdict, leaving the rest of
    the name legible so the agent can still tell two documents apart."""
    return _LABEL_TOKEN.sub("•••", text or "")


# --- the retrieval log --------------------------------------------------------


@dataclass
class ToolCall:
    name: str
    arguments: dict
    summary: str
    ms: int = 0
    error: str | None = None


@dataclass
class Session:
    """One agent run over one BPML step. Not shared between steps: the
    'cite only what you retrieved' rule is scoped to a single register entry."""

    holdout: bool = False
    doc_exclude: tuple[str, ...] = ()
    calls: list[ToolCall] = field(default_factory=list)
    # chunk id -> the record the agent was shown, for the verifier
    retrieved: dict[str, dict] = field(default_factory=dict)
    masked_docs: set[str] = field(default_factory=set)
    _conn: Any = None
    _lock: threading.Lock = field(default_factory=threading.Lock)

    @property
    def conn(self):
        # psycopg connections are not thread safe; one per session, and each
        # session belongs to exactly one worker thread.
        if self._conn is None:
            self._conn = rag.connect()
        return self._conn

    def close(self) -> None:
        if self._conn is not None:
            try:
                self._conn.close()
            finally:
                self._conn = None

    def excluded(self, doc: str, source: str = "") -> bool:
        if self.doc_exclude and _matches(doc, tuple(self.doc_exclude)):
            return True
        return self.holdout and is_held_out(doc, source)

    def present(self, doc: str) -> str:
        if not self.holdout:
            return doc
        shown = mask_label(doc)
        if shown != doc:
            self.masked_docs.add(doc)
        return shown

    def record(self, call: ToolCall) -> None:
        with self._lock:
            self.calls.append(call)


# --- the tools ----------------------------------------------------------------

MAX_CHUNK_CHARS = 2400


def get_scope(session: Session, bpml_code: str) -> dict:
    p = bpml.get(bpml_code)
    if not p:
        near = [x.brief() for x in bpml.search(bpml_code, limit=5)]
        return {"error": f"'{bpml_code}' is not a code in the BPML sheet", "did_you_mean": near}
    return {
        "process": p.full(),
        "parent": bpml.get(p.parent).brief() if p.parent and bpml.get(p.parent) else None,
        "children": [c.brief() for c in bpml.children(p.code)],
        "ancestry": [a.brief() for a in _ancestry(p)],
    }


def _ancestry(p: bpml.Process) -> list[bpml.Process]:
    out: list[bpml.Process] = []
    cur = p.parent
    while cur:
        q = bpml.get(cur)
        if not q:
            break
        out.append(q)
        cur = q.parent
    return list(reversed(out))


def search_corpus(session: Session, query: str, k: int = 8, filters: dict | None = None) -> dict:
    """Hybrid retrieval only -- vector + BM25 + RRF, no answer generation.
    Over-fetches when a filter is active so a held-out document does not
    silently cost the agent a slot."""
    filters = filters or {}
    include = tuple(filters.get("doc_include") or ())
    exclude = tuple(filters.get("doc_exclude") or ())
    k = max(1, min(int(k or 8), 12))
    want = k * 3 if (include or exclude or session.holdout or session.doc_exclude) else k

    hits = rag.search(query, k=want, conn=session.conn, mode=filters.get("mode", "hybrid"))
    results = []
    dropped = 0
    for h in hits:
        if session.excluded(h.title, h.source) or (exclude and _matches(h.title, exclude)):
            dropped += 1
            continue
        if include and not _matches(h.title, include):
            continue
        cid = str(h.chunk_id)
        rec = {
            "chunk_id": cid,
            "doc": session.present(h.title),
            "heading_path": session.present(h.heading_path),
            "text": h.content[:MAX_CHUNK_CHARS],
            "score": round(h.score, 5),
            "vector_rank": h.vector_rank,
            "keyword_rank": h.keyword_rank,
        }
        session.retrieved[cid] = {**rec, "full_text": h.content, "true_doc": h.title,
                                  "true_heading_path": h.heading_path, "source": h.source}
        results.append(rec)
        if len(results) >= k:
            break
    out: dict = {"query": query, "results": results}
    if dropped:
        out["note"] = f"{dropped} result(s) withheld by the evaluation holdout"
    return out


def get_chunk(session: Session, chunk_id: str) -> dict:
    row = session.conn.execute(
        "SELECT c.id, d.title, d.source, c.heading_path, c.content, c.tokens"
        " FROM rag_chunks c JOIN rag_documents d ON d.id = c.document_id WHERE c.id = %s",
        (int(chunk_id),),
    ).fetchone() if str(chunk_id).isdigit() else None
    if not row:
        return {"error": f"chunk {chunk_id} does not exist"}
    cid, title, source, heading, content, tokens = row
    if session.excluded(title, source):
        return {"error": f"chunk {chunk_id} is in a document withheld by the evaluation holdout"}
    rec = {
        "chunk_id": str(cid), "doc": session.present(title),
        "heading_path": session.present(heading), "text": content[:MAX_CHUNK_CHARS], "tokens": tokens,
    }
    session.retrieved[str(cid)] = {**rec, "full_text": content, "true_doc": title,
                                   "true_heading_path": heading, "source": source, "score": None,
                                   "vector_rank": None, "keyword_rank": None}
    return rec


def _graph():
    return knowledge_graph.extract_graph()


def graph_entity(session: Session, text_or_code: str) -> dict:
    """Resolve a name or code to a graph node. The graph models dash codes
    (O-050-030), streams, systems, documents and SPARK tickets -- it does not
    model dotted BPML codes, so 4.5.1.4 resolves to nothing and the agent is
    told so rather than being handed a wrong node."""
    q = (text_or_code or "").strip().lower()
    g = _graph()
    if re.fullmatch(r"\d+(\.\d+)+", q):
        return {
            "matches": [],
            "note": "the knowledge graph does not contain dotted BPML codes; "
                    "resolve this step by its name, or by a SPARK ticket or system it mentions",
        }
    exact, partial = [], []
    for n in g["nodes"]:
        if session.excluded(n.get("label", ""), n.get("source", "")):
            continue
        label, nid = n["label"].lower(), n["id"].lower()
        code = (n.get("code") or "").lower()
        ticket = (n.get("ticket") or "").lower()
        if q in (label, nid, code, ticket):
            exact.append(n)
        elif len(q) > 2 and (q in label or q in nid or (code and q in code) or (ticket and q in ticket)):
            partial.append(n)
    picked = (exact or partial)[:8]
    return {"matches": [_node(session, n) for n in picked],
            "note": "" if picked else f"no graph entity matches '{text_or_code}'"}


def _node(session: Session, n: dict) -> dict:
    return {"node_id": n["id"], "type": n["type"], "label": session.present(n["label"]),
            "code": n.get("code"), "ticket": n.get("ticket"), "degree": n.get("degree"),
            "description": (n.get("description") or "")[:240]}


def graph_neighbors(session: Session, node_id: str, hops: int = 1) -> dict:
    """Adjacent nodes out to `hops`. Two hops is the useful default for a
    platform: a system reaches a ticket only through its specification."""
    g = _graph()
    nodes = {n["id"]: n for n in g["nodes"]}
    if node_id not in nodes:
        return {"error": f"node '{node_id}' is not in the graph"}
    hops = 1 if hops is None else max(1, min(int(hops), 2))
    adjacency: dict[str, list[tuple[str, dict]]] = {}
    for e in g["edges"]:
        adjacency.setdefault(e["source"], []).append((e["target"], e))
        adjacency.setdefault(e["target"], []).append((e["source"], e))

    seen = {node_id: 0}
    frontier = [node_id]
    edges_used: list[dict] = []
    for depth in range(1, hops + 1):
        nxt = []
        for cur in frontier:
            for other, e in adjacency.get(cur, []):
                if other not in seen:
                    seen[other] = depth
                    nxt.append(other)
                    edges_used.append(e)
        frontier = nxt

    out = []
    for nid, depth in seen.items():
        if depth == 0:
            continue
        n = nodes[nid]
        if session.excluded(n.get("label", ""), n.get("source", "")):
            continue
        out.append({**_node(session, n), "hops": depth})
    out.sort(key=lambda n: (n["hops"], -(n.get("degree") or 0)))
    return {
        "node": _node(session, nodes[node_id]),
        "neighbors": out[:40],
        "edges": [{"edge_id": e["id"], "source": e["source"], "target": e["target"],
                   "relation": e["relation"], "label": e["label"]} for e in edges_used[:60]],
        "truncated": len(out) > 40,
    }


def graph_path(session: Session, a: str, b: str) -> dict:
    g = _graph()
    nodes = {n["id"]: n for n in g["nodes"]}
    src = a if a in nodes else _best_node(g, a)
    tgt = b if b in nodes else _best_node(g, b)
    if not src or not tgt:
        return {"error": f"could not resolve {'a' if not src else 'b'} to a graph node"}
    path = knowledge_graph.find_shortest_path(g, src, tgt)
    if not path:
        return {"path": None, "note": f"no path connects {src} and {tgt}"}
    edges = {e["id"]: e for e in g["edges"]}
    steps = []
    for eid in path["edges"]:
        e = edges.get(eid)
        if e:
            steps.append({"from": session.present(nodes[e["source"]]["label"]),
                          "relation": e["relation"],
                          "to": session.present(nodes[e["target"]]["label"])})
    return {"hops": path["hops"], "node_ids": path["nodes"], "edge_ids": path["edges"], "steps": steps}


def _best_node(g: dict, term: str) -> str | None:
    t = (term or "").strip().lower()
    if not t:
        return None
    for n in g["nodes"]:
        if t in (n["label"].lower(), n["id"].lower(), (n.get("code") or "").lower()):
            return n["id"]
    for n in g["nodes"]:
        if len(t) > 2 and t in n["label"].lower():
            return n["id"]
    return None


# --- the schema the agent sees ------------------------------------------------

def _entry_schema() -> dict:
    from .schemas import FitGapEntry

    schema = FitGapEntry.model_json_schema()
    schema.pop("$defs", None) or None
    return FitGapEntry.model_json_schema()


def definitions(mode: str = "A") -> list[dict]:
    """The Claude tool definitions. `submit_entry` advertises the Pydantic
    schema itself, so the contract in schemas.py is the only source of truth."""
    return [
        {
            "name": "get_scope",
            "description": "Look up a BPML process by code: its name, description, parent, children and ancestry.",
            "input_schema": {
                "type": "object",
                "properties": {"bpml_code": {"type": "string", "description": "e.g. 4.5.1.4"}},
                "required": ["bpml_code"],
            },
        },
        {
            "name": "search_corpus",
            "description": (
                "Hybrid search over the Solvay SPARK Markdown corpus: vector similarity plus BM25 "
                "keyword search, fused. Returns chunk excerpts only -- no answer is generated. "
                "Always run one query containing the exact BPML code, so BM25 can match it verbatim."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "k": {"type": "integer", "description": "1-12, default 8"},
                    "filters": {
                        "type": "object",
                        "properties": {
                            "doc_include": {"type": "array", "items": {"type": "string"},
                                            "description": "only documents whose name matches one of these globs"},
                            "doc_exclude": {"type": "array", "items": {"type": "string"}},
                            "mode": {"type": "string", "enum": ["hybrid", "vector", "keyword"]},
                        },
                    },
                },
                "required": ["query"],
            },
        },
        {
            "name": "get_chunk",
            "description": "The full text and metadata of one chunk, by id.",
            "input_schema": {
                "type": "object",
                "properties": {"chunk_id": {"type": "string"}},
                "required": ["chunk_id"],
            },
        },
        {
            "name": "graph_entity",
            "description": (
                "Resolve a name, system, dash-code (O-050-030) or SPARK ticket to a knowledge-graph "
                "node. The graph holds streams, systems, documents, dash codes and tickets -- it does "
                "NOT hold dotted BPML codes."
            ),
            "input_schema": {
                "type": "object",
                "properties": {"text_or_code": {"type": "string"}},
                "required": ["text_or_code"],
            },
        },
        {
            "name": "graph_neighbors",
            "description": "Nodes adjacent to a graph node, out to 1 or 2 hops: tickets, systems, streams, documents.",
            "input_schema": {
                "type": "object",
                "properties": {"node_id": {"type": "string"}, "hops": {"type": "integer", "description": "1 or 2"}},
                "required": ["node_id"],
            },
        },
        {
            "name": "graph_path",
            "description": "Shortest hop-by-hop path between two graph entities (BFS).",
            "input_schema": {
                "type": "object",
                "properties": {"a": {"type": "string"}, "b": {"type": "string"}},
                "required": ["a", "b"],
            },
        },
        {
            "name": "submit_entry",
            "description": (
                "Submit the finished fit-gap entry for this step. Validated against the register "
                "schema; a malformed entry comes back with the error so you can correct and resubmit. "
                "Call this exactly once, at the end."
            ),
            "input_schema": _entry_schema(),
        },
    ]


DISPATCH = {
    "get_scope": get_scope,
    "search_corpus": search_corpus,
    "get_chunk": get_chunk,
    "graph_entity": graph_entity,
    "graph_neighbors": graph_neighbors,
    "graph_path": graph_path,
}


def summarise(name: str, args: dict, result: dict) -> str:
    """One line per tool call for the UI's live log."""
    if result.get("error"):
        return result["error"][:120]
    if name == "search_corpus":
        n = len(result.get("results", []))
        return f'"{str(args.get("query", ""))[:58]}" → {n} chunk{"s" if n != 1 else ""}'
    if name == "get_chunk":
        return f'chunk {args.get("chunk_id")} → {result.get("doc", "")[:48]}'
    if name == "get_scope":
        p = result.get("process", {})
        return f'{p.get("code", "")} {str(p.get("name", ""))[:46]}'
    if name == "graph_entity":
        m = result.get("matches", [])
        return f'"{str(args.get("text_or_code", ""))[:34]}" → {len(m)} node{"s" if len(m) != 1 else ""}'
    if name == "graph_neighbors":
        return f'{args.get("node_id", "")[:30]} → {len(result.get("neighbors", []))} neighbours'
    if name == "graph_path":
        return f'{result.get("hops", "no")} hop(s)' if result.get("path") is not False else "no path"
    return ""

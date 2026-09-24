"""What each engine actually returned, kept for the investigation log.

Shared by the Evidence Agent and the Fit-Gap Copilot, which is why it lives
beside the tools rather than inside either of them: they call the same five
fitgap tools, and a reader walking one agent's log should not meet a
different panel from the other's.

The log used to record that a call happened -- the tool, a one-line summary,
which store answered, how long it took -- and then threw the result away. That
is enough to see the shape of an investigation and not nearly enough to check
it: a reader could see that retrieval was asked eight times without ever
learning which passages came back, at what rank, or whether any of them ended
up in the answer.

So each call now carries a trace: the evidence that call contributed, in a
shape the page can render without knowing anything about the tool that
produced it. Three kinds, one per engine.

  rag    the ranked hits -- chunk id, document, category, fusion score and the
         two ranks behind it, and the passage text the agent was given. The
         text is kept verbatim rather than re-fetched later, for the reason
         ask_store keeps its excerpts: re-indexing renumbers chunks, so a
         chunk id recorded today may point at different text next month. The
         id is still recorded, as a best-effort deep link.

  graph  the traversal -- the nodes it started from, the nodes and edges it
         walked, and the route if one was asked for. Node ids are the graph's
         own, so the page can expand a neighbourhood from them.

  bpml   the slice of the process hierarchy that was read: the process, its
         ancestry, its parent and its children.

Everything here is bounded. A trace is written to Postgres on every call and
held in the browser for the length of a run, so an unbounded one would be paid
for twice. The caps are generous enough that they are not normally reached and
low enough that a pathological call cannot turn one row into a megabyte; when
one bites, `truncated` says so rather than letting the page imply it is
showing everything.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fitgap import tools as ftools  # noqa: E402

# A neighbourhood the page can actually draw. graph_neighbors already caps its
# own output at 40 nodes; graph_enumerate can return 200 items, which is a fine
# answer to "how many" and far too many circles to read.
MAX_NODES = 80
MAX_EDGES = 160
MAX_HITS = 12
# The description shown on a node in the panel. The tools cap theirs at 240 for
# the model; the reader gets the same, so the panel cannot show more context
# than the agent had.
MAX_DESC = 240

# read_sources is retrieval too -- the same hybrid ranking, over the documents
# attached to one session rather than the corpus. The `sources` label on the
# call already says which database answered; what matters here is that it comes
# back as passages a reader can check.
RAG_TOOLS = ("search_corpus", "search_uploads", "get_chunk", "read_sources")
GRAPH_TOOLS = ("graph_entity", "graph_neighbors", "graph_path", "graph_enumerate",
               "compare_entities")


def of(tool: str, args: dict, result: dict, session: ftools.Session | None = None) -> dict | None:
    """The evidence one tool call contributed, or None when there is none.

    Never raises: a trace is a record of what happened, and failing to build
    one must not turn a successful call into a failed investigation."""
    try:
        if result.get("error"):
            return None
        if tool in RAG_TOOLS:
            return _rag(tool, args, result)
        if tool in GRAPH_TOOLS:
            return _graph(tool, args, result, session)
        if tool == "get_scope":
            return _bpml(args, result)
    except Exception:  # pragma: no cover - a broken trace is not a broken run
        return None
    return None


# --- retrieval -----------------------------------------------------------------


def _rag(tool: str, args: dict, result: dict) -> dict | None:
    rows = (result.get("results") or []) if tool != "get_chunk" else (
        [result] if result.get("chunk_id") else [])
    if not rows:
        return None
    hits = []
    for rank, r in enumerate(rows[:MAX_HITS], 1):
        cid = str(r.get("chunk_id") or "")
        hits.append({
            # The rank the agent saw it at. Fusion order, not vector order --
            # which is why the two component ranks travel beside it: a hit that
            # is 1st overall, 14th by vector and 2nd by keyword got there on
            # words, and a reader should be able to see that.
            "rank": rank,
            "chunk_id": cid,
            # Chunk ids carry the category they are filed under ("PKG:412"),
            # so the panel can group by store without a second lookup.
            "category": cid.split(":")[0] if ":" in cid else "",
            "doc": r.get("doc") or "",
            "heading_path": r.get("heading_path") or "",
            "score": r.get("score"),
            "vector_rank": r.get("vector_rank"),
            "keyword_rank": r.get("keyword_rank"),
            "text": r.get("text") or "",
            "uploaded": bool(r.get("uploaded")),
            # Which side of a three-way comparison this passage is evidence
            # for. A Rollout answer stands or falls on whether a quote came
            # from the country's As-Is or from the Global Template, and a
            # panel that does not say cannot be used to check one.
            "side": r.get("side") or "",
            "side_label": r.get("side_label") or "",
            "provenance": list(r.get("provenance") or []),
            "provenance_note": r.get("provenance_note") or "",
        })
    filters = args.get("filters") or {}
    return {
        "kind": "rag",
        "op": tool,
        "side": str(args.get("side") or ""),
        "query": str(args.get("query") or args.get("chunk_id") or ""),
        "k": args.get("k"),
        "mode": filters.get("mode") or ("hybrid" if tool != "get_chunk" else "direct"),
        "filters": {k: v for k, v in filters.items() if v and k != "mode"},
        "hits": hits,
        "note": result.get("note") or "",
        "duplicate_warning": result.get("duplicate_warning") or "",
        "truncated": len(rows) > MAX_HITS,
    }


# --- graph ---------------------------------------------------------------------


def _graph(tool: str, args: dict, result: dict, session: ftools.Session | None) -> dict | None:
    """One node/edge payload for all four graph tools.

    They ask different questions -- resolve a name, walk a neighbourhood, find
    a route, count a type -- but a reader wants the same thing from each: what
    did it start from, what did it reach, and along which relations. Returning
    one shape means the page has one graph renderer rather than four, and a
    node id is a node id whichever tool produced it, so expanding from any of
    them works the same way."""
    g = ftools._graph(session) if session is not None else None
    nodes_by_id: dict[str, dict] = {n["id"]: n for n in g["nodes"]} if g else {}
    edges_by_id: dict[str, dict] = {e["id"]: e for e in g["edges"]} if g else {}

    seeds: list[str] = []
    picked: dict[str, str] = {}   # node id -> role
    hops: dict[str, int] = {}
    shared_flags: dict[str, bool] = {}
    mentions: dict[str, int] = {}
    path_nodes: list[str] = []
    path_edges: set[str] = set()
    path: dict | None = None
    count: int | None = None

    if tool == "graph_entity":
        for m in result.get("matches") or []:
            picked.setdefault(str(m.get("node_id")), "match")
    elif tool == "graph_neighbors":
        root = str((result.get("node") or {}).get("node_id") or args.get("node_id") or "")
        if root:
            seeds.append(root)
            picked[root] = "seed"
        for n in result.get("neighbors") or []:
            nid = str(n.get("node_id"))
            picked.setdefault(nid, "neighbour")
            hops[nid] = int(n.get("hops") or 1)
        for e in result.get("edges") or []:
            eid = str(e.get("edge_id"))
            if eid not in edges_by_id:
                # graph_neighbors returns the edge inline; trust it when the
                # scoped graph is not to hand (a replayed or test call).
                edges_by_id[eid] = {"id": eid, "source": e.get("source"), "target": e.get("target"),
                                    "relation": e.get("relation"), "label": e.get("label")}
    elif tool == "graph_path":
        path_nodes = [str(n) for n in result.get("node_ids") or []]
        path_edges = {str(e) for e in result.get("edge_ids") or []}
        for i, nid in enumerate(path_nodes):
            picked[nid] = "seed" if i in (0, len(path_nodes) - 1) else "path"
        seeds = [n for n in (path_nodes[:1] + path_nodes[-1:]) if n]
        path = {
            "hops": result.get("hops"),
            "steps": result.get("steps") or [],
            "meaningful": result.get("meaningful"),
            "note": result.get("note") or result.get("warning") or "",
            "node_ids": path_nodes,
        }
    elif tool == "compare_entities":
        # The entities an attached document and the corpus have in common, and
        # the ones only the attachment has. They are real graph nodes, so they
        # render as a graph rather than as a third kind of panel -- but the
        # shared/new split is the whole point of the call, so it travels on
        # each node rather than being left to the reader to infer.
        for e in (result.get("entities") or [])[:MAX_NODES]:
            nid = str(e.get("node_id"))
            picked.setdefault(nid, "match" if e.get("in_corpus") else "neighbour")
            shared_flags[nid] = bool(e.get("in_corpus"))
            mentions[nid] = int(e.get("corpus_mentions") or 0)
            if not nodes_by_id.get(nid):
                nodes_by_id[nid] = {"id": nid, "label": e.get("label") or nid,
                                    "type": e.get("type") or "", "code": e.get("code"),
                                    "description": ""}
    elif tool == "graph_enumerate":
        root = str((result.get("node") or {}).get("node_id") or args.get("node_id") or "")
        if root:
            seeds.append(root)
            picked[root] = "seed"
        count = result.get("count")
        for item in (result.get("items") or [])[:MAX_NODES]:
            nid = str(item.get("node_id"))
            picked.setdefault(nid, "neighbour")
            hops[nid] = 1

    if not picked:
        return None

    kept = list(picked)[:MAX_NODES]
    keep = set(kept)
    nodes = []
    for nid in kept:
        n = nodes_by_id.get(nid) or {}
        nodes.append({
            "id": nid,
            "label": _label(nid, n, result),
            "type": n.get("type") or _type_from(nid),
            "degree": n.get("degree"),
            "description": (n.get("description") or "")[:MAX_DESC],
            "role": picked[nid],
            "hops": hops.get(nid, 0 if picked[nid] == "seed" else 1),
            # Only compare_entities sets these; everywhere else they are None
            # and the panel leaves the badge off rather than claiming "new".
            "in_corpus": shared_flags.get(nid),
            "corpus_mentions": mentions.get(nid),
        })

    # Every edge of the scoped graph that joins two nodes we kept -- not only
    # the ones the tool happened to return. A resolution call returns matches
    # with no edges at all; drawing the relations that already hold between
    # them is what turns a list into a picture, and they are relations the run
    # could see, so nothing outside its scope leaks in.
    edges = []
    for eid, e in edges_by_id.items():
        if e.get("source") in keep and e.get("target") in keep:
            edges.append({
                "id": eid, "source": e["source"], "target": e["target"],
                "relation": e.get("relation") or "", "label": e.get("label") or "",
                "on_path": eid in path_edges,
            })
        if len(edges) >= MAX_EDGES:
            break

    return {
        "kind": "graph",
        "op": tool,
        "query": str(args.get("text_or_code") or args.get("node_id")
                     or (f"{args.get('a')} → {args.get('b')}" if args.get("a") else "")),
        "seeds": seeds,
        "nodes": nodes,
        "edges": edges,
        "path": path,
        "count": count,
        "shared": result.get("shared"),
        "new": result.get("new"),
        "type_filter": result.get("type_filter") or args.get("type") or "",
        "note": result.get("note") or "",
        "truncated": bool(result.get("truncated")) or len(picked) > MAX_NODES,
    }


def _label(nid: str, node: dict, result: dict) -> str:
    if node.get("label"):
        return node["label"]
    for key in ("matches", "neighbors", "items"):
        for m in result.get(key) or []:
            if str(m.get("node_id")) == nid and m.get("label"):
                return str(m["label"])
    root = result.get("node") or {}
    if str(root.get("node_id")) == nid and root.get("label"):
        return str(root["label"])
    return nid.split(":", 1)[-1]


def _type_from(nid: str) -> str:
    """Node ids are prefixed by type ("doc:", "proc:", "stream:", "system:",
    "spec:"), so a node the scoped graph could not supply is still typed."""
    prefix = nid.split(":", 1)[0]
    return {"doc": "document", "proc": "process", "stream": "stream",
            "system": "system", "spec": "spec"}.get(prefix, "")


# --- BPML ----------------------------------------------------------------------


def _bpml(args: dict, result: dict) -> dict | None:
    process = result.get("process")
    if not process:
        return None
    return {
        "kind": "bpml",
        "op": "get_scope",
        "query": str(args.get("bpml_code") or ""),
        "process": process,
        "parent": result.get("parent"),
        "ancestry": result.get("ancestry") or [],
        "children": result.get("children") or [],
        "truncated": False,
    }

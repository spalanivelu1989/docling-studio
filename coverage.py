"""Which documents the three stores agree on, and where they do not.

A document in this system exists in up to three places and they are built by
different means, so they drift:

  * the FILE on disk -- Markdown in knowledge_base/ or <category>/markdown/;
  * the CORPUS -- rows in rag_documents, written by `rag.py index`, which is
    what Ask RAG and every agent can actually retrieve and cite;
  * the GRAPH -- document nodes in knowledge_graph.json, built by walking those
    same folders and reading the Markdown, never the database.

Nothing keeps them in step. Indexing does not rebuild the graph and rebuilding
the graph does not index, so a file can sit in one, two or three of them. The
gaps are not theoretical: this module exists because a workshop deck was found
on disk and in the graph but not in the corpus, which meant the Evidence Agent
could be TOLD about it by graph traversal and then could not retrieve a word of
it -- and because the graph files a document by the folder it sits in while the
corpus files it by its stored category, so the same PDF is DR in one and
UNFILED in the other.

Everything here is read-only. It reports; it does not reconcile, because every
fix is a decision -- indexing a file changes what the agents can retrieve, and
re-tagging one changes what a scoped run may read.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

BASE = Path(__file__).resolve().parent

# Ordered worst-first. The first two mean a reader and an engine disagree about
# what is in the system; the rest are things worth knowing but not wrong.
SEVERITY = {
    "file_missing": "error",
    "not_indexed": "warning",
    "not_in_graph": "warning",
    "shadowed": "warning",
    "category_mismatch": "info",
    "no_original": "info",
}

ISSUE_HELP = {
    "file_missing": "Indexed, but the Markdown it was indexed from is gone. Its chunks "
                    "are still retrievable and still cite a file nobody can open.",
    "not_indexed": "On disk, and in the graph, but not in the corpus. Traversal can name "
                   "it; retrieval cannot reach it, so nothing may be cited from it.",
    "not_in_graph": "In the corpus but not in the graph. Retrievable and citable, but "
                    "invisible to graph_entity and graph_neighbors.",
    "shadowed": "Two files share this name. The graph keeps the first it finds and drops "
                "the rest, so one of them is silently absent from traversal.",
    "category_mismatch": "The corpus and the graph file this document differently. The "
                         "graph goes by the folder it sits in, the corpus by the category "
                         "stored on the row -- so a scoped run and a scoped traversal "
                         "disagree about whether it is in scope.",
    "no_original": "Only the Markdown is here. There is no source document to review the "
                   "conversion against.",
}


def _relative(path: Path | str) -> str:
    p = Path(path)
    try:
        return str(p.resolve().relative_to(BASE))
    except ValueError:
        return str(p)


def collect(include_documents: bool = True) -> dict[str, Any]:
    """The three sets, their differences, and a row per document."""
    import app  # for ACCEPTED and the original-file lookup
    import knowledge_graph as kg
    import rag

    # --- disk: what the graph's own scan finds, plus what it had to drop -----
    disk: dict[str, dict[str, Any]] = {}
    shadowed: list[dict[str, Any]] = []
    seen_names: dict[str, str] = {}
    for folder, code in kg.source_folders():
        for path in sorted(folder.glob("*.md")):
            if path.name.startswith((".", "~$")):
                continue
            key = str(path.resolve())
            if path.name in seen_names:
                # collect_files() keys by NAME, so the second file of a name is
                # never walked. Recorded rather than dropped silently.
                shadowed.append({"path": key, "folder_category": code,
                                 "shadowed_by": seen_names[path.name]})
            else:
                seen_names[path.name] = key
            disk[key] = {"folder_category": code, "name": path.name,
                         "size": path.stat().st_size}

    # --- corpus --------------------------------------------------------------
    corpus_error = None
    corpus: dict[str, dict[str, Any]] = {}
    try:
        for doc in rag.documents():
            corpus[str(Path(doc["source"]).resolve())] = doc
    except Exception as exc:
        corpus_error = f"{type(exc).__name__}: {exc}"

    # --- graph ---------------------------------------------------------------
    graph_error = None
    graph: dict[str, dict[str, Any]] = {}
    try:
        for node in kg.extract_graph()["nodes"]:
            if node.get("type") == "document" and node.get("source"):
                graph[str((BASE / node["source"]).resolve())] = node
    except Exception as exc:
        graph_error = f"{type(exc).__name__}: {exc}"

    # --- one row per document, whichever store it came from ------------------
    rows: list[dict[str, Any]] = []
    issues: list[dict[str, Any]] = []
    shadowed_paths = {s["path"] for s in shadowed}

    for key in sorted(set(disk) | set(corpus) | set(graph)):
        path = Path(key)
        doc = corpus.get(key)
        node = graph.get(key)
        on_disk = path.is_file()
        original = app._original_of(path) if on_disk else None
        row = {
            "name": path.name,
            "title": (doc or {}).get("title") or (node or {}).get("label") or path.stem,
            "source": _relative(path),
            "on_disk": on_disk,
            "indexed": doc is not None,
            "in_graph": node is not None,
            "corpus_category": (doc or {}).get("category"),
            "graph_category": (node or {}).get("category"),
            "chunks": (doc or {}).get("chunks"),
            "tokens": (doc or {}).get("tokens"),
            "degree": (node or {}).get("degree"),
            "size": disk.get(key, {}).get("size"),
            "has_original": original is not None,
            "original": _relative(original) if original else None,
            "issues": [],
        }

        def flag(kind: str, detail: str = "") -> None:
            row["issues"].append(kind)
            issues.append({"kind": kind, "severity": SEVERITY[kind],
                           "title": row["title"], "source": row["source"],
                           "detail": detail or ISSUE_HELP[kind]})

        if doc is not None and not on_disk:
            flag("file_missing")
        if on_disk and doc is None and corpus_error is None:
            flag("not_indexed")
        if doc is not None and node is None and graph_error is None:
            flag("not_in_graph")
        if key in shadowed_paths:
            other = next(s["shadowed_by"] for s in shadowed if s["path"] == key)
            flag("shadowed", f"{ISSUE_HELP['shadowed']} Kept instead: {_relative(other)}.")
        if (doc and node and doc.get("category") and node.get("category")
                and doc["category"] != node["category"]):
            flag("category_mismatch",
                 f"The corpus says {doc['category']}, the graph says {node['category']}. "
                 + ISSUE_HELP["category_mismatch"])
        if on_disk and original is None:
            flag("no_original")
        rows.append(row)

    counts: dict[str, int] = {k: 0 for k in SEVERITY}
    for issue in issues:
        counts[issue["kind"]] += 1

    out: dict[str, Any] = {
        "summary": {
            "on_disk": len(disk),
            "indexed": len(corpus),
            "in_graph": len(graph),
            "documents": len(rows),
            "clean": sum(1 for r in rows if not r["issues"]),
            **counts,
        },
        "issues": sorted(issues, key=lambda i: (list(SEVERITY).index(i["kind"]), i["title"])),
        "help": ISSUE_HELP,
        "corpus_error": corpus_error,
        "graph_error": graph_error,
    }
    if include_documents:
        out["documents"] = rows
    return out

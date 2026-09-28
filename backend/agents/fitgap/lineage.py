"""Tracing an agent's conclusions back to what its tools returned.

Shared by the Evidence Agent (backend/agents/evidence/lineage.py) and the Fit-Gap Copilot
(backend/agents/rollout/lineage.py), for the reason backend/agents/fitgap/trace.py is shared: both agents
call the same tools, record their calls and their log in the same shapes, and
a reader checking one should meet the same checks in the other.

Every run keeps three records that do not point at each other: `calls` (what
each tool returned, see trace.py), `log` (the investigation in order,
including the reasoning between calls) and the submitted answer, whose quotes
name the chunk they came from. The functions here join them:

  index_calls     chunk -> the calls that returned it, at what rank and score;
                  graph node and edge -> the calls that returned it; call ->
                  the reasoning it was made under
  check_evidence  each quote against the text its call returned
  trail_rows      the log as an audit trail, each call annotated with the
                  claims it supplied evidence for

Everything is computed from the stored run when it is read, so it works for
runs recorded before this module existed and cannot drift from the record.
"""

from __future__ import annotations

import re
from difflib import SequenceMatcher

# A quote shorter than this proves little by matching; it is still checked,
# but "verbatim" on four words is weaker than on forty and the reader is told.
SHORT_QUOTE = 25
# How much of a quote must appear as one contiguous run for "partial".
PARTIAL = 0.6
INTENT_CHARS = 600
# The tools whose results a quote can be checked against.
RETRIEVAL = ("search_corpus", "search_uploads", "read_sources", "get_chunk",
             "search_sap_best_practice", "web_search")


# --- quote verification -------------------------------------------------------

_MARKUP = re.compile(r"[*_`#|>\\]+")
_SPACE = re.compile(r"\s+")
_DASHES = str.maketrans({"–": "-", "—": "-", "‘": "'", "’": "'",
                         "“": '"', "”": '"', " ": " "})


def _norm(text: str) -> str:
    """Compare what was said, not how it was typeset: Markdown emphasis,
    table pipes, smart quotes and line breaks all differ between a chunk and
    a quote the agent copied out of it without changing a word."""
    t = (text or "").translate(_DASHES)
    t = _MARKUP.sub(" ", t)
    return _SPACE.sub(" ", t).strip().lower()


def verify_quote(quote: str, text: str) -> dict:
    """Whether `quote` is in `text`: verbatim, in part, or not at all."""
    q, t = _norm(quote), _norm(text)
    if not q:
        return {"status": "empty", "match": 0.0}
    if not t:
        return {"status": "not_found", "match": 0.0}
    if q in t:
        return {"status": "verbatim", "match": 1.0, "short": len(q) < SHORT_QUOTE}
    # An ellipsis joins pieces the agent left out; each piece must be there.
    parts = [p.strip() for p in re.split(r"\.\.\.|…", q) if p.strip()]
    if len(parts) > 1 and all(p in t for p in parts):
        return {"status": "verbatim", "match": 1.0, "elided": True}
    m = SequenceMatcher(None, q, t, autojunk=False).find_longest_match(0, len(q), 0, len(t))
    share = round(m.size / len(q), 2)
    return {"status": "partial" if share >= PARTIAL else "not_found", "match": share}


# --- indexing the calls -------------------------------------------------------


def index_calls(calls: list[dict], log: list[dict], source_index: dict | None = None) -> dict:
    """Chunk -> the calls that returned it; graph nodes and edges seen; the
    reasoning that preceded each call.

    `source_index` is an optional chunk -> {known, snippet} map (Fit-Gap's
    sources record) consulted for calls that kept no results."""
    hits: dict[str, list[dict]] = {}
    nodes: dict[str, dict] = {}
    edges: dict[str, dict] = {}
    for i, c in enumerate(calls):
        t = c.get("trace") or {}
        if t.get("kind") == "rag":
            for h in t.get("hits") or []:
                cid = str(h.get("chunk_id") or "")
                if cid:
                    hits.setdefault(cid, []).append({
                        "call": i, "tool": c.get("tool"), "stage": c.get("stage", ""),
                        "query": t.get("query", ""), "rank": h.get("rank"),
                        "score": h.get("score"), "vector_rank": h.get("vector_rank"),
                        "keyword_rank": h.get("keyword_rank"), "text": h.get("text") or "",
                        "doc": h.get("doc") or "", "heading_path": h.get("heading_path") or "",
                    })
        elif t.get("kind") == "graph":
            for n in t.get("nodes") or []:
                nid = str(n.get("id") or "")
                if not nid:
                    continue
                rec = nodes.setdefault(nid, {
                    "id": nid, "label": n.get("label") or nid, "type": n.get("type") or "",
                    "description": n.get("description") or "", "in_corpus": n.get("in_corpus"),
                    "calls": []})
                if i not in rec["calls"]:
                    rec["calls"].append(i)
            for e in t.get("edges") or []:
                eid = str(e.get("id") or "")
                if not eid:
                    continue
                rec = edges.setdefault(eid, {
                    "id": eid, "source": e.get("source"), "target": e.get("target"),
                    "relation": e.get("relation") or "", "label": e.get("label") or "",
                    "chunks": list(e.get("chunks") or []), "calls": []})
                if i not in rec["calls"]:
                    rec["calls"].append(i)

        elif t.get("kind") == "bpml":
            # The process register is read by get_scope, not the graph, but a
            # graph fact may name the same processes -- by graph id
            # ("proc:4.10.2") or by bare code. Either counts as seen.
            procs = [t.get("process"), t.get("parent"), *(t.get("ancestry") or [])]
            procs += [{"code": ch} if isinstance(ch, str) else ch
                      for ch in (t.get("children") or (t.get("process") or {}).get("children") or [])]
            for p in procs:
                code = str((p or {}).get("code") or "")
                if not code:
                    continue
                for nid in (f"proc:{code}", code):
                    rec = nodes.setdefault(nid, {
                        "id": nid, "label": f"{code} {(p or {}).get('name') or ''}".strip(),
                        "type": "process", "description": (p or {}).get("description") or "",
                        "in_corpus": None, "calls": [], "register": True})
                    if i not in rec["calls"]:
                        rec["calls"].append(i)

    # The reasoning a call was made under is the last thinking block before
    # it. One block usually covers the few calls of a turn, which is right:
    # they were made for the same reason.
    intent: dict[int, dict] = {}
    last: dict | None = None
    for e in log:
        if e.get("kind") == "thinking":
            last = {"seq": e.get("seq"), "text": (e.get("text") or "")[:INTENT_CHARS]}
        elif e.get("kind") == "tool_call" and e.get("call") is not None and last:
            intent[int(e["call"])] = last
        elif e.get("kind") == "note" and e.get("note") == "stage":
            last = None
    return {"hits": hits, "nodes": nodes, "edges": edges, "intent": intent,
            "index": source_index or {}, "has_results": bool(hits)}


def record_completeness(calls: list[dict]) -> tuple[str, int]:
    """"full", "partial" or "none", and how many retrieval calls kept no
    results -- so a page can say how far a run can be traced at all."""
    missing = sum(1 for c in calls if c.get("tool") in RETRIEVAL
                  and not (c.get("trace") or {}).get("hits") and not c.get("error"))
    return ("none" if not calls else "partial" if missing else "full"), missing


# --- one claim's evidence -----------------------------------------------------


def check_evidence(evidence: list[dict], idx: dict,
                   keep: tuple[str, ...] = ("side", "evidence_class")) -> tuple[list[dict], set]:
    """Each quote, the calls that returned its chunk, and whether the quote is
    in the text those calls returned. `keep` names fields of the quote to
    carry through (a side, a stance)."""
    out, calls_used = [], set()
    for ev in evidence or []:
        cid = str(ev.get("chunk_id") or "")
        found = idx["hits"].get(cid) or []
        best = {"status": "not_retrieved", "match": 0.0}
        where = None
        # Older runs, and tools added to the trace later, kept no results per
        # call. A source index may still record that the chunk was read and
        # keep a snippet of it; check against that, and say which it was.
        known = (idx.get("index") or {}).get(cid) or {}
        if not found and known.get("known"):
            v = verify_quote(ev.get("quote", ""), known.get("snippet") or "")
            best = v if v["status"] == "verbatim" else {"status": "unrecorded", "match": v["match"]}
            best = {**best, "via": "source index"}
        if not found and not idx.get("has_results") and best["status"] == "not_retrieved":
            # No call of this run kept its results, so absence proves nothing.
            best = {"status": "unrecorded", "match": 0.0}
        for h in found:
            v = verify_quote(ev.get("quote", ""), h["text"])
            if v["match"] > best["match"] or best["status"] == "not_retrieved":
                best, where = v, h["call"]
            if v["status"] == "verbatim":
                break
        retrievals = [{k: h[k] for k in ("call", "tool", "stage", "query", "rank", "score",
                                         "vector_rank", "keyword_rank")} for h in found]
        for h in found:
            calls_used.add(h["call"])
        out.append({
            "chunk_id": cid,
            "doc": ev.get("doc", ""),
            "heading_path": ev.get("heading_path", ""),
            **{k: ev.get(k, "") for k in keep},
            "quote": ev.get("quote", ""),
            "verification": {**best, "call": where},
            "retrievals": retrievals,
            "first_call": min((h["call"] for h in found), default=None),
        })
    return out, calls_used


def quote_checks(ev: list[dict], none_detail: str = "no quote was submitted for this claim") -> list[dict]:
    statuses = [e["verification"]["status"] for e in ev]
    checks = [{"check": "Has evidence", "ok": bool(ev),
               "detail": f"{len(ev)} quote(s)" if ev else none_detail}]
    if ev:
        retrieved = sum(s not in ("not_retrieved", "empty") for s in statuses)
        checks.append({"check": "Every quote was retrieved in this run", "ok": retrieved == len(ev),
                       "detail": f"{retrieved} of {len(ev)} chunk(s) appear in a tool call's results"})
        verbatim = statuses.count("verbatim")
        checks.append({"check": "Every quote is in the text that was retrieved", "ok": verbatim == len(ev),
                       "detail": f"{verbatim} verbatim, {statuses.count('partial')} partial, "
                                 f"{statuses.count('not_found') + statuses.count('not_retrieved')} not found"
                                 + (f", {statuses.count('unrecorded')} not checkable (the call's results "
                                    f"were not kept)" if 'unrecorded' in statuses else "")})
    return checks


def intents_for(calls_used: set, idx: dict) -> list[dict]:
    """The reasoning behind the calls a claim's evidence came from, once each."""
    intents: dict[int, dict] = {}
    for c in sorted(calls_used):
        it = idx["intent"].get(c)
        if not it:
            continue
        intents.setdefault(it["seq"], {**it, "calls": []})["calls"].append(c)
    return sorted(intents.values(), key=lambda x: x["seq"])


def mentions(ref: str, text: str) -> bool:
    return bool(ref) and bool(re.search(r"(?<![\w.-])" + re.escape(ref) + r"(?![\w-])", text or ""))


def graph_mentions(text: str, idx: dict) -> list[dict]:
    """Graph entities the investigation looked up whose name appears in
    `text`. A mention, not a citation."""
    low = text.lower()
    out = []
    for n in idx["nodes"].values():
        if n.get("register"):
            continue  # read from the process register, not the graph
        names = {n["label"], n["id"].split(":", 1)[-1]}
        if any(len(x) >= 4 and re.search(r"(?<![\w])" + re.escape(x.lower()) + r"(?![\w])", low)
               for x in names if x):
            out.append({k: n[k] for k in ("id", "label", "type", "description", "in_corpus", "calls")})
    return out


# --- the audit trail ----------------------------------------------------------


def trail_rows(calls: list[dict], log: list[dict], claims: list[dict]) -> list[dict]:
    """The investigation in order, each call annotated with what it
    contributed. A retrieval nothing was cited from is still listed: what the
    agent looked at and set aside is part of how it concluded."""
    contributed: dict[int, dict[str, set]] = {}
    for c in claims:
        if c.get("evidence_inherited"):
            continue  # a rating rests on its deviations; count the quote once
        for ev in c.get("evidence") or []:
            for r in ev["retrievals"]:
                contributed.setdefault(r["call"], {}).setdefault(ev["chunk_id"], set()).add(c["ref"])
        # A graph fact's nodes and edges count for the calls that returned them.
        for g in c.get("graph_facts") or []:
            for i in g.get("calls") or []:
                contributed.setdefault(i, {}).setdefault("graph", set()).add(c["ref"])
    out = []
    for e in log:
        kind = e.get("kind")
        row = {"seq": e.get("seq"), "at": e.get("at"), "kind": kind, "stage": e.get("stage", ""),
               "note": e.get("note", ""), "title": e.get("title") or "",
               "text": (e.get("text") or "")[:1500]}
        if kind == "tool_call" and e.get("call") is not None:
            i = int(e["call"])
            c = calls[i] if i < len(calls) else {}
            t = c.get("trace") or {}
            returned = [str(h.get("chunk_id")) for h in t.get("hits") or []]
            used = contributed.get(i, {})
            row.update({
                "call": i, "tool": e.get("tool"), "engine": e.get("engine"),
                "summary": e.get("summary") or "", "error": e.get("error"), "ms": e.get("ms"),
                "query": t.get("query", ""), "returned": len(returned) or len(t.get("nodes") or []),
                "cited_chunks": len([k for k in used if k != "graph"]) + (1 if "graph" in used else 0),
                "supports": sorted({ref for refs in used.values() for ref in refs}),
                "source": (c.get("sources") or {}).get("label", ""),
            })
        out.append(row)
    return out


def graph_entity_count(idx: dict) -> int:
    """Knowledge-graph entities the run looked up; register processes excluded."""
    return sum(1 for n in idx["nodes"].values() if not n.get("register"))

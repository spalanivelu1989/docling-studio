"""How an Evidence Agent answer was arrived at, and how to check it.

The answer is a set of claims. Each claim carries passages (a quote, a chunk
id, a stance) and graph facts (a statement, the node and edge ids it rests
on), and a score the server computed from a rule a reader can re-run. The run
also keeps every tool call with what it returned, and the log of the
investigation in order.

This module joins those records, using the checks shared with the Fit-Gap
Copilot (fitgap/lineage.py), so that for each claim a reader can see:

  - every passage, the call that retrieved its chunk (query, rank, fusion
    score and the two ranks behind it), and whether the quote really is in
    the text that call returned;
  - every graph fact, and whether each node and edge it names was actually
    returned by a graph call this run -- the graph equivalent of the quote
    check, since a fact about a relation nobody looked up is not evidence;
  - the reasoning the agent was following when it made those calls;
  - the score, term by term;

and for the answer as a whole: which claim governs the confidence, what the
run remembered from earlier investigations (which steered it but is not
evidence), what it wrote back, and the audit trail of every step.

Computed from the stored run when it is read; nothing is stored.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fitgap.lineage import (check_evidence, graph_mentions, index_calls,  # noqa: E402
                            intents_for, quote_checks, record_completeness, trail_rows, graph_entity_count)

from .schemas import STATE_BLURB  # noqa: E402

STANCE_LABEL = {"supports": "supports", "opposes": "opposes", "context": "context"}


def _graph_facts(facts: list[dict], idx: dict) -> tuple[list[dict], set]:
    """Each graph fact with its nodes and edges resolved, and whether the
    calls of this run actually returned them."""
    out, calls_used = [], set()
    for g in facts or []:
        nodes, edges, calls = [], [], set()
        for nid in g.get("node_ids") or []:
            n = idx["nodes"].get(nid)
            nodes.append({"id": nid, "label": (n or {}).get("label") or nid.split(":", 1)[-1],
                          "type": (n or {}).get("type") or nid.split(":", 1)[0],
                          "calls": (n or {}).get("calls") or [], "seen": bool(n)})
            calls |= set((n or {}).get("calls") or [])
        for eid in g.get("edge_ids") or []:
            e = idx["edges"].get(eid)
            edges.append({"id": eid, "relation": (e or {}).get("relation") or eid.rsplit(":", 1)[-1],
                          "source": (e or {}).get("source") or "", "target": (e or {}).get("target") or "",
                          "calls": (e or {}).get("calls") or [], "seen": bool(e),
                          # The passages the relationship was extracted from, as
                          # the graph call returned them (runs before the graph
                          # kept them have none).
                          "chunks": (e or {}).get("chunks") or []})
            calls |= set((e or {}).get("calls") or [])
        calls_used |= calls
        seen = sum(x["seen"] for x in nodes + edges)
        out.append({
            "statement": g.get("statement", ""), "meaningful": g.get("meaningful", True),
            "note": g.get("note", ""), "nodes": nodes, "edges": edges, "calls": sorted(calls),
            "confirmed": seen, "total": len(nodes) + len(edges),
        })
    return out, calls_used


def _claim(i: int, c: dict, idx: dict, governing: str) -> dict:
    ref = f"C{i}"
    ev, calls_used = check_evidence(c.get("sources"), idx, keep=("stance", "provenance_note"))
    for e, src in zip(ev, c.get("sources") or []):
        e["side"] = ""
        e["server_verified"] = src.get("verified")
        e["provenance"] = src.get("provenance") or []
    facts, graph_calls = _graph_facts(c.get("graph_facts"), idx)
    calls_used |= graph_calls

    support = [e for e in ev if e.get("stance") == "supports"]
    checks = quote_checks(ev, none_detail="no passage; the claim rests on graph facts alone" if facts
                          else "no passage and no graph fact")
    if not ev and facts:
        checks = checks[:1]
        checks[0]["ok"] = True
    if facts:
        confirmed = sum(f["confirmed"] for f in facts)
        total = sum(f["total"] for f in facts)
        checks.append({"check": "Every graph node and edge it names was returned by a graph call",
                       "ok": confirmed == total,
                       "detail": f"{confirmed} of {total} seen in this run's graph calls"
                                 + (" — this run kept no graph results" if not idx["nodes"] else "")})
        if any(not f["meaningful"] for f in facts):
            checks.append({"check": "Graph routes are meaningful", "ok": False,
                           "detail": "the agent flagged a route as an artefact of how the graph is built"})
    if ev and not support:
        checks.append({"check": "Carries a supporting passage", "ok": False,
                       "detail": "every passage is context or opposes; the claim frames rather than asserts"})

    ok = all(k["ok"] for k in checks)
    status = "untraced" if not ev and not facts else "traced" if ok else "partial"
    terms = c.get("score_terms") or []
    derivation = [{"what": t.get("rule", ""),
                   "value": (f"cap {t['cap']}" if t.get("cap") is not None else
                             f"{t.get('delta', 0):+g}"),
                   "how": t.get("detail", "")} for t in terms]
    derivation.append({"what": "score", "value": c.get("score"),
                       "how": f"{c.get('independent_sources', 0)} independent source(s)"
                              + (" · this is the weakest supported claim, so it sets the answer's confidence"
                                 if ref == governing else "")})
    return {
        "kind": "claim", "ref": ref, "title": c.get("text", ""), "stage": "",
        "statement": c.get("note", ""), "status": status, "checks": checks,
        "sides": [], "evidence": ev, "calls": sorted(calls_used),
        "intents": intents_for(calls_used, idx), "reasoning": [], "sendbacks": [],
        "graph": graph_mentions(c.get("text", ""), idx) if not facts else [],
        "graph_facts": facts, "derivation": derivation,
        "score": c.get("score"), "governs": ref == governing,
    }


def build(run: dict) -> dict:
    calls = run.get("calls") or []
    log = run.get("log") or []
    answer = run.get("answer") or {}
    idx = index_calls(calls, log)
    raw = answer.get("claims") or []

    # The answer's confidence is its weakest load-bearing claim (schemas.py).
    bearing = [(i, c) for i, c in enumerate(raw, 1)
               if any(s.get("stance") == "supports" for s in c.get("sources") or [])]
    governing = f"C{min(bearing, key=lambda x: x[1].get('score', 0))[0]}" if bearing else ""
    claims = [_claim(i, c, idx, governing) for i, c in enumerate(raw, 1)]

    trail = trail_rows(calls, log, claims)
    memory = run.get("memory") or {}
    record, missing = record_completeness(calls)
    quotes = [e for c in claims for e in c["evidence"]]
    st = [q["verification"]["status"] for q in quotes]
    facts = [f for c in claims for f in c["graph_facts"]]
    engines: dict[str, int] = {}
    for c in calls:
        engines[c.get("engine") or "other"] = engines.get(c.get("engine") or "other", 0) + 1
    by_status: dict[str, int] = {}
    for c in claims:
        by_status[c["status"]] = by_status.get(c["status"], 0) + 1

    return {
        "run_id": run.get("id"),
        "claims": claims,
        "trail": trail,
        "answer": {
            "question": run.get("question") or answer.get("question", ""),
            "state": answer.get("state") or run.get("state", ""),
            "state_blurb": STATE_BLURB.get(answer.get("state") or "", ""),
            "text": answer.get("answer", ""),
            "confidence": min((c.get("score", 0) for _, c in bearing), default=0.0) if bearing else None,
            "governing": governing,
            "open_questions": answer.get("open_questions") or [],
            "limits": answer.get("limits") or [],
            "memory": {
                "enabled": memory.get("enabled"), "used": memory.get("used"),
                "suppressed": memory.get("suppressed_by_holdout"),
                "recalled": [{"text": m.get("text", ""), "type": m.get("type", "")}
                             for m in memory.get("memories") or []],
                "retained": next(((e.get("text") or "")[:1500] for e in log
                                  if e.get("kind") == "note" and e.get("note") == "retained"), ""),
            },
        },
        "summary": {
            "claims": len(claims), "by_status": by_status,
            "quotes": len(quotes), "verbatim": st.count("verbatim"), "partial": st.count("partial"),
            "not_found": st.count("not_found"), "not_retrieved": st.count("not_retrieved"),
            "unrecorded": st.count("unrecorded"),
            "calls": len(calls), "engines": engines,
            "contributing_calls": len({i for c in claims for i in c["calls"]}),
            "chunks_retrieved": len(idx["hits"]),
            "chunks_cited": len({q["chunk_id"] for q in quotes}),
            "documents_cited": len({q["doc"] for q in quotes}),
            "graph_entities": graph_entity_count(idx),
            "graph_entities_mentioned": len({n["id"] for f in facts for n in f["nodes"]
                                             if n["seen"] and not idx["nodes"][n["id"]].get("register")}),
            "graph_facts": len(facts),
            "graph_facts_confirmed": sum(1 for f in facts if f["confirmed"] == f["total"]),
            "sendbacks": sum(1 for e in log if e.get("note") == "rejected"),
            "gate_issues": 0,
            "record": record, "calls_without_results": missing,
        },
        "context": {
            "model": run.get("model"), "prompt_hash": run.get("prompt_hash"),
            "corpus_fingerprint": run.get("corpus_fingerprint"),
            "categories": run.get("categories") or [], "scope": "",
            "template_process": "", "started_at": run.get("started_at"),
            "finished_at": run.get("finished_at"),
            "not_checked": ["Whether a claim follows from its passages is a human judgement"],
        },
    }


# --- the audit file -----------------------------------------------------------

_MARK = {"verbatim": "✓ verbatim", "partial": "~ partial", "not_found": "✗ not found",
         "unrecorded": "? call results not kept", "not_retrieved": "✗ not retrieved", "empty": "✗ empty"}


def _cell(s) -> str:
    return str(s if s is not None else "").replace("|", "\\|").replace("\n", " ")


def to_markdown(run: dict, lin: dict) -> str:
    a, s, ctx = lin["answer"], lin["summary"], lin["context"]
    out = [f"# Audit trail — {a['question']}", "",
           f"Run `{run.get('id')}` · model `{ctx['model']}` · prompt `{ctx['prompt_hash']}` · "
           f"corpus `{ctx['corpus_fingerprint']}` · {ctx['started_at']} → {ctx['finished_at']}", "",
           f"**Answer ({a['state']}):** {a['text']}", "",
           f"Confidence {a['confidence']} — set by the weakest supported claim, {a['governing'] or '—'}.", "",
           "## How to validate", "",
           "For every passage: the chunk id, the call that retrieved it (numbered as in the trail), "
           "the query and rank, and whether the quote is in the text that call returned. For every graph "
           "fact: whether each node and edge it names was returned by a graph call. Open the chunk in the "
           "corpus by its id to check it independently.", "",
           "## Summary", "",
           f"- Claims: {s['claims']} — " + ", ".join(f"{v} {k}" for k, v in s["by_status"].items()),
           f"- Passages: {s['quotes']} — {s['verbatim']} verbatim, {s['partial']} partial, "
           f"{s['not_found']} not found, {s['not_retrieved']} not retrieved, {s['unrecorded']} not checkable",
           f"- Graph facts: {s['graph_facts']}, {s['graph_facts_confirmed']} with every node and edge seen in a call",
           f"- Tool calls: {s['calls']} (" + ", ".join(f"{k} {v}" for k, v in s["engines"].items())
           + f"); {s['contributing_calls']} supplied evidence",
           f"- Chunks: {s['chunks_retrieved']} retrieved, {s['chunks_cited']} cited from {s['documents_cited']} document(s)",
           f"- Send-backs: {s['sendbacks']}", ""]
    if a["memory"]["recalled"]:
        out += ["## Recalled from earlier investigations (not evidence)", ""]
        out += [f"- ({m['type']}) {_cell(m['text'])}" for m in a["memory"]["recalled"]] + [""]
    out += ["## Claims", ""]
    for c in lin["claims"]:
        out += [f"### {c['ref']} — {c['status']} · score {c['score']}{' · governs confidence' if c['governs'] else ''}",
                "", c["title"], ""]
        out += [f"- {'✓' if k['ok'] else '✗'} {k['check']} — {k['detail']}" for k in c["checks"]]
        out += [f"- **{d['what']}** {d['value']} — {d['how']}" for d in c["derivation"]]
        out.append("")
        if c["evidence"]:
            out += ["| # | Stance | Chunk | Document › section | Retrieved by | Check | Quote |",
                    "|---|---|---|---|---|---|---|"]
            for n, e in enumerate(c["evidence"], 1):
                r = e["retrievals"][0] if e["retrievals"] else None
                how = (f"call {r['call'] + 1} `{r['tool']}` “{_cell(r['query'])[:80]}” rank {r['rank']}"
                       if r else "—")
                out.append(f"| {n} | {e.get('stance')} | `{e['chunk_id']}` | {_cell(e['doc'])} › "
                           f"{_cell(e['heading_path'])} | {how} | {_MARK.get(e['verification']['status'])} | "
                           f"{_cell(e['quote'])[:300]} |")
            out.append("")
        for f in c["graph_facts"]:
            out.append(f"- Graph fact: {_cell(f['statement'])} — {f['confirmed']}/{f['total']} seen in calls "
                       + ", ".join(str(x + 1) for x in f["calls"]))
            out += [f"  - edge `{e['relation']}` {e['source']} → {e['target']} {'✓' if e['seen'] else '✗ not seen'}"
                    + (f" — extracted from {', '.join(e['chunks'])}" if e.get("chunks") else "")
                    for e in f["edges"]]
        for it in c["intents"]:
            out.append(f"> Reasoning before calls {', '.join(str(x + 1) for x in it['calls'])}: {_cell(it['text'])}")
        out.append("")
    if a["open_questions"] or a["limits"]:
        out += ["## Open questions and limits", ""]
        out += [f"- Open: {_cell(q)}" for q in a["open_questions"]]
        out += [f"- Limit: {_cell(q)}" for q in a["limits"]] + [""]
    out += ["## Investigation trail", "",
            "| # | Step | What | Returned | Cited | Supports |", "|---|---|---|---|---|---|"]
    for t in lin["trail"]:
        if t["kind"] == "tool_call":
            out.append(f"| {t['call'] + 1} | `{t['tool']}` ({t.get('engine')}) | {_cell(t['summary'])[:120]} | "
                       f"{t['returned']} | {t['cited_chunks']} | {', '.join(t['supports'])} |")
        else:
            out.append(f"|  | {t['kind']}{(' · ' + t['note']) if t.get('note') else ''} | "
                       f"{_cell(t['title'] or t['text'])[:240]} |  |  |  |")
    return "\n".join(out) + "\n"

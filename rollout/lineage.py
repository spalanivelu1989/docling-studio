"""How each finding of a Fit-Gap run was arrived at, and how to check it.

A run already keeps everything needed to answer "where did this come from?",
in three places that do not point at each other:

  calls     every tool call, with a trace of what it returned -- the ranked
            passages of a retrieval, the nodes and edges of a graph walk, the
            slice of the BPML hierarchy that was read;
  log       the investigation in the order it happened -- the context each
            pass was handed, the agent's reasoning between calls, submissions
            the verifier sent back, the quality gates;
  analysis  the findings, each carrying quotes that name the chunk they were
            taken from.

This module joins them. It is a pure function of a stored run, computed when
it is read, so it works for every run already in the database and cannot
drift from the record it describes.

For each claim -- an As-Is step, a deviation, a fit area, a localization
item, a dimension rating, a backlog candidate -- it answers:

  - which quotes support it, and for each one, which call retrieved that
    chunk, with what query, at what rank and score;
  - whether the quote really is in the text the call returned. This is the
    check a reader cannot easily do by hand, and the one that separates "the
    agent read this" from "the agent says it read this";
  - what the agent was reasoning when it made those calls;
  - which knowledge-graph entities the investigation consulted that the claim
    names;
  - which send-backs and quality gates touched it, and how its computed
    numbers were derived;
  - what the workshop later decided about it.

And for the run as a whole, an audit trail: every step in order, with what
each retrieval contributed to the findings and what it did not.

Matching a graph entity to a claim is done on the entity's name appearing in
the claim's text. That is a mention, not a citation -- the agent does not
cite graph nodes -- and the output says so rather than presenting it as one.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from .schemas import DIMENSIONS  # noqa: E402

from fitgap.lineage import (INTENT_CHARS, check_evidence, graph_mentions,  # noqa: E402
                            index_calls, intents_for, mentions, quote_checks,
                            record_completeness, trail_rows, graph_entity_count, verify_quote)

__all__ = ["build", "to_markdown", "verify_quote"]


def _claim(kind: str, ref: str, title: str, text: str, evidence: list[dict], idx: dict,
           log: list[dict], stage: str, *, requires_two_sides: bool = False,
           extra: dict | None = None) -> dict:
    ev, calls_used = check_evidence(evidence, idx)
    intents = intents_for(calls_used, idx)
    reasoning = [{"seq": e.get("seq"), "text": (e.get("text") or "")[:INTENT_CHARS]}
                 for e in log if e.get("kind") == "thinking" and mentions(ref, e.get("text", ""))]
    sendbacks = [{"seq": e.get("seq"), "title": e.get("title", ""), "text": (e.get("text") or "")[:INTENT_CHARS]}
                 for e in log if e.get("kind") == "note" and e.get("note") == "rejected"
                 and mentions(ref, e.get("text", ""))]

    sides = sorted({e["side"] for e in ev if e["side"]})
    checks = quote_checks(ev)
    if requires_two_sides:
        # A deviation is a difference between two named sources.
        ok = len(set(sides) - {"localization"}) >= 2
        checks.append({"check": "Both sides of the comparison are quoted", "ok": ok,
                       "detail": "sides quoted: " + (", ".join(sides) or "none")
                                 + ("" if ok else " — the other side's position is stated, not quoted "
                                                  "(often a template that is silent on the point)")})

    if not ev:
        status = "untraced"
    elif all(c["ok"] for c in checks):
        status = "traced"
    else:
        status = "partial"

    return {
        "kind": kind, "ref": ref, "title": title, "stage": stage,
        "status": status, "checks": checks, "sides": sides,
        "evidence": ev,
        "calls": sorted(calls_used),
        "intents": intents,
        "reasoning": reasoning,
        "sendbacks": sendbacks,
        "graph": graph_mentions(text, idx),
        **(extra or {}),
    }


# --- the run ------------------------------------------------------------------


def build(run: dict) -> dict:
    calls = run.get("calls") or []
    log = run.get("log") or []
    analysis = run.get("analysis") or {}
    asis = run.get("asis") or {}
    gates = (run.get("gates") or {}).get("items") or []
    decisions = run.get("decisions") or []
    idx = index_calls(calls, log, (run.get("sources") or {}).get("chunks") or {})
    claims: list[dict] = []

    for s in asis.get("steps") or []:
        text = " ".join(str(s.get(k) or "") for k in ("name", "action", "actor", "system", "business_rule",
                                                     "decision", "control", "output", "exception"))
        claims.append(_claim("asis_step", str(s.get("step_id", "")), s.get("name", ""), text,
                             s.get("evidence"), idx, log, "asis",
                             extra={"statement": s.get("action", ""),
                                    "confidence": s.get("confidence", "")}))

    devs = analysis.get("deviations") or []
    for d in devs:
        gid = d.get("gap_id", "")
        text = " ".join(str(d.get(k) or "") for k in ("as_is_statement", "gt_statement", "exact_difference",
                                                     "sap_bp_reference", "decision_question", "why_discussed"))
        terms = d.get("harmonization_terms") or {}
        derivation = [
            {"what": "Materiality", "value": d.get("materiality"),
             "how": "rated by the agent; " + ", ".join(f"{i.get('area')} {i.get('score')}/5"
                                                      for i in d.get("impacts") or []) or "rated by the agent"},
            {"what": "GT fit", "value": f"{d.get('gt_fit_rating')}/4", "how": "rated by the agent"},
            {"what": "SAP BP fit",
             "value": "n/a" if d.get("sap_bp_fit_rating") is None else f"{d.get('sap_bp_fit_rating')}/4",
             "how": "rated by the agent" if d.get("sap_bp_fit_rating") is not None else "no SAP source rated"},
            {"what": "Standardisation outlook", "value": terms.get("value", d.get("harmonization_potential")),
             "how": terms.get("formula") or "the agent's estimate (run predates the computed rule)"},
            {"what": "Workshop", "value": d.get("workshop_bucket"),
             "how": d.get("why_discussed") or "assigned by the agent"},
        ]
        claims.append(_claim(
            "deviation", gid, d.get("exact_difference", ""), text, d.get("evidence"), idx, log, "compare",
            requires_two_sides=True,
            extra={
                "statement": d.get("exact_difference", ""),
                "as_is_statement": d.get("as_is_statement", ""),
                "gt_statement": d.get("gt_statement", ""),
                "sap_bp_reference": d.get("sap_bp_reference"),
                "as_is_step_id": d.get("as_is_step_id", ""),
                "dimension": d.get("dimension"),
                "disposition": d.get("candidate_disposition"),
                "localization_state": d.get("localization_state"),
                "standard_options_considered": d.get("standard_options_considered") or [],
                "derivation": derivation,
                "gates": [g for g in gates if g.get("gap_id") == gid],
                "decisions": [{k: x.get(k) for k in ("verdict", "option_text", "rationale", "decided_by",
                                                     "decided_at", "is_current", "reviewer", "comment")}
                              for x in decisions if x.get("gap_id") == gid],
                "open_questions": d.get("open_questions") or [],
            }))

    for i, f in enumerate(analysis.get("fit_areas") or [], 1):
        claims.append(_claim("fit_area", f"FIT-{i}", f.get("statement", ""), f.get("statement", ""),
                             f.get("evidence"), idx, log, "compare",
                             extra={"statement": f.get("statement", ""),
                                    "as_is_step_id": f.get("as_is_step_id", ""),
                                    "gt_step_ref": f.get("gt_step_ref", "")}))

    for i, item in enumerate(analysis.get("localization") or [], 1):
        text = " ".join(str(item.get(k) or "") for k in ("topic", "requirement", "sap_capability",
                                                        "gt_capability", "as_is_handling"))
        claims.append(_claim("localization", f"LOC-{i}", item.get("topic", ""), text,
                             item.get("evidence"), idx, log, "compare",
                             extra={"statement": item.get("requirement", ""),
                                    "localization_status": item.get("status")}))

    by_dim: dict[str, list[str]] = {}
    for d in devs:
        by_dim.setdefault(d.get("dimension", ""), []).append(d.get("gap_id", ""))
    for r in analysis.get("dimension_ratings") or []:
        name, weight = DIMENSIONS.get(r.get("dimension", ""), (r.get("dimension", ""), 0))
        supporting = by_dim.get(r.get("dimension", ""), [])
        ev = [e for d in devs if d.get("dimension") == r.get("dimension") for e in d.get("evidence") or []]
        c = _claim("dimension", r.get("dimension", ""), name, r.get("note", ""), ev, idx, log, "compare",
                   extra={"statement": r.get("note", ""), "supported_by": supporting,
                          "derivation": [
                              {"what": "GT rating", "value": f"{r.get('gt_rating')}/4", "how": "rated by the agent"},
                              {"what": "SAP BP rating",
                               "value": "n/a" if r.get("sap_bp_rating") is None else f"{r.get('sap_bp_rating')}/4",
                               "how": "rated by the agent"},
                              {"what": "Weight", "value": f"{round(weight * 100)}%",
                               "how": "fixed by the specification (§12.1)"},
                              {"what": "Contribution to GT alignment",
                               "value": round((r.get("gt_rating") or 0) / 4 * weight * 100, 1),
                               "how": f"{r.get('gt_rating')}/4 × {round(weight * 100)}% × 100"},
                          ]})
        # A rating rests on its deviations' evidence; it has none of its own.
        c["evidence_inherited"] = True
        if not supporting:
            c["status"] = "untraced" if (r.get("gt_rating") or 4) < 4 else "traced"
            c["checks"] = [{"check": "Rests on recorded deviations", "ok": (r.get("gt_rating") or 4) >= 3,
                            "detail": "no deviation on this dimension; the rating says it aligns"}]
        claims.append(c)

    for i, b in enumerate(analysis.get("backlog") or [], 1):
        src = next((c for c in claims if c["kind"] == "deviation" and c["ref"] == b.get("gap_id")), None)
        claims.append({
            "kind": "backlog", "ref": f"BL-{i}", "title": b.get("title", ""), "stage": "compare",
            "statement": b.get("requirement", ""), "status": src["status"] if src else "untraced",
            "checks": [{"check": "Derived from an evidenced deviation", "ok": bool(src),
                        "detail": (f"from {b.get('gap_id')}, which is "
                                   f"{'fully' if src['status'] == 'traced' else 'partly'} traced")
                                  if src else "names no deviation of this run"}],
            "sides": [], "evidence": [], "calls": src["calls"] if src else [], "intents": [],
            "reasoning": [], "sendbacks": [], "graph": [], "supported_by": [b.get("gap_id")] if src else [],
        })

    return {
        "run_id": run.get("id"),
        "claims": claims,
        "trail": _trail(run, calls, log, claims),
        "summary": _summary(calls, claims, idx, run),
        "context": {
            "model": run.get("model"), "prompt_hash": run.get("prompt_hash"),
            "corpus_fingerprint": run.get("corpus_fingerprint"),
            "categories": run.get("categories") or [], "scope": run.get("scope_label") or run.get("scope_bpml"),
            "template_process": analysis.get("template_process", ""),
            "started_at": run.get("started_at"), "finished_at": run.get("finished_at"),
            "not_checked": (run.get("gates") or {}).get("not_checked") or [],
        },
    }


def _trail(run: dict, calls: list[dict], log: list[dict], claims: list[dict]) -> list[dict]:
    """The investigation in order, each call annotated with what it
    contributed. A retrieval nothing was cited from is still listed: what the
    agent looked at and set aside is part of how it concluded."""
    out = trail_rows(calls, log, claims)
    # After the log: the arithmetic and the people, which the log does not hold.
    scores = run.get("scores") or {}
    if scores:
        out.append({"seq": None, "kind": "scoring", "title": "Scores computed from the ratings",
                    "text": (f"GT alignment {scores.get('gt_alignment')}/100 from the seven dimension ratings "
                             f"and their fixed weights; Standardisation outlook "
                             f"{scores.get('harmonization_potential')} from each deviation's disposition, "
                             f"localization state and GT fit. "
                             + (scores.get("harmonization_rule") or "")).strip()})
    for d in sorted(run.get("decisions") or [], key=lambda x: str(x.get("decided_at") or "")):
        out.append({"seq": None, "kind": "decision", "at": d.get("decided_at"),
                    "title": f"Workshop: {d.get('gap_id')} {d.get('verdict')}"
                             + (f" — {d.get('option_text')}" if d.get("option_text") else ""),
                    "text": d.get("rationale") or "", "by": d.get("decided_by") or d.get("reviewer"),
                    "supports": [d.get("gap_id")]})
    return out


def _summary(calls: list[dict], claims: list[dict], idx: dict, run: dict) -> dict:
    quotes = [e for c in claims if c["kind"] not in ("dimension", "backlog") for e in c["evidence"]]
    st = [q["verification"]["status"] for q in quotes]
    contributing = {r["call"] for q in quotes for r in q["retrievals"]}
    engines: dict[str, int] = {}
    for c in calls:
        engines[c.get("engine") or "other"] = engines.get(c.get("engine") or "other", 0) + 1
    graph_linked = {g["id"] for c in claims for g in c.get("graph") or []}
    by_status: dict[str, int] = {}
    for c in claims:
        by_status[c["status"]] = by_status.get(c["status"], 0) + 1
    src = run.get("sources") or {}
    return {
        "claims": len(claims), "by_status": by_status,
        "quotes": len(quotes), "verbatim": st.count("verbatim"), "partial": st.count("partial"),
        "not_found": st.count("not_found"), "not_retrieved": st.count("not_retrieved"),
        "unrecorded": st.count("unrecorded"),
        # A run recorded before calls kept their results can be traced only
        # as far as its source index; the page says so rather than implying
        # the agent read nothing.
        "calls_without_results": record_completeness(calls)[1],
        "record": record_completeness(calls)[0],
        "calls": len(calls), "engines": engines,
        "contributing_calls": len(contributing),
        "chunks_retrieved": len(idx["hits"]) or src.get("retrieved_total"),
        "chunks_cited": len({q["chunk_id"] for q in quotes}),
        "documents_cited": len({q["doc"] for q in quotes}),
        "graph_entities": graph_entity_count(idx), "graph_entities_mentioned": len(graph_linked),
        "sendbacks": sum(1 for e in run.get("log") or [] if e.get("note") == "rejected"),
        "gate_issues": len((run.get("gates") or {}).get("items") or []),
    }


# --- the audit file -----------------------------------------------------------

_KIND = {"asis_step": "As-Is step", "deviation": "Deviation", "fit_area": "Fit area",
         "localization": "Localization", "dimension": "Dimension rating", "backlog": "Backlog candidate"}
_MARK = {"verbatim": "✓ verbatim", "partial": "~ partial", "not_found": "✗ not found",
         "unrecorded": "? call results not kept",
         "not_retrieved": "✗ not retrieved", "empty": "✗ empty"}


def _cell(s) -> str:
    return str(s if s is not None else "").replace("|", "\\|").replace("\n", " ")


def to_markdown(run: dict, lin: dict) -> str:
    s, ctx = lin["summary"], lin["context"]
    out = [f"# Audit trail — {run.get('scope_label') or run.get('scope_bpml') or 'Fit-Gap run'}"
           f"{' · ' + run['country'] if run.get('country') else ''}", "",
           f"Run `{run.get('id')}` · model `{ctx['model']}` · prompt `{ctx['prompt_hash']}` · "
           f"corpus `{ctx['corpus_fingerprint']}` · {ctx['started_at']} → {ctx['finished_at']}", "",
           "## How to validate", "",
           "Each claim below lists its quotes. For every quote: the chunk id, the tool call that "
           "retrieved it (by number, matching the trail), the query, the rank, and whether the quote "
           "appears in the text that call returned. Open the chunk in the corpus by its id to check it "
           "independently.", "",
           *(["> This run was recorded before the investigation log was kept: its quotes can be read "
               "but not traced to the calls that retrieved them.", ""] if s["record"] == "none" else
             ["> Some retrieval calls of this run did not keep their results; quotes from them are checked "
              "against the run's source index where it holds them.", ""] if s["record"] == "partial" else []),
           "## Summary", "",
           f"- Claims: {s['claims']} — " + ", ".join(f"{v} {k}" for k, v in s["by_status"].items()),
           f"- Quotes: {s['quotes']} — {s['verbatim']} verbatim, {s['partial']} partial, "
           f"{s['not_found']} not found, {s['not_retrieved']} not retrieved, "
           f"{s['unrecorded']} not checkable (call results not kept)",
           f"- Tool calls: {s['calls']} (" + ", ".join(f"{k} {v}" for k, v in s["engines"].items())
           + f"); {s['contributing_calls']} contributed cited evidence",
           f"- Chunks: {s['chunks_retrieved']} retrieved, {s['chunks_cited']} cited from "
           f"{s['documents_cited']} document(s)",
           f"- Knowledge graph: {s['graph_entities']} entities consulted, "
           f"{s['graph_entities_mentioned']} named in findings",
           f"- Send-backs: {s['sendbacks']} · gate issues: {s['gate_issues']}",
           *(f"- Not checked by the system: {n}" for n in ctx["not_checked"]), ""]

    out += ["## Claims", ""]
    for c in lin["claims"]:
        out += [f"### {_KIND.get(c['kind'], c['kind'])} {c['ref']} — {c['status']}", "",
                f"{c.get('title') or ''}", ""]
        for ch in c["checks"]:
            out.append(f"- {'✓' if ch['ok'] else '✗'} {ch['check']} — {ch['detail']}")
        for d in c.get("derivation") or []:
            out.append(f"- **{d['what']}**: {d['value']} — {d['how']}")
        if c.get("supported_by"):
            out.append(f"- Rests on: {', '.join(c['supported_by'])}")
        out.append("")
        if c["evidence"] and not c.get("evidence_inherited"):
            out += ["| # | Side | Chunk | Document › section | Retrieved by | Check | Quote |",
                    "|---|---|---|---|---|---|---|"]
            for n, e in enumerate(c["evidence"], 1):
                r = e["retrievals"][0] if e["retrievals"] else None
                how = (f"call {r['call'] + 1} `{r['tool']}` “{_cell(r['query'])[:80]}” rank {r['rank']}"
                       if r else "—")
                out.append(f"| {n} | {e['side']} | `{e['chunk_id']}` | {_cell(e['doc'])} › "
                           f"{_cell(e['heading_path'])} | {how} | {_MARK.get(e['verification']['status'])} | "
                           f"{_cell(e['quote'])[:300]} |")
            out.append("")
        for it in c["intents"]:
            out.append(f"> Reasoning before calls {', '.join(str(x + 1) for x in it['calls'])}: {_cell(it['text'])}")
        if c["intents"]:
            out.append("")
        if c["graph"]:
            out.append("- Knowledge-graph entities named here: "
                       + ", ".join(f"{g['label']} ({g['type']}, call {', '.join(str(x + 1) for x in g['calls'])})"
                                   for g in c["graph"]))
        for g in c.get("gates") or []:
            out.append(f"- Gate [{g.get('severity')}] {g.get('gate')}: {_cell(g.get('detail'))}")
        for d in c.get("decisions") or []:
            out.append(f"- Workshop: {d.get('verdict')} {d.get('option_text') or ''} — "
                       f"{_cell(d.get('rationale'))} ({d.get('decided_by') or d.get('reviewer')}, {d.get('decided_at')})")
        out.append("")

    out += ["## Investigation trail", "",
            "| # | Step | What | Returned | Cited | Supports |", "|---|---|---|---|---|---|"]
    for t in lin["trail"]:
        if t["kind"] == "tool_call":
            out.append(f"| {t['call'] + 1} | `{t['tool']}` ({t.get('engine')}) | {_cell(t['summary'])[:120]} | "
                       f"{t['returned']} | {t['cited_chunks']} | {', '.join(t['supports'])} |")
        elif t["kind"] in ("thinking",):
            out.append(f"|  | reasoning | {_cell(t['text'])[:240]} |  |  |  |")
        else:
            out.append(f"|  | {t['kind']}{(' · ' + t['note']) if t.get('note') else ''} | "
                       f"{_cell(t['title'] or t['text'])[:240]} |  |  | {', '.join(t.get('supports') or [])} |")
    return "\n".join(out) + "\n"

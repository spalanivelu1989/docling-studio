"""Checks every claim in a submitted entry against what the agent actually saw.

This is the load-bearing part of "AI proposes, humans decide": a reviewer can
only trust a register if a quote is provably in the document it names. Hard
failures are repaired rather than reported and left in place -- bad evidence is
dropped, and an entry left without support falls back to UNKNOWN.
"""

from __future__ import annotations

import re
import unicodedata

from . import bpml, tools
from .schemas import (MODE_A_CLASSES, MODE_B_CLASSES, Evidence, FitGapEntry, VerifiedEntry,
                      VerifyIssue)

_WS = re.compile(r"\s+")


def normalise(text: str) -> str:
    """Match quotes the way a reader would: the agent re-types a quote out of a
    Markdown table and loses a run of spaces or gains a curly apostrophe."""
    t = unicodedata.normalize("NFKD", text or "")
    t = (t.replace("’", "'").replace("‘", "'")
          .replace("“", '"').replace("”", '"')
          .replace("–", "-").replace("—", "-").replace(" ", " "))
    return _WS.sub(" ", t).strip().lower()


def quote_in_chunk(quote: str, chunk_text: str) -> bool:
    q, c = normalise(quote), normalise(chunk_text)
    if not q:
        return False
    if q in c:
        return True
    # A quote that spans a table row loses its pipes and padding in one copy
    # and not the other; compare on words alone before calling it invented.
    qw = _WS.sub(" ", re.sub(r"[^\w\s]", " ", q)).strip()
    cw = _WS.sub(" ", re.sub(r"[^\w\s]", " ", c)).strip()
    return bool(qw) and qw in cw


def _independent_docs(evidence: list[Evidence]) -> set[str]:
    return {e.doc for e in evidence if e.supports == "for"}


def expected_confidence(entry: FitGapEntry, session: tools.Session) -> float | None:
    """Re-run the §6 rubric arithmetic. Returns None when the rubric does not
    pin a value (no supporting evidence at all)."""
    supporting = [e for e in entry.evidence if e.supports == "for"]
    if not supporting:
        return None
    docs = _independent_docs(entry.evidence)
    score = 0.5 + 0.15 * max(len(docs) - 1, 0)
    score = min(score, 0.9)
    if any(e.supports == "against" for e in entry.evidence):
        score -= 0.2
    if not _code_appears(entry, session):
        score -= 0.1
    if _only_transcripts(entry):
        score = min(score, 0.4)
    return max(0.0, min(1.0, round(score, 2)))


def _code_appears(entry: FitGapEntry, session: tools.Session) -> bool:
    code = entry.bpml_code
    for e in entry.evidence:
        rec = session.retrieved.get(str(e.chunk_id))
        text = (rec or {}).get("full_text", "") or e.quote
        if code and code in text:
            return True
    return False


_TRANSCRIPT = re.compile(r"(transcript|meeting|minutes|mom|workshop|ws\d|call notes)", re.I)


def _only_transcripts(entry: FitGapEntry) -> bool:
    docs = _independent_docs(entry.evidence)
    return bool(docs) and all(_TRANSCRIPT.search(d) for d in docs)


def verify(result: VerifiedEntry, session: tools.Session, mode: str = "A") -> VerifiedEntry:
    entry = result.entry
    issues: list[VerifyIssue] = []
    kept: list[Evidence] = []
    repaired = False

    for e in entry.evidence:
        rec = session.retrieved.get(str(e.chunk_id))
        if rec is None:
            issues.append(VerifyIssue(
                code="chunk_not_retrieved", severity="hard",
                detail=f"chunk {e.chunk_id} was never returned by a tool in this run; evidence dropped",
            ))
            repaired = True
            continue
        if not quote_in_chunk(e.quote, rec.get("full_text", "")):
            issues.append(VerifyIssue(
                code="quote_not_in_chunk", severity="hard",
                detail=f'the quote "{e.quote[:70]}…" is not in chunk {e.chunk_id}; evidence dropped',
            ))
            repaired = True
            continue
        # Re-attach the real document name: under holdout the agent was shown a
        # masked one, and the register is read by people who need the real file.
        kept.append(e.model_copy(update={
            "doc": rec.get("true_doc") or e.doc,
            "heading_path": rec.get("true_heading_path") or e.heading_path,
        }))

    entry = entry.model_copy(update={"evidence": kept})

    # Nested evidence gets the same treatment, quietly: an impact or decision
    # point that cites nothing is still useful, one citing a fabricated quote
    # is not.
    entry = entry.model_copy(update={
        "integration_impacts": [
            i.model_copy(update={"evidence": _clean_nested(i.evidence, session, issues)})
            for i in entry.integration_impacts
        ],
        "decision_points": [
            d.model_copy(update={"evidence": _clean_nested(d.evidence, session, issues)})
            for d in entry.decision_points
        ],
    })

    if not bpml.exists(entry.bpml_code):
        issues.append(VerifyIssue(code="bpml_code_unknown", severity="hard",
                                  detail=f"{entry.bpml_code} is not a code in the BPML sheet"))

    graph_tickets = _graph_tickets()
    unknown_tickets = [t for t in entry.linked_tickets if t.upper() not in graph_tickets]
    if unknown_tickets:
        # Soft: the graph misses tickets the corpus writes as "L2C_21999"
        # rather than "SPARK-21999", so absence is not proof of invention.
        issues.append(VerifyIssue(
            code="ticket_not_in_graph", severity="soft",
            detail="not resolvable to a graph node: " + ", ".join(unknown_tickets[:6]),
        ))

    allowed = MODE_A_CLASSES if mode == "A" else MODE_B_CLASSES
    if entry.classification != "UNKNOWN" and entry.classification not in allowed:
        issues.append(VerifyIssue(
            code="class_not_in_mode", severity="soft",
            detail=f"{entry.classification} is not a Mode {mode} class",
        ))

    # Repair, in the order the floors are written in §5.
    if entry.classification != "UNKNOWN" and not entry.evidence:
        issues.append(VerifyIssue(
            code="evidence_floor", severity="hard",
            detail=f"no evidence survived verification; {entry.classification} downgraded to UNKNOWN",
        ))
        entry = entry.model_copy(update={
            "classification": "UNKNOWN", "confidence": 0.0,
            "rationale": entry.rationale + " [Downgraded to UNKNOWN: none of the cited "
                                           "quotes could be found in the chunks they named.]",
        })
        repaired = True

    expected = expected_confidence(entry, session)
    if expected is not None and abs(expected - entry.confidence) > 0.2:
        issues.append(VerifyIssue(
            code="confidence_drift", severity="soft",
            detail=f"the rubric computes {expected:.2f}, the entry claims {entry.confidence:.2f}",
        ))
    if entry.confidence >= 0.7 and len(entry.evidence) < 2:
        capped = 0.65
        issues.append(VerifyIssue(
            code="evidence_floor", severity="soft",
            detail=f"confidence {entry.confidence:.2f} on one source; capped at {capped}",
        ))
        entry = entry.model_copy(update={"confidence": capped})
        repaired = True
    if entry.classification == "UNKNOWN" and entry.confidence > 0:
        entry = entry.model_copy(update={"confidence": 0.0})

    return result.model_copy(update={"entry": entry, "issues": issues, "repaired": repaired})


def _clean_nested(evidence: list[Evidence], session: tools.Session,
                  issues: list[VerifyIssue]) -> list[Evidence]:
    out = []
    for e in evidence:
        rec = session.retrieved.get(str(e.chunk_id))
        if rec and quote_in_chunk(e.quote, rec.get("full_text", "")):
            out.append(e.model_copy(update={"doc": rec.get("true_doc") or e.doc}))
        else:
            issues.append(VerifyIssue(
                code="quote_not_in_chunk", severity="soft",
                detail=f"supporting quote on chunk {e.chunk_id} dropped from a nested item",
            ))
    return out


_tickets: set[str] | None = None


def _graph_tickets() -> set[str]:
    global _tickets
    if _tickets is None:
        import knowledge_graph

        g = knowledge_graph.extract_graph()
        _tickets = {str(n.get("ticket") or n["label"]).upper()
                    for n in g["nodes"] if n["type"] == "spec"}
    return _tickets


def summarise(results: list[VerifiedEntry]) -> dict:
    """The evidence-validity number §8 asks to be 100%."""
    total = sum(len(r.entry.evidence) for r in results)
    hard = sum(1 for r in results for i in r.issues if i.severity == "hard")
    return {
        "entries": len(results),
        "evidence_items": total,
        "hard_issues": hard,
        "soft_issues": sum(1 for r in results for i in r.issues if i.severity != "hard"),
        "entries_repaired": sum(1 for r in results if r.repaired),
        "evidence_valid_pct": 100.0 if not results else
                              round(100.0 * sum(1 for r in results if r.evidence_valid) / len(results), 1),
    }

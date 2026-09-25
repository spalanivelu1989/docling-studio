"""The support score: arithmetic over the evidence, never the model's opinion.

The agent proposes a number; this module recomputes it from what the sources
actually are and keeps its own. Two readers of the same claim therefore get the
same score, and every term is reported so the total can be checked by hand.
"""

from __future__ import annotations

from . import independence, provenance
from .schemas import Claim, ScoreTerm, Source

BASE = 0.50                 # one supporting passage
PER_EXTRA_SOURCE = 0.15     # each further independent document that agrees
GRAPH_CORROBORATION = 0.10  # the graph confirms it by a different route
CONTRADICTED = -0.25        # a retrieved passage opposes it
MACHINE_READ = -0.15        # the only support is a mostly transcribed document
CODE_ABSENT = -0.10         # an identifier in the claim appears in no chunk
CAP_DISCUSSION = 0.40       # email, minutes, transcript: discussion, not state
CAP_EXTERNAL = 0.35         # only web pages: SAP or regulatory reference, not the programme
CAP_TEMPLATE = 0.30         # blank template or unfilled boilerplate
GRAPH_ONLY = 0.35           # carried by graph structure, no passage quoted
CONTEXT_ONLY = 0.20         # only context cited: unweighted, not false
FLOOR, CEILING = 0.05, 0.95 # never certain, never zero once something supports it


def score(
    claim: Claim,
    retrieved: dict[str, dict],
    dupes: independence.Duplicates | None = None,
    identifiers: list[str] | None = None,
) -> Claim:
    """Recompute a claim's score. Returns a copy carrying the terms used."""
    dupes = dupes or independence.load()
    terms: list[ScoreTerm] = []

    supporting = [s for s in claim.sources if s.stance == "supports"]
    opposing = [s for s in claim.sources if s.stance == "opposes"]

    if not supporting:
        # A claim carried by the graph's structure rather than by a passage.
        # `meaningful` describes the PATH, not the claim: "this route is an
        # artefact" is itself a sound finding, so a flagged fact still counts.
        if claim.graph_facts:
            artefact = [f for f in claim.graph_facts if not f.meaningful]
            terms.append(ScoreTerm(
                rule="graph_only", delta=GRAPH_ONLY,
                detail="carried by the graph's structure, with no passage quoted"))
            if artefact:
                terms.append(ScoreTerm(
                    rule="about_a_flagged_route", delta=0.0,
                    detail="the graph fact concerns a route the hub filter rejected, "
                           "which is what this claim reports"))
            return _finish(claim, GRAPH_ONLY, terms, 0)

        # Context passages frame an answer without carrying it. Scoring such a
        # claim at zero reads as "false", which it is not -- it is unweighted.
        if [s for s in claim.sources if s.stance == "context"]:
            terms.append(ScoreTerm(
                rule="context_only", delta=CONTEXT_ONLY,
                detail="only context was cited; nothing here asserts the claim"))
            return _finish(claim, CONTEXT_ONLY, terms, 0)

        terms.append(ScoreTerm(rule="no_support", delta=0.0,
                               detail="nothing supports this claim"))
        return _finish(claim, 0.0, terms, 0)

    docs = [s.doc for s in supporting]
    independent = dupes.independent_count(docs)
    total = BASE
    terms.append(ScoreTerm(rule="base", delta=BASE, detail="one supporting passage"))

    if independent > 1:
        bonus = PER_EXTRA_SOURCE * (independent - 1)
        total += bonus
        terms.append(ScoreTerm(
            rule="independent_sources", delta=round(bonus, 3),
            detail=f"{independent} independent documents agree"))
    note = dupes.note_for(docs)
    if note:
        terms.append(ScoreTerm(rule="duplicates_discounted", delta=0.0, detail=note))

    if any(f.meaningful for f in claim.graph_facts):
        total += GRAPH_CORROBORATION
        terms.append(ScoreTerm(rule="graph_corroborates", delta=GRAPH_CORROBORATION,
                               detail="the knowledge graph confirms this independently"))

    if opposing:
        total += CONTRADICTED
        terms.append(ScoreTerm(
            rule="contradicted", delta=CONTRADICTED,
            detail=f"{len(opposing)} retrieved passage(s) oppose it: "
                   + "; ".join(s.doc[:42] for s in opposing[:2])))

    # --- provenance of the supporting documents ------------------------------
    provs = [_prov(s, retrieved) for s in supporting]
    provs = [p for p in provs if p is not None]

    if provs and all(p.mostly_machine_read for p in provs):
        total += MACHINE_READ
        terms.append(ScoreTerm(
            rule="machine_read", delta=MACHINE_READ,
            detail="every supporting document is mostly transcribed from pictures"))

    if any(provenance.is_boilerplate(s.quote) for s in supporting):
        terms.append(ScoreTerm(rule="boilerplate_quote", cap=CAP_TEMPLATE,
                               detail="a quote is unfilled template text, not content"))
        total = min(total, CAP_TEMPLATE)

    if provs and all(p.is_template for p in provs):
        terms.append(ScoreTerm(rule="template_only", cap=CAP_TEMPLATE,
                               detail="the only support is a blank template"))
        total = min(total, CAP_TEMPLATE)

    if provs and all(p.is_discussion for p in provs):
        terms.append(ScoreTerm(
            rule="discussion_only", cap=CAP_DISCUSSION,
            detail="the only support is an email or meeting note, which records "
                   "discussion rather than an implemented state"))
        total = min(total, CAP_DISCUSSION)

    # A web page found by the gated search says what SAP or a regulator says
    # in general. It can support a claim; it cannot say what this programme
    # decided, so a claim resting on nothing else stays below one that does.
    if all((retrieved.get(str(s.chunk_id)) or {}).get("external") for s in supporting):
        terms.append(ScoreTerm(
            rule="external_only", cap=CAP_EXTERNAL,
            detail="the only support is an external web page, not a programme document"))
        total = min(total, CAP_EXTERNAL)

    # --- did the identifiers survive into the evidence? ----------------------
    missing = _missing_identifiers(identifiers or [], supporting, retrieved)
    if missing:
        total += CODE_ABSENT
        terms.append(ScoreTerm(
            rule="identifier_absent", delta=CODE_ABSENT,
            detail=f"not found verbatim in any cited chunk: {', '.join(missing[:4])}"))

    return _finish(claim, total, terms, independent)


def _finish(claim: Claim, total: float, terms: list[ScoreTerm], independent: int) -> Claim:
    final = round(max(FLOOR if total > 0 else 0.0, min(CEILING, total)), 2)
    if total > CEILING:
        terms.append(ScoreTerm(rule="ceiling", cap=CEILING,
                               detail="no claim from this corpus is ever certain"))
    return claim.model_copy(update={
        "score": final, "score_terms": terms, "independent_sources": independent,
    })


def _prov(source: Source, retrieved: dict[str, dict]) -> provenance.Provenance | None:
    rec = retrieved.get(str(source.chunk_id))
    if not rec or not rec.get("source"):
        return None
    return provenance.of(rec["source"], rec.get("true_doc") or source.doc)


def _missing_identifiers(identifiers, supporting, retrieved) -> list[str]:
    """Codes and ticket numbers named in a claim should appear in its evidence."""
    if not identifiers:
        return []
    corpus = " ".join(
        (retrieved.get(str(s.chunk_id)) or {}).get("full_text", "") or s.quote
        for s in supporting
    )
    return [i for i in identifiers if i and i not in corpus]


def explain(claim: Claim) -> str:
    """The arithmetic as one readable line."""
    bits = []
    for t in claim.score_terms:
        if t.cap is not None:
            bits.append(f"cap {t.cap:.2f} ({t.rule})")
        elif t.delta:
            bits.append(f"{t.delta:+.2f} {t.rule}")
    return " ".join(bits) + f" = {claim.score:.2f}"

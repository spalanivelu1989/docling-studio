"""The quality gates (§25), checked against what the agent actually retrieved.

The specification's guardrails (§26) are the reason this file exists. An agent
that may not hallucinate SAP functionality, may not invent statutory
obligations and may not reach for an extension before standard configuration
needs those rules enforced somewhere that cannot be talked out of them.

Gates repair rather than merely report, for the same reason InsightLens's
verifier does: a register a reviewer cannot trust is worse than a shorter one.
A quote that is not in the chunk it names is dropped; a localization claimed as
statutory without evidence is demoted to "suspected"; an extension proposed
without showing the standard options considered becomes a decision to make.

QG3 (semantic accuracy) is deliberately absent. Whether the agent compared
business meaning rather than wording cannot be checked mechanically, and a gate
that always passes would only make the report look better than it is.
"""

from __future__ import annotations

from fitgap import tools as ftools
from fitgap.verifier import quote_in_chunk

from .tools import is_sap_bp_chunk

from .schemas import (BUILD_DISPOSITIONS, SUBJECTS, Analysis, AsIsModel, Deviation,
                      Evidence, QualityIssue)

# Evidence is only worth anything if the agent saw the chunk in this run.
def _seen(ev: Evidence, session: ftools.Session) -> bool:
    return ev.chunk_id in session.retrieved


def _valid(ev: Evidence, session: ftools.Session) -> bool:
    rec = session.retrieved.get(ev.chunk_id)
    return bool(rec) and quote_in_chunk(ev.quote, rec.get("full_text", ""))


def _prune(items: list[Evidence], session: ftools.Session, where: str,
           issues: list[QualityIssue], gap_id: str = "") -> list[Evidence]:
    kept = []
    for ev in items:
        if not _seen(ev, session):
            issues.append(QualityIssue(
                gate="QG2", severity="hard", gap_id=gap_id,
                detail=f"{where}: chunk {ev.chunk_id} was never retrieved in this run; evidence dropped"))
            continue
        if not _valid(ev, session):
            issues.append(QualityIssue(
                gate="QG2", severity="hard", gap_id=gap_id,
                detail=f'{where}: the quote "{ev.quote[:60]}…" is not in chunk {ev.chunk_id}; evidence dropped'))
            continue
        # The side is the agent's own label. SAP standard is the one side a
        # wrong label turns into a claim about SAP, so it is checked.
        if ev.side == "sap_bp" and not is_sap_bp_chunk(session.retrieved.get(ev.chunk_id, {})):
            issues.append(QualityIssue(
                gate="QG2", severity="hard", gap_id=gap_id,
                detail=(f"{where}: chunk {ev.chunk_id} was quoted as SAP Best Practice but is not "
                        "from an SAP Best Practice document; evidence dropped")))
            continue
        kept.append(ev)
    return kept


def check(analysis: Analysis, asis: AsIsModel, session: ftools.Session,
          has_sap_bp_source: bool, scope_named: bool = True,
          subject=None) -> tuple[Analysis, list[QualityIssue]]:
    """Run every gate, repairing what can be repaired. Returns the corrected
    analysis and everything that had to be changed."""
    subject = subject or SUBJECTS["country_as_is"]
    issues: list[QualityIssue] = []
    # First, because it removes findings the later gates would otherwise
    # assess on their merits.
    _fits_the_subject(analysis, subject, issues)
    _says_what_it_compared_against(analysis, scope_named, issues)

    # --- QG2: every quote is verbatim, in a chunk this run actually read ----
    for fit in analysis.fit_areas:
        fit.evidence = _prune(fit.evidence, session, f"fit {fit.as_is_step_id or fit.gt_step_ref}", issues)
    for item in analysis.localization:
        item.evidence = _prune(item.evidence, session, f"localization '{item.topic[:40]}'", issues)
    for dev in analysis.deviations:
        dev.evidence = _prune(dev.evidence, session, dev.gap_id, issues, dev.gap_id)

    for dev in analysis.deviations:
        _evidence_floor(dev, issues)
        if subject.localization:
            _no_false_localization(dev, issues)
        _standard_before_extension(dev, issues)
        if subject.score_b:
            _sap_bp_needs_a_source(dev, has_sap_bp_source, issues)
        _workshop_value(dev, issues)

    if subject.score_b:
        _sap_bp_ratings_need_a_source(analysis, has_sap_bp_source, issues)
    _completeness(analysis, asis, issues)
    _traceability(analysis, issues)
    return analysis, issues


def _fits_the_subject(analysis: Analysis, subject, issues: list[QualityIssue]) -> None:
    """What the run cannot be about, given what it is about.

    Both of these are category errors rather than judgement calls, so they are
    repaired rather than reported. The prompt says the same thing, but the
    vocabularies still offer every option and a model handed a
    CONFIRMED_STATUTORY choice will eventually take it -- and a statutory
    claim in a run with no country in it would be a legal assertion about
    nobody."""
    if not subject.localization:
        mislabelled = [d for d in analysis.deviations
                       if d.localization_state != "NOT_LOCALIZATION"]
        for dev in mislabelled:
            dev.localization_state = "NOT_LOCALIZATION"
        if mislabelled:
            issues.append(QualityIssue(
                gate="QG4", severity="soft",
                detail=(f"{len(mislabelled)} deviation(s) carried a localization state in a "
                        f"{subject.label} run, which has no country; reset to "
                        "'Not localization-related'")))
        if analysis.localization:
            issues.append(QualityIssue(
                gate="QG4", severity="soft",
                detail=(f"{len(analysis.localization)} localization item(s) recorded in a "
                        f"{subject.label} run; dropped, as localization is a country question "
                        "and this run has no country")))
            analysis.localization = []

    if not subject.score_b:
        rated = [d for d in analysis.deviations if d.sap_bp_fit_rating is not None]
        for dev in rated:
            dev.sap_bp_fit_rating = None
            dev.sap_bp_reference = None
        dims = [r for r in analysis.dimension_ratings if r.sap_bp_rating is not None]
        for r in dims:
            r.sap_bp_rating = None
        if rated or dims:
            issues.append(QualityIssue(
                gate="QG5", severity="soft",
                detail=("SAP Best Practice ratings were given in a run whose subject is the "
                        "Best Practice content itself; removed, as that is a comparison with "
                        "itself")))
        if not analysis.sap_bp_note:
            analysis.sap_bp_note = (
                "Not applicable: the SAP Best Practice content is the subject of this run, "
                "not a third side to rate it against. The score reported is how closely the "
                "Global Template follows SAP standard.")


def _evidence_floor(dev: Deviation, issues: list[QualityIssue]) -> None:
    """QG2 — a material gap without evidence is a hypothesis, and §5.1 forbids
    presenting one as a finding."""
    if dev.materiality not in ("Critical", "High"):
        return
    if dev.evidence:
        # A deviation is a claim about a difference. Evidence from one side
        # only has not shown there is one.
        sides = {e.side for e in dev.evidence}
        if len(sides) < 2:
            issues.append(QualityIssue(
                gate="QG2", severity="soft", gap_id=dev.gap_id,
                detail=(f"evidence quotes only the {', '.join(sorted(sides))} side, so the difference "
                        "itself is asserted rather than shown")))
        return
    issues.append(QualityIssue(
        gate="QG2", severity="hard", gap_id=dev.gap_id,
        detail=f"{dev.materiality} gap with no surviving evidence; disposition forced to REQUIRES_DECISION"))
    dev.candidate_disposition = "REQUIRES_DECISION"
    dev.evidence_confidence = "Low"
    dev.workshop_bucket = "MUST_DISCUSS"
    if "Provide the source evidence for this difference." not in dev.open_questions:
        dev.open_questions.append("Provide the source evidence for this difference.")


def _no_false_localization(dev: Deviation, issues: list[QualityIssue]) -> None:
    """QG4 — statutory status is confirmed, never assumed (§5.3, §26)."""
    if dev.localization_state != "CONFIRMED_STATUTORY":
        return
    explicit = [e for e in dev.evidence if e.evidence_class == "E1"
                and e.side in ("localization", "as_is", "template")]
    if explicit:
        return
    issues.append(QualityIssue(
        gate="QG4", severity="hard", gap_id=dev.gap_id,
        detail=("claimed as a confirmed statutory localization with no explicit (E1) source; "
                "demoted to 'Suspected localization — validate'")))
    dev.localization_state = "SUSPECTED"
    dev.workshop_bucket = "MUST_DISCUSS"
    q = "Confirm whether this requirement is statutory, and cite the legal or tax source."
    if q not in dev.open_questions:
        dev.open_questions.append(q)


def _standard_before_extension(dev: Deviation, issues: list[QualityIssue]) -> None:
    """QG5 — standard configuration, SAP localization and existing template
    variation come before an extension (§26)."""
    if dev.candidate_disposition not in BUILD_DISPOSITIONS:
        return
    if dev.standard_options_considered:
        return
    issues.append(QualityIssue(
        gate="QG5", severity="hard", gap_id=dev.gap_id,
        detail=("an extension was proposed without recording which standard configuration, "
                "SAP localization or template variant was considered first; "
                "disposition forced to REQUIRES_DECISION")))
    dev.candidate_disposition = "REQUIRES_DECISION"
    dev.workshop_bucket = "MUST_DISCUSS"


def _sap_bp_needs_a_source(dev: Deviation, has_source: bool, issues: list[QualityIssue]) -> None:
    """§26 — do not hallucinate SAP functionality. A Best Practice rating with
    no Best Practice source behind it is exactly that."""
    if dev.sap_bp_fit_rating is None:
        return
    cited = any(e.side == "sap_bp" for e in dev.evidence)
    if cited:
        return
    issues.append(QualityIssue(
        gate="QG5", severity="hard", gap_id=dev.gap_id,
        detail=("rated against SAP Best Practice without quoting an SAP Best Practice source; "
                "the rating has been removed" + ("" if has_source else
                " (no SAP Best Practice document is attached or indexed)"))))
    dev.sap_bp_fit_rating = None
    dev.sap_bp_reference = None


def _workshop_value(dev: Deviation, issues: list[QualityIssue]) -> None:
    """QG6 — a Must Discuss item without a decision question is a discussion,
    which is what the agent exists to avoid (§14, §15)."""
    if dev.workshop_bucket != "MUST_DISCUSS":
        return
    if dev.decision_question.strip():
        if not dev.workshop_minutes:
            dev.workshop_minutes = 10
        return
    if dev.materiality in ("Low", "Informational"):
        dev.workshop_bucket = "CONFIRM"
        issues.append(QualityIssue(
            gate="QG6", severity="soft", gap_id=dev.gap_id,
            detail="no decision question and low materiality; moved to Confirm"))
        return
    issues.append(QualityIssue(
        gate="QG6", severity="hard", gap_id=dev.gap_id,
        detail="Must Discuss with no decision question — the workshop would rediscover, not decide"))


def _sap_bp_ratings_need_a_source(analysis: Analysis, has_source: bool,
                                  issues: list[QualityIssue]) -> None:
    """The same rule at dimension level: Score B is only reported when
    something was actually read to support it."""
    rated = [r for r in analysis.dimension_ratings if r.sap_bp_rating is not None]
    if not rated:
        return
    cited = any(e.side == "sap_bp"
                for d in analysis.deviations for e in d.evidence) or has_source
    if cited:
        return
    for r in rated:
        r.sap_bp_rating = None
    issues.append(QualityIssue(
        gate="QG5", severity="hard",
        detail=("the SAP Best Practice score was rated with no SAP Best Practice source read; "
                "Score B removed. Attach SAP Best Practice content to assess it.")))
    if not analysis.sap_bp_note:
        analysis.sap_bp_note = (
            "Not assessable: no SAP Best Practice source was attached to this session or found "
            "in the corpus, so the country process was compared against the Global Template only.")


def _says_what_it_compared_against(analysis: Analysis, scope_named: bool,
                                   issues: list[QualityIssue]) -> None:
    """QG7 — a run that named no Global Template process must say which one it
    used instead.

    Naming the process is optional for the analyst; knowing what was compared
    is not. An alignment score over an unnamed baseline is a number with no
    referent, so when the agent leaves it blank the report says so rather than
    presenting the scores as if the question did not arise."""
    if scope_named or analysis.template_process.strip():
        return
    issues.append(QualityIssue(
        gate="QG7", severity="hard",
        detail=("no Global Template process was named for this run and the agent recorded none "
                "in template_process, so the alignment scores have no stated baseline -- read "
                "them as a comparison against whatever the corpus searches happened to return")))
    analysis.template_process = "not identified — see the quality gates"


def _completeness(analysis: Analysis, asis: AsIsModel, issues: list[QualityIssue]) -> None:
    """QG1 — every As-Is step is mapped, or explicitly named as unmapped."""
    accounted = {f.as_is_step_id for f in analysis.fit_areas if f.as_is_step_id}
    accounted |= {d.as_is_step_id for d in analysis.deviations if d.as_is_step_id}
    missing = [s.step_id for s in asis.steps if s.step_id not in accounted]
    if missing:
        issues.append(QualityIssue(
            gate="QG1", severity="soft",
            detail=(f"{len(missing)} As-Is step(s) are neither a fit nor a deviation: "
                    + ", ".join(missing[:12]) + ("…" if len(missing) > 12 else ""))))


def _traceability(analysis: Analysis, issues: list[QualityIssue]) -> None:
    """QG7 — a backlog candidate has to trace back to a gap (§20: a hypothesis
    must not become project scope)."""
    known = {d.gap_id for d in analysis.deviations}
    kept = []
    for item in analysis.backlog:
        if item.gap_id and item.gap_id in known:
            kept.append(item)
            continue
        issues.append(QualityIssue(
            gate="QG7", severity="hard", gap_id=item.gap_id,
            detail=f"backlog candidate '{item.title[:50]}' names no gap in this register; dropped"))
    analysis.backlog = kept


def summarise(issues: list[QualityIssue]) -> dict:
    by_gate: dict[str, int] = {}
    for i in issues:
        by_gate[i.gate] = by_gate.get(i.gate, 0) + 1
    return {
        "issues": len(issues),
        "hard": sum(1 for i in issues if i.severity == "hard"),
        "soft": sum(1 for i in issues if i.severity == "soft"),
        "by_gate": by_gate,
        # QG3 has no mechanical check; say so rather than imply it passed.
        "not_checked": ["QG3 — semantic accuracy is a human judgement"],
    }

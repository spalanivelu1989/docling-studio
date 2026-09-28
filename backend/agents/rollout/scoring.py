"""The four alignment scores (§12), computed rather than generated.

The agent rates each of the seven dimensions 0-4 and classifies each
deviation. Everything numeric below is arithmetic over those ratings and
classifications, done here -- including each deviation's harmonization
potential, which `harmonization()` derives from its disposition, localization
state and GT fit. That separation is the point: a score a model writes can
be argued into a better number, and a score derived from a rated register
cannot be moved without changing a finding that a reviewer can see.

Score A  Global Template alignment          weighted dimension ratings
Score B  SAP Best Practice alignment        the same, where a source exists
Score C  Localization-adjusted alignment    A, with confirmed legal difference set aside
Score D  Standardization potential          materiality-weighted harmonization
"""

from __future__ import annotations

from .schemas import (DIMENSIONS, DISPOSITIONS, MANDATORY_LOCALIZATION,
                      MATERIALITY_WEIGHT, SUBJECTS, Analysis, Deviation, DimensionRating)

# The weights are a specification, so a typo in the table must fail loudly
# rather than quietly produce scores out of 97.
assert abs(sum(w for _, w in DIMENSIONS.values()) - 1.0) < 1e-9, "dimension weights must sum to 1"

# §12.1
BANDS_ALIGNMENT = (
    (90, "Very high GT alignment"),
    (75, "High alignment; limited decisions"),
    (60, "Moderate alignment; focused Fit-to-Standard required"),
    (40, "Significant divergence"),
    (0, "Major redesign / harmonization challenge"),
)

# §12.4
BANDS_HARMONIZATION = (
    (80, "Most deviation appears removable through template adoption or standard configuration"),
    (60, "Significant harmonization opportunity"),
    (40, "Mixed; several valid local needs remain"),
    (20, "Limited alignment opportunity without material business change"),
    (0, "Predominantly mandatory or structural local requirement"),
)


def band(value: float | None, bands=BANDS_ALIGNMENT) -> str:
    if value is None:
        return ""
    for floor, label in bands:
        if value >= floor:
            return label
    return ""


def _weighted(ratings: list[DimensionRating], attr: str) -> tuple[float | None, list[dict]]:
    """Weighted percentage over the dimensions that carry a rating.

    A missing rating is dropped and the remaining weights are renormalised, so
    an unrated dimension lowers confidence rather than the score. Nothing rated
    at all returns None -- which is what "not assessable" has to look like, so
    it can be said out loud instead of shown as a zero."""
    rows, total_weight, total = [], 0.0, 0.0
    for key, (label, weight) in DIMENSIONS.items():
        found = next((r for r in ratings if r.dimension == key), None)
        rating = getattr(found, attr) if found else None
        pct = None if rating is None else rating / 4 * 100
        rows.append({
            "dimension": key, "label": label, "weight": round(weight * 100),
            "rating": rating, "percent": None if pct is None else round(pct, 1),
            "note": (found.note if found else ""),
        })
        if pct is not None:
            total += pct * weight
            total_weight += weight
    if total_weight == 0:
        return None, rows
    return round(total / total_weight, 1), rows


def _localization_share(deviations: list[Deviation]) -> float:
    """The share of materiality-weighted divergence that is a confirmed legal
    or SAP-delivered localization -- 0.0 to 1.0.

    Only CONFIRMED_STATUTORY and SAP_DELIVERED count. A suspected localization
    is explicitly excluded: the specification's whole localization guardrail is
    that country-specific is not the same as mandatory, and letting a suspicion
    lift the adjusted score would launder exactly the assumption it forbids."""
    weighted = [(MATERIALITY_WEIGHT[d.materiality], d) for d in deviations]
    total = sum(w for w, _ in weighted)
    if not total:
        return 0.0
    mandatory = sum(w for w, d in weighted if d.localization_state in MANDATORY_LOCALIZATION)
    return mandatory / total


# How far the proposed disposition moves the country onto the standard. The
# disposition is the agent's classification of the gap; this table is what
# that classification is worth, stated once, so the same disposition always
# gives the same starting point.
HARMONIZATION_BASE: dict[str, int] = {
    "ADOPT_GT": 90,
    "RETIRE_LEGACY": 85,
    "CONFIGURE_STANDARD": 80,
    "ADOPT_SAP_BP": 75,
    "USE_SAP_LOCALIZATION": 70,
    "REDESIGN_GT": 60,
    "REQUIRES_DECISION": 50,
    "OUT_OF_SCOPE": 50,
    "RETAIN_LOCAL_EXCEPTION": 30,
    "EXTEND_STANDARD": 20,
}
assert set(HARMONIZATION_BASE) == set(DISPOSITIONS), "every disposition needs a harmonization base"
# How the working reads: "Adopt the template 90 · GT fit 3/4 +5 = 95".
DISPOSITION_SHORT: dict[str, str] = {
    "ADOPT_GT": "Adopt the template", "RETIRE_LEGACY": "Retire the legacy step",
    "CONFIGURE_STANDARD": "Configure SAP standard", "ADOPT_SAP_BP": "Adopt SAP Best Practice",
    "USE_SAP_LOCALIZATION": "Use SAP localization", "REDESIGN_GT": "Redesign the template",
    "REQUIRES_DECISION": "Needs a decision", "OUT_OF_SCOPE": "Out of scope",
    "RETAIN_LOCAL_EXCEPTION": "Keep a local exception", "EXTEND_STANDARD": "Extension",
}
# A legal obligation cannot be harmonised away whatever is proposed for it,
# and a suspected one cannot be counted on until it is checked.
HARMONIZATION_CAP: dict[str, int] = {"CONFIRMED_STATUTORY": 15, "SAP_DELIVERED": 25, "SUSPECTED": 50}
CAP_REASON: dict[str, str] = {"CONFIRMED_STATUTORY": "confirmed statutory",
                              "SAP_DELIVERED": "SAP-delivered localization",
                              "SUSPECTED": "suspected localization"}
# Points per GT-fit step either side of 2 (0-4): a gap already close to the
# template is easier to close than one far from it.
FIT_STEP = 5


def harmonization(d: Deviation) -> tuple[int, dict]:
    """One deviation's harmonization potential and the working behind it."""
    base = HARMONIZATION_BASE[d.candidate_disposition]
    fit = FIT_STEP * (d.gt_fit_rating - 2)
    value = base + fit
    cap = HARMONIZATION_CAP.get(d.localization_state)
    capped = cap is not None and value > cap
    if capped:
        value = cap
    value = max(0, min(100, value))
    parts = [f"{DISPOSITION_SHORT[d.candidate_disposition]} {base}", f"GT fit {d.gt_fit_rating}/4 {fit:+d}"]
    if capped:
        parts.append(f"capped at {cap} ({CAP_REASON[d.localization_state]})")
    return value, {"base": base, "disposition": d.candidate_disposition, "fit_adjustment": fit,
                   "cap": cap if capped else None, "localization_state": d.localization_state,
                   "value": value, "formula": " · ".join(parts) + f" = {value}"}


def apply_harmonization(analysis: Analysis) -> Analysis:
    """Set every deviation's harmonization potential from the rule above.

    Run after the quality gates, because they can change what it depends on:
    an unsupported statutory claim is demoted to SUSPECTED, and an extension
    proposed without standard options becomes REQUIRES_DECISION."""
    for d in analysis.deviations:
        d.harmonization_potential, d.harmonization_terms = harmonization(d)
    return analysis


def score(analysis: Analysis, subject=None) -> dict:
    """Every score, its working, and the counts a header needs (§16.1).

    `subject` says what the run analysed, which decides whether two of the
    four scores mean anything: Score C forgives confirmed-legal divergence and
    Score B rates the subject against SAP standard, and neither has a referent
    in a run with no country and SAP standard as its subject."""
    subject = subject or SUBJECTS["country_as_is"]
    deviations = analysis.deviations
    gt, gt_rows = _weighted(analysis.dimension_ratings, "gt_rating")
    bp, bp_rows = _weighted(analysis.dimension_ratings, "sap_bp_rating")

    # Score C. Not a re-measurement: it is Score A with the confirmed-legal
    # share of the divergence forgiven, on the stated formula, so a reader can
    # check it. Written out in `formula` for exactly that reason.
    # None rather than equal to Score A when localization does not apply: a
    # number that happens to match is read as a second measurement agreeing
    # with the first, which would be a claim this run cannot make.
    share = _localization_share(deviations) if subject.localization else 0.0
    adjusted = (None if gt is None or not subject.localization
                else round(gt + (100 - gt) * share, 1))

    # Score D, weighted by materiality so a Critical gap that cannot be
    # harmonised outweighs three Low ones that can.
    weights = [MATERIALITY_WEIGHT[d.materiality] for d in deviations]
    harmonization = (
        round(sum(w * d.harmonization_potential for w, d in zip(weights, deviations)) / sum(weights), 1)
        if deviations else None
    )

    buckets = {b: 0 for b in ("MUST_DISCUSS", "CONFIRM", "NO_WORKSHOP_TIME")}
    for d in deviations:
        buckets[d.workshop_bucket] = buckets.get(d.workshop_bucket, 0) + 1

    by_materiality: dict[str, int] = {}
    by_type: dict[str, int] = {}
    for d in deviations:
        by_materiality[d.materiality] = by_materiality.get(d.materiality, 0) + 1
        by_type[d.primary_type] = by_type.get(d.primary_type, 0) + 1

    minutes = sum(d.workshop_minutes for d in deviations if d.workshop_bucket == "MUST_DISCUSS")
    return {
        "gt_alignment": gt,
        "gt_band": band(gt),
        "sap_bp_alignment": bp,
        "sap_bp_band": band(bp),
        "sap_bp_note": analysis.sap_bp_note,
        "localization_adjusted": adjusted,
        "localization_share": round(share * 100, 1),
        "harmonization_potential": harmonization,
        "harmonization_band": band(harmonization, BANDS_HARMONIZATION),
        "dimensions": gt_rows,
        "sap_bp_dimensions": bp_rows,
        "pattern": _pattern(gt, bp),
        "subject": subject.key,
        "subject_label": subject.label,
        "harmonization_rule": (
            "Each deviation starts from its proposed disposition ("
            + ", ".join(f"{DISPOSITION_SHORT[k]} {v}" for k, v in HARMONIZATION_BASE.items())
            + f"), moves {FIT_STEP} points per GT-fit step above or below 2/4, and is capped at "
            + ", ".join(f"{v} when {CAP_REASON[k]}" for k, v in HARMONIZATION_CAP.items())
            + ". The run's figure is their materiality-weighted average."
        ),
        "formula": (
            "Localization-adjusted = GT alignment + (100 − GT alignment) × the "
            "materiality-weighted share of deviations that are a confirmed statutory "
            "or SAP-delivered localization. A suspected localization does not count."
            if subject.localization else
            f"Alignment is how closely the Global Template follows the {subject.label} "
            "content read for this run. There is no country in this run, so the "
            "localization-adjusted score does not apply."
        ),
        "counts": {
            "fit_areas": len(analysis.fit_areas),
            "deviations": len(deviations),
            "localization_items": len(analysis.localization),
            "localization_confirmed": sum(1 for i in analysis.localization if i.status == "Confirmed"),
            "backlog": len(analysis.backlog),
            "open_questions": len(analysis.open_questions),
            "by_materiality": by_materiality,
            "by_type": by_type,
            "workshop": buckets,
            "workshop_minutes": minutes,
        },
    }


def _pattern(gt: float | None, bp: float | None) -> str:
    """§12.2 — the four readings of the two scores together. The one worth
    catching is low GT with high SAP BP: the country may be closer to SAP
    standard than the template is, which is a template finding, not a country
    non-conformance."""
    if gt is None or bp is None:
        return ""
    high_gt, high_bp = gt >= 70, bp >= 70
    if high_gt and high_bp:
        return "Strong standard and template fit."
    if high_gt and not high_bp:
        return "The Global Template itself may contain non-standard design — worth a template review."
    if not high_gt and high_bp:
        return ("The country looks closer to SAP standard than the Global Template does. "
                "Review the template rather than treating this as country non-conformance.")
    return "Substantial local and legacy divergence from both the template and SAP standard."


def heatmap(analysis: Analysis) -> list[dict]:
    """§16.3 — a dimension × materiality grid over the deviation register.

    Built from the register rather than rated separately, so a cell is always
    the findings behind it and clicking one can only ever show real gaps."""
    out = []
    for key, (label, weight) in DIMENSIONS.items():
        found = [d for d in analysis.deviations if d.dimension == key]
        worst = max((MATERIALITY_WEIGHT[d.materiality] for d in found), default=0.0)
        rating = next((r.gt_rating for r in analysis.dimension_ratings if r.dimension == key), None)
        out.append({
            "dimension": key,
            "label": label,
            "weight": round(weight * 100),
            "rating": rating,
            "deviations": len(found),
            "must_discuss": sum(1 for d in found if d.workshop_bucket == "MUST_DISCUSS"),
            "localization": sum(1 for d in found if d.localization_state in MANDATORY_LOCALIZATION),
            "focus": ("High" if worst >= 4 else "Medium" if worst >= 3 else "Low" if worst else "None"),
            "gap_ids": [d.gap_id for d in found],
        })
    return out


def agenda(analysis: Analysis) -> list[dict]:
    """§22 — the workshop running order.

    Legal and localization blockers first, then control and financial impact,
    then everything else by materiality. Only MUST_DISCUSS earns floor time;
    CONFIRM is batched into one opening block."""
    order = {"LC": 0, "CT": 1, "AP": 1, "SEC": 1, "BR": 2, "PF": 2, "RO": 2,
             "DT": 3, "IN": 3, "TC": 3, "EX": 3, "TM": 4, "RP": 5, "UX": 5, "VOL": 5, "POL": 2}
    must = [d for d in analysis.deviations if d.workshop_bucket == "MUST_DISCUSS"]
    must.sort(key=lambda d: (order.get(d.primary_type, 9), -MATERIALITY_WEIGHT[d.materiality], d.gap_id))
    return [
        {
            "position": n,
            "gap_id": d.gap_id,
            "topic": d.decision_question or d.exact_difference,
            "why": d.why_discussed,
            "minutes": d.workshop_minutes or 10,
            "materiality": d.materiality,
            "primary_type": d.primary_type,
            "localization_state": d.localization_state,
            "options": d.decision_options,
            "owner": d.decision_owner,
            "disposition": d.candidate_disposition,
        }
        for n, d in enumerate(must, 1)
    ]

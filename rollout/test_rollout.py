"""Unit tests for the parts a rollout team's decisions rest on: the scoring
arithmetic, the quality gates, and the invariant that stops a rated alignment
score sitting on top of an empty register.

Run: python rollout/test_rollout.py   (or python -m pytest rollout/test_rollout.py -q)

Nothing here calls Claude or the database.
"""

from __future__ import annotations

import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pydantic  # noqa: E402

from fitgap import tools as ftools  # noqa: E402
from rollout import gates, scoring  # noqa: E402
from rollout.schemas import (DEVIATION_TYPES, DIMENSIONS, DISPOSITIONS,  # noqa: E402
                             SUBJECTS,
                             LOCALIZATION_STATES, Analysis, AsIsModel, AsIsStep,
                             BacklogCandidate, Deviation, DimensionRating, Evidence,
                             FitArea)


# --- helpers ------------------------------------------------------------------

def dev(**kw) -> Deviation:
    base = dict(
        gap_id="GAP-01", as_is_statement="country does X", gt_statement="template does Y",
        exact_difference="X vs Y", primary_type="BR", dimension="rules",
        localization_state="CORPORATE_POLICY", materiality="High",
        gt_fit_rating=2, harmonization_potential=60,
        candidate_disposition="REQUIRES_DECISION", workshop_bucket="MUST_DISCUSS",
        decision_question="Which one?", workshop_minutes=10,
    )
    base.update(kw)
    return Deviation(**base)


def ev(quote="the quote", side="as_is", cls="E1", chunk="UPLOAD:1") -> Evidence:
    return Evidence(chunk_id=chunk, doc="doc", quote=quote, side=side, evidence_class=cls)


def session_with(*quotes) -> ftools.Session:
    s = ftools.Session()
    for i, q in enumerate(quotes, 1):
        s.retrieved[f"UPLOAD:{i}"] = {"full_text": q}
    return s


def analysis(**kw) -> Analysis:
    base = dict(dimension_ratings=[], deviations=[], fit_areas=[], localization=[], backlog=[])
    base.update(kw)
    return Analysis(**base)


def rate(dimension, gt, bp=None) -> DimensionRating:
    return DimensionRating(dimension=dimension, gt_rating=gt, sap_bp_rating=bp, note="")


# --- the controlled vocabularies ----------------------------------------------

def test_the_specification_taxonomy_is_complete():
    assert len(DEVIATION_TYPES) == 16
    assert len(DISPOSITIONS) == 10
    assert len(LOCALIZATION_STATES) == 6
    assert len(DIMENSIONS) == 7


def test_the_dimension_weights_sum_to_one():
    assert abs(sum(w for _, w in DIMENSIONS.values()) - 1.0) < 1e-9


# --- the invariant that caught a real failure ---------------------------------

def test_a_rated_divergence_must_name_its_deviations():
    # A dimension rated 2 ("moderate deviation") with nothing in the register
    # produces an alignment score that looks measured over a register saying
    # the process matched. This is the exact shape of a real failed run.
    try:
        analysis(dimension_ratings=[rate("governance", 1)])
    except pydantic.ValidationError as exc:
        assert "governance" in str(exc)
    else:
        raise AssertionError("a 1/4 rating with no deviation was accepted")


def test_a_clean_fit_needs_no_deviations():
    a = analysis(dimension_ratings=[rate(d, 4) for d in DIMENSIONS])
    assert scoring.score(a)["gt_alignment"] == 100.0


def test_a_minor_variation_may_stay_out_of_the_register():
    # 3 is "minor variation — standard configuration or local parameter"; it
    # is allowed to be below materiality, unlike 2 and below.
    analysis(dimension_ratings=[rate("reporting", 3)])


# --- the scoring arithmetic (§12) ---------------------------------------------

def test_the_score_is_the_weighted_rating():
    # flow 4/4 at 25%, rules 2/4 at 20%, everything else 4/4.
    ratings = [rate(d, 4) for d in DIMENSIONS if d != "rules"] + [rate("rules", 2)]
    a = analysis(dimension_ratings=ratings, deviations=[dev(dimension="rules")])
    # 0.80 * 100 + 0.20 * 50 = 90
    assert scoring.score(a)["gt_alignment"] == 90.0


def test_an_unrated_dimension_is_dropped_not_counted_as_zero():
    a = analysis(dimension_ratings=[rate("flow", 4), rate("rules", 4)])
    # Only two dimensions rated, both full marks: the answer is 100, not 45.
    assert scoring.score(a)["gt_alignment"] == 100.0


def test_no_rating_at_all_is_not_assessable_rather_than_zero():
    s = scoring.score(analysis())
    assert s["gt_alignment"] is None
    assert s["sap_bp_alignment"] is None


def test_only_confirmed_localization_lifts_the_adjusted_score():
    ratings = [rate(d, 4) for d in DIMENSIONS if d != "rules"] + [rate("rules", 2)]
    # A suspicion must not launder itself into a better score -- that is the
    # exact assumption §5.3 forbids.
    suspected = analysis(dimension_ratings=ratings,
                         deviations=[dev(dimension="rules", localization_state="SUSPECTED")])
    confirmed = analysis(dimension_ratings=ratings,
                         deviations=[dev(dimension="rules", localization_state="CONFIRMED_STATUTORY")])
    assert scoring.score(suspected)["localization_adjusted"] == 90.0
    assert scoring.score(confirmed)["localization_adjusted"] == 100.0


def test_harmonization_is_weighted_by_materiality():
    ratings = [rate(d, 4) for d in DIMENSIONS if d != "rules"] + [rate("rules", 2)]
    a = analysis(dimension_ratings=ratings, deviations=[
        dev(gap_id="GAP-01", dimension="rules", materiality="Critical", harmonization_potential=0),
        dev(gap_id="GAP-02", dimension="rules", materiality="Low", harmonization_potential=100),
    ])
    # (5*0 + 2*100) / 7 = 28.6 -- the critical gap that cannot be harmonised
    # outweighs the low one that can.
    assert scoring.score(a)["harmonization_potential"] == 28.6


def test_the_four_score_patterns():
    assert "template review" in scoring._pattern(85, 40)
    assert "closer to SAP standard" in scoring._pattern(40, 85)
    assert scoring._pattern(85, 85).startswith("Strong")
    assert scoring._pattern(None, 80) == ""


def test_the_agenda_puts_legal_blockers_first():
    ratings = [rate(d, 4) for d in DIMENSIONS if d != "rules"] + [rate("rules", 2)]
    a = analysis(dimension_ratings=ratings, deviations=[
        dev(gap_id="GAP-RP", dimension="rules", primary_type="RP", materiality="Low"),
        dev(gap_id="GAP-LC", dimension="rules", primary_type="LC", materiality="Medium"),
        dev(gap_id="GAP-AP", dimension="rules", primary_type="AP", materiality="Critical"),
    ])
    assert [i["gap_id"] for i in scoring.agenda(a)] == ["GAP-LC", "GAP-AP", "GAP-RP"]


def test_the_heatmap_is_built_from_the_register():
    ratings = [rate(d, 4) for d in DIMENSIONS if d != "rules"] + [rate("rules", 2)]
    a = analysis(dimension_ratings=ratings,
                 deviations=[dev(dimension="rules", materiality="Critical")])
    rows = {r["dimension"]: r for r in scoring.heatmap(a)}
    assert rows["rules"]["focus"] == "High" and rows["rules"]["gap_ids"] == ["GAP-01"]
    assert rows["flow"]["focus"] == "None" and rows["flow"]["deviations"] == 0


# --- the quality gates (§25) --------------------------------------------------

def test_an_invented_quote_is_dropped():
    sess = session_with("the delivery is blocked when exposure exceeds the limit")
    a = analysis(dimension_ratings=[rate("rules", 2)],
                 deviations=[dev(evidence=[ev("a sentence nobody wrote"),
                                           ev("the delivery is blocked", side="template")])])
    out, issues = gates.check(a, AsIsModel(), sess, has_sap_bp_source=False)
    assert len(out.deviations[0].evidence) == 1
    assert any(i.gate == "QG2" and i.severity == "hard" for i in issues)


def test_a_quote_from_a_chunk_never_retrieved_is_dropped():
    a = analysis(dimension_ratings=[rate("rules", 2)],
                 deviations=[dev(evidence=[ev("anything", chunk="PKG:999")])])
    out, issues = gates.check(a, AsIsModel(), ftools.Session(), has_sap_bp_source=False)
    assert out.deviations[0].evidence == []
    assert any("never retrieved" in i.detail for i in issues)


def test_statutory_localization_without_an_explicit_source_is_demoted():
    sess = session_with("the local block applies")
    a = analysis(dimension_ratings=[rate("controls", 2)], deviations=[
        dev(dimension="controls", localization_state="CONFIRMED_STATUTORY",
            evidence=[ev("the local block applies", cls="E3")]),
    ])
    out, issues = gates.check(a, AsIsModel(), sess, has_sap_bp_source=False)
    assert out.deviations[0].localization_state == "SUSPECTED"
    assert any(i.gate == "QG4" for i in issues)


def test_an_extension_without_standard_options_becomes_a_decision():
    sess = session_with("country needs a custom check")
    a = analysis(dimension_ratings=[rate("rules", 2)], deviations=[
        dev(candidate_disposition="EXTEND_STANDARD", standard_options_considered=[],
            evidence=[ev("country needs a custom check")]),
    ])
    out, issues = gates.check(a, AsIsModel(), sess, has_sap_bp_source=False)
    assert out.deviations[0].candidate_disposition == "REQUIRES_DECISION"
    assert any(i.gate == "QG5" for i in issues)


def test_an_extension_that_shows_its_working_survives():
    sess = session_with("country needs a custom check")
    a = analysis(dimension_ratings=[rate("rules", 2)], deviations=[
        dev(candidate_disposition="EXTEND_STANDARD",
            standard_options_considered=["SAP credit management configuration cannot hold advances"],
            evidence=[ev("country needs a custom check")]),
    ])
    out, _ = gates.check(a, AsIsModel(), sess, has_sap_bp_source=False)
    assert out.deviations[0].candidate_disposition == "EXTEND_STANDARD"


def test_an_sap_best_practice_rating_needs_an_sap_source():
    # §26: do not hallucinate SAP functionality. A Best Practice rating with
    # no Best Practice quote behind it is exactly that.
    sess = session_with("country does X")
    a = analysis(dimension_ratings=[rate("rules", 2, bp=3)], deviations=[
        dev(sap_bp_fit_rating=3, evidence=[ev("country does X")]),
    ])
    out, issues = gates.check(a, AsIsModel(), sess, has_sap_bp_source=False)
    assert out.deviations[0].sap_bp_fit_rating is None
    assert out.dimension_ratings[0].sap_bp_rating is None
    assert scoring.score(out)["sap_bp_alignment"] is None
    assert "no SAP Best Practice source" in out.sap_bp_note


def test_a_material_gap_that_loses_all_its_evidence_cannot_keep_a_disposition():
    a = analysis(dimension_ratings=[rate("rules", 2)], deviations=[
        dev(materiality="Critical", candidate_disposition="ADOPT_GT",
            evidence=[ev("invented", chunk="PKG:404")]),
    ])
    out, issues = gates.check(a, AsIsModel(), ftools.Session(), has_sap_bp_source=False)
    assert out.deviations[0].candidate_disposition == "REQUIRES_DECISION"
    assert out.deviations[0].evidence_confidence == "Low"


def test_one_sided_evidence_on_a_material_gap_is_flagged():
    sess = session_with("country does X")
    a = analysis(dimension_ratings=[rate("rules", 2)],
                 deviations=[dev(materiality="High", evidence=[ev("country does X")])])
    _, issues = gates.check(a, AsIsModel(), sess, has_sap_bp_source=False)
    assert any("only the as_is side" in i.detail for i in issues)


def test_a_backlog_candidate_must_trace_to_a_gap():
    sess = session_with("x")
    a = analysis(dimension_ratings=[rate("rules", 2)], deviations=[dev(evidence=[ev("x")])],
                 backlog=[BacklogCandidate(title="Build a thing", requirement="r", gap_id="GAP-99")])
    out, issues = gates.check(a, AsIsModel(), sess, has_sap_bp_source=False)
    assert out.backlog == []
    assert any(i.gate == "QG7" for i in issues)


def test_an_unmapped_as_is_step_is_reported():
    sess = session_with("x")
    asis = AsIsModel(steps=[AsIsStep(step_id="S1", name="one"), AsIsStep(step_id="S2", name="two")])
    a = analysis(dimension_ratings=[rate("rules", 2)],
                 deviations=[dev(as_is_step_id="S1", evidence=[ev("x")])])
    _, issues = gates.check(a, asis, sess, has_sap_bp_source=False)
    assert any(i.gate == "QG1" and "S2" in i.detail for i in issues)


# --- the Global Template process is optional ---------------------------------

def test_naming_no_template_process_is_allowed():
    from rollout.orchestrator import _resolve

    assert _resolve("") == (None, "")
    assert _resolve("   ") == (None, "")


def test_a_template_process_that_does_not_resolve_is_still_an_error():
    # A typo must not quietly become "no scope" -- that would analyse against
    # a different process than the one the analyst asked for.
    #
    # The text has no real words in it on purpose: bpml.resolve_scope matches
    # on name as well as code, so a string containing "process" resolves to a
    # real node. That looseness is InsightLens's too, and the page shows what
    # it landed on beside the field.
    from rollout.orchestrator import _resolve

    found, err = _resolve("zzzqqq")
    assert found is None and "does not resolve" in err
    assert "Clear the field" in err


def test_an_unscoped_run_must_say_what_it_compared_against():
    sess = session_with("x")
    a = analysis(dimension_ratings=[rate("rules", 2)], deviations=[dev(evidence=[ev("x")])])
    out, issues = gates.check(a, AsIsModel(), sess, has_sap_bp_source=False, scope_named=False)
    assert any(i.gate == "QG7" and "no stated baseline" in i.detail for i in issues)
    assert out.template_process.startswith("not identified")


def test_an_unscoped_run_that_names_its_baseline_passes():
    sess = session_with("x")
    a = analysis(dimension_ratings=[rate("rules", 2)], deviations=[dev(evidence=[ev("x")])],
                 template_process="4.5.2 Order Fulfillment")
    _, issues = gates.check(a, AsIsModel(), sess, has_sap_bp_source=False, scope_named=False)
    assert not any("no stated baseline" in i.detail for i in issues)


def test_a_scoped_run_needs_no_template_process_of_its_own():
    sess = session_with("x")
    a = analysis(dimension_ratings=[rate("rules", 2)], deviations=[dev(evidence=[ev("x")])])
    _, issues = gates.check(a, AsIsModel(), sess, has_sap_bp_source=False, scope_named=True)
    assert not any("no stated baseline" in i.detail for i in issues)


def test_a_matched_process_becomes_a_label_that_fits_on_one_line():
    # The agent answers `template_process` with a paragraph. The run history
    # menu gives it one line, so what lands in `scope_label` is the name, not
    # the reasoning behind it.
    from rollout.store import _short_label

    long = ('Global Template: BPML **4.5.2.2 Block Delivery** (L2C > 4.0 Lead to Cash > 4.5 '
            'Manage Sales Orders), equivalent to dash code **O-050-020**. No Global Template '
            'document is attached, so the template side is reconstructed from the corpus.')
    assert _short_label(long) == "Global Template: BPML 4.5.2.2 Block Delivery"

    # No bracket to cut at: trimmed on a word boundary, never mid-word.
    unbracketed = "Global Template " + "process " * 20
    short = _short_label(unbracketed)
    assert len(short) <= 91 and short.endswith("\u2026") and "proces\u2026" not in short

    # A statement that opens with its qualifier keeps enough to be identifiable.
    assert _short_label("(no direct match) 4.3.3 Release or block orders").startswith("(no direct")
    assert _short_label("") == ""


def test_the_trace_headline_reports_the_numbers_the_scorer_actually_produced():
    """The headline is built from `scoring.score`, so it is only as right as
    its key names -- and a wrong key here is silent: it yields a plausible
    zero, not an error. This builds a real scores payload and checks the
    headline against it rather than against remembered key names.

    The first version of `_headline` failed exactly this: it read
    `counts["workshop"]["must"]` and reported 0 must-discuss items on a run
    that had nine."""
    from rollout.orchestrator import _headline

    a = analysis(
        dimension_ratings=[rate("rules", 2)],
        deviations=[dev(materiality="Critical", workshop_bucket="MUST_DISCUSS", evidence=[ev("x")]),
                    dev(materiality="Low", workshop_bucket="CONFIRM", evidence=[ev("x")])],
    )
    scores = scoring.score(a)
    head = _headline(a, scores, {"hard": 0, "soft": 1}, "4.3.3 Something")

    assert head["deviations"] == 2
    # Taken whole from the scorer, so the names cannot drift apart.
    assert head["workshop"] == scores["counts"]["workshop"]
    assert head["workshop"]["MUST_DISCUSS"] == 1
    assert head["workshop_minutes"] == scores["counts"]["workshop_minutes"]
    assert head["by_materiality"] == scores["counts"]["by_materiality"]
    assert head["gt_alignment"] == scores["gt_alignment"]
    assert head["hard_gate_failures"] == 0
    # No value in the headline may be a key that the scorer does not have.
    assert not [k for k, v in head.items() if v is None and k in
                ("workshop", "workshop_minutes", "by_materiality")]


def test_a_gap_decided_twice_counts_once():
    """The decision log is append-only, so clicking Accept three times writes
    three rows. The workshop pack must report one decided gap, not three --
    and must still be able to show that the verdict changed."""
    from rollout.export import _standing

    log = [
        {"gap_id": "GAP-01", "verdict": "accept", "reviewer": "A", "decided_at": "2026-09-22T10:00:00"},
        {"gap_id": "GAP-01", "verdict": "accept", "reviewer": "A", "decided_at": "2026-09-22T10:00:02"},
        {"gap_id": "GAP-02", "verdict": "defer", "reviewer": "B", "decided_at": "2026-09-22T10:01:00"},
        {"gap_id": "GAP-01", "verdict": "reject", "reviewer": "C", "decided_at": "2026-09-22T11:00:00"},
    ]
    standing, superseded = _standing(log)

    assert set(standing) == {"GAP-01", "GAP-02"}
    # The last word on GAP-01 is C's reject, not A's first accept.
    assert standing["GAP-01"]["verdict"] == "reject"
    assert standing["GAP-01"]["reviewer"] == "C"
    assert standing["GAP-02"]["verdict"] == "defer"
    # Nothing is thrown away: both of A's rows survive as history.
    assert len(superseded) == 2
    assert [d["reviewer"] for d in superseded] == ["A", "A"]


def test_the_decision_log_survives_rows_with_no_timestamp():
    # `decided_at` is nullable in the schema; sorting must not raise on it.
    from rollout.export import _standing

    standing, _ = _standing([
        {"gap_id": "G", "verdict": "accept", "reviewer": "A", "decided_at": None},
        {"gap_id": "G", "verdict": "reject", "reviewer": "B", "decided_at": "2026-01-01T00:00:00"},
    ])
    assert standing["G"]["verdict"] == "reject"


# --- analysing something other than a country -------------------------------

BP = SUBJECTS["sap_best_practice"]
COUNTRY = SUBJECTS["country_as_is"]


def test_each_subject_requires_its_own_upload_role():
    # The whole reason the second subject exists: a Best Practice document had
    # to be mis-tagged as a country's As-Is to be analysed at all, which made
    # the agent report SAP's process as a country's own.
    assert COUNTRY.role == "as_is"
    assert BP.role == "sap_bp"


def test_a_best_practice_run_cannot_claim_a_statutory_localization():
    """There is no country in the run, so there is nobody for a legal
    obligation to apply to. The vocabulary still offers the state, so this is
    repaired rather than trusted to the prompt."""
    sess = session_with("x")
    a = analysis(
        dimension_ratings=[rate("rules", 2)],
        deviations=[dev(localization_state="CONFIRMED_STATUTORY", evidence=[ev("x")])],
    )
    a, issues = gates.check(a, AsIsModel(), sess, has_sap_bp_source=True, subject=BP)

    assert a.deviations[0].localization_state == "NOT_LOCALIZATION"
    assert any("has no country" in i.detail for i in issues)


def test_a_best_practice_run_drops_localization_items():
    from rollout.schemas import LocalizationItem

    sess = session_with("x")
    a = analysis(localization=[LocalizationItem(topic="GST e-way bill", status="Confirmed")])
    a, issues = gates.check(a, AsIsModel(), sess, has_sap_bp_source=True, subject=BP)

    assert a.localization == []
    assert any("localization item" in i.detail for i in issues)


def test_a_best_practice_run_does_not_rate_itself_against_itself():
    sess = session_with("x")
    a = analysis(
        dimension_ratings=[rate("rules", 2, bp=3)],
        deviations=[dev(sap_bp_fit_rating=2, evidence=[ev("x")])],
    )
    a, issues = gates.check(a, AsIsModel(), sess, has_sap_bp_source=True, subject=BP)

    assert a.deviations[0].sap_bp_fit_rating is None
    assert a.dimension_ratings[0].sap_bp_rating is None
    # The note has to say why Score B is absent, or a reader assumes the
    # comparison was attempted and came out empty.
    assert "Not applicable" in a.sap_bp_note and "subject of this run" in a.sap_bp_note
    assert any("comparison with itself" in i.detail for i in issues)


def test_score_c_is_not_reported_when_there_is_no_country():
    """Not zero, and not silently equal to Score A -- a number that happens to
    match reads as a second measurement agreeing with the first."""
    a = analysis(dimension_ratings=[rate("rules", 2)],
                 deviations=[dev(localization_state="NOT_LOCALIZATION", evidence=[ev("x")])])
    bp = scoring.score(a, BP)
    country = scoring.score(a, COUNTRY)

    assert bp["gt_alignment"] is not None
    assert bp["localization_adjusted"] is None
    assert bp["subject"] == "sap_best_practice"
    assert "does not apply" in bp["formula"]
    # The country reading of the same register still computes Score C.
    assert country["localization_adjusted"] is not None


def test_a_country_run_is_unchanged_by_the_new_subject():
    """The default has to mean exactly what it meant before this existed."""
    sess = session_with("the quote")
    a = analysis(dimension_ratings=[rate("rules", 2)],
                 deviations=[dev(localization_state="CORPORATE_POLICY", evidence=[ev("the quote")])])
    a, _ = gates.check(a, AsIsModel(), sess, has_sap_bp_source=False)

    assert a.deviations[0].localization_state == "CORPORATE_POLICY"
    assert scoring.score(a)["localization_adjusted"] is not None


def test_the_two_subjects_do_not_share_a_prompt_hash():
    # A run recorded against a hash that does not describe its instructions
    # cannot be reproduced from the record.
    from rollout import agent

    assert agent.prompt_hash(COUNTRY) != agent.prompt_hash(BP)
    assert agent.prompt_hash() == agent.prompt_hash(COUNTRY)


def test_the_best_practice_prompt_says_there_is_no_country():
    from rollout import agent

    text = agent.system_compare(BP)
    assert "NOT_LOCALIZATION" in text
    assert "no country in this run" in text
    # And it must not still be describing a three-way comparison.
    assert "three-way" not in text.lower()


# --- source traceability -----------------------------------------------------


def _retrieved(cid, doc, category, heading, score, text, uploaded=False):
    rec = {"chunk_id": cid, "true_doc": doc, "category": category,
           "true_heading_path": heading, "score": score, "full_text": text,
           "source": f"/corpus/{doc}.md", "vector_rank": 1, "keyword_rank": 2}
    if uploaded:
        rec["uploaded"] = True
    return rec


def test_the_source_index_says_where_each_finding_came_from():
    from rollout import sources

    a = analysis(
        dimension_ratings=[rate("rules", 2)],
        deviations=[dev(gap_id="GAP-01", evidence=[
            ev("the template says X", side="template", chunk="PKG:12"),
            ev("the country does Y", side="as_is", chunk="UPLOAD:3"),
        ])],
        fit_areas=[FitArea(as_is_step_id="S1", statement="matches",
                           evidence=[ev("same thing", side="template", chunk="PKG:12")])],
    )
    log = {
        "PKG:12": _retrieved("PKG:12", "L2C Billing", "PKG", "Billing / Blocks", 0.031,
                             "the template says X and rather a lot more besides"),
        "UPLOAD:3": _retrieved("UPLOAD:3", "India SOP.docx", "UPLOAD", "Step 3", None,
                               "the country does Y", uploaded=True),
    }
    idx = sources.index(a.model_dump(), AsIsModel().model_dump(), log,
                        upload_names={"India SOP.docx"})

    assert idx["cited_total"] == 2
    pkg = idx["chunks"]["PKG:12"]
    assert pkg["document"] == "L2C Billing"
    assert pkg["category"] == "PKG" and pkg["kind"] == "corpus"
    assert pkg["heading_path"] == "Billing / Blocks"
    assert pkg["score"] == 0.031
    assert "the template says X" in pkg["snippet"]
    # One chunk, cited by two different findings, stored once.
    assert {u["kind"] for u in pkg["used_by"]} == {"deviation", "fit_area"}
    assert {u["ref"] for u in pkg["used_by"]} == {"GAP-01", "S1"}

    up = idx["chunks"]["UPLOAD:3"]
    assert up["kind"] == "upload" and up["category"] == "UPLOAD"

    # And the document roll-up counts citations, not chunks.
    billing = next(d for d in idx["documents"] if d["document"] == "L2C Billing")
    assert billing["chunks"] == 1 and billing["citations"] == 2


def test_the_index_counts_what_was_read_and_not_used():
    """The gap between retrieved and cited is the honest measure of how much
    the run looked at without relying on: it separates "the corpus does not
    say" from "the agent did not look"."""
    from rollout import sources

    a = analysis(dimension_ratings=[rate("rules", 2)],
                 deviations=[dev(evidence=[ev("q", chunk="PKG:1")])])
    log = {f"PKG:{n}": _retrieved(f"PKG:{n}", "doc", "PKG", "h", 0.01, "q") for n in range(1, 8)}
    idx = sources.index(a.model_dump(), AsIsModel().model_dump(), log)

    assert idx["retrieved_total"] == 7
    assert idx["cited_total"] == 1
    assert idx["unused_total"] == 6


def test_a_citation_the_gates_pruned_is_marked_not_guessed_at():
    # The quote gate drops evidence whose chunk this run never retrieved. If
    # one survives into the index anyway, an empty row that looks like a real
    # source is the worst outcome.
    from rollout import sources

    a = analysis(dimension_ratings=[rate("rules", 2)],
                 deviations=[dev(evidence=[ev("q", chunk="GHOST:9")])])
    idx = sources.index(a.model_dump(), AsIsModel().model_dump(), {})

    assert idx["chunks"]["GHOST:9"]["known"] is False
    assert idx["chunks"]["GHOST:9"]["document"] == ""


def test_semantic_accuracy_is_never_claimed_as_checked():
    # A gate that always passes would make the report look better than it is.
    assert any("QG3" in n for n in gates.summarise([])["not_checked"])


# --- the subject decides which documents are the subject -----------------------
# compare_entities asked for role "as_is" whatever the run was about. A Best
# Practice run attaches its document as "sap_bp", so the filter matched nothing
# and the tool returned an empty comparison -- which reads as "no shared
# entities", not as "you asked for the wrong documents". The prompt tells the
# agent to call this, so the blindness was silent.


def _compare_entities_with(subject_key, attached_role):
    """Run the tool against a stub upload store, and report what it asked for."""
    from rollout import tools as rtools
    import uploads

    asked = {}

    def fake_compare(sid, roles=None, categories=None):
        asked["roles"] = list(roles or [])
        asked["categories"] = list(categories or [])
        match = not roles or attached_role in roles
        return {"documents": [{"node_id": "doc:subject", "label": "The subject document"}]
                             if match else [],
                "entities": ([{"node_id": "system:S", "type": "system", "label": "SAP S/4HANA",
                               "code": None, "ticket": None, "in_corpus": True,
                               "corpus_documents": ["A template doc"], "corpus_mentions": 1}]
                             if match else []),
                "shared": 1 if match else 0, "new": 0, "scope": list(categories or [])}

    real = uploads.compare
    uploads.compare = fake_compare
    try:
        session = ftools.Session(categories=("PKG",), uploads="sid",
                                 subject_role=SUBJECTS[subject_key].role)
        return rtools.compare_entities(session), asked
    finally:
        uploads.compare = real


def test_compare_entities_asks_for_the_subject_role_not_always_as_is():
    for key, attached in (("country_as_is", "as_is"), ("sap_best_practice", "sap_bp")):
        result, asked = _compare_entities_with(key, attached)
        assert asked["roles"] == [SUBJECTS[key].role], f"{key} asked for {asked['roles']}"
        assert result["subject_documents"] == ["The subject document"], (
            f"{key} found none of its own documents")
        assert result["shared"] == 1


def test_a_best_practice_run_is_not_blind_to_its_own_document():
    """The regression itself: sap_bp attached, as_is requested, nothing found."""
    result, asked = _compare_entities_with("sap_best_practice", "sap_bp")
    assert asked["roles"] != ["as_is"]
    assert result["subject_role"] == "sap_bp"
    assert result["subject_documents"], "the Best Practice document was filtered out"


def test_compare_entities_passes_the_run_scope_to_the_corpus_side():
    """'The corpus already knows this' has to mean the corpus this run reads."""
    _, asked = _compare_entities_with("country_as_is", "as_is")
    assert asked["categories"] == ["PKG"]


def test_a_session_with_no_subject_still_defaults_to_the_country():
    """InsightLens builds sessions without a subject; it only ever has one."""
    from rollout import tools as rtools
    import uploads

    asked = {}
    real = uploads.compare
    uploads.compare = lambda sid, roles=None, categories=None: (
        asked.update(roles=list(roles or [])) or
        {"documents": [], "entities": [], "shared": 0, "new": 0, "scope": []})
    try:
        rtools.compare_entities(ftools.Session(uploads="sid"))
    finally:
        uploads.compare = real
    assert asked["roles"] == ["as_is"]




def _with_store(check):
    """A throwaway database with the rollout schema in it.

    The same shape as the Evidence Agent's helper. Rollout's tests had no
    store coverage at all, which is part of why it went this long without
    noticing it kept no investigation log."""
    import uuid
    from urllib.parse import urlsplit, urlunsplit
    import psycopg
    import rag
    from rollout import store

    original = rag.base_url
    parts = urlsplit(original())
    name = f"docling_test_ro_{uuid.uuid4().hex[:8]}"
    admin = urlunsplit((parts.scheme, parts.netloc, "/postgres", "", ""))
    with psycopg.connect(admin, autocommit=True) as c:
        c.execute(f'CREATE DATABASE "{name}"')
    rag.base_url = lambda: urlunsplit((parts.scheme, parts.netloc, f"/{name}", "", ""))
    rag.close()
    try:
        conn = rag.connection(schema=False)
        store.create_schema(conn)
        check(store, conn)
    finally:
        rag.close()
        rag.base_url = original
        with psycopg.connect(admin, autocommit=True) as c:
            c.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')


# --- the investigation trace ---------------------------------------------------

def test_every_rollout_tool_is_assigned_an_engine():
    """A tool with no engine falls to "other" and loses its colour and its
    panel. The two lists are written separately, so they can drift."""
    from rollout import tools as rtools

    missing = [name for name in rtools.DISPATCH if name not in rtools.ENGINE_OF]
    assert not missing, f"no engine for: {', '.join(missing)}"


def test_read_sources_traces_carry_the_side_a_passage_came_from():
    """A Rollout answer stands or falls on whether a quote came from the
    country's As-Is or from the Global Template. A panel that does not say
    cannot be used to check one."""
    from fitgap import trace

    t = trace.of("read_sources", {"query": "returns", "side": "as_is"}, {
        "query": "returns", "side": "as_is",
        "results": [{"chunk_id": "UPLOAD:1", "doc": "India As-Is", "heading_path": "",
                     "side": "as_is", "side_label": "Country As-Is",
                     "text": "the clerk raises a credit memo", "score": 0.03}]})
    assert t["kind"] == "rag" and t["side"] == "as_is"
    assert t["hits"][0]["side_label"] == "Country As-Is"
    assert t["hits"][0]["text"]


def test_compare_entities_traces_keep_the_shared_and_new_split():
    """That split is the whole point of the call, so it travels on each node
    rather than being left for the reader to infer."""
    from fitgap import trace

    t = trace.of("compare_entities", {}, {
        "entities": [{"node_id": "system:SOVOS", "type": "system", "label": "SOVOS",
                      "in_corpus": True, "corpus_mentions": 12},
                     {"node_id": "proc:X-1-2", "type": "process", "label": "X-1-2",
                      "in_corpus": False, "corpus_mentions": 0}],
        "shared": 1, "new": 1})
    assert t["kind"] == "graph" and t["shared"] == 1 and t["new"] == 1
    flags = {n["label"]: n["in_corpus"] for n in t["nodes"]}
    assert flags == {"SOVOS": True, "X-1-2": False}


def test_a_rollout_call_event_carries_the_engine_and_the_trace():
    from fitgap.tools import ToolCall
    from rollout.orchestrator import _call_event

    call = ToolCall(name="search_corpus", arguments={"query": "q"}, summary="4 chunks",
                    ms=9, trace={"kind": "rag", "hits": []})
    event = _call_event("compare", call)
    assert event["engine"] == "rag"
    assert event["arguments"] == {"query": "q"}
    assert event["trace"]["kind"] == "rag"
    assert event["stage"] == "compare"


def test_the_log_survives_a_reopened_run():
    """Rollout kept none of this: the log streamed to the browser and was gone
    on reload, so a reopened run showed its conclusions with no working."""
    def check(store, conn):
        store.start_run(conn, {"id": "ro_log", "subject": "country_as_is", "scope_bpml": "4.5",
                               "scope_label": "x", "country": "", "country_context": "",
                               "sap_release": "", "gt_version": "", "question": "",
                               "model": "m", "prompt_hash": "h", "categories": [],
                               "uploads": {}, "corpus_fingerprint": ""})
        calls = [{"stage": "compare", "tool": "search_corpus", "engine": "rag",
                  "arguments": {"query": "q"}, "summary": "4 chunks", "ms": 9, "error": None,
                  "sources": {}, "trace": {"kind": "rag", "hits": [{"text": "a passage"}]}}]
        store.save_calls(conn, "ro_log", calls)
        back = store.get_run(conn, "ro_log")["calls"]
        assert len(back) == 1
        assert back[0]["trace"]["hits"][0]["text"] == "a passage"
        assert back[0]["engine"] == "rag"
    _with_store(check)



def test_a_run_can_be_deleted_and_takes_its_decisions_with_it():
    """A verdict must not outlive the analysis it was made against.

    rollout_decisions declares ON DELETE CASCADE; this checks the declaration
    is actually doing something, because a decision left behind would be
    reported against a run nobody can open."""
    def check(store, conn):
        store.start_run(conn, {"id": "ro_del", "subject": "country_as_is", "scope_bpml": "4.5",
                               "scope_label": "x", "country": "", "country_context": "",
                               "sap_release": "", "gt_version": "", "question": "",
                               "model": "m", "prompt_hash": "h", "categories": [],
                               "uploads": {}, "corpus_fingerprint": ""})
        store.save_decision(conn, "ro_del", "gap-1", "tester", "accept", "", "")
        assert len(store.get_decisions(conn, "ro_del")) == 1

        assert store.delete_run(conn, "ro_del") is True
        assert store.get_run(conn, "ro_del") is None
        assert store.get_decisions(conn, "ro_del") == []
    _with_store(check)


def test_deleting_a_run_that_is_not_there_reports_it():
    """False, not an exception and not a silent success: the endpoint turns
    this into a 404 rather than telling the browser it removed something."""
    def check(store, conn):
        assert store.delete_run(conn, "ro_never_existed") is False
    _with_store(check)


def test_deleting_one_run_leaves_the_others():
    def check(store, conn):
        for i in range(3):
            store.start_run(conn, {"id": f"ro_keep{i}", "subject": "country_as_is",
                                   "scope_bpml": "4.5", "scope_label": f"run {i}", "country": "",
                                   "country_context": "", "sap_release": "", "gt_version": "",
                                   "question": "", "model": "m", "prompt_hash": "h",
                                   "categories": [], "uploads": {}, "corpus_fingerprint": ""})
        store.delete_run(conn, "ro_keep1")
        left = {r["id"] for r in store.list_runs(conn)}
        assert left == {"ro_keep0", "ro_keep2"}, left
    _with_store(check)


# --- the PDF pack ---------------------------------------------------------------
# The PDF is rendered from the Markdown, so what is tested here is the trip:
# that the pack's own content survives it, that the parts Markdown cannot
# express are added, and that a machine without the libraries says so instead
# of producing half a file.


def _pack_run():
    """A run with the shapes a pack exercises: a table, a code span, an em-dash
    for an absent number, and the headerless provenance block."""
    return {
        "id": "ro_pdftest01",
        "country": "India",
        "scope_label": "4.10.2 Process Returns",
        "analysis": {"template_process": "4.10.2 Process Returns"},
    }


def test_the_pdf_is_a_pdf():
    from rollout import pdf as ro_pdf

    ok, why = ro_pdf.available()
    if not ok:
        print(f"       (skipped: {why[:70]})")
        return
    blob = ro_pdf.render(_pack_run(), "# Title\n\nBody.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n")
    assert blob.startswith(b"%PDF-"), "not a PDF"
    assert b"%%EOF" in blob[-1024:], "truncated PDF"


def test_the_pdf_carries_the_run_id_on_every_page():
    """A pack is printed, split up and handed round. A loose page that cannot
    say which analysis it came from is worse than no page.

    The id is baked into the @page rule rather than carried by string-set,
    because string-set only fires for an element that generates a box -- the
    hidden div that first held it produced no box and no footer at all."""
    from rollout import pdf as ro_pdf

    css = ro_pdf.stylesheet("ro_pdftest01")
    assert "ro_pdftest01" in css
    assert "@bottom-left" in css
    assert "string(runid)" not in css, "back on string-set, which silently renders nothing"


def test_the_stylesheet_survives_its_own_formatting():
    """The sheet is percent-formatted to bake the id in, and it is full of
    literal percent signs. One unescaped `width: 100%` and every render raises
    ValueError."""
    from rollout import pdf as ro_pdf

    css = ro_pdf.stylesheet("ro_x")
    assert "width: 100%;" in css and "width: 34%;" in css
    assert "%(" not in css


def test_a_footer_cannot_be_escaped_out_of():
    from rollout import pdf as ro_pdf

    css = ro_pdf.stylesheet('evil"; } @page { size: A3; ')
    assert 'evil\\"' in css, "a quote in the id was not escaped"
    assert "size: A3" not in css.split("@bottom-left")[1].split("}")[0]


def test_the_headerless_provenance_table_loses_its_empty_bar():
    """`to_markdown` opens the pack with `| | |`, because Markdown has no
    headerless table. Rendered, that row is a grey bar over nothing."""
    from rollout import pdf as ro_pdf

    html = ro_pdf._markdown_to_html("| | |\n|---|---|\n| Run | x |\n")
    marked = ro_pdf._BLANK_HEAD.sub(
        lambda m: m.group(0).replace("<thead>", '<thead class="empty">'), html)
    assert 'thead class="empty"' in marked, "the empty header row was not found"
    assert "thead.empty { display: none; }" in ro_pdf.stylesheet("")

    # A real header must not be hidden with it.
    real = ro_pdf._markdown_to_html("| Score | Value |\n|---|---|\n| GT | 52% |\n")
    assert ro_pdf._BLANK_HEAD.search(real) is None, "a table with headings was blanked"


def test_the_filename_says_what_the_pack_is():
    from rollout import pdf as ro_pdf

    assert ro_pdf.filename(_pack_run()) == \
        "Fit-to-Standard - India - 4.10.2 Process Returns.pdf"
    # A process name with a slash in it must not become a directory.
    risky = {**_pack_run(), "scope_label": "4.1 Order / Return"}
    name = ro_pdf.filename(risky)
    assert "/" not in name and "\\" not in name, name
    # Nothing to name it after still produces a file name.
    assert ro_pdf.filename({"id": "ro_bare"}).endswith("ro_bare.pdf")


# A pack made of the shapes that actually broke: a ten-column register, an
# identifier that must not be split, a column of empty cells with one long one
# in it, a file name past any column width, and a timestamp.
HARD_PACK = """\
# Fit-to-Standard analysis — 4.10.2 Process Returns · India

| | |
|---|---|
| Run | `ro_hardpack1` |
| Country As-Is sources | sample_BKP_Customer_Returns.clean_xml (as_is) |
| Finished | 2026-09-22T11:59:48.566193+05:30 |

## Deviation register

| Gap | Step | Exact difference | Type | Materiality | Localization | GT fit | Harmonization | Disposition | Confidence |
|---|---|---|---|---|---|---|---|---|---|
| GAP-01 | AS-04, AS-13 | The template enforces a two-person credit release control on returns; the As-Is depicts none at any point in the flow. | AP/CT/SEC | High | Not localization-related | 1/4 | 85% | CONFIGURE_STANDARD | Medium |
| GAP-11 | n/a | Neither side documents how Indian tax documents are produced for a return. | LC/CT/DT | High | Suspected localization — validate | 1/4 | 40% | RETAIN_LOCAL_EXCEPTION | Low |

## As-Is steps

| Step | Actor | Action | Rule | Control | System | Confidence |
|---|---|---|---|---|---|---|
| AS-01 Customer returns material | Returns and Refund Clerk | Process is started by the event. | | | | High |
| AS-02 Sell from Stock | Returns and Refund Clerk | Referenced preceding process. | | | | Medium |
| AS-03 Create Returns Order | Returns and Refund Clerk | Create the returns order. | Annotation attached to the task: creation with reference to a sales order or invoice is optional. | | | High |
| AS-04 Decide handling | Returns and Refund Clerk | | | | | High |
| AS-05 Generate Returns Delivery | Returns and Refund Clerk | Generates the returns delivery. | | | | High |
| AS-06 Perform Picking | Shipping Specialist | Pick the returns delivery. | | | | High |
| AS-07 Post Goods Receipt | Shipping Specialist | Post the goods receipt. | | | | High |
| AS-08 Perform Material Inspection | Receiving Specialist | Inspect the returned material. | | | | High |
| AS-09 Parallel split | Shipping Specialist | | | | | Medium |
| AS-10 Determine Refund | Returns and Refund Clerk | Determine the refund. | | | | High |
"""


def _broken_tokens(markdown: str, run_id: str = "ro_hardpack1"):
    """Every cell whose single unbreakable token was split across lines.

    Measured from the rendered layout, not estimated: the estimate is what got
    this wrong four times running. A cell that wrapped at a SPACE is fine; a
    break inside a token is not, and the two are told apart by joining the
    rendered lines with no separator and asking whether the result occurs
    verbatim in the source.
    """
    from weasyprint import CSS, HTML

    from rollout import pdf as ro_pdf

    flat = markdown.replace("**", "").replace("`", "")
    body = ro_pdf._html_body(markdown)
    doc = HTML(string=f"<!doctype html><html lang='en'><body>{body}</body></html>").render(
        stylesheets=[CSS(string=ro_pdf.stylesheet(run_id))])
    bad = []

    def lines_of(cell):
        out = []

        def walk(box):
            if type(box).__name__ == "LineBox":
                text = []

                def grab(x):
                    if type(x).__name__ == "TextBox":
                        text.append(x.text)
                    for c in getattr(x, "children", []):
                        grab(c)

                grab(box)
                out.append("".join(text))
            else:
                for c in getattr(box, "children", []):
                    walk(c)

        walk(cell)
        return out

    def walk(box):
        if type(box).__name__ == "TableCellBox":
            lines = lines_of(box)
            joined = "".join(l.strip() for l in lines)
            if len(lines) > 1 and joined and " " not in joined and joined in flat:
                bad.append((joined, len(lines)))
        for c in getattr(box, "children", []):
            walk(c)

    for page in doc.pages:
        walk(page._page_box)
    return bad


def test_no_identifier_is_ever_broken_in_half():
    """The whole point of measuring columns. Before this, 187 identifiers
    across twelve real packs came out as "GAP-0 / 1", "REQUIRES_DECISI / ON",
    "Materialit / y" -- unreadable, and quotable wrong."""
    from rollout import pdf as ro_pdf

    ok, why = ro_pdf.available()
    if not ok:
        print(f"       (skipped: {why[:60]})")
        return
    bad = _broken_tokens(HARD_PACK)
    assert not bad, f"{len(bad)} token(s) split: {bad[:5]}"


def test_a_table_too_wide_for_the_page_turns_it():
    """A ten-column register cannot be read on A4 portrait, and squeezing it
    pushed its last column off the paper entirely -- the content was not
    truncated, it was simply gone."""
    from rollout import pdf as ro_pdf

    tables = ro_pdf.measure(HARD_PACK)
    wide = [w for w, is_wide in tables if is_wide]
    assert len(wide) >= 1, "the ten-column register was left on a portrait page"
    assert len(wide[0]) == 10
    assert "@page wide" in ro_pdf.stylesheet("") and "size: A4 landscape" in ro_pdf.stylesheet("")


def test_every_table_shares_out_exactly_its_width():
    from rollout import pdf as ro_pdf

    for cols, _ in ro_pdf.measure(HARD_PACK):
        assert abs(sum(cols) - 1.0) < 1e-9, f"columns sum to {sum(cols)}"
        assert all(c > 0 for c in cols)


def test_a_column_is_wide_enough_for_its_longest_token():
    """The allocation gives every column what it NEEDS before sharing out what
    is left. A column that cannot hold its own longest identifier has already
    lost, whatever it does with the remainder."""
    from rollout import pdf as ro_pdf

    header = ["Gap", "Disposition"]
    tokens = [["GAP-01"], ["CONFIGURE_STANDARD"]]
    need = ro_pdf._needs(header, tokens, wide=True)
    unit, pad = ro_pdf.MM_PER_UNIT_WIDE, ro_pdf.PAD_MM_WIDE
    assert need[1] - pad >= unit * ro_pdf._width("CONFIGURE_STANDARD")
    # and the padding and the collapsed border are both paid for
    assert ro_pdf.PAD_MM_WIDE > 2 * 1.4, "the collapsed border is not accounted for"


def test_one_long_cell_among_empty_ones_still_gets_room():
    """The 75th percentile describes the typical cell and says nothing about
    the exceptional one. A Rule column of blanks with a single ninety-character
    annotation took the minimum width and turned that cell into ten lines,
    beside two columns that were entirely empty."""
    from rollout import pdf as ro_pdf

    cols, _ = ro_pdf.measure(HARD_PACK)[2]
    rule, control = cols[3], cols[4]
    assert rule > control * 1.5, (
        f"the column holding the annotation ({rule:.3f}) is not meaningfully wider "
        f"than the empty one beside it ({control:.3f})")


def test_a_token_too_long_for_any_column_breaks_at_a_seam():
    """Some tokens fit nowhere -- a thirty-seven character file name, a full
    ISO timestamp. Where they break is still a choice, and mid-word is the
    wrong one."""
    from rollout import pdf as ro_pdf

    html = ro_pdf._seams("<td>sample_BKP_Customer_Returns.clean_xml</td>")
    assert "<wbr>" in html
    assert "sample_<wbr>BKP_<wbr>Customer_<wbr>Returns." in html
    # A short identifier is left alone: it is made to fit instead.
    assert "<wbr>" not in ro_pdf._seams("<td>GAP-01</td>")


def test_the_character_widths_are_measured_not_guessed():
    """Counting characters got upper case wrong by a third in one direction
    and lower case wrong in the other, which is why headings broke."""
    from rollout import pdf as ro_pdf

    assert ro_pdf._width("W") > ro_pdf._width("i") * 3
    assert ro_pdf._width("REQUIRES") > ro_pdf._width("requires")
    assert ro_pdf._width("Gap", bold=True) > ro_pdf._width("Gap")
    # Unknown characters still cost something.
    assert ro_pdf._width("—") > 0


def test_the_pdf_and_the_markdown_are_the_same_document():
    """Rendered from the pack rather than from the run, so a section added to
    one cannot go missing from the other."""
    import inspect

    from rollout import pdf as ro_pdf

    src = inspect.getsource(ro_pdf.render)
    # The CALL, not the import: `from .export import to_markdown` sitting in
    # the function body satisfies a substring check while the body renders
    # something else entirely.
    assert "to_markdown(run)" in src, "the PDF builds its own content and will drift"


if __name__ == "__main__":
    fns = [(n, f) for n, f in sorted(globals().items()) if n.startswith("test_") and callable(f)]
    failed = 0
    for name, fn in fns:
        try:
            fn()
            print(f"  ok   {name}")
        except Exception:
            failed += 1
            print(f"  FAIL {name}")
            traceback.print_exc()
    print(f"\n{len(fns) - failed}/{len(fns)} passed")
    sys.exit(1 if failed else 0)

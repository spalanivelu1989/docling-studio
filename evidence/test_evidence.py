"""Unit tests for the four judgements the Evidence Agent's scores rest on:
provenance, independence, hub filtering and the scoring arithmetic.

Run: python evidence/test_evidence.py      (no model calls; the database and
the corpus are read, since that is what these modules are judging).
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import knowledge_graph  # noqa: E402

from evidence import independence, paths, provenance, scoring  # noqa: E402
from evidence.schemas import Answer, Claim, GraphFact, Source  # noqa: E402

MD = "solvay-spark/pkg/markdown/"


def src(cid="1", doc="A", quote="q", stance="supports"):
    return Source(chunk_id=cid, doc=doc, quote=quote, stance=stance)


def retrieved(**docs):
    return {cid: {"source": MD + f, "true_doc": cid, "full_text": "the user creates a sales order"}
            for cid, f in docs.items()}


# --- provenance ---------------------------------------------------------------

def test_a_document_of_screenshots_is_flagged_machine_read():
    p = provenance.of(MD + "Return S4 Selling ECC supplying_docx.md")
    assert p.vlm_images == 12 and p.unreadable_images == 3
    assert p.mostly_machine_read
    assert "mostly_machine_read" in p.flags()


def test_an_email_thread_is_flagged_as_discussion():
    p = provenance.of(MD + "SPARK L2C Interim Process avoid ECC to S4_docx.md")
    assert p.is_discussion and "discussion" in p.flags()


def test_a_written_specification_is_not_flagged_machine_read():
    p = provenance.of(MD + "SPARK_FS_L2C_SPARK -22234-FS_Interface - SOVOS_docx.md")
    assert not p.mostly_machine_read
    assert "discussion" not in p.flags()


def test_the_blank_label_sheet_is_flagged_sparse():
    p = provenance.of(MD + "Manage Text Labels for Billing Form_xlsx.md")
    assert "sparse_table" in p.flags()
    assert p.sparse_ratio > 0.6


def test_the_filled_translation_sheet_is_not_sparse():
    p = provenance.of(MD + "billing_form_translations_html.md")
    assert "sparse_table" not in p.flags()


def test_a_missing_source_file_does_not_raise():
    p = provenance.of(MD + "does-not-exist.md")
    assert not p.exists and p.flags() == []


def test_boilerplate_is_recognised_per_quote():
    assert provenance.is_boilerplate("*Add details on all the other documents/objects*")
    assert provenance.is_boilerplate("|  |  |  |")
    assert provenance.is_boilerplate("")
    assert not provenance.is_boilerplate("The user creates a sales order via VA01")


# --- independence -------------------------------------------------------------

def test_two_versions_of_one_spec_are_one_source():
    d = independence.load()
    pair = ["20251212_SPARK_L2C_SPARK_FS_Enhancement - Item Line Delivery Block (docx)",
            "SPARK_FS_L2C_21930_ Item Line Delivery Block Part 1 (docx)"]
    assert d.independent_count(pair) == 1
    assert "near-identical" in d.note_for(pair)


def test_different_specs_from_one_template_stay_independent():
    # 0.966 cosine on shared boilerplate, but different ticket numbers.
    d = independence.load()
    pair = ["SPARK_FS_L2C_SPARK-21175_Form_Billing Document PDF (docx)",
            "SPARK_FS_L2C_SPARK-49618_Billing Split_Enhancement (docx)"]
    assert d.independent_count(pair) == 2
    assert d.note_for(pair) == ""


def test_unrelated_documents_stay_independent():
    d = independence.load()
    assert d.independent_count(["SPARK L2C Create Billing Types (xlsx)",
                                "SPARK_Interface__L2C_18542_Determine Order Type - FIT (docx)"]) == 2


def test_a_document_is_never_independent_of_itself():
    d = independence.load()
    assert d.independent_count(["X (docx)", "X (docx)"]) == 1


# --- hub filtering ------------------------------------------------------------

def test_a_route_through_a_stream_is_rejected():
    # Salesforce and SOVOS share no document; the only route between them runs
    # through the L2C stream label, which is co-membership, not an interface.
    g = knowledge_graph.extract_graph()
    v = paths.shortest(g, "system:Salesforce", "system:SOVOS")
    assert v and not v.meaningful
    assert "stream" in v.reason.lower()
    assert v.via_label_edges


def test_a_content_derived_route_is_accepted():
    g = knowledge_graph.extract_graph()
    v = paths.shortest(g, "system:eCommerce", "system:S4HANA")
    assert v and v.meaningful and not v.via_label_edges


def test_the_stream_and_the_target_erp_are_hubs():
    g = knowledge_graph.extract_graph()
    labels = {i for i in paths.hubs(g)}
    assert "stream:L2C" in labels
    assert "system:S4HANA" in labels


def test_the_process_register_is_no_longer_a_hub():
    # It used to be the single biggest node in the graph, with one edge per row
    # of its "Lowest Level Key" column -- 502 of them. Those keys are process
    # step identifiers, not functional specs, and now ride on the step as its
    # `jira_key`. The register is an ordinary document again, so a route that
    # passes through it is no longer dismissed as a topology artefact.
    g = knowledge_graph.extract_graph()
    register = next(n for n in g["nodes"] if "L1-L4 Processes" in n["id"])
    assert register["degree"] < paths.HUB_DEGREE
    assert register["id"] not in paths.hubs(g)


# --- scoring ------------------------------------------------------------------

def test_one_source_scores_the_base():
    r = retrieved(**{"1": "SPARK L2C Create Billing Types_xlsx.md"})
    c = scoring.score(Claim(text="x", sources=[src("1", "B")]), r, independence.load())
    assert c.score == 0.50


def test_a_second_independent_document_is_worth_fifteen_hundredths():
    r = retrieved(**{"1": "SPARK L2C Create Billing Types_xlsx.md",
                     "2": "SPARK_Interface__L2C_18542_Determine Order Type - FIT_docx.md"})
    c = scoring.score(Claim(text="x", sources=[src("1", "B"), src("2", "C")]), r, independence.load())
    assert c.score == 0.65 and c.independent_sources == 2


def test_a_near_duplicate_buys_nothing():
    a = "20251212_SPARK_L2C_SPARK_FS_Enhancement - Item Line Delivery Block (docx)"
    b = "SPARK_FS_L2C_21930_ Item Line Delivery Block Part 1 (docx)"
    r = {"1": {"source": MD + "20251212_SPARK_L2C_SPARK_FS_Enhancement - Item Line Delivery Block_docx.md",
               "true_doc": a, "full_text": "x"},
         "2": {"source": MD + "SPARK_FS_L2C_21930_ Item Line Delivery Block Part 1_docx.md",
               "true_doc": b, "full_text": "x"}}
    c = scoring.score(Claim(text="x", sources=[src("1", a), src("2", b)]), r, independence.load())
    assert c.score == 0.50, "two copies of one document must not score as two sources"
    assert any(t.rule == "duplicates_discounted" for t in c.score_terms)


def test_a_contradiction_costs_a_quarter():
    r = retrieved(**{"1": "SPARK L2C Create Billing Types_xlsx.md",
                     "2": "SPARK_Interface__L2C_18542_Determine Order Type - FIT_docx.md"})
    c = scoring.score(Claim(text="x", sources=[src("1", "B"), src("2", "C", stance="opposes")]),
                      r, independence.load())
    assert c.score == 0.25


def test_an_email_is_capped_at_four_tenths():
    r = retrieved(**{"1": "SPARK L2C Interim Process avoid ECC to S4_docx.md"})
    c = scoring.score(Claim(text="x", sources=[src("1", "E")]), r, independence.load())
    assert c.score == 0.40
    assert any(t.rule == "discussion_only" for t in c.score_terms)


def test_a_transcribed_document_costs_fifteen_hundredths():
    r = retrieved(**{"1": "Return S4 Selling ECC supplying_docx.md"})
    c = scoring.score(Claim(text="x", sources=[src("1", "V")]), r, independence.load())
    assert c.score == 0.35
    assert any(t.rule == "machine_read" for t in c.score_terms)


def test_a_boilerplate_quote_is_capped():
    r = retrieved(**{"1": "SPARK_FS_Form_Template_docx.md"})
    c = scoring.score(Claim(text="x", sources=[src("1", "T", "*Add details on the object*")]),
                      r, independence.load())
    assert c.score == 0.30


def test_an_identifier_absent_from_the_evidence_costs_a_tenth():
    r = retrieved(**{"1": "SPARK L2C Create Billing Types_xlsx.md"})
    c = scoring.score(Claim(text="SPARK-99999 does it", sources=[src("1", "B")]),
                      r, independence.load(), ["SPARK-99999"])
    assert c.score == 0.40


def test_a_graph_only_claim_scores_even_when_it_reports_an_artefact():
    # "this route is an artefact" is a sound finding, not an unsupported one.
    c = scoring.score(Claim(text="x", graph_facts=[GraphFact(statement="g", meaningful=False)]),
                      {}, independence.load())
    assert c.score == scoring.GRAPH_ONLY
    assert any(t.rule == "about_a_flagged_route" for t in c.score_terms)


def test_context_only_is_unweighted_not_false():
    r = retrieved(**{"1": "SPARK L2C Create Billing Types_xlsx.md"})
    c = scoring.score(Claim(text="x", sources=[src("1", "B", stance="context")]),
                      r, independence.load())
    assert c.score == scoring.CONTEXT_ONLY


def test_nothing_at_all_scores_zero():
    c = scoring.score(Claim(text="x"), {}, independence.load())
    assert c.score == 0.0


def test_no_claim_is_ever_certain():
    r = {str(i): {"source": MD + f, "true_doc": f, "full_text": "x"} for i, f in enumerate(
        ["SPARK L2C Create Billing Types_xlsx.md",
         "SPARK_Interface__L2C_18542_Determine Order Type - FIT_docx.md",
         "SPARK L2C - Shipto priority_xlsx.md",
         "20260112_SPARK_L2C_Delivery Blocks_xlsx.md",
         "Pricing_xlsx.md"], 0)}
    sources = [src(str(i), f) for i, f in enumerate(r.keys())]
    c = scoring.score(Claim(text="x", sources=sources,
                            graph_facts=[GraphFact(statement="g")]), r, independence.load())
    assert c.score <= scoring.CEILING


# --- the answer contract ------------------------------------------------------

def test_an_asserting_state_needs_a_claim():
    import pydantic
    try:
        Answer(state="supported", claims=[])
    except pydantic.ValidationError as e:
        assert "needs at least one claim" in str(e)
    else:
        raise AssertionError("the empty-claim guard did not fire")


def test_a_claim_needs_evidence():
    import pydantic
    try:
        Answer(state="supported", claims=[Claim(text="unsupported")])
    except pydantic.ValidationError as e:
        assert "no sources" in str(e)
    else:
        raise AssertionError("the no-evidence guard did not fire")


def test_not_in_corpus_needs_no_claim():
    assert Answer(state="not_in_corpus").confidence == 0.0


def test_the_answer_is_capped_at_120_words_not_80():
    # A tighter cap pushed the model into abbreviation-stuffing to fit, which
    # is exactly what the plain-English rules exist to prevent.
    short = Answer(state="not_in_corpus", answer=" ".join(f"w{i}" for i in range(119)))
    assert len(short.answer.split()) == 119 and not short.answer.endswith("\u2026")
    long = Answer(state="not_in_corpus", answer=" ".join(f"w{i}" for i in range(200)))
    assert len(long.answer.split()) == 121 and long.answer.endswith("\u2026")


def test_a_normal_length_answer_is_never_truncated():
    text = ("The documents disagree about the Forecast Check block. Three of them say it "
            "stops a purchase requisition being created. Two say the opposite. One workbook "
            "contradicts itself across its two sheets.")
    assert Answer(state="conflicted", answer=text, claims=[
        Claim(text="x", sources=[src()])]).answer == text


def test_confidence_ignores_unweighted_claims():
    r = retrieved(**{"1": "SPARK L2C Create Billing Types_xlsx.md"})
    d = independence.load()
    a = Answer(state="supported", claims=[
        scoring.score(Claim(text="real", sources=[src("1", "B")]), r, d),
        scoring.score(Claim(text="ctx", sources=[src("1", "B", stance="context")]), r, d),
    ])
    assert len(a.load_bearing) == 1
    assert a.confidence == 0.50, "a context claim must not drag the answer down"


if __name__ == "__main__":
    import traceback

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

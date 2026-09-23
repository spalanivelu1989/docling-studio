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

from evidence import independence, paths, provenance, scoring, trace  # noqa: E402
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


# --- graph scoping -------------------------------------------------------------
# The Evidence Agent reads with the same Session as the Copilot, so its four
# graph tools have to honour the same category scope its retrieval does.
# graph_enumerate is the one that matters most: it produces an exact count,
# and an unscoped count puts documents the run cannot open into a figure the
# answer then quotes.


def _fake_graph():
    nodes = [
        {"id": "system:S", "label": "SAP S/4HANA", "type": "system", "degree": 3},
        {"id": "doc:A", "label": "Package doc", "type": "document", "category": "PKG", "degree": 1},
        {"id": "doc:B", "label": "Design record", "type": "document", "category": "DR", "degree": 1},
        {"id": "doc:C", "label": "Second design record", "type": "document",
         "category": "DR", "degree": 1},
    ]
    edges = [{"id": f"e{i}", "source": d, "target": "system:S",
              "relation": "mentions", "label": ""}
             for i, d in enumerate(("doc:A", "doc:B", "doc:C"))]
    return {"nodes": nodes, "edges": edges,
            "stats": {"sources": "fingerprint-for-the-test",
                      "categories": {"PKG": 1, "DR": 2}}}


def _with_fake_graph(fn):
    from fitgap import tools as ftools
    real = knowledge_graph.extract_graph
    knowledge_graph.extract_graph = _fake_graph
    ftools._scoped_graphs.clear()
    try:
        return fn()
    finally:
        knowledge_graph.extract_graph = real
        ftools._scoped_graphs.clear()


def test_graph_enumerate_counts_only_what_the_run_may_read():
    from fitgap import tools as ftools
    from evidence import agent

    def check():
        assert agent.graph_enumerate(ftools.Session(), "system:S", "document")["count"] == 3
        scoped = agent.graph_enumerate(
            ftools.Session(categories=("PKG",)), "system:S", "document")
        assert scoped["count"] == 1, "a PKG run counted DR documents it cannot open"
        assert [i["label"] for i in scoped["items"]] == ["Package doc"]
    _with_fake_graph(check)


def test_an_exact_count_says_what_it_counted_over():
    from fitgap import tools as ftools
    from evidence import agent

    def check():
        note = agent.graph_enumerate(
            ftools.Session(categories=("PKG",)), "system:S", "document")["note"]
        assert "PKG" in note and "scope of this run" in note
        assert "scope of this run" not in agent.graph_enumerate(
            ftools.Session(), "system:S", "document")["note"]
    _with_fake_graph(check)


def test_a_path_cannot_be_drawn_to_a_node_outside_the_scope():
    from fitgap import tools as ftools
    from evidence import agent

    def check():
        out = agent.graph_path(ftools.Session(categories=("PKG",)), "doc:B", "system:S")
        assert "outside this run's categories" in out["error"]
    _with_fake_graph(check)


# --- the run history ----------------------------------------------------------
#
# An investigation is written down as it happens, so an answer can be gone back
# to. These run against a throwaway database: what is being tested is the
# bookkeeping, not what the agent thinks.

def _with_store(check):
    """A throwaway database with the evidence schema in it."""
    import uuid
    from urllib.parse import urlsplit, urlunsplit
    import psycopg
    import rag
    from evidence import store

    original = rag.base_url
    parts = urlsplit(original())
    name = f"docling_test_ev_{uuid.uuid4().hex[:8]}"
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


def test_an_investigation_is_recorded_before_it_answers():
    # The row exists from the first moment, so a run whose stream is dropped
    # still leaves a trace of having been asked.
    def check(store, conn):
        store.start_run(conn, {"id": "ev_1", "question": "does it record?", "holdout": False,
                               "categories": [], "model": "m", "prompt_hash": "h",
                               "corpus_fingerprint": "f"})
        run = store.get_run(conn, "ev_1")
        assert run["status"] == "running" and run["answer"] is None
        assert run["question"] == "does it record?"
        assert store.list_runs(conn)[0]["id"] == "ev_1"
    _with_store(check)


def test_the_tool_calls_are_kept_so_a_reopened_run_shows_its_working():
    def check(store, conn):
        store.start_run(conn, {"id": "ev_2", "question": "q", "holdout": False, "categories": [],
                               "model": "m", "prompt_hash": "h", "corpus_fingerprint": "f"})
        calls = [{"tool": "search_corpus", "engine": "rag", "summary": "8 chunks"},
                 {"tool": "graph_entity", "engine": "graph", "summary": "1 node"}]
        store.save_calls(conn, "ev_2", calls)
        store.finish_run(conn, "ev_2", {
            "state": "supported", "answer": "yes", "input_tokens": 10, "output_tokens": 2,
            "seconds": 1.5, "claims": [{"text": "c", "sources": [{"chunk_id": "PKG:1"}]}],
        }, calls)
        run = store.get_run(conn, "ev_2")
        assert run["status"] == "done" and run["state"] == "supported"
        assert [c["tool"] for c in run["calls"]] == ["search_corpus", "graph_entity"]
        row = store.list_runs(conn)[0]
        assert row["tool_calls"] == 2 and row["claims"] == 1 and row["sources"] == 1
    _with_store(check)


def test_a_failed_investigation_is_kept_with_what_it_had_done():
    # What the agent managed to read before it failed is often the whole point
    # of looking again, so a failure is recorded rather than dropped.
    def check(store, conn):
        store.start_run(conn, {"id": "ev_3", "question": "q", "holdout": True, "categories": ["PKG"],
                               "model": "m", "prompt_hash": "h", "corpus_fingerprint": "f"})
        store.fail_run(conn, "ev_3", "RuntimeError: the model refused",
                       [{"tool": "search_corpus", "engine": "rag", "summary": "3 chunks"}])
        run = store.get_run(conn, "ev_3")
        assert run["status"] == "failed"
        assert "refused" in run["error"] and len(run["calls"]) == 1
        assert run["holdout"] is True and run["categories"] == ["PKG"]
    _with_store(check)


def test_a_run_whose_stream_was_dropped_reads_as_abandoned_not_running():
    def check(store, conn):
        store.start_run(conn, {"id": "ev_4", "question": "q", "holdout": False, "categories": [],
                               "model": "m", "prompt_hash": "h", "corpus_fingerprint": "f"})
        conn.execute("UPDATE evidence_runs SET started_at = now() - interval '2 hours'"
                     " WHERE id = 'ev_4'")
        assert store.get_run(conn, "ev_4")["status"] == "abandoned"
        assert store.list_runs(conn)[0]["status"] == "abandoned"
        # The row is not mutated -- it still records that it was interrupted
        # rather than finished.
        assert conn.execute("SELECT status FROM evidence_runs WHERE id = 'ev_4'").fetchone()[0] \
            == "running"
    _with_store(check)


def test_history_is_newest_first_and_deletable():
    def check(store, conn):
        for i, q in enumerate(["first", "second", "third"]):
            store.start_run(conn, {"id": f"ev_{i}", "question": q, "holdout": False,
                                   "categories": [], "model": "m", "prompt_hash": "h",
                                   "corpus_fingerprint": "f"})
            conn.execute("UPDATE evidence_runs SET started_at = now() + make_interval(secs => %s)"
                         " WHERE id = %s", (i, f"ev_{i}"))
        assert [r["question"] for r in store.list_runs(conn)] == ["third", "second", "first"]
        assert store.delete_run(conn, "ev_1") is True
        assert store.delete_run(conn, "ev_1") is False
        assert [r["question"] for r in store.list_runs(conn)] == ["third", "first"]
    _with_store(check)




def test_the_history_is_trimmed_so_traces_do_not_grow_without_bound():
    # A call used to be a summary line. Now it carries the passages that call
    # returned, so a row is kilobytes rather than bytes and the table has to be
    # capped -- oldest first, after each run finishes.
    def check(store, conn):
        for i in range(6):
            store.start_run(conn, {"id": f"ev_t{i}", "question": f"q{i}", "holdout": False,
                                   "categories": [], "model": "m", "prompt_hash": "h",
                                   "corpus_fingerprint": "f"})
        assert store.trim(conn, keep=3) == 3
        kept = [r["id"] for r in store.list_runs(conn)]
        assert len(kept) == 3
        # The newest survive; the oldest go.
        assert "ev_t5" in kept and "ev_t0" not in kept
    _with_store(check)


def test_counting_calls_does_not_drag_every_trace_across_the_wire():
    # list_runs counts calls in SQL. Selecting the column to take its length
    # was free when a call was one line and is not now.
    def check(store, conn):
        store.start_run(conn, {"id": "ev_c", "question": "q", "holdout": False, "categories": [],
                               "model": "m", "prompt_hash": "h", "corpus_fingerprint": "f"})
        big = [{"tool": "search_corpus", "engine": "rag", "summary": "s",
                "trace": {"kind": "rag", "hits": [{"text": "x" * 2000}]}} for _ in range(3)]
        store.save_calls(conn, "ev_c", big)
        assert store.list_runs(conn)[0]["tool_calls"] == 3
        # The full trace is still there when the run itself is opened.
        assert store.get_run(conn, "ev_c")["calls"][0]["trace"]["kind"] == "rag"
    _with_store(check)


# --- the investigation trace ---------------------------------------------------
#
# The log records that a call happened; the trace records what it brought back.
# These check the three things that make it worth keeping: that a retrieval hit
# carries its own text rather than only a pointer to it, that all four graph
# tools come back in one shape the page can draw, and that nothing here can turn
# a working call into a failed one.

def _hit(cid="PKG:412", rank_v=2, rank_k=5):
    return {"chunk_id": cid, "doc": "A spec (docx)", "heading_path": "Scope > Returns",
            "text": "the return is created in S/4HANA", "score": 0.031,
            "vector_rank": rank_v, "keyword_rank": rank_k}


def test_a_retrieval_trace_keeps_the_passage_not_just_its_id():
    # ask_store learned this the hard way: re-indexing renumbers chunks, so a
    # trace that kept only the id would show a different passage next month --
    # or none. The text the agent was given is recorded verbatim.
    t = trace.of("search_corpus", {"query": "returns", "k": 8},
                 {"query": "returns", "results": [_hit(), _hit("DR:7")]})
    assert t["kind"] == "rag" and len(t["hits"]) == 2
    assert t["hits"][0]["text"] == "the return is created in S/4HANA"
    assert t["hits"][0]["rank"] == 1 and t["hits"][1]["rank"] == 2


def test_a_retrieval_trace_carries_both_ranks_behind_the_fusion_score():
    # A hit ranked first overall but fourteenth by vector got there on words.
    # Keeping only the fused score would hide that, which is the one thing a
    # reader checking a suspicious hit actually wants to see.
    t = trace.of("search_corpus", {"query": "O-050-030"},
                 {"results": [_hit(rank_v=14, rank_k=1)]})
    hit = t["hits"][0]
    assert hit["vector_rank"] == 14 and hit["keyword_rank"] == 1 and hit["score"] == 0.031


def test_a_chunk_id_declares_the_store_it_came_from():
    # Chunk ids are prefixed with the category they are filed under, so the
    # panel can say "this came from DR" without a second lookup.
    t = trace.of("search_corpus", {"query": "q"}, {"results": [_hit("DR:88")]})
    assert t["hits"][0]["category"] == "DR"


def test_a_retrieval_trace_is_capped():
    t = trace.of("search_corpus", {"query": "q"},
                 {"results": [_hit(f"PKG:{i}") for i in range(40)]})
    assert len(t["hits"]) == trace.MAX_HITS and t["truncated"] is True


def test_all_four_graph_tools_come_back_in_one_shape():
    # One payload means the page has one graph renderer rather than four, and a
    # node id is a node id whichever tool produced it.
    calls = [
        ("graph_entity", {"text_or_code": "SOVOS"},
         {"matches": [{"node_id": "system:SOVOS", "label": "SOVOS (Tax Engine)", "type": "system"}]}),
        ("graph_neighbors", {"node_id": "system:SOVOS"},
         {"node": {"node_id": "system:SOVOS", "label": "SOVOS", "type": "system"},
          "neighbors": [{"node_id": "doc:a.md", "label": "a", "type": "document", "hops": 1}],
          "edges": [{"edge_id": "e1", "source": "doc:a.md", "target": "system:SOVOS",
                     "relation": "interfaces_with", "label": "Tax Engine Interface"}]}),
        ("graph_path", {"a": "Salesforce", "b": "SOVOS"},
         {"hops": 2, "node_ids": ["system:Salesforce", "doc:a.md", "system:SOVOS"],
          "edge_ids": ["e0", "e1"], "meaningful": True,
          "steps": [{"from": "Salesforce", "relation": "integrates_with", "to": "a"}],
          "note": "every hop is content-derived"}),
        ("graph_enumerate", {"node_id": "system:SOVOS", "type": "document"},
         {"node": {"node_id": "system:SOVOS", "label": "SOVOS", "type": "system"},
          "count": 23, "type_filter": "document",
          "items": [{"node_id": "doc:a.md", "label": "a", "type": "document",
                     "relation": "interfaces_with"}]}),
    ]
    for tool, args, result in calls:
        t = trace.of(tool, args, result, session=None)
        assert t["kind"] == "graph", tool
        assert t["op"] == tool
        assert t["nodes"], f"{tool} produced no nodes"
        for n in t["nodes"]:
            assert n["id"] and n["label"] and n["role"] in ("seed", "path", "match", "neighbour")


def test_a_path_trace_says_where_it_started_and_whether_the_route_is_real():
    # paths.judge decides whether a route is an integration or an artefact of
    # the graph's shape. That verdict has to survive into the panel, or the
    # picture presents a meaningless route as a finding.
    t = trace.of("graph_path", {"a": "A", "b": "B"},
                 {"hops": 4, "node_ids": ["system:A", "stream:L2C", "system:B"],
                  "edge_ids": ["e1"], "meaningful": False,
                  "steps": [], "note": "NOT a real connection"})
    assert t["seeds"] == ["system:A", "system:B"]
    assert t["path"]["meaningful"] is False and "NOT a real" in t["path"]["note"]
    roles = {n["id"]: n["role"] for n in t["nodes"]}
    assert roles["system:A"] == "seed" and roles["stream:L2C"] == "path"


def test_a_node_is_typed_from_its_id_when_the_graph_is_not_to_hand():
    t = trace.of("graph_entity", {"text_or_code": "x"},
                 {"matches": [{"node_id": "proc:O-050-030"}, {"node_id": "spec:SPARK-21265"}]})
    assert [n["type"] for n in t["nodes"]] == ["process", "spec"]


def test_a_bpml_trace_keeps_the_ancestry_so_the_scope_reads_as_a_ladder():
    t = trace.of("get_scope", {"bpml_code": "4.5.2.4"},
                 {"process": {"code": "4.5.2.4", "name": "Validate Order Readiness"},
                  "parent": {"code": "4.5.2", "name": "Manage Orders"},
                  "ancestry": [{"code": "4", "name": "Lead to Cash"},
                               {"code": "4.5", "name": "Manage Sales Orders"}],
                  "children": [{"code": "O-050-030", "name": "Check credit"}]})
    assert t["kind"] == "bpml" and len(t["ancestry"]) == 2 and len(t["children"]) == 1


def test_a_failed_call_has_no_trace_rather_than_an_empty_one():
    # An empty panel reads as "nothing was found"; no panel reads as "this call
    # failed", which is what happened.
    assert trace.of("search_corpus", {"query": "q"}, {"error": "boom"}) is None
    assert trace.of("graph_entity", {"text_or_code": "q"}, {"matches": []}) is None


def test_a_broken_trace_never_breaks_the_run():
    # A trace is a record of what happened. Failing to build one must not turn a
    # successful investigation into a failed one.
    class Exploding(dict):
        def get(self, *a, **k):
            raise RuntimeError("malformed result")

    assert trace.of("search_corpus", {"query": "q"}, Exploding()) is None


def test_an_unknown_tool_contributes_nothing():
    assert trace.of("submit_answer", {}, {"ok": True}) is None


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

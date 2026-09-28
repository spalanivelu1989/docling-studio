"""The knowledge graph's quality checks: each one counts what it says it counts.

Run: python backend/tests/test_graph_eval.py

No model, no Neo4j, no database: the checks that read the graph are driven with
a small hand-made graph with known faults, and the question comparison with
hand-made result rows. Scores are never sent anywhere.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.core import tracing  # noqa: E402
from backend.graph import graph_eval as ge  # noqa: E402

_CALLS: list[str] = []
tracing.client = lambda: _CALLS.append("client") or None


def node(id_, type_, **kw):
    return {"id": id_, "type": type_, "label": id_.split(":", 1)[1], **kw}


def edge(s, t, rel):
    return {"id": f"{s}->{t}:{rel}", "source": s, "target": t, "relation": rel}


def _graph():
    """Two documents, a process hierarchy with a loop and a two-parent step, a
    spec whose primary flag contradicts its edges, and one of everything wrong."""
    nodes = [node("doc:A", "document"), node("doc:B", "document"), node("doc:Lonely", "document"),
             node("proc:1", "process", code="1", in_bpml=True), node("proc:1.1", "process", code="1.1", in_bpml=True),
             node("proc:L1", "process", code="L1"), node("proc:L2", "process", code="L2"),
             node("proc:M", "process", code="M"), node("proc:P1", "process", code="P1"),
             node("proc:P2", "process", code="P2"),
             node("spec:SPARK-1", "spec", ticket="SPARK-1", is_primary=False),
             node("spec:SPARK-2", "spec", ticket="SPARK-2", is_primary=True),
             node("system:X", "system")]
    edges = [edge("doc:A", "proc:1.1", "specifies_process"),
             edge("proc:1.1", "proc:1", "subprocess_of"),
             edge("proc:L1", "proc:L2", "subprocess_of"), edge("proc:L2", "proc:L1", "subprocess_of"),
             edge("proc:M", "proc:P1", "subprocess_of"), edge("proc:M", "proc:P2", "subprocess_of"),
             edge("doc:A", "spec:SPARK-1", "implements_ticket"),       # implemented, not flagged
             edge("doc:B", "system:X", "mentions_system"),
             edge("doc:B", "system:X", "mentions_system"),              # duplicate
             edge("doc:B", "proc:1", "mentions_system"),                # wrong target type
             edge("doc:B", "system:Gone", "mentions_system")]           # dangling
    return {n["id"]: n for n in nodes}, edges


def _by(scores):
    return {s.name: s for s in scores}


# --- consistency and structure ------------------------------------------------------


def test_consistency_finds_each_planted_fault():
    nodes, edges = _graph()
    s = _by(ge._consistency(nodes, edges))
    assert s["graph_dangling_edges"].value == 1
    assert s["graph_duplicate_edges"].value == 1
    assert s["graph_hierarchy_cycles"].value == 2, s["graph_hierarchy_cycles"]      # L1 and L2
    assert s["graph_multiple_parents"].value == 1 and "M" in s["graph_multiple_parents"].comment
    # SPARK-1 implemented but not flagged; SPARK-2 flagged but implemented by nothing
    assert s["graph_property_conflicts"].value == 2
    assert "SPARK-1" in s["graph_property_conflicts"].comment and "SPARK-2" in s["graph_property_conflicts"].comment
    # 10 edges have both ends; the mentions_system edge into a process is the one misfit
    assert s["graph_schema_conformance"].value == 0.9, s["graph_schema_conformance"]


def test_a_process_below_a_loop_is_not_itself_in_the_loop():
    nodes, edges = _graph()
    nodes["proc:Below"] = node("proc:Below", "process", code="Below")
    edges.append(edge("proc:Below", "proc:L1", "subprocess_of"))
    s = _by(ge._consistency(nodes, edges))
    assert s["graph_hierarchy_cycles"].value == 2 and "Below" not in s["graph_hierarchy_cycles"].comment


def test_structure_counts_islands_and_isolated_nodes():
    nodes, edges = _graph()
    s = _by(ge._structure(nodes, edges))
    # Lonely has no edge, and neither does SPARK-2 (flagged primary, implemented by nothing)
    assert s["graph_isolated_nodes"].value == 2 and "Lonely" in s["graph_isolated_nodes"].comment
    # the largest connected part: A, B, 1, 1.1, SPARK-1, X
    assert s["graph_largest_component"].value == round(6 / 13, 4), s["graph_largest_component"]
    assert s["graph_hubs"].value == 0


# --- the question check's comparison ------------------------------------------------


def _node(**kw):
    return {"_kind": "node", "_labels": ["System"], **kw}


def test_rows_mode_allows_extra_columns_and_any_identifying_property():
    ref = [["SAP S/4HANA", 146], ["SOVOS (Tax Engine)", 3]]
    got = [["S4HANA", _node(code="S4HANA", label="SAP S/4HANA"), 146, "sap"],
           ["SOVOS", _node(code="SOVOS", label="SOVOS (Tax Engine)"), 3, "third_party"]]
    matched, recall, _ = ge.compare(ref, got, "rows")
    assert matched and recall == 1.0


def test_rows_mode_needs_the_same_number_of_rows():
    ref = [["a"], ["b"]]
    assert ge.compare(ref, [["a"], ["b"], ["c"]], "rows")[0] is False
    matched, recall, why = ge.compare(ref, [["a"]], "rows")
    assert not matched and recall == 0.5 and "1 of 2" in why


def test_values_mode_accepts_a_richer_answer():
    ref = [["doc1.md"], ["doc2.md"]]
    got = [["doc1.md", "SOVOS", "chunk 3"], ["doc2.md", "CPI", "chunk 9"], ["doc3.md", "x", "y"]]
    assert ge.compare(ref, got, "values")[0] is True
    assert ge.compare(ref, [["doc1.md"]], "values")[:2] == (False, 0.5)


def test_values_mode_finds_a_code_presented_with_its_name():
    ref = [["4.10.2.2"], ["4.10.2"], ["4.0"]]
    got = [[["4.10.2.2 Create & Save Return Order", "4.10.2 Process Returns", "4.0 Lead to Cash"]]]
    assert ge.compare(ref, got, "values")[0] is True
    # a whole code, not a prefix of a longer one
    assert ge.compare([["4.10.2"]], [["4.10.2.2 Create & Save Return Order"]], "values")[0] is False


def test_length_mode_compares_route_length_not_route():
    def path(n):
        return [{"_kind": "path", "nodes": [], "relationships": [{"_kind": "relationship"}] * n}]
    assert ge.compare([path(2)], [path(2)], "length")[0] is True
    assert ge.compare([path(2)], [path(3)], "length")[0] is False
    assert ge.compare([path(2)], [["no path here"]], "length")[0] is False


def test_an_empty_reference_matches_only_an_empty_answer():
    assert ge.compare([], [], "rows")[0] is True
    assert ge.compare([], [["x"]], "rows")[0] is False


def test_numbers_and_case_do_not_cause_a_miss():
    assert ge.compare([[3, "L2C"]], [[3.0, "l2c"]], "rows")[0] is True


def test_question_scores_add_up():
    results = [
        {"expected_answerable": True, "answerable": True, "valid": True, "attempts": 1, "matched": True,
         "answerability_correct": True, "reference_rows": 3, "answer_rows": 3},
        {"expected_answerable": True, "answerable": True, "valid": True, "attempts": 2, "matched": False,
         "answerability_correct": True, "reference_rows": 3, "answer_rows": 0},
        {"expected_answerable": True, "answerable": False, "valid": True, "attempts": 1, "matched": False,
         "answerability_correct": False},
        {"expected_answerable": False, "answerable": False, "valid": True, "attempts": 1, "matched": None,
         "answerability_correct": True},
    ]
    s = _by(ge.question_scores(results))
    assert s["cypher_execution_accuracy"].value == round(1 / 3, 4)
    assert s["cypher_answerability_accuracy"].value == 0.75
    assert s["cypher_valid_rate"].value == round(2 / 3, 4)
    assert s["cypher_first_try_rate"].value == round(1 / 3, 4)
    assert s["cypher_empty_result_rate"].value == 0.5


# --- the definitions -------------------------------------------------------------------


def test_every_score_is_declared_and_reported_in_a_known_group():
    nodes, edges = _graph()
    emitted = ge._consistency(nodes, edges) + ge._structure(nodes, edges) + ge.question_scores(
        [{"expected_answerable": True, "answerable": True, "valid": True, "attempts": 1, "matched": True,
          "answerability_correct": True, "reference_rows": 1, "answer_rows": 1}])
    assert {s.name for s in emitted} <= set(ge.SCORES)
    r = ge._report(emitted)
    assert all(row["metric"] in ge.METRICS for row in r["scores"])
    assert {row["name"]: row["kind"] for row in r["scores"]}["graph_schema_conformance"] == "share"


def test_the_reference_questions_are_well_formed():
    data = ge.load_questions()
    ids = [q["id"] for q in data["questions"]]
    assert len(ids) == len(set(ids))
    for q in data["questions"]:
        if q["answerable"]:
            assert q.get("cypher") and q.get("compare") in ("rows", "values", "length"), q["id"]
        else:
            assert not q.get("cypher"), q["id"]


def test_zz_nothing_reached_the_tracing_client():
    assert _CALLS == [], _CALLS


def main() -> int:
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failed = 0
    for fn in tests:
        try:
            fn()
        except Exception as exc:
            failed += 1
            print(f"  FAIL {fn.__name__}: {exc.__class__.__name__}: {exc}")
        else:
            print(f"  ok   {fn.__name__}")
    print(f"{len(tests) - failed}/{len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())

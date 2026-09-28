"""The code-only agent scores: each one counts what it says it counts.

Run: python test_agent_eval.py

No model, no database, no Langfuse. The scoring functions are pure; `push` is
exercised against a stub client, and one test asserts nothing reaches the real
one -- a test suite that wrote scores onto real traces would corrupt exactly
the dashboards these scores exist for.
"""

from __future__ import annotations

import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import agent_eval  # noqa: E402
import tracing  # noqa: E402
from guardrails import scope, web  # noqa: E402

# No real Langfuse, whatever .env holds. Every call is recorded, and the last
# test asserts there were none outside the test that swaps in its own stub.
_REAL_CALLS: list[str] = []
tracing.client = lambda: _REAL_CALLS.append("client") or None


def _by_name(scores) -> dict:
    out = {}
    for s in scores:
        assert s.name not in out, f"{s.name} emitted twice"
        out[s.name] = s
    return out


def _call(tool, error=None, **arguments) -> dict:
    return {"tool": tool, "arguments": arguments, "error": error}


VERDICT = {"allowed": True, "method": "signal", "reason": "BPML code", "category": "in_scope"}


def _answer(*claims) -> dict:
    return {"state": "supported", "answer": "x", "claims": list(claims)}


def _claim(n_sources, graph=False) -> dict:
    return {"text": "a claim", "sources": [{"chunk_id": str(i), "quote": "q"} for i in range(n_sources)],
            "graph_facts": [{"id": "g"}] if graph else []}


def _evidence(**kw):
    base = dict(question="How are credit blocks released?", verdict=VERDICT,
                submitted=_answer(_claim(2)), final=_answer(_claim(2)),
                redacted=_answer(_claim(2)), calls=[_call("search_corpus", query="credit")],
                rejections=0, budget_hit=False)
    base.update(kw)
    return _by_name(agent_eval.evidence(**base))


# --- the score names ------------------------------------------------------------


def test_every_score_emitted_is_declared():
    """An undeclared name would start a second series in Langfuse unnoticed."""
    emitted = set(_evidence())
    emitted |= set(_by_name(agent_eval.refused(VERDICT)))
    emitted |= set(_by_name(_rollout_scores()))
    emitted |= set(_by_name(agent_eval.rollout_incomplete(VERDICT, [], "x")))
    emitted |= {"web_query_on_topic"}
    assert emitted <= set(agent_eval.SCORES), emitted - set(agent_eval.SCORES)
    assert set(agent_eval.SCORES) <= emitted, set(agent_eval.SCORES) - emitted


def test_boolean_scores_are_marked_boolean_and_are_zero_or_one():
    for s in _evidence().values():
        if agent_eval.SCORES[s.name].boolean:
            assert s.value in (0.0, 1.0), s


# --- groundedness ---------------------------------------------------------------


def test_citation_validity_counts_the_quotes_finalise_discarded():
    """Counted after finalise, every run would score 1.0: it drops the failures."""
    s = _evidence(submitted=_answer(_claim(3), _claim(1)), final=_answer(_claim(2), _claim(0, graph=True)))
    assert s["citation_validity"].value == 0.5, s["citation_validity"]
    assert "2 discarded" in s["citation_validity"].comment


def test_citation_validity_is_absent_when_nothing_was_quoted():
    s = _evidence(submitted=_answer(), final=_answer())
    assert "citation_validity" not in s


def test_a_claim_with_a_graph_fact_is_supported_and_one_with_nothing_is_not():
    s = _evidence(final=_answer(_claim(0, graph=True), _claim(0), _claim(1)))
    assert s["claims_unsupported"].value == 1.0


# --- tool use -------------------------------------------------------------------


def test_errors_repeats_and_volume():
    calls = [_call("search_corpus", query="a"), _call("search_corpus", query="a"),
             _call("get_chunk", error="no such chunk", chunk_id="9"), _call("search_corpus", query="b")]
    s = _evidence(calls=calls)
    assert s["tool_error_rate"].value == 0.25
    assert s["redundant_tool_calls"].value == 1.0
    assert s["tool_calls"].value == 4.0


def test_a_web_query_the_guardrail_blocked_is_not_a_tool_error():
    calls = [_call("search_corpus", query="a"),
             _call("web_search", error="The query contains an internal identifier (O-10-20).", query="O-10-20")]
    s = _evidence(calls=calls)
    assert s["tool_error_rate"].value == 0.0
    assert s["web_gate_blocks"].value == 1.0 and s["web_query_leak_attempts"].value == 1.0


def test_required_tools_want_the_corpus_and_get_scope_for_a_named_step():
    assert _evidence()["required_tools_met"].value == 1.0
    s = _evidence(calls=[_call("graph_entity", entity="x")])
    assert s["required_tools_met"].value == 0.0 and "corpus" in s["required_tools_met"].comment
    s = _evidence(question="What does O-10-20 do?")
    assert s["required_tools_met"].value == 0.0 and "get_scope" in s["required_tools_met"].comment
    s = _evidence(question="What does O-10-20 do?",
                  calls=[_call("get_scope", code="O-10-20"), _call("search_corpus", query="x")])
    assert s["required_tools_met"].value == 1.0


def test_a_failed_search_does_not_count_as_having_searched():
    s = _evidence(calls=[_call("search_corpus", error="db down", query="x")])
    assert s["required_tools_met"].value == 0.0


def test_rejections_budget_and_a_run_that_never_submitted():
    s = _evidence(rejections=2, budget_hit=True)
    assert s["submitted_first_try"].value == 0.0 and s["budget_exhausted"].value == 1.0
    assert s["task_completed"].value == 1.0
    s = _evidence(submitted=None)
    assert s["task_completed"].value == 0.0 and s["submitted_first_try"].value == 0.0


# --- guardrails -----------------------------------------------------------------


def test_contact_details_before_and_after_redaction():
    leaked = _answer({"text": "call ops@solvay.com", "sources": [], "graph_facts": [{"id": "g"}]})
    s = _evidence(final=leaked, redacted=_answer(_claim(1)))
    assert s["contact_in_output"].value == 1.0 and s["contact_leak"].value == 0.0
    s = _evidence(final=leaked, redacted=leaked)
    assert s["contact_leak"].value == 1.0


def test_an_unreachable_scope_classifier_is_a_fail_open():
    s = _evidence(verdict={"allowed": True, "method": "unavailable", "reason": "timeout"})
    assert s["scope_guard_fail_open"].value == 1.0 and s["scope_refused"].value == 0.0
    assert _evidence()["scope_guard_fail_open"].value == 0.0


def test_a_refused_request_scores_only_the_refusal():
    s = _by_name(agent_eval.refused({"allowed": False, "category": "off_topic", "reason": "a poem"}))
    assert set(s) == {"scope_refused"} and s["scope_refused"].value == 1.0


def test_the_phrases_match_what_the_web_gate_actually_says():
    """The gate answers in sentences; if one is reworded, a count must fail
    here rather than quietly drop to zero."""
    sess = types.SimpleNamespace(holdout=False, corpus_searches=1, web_searches=0)
    saved = (web.ENABLED, web.DOMAINS, scope.check)
    web.ENABLED, web.DOMAINS = True, ("help.sap.com",)
    try:
        leak_id = web.gate(sess, "what is O-10-20 in SAP")
        leak_contact = web.gate(sess, "SAP credit block ops@solvay.com")
        scope.check = lambda q: scope.Verdict(False, "model", "weather", "off_topic")
        off = web.gate(sess, "weather in Brussels tomorrow")
    finally:
        web.ENABLED, web.DOMAINS, scope.check = saved
    calls = [_call("web_search", error=e, query="q") for e in (leak_id, leak_contact, off)]
    counts = agent_eval._web(calls)
    assert counts == {"attempts": 3, "blocked": 3, "leaks": 2, "off_topic": 1}, (counts, leak_id, off)


def test_web_query_on_topic_is_a_share_of_the_attempts_and_absent_without_any():
    calls = [_call("search_corpus", query="a"), _call("web_search", query="SAP credit management"),
             _call("web_search", error="That query is not about SAP or the programme's processes, "
                                       "so it is not searched (x).", query="football")]
    assert _evidence(calls=calls)["web_query_on_topic"].value == 0.5
    assert "web_query_on_topic" not in _evidence()


# --- Fit-Gap Copilot ------------------------------------------------------------


def _rollout_scores(**kw):
    base = dict(
        verdict=VERDICT,
        lineage_summary={"quotes": 8, "verbatim": 7, "by_status": {"traced": 5, "partial": 1, "untraced": 2}},
        gate_items=[{"gate": "QG2", "severity": "hard", "detail": "D-1: the quote … is not in chunk 4; evidence dropped"},
                    {"gate": "QG2", "severity": "hard", "detail": "D-2: chunk 9 was never retrieved in this run; evidence dropped"},
                    {"gate": "QG6", "severity": "soft", "detail": "workshop value"}],
        analysis={"deviations": [{"as_is_step_id": "S1"}, {"as_is_step_id": "S1, S2"},
                                 {"as_is_step_id": "S2, S9"}, {"as_is_step_id": "S9"},
                                 {"as_is_step_id": ""}]},
        asis={"steps": [{"step_id": "S1"}, {"step_id": "S2"}]},
        calls=[_call("read_sources", query="x"), _call("search_sap_best_practice", query="a"),
               _call("search_sap_best_practice", query="b"),
               _call("search_sap_best_practice", error="timeout", query="c")],
        sendbacks=1, budget_hit=False, min_sap=3)
    base.update(kw)
    return agent_eval.rollout(**base)


def test_rollout_citation_validity_adds_back_what_qg2_dropped():
    s = _by_name(_rollout_scores())
    assert s["citation_validity"].value == 0.7, s["citation_validity"]
    assert s["claims_unsupported"].value == 2.0


def test_rollout_topic_adherence_reads_several_steps_and_leaves_out_unplaced_deviations():
    s = _by_name(_rollout_scores())["topic_adherence"]
    assert s.value == 0.5 and "1 name no step" in s.comment, s
    s = _by_name(_rollout_scores(analysis={"deviations": [{"as_is_step_id": ""}]}))
    assert "topic_adherence" not in s


def test_rollout_required_tools_count_only_sap_searches_that_worked():
    s = _by_name(_rollout_scores())
    assert s["required_tools_met"].value == 0.0 and "2 of 3" in s["required_tools_met"].comment
    s = _by_name(_rollout_scores(min_sap=2))
    assert s["required_tools_met"].value == 1.0
    s = _by_name(_rollout_scores(min_sap=0, calls=[_call("read_sources", query="x", side="template")]))
    assert s["required_tools_met"].value == 0.0 and "As-Is" in s["required_tools_met"].comment


def test_rollout_gates_and_send_backs():
    s = _by_name(_rollout_scores())
    assert s["gate_hard_issues"].value == 2.0 and s["gate_soft_issues"].value == 1.0
    assert s["submitted_first_try"].value == 0.0 and s["task_completed"].value == 1.0


def test_rollout_run_reads_send_backs_and_budget_from_the_log():
    seen = {}
    real = agent_eval.rollout
    agent_eval.rollout = lambda **kw: seen.update(kw) or []
    lineage = types.ModuleType("rollout.lineage")
    lineage.build = lambda run: {"summary": {"quotes": 0}}
    saved = sys.modules.get("rollout.lineage")
    sys.modules["rollout.lineage"] = lineage
    import rollout
    saved_attr = getattr(rollout, "lineage", None)
    rollout.lineage = lineage
    try:
        agent_eval.rollout_run(run={"log": [{"note": "rejected"}, {"note": "rejected"}, {"note": "budget"}],
                                    "gates": {"items": [{"gate": "QG1"}]}},
                               verdict=VERDICT, min_sap=3)
    finally:
        agent_eval.rollout = real
        if saved is not None:
            sys.modules["rollout.lineage"] = saved
        if saved_attr is not None:
            rollout.lineage = saved_attr
    assert seen["sendbacks"] == 2 and seen["budget_hit"] is True
    assert seen["gate_items"] == [{"gate": "QG1"}] and seen["min_sap"] == 3


def test_an_incomplete_rollout_is_scored_as_not_completed():
    s = _by_name(agent_eval.rollout_incomplete(VERDICT, [_call("read_sources", query="x")], "no As-Is"))
    assert s["task_completed"].value == 0.0 and s["task_completed"].comment == "no As-Is"


# --- push -----------------------------------------------------------------------


def test_push_writes_stable_ids_and_skips_unknown_names():
    written = []

    class Client:
        def create_score(self, **kw):
            written.append(kw)

        def flush(self):
            pass

    saved = tracing.client
    tracing.client = lambda: Client()
    try:
        agent_eval._push("t1", [agent_eval.Score("tool_calls", 3.0),
                                agent_eval.Score("not_a_score", 1.0),
                                agent_eval.Score("task_completed", 1.0)])
        first = [w["score_id"] for w in written]
        agent_eval._push("t1", [agent_eval.Score("tool_calls", 4.0),
                                agent_eval.Score("task_completed", 0.0)])
        agent_eval.push("", [agent_eval.Score("tool_calls", 1.0)])  # no trace: nothing
    finally:
        tracing.client = saved
    assert [w["name"] for w in written] == ["tool_calls", "task_completed"] * 2
    assert [w["score_id"] for w in written[2:]] == first, "a re-score must replace, not add"
    assert written[1]["data_type"] == "BOOLEAN" and written[0]["data_type"] == "NUMERIC"


def test_a_scorer_that_raises_gives_no_scores_rather_than_an_error():
    def boom(**_):
        raise RuntimeError("scorer broke")
    assert agent_eval.evaluate(boom) == []
    assert agent_eval.evaluate(lambda: [agent_eval.Score("nope", 1.0)]) == []


def test_targets_decide_pass_and_fail_and_counts_have_no_verdict():
    S = agent_eval.Score
    assert agent_eval.passed(S("citation_validity", 1.0)) is True
    assert agent_eval.passed(S("citation_validity", 0.9)) is False
    assert agent_eval.passed(S("claims_unsupported", 0)) is True
    assert agent_eval.passed(S("claims_unsupported", 2)) is False
    assert agent_eval.passed(S("budget_exhausted", 1.0)) is False
    assert agent_eval.passed(S("tool_calls", 30)) is None
    assert agent_eval.passed(S("scope_refused", 1.0)) is None


def test_a_near_miss_is_watch_and_a_wide_one_is_below():
    S = agent_eval.Score
    assert agent_eval.status(S("citation_validity", 1.0)) == "pass"
    assert agent_eval.status(S("citation_validity", 16 / 17)) == "watch"   # the SOVOS run
    assert agent_eval.status(S("citation_validity", 0.9)) == "watch"
    assert agent_eval.status(S("citation_validity", 0.89)) == "below"
    assert agent_eval.status(S("claims_unsupported", 1)) == "below"      # no watch line
    assert agent_eval.status(S("tool_calls", 9)) is None
    r = agent_eval.report([S("citation_validity", 0.94), S("claims_unsupported", 0)])
    assert (r["passed"], r["watch"], r["judged"]) == (1, 1, 2), r


def test_a_stored_evaluation_is_re_read_against_todays_targets():
    """Saved before the Watch level existed: only name, value and comment are
    trusted; the verdict is recomputed."""
    old = {"trace_url": "u", "passed": 0, "judged": 1, "scores": [
        {"name": "citation_validity", "value": 0.9412, "comment": "16 of 17", "passed": False},
        {"name": "retired_score", "value": 1.0, "comment": ""}]}
    r = agent_eval.refresh(old)
    assert [row["name"] for row in r["scores"]] == ["citation_validity"]
    assert r["scores"][0]["status"] == "watch" and r["scores"][0]["comment"] == "16 of 17"
    assert r["trace_url"] == "u" and r["watch"] == 1
    assert agent_eval.refresh({}) == {} and agent_eval.refresh(None) == {}


def test_the_report_orders_by_metric_and_counts_what_passed():
    r = agent_eval.report(list(_evidence(budget_hit=True).values()), "https://lf/trace/1")
    metrics = [row["metric"] for row in r["scores"]]
    order = [m for m in agent_eval.METRICS if m in metrics]
    assert metrics == sorted(metrics, key=order.index), metrics
    assert r["trace_url"] == "https://lf/trace/1"
    judged = [row for row in r["scores"] if row["passed"] is not None]
    assert r["judged"] == len(judged) and r["passed"] == len(judged) - 1  # only the budget
    row = next(row for row in r["scores"] if row["name"] == "citation_validity")
    assert row["label"] and row["description"] and row["good"] == "min" and row["target"] == 1.0
    assert row["kind"] == "share"
    kinds = {row["name"]: row["kind"] for row in r["scores"]}
    assert kinds["task_completed"] == "boolean" and kinds["tool_calls"] == "count"
    import json
    json.dumps(r)  # stored as jsonb and streamed as-is


def test_every_score_has_a_known_metric_and_a_sane_target():
    for name, spec in agent_eval.SCORES.items():
        assert spec.metric in agent_eval.METRICS, name
        assert spec.good in ("", "min", "max"), name
        assert spec.label and spec.description, name


def test_zz_the_suite_never_reached_langfuse():
    import time

    time.sleep(0.2)  # let push()'s threads finish
    assert _REAL_CALLS == [], f"{len(_REAL_CALLS)} call(s) reached the Langfuse client"


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

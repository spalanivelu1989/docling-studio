"""Unit tests for the quality scoring: the arithmetic, and the row it lands in.

Run: python test_evaluation.py

Needs Postgres and nothing else. In particular it needs no Anthropic key, no
Ollama and no Langfuse, because it never calls a judge -- the judges are
stubbed at import time and one of the tests asserts that they are.

That guard is the first thing in this file for a reason. The sibling suite in
evidence/ drove a real agent run without stubbing its memory writes, and every
invocation of the tests quietly added fabricated facts to the production memory
bank; they were deleted twice and came back twice before the cause was found.
The equivalent mistake here would be a test suite that spends money on judges
and writes scores onto real Langfuse traces, which would corrupt exactly the
dashboards this feature exists to make trustworthy.

What is checked, each of which is a way scoring could be quietly wrong:

  * the overall score is the stated weighted mean, reproducible by hand from
    the terms stored beside it;
  * a judge that failed is dropped from both sides of the mean rather than
    counted as zero -- a flaky judge must not read as a quality regression;
  * a safety flag caps the total, and says which judge flagged it;
  * nothing scored produces None, not 0.0: "no judge returned" and "every
    judge said this is terrible" are opposite facts;
  * a metric value of None survives the trip through jsonb as null;
  * deleting a question deletes its evaluation, and so does retention --
    there is no second sweeper, so the cascade has to be doing it;
  * each quality filter selects the runs it claims to;
  * the score id is stable per (run, metric), so a re-score replaces rather
    than doubling every average in Langfuse;
  * every metric named in WEIGHTS, SAFETY and REFERENCE_ONLY is one the judge
    list actually produces.
"""

from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))

import ask_store  # noqa: E402
import evaluation  # noqa: E402
import rag  # noqa: E402

# ══════════════════════════════════════════════════════════════════════════
#  THE SUITE MUST NOT CALL A JUDGE AND MUST NOT WRITE TO LANGFUSE
# ══════════════════════════════════════════════════════════════════════════
# Replaced at import, before any test can run. `overall` is left alone: it is
# pure arithmetic over a dict and is most of what is being tested here.

_REAL_EVALUATE = evaluation.evaluate
_REAL_PUSH = evaluation.push_scores
_calls: list[tuple] = []


def _no_model_evaluate(question, contexts, answer, reference=""):
    _calls.append(("evaluate", question, len(contexts), len(answer)))
    raise AssertionError(
        "a test called evaluation.evaluate, which would spend money on judges")


def _no_langfuse_push(trace_id, run_id, result):
    _calls.append(("push", trace_id, run_id))
    raise AssertionError(
        "a test called evaluation.push_scores, which would write scores onto "
        "real Langfuse traces")


evaluation.evaluate = _no_model_evaluate
evaluation.push_scores = _no_langfuse_push


def _stubs():
    """An LLM and an embedder of the right TYPE that cannot be called.

    Ragas' metrics check the type of what they are handed at construction, so
    the judge list cannot be built out of bare objects; but nothing here may
    reach a model, so both stubs raise if anything actually uses them. That
    combination is the point: the tests below build every metric Ragas would
    build, and would fail loudly rather than quietly spend money."""
    from ragas.embeddings.base import BaseRagasEmbedding
    from ragas.llms.base import InstructorBaseRagasLLM

    class StubLLM(InstructorBaseRagasLLM):
        def generate(self, prompt, response_model):
            raise AssertionError("a test reached the judge model")

        async def agenerate(self, prompt, response_model):
            raise AssertionError("a test reached the judge model")

    class StubEmbedding(BaseRagasEmbedding):
        def embed_text(self, text, **_kw):
            raise AssertionError("a test reached Ollama")

        async def aembed_text(self, text, **_kw):
            raise AssertionError("a test reached Ollama")

    return StubLLM(), StubEmbedding()

TEST_DATABASE = "docling_test_evaluation"
_original_base_url = rag.base_url


def _url(name: str) -> str:
    p = urlsplit(_original_base_url())
    return urlunsplit((p.scheme, p.netloc, f"/{name}", p.query, p.fragment))


def _admin():
    import psycopg

    return psycopg.connect(_url("postgres"), autocommit=True)


def setup() -> None:
    with _admin() as c:
        c.execute(f'DROP DATABASE IF EXISTS "{TEST_DATABASE}" WITH (FORCE)')
        c.execute(f'CREATE DATABASE "{TEST_DATABASE}"')
    rag.base_url = lambda: _url(TEST_DATABASE)
    rag.close()
    rag._schema_ready = False
    ask_store.create_schema(ask_store.connect())


def teardown() -> None:
    rag.close()
    rag.base_url = _original_base_url
    with _admin() as c:
        c.execute(f'DROP DATABASE IF EXISTS "{TEST_DATABASE}" WITH (FORCE)')


def clear() -> None:
    conn = ask_store.connect()
    conn.execute("TRUNCATE TABLE ask_runs CASCADE")
    conn.commit()


def question(run_id: str, text: str = "why?", answered: bool = True) -> None:
    conn = ask_store.connect()
    ask_store.start_run(conn, {
        "id": run_id, "question": text, "mode": "hybrid", "k": 8,
        "categories": [], "answer_model": "claude-opus-5",
        "embed_model": "bge-m3", "corpus_fingerprint": "fp",
        "prompt_hash": "abc123",
    })
    if answered:
        ask_store.finish_run(conn, run_id, "an answer", {"seconds": 1.0})


def metrics(**values) -> dict:
    """{'faithfulness': 0.9} -> the shape evaluate() returns."""
    return {name: {"value": value, "reason": "", "error": "" if value is not None
                   else "TimeoutError: the judge did not answer"}
            for name, value in values.items()}


def scored(run_id: str, *, status: str = "done", **values) -> dict:
    conn = ask_store.connect()
    got = metrics(**values)
    score, safety, terms = evaluation.overall(got)
    result = {"status": status, "judge_model": "claude-sonnet-5",
              "ragas_version": "0.4.3", "seconds": 9.4, "metrics": got,
              "overall": score, "safety": safety, "terms": terms, "error": ""}
    ask_store.start_evaluation(conn, run_id, "claude-sonnet-5")
    ask_store.finish_evaluation(conn, run_id, result, pushed=len(got))
    return result


def perfect() -> dict:
    return {name: 1.0 for name in evaluation.WEIGHTS}


# --- the guard ----------------------------------------------------------------

def test_the_suite_cannot_call_a_judge_or_write_to_langfuse():
    assert evaluation.evaluate is _no_model_evaluate, "the judge stub was replaced"
    assert evaluation.push_scores is _no_langfuse_push, "the Langfuse stub was replaced"
    for stub, args in ((evaluation.evaluate, ("q", ["c"], "a")),
                       (evaluation.push_scores, ("t", "r", {}))):
        try:
            stub(*args)
        except AssertionError:
            pass
        else:
            raise AssertionError("the stub let the call through")


# --- the arithmetic -----------------------------------------------------------

def test_the_overall_score_is_the_stated_weighted_mean():
    got = metrics(**{**perfect(), "faithfulness": 0.0})
    score, _safety, terms = evaluation.overall(got)
    # Every weight but faithfulness's, over the total of all of them.
    expected = (sum(evaluation.WEIGHTS.values()) - evaluation.WEIGHTS["faithfulness"])
    assert abs(score - expected) < 1e-9, (score, expected)
    assert terms["weights"] == evaluation.WEIGHTS
    assert terms["dropped"] == []


def test_the_terms_reproduce_the_number_by_hand():
    """The whole reason the weights are stored beside the score."""
    got = metrics(faithfulness=0.8, answer_relevancy=0.6, context_precision=0.4,
                  context_relevance=None, context_utilization=1.0,
                  coherence=0.9, conciseness=0.5)
    score, _safety, terms = evaluation.overall(got)
    by_hand = sum(w * got[n]["value"] for n, w in terms["weights"].items())
    by_hand /= sum(terms["weights"].values())
    assert abs(score - by_hand) < 1e-4, (score, by_hand)


def test_a_failed_judge_is_dropped_rather_than_scored_zero():
    """A judge that timed out is not evidence of a bad answer. Counting it as
    zero would turn a flaky judge into a quality regression on the dashboard."""
    whole = evaluation.overall(metrics(**perfect()))[0]
    partial, _safety, terms = evaluation.overall(
        metrics(**{**perfect(), "faithfulness": None}))
    assert whole == 1.0, whole
    assert partial == 1.0, f"a dropped judge dragged the score to {partial}"
    assert terms["dropped"] == ["faithfulness"]
    assert "faithfulness" not in terms["weights"]
    # And the zero-scoring version really would have been different.
    as_zero, _s, _t = evaluation.overall(metrics(**{**perfect(), "faithfulness": 0.0}))
    assert as_zero < partial


def test_nothing_scored_is_none_and_not_zero():
    score, safety, terms = evaluation.overall(metrics(**{n: None for n in evaluation.WEIGHTS}))
    assert score is None, score
    assert safety is None, safety
    assert terms["weights"] == {}


def test_a_safety_flag_caps_the_total_and_names_the_judge():
    got = metrics(**perfect(), harmfulness=1.0, maliciousness=0.0)
    score, safety, terms = evaluation.overall(got)
    assert score == evaluation.SAFETY_CAP, score
    assert safety == 0.0, safety
    assert terms["capped"] is True
    assert terms["flagged"] == ["harmfulness"]


def test_a_clean_safety_judgement_does_not_cap_anything():
    got = metrics(**perfect(), harmfulness=0.0, maliciousness=0.0)
    score, safety, terms = evaluation.overall(got)
    assert score == 1.0, score
    assert safety == 1.0, safety
    assert terms["capped"] is False and terms["flagged"] == []


def test_safety_is_none_when_no_safety_judge_ran():
    """Distinct from 1.0. "Nothing flagged it" and "nothing looked" are
    different, and only one of them should read as safe."""
    _score, safety, _terms = evaluation.overall(metrics(**perfect()))
    assert safety is None, safety


def test_the_cap_is_a_cap_and_not_a_floor():
    got = metrics(**{n: 0.05 for n in evaluation.WEIGHTS}, harmfulness=1.0)
    score, _safety, _terms = evaluation.overall(got)
    assert score < evaluation.SAFETY_CAP, (
        f"a flagged but already-bad answer was lifted to {score}")


def test_a_judge_answering_in_words_becomes_a_number():
    assert evaluation._value("harmfulness", "yes") == 1.0
    assert evaluation._value("harmfulness", "No") == 0.0
    assert evaluation._value("coherence", "0.5") == 0.5
    assert evaluation._value("coherence", None) is None
    assert evaluation._value("coherence", "not a number") is None
    assert evaluation._value("coherence", float("nan")) is None, "NaN scored as a number"
    assert evaluation._value("coherence", 1.4) == 1.0, "an out-of-range score was not clamped"
    assert evaluation._value("coherence", -2) == 0.0


def test_the_weights_sum_to_one():
    total = sum(evaluation.WEIGHTS.values())
    assert abs(total - 1.0) < 1e-9, f"the weights sum to {total}, so the mean is not one"


def test_every_named_metric_is_one_the_judges_produce():
    """WEIGHTS, SAFETY and REFERENCE_ONLY are read by the UI, the Langfuse
    push and the filters. A name in one of them that no judge emits is a tile
    that renders forever empty."""
    llm, embeddings = _stubs()
    produced = {name for name, _m, _kw in evaluation._jobs(
        llm, embeddings, "q", ["c"], "a", "reference")}
    for group in (evaluation.WEIGHTS, evaluation.REFERENCE_ONLY):
        for name in group:
            assert name in produced, f"{name} is weighted but never judged"
    for name in ("harmfulness", "maliciousness"):
        assert name in produced, f"{name} is a default safety judge but never runs"
    assert set(evaluation.RUBRICS) >= (set(evaluation.SAFETY) | {"coherence", "conciseness"})


def test_the_reference_only_metrics_do_not_run_without_a_reference():
    llm, embeddings = _stubs()
    online = {name for name, _m, _kw in evaluation._jobs(
        llm, embeddings, "q", ["c"], "a", "")}
    for name in evaluation.REFERENCE_ONLY:
        assert name not in online, (
            f"{name} needs a reference answer and live traffic has none; "
            "scoring it against nothing would invent the reference")
    assert "faithfulness" in online


def test_reference_only_metrics_never_reach_the_overall_score():
    got = metrics(**perfect(), correctness=0.0, context_recall=0.0)
    score, _safety, terms = evaluation.overall(got)
    assert score == 1.0, (
        "an offline metric moved the online score, so a run scored with a "
        "reference is not comparable with one scored without")
    assert "correctness" not in terms["weights"]


# --- the judge's working ------------------------------------------------------
#
# Ragas discards its own reasoning, so evaluation.py intercepts it at the judge
# LLM and normalises it. These tests drive the normaliser with hand-made
# responses: no model is called, and the shapes are the ones the drawer draws.


class _Fake:
    """A Ragas response model, as far as the normaliser is concerned."""

    def __init__(self, **fields):
        self._fields = fields

    def model_dump(self):
        return self._fields


def _issued(*rows):
    """(model, fields) pairs, numbered in the order they were issued.

    Not named _calls: that is the list the stub guard at the top of this file
    records into, and shadowing it made the guard fail rather than the thing
    under test."""
    return [(n, model, _Fake(**fields)) for n, (model, fields) in enumerate(rows)]


def test_a_per_excerpt_verdict_is_numbered_by_the_order_it_was_issued():
    """The attribution the whole excerpt view rests on.

    Ragas judges the excerpts concurrently, so the order the responses ARRIVE
    in says nothing -- but it builds one task per excerpt in excerpt order, so
    the order they were ISSUED is the ranking. Checked against a live judge
    with a marker planted in each excerpt before being relied on here."""
    calls = _issued(
        ("ContextPrecisionOutput", {"verdict": 1, "reason": "first"}),
        ("ContextPrecisionOutput", {"verdict": 0, "reason": "second"}),
        ("ContextPrecisionOutput", {"verdict": 1, "reason": "third"}),
    )
    # Arriving out of order, which is the normal case.
    shuffled = [calls[2], calls[0], calls[1]]
    got = evaluation._working(shuffled, ["a", "b", "c"])
    assert got["kind"] == "excerpts", got
    assert [i["n"] for i in got["items"]] == [1, 2, 3], got["items"]
    assert [i["reason"] for i in got["items"]] == ["first", "second", "third"], (
        "the verdicts were re-ordered by arrival, so each one names the wrong excerpt")
    assert [i["useful"] for i in got["items"]] == [True, False, True]


def test_an_excerpt_verdict_is_left_unnumbered_when_the_counts_disagree():
    """A wrongly numbered verdict points at the wrong document, which is worse
    than an unnumbered one. If Ragas ever stops making one call per excerpt,
    this is what keeps the drawer honest."""
    calls = _issued(("ContextPrecisionOutput", {"verdict": 1, "reason": "only one"}))
    got = evaluation._working(calls, ["a", "b", "c"])
    assert [i["n"] for i in got["items"]] == [None], got["items"]


def test_faithfulness_working_is_one_row_per_claim():
    calls = _issued(
        ("StatementGeneratorOutput", {"statements": ["a", "b"]}),
        ("NLIStatementOutput", {"statements": [
            {"statement": "SOVOS signs it", "verdict": 1, "reason": "the context says so"},
            {"statement": "400,000 a month", "verdict": 0, "reason": "no volume is given"},
        ]}),
    )
    got = evaluation._working(calls, ["a"])
    assert got["kind"] == "claims", got
    assert len(got["items"]) == 2
    assert got["items"][0]["supported"] is True
    assert got["items"][1]["supported"] is False
    assert got["items"][1]["reason"] == "no volume is given"


def test_context_relevance_working_is_per_judge_and_not_per_excerpt():
    """It only looks per-excerpt. Two prompts each rate the WHOLE retrieved
    set, so numbering them as excerpts invents a breakdown that does not
    exist -- which an earlier version did, labelling both 'excerpt 1'."""
    calls = _issued(("ContextRelevanceOutput", {"rating": 2}),
                   ("ContextRelevanceOutput", {"rating": 1}))
    got = evaluation._working(calls, ["a", "b", "c"])
    assert got["kind"] == "ratings", got
    assert [i["judge"] for i in got["items"]] == [1, 2]
    assert [i["rating"] for i in got["items"]] == [2, 1]
    assert [i["label"] for i in got["items"]] == ["relevant", "partly relevant"]
    assert all("n" not in i for i in got["items"]), (
        "a rating carrying an excerpt number reads as a per-excerpt verdict")


def test_answer_relevancy_working_is_the_questions_the_judge_invented():
    calls = _issued(
        ("AnswerRelevanceOutput", {"question": "Who signs the invoice?", "noncommittal": 0}),
        ("AnswerRelevanceOutput", {"question": "What signs it?", "noncommittal": 1}),
    )
    got = evaluation._working(calls, ["a"])
    assert got["kind"] == "questions", got
    assert got["items"][0]["noncommittal"] is False
    assert got["items"][1]["noncommittal"] is True


def test_an_unrecognised_response_model_produces_no_working():
    """The rubric judges return a reason instead, and a half-understood shape
    drawn as though it were understood is worse than an absent section."""
    assert evaluation._working(_issued(("SomethingNew", {"x": 1})), ["a"]) == {}
    assert evaluation._working([], ["a"]) == {}


def test_the_working_survives_the_database():
    clear()
    question("ask_w")
    conn = ask_store.connect()
    got = metrics(**perfect())
    got["faithfulness"]["working"] = evaluation._working(_issued(
        ("NLIStatementOutput", {"statements": [
            {"statement": "a claim", "verdict": 0, "reason": "not supported"}]}),
    ), ["a"])
    score, safety, terms = evaluation.overall(got)
    ask_store.start_evaluation(conn, "ask_w", "claude-sonnet-5")
    ask_store.finish_evaluation(conn, "ask_w", {
        "status": "done", "judge_model": "claude-sonnet-5", "metrics": got,
        "overall": score, "safety": safety, "terms": terms})
    back = ask_store.get_evaluation(conn, "ask_w")
    claim = back["metrics"]["faithfulness"]["working"]["items"][0]
    assert claim["supported"] is False, claim
    assert claim["reason"] == "not supported", claim


def test_the_recorder_does_not_change_what_the_judge_returns():
    """It is a tap, not a filter. If wrapping agenerate could alter a response
    the scores would depend on whether anyone was looking."""
    import inspect

    source = inspect.getsource(evaluation._install_recorder)
    assert "response = await original(prompt, response_model)" in source
    assert "return response" in source
    assert "order = len(sink)" in source, (
        "the position must be taken before the await, or it records completion "
        "order and every excerpt verdict names the wrong excerpt")
    assert source.index("order = len(sink)") < source.index("await original"), (
        "the position is taken after the await, which is arrival order")


# --- Langfuse score identity --------------------------------------------------

def test_the_score_id_is_stable_per_run_and_metric():
    first = evaluation.score_id("ask_abc", "faithfulness")
    assert first == evaluation.score_id("ask_abc", "faithfulness")
    assert first != evaluation.score_id("ask_abc", "coherence")
    assert first != evaluation.score_id("ask_xyz", "faithfulness")


def test_the_safety_judges_go_to_langfuse_as_booleans():
    assert evaluation.BOOLEAN == set(evaluation.SAFETY)
    assert "faithfulness" not in evaluation.BOOLEAN


def test_scoring_is_skipped_rather_than_attempted_when_unavailable():
    """evaluate() returns instead of raising, and says why -- so the row says
    'not scored because X' rather than being absent."""
    was = evaluation.ENABLED
    try:
        evaluation.ENABLED = False
        result = _REAL_EVALUATE("q", ["c"], "a")
    finally:
        evaluation.ENABLED = was
    assert result["status"] == "skipped", result["status"]
    assert "RAG_EVAL=off" in result["error"], result["error"]
    assert result["overall"] is None


def test_evaluate_refuses_a_running_event_loop_rather_than_failing_silently():
    """The bug this is here for: the experiment runner calls its evaluators
    from inside its own loop, where asyncio.run() raises. The generic handler
    turned that into status "failed", so an experiment produced three
    scored-looking runs carrying no scores and said nothing about why."""
    import asyncio

    async def inside():
        return _REAL_EVALUATE("q", ["c"], "a")

    result = asyncio.run(inside())
    assert result["status"] == "failed", result["status"]
    assert "running event loop" in result["error"], result["error"]
    assert "aevaluate" in result["error"], "the error does not say what to call instead"


def test_the_experiment_awaits_the_async_evaluator():
    import inspect

    import evaluation as ev

    assert inspect.iscoroutinefunction(ev.aevaluate)
    source = inspect.getsource(ev.run_experiment)
    assert "async def judges" in source and "await aevaluate" in source, (
        "the experiment's evaluator would call the sync entry point from "
        "inside the runner's loop, which scores nothing")


def test_an_empty_run_is_not_sent_to_a_judge():
    for question_text, contexts, answer in (("", ["c"], "a"), ("q", [], "a"), ("q", ["c"], "")):
        result = _REAL_EVALUATE(question_text, contexts, answer)
        assert result["status"] == "skipped", (question_text, contexts, answer)
        assert "Nothing to score" in result["error"]


def test_sampling_at_zero_judges_nothing_and_at_one_judges_everything():
    was = evaluation.SAMPLE
    try:
        evaluation.SAMPLE = 0.0
        assert not any(evaluation.wanted() for _ in range(20))
        evaluation.SAMPLE = 1.0
        assert all(evaluation.wanted() for _ in range(20))
    finally:
        evaluation.SAMPLE = was


# --- the row ------------------------------------------------------------------

def test_an_evaluation_is_recorded_before_it_finishes():
    """A server that dies mid-judgement leaves behind the fact that it was
    judging, rather than a run that looks as though nobody ever tried."""
    clear()
    question("ask_1")
    conn = ask_store.connect()
    ask_store.start_evaluation(conn, "ask_1", "claude-sonnet-5")
    row = ask_store.get_evaluation(conn, "ask_1")
    assert row["status"] == "running", row
    assert row["judge_model"] == "claude-sonnet-5"
    assert row["overall"] is None and row["metrics"] == {}


def test_a_none_value_survives_jsonb_as_null():
    clear()
    question("ask_2")
    scored("ask_2", **{**perfect(), "context_relevance": None})
    row = ask_store.get_evaluation(ask_store.connect(), "ask_2")
    assert row["metrics"]["context_relevance"]["value"] is None, (
        "a judge that did not answer came back as a number")
    assert row["metrics"]["faithfulness"]["value"] == 1.0


def test_a_re_score_replaces_rather_than_duplicating():
    clear()
    question("ask_3")
    scored("ask_3", **{**perfect(), "faithfulness": 0.1})
    first = ask_store.get_evaluation(ask_store.connect(), "ask_3")["overall"]
    scored("ask_3", **perfect())
    conn = ask_store.connect()
    second = ask_store.get_evaluation(conn, "ask_3")
    count = conn.execute("SELECT count(*) FROM ask_evaluations WHERE run_id = 'ask_3'").fetchone()[0]
    assert count == 1, f"{count} evaluations for one question"
    assert second["overall"] > first, (first, second["overall"])


def test_starting_a_re_score_clears_the_old_numbers():
    """Otherwise a failed re-score leaves the previous score showing under a
    'running' badge, which reads as a fresh result."""
    clear()
    question("ask_4")
    scored("ask_4", **perfect())
    conn = ask_store.connect()
    ask_store.start_evaluation(conn, "ask_4", "claude-sonnet-5")
    row = ask_store.get_evaluation(conn, "ask_4")
    assert row["overall"] is None and row["metrics"] == {} and row["safety"] is None, row


def test_a_skipped_evaluation_is_not_a_failed_one():
    clear()
    question("ask_5")
    conn = ask_store.connect()
    ask_store.start_evaluation(conn, "ask_5", "claude-sonnet-5")
    ask_store.finish_evaluation(conn, "ask_5", {
        "status": "skipped", "judge_model": "claude-sonnet-5",
        "error": "Not scored: sampling is at 0.25."})
    row = ask_store.get_evaluation(conn, "ask_5")
    assert row["status"] == "skipped", row["status"]
    assert row["overall"] is None


def test_an_evaluation_that_never_reported_reads_as_abandoned():
    clear()
    question("ask_6")
    conn = ask_store.connect()
    ask_store.start_evaluation(conn, "ask_6", "claude-sonnet-5")
    long_ago = datetime.now(timezone.utc) - timedelta(
        minutes=ask_store.EVAL_STALE_AFTER_MINUTES + 1)
    conn.execute("UPDATE ask_evaluations SET started_at = %s WHERE run_id = 'ask_6'",
                 (long_ago,))
    conn.commit()
    assert ask_store.get_evaluation(conn, "ask_6")["status"] == "abandoned"
    # Reported, not rewritten: the stored row still says what happened.
    stored = conn.execute("SELECT status FROM ask_evaluations WHERE run_id = 'ask_6'").fetchone()[0]
    assert stored == "running", stored


def test_the_trace_id_and_prompt_hash_are_kept_with_the_question():
    clear()
    question("ask_7")
    conn = ask_store.connect()
    ask_store.save_trace(conn, "ask_7", "0620abcd")
    run = ask_store.get_run(conn, "ask_7")
    assert run["trace_id"] == "0620abcd", run["trace_id"]
    assert run["prompt_hash"] == "abc123", (
        "without it, two scores either side of a prompt edit look comparable")


# --- deletion -----------------------------------------------------------------

def test_deleting_a_question_deletes_its_evaluation():
    clear()
    question("ask_8")
    question("ask_9")
    scored("ask_8", **perfect())
    scored("ask_9", **perfect())
    conn = ask_store.connect()
    assert ask_store.delete_run(conn, "ask_8")
    assert ask_store.get_evaluation(conn, "ask_8") is None, "an orphaned evaluation"
    assert ask_store.get_evaluation(conn, "ask_9") is not None, "the wrong one went"


def test_retention_takes_the_evaluations_with_it():
    """There is no second sweeper, so the cascade has to be doing this."""
    clear()
    conn = ask_store.connect()
    for n in range(5):
        question(f"ask_t{n}")
        scored(f"ask_t{n}", **perfect())
    assert conn.execute("SELECT count(*) FROM ask_evaluations").fetchone()[0] == 5
    ask_store.trim(conn, keep=2)
    left = conn.execute("SELECT count(*) FROM ask_evaluations").fetchone()[0]
    assert left == 2, f"{left} evaluations survived a trim to 2 questions"


def test_clearing_the_history_clears_the_evaluations():
    clear()
    question("ask_c")
    scored("ask_c", **perfect())
    conn = ask_store.connect()
    ask_store.clear(conn)
    assert conn.execute("SELECT count(*) FROM ask_evaluations").fetchone()[0] == 0


# --- the filters --------------------------------------------------------------

def _corpus() -> None:
    """Four questions: one good, one poor, one unsafe, one never scored."""
    clear()
    for run_id in ("ask_good", "ask_poor", "ask_unsafe", "ask_none"):
        question(run_id, text=f"question for {run_id}")
    scored("ask_good", **perfect(), harmfulness=0.0, maliciousness=0.0)
    scored("ask_poor", **{**perfect(), "faithfulness": 0.0, "context_precision": 0.0},
           harmfulness=0.0, maliciousness=0.0)
    scored("ask_unsafe", **perfect(), harmfulness=1.0, maliciousness=0.0)


def _ids(quality: str) -> set[str]:
    return {r["id"] for r in ask_store.list_runs(ask_store.connect(), quality=quality)}


def test_the_low_quality_filter_finds_the_low_quality_run():
    _corpus()
    found = _ids("low")
    assert "ask_poor" in found, found
    assert "ask_good" not in found, "a good answer was called low quality"
    assert "ask_none" not in found, "an unscored run cannot be known to be low quality"


def test_the_unfaithful_filter_reads_the_metric_and_not_the_total():
    _corpus()
    # An answer flagged unsafe but perfectly faithful must not appear here.
    found = _ids("unfaithful")
    assert found == {"ask_poor"}, found


def test_the_unsafe_filter_finds_only_the_flagged_run():
    _corpus()
    assert _ids("unsafe") == {"ask_unsafe"}, _ids("unsafe")


def test_the_unscored_filter_includes_a_run_with_no_evaluation_at_all():
    _corpus()
    found = _ids("unscored")
    assert "ask_none" in found, (
        "a question that was never judged has no row, so a plain join misses it")
    assert "ask_good" not in found


def test_an_unknown_filter_returns_everything_rather_than_failing():
    """A browser holding a stale filter should get the list, not a 400."""
    _corpus()
    assert len(_ids("nonsense")) == 4
    assert len(_ids("")) == 4


def test_the_list_carries_enough_to_badge_a_row():
    _corpus()
    rows = {r["id"]: r for r in ask_store.list_runs(ask_store.connect())}
    assert rows["ask_good"]["overall"] == 1.0
    assert rows["ask_good"]["eval_status"] == "done"
    assert rows["ask_unsafe"]["safety"] == 0.0
    assert rows["ask_none"]["eval_status"] == "", rows["ask_none"]["eval_status"]
    assert rows["ask_none"]["overall"] is None


def test_a_quality_filter_and_a_search_narrow_together():
    _corpus()
    conn = ask_store.connect()
    both = ask_store.list_runs(conn, search="ask_poor", quality="low")
    assert [r["id"] for r in both] == ["ask_poor"], both
    assert ask_store.list_runs(conn, search="ask_good", quality="low") == []


def test_the_summary_counts_the_scored_runs():
    _corpus()
    summary = ask_store.stats(ask_store.connect())
    assert summary["scored"] == 3, summary
    # Two, not one: the flagged run's overall was capped at SAFETY_CAP, which
    # is below the line. That is what the cap is for -- a run needing a human
    # should sort with the failures, not sit at the top of the list on the
    # strength of its faithfulness score.
    assert summary["low_quality"] == 2, summary
    assert summary["unsafe"] == 1, summary
    assert summary["mean_overall"] is not None


def main() -> int:
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    setup()
    failed = 0
    try:
        for fn in tests:
            try:
                fn()
            except Exception as exc:
                failed += 1
                print(f"  FAIL {fn.__name__}: {exc.__class__.__name__}: {exc}")
            else:
                print(f"  ok   {fn.__name__}")
    finally:
        teardown()
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

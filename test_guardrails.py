"""The agents' guardrails: scope, gated web search, no contact details.

Run: python test_guardrails.py

No model, no web, no Langfuse, no database: the classifier and the search are
replaced with stubs at import, and one test asserts that they are, so a
change here cannot turn a suite run into billed calls or a trace.
"""

from __future__ import annotations

import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import guardrails  # noqa: E402
from guardrails import contact, scope, web  # noqa: E402

# ═══ stubs, installed before anything can call out ═══════════════════════════
_classified: list[str] = []
_verdicts: dict[str, str] = {}   # text -> category the "classifier" returns


def _fake_classify(text: str) -> scope.Verdict:
    _classified.append(text)
    cat = _verdicts.get(text, "in_scope")
    return scope.Verdict(cat == "in_scope", "model", f"stub: {cat}", cat)


scope._classify = _fake_classify
_searched: list[str] = []
_pages: list[dict] = []


def _fake_search(query: str):
    _searched.append(query)
    return [dict(p) for p in _pages], {"input_tokens": 0, "output_tokens": 0,
                                       "web_search_requests": 1}


web._search = _fake_search


def _fresh():
    _classified.clear()
    _verdicts.clear()
    _searched.clear()
    _pages.clear()
    scope._cache.clear()


def _session(**kw):
    from fitgap import tools as ftools
    return ftools.Session(**kw)


# ═══ contact details ═════════════════════════════════════════════════════════

REMOVED = ["Mail john.doe@solvay.com today", "write to J.Doe+ops@BASF.COM.", "Call +44 20 7946 0958 now",
           "Tel: 7946 0958", "Phone (020) 7946-0958", "Mobile: 98450 12345", "0044 20 7946 0958",
           "+91-80-4123-4567", "Tél. 01 23 45 67 89", "020 7946 0958", "800-555-0123 x",
           "Tel: 86-21-61091770  Fax: 86-21-61091769", "<PhoneNumber>+39 (02) 290921</PhoneNumber>"]
# Every one of these is a shape found in the corpus that an earlier, looser
# rule removed. Each is a regression test for a real false positive.
KEPT = ["BPML M-090-030-010 step", "section 7.1.12.3 owner", "sales order 4500012345 created",
        "on 2024-01-15 we", "above INR 5,00,000 -> credit committee", "ticket SPARK-22877",
        "O-020-090 Handle Orders", "12.500 kg", "version 1.2.3", "Sales Order Number | 0006206459",
        "13.02.2024 12 EA", "000010 (0001)", "1-090-020-370", "Week 1 (12.05 - 16.05)",
        "11-05-2025 02", "0-020-090 7", "30 50 60 70", "26 2005 10", "01.-06-2026"]


def test_contact_details_are_removed():
    for text in REMOVED:
        out = contact.redact(text)
        assert contact.MASK in out, f"not removed: {text!r} -> {out!r}"
        assert "@" not in out and "7946" not in out and "12345" not in out, out


def test_numbers_that_are_not_phone_numbers_survive():
    for text in KEPT:
        assert contact.redact(text) == text, f"damaged: {text!r} -> {contact.redact(text)!r}"


def test_redaction_reaches_every_string_in_a_record_and_leaves_the_rest():
    rec = {"answer": "ask a@b.co", "claims": [{"text": "Tel: 7946 0958", "score": 0.5}],
           "n": 3, "ok": True, "none": None, "t": ("x@y.org",)}
    out = contact.redact_obj(rec)
    assert out["answer"] == f"ask {contact.MASK}"
    assert out["claims"][0] == {"text": f"Tel: {contact.MASK}", "score": 0.5}
    assert out["n"] == 3 and out["ok"] is True and out["none"] is None
    assert out["t"] == (contact.MASK,)


# ═══ scope ═══════════════════════════════════════════════════════════════════

def test_the_suite_cannot_reach_a_model_or_the_web():
    assert scope._classify is _fake_classify and web._search is _fake_search


def test_a_programme_signal_is_in_scope_without_asking_the_classifier():
    _fresh()
    for q in ("Who owns 7.1.12.3 Production Declaration?", "Which tickets touch SPARK-22877?",
              "How is credit management configured in S/4HANA?", "What does M-090-030-010 cover?",
              "How does Salesforce hand orders to the ERP?"):
        v = scope.check(q)
        assert v.allowed and v.method == "signal", (q, v)
    assert not _classified, f"the classifier was asked: {_classified}"


def test_an_unrelated_question_is_refused():
    _fresh()
    _verdicts["Write a poem about the sea"] = "off_topic"
    _verdicts["Give me Marta's phone number"] = "contact_request"
    for q in _verdicts:
        v = scope.check(q)
        assert not v.allowed and v.method == "model", (q, v)


def test_a_classifier_that_cannot_be_reached_lets_the_question_through_and_says_so():
    _fresh()
    real = scope._classify

    def down(text):
        raise TimeoutError("no network")
    scope._classify = down
    try:
        v = scope.check("What happens when an order is blocked?")
    finally:
        scope._classify = real
    assert v.allowed and v.method == "unavailable" and "TimeoutError" in v.reason


def test_nothing_typed_is_nothing_to_refuse():
    assert scope.check("").allowed and scope.check(None).method == "empty"


def test_the_guard_can_be_switched_off():
    _fresh()
    _verdicts["tell me a joke"] = "off_topic"
    scope.ENABLED = False
    try:
        assert scope.check("tell me a joke").method == "off"
    finally:
        scope.ENABLED = True
    assert not scope.check("tell me a joke").allowed


# ═══ the agents refuse before they run ═══════════════════════════════════════

class _NoModel:
    def __init__(self, *a, **k):
        raise AssertionError("an agent model client was created for a refused question")


def test_the_evidence_agent_refuses_without_starting_a_run():
    from evidence import agent as ev_agent

    _fresh()
    q = "What is the capital of France?"
    _verdicts[q] = "general_knowledge"
    fake = types.ModuleType("anthropic")
    fake.Anthropic = _NoModel
    real_mod = sys.modules.get("anthropic")
    real_trace = ev_agent.tracing.start_run
    ev_agent.tracing.start_run = lambda *a, **k: types.SimpleNamespace(end=lambda **kw: None)
    sys.modules["anthropic"] = fake
    try:
        events = list(ev_agent.run(q))
    finally:
        ev_agent.tracing.start_run = real_trace
        if real_mod is not None:
            sys.modules["anthropic"] = real_mod
    kinds = [k for k, _ in events]
    assert "tool_call" not in kinds and kinds[-1] == "answer", kinds
    answer = events[-1][1]
    assert answer["answer"] == guardrails.REFUSAL and answer["state"] == "not_in_corpus"
    assert not answer["claims"] and answer["tool_calls"] == 0
    note = next(d for k, d in events if k == "note")
    assert note["kind"] == "guardrail" and note["detail"]["category"] == "general_knowledge"


def test_insightlens_and_the_fit_gap_copilot_refuse_an_unrelated_question():
    from fitgap import orchestrator as fg
    from fitgap.schemas import RunRequest as FgRequest
    from rollout import orchestrator as ro
    from rollout.schemas import RunRequest as RoRequest

    _fresh()
    q = "Who won the football world cup?"
    _verdicts[q] = "general_knowledge"
    for name, events in (("InsightLens", fg.run(FgRequest(question=q))),
                         ("Fit-Gap Copilot", ro.run(RoRequest(question=q, upload_session="x")))):
        kind, data = next(events)
        assert kind == "error" and data.get("refused"), (name, kind, data)
        assert data["message"].startswith(guardrails.REFUSAL), (name, data)


def test_a_run_with_no_question_typed_is_not_refused():
    from rollout import orchestrator as ro
    from rollout.schemas import RunRequest as RoRequest

    _fresh()
    kind, data = next(ro.run(RoRequest(upload_session="")))
    assert kind == "error" and not data.get("refused"), data   # fails later, for its own reason


def test_every_agent_prompt_carries_the_policy():
    from evidence import agent as ev_agent
    from fitgap import agent as fg_agent
    from rollout import agent as ro_agent
    from rollout.schemas import SUBJECTS

    prompts = [ev_agent.SYSTEM, fg_agent.SYSTEM_A, fg_agent.SYSTEM_B]
    for s in SUBJECTS.values():
        prompts += [ro_agent.system_subject(s), ro_agent.system_compare(s)]
    assert all(guardrails.POLICY in p for p in prompts)


# ═══ web search: offered, and gated ══════════════════════════════════════════

def test_every_agent_can_ask_for_the_web_and_every_one_goes_through_the_gate():
    from evidence import agent as ev_agent
    from fitgap import tools as fg_tools
    from rollout import tools as ro_tools

    for dispatch in (ev_agent.DISPATCH, fg_tools.DISPATCH, ro_tools.DISPATCH):
        assert dispatch.get("web_search") is web.search


def test_the_tool_is_offered_only_when_web_search_is_on_and_not_in_holdout():
    assert web.definitions(_session()) == [web.DEFINITION]
    assert web.definitions(_session(holdout=True)) == []
    web.ENABLED = False
    try:
        assert web.definitions(_session()) == []
        assert "switched off" in web.search(_session(corpus_searches=1), "SAP credit check")["error"]
    finally:
        web.ENABLED = True


def test_the_web_is_closed_until_the_corpus_has_been_searched():
    _fresh()
    out = web.search(_session(), "SAP S/4HANA credit check reaction")
    assert out.get("gated") and "corpus first" in out["error"] and not _searched


def test_internal_identifiers_and_contact_details_never_leave_in_a_query():
    _fresh()
    s = _session(corpus_searches=1)
    for q in ("SPARK-22877 credit block", "what is O-020-090 in SAP", "SAP contact a@b.com"):
        assert web.search(s, q).get("gated"), q
    assert not _searched and s.web_searches == 0


def test_an_off_topic_query_is_not_searched():
    _fresh()
    _verdicts["best pizza in Brussels"] = "off_topic"
    out = web.search(_session(corpus_searches=1), "best pizza in Brussels")
    assert out.get("gated") and not _searched


def test_the_budget_is_enforced_per_run():
    _fresh()
    s = _session(corpus_searches=1)
    for _ in range(web.MAX_SEARCHES):
        assert not web.search(s, "SAP S/4HANA credit check reaction").get("error")
    assert "budget" in web.search(s, "SAP S/4HANA credit check reaction")["error"]
    assert len(_searched) == web.MAX_SEARCHES


def test_web_results_are_recorded_as_external_evidence_the_verifier_can_check():
    from fitgap import verifier

    _fresh()
    _pages.append({"url": "https://help.sap.com/docs/credit", "title": "Credit Check",
                   "passages": ["With the error reaction, the system doesn't allow the creation "
                                "of the sales document. Call +44 20 7946 0958."]})
    s = _session(corpus_searches=1)
    out = web.search(s, "SAP credit check error reaction", reason="corpus silent")
    [hit] = out["results"]
    assert hit["chunk_id"] == "WEB:1" and hit["external"] and out["external"]
    rec = s.retrieved["WEB:1"]
    assert rec["category"] == "WEB" and rec["source"] == "https://help.sap.com/docs/credit"
    assert contact.MASK in rec["full_text"], "a phone number on a web page reached the agent"
    assert verifier.quote_in_chunk("the system doesn't allow the creation of the sales document",
                                   rec["full_text"])
    assert s.web_log[0]["reason"] == "corpus silent"


def test_a_page_off_the_allow_list_is_dropped_even_if_the_api_returns_it():
    cite = lambda url: types.SimpleNamespace(url=url, cited_text="text &amp; more", title="T")
    block = types.SimpleNamespace(citations=[cite("https://help.sap.com/a"), cite("https://evil.example/b"),
                                             cite("https://notsap.com/c")])
    got = web.pages([block])
    assert [p["url"] for p in got] == ["https://help.sap.com/a"]
    assert got[0]["passages"] == ["text & more"]


def test_a_claim_resting_only_on_the_web_scores_below_one_from_the_programme():
    from evidence import scoring
    from evidence.schemas import Claim, Source

    web_rec = {"full_text": "x", "external": True, "source": "https://help.sap.com/a", "doc": "SAP"}
    doc_rec = {"full_text": "x", "source": "solvay-spark/pkg/markdown/a.md", "doc": "A"}
    web_only = Claim(text="SAP blocks the order.", sources=[
        Source(chunk_id="WEB:1", doc="SAP", quote="x", stance="supports")])
    mixed = Claim(text="SAP blocks the order.", sources=[
        Source(chunk_id="WEB:1", doc="SAP", quote="x", stance="supports"),
        Source(chunk_id="PKG:1", doc="A", quote="x", stance="supports")])
    retrieved = {"WEB:1": web_rec, "PKG:1": doc_rec}
    a = scoring.score(web_only, retrieved)
    b = scoring.score(mixed, retrieved)
    assert a.score <= scoring.CAP_EXTERNAL and any(t.rule == "external_only" for t in a.score_terms)
    assert not any(t.rule == "external_only" for t in b.score_terms)


# ═══ Ask RAG ═════════════════════════════════════════════════════════════════

def _quiet_trace(module):
    """A Run stand-in, so a test never writes a trace to Langfuse."""
    class _Step:
        def __enter__(self):
            return self
        def __exit__(self, *a):
            return False
        def update(self, **k):
            pass
    run = types.SimpleNamespace(trace_id="", url=lambda: "", end=lambda **k: None,
                                step=lambda *a, **k: _Step())
    real = module.tracing.start_run
    module.tracing.start_run = lambda *a, **k: run
    return real


def test_ask_rag_refuses_before_it_searches_anything():
    import rag

    _fresh()
    q = "Write a poem"
    _verdicts[q] = "off_topic"
    real_trace = _quiet_trace(rag)
    real_embed = rag.embed

    def no_embed(*a, **k):
        raise AssertionError("the question was embedded, so the corpus was about to be searched")
    rag.embed = no_embed
    try:
        events = list(rag.ask_events(q))
    finally:
        rag.embed = real_embed
        rag.tracing.start_run = real_trace
    kinds = [k for k, _ in events]
    assert "".join(d for k, d in events if k == "token") == guardrails.REFUSAL
    assert dict(events)["sources"] == [] and kinds[-1] == "done"
    done = events[-1][1]
    assert done["refused"] and done["input_tokens"] == 0 and done["guardrail"]["category"] == "off_topic"


def test_ask_rag_streams_excerpts_and_answer_without_contact_details():
    import rag

    _fresh()
    hit = rag.Hit(**{f: None for f in rag.Hit.__dataclass_fields__}) if hasattr(rag, "Hit") else None
    assert hit is not None, "rag.Hit changed shape; update this test"
    hit = rag.Hit(**{**{f: None for f in rag.Hit.__dataclass_fields__},
                     "title": "Credit SOP", "heading_path": "Contacts", "category": "PKG",
                     "source": "x.md", "score": 0.1, "similarity": 0.5, "bm25": 0.1,
                     "vector_rank": 1, "keyword_rank": 1,
                     "content": "Escalate to ar.desk@solvay.com, Tel: +33 1 53 56 30 00."})
    pieces = ["Escalate to the AR desk at ar.", "desk@sol", "vay.com or +33 1 ", "53 56 30 00", ". Order 4500012345."]
    real = (rag.embed, rag.rank, rag._load_hits, rag.answer_stream, rag.query_terms, rag.connection)
    real_trace = _quiet_trace(rag)
    rag.embed = lambda texts, kind: [[0.0] * 4]
    rag.query_terms = lambda conn, q: ["credit"]
    rag.connection = lambda *a, **k: None
    rag.rank = lambda q, v, mode, scope: (None, [(1, 0.5)], [(1, 0.1)])
    rag._load_hits = lambda conn, fused, vector, keyword: [hit]
    rag.answer_stream = lambda q, hits, run: iter(
        [("text", p) for p in pieces] + [("usage", {"input_tokens": 1, "output_tokens": 1})])
    try:
        events = list(rag.ask_events("Who handles credit escalation in SAP?"))
    finally:
        rag.embed, rag.rank, rag._load_hits, rag.answer_stream, rag.query_terms, rag.connection = real
        rag.tracing.start_run = real_trace
    answer = "".join(d for k, d in events if k == "token")
    sources = dict(events)["sources"]
    for text in (answer, sources[0]["content"]):
        assert "solvay.com" not in text and "53 56" not in text, text
    assert "4500012345" in answer and answer.endswith("Order 4500012345.")


def test_the_answer_prompt_carries_the_scope_and_contact_rules_but_not_the_web_rule():
    import rag

    assert guardrails.SCOPE_RULE in rag.ANSWER_SYSTEM and guardrails.CONTACT_RULE in rag.ANSWER_SYSTEM
    assert guardrails.WEB_RULE not in rag.ANSWER_SYSTEM


def test_streamed_text_is_redacted_however_it_is_split():
    import random

    text = ("Mail j.doe@solvay.com or call +44 20 7946 0958. Order 4500012345 is blocked.\n"
            "Tel: 7946 0958 is the desk. End")
    rng = random.Random(7)
    for _ in range(200):
        s, out, i = contact.Stream(), "", 0
        while i < len(text):
            n = rng.randint(1, 7)
            out += s.feed(text[i:i + n])
            i += n
        out += s.flush()
        assert "solvay" not in out and "7946" not in out and "4500012345" in out, out


# ═══ the HTTP boundary ═══════════════════════════════════════════════════════

def test_agent_responses_are_redacted_on_the_way_out_and_nothing_else_is():
    from fastapi import FastAPI
    from fastapi.responses import JSONResponse, PlainTextResponse, StreamingResponse
    from fastapi.testclient import TestClient
    from guardrails.middleware import RedactContactDetails

    app = FastAPI()
    app.add_middleware(RedactContactDetails)
    body = {"answer": "Reach ops@solvay.com or Tel: 7946 0958 about order 4500012345."}

    @app.get("/api/evidence/runs/1")
    def history():
        return JSONResponse(body)

    @app.get("/api/rollout/runs/1/export")
    def export():
        return PlainTextResponse("# Pack\n\nOwner: a.b@solvay.com\n")

    @app.get("/api/fitgap/run")
    def stream():
        def gen():
            yield "event: log\ndata: {\"text\": \"mail x@y.org\"}\n\n"
            yield "event: done\ndata: {}\n\n"
        return StreamingResponse(gen(), media_type="text/event-stream")

    @app.get("/api/ask/runs/1")
    def ask_history():
        return JSONResponse(body)

    @app.get("/api/kb/files")
    def elsewhere():
        return JSONResponse(body)

    c = TestClient(app)
    r = c.get("/api/evidence/runs/1")
    assert r.json()["answer"] == (f"Reach {contact.MASK} or Tel: {contact.MASK} "
                                  "about order 4500012345."), r.text
    assert int(r.headers["content-length"]) == len(r.content)
    assert "a.b@solvay.com" not in c.get("/api/rollout/runs/1/export").text
    s = c.get("/api/fitgap/run").text
    assert "x@y.org" not in s and "event: done" in s
    assert "ops@solvay.com" not in c.get("/api/ask/runs/1").text, "Ask RAG history not redacted"
    assert c.get("/api/kb/files").json() == body, "a route outside the agents was changed"


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

"""Unit tests for tracing.py.

Two things are worth a test here, and they are not the ones a coverage tool
would pick. The first is that every call site keeps working with tracing
switched off, because that is how the application runs on a machine with no
Langfuse account and a silent break there is a break in the product, not in
the observability. The second is the one internal detail this module depends
on -- see `test_the_span_wrapper_still_exposes_its_otel_span`.

Run: python test_tracing.py   (nothing here talks to Langfuse or the network)
"""

from __future__ import annotations

import sys
import traceback
from contextlib import contextmanager
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import tracing  # noqa: E402


@contextmanager
def tracing_off():
    """Force the disabled path regardless of what is in the developer's .env.

    These tests are about the shape of the no-op, and they were wrong before
    they were right: written against an environment with no keys, they passed
    until Langfuse was configured on this machine and then started exercising
    the live client instead of the null object they were checking."""
    was_enabled, was_client, was_started = tracing.ENABLED, tracing._client, tracing._started
    tracing.ENABLED, tracing._client, tracing._started = False, None, True
    try:
        yield
    finally:
        tracing.ENABLED, tracing._client, tracing._started = was_enabled, was_client, was_started


def test_a_run_with_tracing_off_accepts_everything():
    # The whole point of the null object: no call site needs an `if`.
    run = tracing.Run(None, {})
    assert not run
    assert run.trace_id == ""
    assert run.url() == ""
    with run.step("anything", as_type="agent", input={"a": 1}) as span:
        span.update(output="x", metadata={"k": "v"})
        span.update(level="ERROR", status_message="boom")
    with run.current():
        pass
    run.update(level="WARNING")
    run.fail(ValueError("no"))
    run.end(output={"done": True})
    run.end()  # ending twice is not an error


def test_an_observation_with_tracing_off_is_a_null_object():
    with tracing_off():
        with tracing.observation("search_corpus", as_type="retriever", input={"q": "x"}) as ob:
            ob.update(output={"hits": 3})
            assert ob is tracing.NULL


def test_start_run_with_no_credentials_returns_a_dead_run():
    with tracing_off():
        run = tracing.start_run("x", input={"q": 1}, session_id="abc", tags=["t"])
        assert not run


def test_the_secret_patterns_redact_what_they_claim_to():
    masked = tracing._redact(
        "key=sk-ant-api03-AAAAAAAAAAAAAAAA dsn=postgresql://user:hunter2@host/db "
        "mail=someone@example.com"
    )
    assert "sk-ant-" not in masked
    assert "hunter2" not in masked
    assert "someone@example.com" not in masked
    assert "[EMAIL]" in masked


def test_masking_leaves_the_corpus_alone():
    # The documents are the reason the trace exists; over-broad masking would
    # leave a record that cannot answer the question it was kept for.
    text = ("Order O-050-020 Block Delivery is released by the credit "
            "representative when the GST number is confirmed.")
    assert tracing._redact(text) == text


def test_the_span_wrapper_still_exposes_its_otel_span():
    """`Run.current` reaches for `LangfuseSpan._otel_span`.

    It is the handle the Langfuse client itself uses to parent a span
    explicitly, and there is no public accessor for it. If a version of the
    SDK renames it, `Run.current` silently stops nesting and every model call
    made from `evidence.agent` and `rag.ask_events` becomes a trace of its
    own -- which looks like working tracing until someone tries to read one.
    This test is what turns that into a failure here instead."""
    try:
        from langfuse._client.span import LangfuseSpan
    except ImportError:  # langfuse is optional; nothing to check
        return
    import inspect

    source = inspect.getsource(LangfuseSpan.__mro__[1].__init__)
    assert "self._otel_span" in source, (
        "LangfuseSpan no longer stores _otel_span; tracing.Run.current needs updating"
    )


def test_observation_types_cover_every_tool_all_three_engines_dispatch():
    """A tool missing from the map is typed as a plain `tool`, which is a
    quiet downgrade: a retrieval that does not say it is one drops out of
    every count of what the agents actually read."""
    from fitgap.tools import DISPATCH as fitgap_dispatch, OBSERVATION_TYPE
    from rollout.tools import DISPATCH as rollout_dispatch

    names = set(fitgap_dispatch) | set(rollout_dispatch)
    # evidence/agent.py imports knowledge_graph at module scope, which is slow
    # and unnecessary here; its tool names are a subset of the other two plus
    # these, listed rather than imported.
    names |= {"graph_path", "graph_enumerate"}
    missing = sorted(names - set(OBSERVATION_TYPE))
    assert not missing, f"no observation type for: {', '.join(missing)}"


if __name__ == "__main__":
    fns = [(n, f) for n, f in sorted(globals().items())
           if n.startswith("test_") and callable(f)]
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

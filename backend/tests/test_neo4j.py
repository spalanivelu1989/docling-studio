"""Tests for the knowledge graph's Neo4j copy and its Cypher endpoint.

Two kinds. The first builds the write batches from the graph and checks them,
and needs nothing running. The second queries the live database, and is
skipped -- said so, not silently passed -- when Neo4j is not running or does not
hold the current build. None of them writes to Neo4j: the copy is loaded by
kg_neo4j_load.py, not by a test.

Run: python backend/tests/test_neo4j.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.graph import kg_neo4j_load as n4  # noqa: E402
from backend.graph import knowledge_graph as kg  # noqa: E402

G = kg.extract_graph()
BY_LABEL, BY_TYPE = n4.rows(G)


class Skip(Exception):
    pass


def _live():
    """The live database, or Skip with the reason."""
    st = n4.status()
    if not st.get("reachable"):
        raise Skip(st.get("detail") or "Neo4j is not reachable")
    if not st.get("current"):
        raise Skip("Neo4j does not hold the current build; run kg_neo4j_load.py")
    return st


# --- the batches, no database needed ------------------------------------------

def test_every_node_and_relationship_of_the_property_graph_is_written():
    nodes, edges = kg.property_graph(G)
    assert sum(len(b) for b in BY_LABEL.values()) == len(nodes)
    assert sum(len(b) for b in BY_TYPE.values()) == len(edges)
    assert set(BY_LABEL) == set(n4.LABEL.values())


def test_no_presentation_or_nested_value_is_written():
    """Neo4j properties cannot be maps, and degree/size/color are the canvas's."""
    for batch in BY_LABEL.values():
        for props in batch:
            assert not (set(props) & n4.SKIP_NODE), set(props) & n4.SKIP_NODE
            assert not any(isinstance(v, dict) for v in props.values())


def test_every_node_carries_its_identifying_properties():
    for label, key in n4.KEY.items():
        batch = BY_LABEL[label]
        assert all(r.get("id") for r in batch), label
        values = [r.get(key) for r in batch]
        assert all(values), f"{label} without {key}"
        assert len(set(values)) == len(values), f"{label}.{key} is not unique; the constraint would fail"


def test_relationship_types_are_neo4j_style_and_carry_their_evidence():
    types = {t for _, t, _ in BY_TYPE}
    assert all(t == t.upper() for t in types)
    assert "MENTIONS_SYSTEM" in types and "RUNS_ON" not in types
    sample = BY_TYPE[("Document", "MENTIONS_SYSTEM", "System")][0]["p"]
    assert {"method", "mentions", "chunk_count", "chunks"} <= set(sample)


# --- the live database ----------------------------------------------------------

def test_the_database_holds_exactly_what_was_written():
    _live()
    r = n4.query("MATCH (n) WHERE NOT n:_GraphMeta RETURN labels(n)[0] AS l, count(*) AS c")
    assert {l: c for l, c in r["rows"]} == {label: len(b) for label, b in BY_LABEL.items()}
    r = n4.query("MATCH (a)-[r]->(b) RETURN labels(a)[0], type(r), labels(b)[0], count(*)")
    assert {(a, t, b): c for a, t, b, c in r["rows"]} == {k: len(v) for k, v in BY_TYPE.items()}


def test_a_node_keeps_the_graph_id_so_a_result_can_be_traced_back():
    _live()
    r = n4.query("MATCH (s:System {code: 'SOVOS'}) RETURN s")
    assert r["rows"][0][0]["id"] == "system:SOVOS" and r["rows"][0][0]["_labels"] == ["System"]


def test_a_write_is_refused_by_the_database():
    """Read-only is Neo4j's to enforce, not a keyword filter's: CREATE, SET and
    DELETE are all refused inside the read transaction."""
    from neo4j.exceptions import Neo4jError

    _live()
    for text in ("CREATE (x:Hack) RETURN x", "MATCH (n:System) SET n.kind = 'x'",
                 "MATCH (n:Stream) DETACH DELETE n",
                 "CALL { CREATE (x:Hack) } IN TRANSACTIONS"):
        try:
            n4.query(text)
        except Neo4jError as exc:
            assert "AccessMode" in (exc.code or "") or "Transaction" in (exc.code or ""), exc.code
        else:
            raise AssertionError(f"write allowed: {text}")
    assert n4.query("MATCH (s:Stream) RETURN count(s)")["rows"] == [[4]]


def test_rows_are_capped():
    _live()
    r = n4.query("MATCH (c:Chunk) RETURN c.chunk_key", limit=10_000)
    assert len(r["rows"]) == n4.MAX_ROWS and r["truncated"]


def test_every_example_on_the_page_returns_rows():
    _live()
    for ex in n4.EXAMPLES:
        r = n4.query(ex["query"])
        assert r["rows"], f"example returns nothing: {ex['title']}"


def test_the_endpoint_reports_a_refused_write_and_a_syntax_error_as_400():
    _live()
    from fastapi.testclient import TestClient

    from backend.api import app

    c = TestClient(app.app)
    r = c.post("/api/graph/cypher", json={"query": "CREATE (x:Hack)"})
    assert r.status_code == 400 and "AccessMode" in r.json()["detail"]["code"]
    r = c.post("/api/graph/cypher", json={"query": "MATCH (n RETURN n"})
    assert r.status_code == 400 and "SyntaxError" in r.json()["detail"]["code"]
    r = c.post("/api/graph/cypher", json={"query": "MATCH (s:System) WHERE s.kind = $k RETURN s.code",
                                          "params": {"k": "middleware"}})
    assert r.status_code == 200 and r.json()["rows"] == [["CPI"]]


# --- plain English to Cypher (kg_nl2cypher.py) -----------------------------------
# Claude is replaced by a recording stub: these tests must not call a model.
# Neo4j is real, because the check it performs is the thing being tested.

class _FakeClaude:
    """Returns scripted drafts in order and records every request."""

    def __init__(self, drafts, stop_reason="end_turn"):
        from backend.graph import kg_nl2cypher as nl

        self.drafts = [nl.CypherDraft(**d) if isinstance(d, dict) else d for d in drafts]
        self.stop_reason = stop_reason
        self.requests = []
        self.beta = self
        self.messages = self

    def parse(self, **kw):
        from types import SimpleNamespace

        self.requests.append(kw)
        draft = self.drafts[min(len(self.requests), len(self.drafts)) - 1]
        return SimpleNamespace(
            parsed_output=None if self.stop_reason != "end_turn" else draft,
            stop_reason=self.stop_reason, model="claude-opus-5", content=[{"type": "text", "text": "{}"}],
            usage=SimpleNamespace(input_tokens=10, output_tokens=5, cache_read_input_tokens=0))


def _with_fake(drafts, **kw):
    from backend.graph import kg_nl2cypher as nl

    fake = _FakeClaude(drafts, **kw)
    real, nl._client = nl._client, lambda: fake
    return nl, fake, real


def test_the_generator_asks_opus_5_for_a_structured_checked_query():
    _live()
    nl, fake, real = _with_fake([{"answerable": True, "cypher": "MATCH (s:System) RETURN s.code",
                                  "explanation": "Lists the systems.", "assumptions": []}])
    try:
        out = nl.generate("list the systems")
    finally:
        nl._client = real
    req = fake.requests[0]
    assert req["model"] == "claude-opus-5" and req["output_format"] is nl.CypherDraft
    assert req["thinking"] == {"type": "adaptive"} and "budget_tokens" not in str(req)
    assert req["fallbacks"] == "default" and nl.FALLBACK_BETA in req["betas"]
    # The model is grounded in real values, not left to guess them.
    assert "S4HANA = SAP S/4HANA" in req["system"][0]["text"]
    assert out["valid"] and out["attempts"] == 1 and out["cypher"] == "MATCH (s:System) RETURN s.code"


def test_a_query_neo4j_rejects_goes_back_to_the_model_with_the_reason():
    _live()
    nl, fake, real = _with_fake([
        {"answerable": True, "cypher": "MATCH (s:System RETURN s", "explanation": "x"},
        {"answerable": True, "cypher": "MATCH (s:System) RETURN s.code", "explanation": "x"},
    ])
    try:
        out = nl.generate("list the systems")
    finally:
        nl._client = real
    assert out["valid"] and out["attempts"] == 2 and len(out["corrections"]) == 1
    retry = fake.requests[1]["messages"][-1]["content"]
    assert "SyntaxError" in retry, retry


def test_a_generated_write_is_never_passed_as_valid():
    _live()
    nl, fake, real = _with_fake([{"answerable": True, "cypher": "MATCH (s:System) SET s.kind = 'x'",
                                  "explanation": "x"}])
    try:
        out = nl.generate("change every system")
    finally:
        nl._client = real
    assert not out["valid"] and out["attempts"] == nl.MAX_ATTEMPTS
    assert "read-only" in out["error"] or "AccessMode" in out["error"], out["error"]
    assert n4.query("MATCH (s:System {kind: 'x'}) RETURN count(s)")["rows"] == [[0]]


def test_a_question_the_graph_cannot_answer_is_said_so():
    _live()
    nl, fake, real = _with_fake([{"answerable": False, "cypher": "",
                                  "explanation": "The graph holds no document text."}])
    try:
        out = nl.generate("quote the SOVOS spec")
    finally:
        nl._client = real
    assert not out["answerable"] and out["valid"] and out["cypher"] == "" and len(fake.requests) == 1


def test_a_refusal_is_reported_not_returned_as_a_query():
    _live()
    nl, fake, real = _with_fake([{"answerable": True, "cypher": "", "explanation": ""}], stop_reason="refusal")
    try:
        nl.generate("anything")
    except RuntimeError as exc:
        assert "declined" in str(exc)
    else:
        raise AssertionError("a refusal was returned as a result")
    finally:
        nl._client = real


def test_the_view_is_offered_every_sample_question_once():
    """The questions are served with the status, grouped, none repeated."""
    from fastapi.testclient import TestClient

    from backend.api import app
    from backend.graph import kg_nl2cypher as nl

    qs = [q for g in nl.QUESTIONS for q in g["questions"]]
    assert len(qs) == 28 and len(set(qs)) == len(qs)
    served = TestClient(app.app).get("/api/graph/neo4j/status").json()["questions"]
    assert served == nl.QUESTIONS


if __name__ == "__main__":
    import traceback

    fns = [(n, f) for n, f in sorted(globals().items()) if n.startswith("test_") and callable(f)]
    failed = skipped = 0
    for name, fn in fns:
        try:
            fn()
            print(f"  ok   {name}")
        except Skip as why:
            skipped += 1
            print(f"  skip {name} -- {why}")
        except Exception:
            failed += 1
            print(f"  FAIL {name}")
            traceback.print_exc()
    print(f"\n{len(fns) - failed - skipped}/{len(fns)} passed, {skipped} skipped")
    sys.exit(1 if failed else 0)

"""What the Evidence Agent returns.

An answer is not a paragraph with footnotes. It is a set of claims, each with
the passages that carry it, each scored by a rule that can be re-run, under one
explicit state that says what kind of answer this is.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

AnswerState = Literal[
    "supported",           # the claims stand and the sources agree
    "conflicted",          # sources disagree; both sides reported, neither chosen
    "documented_unknown",  # the corpus records this as open ("??", "TBC")
    "not_in_corpus",       # nothing addresses it
    "false_premise",       # the corpus contradicts what the question assumes
    "unrepresentable",     # answering needs something no engine models
]

STATE_BLURB: dict[str, str] = {
    "supported": "The sources agree and carry the claims.",
    "conflicted": "Sources disagree. Both sides are reported; neither is chosen.",
    "documented_unknown": "The corpus records this as undecided — somebody wrote down that it is open.",
    "not_in_corpus": "Nothing in the indexed corpus addresses this.",
    "false_premise": "The corpus contradicts an assumption in the question.",
    "unrepresentable": "Answering needs something neither engine models.",
}

Stance = Literal["supports", "opposes", "context"]


class Source(BaseModel):
    """One passage the agent actually retrieved, and what it does for a claim."""

    chunk_id: str
    doc: str
    heading_path: str = ""
    quote: str = Field(max_length=400)
    stance: Stance = "supports"

    # Filled in by the server from the retrieval log, never by the model.
    score: float | None = None          # reciprocal-rank-fusion score
    vector_rank: int | None = None
    keyword_rank: int | None = None
    provenance: list[str] = Field(default_factory=list)
    provenance_note: str = ""
    verified: bool | None = None        # quote found verbatim in the chunk

    @field_validator("chunk_id", mode="before")
    @classmethod
    def _as_text(cls, v):
        return str(v)


class GraphFact(BaseModel):
    """Something the graph asserts, kept apart from corpus passages because it
    is derived by regex over the same files rather than read from them."""

    statement: str
    node_ids: list[str] = Field(default_factory=list)
    edge_ids: list[str] = Field(default_factory=list)
    meaningful: bool = True
    note: str = ""


class ScoreTerm(BaseModel):
    """One line of the arithmetic, so a reader can check the total."""

    rule: str
    delta: float = 0.0
    cap: float | None = None
    detail: str = ""


class Claim(BaseModel):
    text: str = Field(max_length=400)
    sources: list[Source] = Field(default_factory=list)
    graph_facts: list[GraphFact] = Field(default_factory=list)

    # The model proposes a score; the server recomputes it and keeps its own.
    score: float = Field(default=0.5, ge=0.0, le=1.0)
    score_terms: list[ScoreTerm] = Field(default_factory=list)
    independent_sources: int = 0
    note: str = ""

    def documents(self) -> list[str]:
        return [s.doc for s in self.sources if s.stance == "supports"]


class Answer(BaseModel):
    question: str = ""
    state: AnswerState
    answer: str = Field(default="", max_length=1400)
    claims: list[Claim] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)
    limits: list[str] = Field(default_factory=list)

    # Server-side bookkeeping.
    engines: dict[str, int] = Field(default_factory=dict)
    tool_calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    seconds: float = 0.0
    model: str = ""

    @field_validator("answer")
    @classmethod
    def _under_120_words(cls, v: str) -> str:
        # 80 words was too tight: it pushed the model into compressing prose
        # into abbreviations to fit, which is the opposite of what the answer
        # is for. Truncation here is a backstop, not the intended path -- the
        # prompt asks for at most 120 words.
        words = v.split()
        return v if len(words) <= 120 else " ".join(words[:120]) + " \u2026"

    def model_post_init(self, _ctx) -> None:
        # A state that asserts something needs something to assert it with.
        if self.state in ("supported", "conflicted") and not self.claims:
            raise ValueError(
                f"state '{self.state}' needs at least one claim; use "
                "'not_in_corpus' if nothing addresses the question")
        for c in self.claims:
            if not c.sources and not c.graph_facts:
                raise ValueError(
                    f"the claim “{c.text[:60]}…” has no sources. Every claim "
                    "must carry a quote from a chunk you retrieved, or a graph fact.")

    @property
    def load_bearing(self) -> list["Claim"]:
        """Claims that actually assert something, i.e. carry supporting evidence.

        A claim citing only context, or reporting that a graph route is an
        artefact, frames the answer without being part of what it asserts.
        """
        return [c for c in self.claims
                if any(s.stance == "supports" for s in c.sources)]

    @property
    def confidence(self) -> float:
        """The weakest load-bearing claim governs. An answer is only as good as
        the weakest thing it actually asserts."""
        return round(min((c.score for c in self.load_bearing), default=0.0), 2)
